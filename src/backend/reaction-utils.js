import { TAPBACK_MAP, TAPBACK_REMOVAL_OFFSET } from '../shared/constants.js';
const VALID_REACTION_NAMES = new Set(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question']);
export function isReactionMessage(raw) {
    if (!raw?.associatedMessageGuid)
        return false;
    const assocType = raw.associatedMessageType;
    if (assocType == null)
        return false;
    if (typeof assocType === 'string') {
        const name = assocType.replace(/^-/, '').toLowerCase();
        return VALID_REACTION_NAMES.has(name);
    }
    if (typeof assocType === 'number') {
        const abs = Math.abs(assocType);
        return abs >= 2000 && abs <= 3005;
    }
    return false;
}
export function extractReactionInfo(raw) {
    const assocType = raw.associatedMessageType;
    if (typeof assocType === 'string') {
        const isRemoval = assocType.startsWith('-');
        const name = assocType.replace(/^-/, '').toLowerCase();
        if (VALID_REACTION_NAMES.has(name))
            return { type: name, isRemoval };
        return null;
    }
    if (typeof assocType === 'number') {
        const abs = Math.abs(assocType);
        const isRemoval = assocType >= TAPBACK_REMOVAL_OFFSET + 2000;
        const baseType = isRemoval ? abs - TAPBACK_REMOVAL_OFFSET : abs;
        const name = TAPBACK_MAP[baseType];
        if (name)
            return { type: name, isRemoval };
        return null;
    }
    return null;
}
export function extractTargetGuid(associatedMessageGuid) {
    let target = associatedMessageGuid;
    const slashIdx = target.indexOf('/');
    if (slashIdx >= 0) {
        target = target.slice(slashIdx + 1);
    }
    else if (target.startsWith('bp:')) {
        target = target.slice(3);
    }
    return target;
}
export function processMessagesWithReactions(normalizedMessages, rawBBMessages) {
    const byGuid = new Map();
    const reactionRaws = [];
    for (const raw of rawBBMessages) {
        if (isReactionMessage(raw)) {
            reactionRaws.push(raw);
        }
    }
    const reactionGuids = new Set(reactionRaws.map((r) => r.guid));
    for (const msg of normalizedMessages) {
        if (!reactionGuids.has(msg.guid)) {
            byGuid.set(msg.guid, { ...msg, reactions: [...msg.reactions] });
        }
    }
    for (const raw of reactionRaws) {
        const targetGuid = extractTargetGuid(raw.associatedMessageGuid ?? '');
        const info = extractReactionInfo(raw);
        if (!info)
            continue;
        const target = byGuid.get(targetGuid);
        if (!target)
            continue;
        const sender = raw.handle?.address ?? (raw.isFromMe ? 'me' : 'unknown');
        const reaction = { type: info.type, sender, isFromMe: raw.isFromMe };
        if (info.isRemoval) {
            target.reactions = target.reactions.filter((r) => !(r.type === reaction.type && r.sender === reaction.sender));
        }
        else {
            const exists = target.reactions.some((r) => r.type === reaction.type && r.sender === reaction.sender);
            if (!exists) {
                target.reactions.push(reaction);
            }
        }
    }
    const result = [];
    for (const msg of normalizedMessages) {
        const processed = byGuid.get(msg.guid);
        if (processed)
            result.push(processed);
    }
    result.sort((a, b) => a.date - b.date);
    return result;
}
