/* ── BlueBubbles API response types ── */

export type BBHandle = {
  originalROWID?: number;
  address: string;
  country?: string;
  uncanonicalizedId?: string;
};

export type BBParticipant = {
  address: string;
  displayName?: string;
};

export type BBAttachment = {
  originalROWID?: number;
  guid?: string;
  uti?: string;
  mimeType?: string;
  transferName?: string;
  totalBytes?: number;
  height?: number;
  width?: number;
  isOutgoing?: boolean;
};

export type BBMessage = {
  originalROWID?: number;
  guid: string;
  text?: string | null;
  subject?: string | null;
  handle?: BBHandle | null;
  handleId?: number;
  chats?: BBChat[];
  attachments?: BBAttachment[];
  associatedMessageGuid?: string | null;
  associatedMessageType?: number | string | null;
  isFromMe: boolean;
  isArchived?: boolean;
  dateCreated?: number;
  dateRead?: number | null;
  dateDelivered?: number | null;
  dateEdited?: number | null;
  dateRetracted?: number | null;
  isDelivered?: boolean;
  isRead?: boolean;
  hasDdResults?: boolean;
  error?: number;
  expressiveSendStyleId?: string | null;
  threadOriginatorGuid?: string | null;
  threadOriginatorPart?: string | null;
  partCount?: number;
  groupTitle?: string | null;
  groupActionType?: number;
  itemType?: number;
};

export type BBChat = {
  originalROWID?: number;
  guid: string;
  chatIdentifier?: string;
  displayName?: string | null;
  participants?: BBParticipant[];
  lastMessage?: BBMessage | null;
  style?: number;
  isArchived?: boolean;
  isFiltered?: boolean;
  isPinned?: boolean;
  hasUnreadMessages?: boolean;
};

export type BBServerInfo = {
  os_version?: string;
  server_version?: string;
  private_api?: boolean;
  helper_connected?: boolean;
  proxy_service?: string;
  detected_icloud?: string;
};

/* ── Normalized types for UI ── */

export type NormalizedParticipant = {
  address: string;
  displayName: string;
};

export type NormalizedAttachment = {
  guid: string;
  mimeType: string;
  filename: string;
  totalBytes: number;
  width?: number;
  height?: number;
  downloadUrl: string;
};

export type NormalizedReaction = {
  type: ReactionType;
  sender: string;
  isFromMe: boolean;
};

export type ToolCallInfo = {
  toolName: string;
  args: unknown;
  result: unknown;
  error?: string;
  durationMs?: number;
};

export type NormalizedMessage = {
  guid: string;
  chatGuid: string;
  sender: string;
  senderName: string;
  text: string;
  date: number;
  isFromMe: boolean;
  attachments: NormalizedAttachment[];
  reactions: NormalizedReaction[];
  replyToGuid: string | null;
  isEdited: boolean;
  isUnsent: boolean;
  effectId: string | null;
  isDelivered: boolean;
  isRead: boolean;
  error: number;
  toolCalls?: ToolCallInfo[];
};

export type NormalizedChat = {
  guid: string;
  displayName: string;
  participants: NormalizedParticipant[];
  lastMessage: string;
  lastMessageDate: number;
  unreadCount: number;
  isGroup: boolean;
  service: 'iMessage' | 'SMS';
};

export type ReactionType = 'love' | 'like' | 'dislike' | 'laugh' | 'emphasize' | 'question';

/* ── Plugin state shape (main -> renderer) ── */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type BlueBubblesPluginState = {
  connectionStatus: ConnectionStatus;
  serverInfo: BBServerInfo | null;
  privateApiEnabled: boolean;
  chats: NormalizedChat[];
  activeChatGuid: string | null;
  activeChatMessages: NormalizedMessage[];
  sendingMessage: boolean;
  loadingChats: boolean;
  loadingMessages: boolean;
  typingIndicators: Record<string, boolean>;
  error: string | null;
  unreadTotal: number;
  contacts: Record<string, string>;
  aiReplyProcessing: Record<string, boolean>;
  pendingChatGuid: string | null;
};

/* ── Plugin config shape ── */

export type AIReplyConfig = {
  enabled: boolean;
  systemPrompt: string;
  dmBehavior: 'smart' | 'always' | 'never';
  groupBehavior: 'smart' | 'always' | 'never' | 'mentioned';
  maxHistoryPerChat: number;
  modelOverride?: string;
  profileOverride?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  fallbackEnabled?: boolean;
};

export type ThreadSettings = {
  modelOverride?: string;
  profileOverride?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  systemPrompt?: string;
  fallbackEnabled?: boolean;
  showToolCalls?: boolean;
};

export type ChunkConfig = {
  maxLength: number;
  splitMode: 'sentence' | 'word' | 'newline' | 'anywhere';
};

export type ConversationMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  senderName?: string;
  timestamp: number;
};

export type BlueBubblesPluginConfig = {
  serverUrl?: string;
  password?: string;
  webhookPort?: number;
  webhookHost?: string;
  webhookSecret?: string;
  notifications?: boolean;
  aiReply?: AIReplyConfig;
  chunking?: ChunkConfig;
  contacts?: Record<string, string>;
  chatHistories?: Record<string, ConversationMessage[]>;
  threadSettings?: Record<string, ThreadSettings>;
};

/* ── Webhook event types ── */

export type BBWebhookEvent = {
  type: string;
  data: unknown;
};

export type BBWebhookNewMessage = {
  type: 'new-message';
  data: BBMessage;
};

export type BBWebhookUpdatedMessage = {
  type: 'updated-message';
  data: BBMessage;
};

export type BBWebhookTypingIndicator = {
  type: 'typing-indicator';
  data: {
    display: boolean;
    guid: string;
  };
};

export type BBWebhookGroupNameChange = {
  type: 'group-name-change';
  data: {
    chatGuid: string;
    newName: string;
  };
};
