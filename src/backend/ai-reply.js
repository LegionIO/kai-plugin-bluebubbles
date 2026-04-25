import { chunkText } from './chunker.js';
import { DEFAULT_AI_SYSTEM_PROMPT } from '../shared/constants.js';
export class AIReplyEngine {
    agent;
    client;
    contacts;
    history;
    config;
    chunkConfig;
    log;
    stateCallback;
    getThreadSettings;
    recentReplies = new Map();
    debounceMs = 10_000;
    constructor(options) {
        this.agent = options.agent;
        this.client = options.client;
        this.contacts = options.contacts;
        this.history = options.history;
        this.config = options.config;
        this.chunkConfig = options.chunkConfig;
        this.log = options.log;
        this.stateCallback = options.stateCallback;
        this.getThreadSettings = options.getThreadSettings ?? (() => undefined);
    }
    updateConfig(config) {
        this.config = config;
    }
    updateChunkConfig(config) {
        this.chunkConfig = config;
    }
    async handleMessage(msg, chat) {
        if (!this.config.enabled)
            return;
        if (msg.isFromMe)
            return;
        const chatGuid = msg.chats?.[0]?.guid ?? '';
        if (!chatGuid)
            return;
        const isGroup = chatGuid.includes(';+;');
        const senderAddress = msg.handle?.address ?? '';
        if (!senderAddress)
            return;
        const senderName = this.contacts.resolve(senderAddress);
        const messageText = msg.text ?? '';
        const imageAttachments = (msg.attachments ?? [])
            .filter((a) => a.guid && a.mimeType?.startsWith('image/'));
        if (!messageText.trim() && imageAttachments.length === 0)
            return;
        // Check behavior config
        const behavior = isGroup ? this.config.groupBehavior : this.config.dmBehavior;
        if (behavior === 'never')
            return;
        // Append incoming message to history regardless of debounce
        const attachmentMeta = imageAttachments.map((a) => ({
            url: this.client.getAttachmentUrl(a.guid),
            mimeType: a.mimeType,
        }));
        this.history.appendMessage(chatGuid, {
            role: 'user',
            content: messageText || (imageAttachments.length > 0 ? '[Image]' : ''),
            senderName,
            ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
        });
        // Debounce per chat — skip AI generation but message is still in history
        const lastReply = this.recentReplies.get(chatGuid) ?? 0;
        if (Date.now() - lastReply < this.debounceMs) {
            this.log.info(`Debounced AI reply for ${chatGuid} (${Date.now() - lastReply}ms since last)`);
            return;
        }
        // For 'mentioned' mode, check if our name/keyword is in the message
        if (behavior === 'mentioned') {
            // TODO: allow configurable trigger words
            const lowerText = messageText.toLowerCase();
            const mentioned = lowerText.includes('ai') || lowerText.includes('assistant') || lowerText.includes('kai');
            if (!mentioned)
                return;
        }
        this.stateCallback.setAIReplyProcessing(chatGuid, true);
        // Send typing indicator while AI is thinking
        let typingInterval = null;
        const startTyping = () => {
            this.client.sendTypingIndicator(chatGuid).catch(() => { });
            typingInterval = setInterval(() => {
                this.client.sendTypingIndicator(chatGuid).catch(() => { });
            }, 10_000);
        };
        try {
            // Mark chat as read
            this.client.markChatRead(chatGuid).catch(() => { });
            startTyping();
            const threadSettings = this.getThreadSettings(chatGuid);
            const systemPrompt = threadSettings?.systemPrompt || this.buildSystemPrompt(isGroup, chat);
            const messages = this.history.toAgentMessages(chatGuid);
            // For the current message, fetch image data and inject as multimodal content
            if (imageAttachments.length > 0 && messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                const parts = [];
                const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
                if (textContent) {
                    parts.push({ type: 'text', text: textContent });
                }
                for (const att of imageAttachments) {
                    try {
                        const imageData = await this.client.fetchAttachmentAsBase64(att.guid);
                        if (imageData) {
                            parts.push({
                                type: 'image',
                                image: Buffer.from(imageData.base64, 'base64'),
                                mimeType: imageData.mimeType,
                            });
                        }
                    }
                    catch (err) {
                        this.log.warn(`Failed to fetch attachment ${att.guid}:`, err);
                    }
                }
                if (parts.length > 0) {
                    messages[messages.length - 1] = { ...lastMsg, content: parts };
                }
            }
            this.log.info(`AI generating reply for ${chatGuid} (${messages.length} messages in context)`);
            const result = await this.agent.generate({
                messages,
                systemPrompt,
                modelKey: threadSettings?.modelOverride ?? this.config.modelOverride,
                profileKey: threadSettings?.profileOverride ?? this.config.profileOverride,
                reasoningEffort: threadSettings?.reasoningEffort ?? this.config.reasoningEffort,
                fallbackEnabled: threadSettings?.fallbackEnabled ?? this.config.fallbackEnabled,
                tools: true,
            });
            // Stop typing before sending reply
            if (typingInterval) {
                clearInterval(typingInterval);
                typingInterval = null;
            }
            let responseText = result.text.trim();
            if (!responseText || responseText === '[NO_REPLY]' || responseText.includes('[NO_REPLY]')) {
                this.log.info(`AI decided not to reply in ${chatGuid}`);
                return;
            }
            // Extract and handle reaction instructions [REACT:type]
            const reactPattern = /\[REACT:(\w+)\]/gi;
            const reactions = [];
            let reactMatch;
            while ((reactMatch = reactPattern.exec(responseText)) !== null) {
                reactions.push(reactMatch[1].toLowerCase());
            }
            responseText = responseText.replace(reactPattern, '').trim();
            // Send reactions to the last received message
            if (reactions.length > 0 && msg.guid) {
                for (const reactionType of reactions) {
                    const validTypes = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'];
                    if (validTypes.includes(reactionType)) {
                        try {
                            await this.client.sendReaction(chatGuid, msg.guid, reactionType);
                            this.log.info(`AI reacted with ${reactionType} to ${msg.guid}`);
                        }
                        catch (err) {
                            this.log.warn(`AI reaction failed:`, err);
                        }
                    }
                }
            }
            // If only reactions and no text remaining, we're done
            if (!responseText || responseText === '[NO_REPLY]') {
                return;
            }
            // Extract and send media attachments (kai-media:// URLs in markdown image syntax)
            const mediaPattern = /!\[([^\]]*)\]\((kai-media:\/\/[^)]+)\)/g;
            const mediaMatches = [];
            let mediaMatch;
            while ((mediaMatch = mediaPattern.exec(responseText)) !== null) {
                mediaMatches.push({ full: mediaMatch[0], alt: mediaMatch[1], url: mediaMatch[2] });
            }
            if (mediaMatches.length > 0) {
                const { existsSync } = await import('fs');
                const { join, basename, extname } = await import('path');
                const { homedir } = await import('os');
                for (const media of mediaMatches) {
                    try {
                        // Resolve kai-media://images/file.png -> ~/.kai/media/images/file.png
                        const relativePath = media.url.replace(/^kai-media:\/\//, '');
                        const appHome = join(homedir(), '.kai');
                        const filePath = join(appHome, 'media', relativePath);
                        if (existsSync(filePath)) {
                            const filename = basename(filePath);
                            const ext = extname(filename).toLowerCase();
                            const mimeMap = {
                                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                                '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
                            };
                            const mimeType = mimeMap[ext] ?? 'application/octet-stream';
                            const result = await this.client.sendAttachment(chatGuid, filePath, filename, mimeType);
                            this.log.info(`Sent attachment: ${filename} to ${chatGuid}`);
                            // Push a synthetic message to the UI so the image shows immediately
                            if (this.stateCallback.onMessageSent && result) {
                                const bbMsg = result.data ?? result;
                                if (bbMsg?.guid) {
                                    this.stateCallback.onMessageSent(chatGuid, bbMsg);
                                }
                            }
                        }
                        else {
                            this.log.warn(`Media file not found: ${filePath}`);
                        }
                    }
                    catch (err) {
                        this.log.error(`Failed to send attachment:`, err);
                    }
                }
                // Strip markdown image syntax from text
                responseText = responseText.replace(mediaPattern, '').trim();
            }
            // If only media was sent and no text remains, we're done
            if (!responseText || responseText === '[NO_REPLY]') {
                this.recentReplies.set(chatGuid, Date.now());
                this.history.appendMessage(chatGuid, {
                    role: 'assistant',
                    content: result.text.trim(),
                });
                return;
            }
            // Chunk and send text
            const chunks = chunkText(responseText, this.chunkConfig);
            this.recentReplies.set(chatGuid, Date.now());
            for (let i = 0; i < chunks.length; i++) {
                const sentMsg = await this.client.sendText(chatGuid, chunks[i]);
                if (this.stateCallback.onMessageSent) {
                    this.stateCallback.onMessageSent(chatGuid, sentMsg, i === 0 ? result.toolCalls : undefined);
                }
            }
            // Record in history
            this.history.appendMessage(chatGuid, {
                role: 'assistant',
                content: responseText,
            });
            this.log.info(`AI replied in ${chatGuid}: ${responseText.slice(0, 100)}...`);
        }
        catch (err) {
            this.log.error(`AI reply failed for ${chatGuid}:`, err);
        }
        finally {
            if (typingInterval) {
                clearInterval(typingInterval);
                typingInterval = null;
            }
            this.stateCallback.setAIReplyProcessing(chatGuid, false);
        }
    }
    buildSystemPrompt(isGroup, chat) {
        const base = this.config.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT;
        const parts = [base];
        if (chat) {
            parts.push('');
            parts.push(`Chat: ${chat.displayName}`);
            parts.push(`Service: ${chat.service}`);
            parts.push(`Type: ${isGroup ? 'Group chat' : 'Direct message'}`);
            if (chat.participants.length > 0) {
                const names = chat.participants.map((p) => {
                    const saved = this.contacts.get(p.address);
                    return saved ? `${saved} (${p.address})` : p.displayName || p.address;
                });
                parts.push(`Participants: ${names.join(', ')}`);
            }
        }
        if (isGroup && this.config.groupBehavior === 'smart') {
            parts.push('');
            parts.push('IMPORTANT: You are in a group chat. Only reply if directly addressed, asked a question, or your input is genuinely valuable. Otherwise respond with [NO_REPLY].');
        }
        if (!isGroup && this.config.dmBehavior === 'always') {
            parts.push('');
            parts.push('This is a direct message. Always provide a helpful response. Do NOT use [NO_REPLY] in DMs.');
        }
        return parts.join('\n');
    }
}
