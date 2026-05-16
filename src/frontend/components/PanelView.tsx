import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ChatList } from './ChatList';
import { ThreadView } from './ThreadView';
import { EmptyState } from './EmptyState';
import { ConnectionStatus } from './ConnectionStatus';
import { ComposeBar } from './ComposeBar';
import { RecipientPicker } from './RecipientPicker';
import type { Recipient } from './RecipientPicker';
import type { PluginComponentProps } from '../hooks';

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
  const [composing, setComposing] = useState(false);
  const [composeRecipients, setComposeRecipients] = useState<Recipient[]>([]);

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
    setComposing(false);
    setComposeRecipients([]);
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

  const handleStartNewChat = useCallback((addresses: string[], message?: string, attachments?: Array<{ filename: string; mimeType: string; base64: string }>) => {
    onAction('startNewChat', { addresses, message, attachments });
    setComposing(false);
    setComposeRecipients([]);
  }, [onAction]);

  // Clear compose mode when a new chat is navigated to via pendingChatGuid
  useEffect(() => {
    if (state.pendingChatGuid && composing) {
      setComposing(false);
      setComposeRecipients([]);
    }
  }, [state.pendingChatGuid]);

  const chats = (state.chats ?? []) as any[];

  // Find existing chat that matches the selected compose recipients exactly
  const matchedComposeChat = useMemo(() => {
    if (!composing || composeRecipients.length === 0) return null;
    const selectedAddresses = composeRecipients.map((r) => r.address).sort();
    return chats.find((chat: any) => {
      const chatAddresses = (chat.participants ?? [])
        .map((p: any) => p.address)
        .sort();
      return (
        chatAddresses.length === selectedAddresses.length &&
        chatAddresses.every((addr: string, i: number) => addr === selectedAddresses[i])
      );
    }) ?? null;
  }, [composing, composeRecipients, chats]);

  // Auto-load matched chat messages when compose recipients match an existing conversation
  useEffect(() => {
    if (composing && matchedComposeChat) {
      onAction('selectChat', { chatGuid: matchedComposeChat.guid });
    }
  }, [composing, matchedComposeChat?.guid]);

  // Commit compose: user engaged with thread → exit compose mode, keep the chat selected
  const handleCommitCompose = useCallback(() => {
    setComposing(false);
    setComposeRecipients([]);
  }, []);

  // Handle sending from compose mode (for the "no match" empty compose case)
  const handleComposeSend = useCallback((text: string, attachments?: File[]) => {
    if (composeRecipients.length === 0) return;

    if (matchedComposeChat) {
      // Send to existing conversation
      if (text) {
        onAction('sendMessage', { chatGuid: matchedComposeChat.guid, text });
      }
      if (attachments?.length) {
        for (const file of attachments) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            onAction('sendAttachmentFromUI', {
              chatGuid: matchedComposeChat.guid,
              filename: file.name,
              mimeType: file.type,
              base64,
            });
          };
          reader.readAsDataURL(file);
        }
      }
      setComposing(false);
      setComposeRecipients([]);
    } else {
      // Create new conversation
      const addresses = composeRecipients.map((r) => r.address);
      if (attachments?.length) {
        const encoded: Array<{ filename: string; mimeType: string; base64: string }> = [];
        let pending = attachments.length;
        for (const file of attachments) {
          const reader = new FileReader();
          reader.onload = () => {
            encoded.push({
              filename: file.name,
              mimeType: file.type,
              base64: (reader.result as string).split(',')[1],
            });
            pending--;
            if (pending === 0) {
              handleStartNewChat(addresses, text || undefined, encoded);
            }
          };
          reader.readAsDataURL(file);
        }
      } else {
        handleStartNewChat(addresses, text || undefined);
      }
    }
  }, [composeRecipients, matchedComposeChat, onAction, handleStartNewChat]);

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

  return (
    <div className="flex overflow-hidden" style={{ height: '680px', minHeight: '480px' }}>
      {/* Left sidebar - Always shows chat list */}
      <div className="flex flex-col shrink-0 h-full min-h-0 overflow-hidden border-r border-border/50" style={{ width: '320px' }}>
        <ConnectionStatus status={state.connectionStatus} error={state.error} />
        <ChatList
          chats={filteredChats}
          activeChatGuid={composing ? null : state.activeChatGuid}
          loadingChats={state.loadingChats}
          searchFilter={searchFilter}
          onSearchChange={setSearchFilter}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
          onCompose={() => { setComposing(true); setComposeRecipients([]); }}
          contactPhotos={state.contactPhotos ?? {}}
        />
      </div>

      {/* Right content - Thread view, compose mode, or empty state */}
      <div className="flex flex-1 flex-col h-full min-h-0 min-w-0 overflow-hidden">
        {composing && matchedComposeChat && activeChat ? (
          // Compose mode with matching existing chat → full interactive ThreadView with recipient picker
          <ThreadView
            chat={activeChat}
            messages={state.activeChatMessages ?? []}
            sendingMessage={state.sendingMessage}
            loadingMessages={state.loadingMessages}
            typingIndicator={(state.typingIndicators?.[state.activeChatGuid] ?? false) || (state.aiReplyProcessing?.[state.activeChatGuid] ?? false)}
            privateApiEnabled={state.privateApiEnabled}
            replyToGuid={replyToGuid}
            onSendMessage={handleSendMessage}
            onSendReaction={handleSendReaction}
            onEditMessage={handleEditMessage}
            onUnsendMessage={handleUnsendMessage}
            onSetReplyTo={setReplyToGuid}
            onLoadMore={handleLoadMore}
            onSaveContact={handleSaveContact}
            contacts={state.contacts ?? {}}
            onTyping={handleTyping}
            threadSettings={localThreadSettings ?? (state.activeChatGuid ? (config.threadSettings?.[state.activeChatGuid] ?? {}) : {})}
            onSaveThreadSettings={handleSaveThreadSettings}
            onAttach={handleAttach}
            composeMode={true}
            composeRecipients={composeRecipients}
            onComposeRecipientsChange={setComposeRecipients}
            onCommitCompose={handleCommitCompose}
            contactPhotos={state.contactPhotos ?? {}}
          />
        ) : composing ? (
          // Compose mode with no matching chat → empty compose view
          <div className="flex h-full flex-col" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
            <RecipientPicker
              contacts={state.contacts ?? {}}
              contactPhotos={state.contactPhotos ?? {}}
              recipients={composeRecipients}
              onRecipientsChange={setComposeRecipients}
            />
            <div className="flex-1 flex items-center justify-center">
              <span className="text-sm text-muted-foreground/50">
                {composeRecipients.length === 0
                  ? 'Add recipients to start a conversation'
                  : 'Send a message to start the conversation'}
              </span>
            </div>
            {composeRecipients.length > 0 && (
              <ComposeBar
                onSend={handleComposeSend}
                allowAttach={true}
                sending={false}
                replyTo={null}
                onCancelReply={() => {}}
              />
            )}
          </div>
        ) : state.activeChatGuid && activeChat ? (
          <ThreadView
            chat={activeChat}
            messages={state.activeChatMessages ?? []}
            sendingMessage={state.sendingMessage}
            loadingMessages={state.loadingMessages}
            typingIndicator={(state.typingIndicators?.[state.activeChatGuid] ?? false) || (state.aiReplyProcessing?.[state.activeChatGuid] ?? false)}
            privateApiEnabled={state.privateApiEnabled}
            replyToGuid={replyToGuid}
            onSendMessage={handleSendMessage}
            onSendReaction={handleSendReaction}
            onEditMessage={handleEditMessage}
            onUnsendMessage={handleUnsendMessage}
            onSetReplyTo={setReplyToGuid}
            onLoadMore={handleLoadMore}
            onSaveContact={handleSaveContact}
            contacts={state.contacts ?? {}}
            onTyping={handleTyping}
            threadSettings={localThreadSettings ?? (state.activeChatGuid ? (config.threadSettings?.[state.activeChatGuid] ?? {}) : {})}
            onSaveThreadSettings={handleSaveThreadSettings}
            onAttach={handleAttach}
          />
        ) : (
          <EmptyState
            connected={state.connectionStatus === 'connected'}
            loading={state.loadingChats}
          />
        )}
      </div>
    </div>
  );
}
