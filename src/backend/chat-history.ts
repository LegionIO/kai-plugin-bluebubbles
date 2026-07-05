import type {
  ConversationMessage,
  MessageContentPart,
  MessageToolCallContentPart,
  ToolHistoryLimits,
} from '../shared/types.js';
import {
  DEFAULT_MAX_HISTORY_PER_CHAT,
  TOOL_HISTORY_LIMIT_RANGES,
} from '../shared/constants.js';

type ConfigAPI = {
  getPluginData: () => Record<string, unknown>;
  setPluginData: (path: string, value: unknown) => void;
};

export type AgentHistoryMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | unknown[];
};

const DEFAULT_TOOL_HISTORY_LIMITS: ToolHistoryLimits = {
  maxStringLength: TOOL_HISTORY_LIMIT_RANGES.maxStringLength.default,
  maxArrayLength: TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.default,
  maxObjectKeys: TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.default,
  maxDepth: TOOL_HISTORY_LIMIT_RANGES.maxDepth.default,
};

function compactToolHistoryValue(
  value: unknown,
  limits: ToolHistoryLimits,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length <= limits.maxStringLength) return value;
    return `${value.slice(0, limits.maxStringLength)}...[truncated ${value.length - limits.maxStringLength} chars]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return String(value);

  if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;
  if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength} bytes]`;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  if (depth >= limits.maxDepth) return '[MaxDepth]';

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, limits.maxArrayLength)
      .map((item) => compactToolHistoryValue(item, limits, seen, depth + 1));
    if (value.length > limits.maxArrayLength) {
      items.push(`[truncated ${value.length - limits.maxArrayLength} items]`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries.slice(0, limits.maxObjectKeys)) {
    output[key] = compactToolHistoryValue(item, limits, seen, depth + 1);
  }
  if (entries.length > limits.maxObjectKeys) {
    output.__truncatedKeys = entries.length - limits.maxObjectKeys;
  }
  return output;
}

function compactContentParts(
  parts: MessageContentPart[] | undefined,
  limits: ToolHistoryLimits,
): MessageContentPart[] | undefined {
  if (!parts?.some((part) => part.type === 'tool-call')) return undefined;
  return parts.map((part) => {
    if (part.type === 'text') return { ...part };
    return {
      ...part,
      args: compactToolHistoryValue(part.args, limits),
      ...(part.result !== undefined
        ? { result: compactToolHistoryValue(part.result, limits) }
        : {}),
      ...(part.error
        ? { error: compactToolHistoryValue(part.error, limits) as string }
        : {}),
    };
  });
}

function toolResultForHistory(part: MessageToolCallContentPart): unknown {
  if (part.result !== undefined) return part.result;
  if (part.error) return { error: part.error };
  return 'Tool execution did not complete.';
}

function assistantTurnToAgentMessages(msg: ConversationMessage): AgentHistoryMessage[] {
  const parts = msg.contentParts;
  if (!parts?.some((part) => part.type === 'tool-call')) {
    return [{ role: 'assistant', content: msg.content }];
  }

  const messages: AgentHistoryMessage[] = [];
  let textParts: Array<{ type: 'text'; text: string }> = [];
  let toolParts: MessageToolCallContentPart[] = [];
  let toolPartStartIndex = 0;

  const flushText = () => {
    if (textParts.length === 0) return;
    messages.push({ role: 'assistant', content: textParts });
    textParts = [];
  };

  const flushTools = () => {
    if (toolParts.length === 0) return;
    const calls = toolParts.map((part, index) => {
      const toolCallId = part.toolCallId || `history-${msg.timestamp}-${toolPartStartIndex + index}`;
      return {
        type: 'tool-call',
        toolCallId,
        toolName: part.toolName,
        args: part.args ?? {},
      };
    });
    const results = toolParts.map((part, index) => {
      const toolCallId = part.toolCallId || `history-${msg.timestamp}-${toolPartStartIndex + index}`;
      return {
        type: 'tool-result',
        toolCallId,
        toolName: part.toolName,
        result: toolResultForHistory(part),
        ...(part.error || part.status === 'failed' ? { isError: true } : {}),
      };
    });
    messages.push({ role: 'assistant', content: calls });
    messages.push({ role: 'tool', content: results });
    toolParts = [];
  };

  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part.type === 'text') {
      flushTools();
      if (part.text) textParts.push({ type: 'text', text: part.text });
      continue;
    }

    flushText();
    if (toolParts.length === 0) toolPartStartIndex = index;
    toolParts.push(part);
  }
  flushTools();
  flushText();

  return messages.length > 0 ? messages : [{ role: 'assistant', content: msg.content }];
}

export class ChatHistoryManager {
  private histories: Record<string, ConversationMessage[]>;
  private configApi: ConfigAPI;
  private maxPerChat: number;
  private toolHistoryLimits: ToolHistoryLimits;

  constructor(
    configApi: ConfigAPI,
    maxPerChat = DEFAULT_MAX_HISTORY_PER_CHAT,
    toolHistoryLimits: ToolHistoryLimits = DEFAULT_TOOL_HISTORY_LIMITS,
  ) {
    this.configApi = configApi;
    this.maxPerChat = maxPerChat;
    this.toolHistoryLimits = toolHistoryLimits;
    const data = configApi.getPluginData();
    this.histories = (data.chatHistories as Record<string, ConversationMessage[]>) ?? {};
  }

  setMaxPerChat(max: number): void {
    this.maxPerChat = max;
  }

  setToolHistoryLimits(limits: ToolHistoryLimits): void {
    this.toolHistoryLimits = limits;
  }

  getHistory(chatGuid: string): ConversationMessage[] {
    return this.histories[chatGuid] ?? [];
  }

  appendMessage(chatGuid: string, msg: Omit<ConversationMessage, 'timestamp'>): void {
    if (!this.histories[chatGuid]) {
      this.histories[chatGuid] = [];
    }
    const { contentParts: rawContentParts, ...message } = msg;
    const contentParts = compactContentParts(rawContentParts, this.toolHistoryLimits);
    this.histories[chatGuid].push({
      ...message,
      ...(contentParts ? { contentParts } : {}),
      timestamp: Date.now(),
    });
    this.trim(chatGuid);
    this.persist();
  }

  clearHistory(chatGuid: string): void {
    delete this.histories[chatGuid];
    this.persist();
  }

  toAgentMessages(chatGuid: string): AgentHistoryMessage[] {
    const messages: AgentHistoryMessage[] = [];
    for (const msg of this.getHistory(chatGuid)) {
      if (msg.role === 'assistant') {
        messages.push(...assistantTurnToAgentMessages(msg));
        continue;
      }

      let text = msg.senderName && msg.role === 'user'
        ? `[${msg.senderName}] ${msg.content}`
        : msg.content;

      const imageCount = (msg.attachments ?? []).filter((a) => a.mimeType.startsWith('image/')).length;
      if (imageCount > 0 && !text.includes('[Image')) {
        text += ` [${imageCount} image${imageCount > 1 ? 's' : ''} attached]`;
      }
      messages.push({ role: msg.role, content: text });
    }
    return messages;
  }

  reload(): void {
    const data = this.configApi.getPluginData();
    this.histories = (data.chatHistories as Record<string, ConversationMessage[]>) ?? {};
  }

  private trim(chatGuid: string): void {
    const history = this.histories[chatGuid];
    if (history && history.length > this.maxPerChat) {
      this.histories[chatGuid] = history.slice(-this.maxPerChat);
    }
  }

  private persist(): void {
    this.configApi.setPluginData('chatHistories', { ...this.histories });
  }
}
