export const PANEL_ID = 'messages';
export const NAV_ID = 'messages-nav';
export const SETTINGS_ID = 'bluebubbles-settings';
export const DEFAULT_WEBHOOK_PORT = 8742;
export const DEFAULT_WEBHOOK_HOST = '0.0.0.0';
export const DEFAULT_MAX_CHUNK_LENGTH = 4000;
export const DEFAULT_MAX_HISTORY_PER_CHAT = 50;
export const DEFAULT_CHUNK_SPLIT_MODE = 'sentence';
export const TAPBACK_MAP = {
    2000: 'love',
    2001: 'like',
    2002: 'dislike',
    2003: 'laugh',
    2004: 'emphasize',
    2005: 'question',
};
export const TAPBACK_REMOVAL_OFFSET = 1000;
export const MESSAGE_BUBBLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(24,0) scale(-1,1)"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></g></svg>`;
export const DEFAULT_AI_SYSTEM_PROMPT = `You are a helpful AI assistant responding via iMessage. Keep your responses conversational, concise, and natural — like a real text message conversation.

Guidelines:
- Be helpful but brief. Text messages should be short and to the point.
- Match the tone of the conversation (casual, formal, etc.).
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
    chatMessages: (chatGuid) => `/api/v1/chat/${encodeURIComponent(chatGuid)}/message`,
    sendText: '/api/v1/message/text',
    sendReaction: '/api/v1/message/react',
    editMessage: '/api/v1/message/edit',
    deleteMessage: '/api/v1/message/delete',
    sendAttachment: '/api/v1/message/attachment',
    newChat: '/api/v1/chat/new',
    deleteChat: (chatGuid) => `/api/v1/chat/${encodeURIComponent(chatGuid)}`,
    chatRead: (chatGuid) => `/api/v1/chat/${encodeURIComponent(chatGuid)}/read`,
    typingIndicator: (chatGuid) => `/api/v1/chat/${encodeURIComponent(chatGuid)}/typing`,
    attachment: (guid) => `/api/v1/attachment/${encodeURIComponent(guid)}/download`,
};
