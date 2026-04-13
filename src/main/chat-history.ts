import type { ConversationMessage } from '../shared/types.js';
import { DEFAULT_MAX_HISTORY_PER_CHAT } from '../shared/constants.js';

type ConfigAPI = {
  getPluginData: () => Record<string, unknown>;
  setPluginData: (path: string, value: unknown) => void;
};

export class ChatHistoryManager {
  private histories: Record<string, ConversationMessage[]>;
  private configApi: ConfigAPI;
  private maxPerChat: number;

  constructor(configApi: ConfigAPI, maxPerChat?: number) {
    this.configApi = configApi;
    this.maxPerChat = maxPerChat ?? DEFAULT_MAX_HISTORY_PER_CHAT;
    const data = configApi.getPluginData();
    this.histories = (data.chatHistories as Record<string, ConversationMessage[]>) ?? {};
  }

  setMaxPerChat(max: number): void {
    this.maxPerChat = max;
  }

  getHistory(chatGuid: string): ConversationMessage[] {
    return this.histories[chatGuid] ?? [];
  }

  appendMessage(chatGuid: string, msg: Omit<ConversationMessage, 'timestamp'>): void {
    if (!this.histories[chatGuid]) {
      this.histories[chatGuid] = [];
    }
    this.histories[chatGuid].push({
      ...msg,
      timestamp: Date.now(),
    });
    this.trim(chatGuid);
    this.persist();
  }

  clearHistory(chatGuid: string): void {
    delete this.histories[chatGuid];
    this.persist();
  }

  toAgentMessages(chatGuid: string): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    const history = this.getHistory(chatGuid);
    return history.map((msg) => ({
      role: msg.role,
      content: msg.senderName && msg.role === 'user'
        ? `[${msg.senderName}] ${msg.content}`
        : msg.content,
    }));
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
