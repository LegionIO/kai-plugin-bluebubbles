import React from 'react';
import { SearchIcon, ComposeIcon } from '../icons';
import { ChatAvatar } from './ChatAvatar';

type ChatListProps = {
  chats: any[];
  activeChatGuid: string | null;
  loadingChats: boolean;
  searchFilter: string;
  onSearchChange: (value: string) => void;
  onSelectChat: (chatGuid: string) => void;
  onDeleteChat?: (chatGuid: string) => void;
  onCompose?: () => void;
  contactPhotos?: Record<string, string>;
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

export function ChatList({
  chats,
  activeChatGuid,
  loadingChats,
  searchFilter,
  onSearchChange,
  onSelectChat,
  onDeleteChat,
  onCompose,
  contactPhotos = {},
}: ChatListProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 0',
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Search bar */}
      <div style={{ flexShrink: 0, padding: '12px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div
            style={{
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
            }}
          >
            <SearchIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchFilter}
            onChange={(e: any) => onSearchChange(e.target.value)}
            style={{ paddingLeft: '32px' }}
            className="w-full rounded-lg border border-border/50 bg-muted/30 py-1.5 pr-3 text-sm placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          />
          {onCompose && (
            <button
              type="button"
              onClick={onCompose}
              className="ml-2 flex-shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              title="New message"
            >
              <ComposeIcon className="h-4 w-4" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Chat list */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          flex: '1 1 0',
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {loadingChats && chats.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Loading conversations...</div>
        ) : chats.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">No conversations</div>
        ) : (
          chats.map((chat: any) => {
            const isActive = chat.guid === activeChatGuid;

            return (
              <div
                key={chat.guid}
                className={`group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer ${
                  isActive ? 'bg-primary/10' : 'hover:bg-muted/50'
                }`}
                onClick={() => onSelectChat(chat.guid)}
              >
                {/* Avatar */}
                <ChatAvatar chat={chat} contactPhotos={contactPhotos} />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-sm truncate ${chat.unreadCount > 0 ? 'font-semibold' : 'font-medium'}`}
                    >
                      {chat.displayName}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelativeTime(chat.lastMessageDate)}
                      </span>
                      {onDeleteChat ? (
                        <button
                          type="button"
                          onClick={(e: any) => { e.stopPropagation(); onDeleteChat(chat.guid); }}
                          className="opacity-0 group-hover:opacity-100 text-sm leading-none text-muted-foreground/40 hover:text-red-400 transition-opacity"
                          title="Remove conversation"
                        >
                          {'×'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground truncate">
                      {chat.lastMessage || ' '}
                    </span>
                    {chat.unreadCount > 0 ? (
                      <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground flex-shrink-0">
                        {String(chat.unreadCount)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
