import { useState, useEffect, useCallback } from '../hooks';
import { ChatList } from './ChatList';
import { ThreadView } from './ThreadView';
import { EmptyState } from './EmptyState';
import { ConnectionStatus } from './ConnectionStatus';

type PluginComponentProps = {
  pluginName: string;
  props?: Record<string, unknown>;
  onAction: (action: string, data?: unknown) => void;
  onClose?: () => void;
  config?: Record<string, unknown>;
  updateConfig?: (path: string, value: unknown) => Promise<void>;
  pluginConfig?: Record<string, unknown>;
  pluginState?: Record<string, unknown>;
  setPluginConfig?: (path: string, value: unknown) => Promise<void>;
};

function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeAddress(address: string): string {
  const cleaned = address.replace(/[\s\-()]/g, '');
  if (/^\+?\d{10,}$/.test(cleaned)) {
    const digits = digitsOnly(cleaned);
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
  }
  return cleaned.toLowerCase();
}

function addSearchValue(textParts: string[], digitParts: string[], value: unknown): void {
  const text = String(value ?? '').trim();
  if (!text) return;

  textParts.push(text.toLowerCase());

  const digits = digitsOnly(text);
  if (digits) digitParts.push(digits);
}

function findSavedContactNames(address: string, contacts: Record<string, string>): string[] {
  const names = new Set<string>();
  const normalized = normalizeAddress(address);
  const addressDigits = digitsOnly(address);

  for (const [savedAddress, name] of Object.entries(contacts)) {
    const savedNormalized = normalizeAddress(savedAddress);
    const savedDigits = digitsOnly(savedAddress);

    if (
      savedNormalized === normalized ||
      (addressDigits && savedDigits && (addressDigits.endsWith(savedDigits) || savedDigits.endsWith(addressDigits)))
    ) {
      names.add(name);
    }
  }

  return [...names];
}

function chatMatchesSearch(
  chat: any,
  query: string,
  contacts: Record<string, string>,
  activeChatGuid: string | null,
  activeChatMessages: any[],
  chatHistories: Record<string, any[]>,
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const textParts: string[] = [];
  const digitParts: string[] = [];

  addSearchValue(textParts, digitParts, chat.guid);
  addSearchValue(textParts, digitParts, chat.displayName);
  addSearchValue(textParts, digitParts, chat.lastMessage);

  for (const participant of chat.participants ?? []) {
    addSearchValue(textParts, digitParts, participant.displayName);
    addSearchValue(textParts, digitParts, participant.address);

    for (const contactName of findSavedContactNames(participant.address ?? '', contacts)) {
      addSearchValue(textParts, digitParts, contactName);
    }
  }

  const historyMessages = Array.isArray(chatHistories[chat.guid]) ? chatHistories[chat.guid] : [];
  for (const historyMessage of historyMessages) {
    addSearchValue(textParts, digitParts, historyMessage.senderName);
    addSearchValue(textParts, digitParts, historyMessage.content);
  }

  if (chat.guid === activeChatGuid && Array.isArray(activeChatMessages)) {
    for (const message of activeChatMessages) {
      addSearchValue(textParts, digitParts, message.senderName);
      addSearchValue(textParts, digitParts, message.sender);
      addSearchValue(textParts, digitParts, message.text);
    }
  }

  const searchableText = textParts.join('\n');
  const searchableDigits = digitParts.join(' ');

  return terms.every((term) => {
    if (searchableText.includes(term)) return true;

    const termDigits = digitsOnly(term);
    return Boolean(termDigits && searchableDigits.includes(termDigits));
  });
}

export function PanelView({
  onAction,
  pluginState,
  pluginConfig,
}: PluginComponentProps) {
  const state = (pluginState ?? {}) as any;
  const config = (pluginConfig ?? {}) as any;
  const [replyToGuid, setReplyToGuid] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [localThreadSettings, setLocalThreadSettings] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    onAction('loadChats');
  }, []);

  // Auto-select chat when navigated from notification
  useEffect(() => {
    if (state.pendingChatGuid && state.pendingChatGuid !== state.activeChatGuid) {
      onAction('selectChat', { chatGuid: state.pendingChatGuid });
      onAction('clearPendingChat');
    }
  }, [state.pendingChatGuid]);

  const handleSelectChat = useCallback((chatGuid: string) => {
    setReplyToGuid(null);
    setLocalThreadSettings(null);
    onAction('selectChat', { chatGuid });
  }, [onAction]);

  const handleSendMessage = useCallback((text: string) => {
    if (!state.activeChatGuid) return;
    onAction('sendMessage', {
      chatGuid: state.activeChatGuid,
      text,
      replyToGuid: replyToGuid ?? undefined,
    });
    setReplyToGuid(null);
  }, [onAction, state.activeChatGuid, replyToGuid]);

  const handleSendReaction = useCallback((messageGuid: string, reaction: string) => {
    if (!state.activeChatGuid) return;
    onAction('sendReaction', {
      chatGuid: state.activeChatGuid,
      messageGuid,
      reaction,
    });
  }, [onAction, state.activeChatGuid]);

  const handleEditMessage = useCallback((messageGuid: string, text: string) => {
    if (!state.activeChatGuid) return;
    onAction('editMessage', {
      chatGuid: state.activeChatGuid,
      messageGuid,
      text,
    });
  }, [onAction, state.activeChatGuid]);

  const handleUnsendMessage = useCallback((messageGuid: string) => {
    if (!state.activeChatGuid) return;
    onAction('unsendMessage', {
      chatGuid: state.activeChatGuid,
      messageGuid,
    });
  }, [onAction, state.activeChatGuid]);

  const handleLoadMore = useCallback(() => {
    if (!state.activeChatGuid) return;
    const offset = state.activeChatMessages?.length ?? 0;
    onAction('loadMoreMessages', { chatGuid: state.activeChatGuid, offset });
  }, [onAction, state.activeChatGuid, state.activeChatMessages?.length]);

  const handleSaveContact = useCallback((address: string, name: string) => {
    onAction('saveContact', { address, name });
  }, [onAction]);

  const handleSaveThreadSettings = useCallback((settings: Record<string, unknown>) => {
    if (state.activeChatGuid) {
      setLocalThreadSettings(settings);
      onAction('saveThreadSettings', { chatGuid: state.activeChatGuid, settings });
    }
  }, [onAction, state.activeChatGuid]);

  const handleDeleteChat = useCallback((chatGuid: string) => {
    onAction('deleteChat', { chatGuid });
  }, [onAction]);

  const handleTyping = useCallback(() => {
    if (state.activeChatGuid) {
      onAction('sendTyping', { chatGuid: state.activeChatGuid });
    }
  }, [onAction, state.activeChatGuid]);

  const handleAttach = useCallback((files: File[]) => {
    if (!state.activeChatGuid || !files.length) return;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        onAction('sendAttachmentFromUI', {
          chatGuid: state.activeChatGuid,
          filename: file.name,
          mimeType: file.type,
          base64,
        });
      };
      reader.readAsDataURL(file);
    }
  }, [onAction, state.activeChatGuid]);

  const chats = (state.chats ?? []) as any[];
  const filteredChats = searchFilter
    ? chats.filter((c: any) =>
        chatMatchesSearch(
          c,
          searchFilter,
          state.contacts ?? {},
          state.activeChatGuid ?? null,
          state.activeChatMessages ?? [],
          config.chatHistories ?? {},
        ),
      )
    : chats;

  const activeChat = chats.find((c: any) => c.guid === state.activeChatGuid);

  const h = (globalThis as any).React.createElement;

  return h('div', {
    style: {
      display: 'flex',
      margin: '-1.25rem -1.5rem',
      width: 'calc(100% + 3rem)',
      height: 'calc(100vh - 3rem)',
      minHeight: 0,
      overflow: 'hidden',
    },
  },
    // Left sidebar - Chat list
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '320px',
        flexShrink: 0,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        borderRight: '1px solid var(--color-border, rgba(128,128,128,0.2))',
      },
    },
      h(ConnectionStatus, { status: state.connectionStatus, error: state.error }),
      h(ChatList, {
        chats: filteredChats,
        activeChatGuid: state.activeChatGuid,
        loadingChats: state.loadingChats,
        searchFilter,
        onSearchChange: setSearchFilter,
        onSelectChat: handleSelectChat,
        onDeleteChat: handleDeleteChat,
      }),
    ),

    // Right content - Thread view or empty state
    h('div', {
      style: {
        display: 'flex',
        flex: '1 1 0',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
      },
    },
      state.activeChatGuid && activeChat
        ? h(ThreadView, {
            chat: activeChat,
            messages: state.activeChatMessages ?? [],
            sendingMessage: state.sendingMessage,
            loadingMessages: state.loadingMessages,
            typingIndicator: (state.typingIndicators?.[state.activeChatGuid] ?? false) || (state.aiReplyProcessing?.[state.activeChatGuid] ?? false),
            privateApiEnabled: state.privateApiEnabled,
            replyToGuid,
            onSendMessage: handleSendMessage,
            onSendReaction: handleSendReaction,
            onEditMessage: handleEditMessage,
            onUnsendMessage: handleUnsendMessage,
            onSetReplyTo: setReplyToGuid,
            onLoadMore: handleLoadMore,
            onSaveContact: handleSaveContact,
            contacts: state.contacts ?? {},
            onTyping: handleTyping,
            threadSettings: localThreadSettings ?? (state.activeChatGuid ? (config.threadSettings?.[state.activeChatGuid] ?? {}) : {}),
            onSaveThreadSettings: handleSaveThreadSettings,
            onAttach: handleAttach,
          })
        : h(EmptyState, {
            connected: state.connectionStatus === 'connected',
            loading: state.loadingChats,
          }),
    ),
  );
}
