import { normalizeChat, normalizeMessage } from './message-normalizer.js';
import { processMessagesWithReactions } from './reaction-utils.js';
function requireClient(deps) {
    const client = deps.getClient();
    if (!client) {
        throw new Error('BlueBubbles is not connected. Configure the server URL and password in BlueBubbles settings, then reconnect.');
    }
    return client;
}
export function buildBlueBubblesTools(deps) {
    return [
        {
            name: 'list-contacts',
            description: 'List all saved contacts in the BlueBubbles address book. Returns a mapping of phone numbers/email addresses to display names. Use this to find a person\'s address before sending them a message.',
            inputSchema: {
                type: 'object',
                properties: {
                    search: {
                        type: 'string',
                        description: 'Optional search term to filter contacts by name or address',
                    },
                },
            },
            execute: async (input) => {
                try {
                    const contacts = deps.getContacts();
                    if (!contacts)
                        return { error: 'Contacts not initialized' };
                    const data = input;
                    const all = contacts.getAll();
                    if (data?.search) {
                        const term = String(data.search).toLowerCase();
                        const filtered = {};
                        for (const [address, name] of Object.entries(all)) {
                            if (address.toLowerCase().includes(term) || name.toLowerCase().includes(term)) {
                                filtered[address] = name;
                            }
                        }
                        return { contacts: filtered, count: Object.keys(filtered).length };
                    }
                    return { contacts: all, count: Object.keys(all).length };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool list-contacts failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'save-contact',
            description: 'Save or update a contact name for a phone number or email address. This maps an address to a friendly display name used throughout the messaging interface.',
            inputSchema: {
                type: 'object',
                properties: {
                    address: {
                        type: 'string',
                        description: 'Phone number (e.g. +15551234567) or email address',
                    },
                    name: {
                        type: 'string',
                        description: 'Display name for this contact',
                    },
                },
                required: ['address', 'name'],
            },
            execute: async (input) => {
                try {
                    const contacts = deps.getContacts();
                    const stateManager = deps.getStateManager();
                    if (!contacts)
                        return { error: 'Contacts not initialized' };
                    const data = input;
                    contacts.set(data.address, data.name);
                    stateManager?.setContacts(contacts.getAll());
                    await deps.loadChats();
                    return { success: true, address: data.address, name: data.name };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool save-contact failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'list-chats',
            description: 'List recent iMessage and SMS conversations. Returns chats sorted by most recent activity, including participant names, last message preview, and unread status. Use this to find a specific conversation before fetching its messages or sending a reply.',
            inputSchema: {
                type: 'object',
                properties: {
                    limit: {
                        type: 'number',
                        description: 'Maximum number of chats to return (default: 50, max: 100)',
                    },
                    search: {
                        type: 'string',
                        description: 'Optional search term to filter chats by participant name or display name',
                    },
                },
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const contacts = deps.getContacts();
                    const data = (input ?? {});
                    const limit = Math.min(Number(data.limit) || 50, 100);
                    const bbChats = await client.queryChats(limit, 0);
                    let chats = bbChats.map((c) => normalizeChat(c, contacts ? (addr) => contacts.resolve(addr) : undefined));
                    if (data.search) {
                        const term = String(data.search).toLowerCase();
                        chats = chats.filter((c) => c.displayName.toLowerCase().includes(term) ||
                            c.participants.some((p) => p.displayName.toLowerCase().includes(term) ||
                                p.address.toLowerCase().includes(term)));
                    }
                    return {
                        count: chats.length,
                        chats: chats.map((c) => ({
                            guid: c.guid,
                            displayName: c.displayName,
                            participants: c.participants.map((p) => `${p.displayName} (${p.address})`),
                            lastMessage: c.lastMessage,
                            lastMessageDate: c.lastMessageDate ? new Date(c.lastMessageDate).toISOString() : null,
                            unreadCount: c.unreadCount,
                            isGroup: c.isGroup,
                            service: c.service,
                        })),
                    };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool list-chats failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'get-chat-messages',
            description: 'Fetch message history from a specific conversation. Returns messages in chronological order with sender names, timestamps, reactions, and reply threading. Use the chat GUID from list-chats to identify the conversation.',
            inputSchema: {
                type: 'object',
                properties: {
                    chatGuid: {
                        type: 'string',
                        description: 'The chat GUID (e.g. iMessage;-;+15551234567 or iMessage;+;chat123456)',
                    },
                    limit: {
                        type: 'number',
                        description: 'Number of messages to fetch (default: 50, max: 100)',
                    },
                    offset: {
                        type: 'number',
                        description: 'Offset for pagination (default: 0). Use to fetch older messages.',
                    },
                },
                required: ['chatGuid'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const contacts = deps.getContacts();
                    const data = input;
                    const limit = Math.min(Number(data.limit) || 50, 100);
                    const offset = Number(data.offset) || 0;
                    const bbMessages = await client.getChatMessages(data.chatGuid, limit, offset);
                    const allNormalized = bbMessages
                        .map((m) => normalizeMessage(m, data.chatGuid, (guid) => client.getAttachmentUrl(guid), contacts ? (addr) => contacts.resolve(addr) : undefined))
                        .reverse();
                    const bbReversed = [...bbMessages].reverse();
                    const messages = processMessagesWithReactions(allNormalized, bbReversed);
                    return {
                        chatGuid: data.chatGuid,
                        count: messages.length,
                        messages: messages.map((m) => ({
                            guid: m.guid,
                            sender: m.sender,
                            senderName: m.senderName,
                            text: m.text,
                            date: new Date(m.date).toISOString(),
                            isFromMe: m.isFromMe,
                            reactions: m.reactions.map((r) => `${r.type} by ${r.sender}`),
                            replyToGuid: m.replyToGuid,
                            isEdited: m.isEdited,
                            isUnsent: m.isUnsent,
                            hasAttachments: m.attachments.length > 0,
                            attachments: m.attachments.map((a) => ({
                                filename: a.filename,
                                mimeType: a.mimeType,
                            })),
                        })),
                    };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool get-chat-messages failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'send-message',
            description: 'Send an iMessage or SMS text message to a conversation. The message will be sent from the Mac\'s iMessage/SMS account. For long messages, text is automatically split into smaller chunks. IMPORTANT: Always confirm with the user before sending a message on their behalf.',
            inputSchema: {
                type: 'object',
                properties: {
                    chatGuid: {
                        type: 'string',
                        description: 'The chat GUID to send to. Get this from list-chats.',
                    },
                    text: {
                        type: 'string',
                        description: 'The message text to send',
                    },
                    replyToGuid: {
                        type: 'string',
                        description: 'Optional message GUID to reply to (creates a threaded reply)',
                    },
                },
                required: ['chatGuid', 'text'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const contacts = deps.getContacts();
                    const stateManager = deps.getStateManager();
                    const chatHistory = deps.getChatHistory();
                    const chunkConfig = deps.getChunkConfig();
                    const data = input;
                    const results = await client.sendChunkedText(data.chatGuid, data.text, chunkConfig.maxLength, { replyToGuid: data.replyToGuid });
                    for (const msg of results) {
                        if (stateManager) {
                            const normalized = normalizeMessage(msg, data.chatGuid, (guid) => client.getAttachmentUrl(guid), contacts ? (addr) => contacts.resolve(addr) : undefined);
                            stateManager.addIncomingMessage(normalized);
                        }
                    }
                    chatHistory?.appendMessage(data.chatGuid, { role: 'assistant', content: data.text });
                    return {
                        success: true,
                        chatGuid: data.chatGuid,
                        messagesSent: results.length,
                        messages: results.map((m) => ({ guid: m.guid, text: m.text })),
                    };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool send-message failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'send-message-to-contact',
            description: 'Send a message to a contact by their phone number or email address, without needing to know the chat GUID. Creates a new chat if one doesn\'t already exist. IMPORTANT: Always confirm with the user before sending a message on their behalf.',
            inputSchema: {
                type: 'object',
                properties: {
                    address: {
                        type: 'string',
                        description: 'Phone number (e.g. +15551234567) or email address to message',
                    },
                    text: {
                        type: 'string',
                        description: 'The message text to send',
                    },
                },
                required: ['address', 'text'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const contacts = deps.getContacts();
                    const stateManager = deps.getStateManager();
                    const chatHistory = deps.getChatHistory();
                    const chunkConfig = deps.getChunkConfig();
                    const data = input;
                    const existingChats = stateManager?.getState().chats ?? [];
                    const match = existingChats.find((c) => !c.isGroup &&
                        c.participants.some((p) => p.address === data.address || p.address.replace(/\D/g, '').endsWith(data.address.replace(/\D/g, ''))));
                    if (match) {
                        const results = await client.sendChunkedText(match.guid, data.text, chunkConfig.maxLength);
                        for (const msg of results) {
                            if (stateManager) {
                                const normalized = normalizeMessage(msg, match.guid, (guid) => client.getAttachmentUrl(guid), contacts ? (addr) => contacts.resolve(addr) : undefined);
                                stateManager.addIncomingMessage(normalized);
                            }
                        }
                        chatHistory?.appendMessage(match.guid, { role: 'assistant', content: data.text });
                        return {
                            success: true,
                            chatGuid: match.guid,
                            messagesSent: results.length,
                            existingChat: true,
                        };
                    }
                    const newChat = await client.createChat([data.address], data.text);
                    await deps.loadChats();
                    return {
                        success: true,
                        chatGuid: newChat.guid,
                        messagesSent: 1,
                        existingChat: false,
                    };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool send-message-to-contact failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'unsend-message',
            description: 'Unsend/retract a previously sent iMessage. Only works for messages you sent, and only on iMessage (not SMS). The message will be removed from the conversation for all participants. Requires the Private API to be enabled on the BlueBubbles server.',
            inputSchema: {
                type: 'object',
                properties: {
                    chatGuid: {
                        type: 'string',
                        description: 'The chat GUID containing the message',
                    },
                    messageGuid: {
                        type: 'string',
                        description: 'The GUID of the message to unsend. Get this from get-chat-messages.',
                    },
                },
                required: ['chatGuid', 'messageGuid'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const data = input;
                    await client.unsendMessage(data.chatGuid, data.messageGuid);
                    return { success: true, chatGuid: data.chatGuid, messageGuid: data.messageGuid };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool unsend-message failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'react-to-message',
            description: 'Add an iMessage tapback reaction to a message. Available reactions: love (heart), like (thumbs up), dislike (thumbs down), laugh (haha), emphasize (exclamation marks), question (question mark).',
            inputSchema: {
                type: 'object',
                properties: {
                    chatGuid: {
                        type: 'string',
                        description: 'The chat GUID containing the message',
                    },
                    messageGuid: {
                        type: 'string',
                        description: 'The GUID of the message to react to. Get this from get-chat-messages.',
                    },
                    reaction: {
                        type: 'string',
                        enum: ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'],
                        description: 'The tapback reaction type',
                    },
                },
                required: ['chatGuid', 'messageGuid', 'reaction'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const data = input;
                    const valid = ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'];
                    if (!valid.includes(data.reaction)) {
                        return { error: `Invalid reaction type: "${data.reaction}". Must be one of: ${valid.join(', ')}` };
                    }
                    await client.sendReaction(data.chatGuid, data.messageGuid, data.reaction);
                    return { success: true, chatGuid: data.chatGuid, messageGuid: data.messageGuid, reaction: data.reaction };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool react-to-message failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'edit-message',
            description: 'Edit a previously sent iMessage. Only works for messages you sent, and only on iMessage (not SMS). Requires the Private API to be enabled on the BlueBubbles server.',
            inputSchema: {
                type: 'object',
                properties: {
                    chatGuid: {
                        type: 'string',
                        description: 'The chat GUID containing the message',
                    },
                    messageGuid: {
                        type: 'string',
                        description: 'The GUID of the message to edit. Get this from get-chat-messages.',
                    },
                    text: {
                        type: 'string',
                        description: 'The new message text',
                    },
                },
                required: ['chatGuid', 'messageGuid', 'text'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const data = input;
                    await client.editMessage(data.chatGuid, data.messageGuid, data.text);
                    return { success: true, chatGuid: data.chatGuid, messageGuid: data.messageGuid, newText: data.text };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool edit-message failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'create-chat',
            description: 'Create a new iMessage or SMS conversation with one or more participants. For group chats, provide multiple addresses. Optionally send an initial message.',
            inputSchema: {
                type: 'object',
                properties: {
                    addresses: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of phone numbers or email addresses to include in the chat',
                    },
                    message: {
                        type: 'string',
                        description: 'Optional initial message to send when creating the chat',
                    },
                },
                required: ['addresses'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const data = input;
                    const newChat = await client.createChat(data.addresses, data.message);
                    await deps.loadChats();
                    return {
                        success: true,
                        chatGuid: newChat.guid,
                        participants: data.addresses,
                    };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool create-chat failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'mark-chat-read',
            description: 'Mark all messages in a conversation as read.',
            inputSchema: {
                type: 'object',
                properties: {
                    chatGuid: {
                        type: 'string',
                        description: 'The chat GUID to mark as read',
                    },
                },
                required: ['chatGuid'],
            },
            execute: async (input) => {
                try {
                    const client = requireClient(deps);
                    const stateManager = deps.getStateManager();
                    const data = input;
                    await client.markChatRead(data.chatGuid);
                    stateManager?.markChatRead(data.chatGuid);
                    return { success: true, chatGuid: data.chatGuid };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool mark-chat-read failed:', message);
                    return { error: message };
                }
            },
        },
        {
            name: 'get-server-status',
            description: 'Get the current BlueBubbles connection status and server information. Useful for checking if the messaging service is connected and working.',
            inputSchema: {
                type: 'object',
                properties: {},
            },
            execute: async () => {
                try {
                    const stateManager = deps.getStateManager();
                    if (!stateManager) {
                        return { connectionStatus: 'not_initialized' };
                    }
                    const state = stateManager.getState();
                    return {
                        connectionStatus: state.connectionStatus,
                        serverInfo: state.serverInfo,
                        privateApiEnabled: state.privateApiEnabled,
                        unreadTotal: state.unreadTotal,
                        chatCount: state.chats.length,
                    };
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    deps.log.error('Tool get-server-status failed:', message);
                    return { error: message };
                }
            },
        },
    ];
}
