import { timingSafeEqual } from 'crypto';
import { normalizeMessage } from './message-normalizer.js';
const VALID_REACTION_NAMES = new Set(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question']);
const TAPBACK_INT_MAP = {
    2000: 'love', 2001: 'like', 2002: 'dislike', 2003: 'laugh', 2004: 'emphasize', 2005: 'question',
};
function safeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    try {
        return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }
    catch {
        return false;
    }
}
export function createWebhookHandler(options) {
    const { stateManager, client, log, webhookSecret, contactResolve, onNewMessage } = options;
    return async (req) => {
        if (req.method !== 'POST') {
            return { status: 405, body: '{"error":"Method not allowed"}' };
        }
        if (webhookSecret) {
            const provided = req.query.secret || req.headers['x-webhook-secret'] || '';
            if (!safeEqual(provided, webhookSecret)) {
                log.warn('Webhook auth failed');
                return { status: 401, body: '{"error":"Unauthorized"}' };
            }
        }
        let event;
        try {
            event = JSON.parse(req.body ?? '{}');
        }
        catch {
            return { status: 400, body: '{"error":"Invalid JSON"}' };
        }
        try {
            await handleEvent(event, stateManager, client, log, contactResolve, onNewMessage);
        }
        catch (err) {
            log.error('Webhook event handling error:', err);
        }
        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: '{"ok":true}',
        };
    };
}
async function handleEvent(event, stateManager, client, log, contactResolve, onNewMessage) {
    const type = event.type;
    const data = event.data;
    switch (type) {
        case 'new-message': {
            const msg = data;
            const chatGuid = msg.chats?.[0]?.guid ?? '';
            if (!chatGuid)
                return;
            // Check if this is a reaction/tapback, not a regular message
            if (msg.associatedMessageGuid && msg.associatedMessageType != null) {
                let reactionName = null;
                let isRemoval = false;
                const assocType = msg.associatedMessageType;
                if (typeof assocType === 'string') {
                    isRemoval = assocType.startsWith('-');
                    const name = assocType.replace(/^-/, '').toLowerCase();
                    if (VALID_REACTION_NAMES.has(name))
                        reactionName = name;
                }
                else if (typeof assocType === 'number') {
                    const abs = Math.abs(assocType);
                    isRemoval = assocType >= 3000;
                    const base = isRemoval ? abs - 1000 : abs;
                    reactionName = TAPBACK_INT_MAP[base] ?? null;
                }
                if (reactionName) {
                    let targetGuid = msg.associatedMessageGuid;
                    const slashIdx = targetGuid.indexOf('/');
                    if (slashIdx >= 0) {
                        targetGuid = targetGuid.slice(slashIdx + 1);
                    }
                    else if (targetGuid.startsWith('bp:')) {
                        targetGuid = targetGuid.slice(3);
                    }
                    const reaction = {
                        type: reactionName,
                        sender: msg.handle?.address ?? (msg.isFromMe ? 'me' : 'unknown'),
                        isFromMe: msg.isFromMe,
                    };
                    if (isRemoval) {
                        stateManager.removeReaction(targetGuid, reaction);
                        log.info(`Reaction removed: ${reactionName} on ${targetGuid}`);
                    }
                    else {
                        stateManager.addReaction(targetGuid, reaction);
                        log.info(`Reaction added: ${reactionName} on ${targetGuid}`);
                    }
                    return;
                }
            }
            if (msg.isFromMe)
                return;
            // Send read receipt
            client.markChatRead(chatGuid).catch(() => { });
            const normalized = normalizeMessage(msg, chatGuid, (guid) => client.getAttachmentUrl(guid), contactResolve);
            stateManager.addIncomingMessage(normalized);
            log.info(`New message in ${chatGuid} from ${normalized.senderName}`);
            if (onNewMessage) {
                await onNewMessage(msg);
            }
            break;
        }
        case 'updated-message': {
            const msg = data;
            const chatGuid = msg.chats?.[0]?.guid ?? '';
            if (!chatGuid)
                return;
            const normalized = normalizeMessage(msg, chatGuid, (guid) => client.getAttachmentUrl(guid), contactResolve);
            stateManager.updateMessage(normalized);
            break;
        }
        case 'typing-indicator': {
            const typing = data;
            stateManager.setTypingIndicator(typing.guid, typing.display);
            break;
        }
        case 'group-name-change': {
            log.info('Group name changed, refreshing chats');
            break;
        }
        case 'participant-added':
        case 'participant-removed':
        case 'participant-left': {
            log.info(`Participant change (${type}), refreshing chats`);
            break;
        }
        case 'chat-read-status-changed': {
            const readData = data;
            if (readData.chatGuid) {
                stateManager.markChatRead(readData.chatGuid);
            }
            break;
        }
        default:
            log.info(`Unhandled webhook event: ${type}`);
    }
}
