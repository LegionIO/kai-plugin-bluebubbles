import { DEFAULT_MAX_HISTORY_PER_CHAT } from '../shared/constants.js';
export class ChatHistoryManager {
    histories;
    configApi;
    maxPerChat;
    constructor(configApi, maxPerChat) {
        this.configApi = configApi;
        this.maxPerChat = maxPerChat ?? DEFAULT_MAX_HISTORY_PER_CHAT;
        const data = configApi.getPluginData();
        this.histories = data.chatHistories ?? {};
    }
    setMaxPerChat(max) {
        this.maxPerChat = max;
    }
    getHistory(chatGuid) {
        return this.histories[chatGuid] ?? [];
    }
    appendMessage(chatGuid, msg) {
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
    clearHistory(chatGuid) {
        delete this.histories[chatGuid];
        this.persist();
    }
    toAgentMessages(chatGuid) {
        const history = this.getHistory(chatGuid);
        return history.map((msg) => {
            let text = msg.senderName && msg.role === 'user'
                ? `[${msg.senderName}] ${msg.content}`
                : msg.content;
            const imageCount = (msg.attachments ?? []).filter((a) => a.mimeType.startsWith('image/')).length;
            if (imageCount > 0 && !text.includes('[Image')) {
                text += ` [${imageCount} image${imageCount > 1 ? 's' : ''} attached]`;
            }
            return { role: msg.role, content: text };
        });
    }
    reload() {
        const data = this.configApi.getPluginData();
        this.histories = data.chatHistories ?? {};
    }
    trim(chatGuid) {
        const history = this.histories[chatGuid];
        if (history && history.length > this.maxPerChat) {
            this.histories[chatGuid] = history.slice(-this.maxPerChat);
        }
    }
    persist() {
        this.configApi.setPluginData('chatHistories', { ...this.histories });
    }
}
