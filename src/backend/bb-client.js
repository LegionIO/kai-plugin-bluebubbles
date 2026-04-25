import { BB_API_PATHS } from '../shared/constants.js';
export class BlueBubblesClient {
    serverUrl;
    password;
    fetchFn;
    constructor(config, fetchFn) {
        this.serverUrl = (config.serverUrl ?? '').replace(/\/+$/, '');
        this.password = config.password ?? '';
        this.fetchFn = fetchFn;
    }
    updateConfig(config) {
        this.serverUrl = (config.serverUrl ?? '').replace(/\/+$/, '');
        this.password = config.password ?? '';
    }
    url(path, extraParams) {
        const params = new URLSearchParams({ password: this.password, ...extraParams });
        return `${this.serverUrl}${path}?${params.toString()}`;
    }
    async get(path) {
        const res = await this.fetchFn(this.url(path));
        if (!res.ok)
            throw new Error(`BB API ${path}: ${res.status} ${res.statusText}`);
        const json = await res.json();
        return json.data;
    }
    async post(path, body) {
        const res = await this.fetchFn(this.url(path), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(`BB API ${path}: ${res.status} ${res.statusText}`);
        const json = await res.json();
        return json.data;
    }
    async ping() {
        try {
            await this.get(BB_API_PATHS.ping);
            return true;
        }
        catch {
            return false;
        }
    }
    async getServerInfo() {
        return this.get(BB_API_PATHS.serverInfo);
    }
    async queryChats(limit = 50, offset = 0) {
        return this.post(BB_API_PATHS.chatQuery, {
            limit,
            offset,
            with: ['participants', 'lastMessage'],
            sort: 'lastmessage',
        });
    }
    async getChatMessages(chatGuid, limit = 50, offset = 0) {
        const path = BB_API_PATHS.chatMessages(chatGuid);
        const params = new URLSearchParams({
            password: this.password,
            limit: String(limit),
            offset: String(offset),
            sort: 'DESC',
            with: 'attachment',
        });
        const res = await this.fetchFn(`${this.serverUrl}${path}?${params.toString()}`);
        if (!res.ok)
            throw new Error(`BB API ${path}: ${res.status} ${res.statusText}`);
        const json = await res.json();
        return json.data;
    }
    async sendText(chatGuid, message, options) {
        return this.post(BB_API_PATHS.sendText, {
            chatGuid,
            message,
            tempGuid: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            ...(options?.replyToGuid ? { selectedMessageGuid: options.replyToGuid } : {}),
            ...(options?.effectId ? { effectId: options.effectId } : {}),
        });
    }
    async sendChunkedText(chatGuid, text, maxChunk, options) {
        if (text.length <= maxChunk) {
            return [await this.sendText(chatGuid, text, options)];
        }
        const chunks = [];
        let remaining = text;
        while (remaining.length > 0) {
            if (remaining.length <= maxChunk) {
                chunks.push(remaining);
                break;
            }
            let splitAt = remaining.lastIndexOf('\n', maxChunk);
            if (splitAt <= 0)
                splitAt = maxChunk;
            chunks.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).replace(/^\n/, '');
        }
        const results = [];
        for (let i = 0; i < chunks.length; i++) {
            results.push(await this.sendText(chatGuid, chunks[i], i === 0 ? options : undefined));
        }
        return results;
    }
    async sendReaction(chatGuid, messageGuid, reaction, partIndex = 0) {
        return this.post(BB_API_PATHS.sendReaction, {
            chatGuid,
            selectedMessageGuid: messageGuid,
            reaction,
            partIndex,
        });
    }
    async editMessage(chatGuid, messageGuid, newText) {
        return this.post(BB_API_PATHS.editMessage, {
            chatGuid,
            messageGuid,
            editedMessage: newText,
            backwardsCompatibilityMessage: newText,
            partIndex: 0,
        });
    }
    async unsendMessage(chatGuid, messageGuid) {
        return this.post(BB_API_PATHS.deleteMessage, {
            chatGuid,
            messageGuid,
            partIndex: 0,
        });
    }
    async createChat(addresses, message) {
        return this.post(BB_API_PATHS.newChat, {
            addresses,
            ...(message ? { message } : {}),
            tempGuid: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
    }
    async deleteChat(chatGuid) {
        const path = BB_API_PATHS.deleteChat(chatGuid);
        await this.fetchFn(this.url(path), { method: 'DELETE' });
    }
    async sendAttachment(chatGuid, filePath, filename, mimeType) {
        const { readFileSync } = await import('fs');
        const fileData = readFileSync(filePath);
        const blob = new Blob([fileData], { type: mimeType });
        const formData = new FormData();
        formData.append('chatGuid', chatGuid);
        formData.append('name', filename);
        formData.append('attachment', blob, filename);
        formData.append('tempGuid', `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        const res = await this.fetchFn(this.url(BB_API_PATHS.sendAttachment), {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`BB sendAttachment: ${res.status} ${res.statusText} - ${body}`);
        }
        return res.json();
    }
    async sendTypingIndicator(chatGuid) {
        const path = BB_API_PATHS.typingIndicator(chatGuid);
        const fullUrl = this.url(path);
        const res = await this.fetchFn(fullUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const body = await res.text().catch(() => '');
        if (!res.ok) {
            throw new Error(`Typing indicator: ${res.status} ${res.statusText} - ${body}`);
        }
    }
    async markChatRead(chatGuid) {
        const path = BB_API_PATHS.chatRead(chatGuid);
        await this.fetchFn(this.url(path), { method: 'POST' });
    }
    getAttachmentUrl(guid) {
        return this.url(BB_API_PATHS.attachment(guid));
    }
    async fetchAttachmentAsBase64(guid) {
        try {
            const url = this.getAttachmentUrl(guid);
            const res = await this.fetchFn(url);
            if (!res.ok)
                return null;
            const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
            const buffer = Buffer.from(await res.arrayBuffer());
            return { base64: buffer.toString('base64'), mimeType: contentType };
        }
        catch {
            return null;
        }
    }
}
