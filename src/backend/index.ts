import { randomBytes } from 'crypto';
import { BlueBubblesClient } from './bb-client.js';
import { StateManager } from './state-manager.js';
import { AIReplyEngine } from './ai-reply.js';
import { ContactBook } from './contacts.js';
import { ContactPhotoCache } from './contact-photos.js';
import { IMessageNicknameCache, normalizeAddress as normalizeAddr } from './imessage-nickname-cache.js';
import { ChatHistoryManager } from './chat-history.js';
import { createWebhookHandler } from './webhook-handler.js';
import { normalizeChat, normalizeMessage } from './message-normalizer.js';
import { processMessagesWithReactions } from './reaction-utils.js';
import { buildBlueBubblesTools } from './tools.js';
import { SecretStore } from './secret-store.js';
import { AdvancedDebugLogger } from './debug-logger.js';
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
    stream?: (options: {
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | unknown[] }>;
      modelKey?: string;
      profileKey?: string;
      reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
      fallbackEnabled?: boolean;
      systemPrompt?: string;
      tools?: boolean;
    }) => AsyncGenerator<{
      type: string;
      text?: string;
      toolCallId?: string;
      toolName?: string;
      args?: unknown;
      result?: unknown;
      error?: string;
      modelKey?: string;
    }>;
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
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  safeStorage?: {
    isEncryptionAvailable: () => boolean;
    encryptString: (plaintext: string) => string;
    decryptString: (base64Cipher: string) => string;
  };
};

let client: BlueBubblesClient | null = null;
let stateManager: StateManager | null = null;
let aiReply: AIReplyEngine | null = null;
let contacts: ContactBook | null = null;
let contactPhotoCache: ContactPhotoCache | null = null;
let iMessageNicknameCache: IMessageNicknameCache | null = null;
let chatHistory: ChatHistoryManager | null = null;
let secrets: SecretStore | null = null;
let debugLog: AdvancedDebugLogger | null = null;
let webhookStarted = false;
let unsubConfig: (() => void) | null = null;
let toolCallStore: Record<string, any[]> = {}; // messageGuid -> toolCalls
let localMessageStore: Record<string, NormalizedMessage[]> = {}; // chatGuid -> local-only messages

const MAX_LOCAL_MESSAGES_PER_CHAT = 50;

function showFdaBanner(api: PluginAPI): void {
  api.ui.showBanner({
    id: 'fda-permission',
    text: 'iMessage contact photos require Full Disk Access. Go to System Settings → Privacy & Security → Full Disk Access and add Kai.',
    variant: 'warning',
    dismissible: true,
    visible: true,
  });
}

function hideFdaBanner(api: PluginAPI): void {
  api.ui.hideBanner('fda-permission');
}

function getConfig(api: PluginAPI): BlueBubblesPluginConfig {
  const raw = api.config.getPluginData() as BlueBubblesPluginConfig;
  return {
    ...raw,
    password: secrets?.get('password') ?? raw.password,
    webhookSecret: secrets?.get('webhookSecret') ?? raw.webhookSecret,
  };
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

function createLocalAIReplyFailureMessage(
  chatGuid: string,
  failure: { text: string; error: string; stage: string; runId: string; toolCalls?: any[] },
): NormalizedMessage {
  return {
    guid: `local-ai-reply-failure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chatGuid,
    sender: 'me',
    senderName: 'Me',
    text: failure.text,
    date: Date.now(),
    isFromMe: true,
    attachments: [],
    reactions: [],
    replyToGuid: null,
    isEdited: false,
    isUnsent: false,
    effectId: null,
    isDelivered: false,
    isRead: false,
    error: 1,
    toolCalls: failure.toolCalls,
    isLocalOnly: true,
    localKind: 'ai-reply-failure',
  };
}

function storeLocalMessage(api: PluginAPI, message: NormalizedMessage): void {
  const existing = localMessageStore[message.chatGuid] ?? [];
  localMessageStore[message.chatGuid] = [...existing, message]
    .slice(-MAX_LOCAL_MESSAGES_PER_CHAT);
  api.config.setPluginData('localMessageStore', localMessageStore);
}

function mergeLocalMessages(chatGuid: string, messages: NormalizedMessage[]): NormalizedMessage[] {
  const localMessages = localMessageStore[chatGuid] ?? [];
  if (localMessages.length === 0) return messages;

  const byGuid = new Map<string, NormalizedMessage>();
  for (const message of [...messages, ...localMessages]) {
    byGuid.set(message.guid, message);
  }
  return [...byGuid.values()].sort((a, b) => a.date - b.date);
}

function debugConfigSnapshot(config: BlueBubblesPluginConfig): Record<string, unknown> {
  return {
    configured: isConfigured(config),
    serverUrl: config.serverUrl,
    webhookPort: config.webhookPort,
    webhookHost: config.webhookHost,
    notifications: config.notifications,
    advancedDebugLogs: config.advancedDebugLogs,
    aiReply: config.aiReply,
    chunking: config.chunking,
    contactCount: Object.keys(config.contacts ?? {}).length,
    chatHistoryCount: Object.keys(config.chatHistories ?? {}).length,
    threadSettingsCount: Object.keys(config.threadSettings ?? {}).length,
  };
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

    // Sync local nicknames first (loads photos for chat participants), then BB contacts
    // Sequential so local photos are merged before BB sync pushes state to frontend
    syncNicknamesFromLocal(api)
      .then(() => syncContactsFromBlueBubbles(api))
      .catch((err) => api.log.warn('Failed to sync contacts:', err));
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

async function syncContactsFromBlueBubbles(api: PluginAPI): Promise<void> {
  if (!client || !stateManager || !contacts || !contactPhotoCache) return;

  // Always push cached photos immediately (fast path)
  const cachedPhotos = contactPhotoCache.getPhotos();
  if (Object.keys(cachedPhotos).length > 0) {
    stateManager.setContactPhotos(cachedPhotos);
  }

  // Push cached sync info immediately
  const cachedNames = contactPhotoCache.getNames();
  if (Object.keys(cachedNames).length > 0) {
    stateManager.setContactSyncInfo({
      syncedAddresses: Object.keys(cachedNames),
      lastSyncTime: contactPhotoCache.getLastFetched(),
      syncedCount: Object.keys(cachedNames).length,
      photoCount: Object.keys(cachedPhotos).length,
    });
  }

  // Only refresh from BlueBubbles if cache is stale (>24h)
  if (!contactPhotoCache.isCacheStale()) {
    // Still sync any cached names that aren't in contacts yet
    let namesUpdated = false;
    for (const [address, name] of Object.entries(cachedNames)) {
      if (!contacts.get(address)) {
        contacts.set(address, name);
        namesUpdated = true;
      }
    }
    if (namesUpdated) {
      stateManager.setContacts(contacts.getAll());
      await loadChats(api);
    }
    return;
  }

  // Cache is stale — fetch fresh from BlueBubbles
  const chats = stateManager.getState().chats;
  const addresses = new Set<string>();
  for (const chat of chats) {
    for (const p of chat.participants) {
      addresses.add(p.address);
    }
  }

  if (addresses.size === 0) return;

  const result = await contactPhotoCache.refreshFromBlueBubbles(client, [...addresses]);

  // Auto-sync contact names from macOS Contacts (only add, don't overwrite user-set names)
  let namesUpdated = false;
  for (const [address, name] of Object.entries(result.names)) {
    if (!contacts.get(address)) {
      contacts.set(address, name);
      namesUpdated = true;
    }
  }

  if (namesUpdated) {
    stateManager.setContacts(contacts.getAll());
    // Reload chats so display names are updated with synced contact names
    await loadChats(api);
  }

  // Push fresh photos and sync info to frontend
  stateManager.setContactPhotos(result.photos);
  stateManager.setContactSyncInfo({
    syncedAddresses: Object.keys(result.names),
    lastSyncTime: Date.now(),
    syncedCount: Object.keys(result.names).length,
    photoCount: Object.keys(result.photos).length,
  });
}

async function syncNicknamesFromLocal(api: PluginAPI): Promise<void> {
  if (!iMessageNicknameCache || !contacts || !stateManager || !contactPhotoCache) return;

  const availability = iMessageNicknameCache.isAvailable();
  if (availability === 'not-found') return;
  if (availability === 'permission-denied') {
    showFdaBanner(api);
    return;
  }

  try {
    // Gather relevant addresses from chat participants to limit photo loading
    const chats = stateManager.getState().chats ?? [];
    const relevantAddresses = new Set<string>();
    for (const chat of chats) {
      if (chat.participants) {
        for (const p of chat.participants) {
          if (p.address) {
            relevantAddresses.add(normalizeAddr(p.address));
          }
        }
      }
    }

    // If no chats loaded yet (startup), skip photos (pass empty set).
    // Once chats are available, load photos for participants only.
    const addrFilter = relevantAddresses.size > 0 ? relevantAddresses : new Set<string>();
    const result = await iMessageNicknameCache.load(addrFilter);

    // Merge photos and names into the contact photo cache (persists to disk)
    contactPhotoCache.mergeLocalNicknames(result.photos, result.names);

    // Sync names into ContactBook (only if not already user-set)
    let namesUpdated = false;
    for (const [address, name] of Object.entries(result.names)) {
      if (!contacts.get(address)) {
        contacts.set(address, name);
        namesUpdated = true;
      }
    }

    if (namesUpdated) {
      stateManager.setContacts(contacts.getAll());
    }

    // Push photos to frontend state
    const allPhotos = contactPhotoCache.getPhotos();
    if (Object.keys(allPhotos).length > 0) {
      stateManager.setContactPhotos(allPhotos);
      hideFdaBanner(api); // Photos loaded successfully, dismiss any permission warning
    }

    // Update sync info
    const allNames = contactPhotoCache.getNames();
    stateManager.setContactSyncInfo({
      syncedAddresses: Object.keys(allNames),
      lastSyncTime: Date.now(),
      syncedCount: Object.keys(allNames).length,
      photoCount: Object.keys(allPhotos).length,
    });
  } catch (err) {
    api.log.warn('Failed to sync iMessage nicknames from local cache:', err);
  }
}

async function stopWebhook(api: PluginAPI): Promise<void> {
  if (!webhookStarted) return;
  try { await api.http.close(); } catch { /* ignore */ }
  webhookStarted = false;
}

async function startWebhook(api: PluginAPI, config: BlueBubblesPluginConfig): Promise<void> {
  await stopWebhook(api);

  const port = config.webhookPort ?? DEFAULT_WEBHOOK_PORT;
  const host = config.webhookHost ?? DEFAULT_WEBHOOK_HOST;

  let secret = config.webhookSecret ?? '';
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    secrets?.set('webhookSecret', secret);
    api.log.info('Generated new webhook secret');
    api.ui.showBanner({
      id: 'webhook-secret-generated',
      text: 'A webhook secret is now required. Update your BlueBubbles server webhook URL to include ?secret=… (copy it from BlueBubbles → Settings).',
      variant: 'warning',
      dismissible: true,
      visible: true,
    });
  }
  api.state.set('webhookSecret', secret);

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
    debugLog: debugLog ?? undefined,
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
          debugLog?.event('message.sent_to_ui', {
            chatGuid,
            messageGuid: normalized.guid,
            text: normalized.text,
            toolCallCount: toolCalls?.length ?? 0,
          }, 'info');
        }
      },
      onAIReplyFailed: (chatGuid, failure) => {
        if (stateManager) {
          const localMessage = createLocalAIReplyFailureMessage(chatGuid, failure);
          storeLocalMessage(api, localMessage);
          stateManager.addIncomingMessage(localMessage);
          debugLog?.event('ai_reply.failure_message_added_to_thread', {
            chatGuid,
            localMessageGuid: localMessage.guid,
            runId: failure.runId,
            stage: failure.stage,
            error: failure.error,
            toolCallCount: failure.toolCalls?.length ?? 0,
          }, 'info');
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
    debugLog: debugLog ?? undefined,
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
        let messages = processMessagesWithReactions(allNormalized, bbReversed);
        // Re-attach persisted tool calls
        for (const msg of messages) {
          if (toolCallStore[msg.guid]) {
            msg.toolCalls = toolCallStore[msg.guid];
          }
        }
        messages = mergeLocalMessages(chatGuid, messages);
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
        let merged = [...byGuid.values()].sort((a, b) => a.date - b.date);
        for (const msg of merged) {
          if (toolCallStore[msg.guid]) msg.toolCalls = toolCallStore[msg.guid];
        }
        merged = mergeLocalMessages(chatGuid, merged);
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
      const { addresses, message, attachments } = data as {
        addresses: string[];
        message?: string;
        attachments?: Array<{ filename: string; mimeType: string; base64: string }>;
      };
      try {
        const newChat = await client.createChat(addresses, message);
        await loadChats(api);

        // Send any attachments to the new chat
        if (attachments?.length) {
          const { writeFileSync, mkdirSync } = await import('fs');
          const { join } = await import('path');
          const { tmpdir } = await import('os');
          const tmpDir = join(tmpdir(), 'kai-bb-attachments');
          mkdirSync(tmpDir, { recursive: true });
          for (const att of attachments) {
            const tmpPath = join(tmpDir, `${Date.now()}-${att.filename}`);
            writeFileSync(tmpPath, Buffer.from(att.base64, 'base64'));
            await client.sendAttachment(newChat.guid, tmpPath, att.filename, att.mimeType);
          }
        }

        // Auto-navigate to the new conversation
        stateManager.setPendingChatGuid(newChat.guid);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        api.log.error('Failed to create chat:', err);
        api.notifications.show({
          id: 'create-chat-error',
          title: 'Failed to create conversation',
          body: msg,
          level: 'error',
          autoDismissMs: 8000,
        });
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

    case 'downloadAttachment': {
      const { guid, filename } = data as { guid: string; filename: string; mimeType?: string };
      try {
        const result = await client.fetchAttachmentAsBase64(guid);
        if (!result) throw new Error('Attachment fetch returned empty');
        const { writeFileSync, mkdirSync } = await import('fs');
        const { join, basename } = await import('path');
        const { tmpdir } = await import('os');
        const { pathToFileURL } = await import('url');
        const tmpDir = join(tmpdir(), 'kai-bb-attachments');
        mkdirSync(tmpDir, { recursive: true });
        const safeName = basename(filename || `attachment-${guid}`);
        const tmpPath = join(tmpDir, `${Date.now()}-${safeName}`);
        writeFileSync(tmpPath, Buffer.from(result.base64, 'base64'));
        await api.shell.openExternal(pathToFileURL(tmpPath).href);
        api.log.info(`Opened attachment: ${safeName}`);
      } catch (err) {
        api.log.error('Failed to download attachment:', err);
        api.notifications.show({
          id: 'download-attachment-error',
          title: 'Failed to open attachment',
          body: err instanceof Error ? err.message : String(err),
          level: 'error',
          autoDismissMs: 6000,
        });
      }
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

    case 'savePassword': {
      const { password } = data as { password: string };
      if (password) {
        secrets?.set('password', password);
        if ((api.config.getPluginData() as BlueBubblesPluginConfig).password) {
          api.config.setPluginData('password', undefined);
        }
        api.state.set('hasPassword', true);
        if (client) client.updateConfig(getConfig(api));
        api.state.set('configured', isConfigured(getConfig(api)));
      } else {
        secrets?.delete('password');
        if ((api.config.getPluginData() as BlueBubblesPluginConfig).password) {
          api.config.setPluginData('password', undefined);
        }
        api.state.set('hasPassword', false);
        if (client) client.updateConfig(getConfig(api));
        await stopWebhook(api);
        stateManager?.setConnectionStatus('disconnected');
        api.state.set('configured', false);
      }
      break;
    }

    case 'regenerateWebhookSecret': {
      const next = randomBytes(32).toString('hex');
      secrets?.set('webhookSecret', next);
      if ((api.config.getPluginData() as BlueBubblesPluginConfig).webhookSecret) {
        api.config.setPluginData('webhookSecret', undefined);
      }
      api.state.set('webhookSecret', next);
      // Restart the listener directly so the new secret is enforced even if
      // the BlueBubbles server is currently unreachable.
      if (client) {
        await startWebhook(api, getConfig(api));
      } else {
        await stopWebhook(api);
      }
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

    case 'syncContacts': {
      // Sync local iMessage nicknames first (higher priority photos)
      await syncNicknamesFromLocal(api);

      // Then sync from BlueBubbles API
      if (contactPhotoCache && client && stateManager && contacts) {
        const chats = stateManager.getState().chats;
        const addresses = new Set<string>();
        for (const chat of chats) {
          for (const p of chat.participants) {
            addresses.add(p.address);
          }
        }
        if (addresses.size > 0) {
          const result = await contactPhotoCache.refreshFromBlueBubbles(client, [...addresses]);
          let namesUpdated = false;
          for (const [address, name] of Object.entries(result.names)) {
            if (!contacts.get(address)) {
              contacts.set(address, name);
              namesUpdated = true;
            }
          }
          if (namesUpdated) {
            stateManager.setContacts(contacts.getAll());
            await loadChats(api);
          }
          stateManager.setContactPhotos(result.photos);
          stateManager.setContactSyncInfo({
            syncedAddresses: Object.keys(result.names),
            lastSyncTime: Date.now(),
            syncedCount: Object.keys(result.names).length,
            photoCount: Object.keys(result.photos).length,
          });
        }
      }
      break;
    }

    case 'openFdaSettings': {
      api.shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles');
      break;
    }

    default:
      api.log.warn(`Unknown settings action: ${action}`);
  }
}

export async function activate(api: PluginAPI): Promise<void> {
  api.log.info('BlueBubbles plugin activating');

  secrets = new SecretStore({
    safeStorage: api.safeStorage,
    config: api.config,
    pluginDir: api.pluginDir,
    log: api.log,
  });

  // One-time migration: move plaintext password/webhookSecret from plugin
  // config into encrypted storage. Always clear the plaintext copies even if
  // an encrypted value already exists (interrupted migration / external edit).
  const rawConfig = api.config.getPluginData() as BlueBubblesPluginConfig;
  debugLog = new AdvancedDebugLogger({
    enabled: rawConfig.advancedDebugLogs === true,
    log: api.log,
  });
  debugLog.event('plugin.activating', {
    pluginName: api.pluginName,
    pluginDir: api.pluginDir,
    config: debugConfigSnapshot(rawConfig),
  }, 'info');
  if (rawConfig.password) {
    if (!secrets.has('password')) {
      secrets.set('password', rawConfig.password);
      api.log.info('Migrated BlueBubbles password to encrypted storage');
    }
    api.config.setPluginData('password', undefined);
  }
  if (rawConfig.webhookSecret) {
    if (!secrets.has('webhookSecret')) {
      secrets.set('webhookSecret', rawConfig.webhookSecret);
      api.log.info('Migrated webhook secret to encrypted storage');
    }
    api.config.setPluginData('webhookSecret', undefined);
  }
  // Scrub legacy ?password= URLs that ai-reply.ts previously persisted into
  // chatHistories attachment metadata.
  if (rawConfig.chatHistories) {
    let scrubbed = false;
    const histories = rawConfig.chatHistories as Record<string, Array<{ attachments?: Array<Record<string, unknown>> }>>;
    for (const msgs of Object.values(histories)) {
      for (const msg of msgs ?? []) {
        for (const att of msg.attachments ?? []) {
          if (typeof att.url === 'string' && att.url.includes('password=')) {
            delete att.url;
            scrubbed = true;
          }
        }
      }
    }
    if (scrubbed) {
      api.config.setPluginData('chatHistories', histories);
      api.log.info('Scrubbed legacy password-bearing attachment URLs from chat history');
    }
  }

  contacts = new ContactBook(api.config);
  contactPhotoCache = new ContactPhotoCache(api.config);
  iMessageNicknameCache = new IMessageNicknameCache(api.log);
  chatHistory = new ChatHistoryManager(api.config);
  toolCallStore = (api.config.getPluginData().toolCallStore as Record<string, any[]>) ?? {};
  localMessageStore = (api.config.getPluginData().localMessageStore as Record<string, NormalizedMessage[]>) ?? {};

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
    title: 'BlueBubbles',
    visible: true,
  });

  api.ui.registerNavigationItem({
    id: NAV_ID,
    visible: true,
    target: { type: 'panel', panelId: PANEL_ID },
  });

  api.ui.registerSettingsView({
    id: SETTINGS_ID,
    label: 'BlueBubbles',
  });

  // Register action handlers
  api.onAction(`panel:${PANEL_ID}`, (action, data) => handlePanelAction(api, action, data));
  api.onAction('settings:SettingsView', (action, data) => handleSettingsAction(api, action, data));

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
    debugLog?.setEnabled(config.advancedDebugLogs === true);
    debugLog?.event('config.changed', {
      config: debugConfigSnapshot(config),
    }, 'info');
    api.state.set('configured', isConfigured(config));
    api.state.set('advancedDebugLogPath', debugLog?.getLogPath() ?? '');
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
  api.state.set('configured', isConfigured(config));
  api.state.set('hasPassword', secrets.has('password'));
  api.state.set('secretsEncryptionMethod', secrets.encryptionMethod());
  api.state.set('webhookSecret', secrets.get('webhookSecret') ?? '');
  api.state.set('advancedDebugLogPath', debugLog.getLogPath());

  // Sync local iMessage nicknames (deferred so plugin activation completes immediately)
  setTimeout(() => {
    syncNicknamesFromLocal(api).catch((err) =>
      api.log.warn('Failed initial iMessage nickname sync:', err),
    );
  }, 0);

  if (isConfigured(config)) {
    connect(api).catch((err) => api.log.error('Initial connection failed:', err));
  }

  api.log.info('BlueBubbles plugin activated');
  debugLog.event('plugin.activated', {
    configured: isConfigured(config),
    advancedDebugLogPath: debugLog.getLogPath(),
  }, 'info');
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
  contactPhotoCache = null;
  iMessageNicknameCache = null;
  chatHistory = null;
  secrets = null;
  debugLog = null;
  webhookStarted = false;
}
