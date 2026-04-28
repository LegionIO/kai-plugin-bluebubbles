import { useState, useEffect, useRef, useCallback } from '../hooks';
import { MessageBubble } from './MessageBubble';
import { ComposeBar } from './ComposeBar';
import { ReactionPicker } from './ReactionPicker';
import { Dropdown, AutoManualToggle, useModelCatalog, useProfileCatalog } from './ModelProfileSelectors';

const h = (...args: any[]) => (globalThis as any).React.createElement(...args);

type ThreadViewProps = {
  chat: any;
  messages: any[];
  sendingMessage: boolean;
  loadingMessages: boolean;
  typingIndicator: boolean;
  privateApiEnabled: boolean;
  replyToGuid: string | null;
  onSendMessage: (text: string) => void;
  onSendReaction: (messageGuid: string, reaction: string) => void;
  onEditMessage: (messageGuid: string, text: string) => void;
  onUnsendMessage: (messageGuid: string) => void;
  onSetReplyTo: (guid: string | null) => void;
  onLoadMore: () => void;
  onSaveContact?: (address: string, name: string) => void;
  contacts?: Record<string, string>;
  onTyping?: () => void;
  threadSettings?: Record<string, unknown>;
  onSaveThreadSettings?: (settings: Record<string, unknown>) => void;
  onAttach?: (files: File[]) => void;
};

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function shouldShowDateDivider(current: any, previous: any): boolean {
  if (!previous) return true;
  const d1 = new Date(current.date).toDateString();
  const d2 = new Date(previous.date).toDateString();
  return d1 !== d2;
}

function shouldGroupWithPrevious(current: any, previous: any): boolean {
  if (!previous) return false;
  if (current.sender !== previous.sender) return false;
  if (current.isFromMe !== previous.isFromMe) return false;
  return (current.date - previous.date) < 120_000;
}

export function ThreadView({
  chat,
  messages,
  sendingMessage,
  loadingMessages,
  typingIndicator,
  privateApiEnabled,
  replyToGuid,
  onSendMessage,
  onSendReaction,
  onEditMessage,
  onUnsendMessage,
  onSetReplyTo,
  onLoadMore,
  onSaveContact,
  contacts,
  onTyping,
  threadSettings,
  onSaveThreadSettings,
  onAttach,
}: ThreadViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [contactNameInput, setContactNameInput] = useState('');
  const [showThreadSettings, setShowThreadSettings] = useState(false);
  const autoScrollRef = useRef(true);
  const skipNextAutoScrollRef = useRef(false);
  const smoothScrollFrameRef = useRef<number | null>(null);
  const smoothScrollingRef = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    if (smoothScrollFrameRef.current !== null) {
      cancelAnimationFrame(smoothScrollFrameRef.current);
      smoothScrollFrameRef.current = null;
    }

    const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);

    if (behavior === 'smooth') {
      const start = scroller.scrollTop;
      const distance = target - start;
      const duration = 420;
      const startedAt = performance.now();
      smoothScrollingRef.current = true;

      const step = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = start + distance * eased;
        }

        if (progress < 1) {
          smoothScrollFrameRef.current = requestAnimationFrame(step);
        } else {
          smoothScrollFrameRef.current = null;
          smoothScrollingRef.current = false;
          autoScrollRef.current = true;
          setAutoScroll(true);
        }
      };

      smoothScrollFrameRef.current = requestAnimationFrame(step);
      return;
    }

    scroller.scrollTop = scroller.scrollHeight;
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  useEffect(() => {
    autoScrollRef.current = true;
    setAutoScroll(true);
  }, [chat.guid]);

  useEffect(() => {
    if (autoScroll) {
      if (skipNextAutoScrollRef.current) {
        skipNextAutoScrollRef.current = false;
        return;
      }
      scrollToBottom();
    }
  }, [chat.guid, messages.length, autoScroll, scrollToBottom]);

  const handleMediaLoad = useCallback(() => {
    if (autoScrollRef.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    if (smoothScrollingRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    autoScrollRef.current = atBottom;
    setAutoScroll(atBottom);

    if (scrollTop < 50 && messages.length > 0 && !loadingMessages) {
      onLoadMore();
    }
  }, [messages.length, loadingMessages, onLoadMore]);

  const replyToMessage = replyToGuid
    ? messages.find((m) => m.guid === replyToGuid)
    : null;

  return h('div', {
    className: 'flex h-full flex-col',
    style: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
    },
  },
    // Header
    h('div', {
      className: 'flex items-center gap-3 border-b border-border/50 px-4 py-3',
      style: { flexShrink: 0 },
    },
      h('div', { className: 'min-w-0 flex-1' },
        h('h2', { className: 'text-sm font-semibold' }, chat.displayName),
        chat.isGroup && chat.participants?.length > 0
          ? h('div', { className: 'flex flex-wrap items-center gap-0.5 mt-0.5' },
              chat.participants.map((p: any, idx: number) => {
                const addr = p.address;
                const saved = contacts?.[addr];
                const isLast = idx === chat.participants.length - 1;
                return h('span', {
                  key: addr,
                  className: 'text-xs text-muted-foreground',
                },
                  h('button', {
                    type: 'button',
                    onClick: () => { setEditingContact(addr); setContactNameInput(saved || p.displayName || ''); },
                    className: `hover:text-primary hover:underline ${saved ? '' : 'text-muted-foreground/60'}`,
                    title: saved ? `Edit ${saved}` : `Save contact for ${addr}`,
                  }, p.displayName || addr),
                  isLast ? null : ', ',
                );
              }),
            )
          : !chat.isGroup && chat.participants?.length > 0
            ? (() => {
                const addr = chat.participants[0]?.address;
                const saved = addr ? contacts?.[addr] : null;
                return h('div', { className: 'flex items-center gap-2 mt-0.5' },
                  h('button', {
                    type: 'button',
                    onClick: () => { if (addr) { setEditingContact(addr); setContactNameInput(saved || ''); } },
                    className: 'text-xs text-muted-foreground hover:text-primary hover:underline',
                    title: saved ? `Edit contact for ${addr}` : `Save contact for ${addr}`,
                  }, addr ?? chat.service),
                );
              })()
            : h('span', { className: 'text-xs text-muted-foreground' }, chat.service),
      ),

      // Thread settings gear button
      onSaveThreadSettings
        ? h('button', {
            type: 'button',
            onClick: () => setShowThreadSettings(!showThreadSettings),
            style: {
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              opacity: showThreadSettings ? 1 : 0.5,
              fontSize: '16px',
            },
            title: 'Thread AI settings',
          }, '\u2699')
        : null,
    ),

    // Per-thread AI settings panel
    showThreadSettings && onSaveThreadSettings
      ? h(ThreadSettingsBar, {
          threadSettings: threadSettings ?? {},
          onSave: onSaveThreadSettings,
        })
      : null,

    // Save contact inline form
    editingContact
      ? h('div', {
          className: 'flex items-center gap-2 border-b border-border/30 px-4 py-2 bg-muted/30',
          style: { flexShrink: 0 },
        },
          h('span', { className: 'text-xs text-muted-foreground' }, `Save ${editingContact}:`),
          h('input', {
            type: 'text',
            value: contactNameInput,
            onChange: (e: any) => setContactNameInput(e.target.value),
            placeholder: 'Name',
            className: 'flex-1 rounded border border-border/50 bg-background px-2 py-1 text-xs focus:outline-none focus:border-primary/50',
            autoFocus: true,
            onKeyDown: (e: any) => {
              if (e.key === 'Enter' && contactNameInput.trim()) {
                onSaveContact?.(editingContact, contactNameInput.trim());
                setEditingContact(null);
              }
              if (e.key === 'Escape') setEditingContact(null);
            },
          }),
          h('button', {
            type: 'button',
            onClick: () => {
              if (contactNameInput.trim()) {
                onSaveContact?.(editingContact, contactNameInput.trim());
                setEditingContact(null);
              }
            },
            disabled: !contactNameInput.trim(),
            className: 'rounded px-2 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30',
          }, 'Save'),
          h('button', {
            type: 'button',
            onClick: () => setEditingContact(null),
            className: 'text-xs text-muted-foreground hover:text-foreground',
          }, 'Cancel'),
        )
      : null,

    // Messages area
    h('div', {
      style: {
        position: 'relative',
        flex: '1 1 0',
        minHeight: 0,
        overflow: 'hidden',
      },
    },
      h('div', {
        ref: scrollRef,
        onScroll: handleScroll,
        className: 'h-full overflow-y-auto px-4 py-3',
        style: {
          height: '100%',
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        },
      },
        loadingMessages && messages.length === 0
          ? h('div', { className: 'flex h-full items-center justify-center text-sm text-muted-foreground' }, 'Loading messages...')
          : messages.map((msg: any, idx: number) => {
              const prev = messages[idx - 1];
              const showDate = shouldShowDateDivider(msg, prev);
              const grouped = shouldGroupWithPrevious(msg, prev);

              return h('div', { key: msg.guid },
                showDate
                  ? h('div', { className: 'my-4 text-center text-[11px] font-medium text-muted-foreground/60' },
                      formatDate(msg.date))
                  : null,
                h(MessageBubble, {
                  message: msg,
                  isGroup: chat.isGroup,
                  grouped,
                  time: formatTime(msg.date),
                  privateApiEnabled,
                  showToolCalls: (threadSettings as any)?.showToolCalls ?? false,
                  onMediaLoad: handleMediaLoad,
                  onReact: (reactionType?: string) => {
                    if (reactionType) {
                      onSendReaction(msg.guid, reactionType);
                    } else {
                      setReactionTarget(msg.guid === reactionTarget ? null : msg.guid);
                    }
                  },
                  onReply: () => onSetReplyTo(msg.guid),
                  onEdit: (text: string) => onEditMessage(msg.guid, text),
                  onUnsend: () => onUnsendMessage(msg.guid),
                }),
                reactionTarget === msg.guid
                  ? h(ReactionPicker, {
                      onSelect: (reaction: string) => {
                        onSendReaction(msg.guid, reaction);
                        setReactionTarget(null);
                      },
                      onClose: () => setReactionTarget(null),
                    })
                  : null,
              );
            }),

        // Typing indicator
        typingIndicator
          ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', padding: '8px 8px' } },
              h('div', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  borderRadius: '16px',
                  padding: '8px 12px',
                  backgroundColor: '#3b82f6',
                },
              },
                [0, 1, 2].map((i) =>
                  h('span', {
                    key: i,
                    style: {
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: 'rgba(255,255,255,0.7)',
                      opacity: 0.6,
                      animation: `bb-typing-bounce 1.4s ease-in-out ${i * 0.2}s infinite`,
                    },
                  }),
                ),
              ),
              // Inject keyframes via a style tag
              h('style', null, `@keyframes bb-typing-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }`),
            )
          : null,
      ),

      // Scroll to bottom button
      !autoScroll
        ? h('div', {
            style: {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: '12px',
              zIndex: 15,
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
            },
          },
            h('button', {
              type: 'button',
              onClick: () => {
                autoScrollRef.current = true;
                skipNextAutoScrollRef.current = true;
                setAutoScroll(true);
                scrollToBottom('smooth');
              },
              className: 'rounded-full bg-muted/80 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted',
              style: { pointerEvents: 'auto' },
            }, 'Scroll to bottom'),
          )
        : null,
    ),

    // Compose bar
    h(ComposeBar, {
      onSend: (text: string, attachments?: File[]) => {
        if (attachments?.length) {
          onAttach?.(attachments);
        }
        if (text) {
          onSendMessage(text);
        }
      },
      allowAttach: Boolean(onAttach),
      sending: sendingMessage,
      replyTo: replyToMessage,
      onCancelReply: () => onSetReplyTo(null),
      onTyping,
    }),
  );
}

function ThreadSettingsBar({ threadSettings, onSave }: { threadSettings: Record<string, unknown>; onSave: (s: Record<string, unknown>) => void }) {
  const { models, defaultKey: defaultModelKey } = useModelCatalog();
  const { profiles, defaultKey: defaultProfileKey } = useProfileCatalog();

  const ts = threadSettings as any;
  const isAuto = ts.fallbackEnabled ?? false;

  const selectedProfileKey = ts.profileOverride ?? defaultProfileKey ?? '';
  const selectedProfile = profiles.find((p) => p.key === selectedProfileKey);

  const modelOptions = [
    { value: '', label: 'Default' },
    ...models.map((m) => ({ value: m.key, label: m.displayName })),
  ];

  const profileOptions = [
    { value: '', label: 'Default (no profile)' },
    ...profiles.map((p) => ({ value: p.key, label: p.name })),
  ];

  const thinkingOptions = [
    { value: '', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
  ];

  const handleProfileChange = (key: string) => {
    const profile = profiles.find((p) => p.key === key);
    onSave({
      ...threadSettings,
      profileOverride: key || undefined,
      modelOverride: profile ? profile.primaryModelKey : undefined,
      fallbackEnabled: Boolean(key),
    });
  };

  const handleAutoToggle = (auto: boolean) => {
    if (auto && selectedProfile) {
      onSave({ ...threadSettings, fallbackEnabled: true, modelOverride: selectedProfile.primaryModelKey });
    } else {
      onSave({ ...threadSettings, fallbackEnabled: false });
    }
  };

  return h('div', {
    style: {
      borderBottom: '1px solid var(--color-border, rgba(128,128,128,0.2))',
      padding: '6px 12px',
      display: 'flex',
      flexShrink: 0,
      flexWrap: 'wrap',
      gap: '6px',
      alignItems: 'center',
    },
  },
    h(Dropdown, {
      label: 'Select profile',
      icon: '\uD83D\uDC64',
      value: ts.profileOverride ?? '',
      options: profileOptions,
      onChange: handleProfileChange,
      direction: 'down',
    }),
    h(AutoManualToggle, {
      enabled: isAuto,
      onToggle: handleAutoToggle,
    }),
    h(Dropdown, {
      label: 'Select model',
      icon: '\u2699',
      value: ts.modelOverride ?? '',
      options: modelOptions,
      onChange: (v: string) => onSave({ ...threadSettings, modelOverride: v || undefined }),
      disabled: isAuto,
      direction: 'down',
    }),
    h(Dropdown, {
      label: 'Select thinking',
      icon: '\uD83E\uDDE0',
      value: ts.reasoningEffort ?? '',
      options: thinkingOptions,
      onChange: (v: string) => onSave({ ...threadSettings, reasoningEffort: v || undefined }),
      direction: 'down',
    }),
    h('button', {
      type: 'button',
      onClick: () => onSave({ ...threadSettings, showToolCalls: !ts.showToolCalls }),
      title: ts.showToolCalls ? 'Hide tool calls' : 'Show tool calls',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        borderRadius: '12px',
        border: `1px solid ${ts.showToolCalls ? 'var(--color-primary, #3b82f6)' : 'var(--color-border, rgba(128,128,128,0.25))'}`,
        background: ts.showToolCalls ? 'rgba(59,130,246,0.1)' : 'var(--color-card, rgba(255,255,255,0.7))',
        color: ts.showToolCalls ? 'var(--color-primary, #3b82f6)' : 'inherit',
        padding: '4px 10px',
        fontSize: '11px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s',
      },
    },
      h('span', { style: { fontSize: '12px' } }, '\uD83D\uDD27'),
      h('span', null, ts.showToolCalls ? 'Hide Tool Trace' : 'Show Tool Trace'),
    ),
  );
}
