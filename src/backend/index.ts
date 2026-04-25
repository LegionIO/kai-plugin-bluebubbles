import { BlueBubblesClient } from './bb-client.js';
import { StateManager } from './state-manager.js';
import { AIReplyEngine } from './ai-reply.js';
import { ContactBook } from './contacts.js';
import { ChatHistoryManager } from './chat-history.js';
import { createWebhookHandler } from './webhook-handler.js';
import { normalizeChat, normalizeMessage } from './message-normalizer.js';
import { processMessagesWithReactions } from './reaction-utils.js';
import { buildBlueBubblesTools } from './tools.js';
import {
  PANEL_ID,
  NAV_ID,
  SETTINGS_ID,
  DEFAULT_WEBHOOK_PORT,
  DEFAULT_WEBHOOK_HOST,
  DEFAULT_MAX_CHUNK_LENGTH,
  DEFAULT_AI_SYSTEM_PROMPT,
  DEFAULT_MAX_HISTORY_PER_CHAT,
} from '../shared/constants.js';
import type { BlueBubblesPluginConfig, AIReplyConfig, ChunkConfig, NormalizedMessage } from '../shared/types.js';

type PluginAPI = {
  pluginName: string;
  pluginDir: string;
  config: {
    get: () => Record<string, unknown>;
    set: (path: string, value: unknown) => void;
    getPluginData: () => Record<string, unknown>;
    setPluginData: (path: string, value: unknown) => void;
    onChanged: (callback: (config: Record<string, unknown>) => void) => () => void;
  };
  state: {
    get: () => Record<string, unknown>;
    replace: (next: Record<string, unknown>) => void;
    set: (path: string, value: unknown) => void;
    emitEvent: (eventName: string, data?: unknown) => void;
  };
  ui: {
    registerPanelView: (descriptor: Record<string, unknown>) => void;
    registerNavigationItem: (descriptor: Record<string, unknown>) => void;
    registerSettingsView: (descriptor: Record<string, unknown>) => void;
    showBanner: (descriptor: Record<string, unknown>) => void;
    hideBanner: (id: string) => void;
  };
  notifications: {
    show: (descriptor: Record<string, unknown>) => void;
    dismiss: (id: string) => void;
  };
  navigation: {
    open: (target: Record<string, unknown>) => void;
  };
  http: {
    listen: (
      port: number,
      handler: (req: { method: string; url: string; headers: Record<string, string>; query: Record<string, string>; body?: string }) =>
        { status?: number; headers?: Record<string, string>; body?: string } | Promise<{ status?: number; headers?: Record<string, string>; body?: string }>,
      options?: { host?: string },
    ) => Promise<void>;
    close: () => Promise<void>;
  };
  agent: {
    generate: (options: {
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | unknown[] }>;
      modelKey?: string;
      profileKey?: string;
      reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
      fallbackEnabled?: boolean;
      systemPrompt?: string;
      tools?: boolean;
    }) => Promise<{ text: string; modelKey: string; toolCalls?: any[] }>;
  };
  log: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  onAction: (targetId: string, handler: (action: string, data?: unknown) => void | Promise<void>) => void;
  fetch: typeof globalThis.fetch;
  tools: {
    register: (tools: Array<{
      name: string;
      description: string;
      inputSchema: unknown;
      execute: (input: unknown, context?: unknown) => Promise<unknown>;
    }>) => void;
    unregister: (toolNames: string[]) => void;
  };
};

let client: BlueBubblesClient | null = null;
let stateManager: StateManager | null = null;
let aiReply: AIReplyEngine | null = null;
let contacts: ContactBook | null = null;
let chatHistory: ChatHistoryManager | null = null;
let webhookStarted = false;
let unsubConfig: (() => void) | null = null;
let toolCallStore: Record<string, any[]> = {}; // messageGuid -> toolCalls

function getConfig(api: PluginAPI): BlueBubblesPluginConfig {
  return api.config.getPluginData() as BlueBubblesPluginConfig;
}

function getAIReplyConfig(config: BlueBubblesPluginConfig): AIReplyConfig {
  return {
    enabled: config.aiReply?.enabled ?? false,
    systemPrompt: config.aiReply?.systemPrompt ?? DEFAULT_AI_SYSTEM_PROMPT,
    dmBehavior: config.aiReply?.dmBehavior ?? 'smart',
    groupBehavior: config.aiReply?.groupBehavior ?? 'smart',
    maxHistoryPerChat: config.aiReply?.maxHistoryPerChat ?? DEFAULT_MAX_HISTORY_PER_CHAT,
    modelOverride: config.aiReply?.modelOverride,
    profileOverride: config.aiReply?.profileOverride,
    reasoningEffort: config.aiReply?.reasoningEffort,
    fallbackEnabled: config.aiReply?.fallbackEnabled,
  };
}

function getChunkConfig(config: BlueBubblesPluginConfig): ChunkConfig {
  return {
    maxLength: config.chunking?.maxLength ?? DEFAULT_MAX_CHUNK_LENGTH,
    splitMode: config.chunking?.splitMode ?? 'sentence',
  };
}

function isConfigured(config: BlueBubblesPluginConfig): boolean {
  return Boolean(config.serverUrl && config.password);
}

async function connect(api: PluginAPI): Promise<void> {
  const config = getConfig(api);
  if (!isConfigured(config)) {
    stateManager!.setConnectionStatus('disconnected');
    return;
  }

  stateManager!.setConnectionStatus('connecting');

  if (!client) {
    client = new BlueBubblesClient(config, api.fetch);
  } else {
    client.updateConfig(config);
  }

  try {
    const alive = await client.ping();
    if (!alive) throw new Error('Server did not respond to ping');

    const info = await client.getServerInfo();
    stateManager!.setServerInfo(info);
    stateManager!.setConnectionStatus('connected');
    api.log.info('Connected to BlueBubbles server', info);

    await loadChats(api);
    await startWebhook(api, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stateManager!.setConnectionStatus('error', msg);
    api.log.error('Connection failed:', msg);
  }
}

async function loadChats(api: PluginAPI): Promise<void> {
  if (!client || !contacts) return;
  stateManager!.setLoadingChats(true);
  try {
    const bbChats = await client.queryChats(100, 0);
    const chats = bbChats.map((c) => normalizeChat(c, (addr) => contacts!.resolve(addr)));
    stateManager!.setChats(chats);
  } catch (err) {
    api.log.error('Failed to load chats:', err);
  } finally {
    stateManager!.setLoadingChats(false);
  }
}

async function startWebhook(api: PluginAPI, config: BlueBubblesPluginConfig): Promise<void> {
  if (webhookStarted) {
    try { await api.http.close(); } catch { /* ignore */ }
    webhookStarted = false;
  }

  const port = config.webhookPort ?? DEFAULT_WEBHOOK_PORT;
  const host = config.webhookHost ?? DEFAULT_WEBHOOK_HOST;
  const secret = config.webhookSecret ?? '';

  const aiConfig = getAIReplyConfig(config);
  const chunkConfig = getChunkConfig(config);

  aiReply = new AIReplyEngine({
    agent: api.agent,
    client: client!,
    contacts: contacts!,
    history: chatHistory!,
    config: aiConfig,
    chunkConfig,
    log: api.log,
    stateCallback: {
      setAIReplyProcessing: (chatGuid, processing) => stateManager!.setAIReplyProcessing(chatGuid, processing),
      onMessageSent: (chatGuid, bbMessage, toolCalls) => {
        if (stateManager && client) {
          const normalized = normalizeMessage(
            bbMessage,
            chatGuid,
            (guid) => client!.getAttachmentUrl(guid),
            (addr) => contacts!.resolve(addr),
          );
          if (toolCalls?.length) {
            normalized.toolCalls = toolCalls;
            toolCallStore[normalized.guid] = toolCalls;
            api.config.setPluginData('toolCallStore', toolCallStore);
          }
          stateManager.addIncomingMessage(normalized);
        }
      },
    },
    getThreadSettings: (chatGuid) => {
      const cfg = getConfig(api);
      return cfg.threadSettings?.[chatGuid];
    },
  });

  const handler = createWebhookHandler({
    stateManager: stateManager!,
    client: client!,
    log: api.log,
    webhookSecret: secret,
    contactResolve: (addr) => contacts!.resolve(addr),
    onNewMessage: async (msg) => {
      const chatGuid = msg.chats?.[0]?.guid ?? '';
      const chat = stateManager!.getState().chats.find((c) => c.guid === chatGuid);
      await aiReply!.handleMessage(msg, chat);
    },
  });

  try {
    await api.http.listen(port, handler, { host });
    webhookStarted = true;
    api.log.info(`Webhook server listening on ${host}:${port}`);
  } catch (err) {
    api.log.error('Failed to start webhook server:', err);
  }
}

async function handlePanelAction(api: PluginAPI, action: string, data?: unknown): Promise<void> {
  if (!client || !stateManager) return;

  const config = getConfig(api);
  const chunkConfig = getChunkConfig(config);

  switch (action) {
    case 'loadChats': {
      await loadChats(api);
      break;
    }

    case 'selectChat': {
      const { chatGuid } = data as { chatGuid: string };
      stateManager.setActiveChatGuid(chatGuid);
      stateManager.setLoadingMessages(true);
      try {
        const bbMessages = await client.getChatMessages(chatGuid, 100, 0);

        const allNormalized = bbMessages
          .map((m) => normalizeMessage(m, chatGuid, (guid) => client!.getAttachmentUrl(guid), (addr) => contacts!.resolve(addr)))
          .reverse();
        const bbReversed = [...bbMessages].reverse();
        const messages = processMessagesWithReactions(allNormalized, bbReversed);
        // Re-attach persisted tool calls
        for (const msg of messages) {
          if (toolCallStore[msg.guid]) {
            msg.toolCalls = toolCallStore[msg.guid];
          }
        }
        stateManager.setActiveChatMessages(messages);
        stateManager.markChatRead(chatGuid);
        client.markChatRead(chatGuid).catch(() => {});
      } catch (err) {
        api.log.error('Failed to load messages:', err);
      } finally {
        stateManager.setLoadingMessages(false);
      }
      break;
    }

    case 'sendMessage': {
      const { chatGuid, text, replyToGuid } = data as { chatGuid: string; text: string; replyToGuid?: string };
      stateManager.setSendingMessage(true);
      try {
        const results = await client.sendChunkedText(chatGuid, text, chunkConfig.maxLength, { replyToGuid });
        for (const msg of results) {
          const normalized = normalizeMessage(msg, chatGuid, (guid) => client!.getAttachmentUrl(guid), (addr) => contacts!.resolve(addr));
          stateManager.addIncomingMessage(normalized);
        }
        chatHistory?.appendMessage(chatGuid, { role: 'assistant', content: text });
      } catch (err) {
        api.log.error('Failed to send message:', err);
      } finally {
        stateManager.setSendingMessage(false);
      }
      break;
    }

    case 'sendReaction': {
      const { chatGuid, messageGuid, reaction } = data as { chatGuid: string; messageGuid: string; reaction: string };
      try {
        await client.sendReaction(chatGuid, messageGuid, reaction);
      } catch (err) {
        api.log.error('Failed to send reaction:', err);
      }
      break;
    }

    case 'editMessage': {
      const { chatGuid, messageGuid, text } = data as { chatGuid: string; messageGuid: string; text: string };
      try {
        await client.editMessage(chatGuid, messageGuid, text);
      } catch (err) {
        api.log.error('Failed to edit message:', err);
      }
      break;
    }

    case 'unsendMessage': {
      const { chatGuid, messageGuid } = data as { chatGuid: string; messageGuid: string };
      try {
        await client.unsendMessage(chatGuid, messageGuid);
      } catch (err) {
        api.log.error('Failed to unsend message:', err);
      }
      break;
    }

    case 'loadMoreMessages': {
      const { chatGuid, offset } = data as { chatGuid: string; offset: number };
      try {
        const bbMessages = await client.getChatMessages(chatGuid, 50, offset);
        const allNormalized = bbMessages
          .map((m) => normalizeMessage(m, chatGuid, (guid) => client!.getAttachmentUrl(guid), (addr) => contacts!.resolve(addr)))
          .reverse();
        const bbReversed = [...bbMessages].reverse();
        const older = processMessagesWithReactions(allNormalized, bbReversed);
        const current = stateManager.getState().activeChatMessages;
        // Deduplicate by guid then sort
        const byGuid = new Map<string, NormalizedMessage>();
        for (const m of [...older, ...current]) byGuid.set(m.guid, m);
        const merged = [...byGuid.values()].sort((a, b) => a.date - b.date);
        for (const msg of merged) {
          if (toolCallStore[msg.guid]) msg.toolCalls = toolCallStore[msg.guid];
        }
        stateManager.setActiveChatMessages(merged);
      } catch (err) {
        api.log.error('Failed to load more messages:', err);
      }
      break;
    }

    case 'markRead': {
      const { chatGuid } = data as { chatGuid: string };
      stateManager.markChatRead(chatGuid);
      client.markChatRead(chatGuid).catch(() => {});
      break;
    }

    case 'sendTyping': {
      const { chatGuid } = data as { chatGuid: string };
      client.sendTypingIndicator(chatGuid).catch(() => {});
      break;
    }

    case 'startNewChat': {
      const { addresses, message } = data as { addresses: string[]; message?: string };
      try {
        await client.createChat(addresses, message);
        await loadChats(api);
      } catch (err) {
        api.log.error('Failed to create chat:', err);
      }
      break;
    }

    case 'deleteChat': {
      const { chatGuid } = data as { chatGuid: string };
      try {
        await client.deleteChat(chatGuid);
        if (stateManager.getState().activeChatGuid === chatGuid) {
          stateManager.setActiveChatGuid(null);
          stateManager.setActiveChatMessages([]);
        }
        chatHistory?.clearHistory(chatGuid);
        await loadChats(api);
      } catch (err) {
        api.log.error('Failed to delete chat:', err);
      }
      break;
    }

    case 'saveContact': {
      const { address, name } = data as { address: string; name: string };
      contacts!.set(address, name);
      stateManager.setContacts(contacts!.getAll());
      await loadChats(api);
      break;
    }

    case 'deleteContact': {
      const { address } = data as { address: string };
      contacts!.delete(address);
      stateManager.setContacts(contacts!.getAll());
      await loadChats(api);
      break;
    }

    case 'clearChatHistory': {
      const { chatGuid } = data as { chatGuid: string };
      chatHistory!.clearHistory(chatGuid);
      break;
    }

    case 'clearPendingChat': {
      stateManager.clearPendingChat();
      break;
    }

    case 'sendAttachmentFromUI': {
      const { chatGuid, filename, mimeType, base64 } = data as { chatGuid: string; filename: string; mimeType: string; base64: string };
      try {
        const { writeFileSync, mkdirSync } = await import('fs');
        const { join } = await import('path');
        const { tmpdir } = await import('os');
        const tmpDir = join(tmpdir(), 'kai-bb-attachments');
        mkdirSync(tmpDir, { recursive: true });
        const tmpPath = join(tmpDir, `${Date.now()}-${filename}`);
        writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
        const result = await client.sendAttachment(chatGuid, tmpPath, filename, mimeType);
        // Push sent attachment to UI immediately
        const bbMsg = (result as any)?.data ?? result;
        if (bbMsg?.guid && stateManager) {
          const normalized = normalizeMessage(bbMsg, chatGuid, (guid) => client!.getAttachmentUrl(guid), (addr) => contacts!.resolve(addr));
          stateManager.addIncomingMessage(normalized);
        }
        api.log.info(`Sent attachment from UI: ${filename}`);
      } catch (err) {
        api.log.error('Failed to send attachment from UI:', err);
      }
      break;
    }

    case 'saveThreadSettings': {
      const { chatGuid, settings } = data as { chatGuid: string; settings: Record<string, unknown> };
      const config = getConfig(api);
      const current = config.threadSettings ?? {};
      current[chatGuid] = settings as any;
      api.config.setPluginData('threadSettings', current);
      break;
    }

    default:
      api.log.warn(`Unknown panel action: ${action}`);
  }
}

async function handleSettingsAction(api: PluginAPI, action: string, data?: unknown): Promise<void> {
  switch (action) {
    case 'testConnection': {
      await connect(api);
      break;
    }

    case 'reconnect': {
      await connect(api);
      break;
    }

    case 'saveContact': {
      const { address, name } = data as { address: string; name: string };
      contacts!.set(address, name);
      stateManager!.setContacts(contacts!.getAll());
      break;
    }

    case 'deleteContact': {
      const { address } = data as { address: string };
      contacts!.delete(address);
      stateManager!.setContacts(contacts!.getAll());
      break;
    }

    default:
      api.log.warn(`Unknown settings action: ${action}`);
  }
}

export async function activate(api: PluginAPI): Promise<void> {
  api.log.info('BlueBubbles plugin activating');

  contacts = new ContactBook(api.config);
  chatHistory = new ChatHistoryManager(api.config);
  toolCallStore = (api.config.getPluginData().toolCallStore as Record<string, any[]>) ?? {};

  stateManager = new StateManager(
    api.state,
    api.ui as any,
    api.notifications as any,
    api.log,
  );

  stateManager.setContacts(contacts.getAll());

  // Register UI components
  api.ui.registerPanelView({
    id: PANEL_ID,
    title: 'Messages',
    visible: true,
    width: 'full',
  });

  api.ui.registerNavigationItem({
    id: NAV_ID,
    label: 'Messages',
    icon: { lucide: 'message-circle' },
    visible: true,
    priority: 10,
    target: { type: 'panel', panelId: PANEL_ID },
  });

  api.ui.registerSettingsView({
    id: SETTINGS_ID,
    label: 'BlueBubbles',
    priority: 50,
  });

  // Register action handlers
  api.onAction(`panel:${PANEL_ID}`, (action, data) => handlePanelAction(api, action, data));
  api.onAction(`settings:${SETTINGS_ID}`, (action, data) => handleSettingsAction(api, action, data));

  // Register AI tools
  const tools = buildBlueBubblesTools({
    getClient: () => client,
    getContacts: () => contacts,
    getStateManager: () => stateManager,
    getChatHistory: () => chatHistory,
    getConfig: () => getConfig(api),
    getChunkConfig: () => getChunkConfig(getConfig(api)),
    log: api.log,
    loadChats: () => loadChats(api),
  });
  api.tools.register(tools as any);

  // Watch for config changes
  unsubConfig = api.config.onChanged(() => {
    const config = getConfig(api);
    if (client) client.updateConfig(config);
    if (aiReply) {
      aiReply.updateConfig(getAIReplyConfig(config));
      aiReply.updateChunkConfig(getChunkConfig(config));
    }
    if (chatHistory) {
      chatHistory.setMaxPerChat(config.aiReply?.maxHistoryPerChat ?? DEFAULT_MAX_HISTORY_PER_CHAT);
    }
    contacts?.reload();
    stateManager!.setContacts(contacts!.getAll());
    stateManager!.setNotificationsEnabled(config.notifications !== false);
  });

  // Initial connection if configured
  const config = getConfig(api);
  stateManager.setNotificationsEnabled(config.notifications !== false);
  if (isConfigured(config)) {
    connect(api).catch((err) => api.log.error('Initial connection failed:', err));
  }

  api.log.info('BlueBubbles plugin activated');
}

export async function deactivate(): Promise<void> {
  if (unsubConfig) {
    unsubConfig();
    unsubConfig = null;
  }
  client = null;
  stateManager = null;
  aiReply = null;
  contacts = null;
  chatHistory = null;
  webhookStarted = false;
}
