import type {
  BlueBubblesPluginState,
  NormalizedChat,
  NormalizedMessage,
  NormalizedReaction,
  BBServerInfo,
  ConnectionStatus,
} from '../shared/types.js';
import { NAV_ID, MESSAGE_BUBBLE_ICON_SVG } from '../shared/constants.js';

type PluginStateAPI = {
  get: () => Record<string, unknown>;
  set: (path: string, value: unknown) => void;
  replace: (next: Record<string, unknown>) => void;
};

type PluginUIAPI = {
  registerNavigationItem: (descriptor: {
    id: string;
    label: string;
    icon?: string | { svg: string };
    visible: boolean;
    priority?: number;
    badge?: string | number;
    target: { type: 'panel'; panelId: string };
  }) => void;
};

type PluginNotificationsAPI = {
  show: (descriptor: {
    id: string;
    title: string;
    body?: string;
    level?: 'info' | 'success' | 'warning' | 'error';
    native?: boolean;
    autoDismissMs?: number;
    target?: { type: 'panel'; panelId: string };
  }) => void;
};

type LogAPI = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export class StateManager {
  private state: BlueBubblesPluginState;
  private stateApi: PluginStateAPI;
  private uiApi: PluginUIAPI;
  private notificationsApi: PluginNotificationsAPI;
  private log: LogAPI;
  private notificationsEnabled: boolean;

  constructor(
    stateApi: PluginStateAPI,
    uiApi: PluginUIAPI,
    notificationsApi: PluginNotificationsAPI,
    log: LogAPI,
  ) {
    this.stateApi = stateApi;
    this.uiApi = uiApi;
    this.notificationsApi = notificationsApi;
    this.log = log;
    this.notificationsEnabled = true;

    this.state = {
      connectionStatus: 'disconnected',
      serverInfo: null,
      privateApiEnabled: false,
      chats: [],
      activeChatGuid: null,
      activeChatMessages: [],
      sendingMessage: false,
      loadingChats: false,
      loadingMessages: false,
      typingIndicators: {},
      error: null,
      unreadTotal: 0,
      contacts: {},
      aiReplyProcessing: {},
      pendingChatGuid: null,
    };

    this.pushFullState();
  }

  setNotificationsEnabled(enabled: boolean): void {
    this.notificationsEnabled = enabled;
  }

  getState(): BlueBubblesPluginState {
    return this.state;
  }

  setConnectionStatus(status: ConnectionStatus, error?: string): void {
    this.state.connectionStatus = status;
    this.state.error = error ?? null;
    this.stateApi.set('connectionStatus', status);
    this.stateApi.set('error', error ?? null);
  }

  setServerInfo(info: BBServerInfo): void {
    this.state.serverInfo = info;
    this.state.privateApiEnabled = Boolean(info.private_api);
    this.stateApi.set('serverInfo', info);
    this.stateApi.set('privateApiEnabled', Boolean(info.private_api));
  }

  setLoadingChats(loading: boolean): void {
    this.state.loadingChats = loading;
    this.stateApi.set('loadingChats', loading);
  }

  setLoadingMessages(loading: boolean): void {
    this.state.loadingMessages = loading;
    this.stateApi.set('loadingMessages', loading);
  }

  setSendingMessage(sending: boolean): void {
    this.state.sendingMessage = sending;
    this.stateApi.set('sendingMessage', sending);
  }

  setChats(chats: NormalizedChat[]): void {
    this.state.chats = chats;
    this.state.unreadTotal = chats.reduce((sum, c) => sum + c.unreadCount, 0);
    this.stateApi.set('chats', chats);
    this.stateApi.set('unreadTotal', this.state.unreadTotal);
    this.updateBadge();
  }

  setActiveChatGuid(guid: string | null): void {
    this.state.activeChatGuid = guid;
    this.stateApi.set('activeChatGuid', guid);
  }

  setActiveChatMessages(messages: NormalizedMessage[]): void {
    this.state.activeChatMessages = messages;
    this.stateApi.set('activeChatMessages', messages);
  }

  addIncomingMessage(message: NormalizedMessage): void {
    if (message.chatGuid === this.state.activeChatGuid) {
      const exists = this.state.activeChatMessages.some((m) => m.guid === message.guid);
      if (!exists) {
        this.state.activeChatMessages = [...this.state.activeChatMessages, message];
        this.stateApi.set('activeChatMessages', this.state.activeChatMessages);
      }
    }

    this.updateChatWithMessage(message);

    if (!message.isFromMe && this.notificationsEnabled && message.chatGuid !== this.state.activeChatGuid) {
      const chat = this.state.chats.find((c) => c.guid === message.chatGuid);
      this.notificationsApi.show({
        id: `msg-${message.guid}`,
        title: chat?.displayName ?? message.senderName,
        body: message.text || '[Attachment]',
        level: 'info',
        native: true,
        autoDismissMs: 5000,
        target: { type: 'panel', panelId: 'messages' },
      });

      // Pre-select the chat so clicking the notification opens it directly
      if (!this.state.activeChatGuid || this.state.activeChatGuid !== message.chatGuid) {
        this.state.pendingChatGuid = message.chatGuid;
        this.stateApi.set('pendingChatGuid', message.chatGuid);
      }
    }
  }

  updateMessage(message: NormalizedMessage): void {
    const idx = this.state.activeChatMessages.findIndex((m) => m.guid === message.guid);
    if (idx >= 0) {
      this.state.activeChatMessages[idx] = message;
      this.state.activeChatMessages = [...this.state.activeChatMessages];
      this.stateApi.set('activeChatMessages', this.state.activeChatMessages);
    }
  }

  setTypingIndicator(chatGuid: string, isTyping: boolean): void {
    this.state.typingIndicators = {
      ...this.state.typingIndicators,
      [chatGuid]: isTyping,
    };
    this.stateApi.set('typingIndicators', this.state.typingIndicators);
  }

  addReaction(targetMessageGuid: string, reaction: NormalizedReaction): void {
    const idx = this.state.activeChatMessages.findIndex((m) => m.guid === targetMessageGuid);
    if (idx < 0) return;
    const msg = { ...this.state.activeChatMessages[idx] };
    const existing = msg.reactions.findIndex(
      (r) => r.type === reaction.type && r.sender === reaction.sender,
    );
    if (existing >= 0) return;
    msg.reactions = [...msg.reactions, reaction];
    this.state.activeChatMessages[idx] = msg;
    this.state.activeChatMessages = [...this.state.activeChatMessages];
    this.stateApi.set('activeChatMessages', this.state.activeChatMessages);
  }

  removeReaction(targetMessageGuid: string, reaction: NormalizedReaction): void {
    const idx = this.state.activeChatMessages.findIndex((m) => m.guid === targetMessageGuid);
    if (idx < 0) return;
    const msg = { ...this.state.activeChatMessages[idx] };
    msg.reactions = msg.reactions.filter(
      (r) => !(r.type === reaction.type && r.sender === reaction.sender),
    );
    this.state.activeChatMessages[idx] = msg;
    this.state.activeChatMessages = [...this.state.activeChatMessages];
    this.stateApi.set('activeChatMessages', this.state.activeChatMessages);
  }

  setContacts(contacts: Record<string, string>): void {
    this.state.contacts = contacts;
    this.stateApi.set('contacts', contacts);
  }

  setAIReplyProcessing(chatGuid: string, processing: boolean): void {
    this.state.aiReplyProcessing = {
      ...this.state.aiReplyProcessing,
      [chatGuid]: processing,
    };
    this.stateApi.set('aiReplyProcessing', this.state.aiReplyProcessing);
  }

  clearPendingChat(): void {
    this.state.pendingChatGuid = null;
    this.stateApi.set('pendingChatGuid', null);
  }

  private updateChatWithMessage(message: NormalizedMessage): void {
    const chatIdx = this.state.chats.findIndex((c) => c.guid === message.chatGuid);
    if (chatIdx >= 0) {
      const chat = { ...this.state.chats[chatIdx] };
      chat.lastMessage = message.text || '[Attachment]';
      chat.lastMessageDate = message.date;
      if (!message.isFromMe && message.chatGuid !== this.state.activeChatGuid) {
        chat.unreadCount += 1;
      }
      this.state.chats[chatIdx] = chat;
      this.state.chats = [...this.state.chats].sort((a, b) => b.lastMessageDate - a.lastMessageDate);
      this.state.unreadTotal = this.state.chats.reduce((sum, c) => sum + c.unreadCount, 0);
      this.stateApi.set('chats', this.state.chats);
      this.stateApi.set('unreadTotal', this.state.unreadTotal);
      this.updateBadge();
    }
  }

  markChatRead(chatGuid: string): void {
    const chatIdx = this.state.chats.findIndex((c) => c.guid === chatGuid);
    if (chatIdx >= 0 && this.state.chats[chatIdx].unreadCount > 0) {
      this.state.chats[chatIdx] = { ...this.state.chats[chatIdx], unreadCount: 0 };
      this.state.chats = [...this.state.chats];
      this.state.unreadTotal = this.state.chats.reduce((sum, c) => sum + c.unreadCount, 0);
      this.stateApi.set('chats', this.state.chats);
      this.stateApi.set('unreadTotal', this.state.unreadTotal);
      this.updateBadge();
    }
  }

  private updateBadge(): void {
    const badge = this.state.unreadTotal > 0 ? this.state.unreadTotal : undefined;
    this.uiApi.registerNavigationItem({
      id: NAV_ID,
      label: 'Messages',
      icon: { svg: MESSAGE_BUBBLE_ICON_SVG },
      visible: true,
      priority: 10,
      badge,
      target: { type: 'panel', panelId: 'messages' },
    });
  }

  private pushFullState(): void {
    this.stateApi.replace(this.state as unknown as Record<string, unknown>);
  }
}
