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
  HISTORY_PER_CHAT_RANGE,
  TOOL_HISTORY_LIMIT_RANGES,
} from '../shared/constants.js';
import type {
  BlueBubblesPluginConfig,
  AIReplyConfig,
  ChunkConfig,
  MessageContentPart,
  NormalizedMessage,
  ToolHistoryLimits,
} from '../shared/types.js';

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
  events?: {
    declare: (decl: {
      events?: Array<{ event: string; title: string; description?: string; payloadSchema?: Record<string, unknown> }>;
      actions?: Array<{ targetId: string; title: string; description?: string; inputSchema?: Record<string, unknown> }>;
    }) => void;
    emit: (event: string, payload?: unknown) => void;
    on: (key: string, handler: (event: unknown) => void) => () => void;
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
      messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string | unknown[] }>;
      modelKey?: string;
      profileKey?: string;
      reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
      fallbackEnabled?: boolean;
      systemPrompt?: string;
      tools?: boolean;
    }) => Promise<{ text: string; modelKey: string; toolCalls?: any[] }>;
    stream?: (options: {
      messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string | unknown[] }>;
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
  onAction: (targetId: string, handler: (action: string, data?: unknown) => unknown | Promise<unknown>) => void;
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
let closeHttp: (() => Promise<void>) | null = null;
let unsubConfig: (() => void) | null = null;
let initialNicknameSyncTimer: ReturnType<typeof setTimeout> | null = null;
let locallySentGuids = new Set<string>();
let toolCallStore: Record<string, any[]> = {}; // messageGuid -> toolCalls
let messageContentPartStore: Record<string, MessageContentPart[]> = {}; // messageGuid -> ordered assistant content/tool parts
let localMessageStore: Record<string, NormalizedMessage[]> = {}; // chatGuid -> local-only messages

const MAX_LOCAL_MESSAGES_PER_CHAT = 50;
const MAX_LOCAL_MESSAGE_CHATS = 50;
const MAX_TRACE_STORE_MESSAGES = 200;
const MAX_STORED_TRACE_STRING_LENGTH = 20_000;
const MAX_STORED_TRACE_ARRAY_LENGTH = 50;
const MAX_STORED_TRACE_OBJECT_KEYS = 50;
const MAX_STORED_TRACE_DEPTH = 6;

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

function truncateStoredString(value: string): string {
  if (value.length <= MAX_STORED_TRACE_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STORED_TRACE_STRING_LENGTH)}...[truncated ${value.length - MAX_STORED_TRACE_STRING_LENGTH} chars]`;
}

function compactStoredTraceValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateStoredString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
  if (typeof value !== 'object') return String(value);

  if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;
  if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${(value as ArrayBufferView).byteLength} bytes]`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateStoredString(value.message),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_STORED_TRACE_DEPTH) return '[MaxDepth]';

  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_STORED_TRACE_ARRAY_LENGTH)
      .map((item) => compactStoredTraceValue(item, seen, depth + 1));
    if (value.length > MAX_STORED_TRACE_ARRAY_LENGTH) {
      items.push(`[truncated ${value.length - MAX_STORED_TRACE_ARRAY_LENGTH} items]`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries.slice(0, MAX_STORED_TRACE_OBJECT_KEYS)) {
    output[key] = compactStoredTraceValue(item, seen, depth + 1);
  }
  if (entries.length > MAX_STORED_TRACE_OBJECT_KEYS) {
    output.__truncatedKeys = entries.length - MAX_STORED_TRACE_OBJECT_KEYS;
  }
  return output;
}

function compactToolCalls(toolCalls?: any[]): any[] | undefined {
  if (!toolCalls?.length) return undefined;
  return compactStoredTraceValue(toolCalls) as any[];
}

function compactContentParts(parts?: MessageContentPart[]): MessageContentPart[] | undefined {
  if (!parts?.length) return undefined;
  return compactStoredTraceValue(parts) as MessageContentPart[];
}

function compactTracePayload(trace: {
  toolCalls?: any[];
  contentParts?: MessageContentPart[];
}): {
  toolCalls?: any[];
  contentParts?: MessageContentPart[];
} {
  return {
    toolCalls: compactToolCalls(trace.toolCalls),
    contentParts: compactContentParts(trace.contentParts),
  };
}

function pruneRecord<T>(record: Record<string, T>, maxEntries: number): Record<string, T> {
  const entries = Object.entries(record);
  if (entries.length <= maxEntries) return record;
  return Object.fromEntries(entries.slice(-maxEntries)) as Record<string, T>;
}

function pruneTraceStores(): void {
  toolCallStore = pruneRecord(toolCallStore, MAX_TRACE_STORE_MESSAGES);
  messageContentPartStore = pruneRecord(messageContentPartStore, MAX_TRACE_STORE_MESSAGES);
}

function pruneLocalMessageStore(): void {
  const entries = Object.entries(localMessageStore);
  if (entries.length <= MAX_LOCAL_MESSAGE_CHATS) return;

  entries.sort(([, a], [, b]) => {
    const latestA = Math.max(0, ...a.map((msg) => msg.date ?? 0));
    const latestB = Math.max(0, ...b.map((msg) => msg.date ?? 0));
    return latestB - latestA;
  });
  localMessageStore = Object.fromEntries(entries.slice(0, MAX_LOCAL_MESSAGE_CHATS));
}

function emitBusEvent(api: PluginAPI, event: string, payload?: unknown): void {
  try {
    if (api.events?.emit) {
      api.events.emit(event, payload);
    } else {
      api.state.emitEvent(event, payload);
    }
  } catch (err) {
    api.log.warn(`[bluebubbles] event emit '${event}' failed:`, err);
  }
}

const MAX_LOCALLY_SENT_GUIDS = 500;

function markLocallySent(guid: string): void {
  locallySentGuids.add(guid);
  if (locallySentGuids.size > MAX_LOCALLY_SENT_GUIDS) {
    for (const g of locallySentGuids) {
      locallySentGuids.delete(g);
      if (locallySentGuids.size <= MAX_LOCALLY_SENT_GUIDS) break;
    }
  }
}

function declareAutomationCatalog(api: PluginAPI): void {
  if (!api.events?.declare) return;

  const messageProps = {
    guid: { type: 'string' },
    chatGuid: { type: 'string' },
    chatName: { type: 'string' },
    sender: { type: 'string' },
    senderName: { type: 'string' },
    text: { type: 'string' },
    isFromMe: { type: 'boolean' },
    isGroup: { type: 'boolean' },
    attachmentCount: { type: 'number' },
  };

  api.events.declare({
    events: [
      {
        event: 'message-received',
        title: 'Message received',
        description: 'A new iMessage/SMS arrived from someone else',
        payloadSchema: { type: 'object', properties: messageProps },
      },
      {
        event: 'message-sent',
        title: 'Message sent',
        description: 'A message was sent from this account (manual or AI reply)',
        payloadSchema: {
          type: 'object',
          properties: { ...messageProps, source: { type: 'string', enum: ['manual', 'ai-reply', 'automation', 'tool', 'external'] } },
        },
      },
      {
        event: 'message-updated',
        title: 'Message edited or unsent',
        payloadSchema: {
          type: 'object',
          properties: { ...messageProps, isEdited: { type: 'boolean' }, isUnsent: { type: 'boolean' } },
        },
      },
      {
        event: 'reaction',
        title: 'Reaction added or removed',
        payloadSchema: {
          type: 'object',
          properties: {
            chatGuid: { type: 'string' },
            targetGuid: { type: 'string' },
            reaction: { type: 'string', enum: ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'] },
            sender: { type: 'string' },
            senderName: { type: 'string' },
            isFromMe: { type: 'boolean' },
            removed: { type: 'boolean' },
          },
        },
      },
      {
        event: 'typing',
        title: 'Typing indicator',
        payloadSchema: {
          type: 'object',
          properties: { chatGuid: { type: 'string' }, display: { type: 'boolean' } },
        },
      },
      {
        event: 'chat-read',
        title: 'Chat marked read',
        payloadSchema: { type: 'object', properties: { chatGuid: { type: 'string' } } },
      },
      {
        event: 'group-change',
        title: 'Group membership or name changed',
        payloadSchema: {
          type: 'object',
          properties: {
            chatGuid: { type: 'string' },
            change: { type: 'string', enum: ['name', 'participant-added', 'participant-removed', 'participant-left'] },
            newName: { type: 'string' },
          },
        },
      },
      {
        event: 'connection',
        title: 'Server connection status changed',
        payloadSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['connecting', 'connected', 'disconnected', 'error'] },
            error: { type: 'string' },
          },
        },
      },
    ],
    actions: [
      {
        targetId: 'automation:send-message',
        title: 'Send message',
        description: 'Send an iMessage/SMS to a chat',
        inputSchema: {
          type: 'object',
          required: ['chatGuid', 'text'],
          properties: {
            chatGuid: { type: 'string' },
            text: { type: 'string' },
            replyToGuid: { type: 'string' },
          },
        },
      },
      {
        targetId: 'automation:send-reaction',
        title: 'Send reaction',
        description: 'Tapback on a message',
        inputSchema: {
          type: 'object',
          required: ['chatGuid', 'messageGuid', 'reaction'],
          properties: {
            chatGuid: { type: 'string' },
            messageGuid: { type: 'string' },
            reaction: { type: 'string', enum: ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'] },
          },
        },
      },
      {
        targetId: 'automation:mark-read',
        title: 'Mark chat read',
        inputSchema: {
          type: 'object',
          required: ['chatGuid'],
          properties: { chatGuid: { type: 'string' } },
        },
      },
    ],
  });
}

const AUTOMATION_ACTION_TARGETS = ['automation:send-message', 'automation:send-reaction', 'automation:mark-read'] as const;

async function handleAutomationAction(
  api: PluginAPI,
  targetId: (typeof AUTOMATION_ACTION_TARGETS)[number],
  data?: unknown,
): Promise<{ success: true; [k: string]: unknown } | { error: string }> {
  if (!client || !stateManager) return { error: 'BlueBubbles not connected' };

  try {
    switch (targetId) {
      case 'automation:send-message': {
        const { chatGuid, text, replyToGuid } = data as { chatGuid: string; text: string; replyToGuid?: string };
        if (!chatGuid || !text) return { error: 'chatGuid and text are required' };
        const chunkConfig = getChunkConfig(getConfig(api));
        const results = await client.sendChunkedText(chatGuid, text, chunkConfig.maxLength, { replyToGuid });
        const chat = stateManager.getState().chats.find((c) => c.guid === chatGuid);
        for (const msg of results) {
          const normalized = normalizeMessage(
            msg,
            chatGuid,
            (guid) => client!.getAttachmentUrl(guid),
            (addr) => contacts!.resolve(addr),
          );
          stateManager.addIncomingMessage(normalized);
          markLocallySent(normalized.guid);
          emitBusEvent(api, 'message-sent', {
            guid: normalized.guid,
            chatGuid,
            chatName: chat?.displayName ?? chatGuid,
            sender: 'me',
            senderName: 'Me',
            text: normalized.text,
            isFromMe: true,
            isGroup: chat?.isGroup ?? false,
            attachmentCount: normalized.attachments.length,
            source: 'automation',
          });
        }
        chatHistory?.appendMessage(chatGuid, { role: 'assistant', content: text });
        return { success: true, chatGuid, messagesSent: results.length, guids: results.map((m) => m.guid) };
      }

      case 'automation:send-reaction': {
        const { chatGuid, messageGuid, reaction } = data as { chatGuid: string; messageGuid: string; reaction: string };
        if (!chatGuid || !messageGuid || !reaction) return { error: 'chatGuid, messageGuid and reaction are required' };
        await client.sendReaction(chatGuid, messageGuid, reaction);
        return { success: true, chatGuid, messageGuid, reaction };
      }

      case 'automation:mark-read': {
        const { chatGuid } = data as { chatGuid: string };
        if (!chatGuid) return { error: 'chatGuid is required' };
        await client.markChatRead(chatGuid);
        stateManager.markChatRead(chatGuid);
        emitBusEvent(api, 'chat-read', { chatGuid });
        return { success: true, chatGuid };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    api.log.error(`Automation ${targetId} failed:`, message);
    return { error: message };
  }
}

function getConfig(api: PluginAPI): BlueBubblesPluginConfig {
  const raw = api.config.getPluginData() as BlueBubblesPluginConfig;
  return {
    ...raw,
    password: secrets?.get('password') ?? raw.password,
    webhookSecret: secrets?.get('webhookSecret') ?? raw.webhookSecret,
  };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function getAIReplyConfig(config: BlueBubblesPluginConfig): AIReplyConfig {
  return {
    enabled: config.aiReply?.enabled ?? false,
    systemPrompt: config.aiReply?.systemPrompt ?? DEFAULT_AI_SYSTEM_PROMPT,
    dmBehavior: config.aiReply?.dmBehavior ?? 'smart',
    groupBehavior: config.aiReply?.groupBehavior ?? 'smart',
    maxHistoryPerChat: boundedInteger(
      config.aiReply?.maxHistoryPerChat,
      HISTORY_PER_CHAT_RANGE.default,
      HISTORY_PER_CHAT_RANGE.min,
      HISTORY_PER_CHAT_RANGE.max,
    ),
    toolHistoryMaxStringLength: boundedInteger(
      config.aiReply?.toolHistoryMaxStringLength,
      TOOL_HISTORY_LIMIT_RANGES.maxStringLength.default,
      TOOL_HISTORY_LIMIT_RANGES.maxStringLength.min,
      TOOL_HISTORY_LIMIT_RANGES.maxStringLength.max,
    ),
    toolHistoryMaxArrayLength: boundedInteger(
      config.aiReply?.toolHistoryMaxArrayLength,
      TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.default,
      TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.min,
      TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.max,
    ),
    toolHistoryMaxObjectKeys: boundedInteger(
      config.aiReply?.toolHistoryMaxObjectKeys,
      TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.default,
      TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.min,
      TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.max,
    ),
    toolHistoryMaxDepth: boundedInteger(
      config.aiReply?.toolHistoryMaxDepth,
      TOOL_HISTORY_LIMIT_RANGES.maxDepth.default,
      TOOL_HISTORY_LIMIT_RANGES.maxDepth.min,
      TOOL_HISTORY_LIMIT_RANGES.maxDepth.max,
    ),
    modelOverride: config.aiReply?.modelOverride,
    profileOverride: config.aiReply?.profileOverride,
    reasoningEffort: config.aiReply?.reasoningEffort,
    fallbackEnabled: config.aiReply?.fallbackEnabled,
  };
}

function getToolHistoryLimits(config: AIReplyConfig): ToolHistoryLimits {
  return {
    maxStringLength: config.toolHistoryMaxStringLength,
    maxArrayLength: config.toolHistoryMaxArrayLength,
    maxObjectKeys: config.toolHistoryMaxObjectKeys,
    maxDepth: config.toolHistoryMaxDepth,
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
  failure: {
    text: string;
    error: string;
    stage: string;
    runId: string;
    toolCalls?: any[];
    contentParts?: MessageContentPart[];
  },
): NormalizedMessage {
  return {
    guid: `local-ai-reply-progress-${failure.runId}`,
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
    toolCalls: compactToolCalls(failure.toolCalls),
    contentParts: compactContentParts(failure.contentParts),
    isLocalOnly: true,
    localKind: 'ai-reply-failure',
  };
}

function createLocalAIReplyProgressMessage(
  chatGuid: string,
  progress: {
    guid: string;
    text: string;
    contentParts: MessageContentPart[];
    toolCalls?: any[];
  },
): NormalizedMessage {
  return {
    guid: progress.guid,
    chatGuid,
    sender: 'me',
    senderName: 'Me',
    text: progress.text,
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
    error: 0,
    toolCalls: compactToolCalls(progress.toolCalls),
    contentParts: compactContentParts(progress.contentParts),
    isLocalOnly: true,
    localKind: 'ai-reply-progress',
  };
}

function storeLocalMessage(api: PluginAPI, message: NormalizedMessage): void {
  const existing = localMessageStore[message.chatGuid] ?? [];
  const byGuid = new Map(existing.map((msg) => [msg.guid, msg]));
  byGuid.set(message.guid, message);
  localMessageStore[message.chatGuid] = [...byGuid.values()].slice(-MAX_LOCAL_MESSAGES_PER_CHAT);
  pruneLocalMessageStore();
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
    emitBusEvent(api, 'connection', { status: 'disconnected' });
    return;
  }

  stateManager!.setConnectionStatus('connecting');
  emitBusEvent(api, 'connection', { status: 'connecting' });

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
    emitBusEvent(api, 'connection', { status: 'connected' });
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
    emitBusEvent(api, 'connection', { status: 'error', error: msg });
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
      onMessageSent: (chatGuid, bbMessage, trace) => {
        if (stateManager && client) {
          const normalized = normalizeMessage(
            bbMessage,
            chatGuid,
            (guid) => client!.getAttachmentUrl(guid),
            (addr) => contacts!.resolve(addr),
          );
          const compactTrace = trace ? compactTracePayload(trace) : {};
          if (compactTrace.toolCalls?.length) {
            normalized.toolCalls = compactTrace.toolCalls;
            toolCallStore[normalized.guid] = compactTrace.toolCalls;
            pruneTraceStores();
            api.config.setPluginData('toolCallStore', toolCallStore);
          }
          if (compactTrace.contentParts?.length) {
            normalized.contentParts = compactTrace.contentParts;
            messageContentPartStore[normalized.guid] = compactTrace.contentParts;
            pruneTraceStores();
            api.config.setPluginData('messageContentPartStore', messageContentPartStore);
          }
          if (trace?.replaceMessageGuid) {
            stateManager.replaceActiveChatMessage(trace.replaceMessageGuid, normalized);
          } else {
            stateManager.addIncomingMessage(normalized);
          }
          const chat = stateManager.getState().chats.find((c) => c.guid === chatGuid);
          markLocallySent(normalized.guid);
          emitBusEvent(api, 'message-sent', {
            guid: normalized.guid,
            chatGuid,
            chatName: chat?.displayName ?? chatGuid,
            sender: 'me',
            senderName: 'Me',
            text: normalized.text,
            isFromMe: true,
            isGroup: chat?.isGroup ?? false,
            attachmentCount: normalized.attachments.length,
            source: 'ai-reply',
          });
          debugLog?.event('message.sent_to_ui', {
            chatGuid,
            messageGuid: normalized.guid,
            text: normalized.text,
            toolCallCount: trace?.toolCalls?.length ?? 0,
            contentPartCount: trace?.contentParts?.length ?? 0,
            replacedMessageGuid: trace?.replaceMessageGuid,
          }, 'info');
        }
      },
      onAIReplyProgress: (chatGuid, progress) => {
        if (stateManager) {
          const localMessage = createLocalAIReplyProgressMessage(chatGuid, progress);
          stateManager.upsertActiveChatMessage(localMessage);
          debugLog?.event('ai_reply.progress_message_updated', {
            chatGuid,
            localMessageGuid: localMessage.guid,
            textLength: localMessage.text.length,
            toolCallCount: progress.toolCalls?.length ?? 0,
            contentPartCount: progress.contentParts.length,
          });
        }
      },
      onAIReplyFailed: (chatGuid, failure) => {
        if (stateManager) {
          const localMessage = createLocalAIReplyFailureMessage(chatGuid, failure);
          storeLocalMessage(api, localMessage);
          stateManager.replaceActiveChatMessage(localMessage.guid, localMessage);
          debugLog?.event('ai_reply.failure_message_added_to_thread', {
            chatGuid,
            localMessageGuid: localMessage.guid,
            runId: failure.runId,
            stage: failure.stage,
            error: failure.error,
            toolCallCount: failure.toolCalls?.length ?? 0,
            contentPartCount: failure.contentParts?.length ?? 0,
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
    emitEvent: (event, payload) => emitBusEvent(api, event, payload),
    isLocallySent: (guid) => locallySentGuids.has(guid),
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
          if (messageContentPartStore[msg.guid]) {
            msg.contentParts = messageContentPartStore[msg.guid];
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
        const chat = stateManager.getState().chats.find((c) => c.guid === chatGuid);
        for (const msg of results) {
          const normalized = normalizeMessage(msg, chatGuid, (guid) => client!.getAttachmentUrl(guid), (addr) => contacts!.resolve(addr));
          stateManager.addIncomingMessage(normalized);
          markLocallySent(normalized.guid);
          emitBusEvent(api, 'message-sent', {
            guid: normalized.guid,
            chatGuid,
            chatName: chat?.displayName ?? chatGuid,
            sender: 'me',
            senderName: 'Me',
            text: normalized.text,
            isFromMe: true,
            isGroup: chat?.isGroup ?? false,
            attachmentCount: normalized.attachments.length,
            source: 'manual',
          });
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
          if (messageContentPartStore[msg.guid]) msg.contentParts = messageContentPartStore[msg.guid];
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
      emitBusEvent(api, 'chat-read', { chatGuid });
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
        if (message && newChat.lastMessage?.guid) {
          markLocallySent(newChat.lastMessage.guid);
          emitBusEvent(api, 'message-sent', {
            guid: newChat.lastMessage.guid,
            chatGuid: newChat.guid,
            chatName: newChat.displayName ?? newChat.guid,
            sender: 'me',
            senderName: 'Me',
            text: newChat.lastMessage.text ?? message,
            isFromMe: true,
            isGroup: addresses.length > 1,
            attachmentCount: 0,
            source: 'manual',
          });
        }
        await loadChats(api);

        // Send any attachments to the new chat
        if (attachments?.length) {
          const { writeFileSync, mkdirSync, unlinkSync } = await import('fs');
          const { join } = await import('path');
          const { tmpdir } = await import('os');
          const tmpDir = join(tmpdir(), 'kai-bb-attachments');
          mkdirSync(tmpDir, { recursive: true });
          for (const att of attachments) {
            const tmpPath = join(tmpDir, `${Date.now()}-${att.filename}`);
            try {
              writeFileSync(tmpPath, Buffer.from(att.base64, 'base64'));
              const result = await client.sendAttachment(newChat.guid, tmpPath, att.filename, att.mimeType);
              const bbMsg = (result as any)?.data ?? result;
              if (bbMsg?.guid) {
                markLocallySent(bbMsg.guid);
                emitBusEvent(api, 'message-sent', {
                  guid: bbMsg.guid,
                  chatGuid: newChat.guid,
                  chatName: newChat.displayName ?? newChat.guid,
                  sender: 'me',
                  senderName: 'Me',
                  text: bbMsg.text ?? '',
                  isFromMe: true,
                  isGroup: addresses.length > 1,
                  attachmentCount: 1,
                  source: 'manual',
                });
              }
            } finally {
              try { unlinkSync(tmpPath); } catch { /* ignore */ }
            }
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
        const { writeFileSync, mkdirSync, unlinkSync } = await import('fs');
        const { join } = await import('path');
        const { tmpdir } = await import('os');
        const tmpDir = join(tmpdir(), 'kai-bb-attachments');
        mkdirSync(tmpDir, { recursive: true });
        const tmpPath = join(tmpDir, `${Date.now()}-${filename}`);
        let result: unknown;
        try {
          writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
          result = await client.sendAttachment(chatGuid, tmpPath, filename, mimeType);
        } finally {
          try { unlinkSync(tmpPath); } catch { /* ignore */ }
        }
        // Push sent attachment to UI immediately
        const bbMsg = (result as any)?.data ?? result;
        if (bbMsg?.guid && stateManager) {
          const normalized = normalizeMessage(bbMsg, chatGuid, (guid) => client!.getAttachmentUrl(guid), (addr) => contacts!.resolve(addr));
          stateManager.addIncomingMessage(normalized);
          markLocallySent(normalized.guid);
          const chat = stateManager.getState().chats.find((c) => c.guid === chatGuid);
          emitBusEvent(api, 'message-sent', {
            guid: normalized.guid,
            chatGuid,
            chatName: chat?.displayName ?? chatGuid,
            sender: 'me',
            senderName: 'Me',
            text: normalized.text,
            isFromMe: true,
            isGroup: chat?.isGroup ?? false,
            attachmentCount: normalized.attachments.length,
            source: 'manual',
          });
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
  closeHttp = () => api.http.close();

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
  const initialAIConfig = getAIReplyConfig(rawConfig);
  chatHistory = new ChatHistoryManager(
    api.config,
    initialAIConfig.maxHistoryPerChat,
    getToolHistoryLimits(initialAIConfig),
  );
  toolCallStore = (api.config.getPluginData().toolCallStore as Record<string, any[]>) ?? {};
  messageContentPartStore = (api.config.getPluginData().messageContentPartStore as Record<string, MessageContentPart[]>) ?? {};
  localMessageStore = (api.config.getPluginData().localMessageStore as Record<string, NormalizedMessage[]>) ?? {};
  pruneTraceStores();
  pruneLocalMessageStore();
  api.config.setPluginData('toolCallStore', toolCallStore);
  api.config.setPluginData('messageContentPartStore', messageContentPartStore);
  api.config.setPluginData('localMessageStore', localMessageStore);

  stateManager = new StateManager(
    api.state,
    api.ui as any,
    api.notifications as any,
    api.log,
  );

  stateManager.setContacts(contacts.getAll());

  try {
    declareAutomationCatalog(api);
  } catch (err) {
    api.log.warn('Failed to declare automation catalog:', err);
  }

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
  for (const targetId of AUTOMATION_ACTION_TARGETS) {
    api.onAction(targetId, (_action, data) => handleAutomationAction(api, targetId, data));
  }

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
    onMessageSent: (chatGuid, guid, text, chatMeta) => {
      markLocallySent(guid);
      const chat = stateManager?.getState().chats.find((c) => c.guid === chatGuid);
      emitBusEvent(api, 'message-sent', {
        guid,
        chatGuid,
        chatName: chat?.displayName ?? chatMeta?.chatName ?? chatGuid,
        sender: 'me',
        senderName: 'Me',
        text,
        isFromMe: true,
        isGroup: chat?.isGroup ?? chatMeta?.isGroup ?? false,
        attachmentCount: 0,
        source: 'tool',
      });
    },
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
      const aiConfig = getAIReplyConfig(config);
      chatHistory.setMaxPerChat(aiConfig.maxHistoryPerChat);
      chatHistory.setToolHistoryLimits(getToolHistoryLimits(aiConfig));
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
  if (initialNicknameSyncTimer) clearTimeout(initialNicknameSyncTimer);
  initialNicknameSyncTimer = setTimeout(() => {
    initialNicknameSyncTimer = null;
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
  if (initialNicknameSyncTimer) {
    clearTimeout(initialNicknameSyncTimer);
    initialNicknameSyncTimer = null;
  }
  if (unsubConfig) {
    unsubConfig();
    unsubConfig = null;
  }
  if (webhookStarted && closeHttp) {
    try { await closeHttp(); } catch { /* ignore */ }
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
  closeHttp = null;
  toolCallStore = {};
  messageContentPartStore = {};
  localMessageStore = {};
  locallySentGuids = new Set();
  webhookStarted = false;
}
