import { SearchIcon } from '../icons';

const h = (...args: any[]) => (globalThis as any).React.createElement(...args);

type ChatListProps = {
  chats: any[];
  activeChatGuid: string | null;
  loadingChats: boolean;
  searchFilter: string;
  onSearchChange: (value: string) => void;
  onSelectChat: (chatGuid: string) => void;
  onDeleteChat?: (chatGuid: string) => void;
};

function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getInitials(name: string): string {
  return name
    .split(/[\s,]+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?';
}

export function ChatList({
  chats,
  activeChatGuid,
  loadingChats,
  searchFilter,
  onSearchChange,
  onSelectChat,
  onDeleteChat,
}: ChatListProps) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' } },
    // Search bar
    h('div', { style: { flexShrink: 0, padding: '12px' } },
      h('div', { style: { position: 'relative', display: 'flex', alignItems: 'center' } },
        h('div', {
          style: {
            position: 'absolute',
            left: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '14px',
            height: '14px',
          },
        },
          h(SearchIcon, { className: 'h-3.5 w-3.5 text-muted-foreground' }),
        ),
        h('input', {
          type: 'text',
          placeholder: 'Search conversations...',
          value: searchFilter,
          onChange: (e: any) => onSearchChange(e.target.value),
          style: { paddingLeft: '32px' },
          className: 'w-full rounded-lg border border-border/50 bg-muted/30 py-1.5 pr-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none',
        }),
      ),
    ),

    // Chat list
    h('div', { className: 'flex-1 overflow-y-auto' },
      loadingChats && chats.length === 0
        ? h('div', { className: 'p-4 text-center text-sm text-muted-foreground' }, 'Loading conversations...')
        : chats.length === 0
          ? h('div', { className: 'p-4 text-center text-sm text-muted-foreground' }, 'No conversations')
          : chats.map((chat: any) => {
              const isActive = chat.guid === activeChatGuid;
              const isIMMessage = chat.service === 'iMessage';
              const initials = getInitials(chat.displayName);
              const avatarColor = isIMMessage ? 'bg-blue-500' : 'bg-green-500';

              return h('div', {
                key: chat.guid,
                className: `group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                  isActive ? 'bg-primary/10' : 'hover:bg-muted/50'
                }`,
                onClick: () => onSelectChat(chat.guid),
              },
                // Avatar
                h('div', {
                  className: `flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColor}`,
                }, initials),

                // Content
                h('div', { className: 'flex-1 min-w-0' },
                  h('div', { className: 'flex items-center justify-between gap-1' },
                    h('span', {
                      className: `text-sm truncate ${chat.unreadCount > 0 ? 'font-semibold' : 'font-medium'}`,
                    }, chat.displayName),
                    h('div', { className: 'flex items-center gap-1 flex-shrink-0' },
                      h('span', {
                        className: 'text-[10px] text-muted-foreground',
                      }, formatRelativeTime(chat.lastMessageDate)),
                      onDeleteChat
                        ? h('button', {
                            type: 'button',
                            onClick: (e: any) => { e.stopPropagation(); onDeleteChat(chat.guid); },
                            className: 'opacity-0 group-hover:opacity-100 text-sm leading-none text-muted-foreground/40 hover:text-red-400 transition-opacity',
                            title: 'Remove conversation',
                          }, '\u00D7')
                        : null,
                    ),
                  ),
                  h('div', { className: 'flex items-center justify-between gap-2 mt-0.5' },
                    h('span', {
                      className: 'text-xs text-muted-foreground truncate',
                    }, chat.lastMessage || '\u00A0'),
                    chat.unreadCount > 0
                      ? h('span', {
                          className: 'flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground flex-shrink-0',
                        }, String(chat.unreadCount))
                      : null,
                  ),
                ),
              );
            }),
    ),
  );
}
