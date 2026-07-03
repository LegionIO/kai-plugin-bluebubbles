import { timingSafeEqual } from 'crypto';
import type { StateManager } from './state-manager.js';
import type { BlueBubblesClient } from './bb-client.js';
import { normalizeMessage } from './message-normalizer.js';
import type { BBMessage, BBWebhookEvent, NormalizedReaction, ReactionType } from '../shared/types.js';
import type { AdvancedDebugLogAPI } from './debug-logger.js';

const VALID_REACTION_NAMES = new Set(['love', 'like', 'dislike', 'laugh', 'emphasize', 'question']);
const TAPBACK_INT_MAP: Record<number, string> = {
  2000: 'love', 2001: 'like', 2002: 'dislike', 2003: 'laugh', 2004: 'emphasize', 2005: 'question',
};

type PluginHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body?: string;
};

type PluginHttpResponse = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

type LogAPI = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type WebhookHandlerOptions = {
  stateManager: StateManager;
  client: BlueBubblesClient;
  log: LogAPI;
  debugLog?: AdvancedDebugLogAPI;
  webhookSecret: string;
  contactResolve?: (address: string) => string;
  onNewMessage?: (message: BBMessage) => void | Promise<void>;
  emitEvent?: (event: string, payload?: unknown) => void;
  isLocallySent?: (guid: string) => boolean;
};

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function summarizeEvent(event: BBWebhookEvent): Record<string, unknown> {
  const data = event.data as Partial<BBMessage> | Record<string, unknown> | undefined;
  const record = data as Record<string, unknown> | undefined;
  const chats = Array.isArray((data as Partial<BBMessage>)?.chats)
    ? (data as Partial<BBMessage>).chats
    : undefined;
  return {
    type: event.type,
    messageGuid: typeof (data as Partial<BBMessage>)?.guid === 'string'
      ? (data as Partial<BBMessage>).guid
      : undefined,
    chatGuid: chats?.[0]?.guid ?? (typeof record?.chatGuid === 'string' ? record.chatGuid : undefined),
    isFromMe: typeof (data as Partial<BBMessage>)?.isFromMe === 'boolean'
      ? (data as Partial<BBMessage>).isFromMe
      : undefined,
    sender: (data as Partial<BBMessage>)?.handle?.address,
    text: typeof (data as Partial<BBMessage>)?.text === 'string'
      ? (data as Partial<BBMessage>).text
      : undefined,
  };
}

export function createWebhookHandler(options: WebhookHandlerOptions) {
  const { stateManager, client, log, debugLog, webhookSecret, contactResolve, onNewMessage, emitEvent, isLocallySent } = options;

  return async (req: PluginHttpRequest): Promise<PluginHttpResponse> => {
    debugLog?.event('webhook.request', {
      method: req.method,
      url: req.url,
      queryKeys: Object.keys(req.query ?? {}),
      hasBody: Boolean(req.body),
    });

    if (req.method !== 'POST') {
      debugLog?.event('webhook.rejected', { reason: 'method_not_allowed', method: req.method }, 'warn');
      return { status: 405, body: '{"error":"Method not allowed"}' };
    }

    const provided = req.query.secret || req.headers['x-webhook-secret'] || '';
    if (!webhookSecret || !safeEqual(provided, webhookSecret)) {
      log.warn('Webhook auth failed');
      debugLog?.event('webhook.rejected', {
        reason: 'auth_failed',
        hasConfiguredSecret: Boolean(webhookSecret),
        providedSecretLength: provided.length,
      }, 'warn');
      return { status: 401, body: '{"error":"Unauthorized"}' };
    }

    let event: BBWebhookEvent;
    try {
      event = JSON.parse(req.body ?? '{}') as BBWebhookEvent;
    } catch {
      debugLog?.event('webhook.rejected', { reason: 'invalid_json' }, 'warn');
      return { status: 400, body: '{"error":"Invalid JSON"}' };
    }

    try {
      debugLog?.event('webhook.event.received', summarizeEvent(event), 'info');
      await handleEvent(event, stateManager, client, log, debugLog, contactResolve, onNewMessage, emitEvent, isLocallySent);
      debugLog?.event('webhook.event.handled', summarizeEvent(event), 'info');
    } catch (err) {
      log.error('Webhook event handling error:', err);
      debugLog?.event('webhook.event.failed', {
        ...summarizeEvent(event),
        error: err,
      }, 'error');
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}',
    };
  };
}

async function handleEvent(
  event: BBWebhookEvent,
  stateManager: StateManager,
  client: BlueBubblesClient,
  log: LogAPI,
  debugLog?: AdvancedDebugLogAPI,
  contactResolve?: (address: string) => string,
  onNewMessage?: (message: BBMessage) => void | Promise<void>,
  emitEvent?: (event: string, payload?: unknown) => void,
  isLocallySent?: (guid: string) => boolean,
): Promise<void> {
  const type = event.type;
  const data = event.data;
  const chatFor = (guid: string) => stateManager.getState().chats.find((c) => c.guid === guid);

  switch (type) {
    case 'new-message': {
      const msg = data as BBMessage;

      const chatGuid = msg.chats?.[0]?.guid ?? '';
      if (!chatGuid) return;

      // Check if this is a reaction/tapback, not a regular message
      if (msg.associatedMessageGuid && msg.associatedMessageType != null) {
        let reactionName: string | null = null;
        let isRemoval = false;
        const assocType = msg.associatedMessageType;

        if (typeof assocType === 'string') {
          isRemoval = assocType.startsWith('-');
          const name = assocType.replace(/^-/, '').toLowerCase();
          if (VALID_REACTION_NAMES.has(name)) reactionName = name;
        } else if (typeof assocType === 'number') {
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
          } else if (targetGuid.startsWith('bp:')) {
            targetGuid = targetGuid.slice(3);
          }

          const reaction: NormalizedReaction = {
            type: reactionName as ReactionType,
            sender: msg.handle?.address ?? (msg.isFromMe ? 'me' : 'unknown'),
            isFromMe: msg.isFromMe,
          };

          if (isRemoval) {
            stateManager.removeReaction(targetGuid, reaction);
            log.info(`Reaction removed: ${reactionName} on ${targetGuid}`);
          } else {
            stateManager.addReaction(targetGuid, reaction);
            log.info(`Reaction added: ${reactionName} on ${targetGuid}`);
          }
          emitEvent?.('reaction', {
            chatGuid,
            targetGuid,
            reaction: reactionName,
            sender: reaction.sender,
            senderName: contactResolve ? contactResolve(reaction.sender) : reaction.sender,
            isFromMe: reaction.isFromMe,
            removed: isRemoval,
          });
          return;
        }
      }

      if (msg.isFromMe) {
        if (!isLocallySent?.(msg.guid)) {
          const normalized = normalizeMessage(
            msg,
            chatGuid,
            (guid) => client.getAttachmentUrl(guid),
            contactResolve,
          );
          const chat = chatFor(chatGuid);
          emitEvent?.('message-sent', {
            guid: normalized.guid,
            chatGuid,
            chatName: chat?.displayName ?? chatGuid,
            sender: 'me',
            senderName: 'Me',
            text: normalized.text,
            isFromMe: true,
            isGroup: chat?.isGroup ?? chatGuid.includes(';+;'),
            attachmentCount: normalized.attachments.length,
            source: 'external',
          });
        }
        return;
      }

      // Send read receipt
      client.markChatRead(chatGuid).catch(() => {});

      const normalized = normalizeMessage(
        msg,
        chatGuid,
        (guid) => client.getAttachmentUrl(guid),
        contactResolve,
      );
      stateManager.addIncomingMessage(normalized);
      log.info(`New message in ${chatGuid} from ${normalized.senderName}`);
      {
        const chat = chatFor(chatGuid);
        emitEvent?.('message-received', {
          guid: normalized.guid,
          chatGuid,
          chatName: chat?.displayName ?? chatGuid,
          sender: normalized.sender,
          senderName: normalized.senderName,
          text: normalized.text,
          isFromMe: false,
          isGroup: chat?.isGroup ?? chatGuid.includes(';+;'),
          attachmentCount: normalized.attachments.length,
        });
      }
      debugLog?.event('webhook.new_message.normalized', {
        chatGuid,
        messageGuid: msg.guid,
        sender: normalized.sender,
        senderName: normalized.senderName,
        text: normalized.text,
        attachmentCount: normalized.attachments.length,
      }, 'info');

      if (onNewMessage) {
        await onNewMessage(msg);
      }
      break;
    }

    case 'updated-message': {
      const msg = data as BBMessage;
      const chatGuid = msg.chats?.[0]?.guid ?? '';
      if (!chatGuid) return;

      const normalized = normalizeMessage(
        msg,
        chatGuid,
        (guid) => client.getAttachmentUrl(guid),
        contactResolve,
      );
      stateManager.updateMessage(normalized);
      {
        const chat = chatFor(chatGuid);
        emitEvent?.('message-updated', {
          guid: normalized.guid,
          chatGuid,
          chatName: chat?.displayName ?? chatGuid,
          sender: normalized.sender,
          senderName: normalized.senderName,
          text: normalized.text,
          isFromMe: normalized.isFromMe,
          isGroup: chat?.isGroup ?? chatGuid.includes(';+;'),
          attachmentCount: normalized.attachments.length,
          isEdited: normalized.isEdited,
          isUnsent: normalized.isUnsent,
        });
      }
      debugLog?.event('webhook.updated_message.normalized', {
        chatGuid,
        messageGuid: msg.guid,
        text: normalized.text,
        isEdited: normalized.isEdited,
        isUnsent: normalized.isUnsent,
      });
      break;
    }

    case 'typing-indicator': {
      const typing = data as { display: boolean; guid: string };
      stateManager.setTypingIndicator(typing.guid, typing.display);
      emitEvent?.('typing', { chatGuid: typing.guid, display: typing.display });
      debugLog?.event('webhook.typing_indicator', typing);
      break;
    }

    case 'group-name-change':
    case 'participant-added':
    case 'participant-removed':
    case 'participant-left': {
      const record = data as { chatGuid?: string; chats?: Array<{ guid: string }>; newName?: string };
      const chatGuid = record?.chatGuid ?? record?.chats?.[0]?.guid;
      const change = type === 'group-name-change' ? 'name' : type;
      log.info(`Group change (${change})${chatGuid ? ` in ${chatGuid}` : ''}, refreshing chats`);
      emitEvent?.('group-change', { chatGuid, change, newName: record?.newName });
      break;
    }

    case 'chat-read-status-changed': {
      const readData = data as { chatGuid?: string };
      if (readData.chatGuid) {
        stateManager.markChatRead(readData.chatGuid);
        emitEvent?.('chat-read', { chatGuid: readData.chatGuid });
      }
      break;
    }

    default:
      log.info(`Unhandled webhook event: ${type}`);
  }
}
