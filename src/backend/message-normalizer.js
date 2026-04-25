import { TAPBACK_MAP, TAPBACK_REMOVAL_OFFSET } from '../shared/constants.js';
export function normalizeChat(chat, contactResolve) {
    const guid = chat.guid ?? '';
    const service = guid.startsWith('SMS') ? 'SMS' : 'iMessage';
    const isGroup = guid.includes(';+;');
    const participants = (chat.participants ?? []).map((p) => ({
        address: p.address,
        displayName: contactResolve ? contactResolve(p.address) : (p.displayName || formatAddress(p.address)),
    }));
    let displayName = chat.displayName?.trim() || '';
    if (!displayName) {
        displayName = participants.map((p) => p.displayName).join(', ') || guid;
    }
    const lastMsg = chat.lastMessage;
    const lastMessage = lastMsg?.text?.trim() || (lastMsg?.attachments?.length ? '[Attachment]' : '');
    const lastMessageDate = lastMsg?.dateCreated ?? 0;
    return {
        guid,
        displayName,
        participants,
        lastMessage,
        lastMessageDate,
        unreadCount: chat.hasUnreadMessages ? 1 : 0,
        isGroup,
        service,
    };
}
export function normalizeMessage(msg, chatGuid, getAttachmentUrl, contactResolve) {
    const sender = msg.handle?.address ?? (msg.isFromMe ? 'me' : 'unknown');
    const senderName = contactResolve
        ? (msg.isFromMe ? 'Me' : contactResolve(sender))
        : (msg.handle?.address ? formatAddress(msg.handle.address) : (msg.isFromMe ? 'Me' : 'Unknown'));
    const attachments = (msg.attachments ?? [])
        .filter((a) => Boolean(a.guid))
        .map((a) => normalizeAttachment(a, getAttachmentUrl));
    const reactions = extractReactions(msg);
    return {
        guid: msg.guid,
        chatGuid,
        sender,
        senderName,
        text: msg.text ?? '',
        date: msg.dateCreated ?? 0,
        isFromMe: msg.isFromMe,
        attachments,
        reactions,
        replyToGuid: msg.threadOriginatorGuid ?? null,
        isEdited: Boolean(msg.dateEdited),
        isUnsent: Boolean(msg.dateRetracted),
        effectId: msg.expressiveSendStyleId ?? null,
        isDelivered: msg.isDelivered ?? false,
        isRead: msg.isRead ?? false,
        error: msg.error ?? 0,
    };
}
function normalizeAttachment(att, getAttachmentUrl) {
    return {
        guid: att.guid,
        mimeType: att.mimeType ?? 'application/octet-stream',
        filename: att.transferName ?? 'attachment',
        totalBytes: att.totalBytes ?? 0,
        width: att.width ?? undefined,
        height: att.height ?? undefined,
        downloadUrl: getAttachmentUrl(att.guid),
    };
}
const VALID_REACTIONS = new Set(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question']);
function extractReactions(msg) {
    if (!msg.associatedMessageGuid || msg.associatedMessageType == null)
        return [];
    const assocType = msg.associatedMessageType;
    let reactionName = null;
    if (typeof assocType === 'string') {
        const name = assocType.replace(/^-/, '').toLowerCase();
        if (VALID_REACTIONS.has(name))
            reactionName = name;
    }
    else if (typeof assocType === 'number') {
        const absType = Math.abs(assocType);
        const isRemoval = assocType >= TAPBACK_REMOVAL_OFFSET + 2000;
        const baseType = isRemoval ? absType - TAPBACK_REMOVAL_OFFSET : absType;
        reactionName = TAPBACK_MAP[baseType] ?? null;
    }
    if (!reactionName)
        return [];
    return [{
            type: reactionName,
            sender: msg.handle?.address ?? (msg.isFromMe ? 'me' : 'unknown'),
            isFromMe: msg.isFromMe,
        }];
}
function formatAddress(address) {
    if (address.includes('@')) {
        return address.split('@')[0];
    }
    if (address.length >= 10) {
        const digits = address.replace(/\D/g, '');
        if (digits.length === 11 && digits.startsWith('1')) {
            return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
        }
        if (digits.length === 10) {
            return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        }
    }
    return address;
}
