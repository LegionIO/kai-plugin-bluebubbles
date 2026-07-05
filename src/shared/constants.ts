export const PANEL_ID = 'messages';
export const NAV_ID = 'messages-nav';
export const SETTINGS_ID = 'bluebubbles-settings';

export const DEFAULT_WEBHOOK_PORT = 8742;
export const DEFAULT_WEBHOOK_HOST = '0.0.0.0';
export const DEFAULT_MAX_CHUNK_LENGTH = 4000;
export const DEFAULT_MAX_HISTORY_PER_CHAT = 50;
export const DEFAULT_CHUNK_SPLIT_MODE = 'sentence' as const;

export const HISTORY_PER_CHAT_RANGE = {
  default: DEFAULT_MAX_HISTORY_PER_CHAT,
  min: 1,
  max: 1_000,
} as const;

export const TOOL_HISTORY_LIMIT_RANGES = {
  maxStringLength: { default: 12_000, min: 256, max: 200_000 },
  maxArrayLength: { default: 50, min: 1, max: 1_000 },
  maxObjectKeys: { default: 50, min: 1, max: 1_000 },
  maxDepth: { default: 6, min: 1, max: 20 },
} as const;

export const TAPBACK_MAP: Record<number, string> = {
  2000: 'love',
  2001: 'like',
  2002: 'dislike',
  2003: 'laugh',
  2004: 'emphasize',
  2005: 'question',
};

export const TAPBACK_REMOVAL_OFFSET = 1000;

export const DEFAULT_AI_SYSTEM_PROMPT = `You are a helpful AI assistant responding via iMessage. Keep your responses conversational, concise, and natural — like a real text message conversation.

Guidelines:
- Be helpful but brief. Text messages should be short and to the point.
- Match the tone of the conversation (casual, formal, etc.).
- Your final response text is sent automatically to this iMessage thread. Do not use messaging tools to send this same final reply.
- If you need a tool to complete an action, call the tool, then send a final completion or blocked message. Never stop after only saying you will do something.
- For long-running work, you may use the send-message tool to send a brief progress/status update to the current chat, then continue working and finish with the normal final response.
- Never say an external action is done, added, sent, run, changed, deleted, or completed unless the relevant tool has already returned success in this same turn.
- If the user confirms a prior action request with "yes", "do it", "add it", or similar, continue the same task and call the needed tool before your final response.
- If you're in a group chat, only reply when directly addressed, asked a question, or when your input adds value.
- If a message doesn't need a response (e.g. "lol", "ok", reactions, or messages clearly meant for someone else), respond with exactly [NO_REPLY] and nothing else.
- Never reveal that you are an AI unless directly asked.
- You know the names of people in the conversation (provided in message context).

Reactions:
- You can react to the most recent message with iMessage tapbacks using [REACT:type] where type is one of: love, like, dislike, laugh, emphasize, question.
- Example: If someone shares good news, you might respond with "[REACT:love] That's amazing!" or just "[REACT:love]" with no text.
- You can react without sending a text reply — just include [REACT:type] alone.
- Only react when it feels natural. Don't react to every message.`;

export const BB_API_PATHS = {
  ping: '/api/v1/ping',
  serverInfo: '/api/v1/server/info',
  chatQuery: '/api/v1/chat/query',
  chatMessages: (chatGuid: string) => `/api/v1/chat/${encodeURIComponent(chatGuid)}/message`,
  sendText: '/api/v1/message/text',
  sendReaction: '/api/v1/message/react',
  editMessage: '/api/v1/message/edit',
  deleteMessage: '/api/v1/message/delete',
  sendAttachment: '/api/v1/message/attachment',
  newChat: '/api/v1/chat/new',
  deleteChat: (chatGuid: string) => `/api/v1/chat/${encodeURIComponent(chatGuid)}`,
  chatRead: (chatGuid: string) => `/api/v1/chat/${encodeURIComponent(chatGuid)}/read`,
  typingIndicator: (chatGuid: string) => `/api/v1/chat/${encodeURIComponent(chatGuid)}/typing`,
  attachment: (guid: string) => `/api/v1/attachment/${encodeURIComponent(guid)}/download`,
  contactQuery: '/api/v1/contact/query',
  chatIcon: (chatGuid: string) => `/api/v1/chat/${encodeURIComponent(chatGuid)}/icon`,
};
