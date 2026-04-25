import { useState } from '../hooks';
import { AttachmentPreview } from './AttachmentPreview';

const h = (...args: any[]) => (globalThis as any).React.createElement(...args);

type MessageBubbleProps = {
  message: any;
  isGroup: boolean;
  grouped: boolean;
  time: string;
  privateApiEnabled: boolean;
  showToolCalls?: boolean;
  onReact: (reactionType?: string) => void;
  onReply: () => void;
  onEdit: (text: string) => void;
  onUnsend: () => void;
};

const REACTION_EMOJI: Record<string, string> = {
  love: '\u2764\uFE0F',
  like: '\uD83D\uDC4D',
  dislike: '\uD83D\uDC4E',
  laugh: '\uD83D\uDE02',
  emphasize: '\u2757',
  question: '\u2753',
};

export function MessageBubble({
  message,
  isGroup,
  grouped,
  time,
  privateApiEnabled,
  showToolCalls,
  onReact,
  onReply,
  onEdit,
  onUnsend,
}: MessageBubbleProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [hovered, setHovered] = useState(false);

  const isMe = message.isFromMe;

  if (message.isUnsent) {
    return h('div', {
      className: `flex ${isMe ? 'justify-end' : 'justify-start'} ${grouped ? 'mt-0.5' : 'mt-3'}`,
    },
      h('div', {
        className: 'rounded-2xl px-3 py-1.5 text-xs italic text-muted-foreground/50 border border-dashed border-border/30',
      }, 'Message unsent'),
    );
  }

  const sentBubbleStyle = {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
  };
  const receivedBubbleStyle = {
    backgroundColor: 'var(--color-muted, #e5e7eb)',
    color: 'var(--color-foreground, #1f2937)',
    border: '1px solid var(--color-border, rgba(128,128,128,0.15))',
  };

  const borderRadius = isMe
    ? (grouped ? 'rounded-2xl rounded-tr-md' : 'rounded-2xl')
    : (grouped ? 'rounded-2xl rounded-tl-md' : 'rounded-2xl');

  const handleContextMenu = (e: any) => {
    e.preventDefault();
    setShowMenu(!showMenu);
  };

  const handleSubmitEdit = () => {
    if (editText.trim() && editText !== message.text) {
      onEdit(editText);
    }
    setEditing(false);
  };

  const reactions = (message.reactions ?? []) as any[];
  const reactionGroups: Record<string, { count: number; hasFromMe: boolean; senders: string[] }> = {};
  for (const r of reactions) {
    if (!reactionGroups[r.type]) {
      reactionGroups[r.type] = { count: 0, hasFromMe: false, senders: [] };
    }
    reactionGroups[r.type].count += 1;
    reactionGroups[r.type].senders.push(r.isFromMe ? 'You' : (r.sender || 'Someone'));
    if (r.isFromMe) reactionGroups[r.type].hasFromMe = true;
  }

  return h('div', {
    style: {
      display: 'flex',
      justifyContent: isMe ? 'flex-end' : 'flex-start',
      marginTop: grouped ? '2px' : '12px',
      position: 'relative',
      zIndex: hovered ? 10 : 'auto',
    },
  },
    h('div', {
      style: {
        maxWidth: '70%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: isMe ? 'flex-end' : 'flex-start',
        position: 'relative',
        minWidth: '40px',
      },
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => { setHovered(false); setShowMenu(false); },
    },

      // Quick react bar on hover
      hovered && !showMenu && !editing
        ? h('div', {
            style: {
              display: 'flex',
              gap: '1px',
              marginBottom: '2px',
              borderRadius: '12px',
              padding: '2px 4px',
              backgroundColor: 'var(--color-card, #fff)',
              border: '1px solid var(--color-border, rgba(128,128,128,0.15))',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            },
          },
            ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'].map((type) =>
              h('button', {
                key: type,
                type: 'button',
                onClick: (e: any) => { e.stopPropagation(); onReact(type); },
                style: {
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 3px',
                  fontSize: '13px',
                  lineHeight: 1,
                  borderRadius: '6px',
                  transition: 'background 0.15s',
                },
                onMouseOver: (e: any) => { e.currentTarget.style.background = 'var(--color-muted, #e5e7eb)'; },
                onMouseOut: (e: any) => { e.currentTarget.style.background = 'none'; },
                title: type.charAt(0).toUpperCase() + type.slice(1),
              }, REACTION_EMOJI[type]),
            ),
          )
        : null,
      // Sender name (group chats, received messages, not grouped)
      !isMe && isGroup && !grouped
        ? h('span', { className: 'mb-0.5 ml-3 text-[11px] font-medium text-muted-foreground' }, message.senderName)
        : null,

      // Message bubble
      h('div', {
        onContextMenu: handleContextMenu,
        style: isMe ? sentBubbleStyle : receivedBubbleStyle,
        className: `relative ${borderRadius} px-3 py-2 text-sm break-words cursor-default`,
      },
        // Editing mode
        editing
          ? h('div', { className: 'flex flex-col gap-1' },
              h('textarea', {
                value: editText,
                onChange: (e: any) => setEditText(e.target.value),
                className: 'w-full resize-none rounded bg-white/20 p-1 text-sm outline-none',
                rows: 2,
                autoFocus: true,
              }),
              h('div', { className: 'flex gap-1 justify-end' },
                h('button', {
                  type: 'button',
                  onClick: () => setEditing(false),
                  className: 'rounded px-2 py-0.5 text-xs bg-white/20 hover:bg-white/30',
                }, 'Cancel'),
                h('button', {
                  type: 'button',
                  onClick: handleSubmitEdit,
                  className: 'rounded px-2 py-0.5 text-xs bg-white/30 hover:bg-white/40 font-medium',
                }, 'Save'),
              ),
            )
          : h('span', { style: { whiteSpace: 'pre-wrap' } },
              message.text,
              message.isEdited
                ? h('span', { className: 'ml-1 text-[10px] opacity-60' }, '(edited)')
                : null,
            ),

        // Attachments
        (message.attachments ?? []).length > 0
          ? h('div', { className: 'mt-1.5 space-y-1' },
              message.attachments.map((att: any) =>
                h(AttachmentPreview, { key: att.guid, attachment: att }),
              ),
            )
          : null,

        // Tool calls (when enabled)
        showToolCalls && message.toolCalls?.length > 0
          ? h('div', {
              style: {
                marginTop: '6px',
                borderTop: '1px solid rgba(255,255,255,0.2)',
                paddingTop: '4px',
                fontSize: '10px',
                opacity: 0.8,
              },
            },
              message.toolCalls.map((tc: any, i: number) =>
                h('div', {
                  key: i,
                  style: {
                    padding: '3px 0',
                    borderBottom: i < message.toolCalls.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  },
                },
                  h('div', { style: { fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' } },
                    h('span', null, '\uD83D\uDD27'),
                    h('span', null, tc.toolName),
                    tc.durationMs ? h('span', { style: { opacity: 0.6, fontWeight: 400 } }, `${tc.durationMs}ms`) : null,
                    tc.error ? h('span', { style: { color: '#f87171' } }, '\u2718') : h('span', { style: { color: '#4ade80' } }, '\u2714'),
                  ),
                  h('details', { style: { marginTop: '2px' } },
                    h('summary', { style: { cursor: 'pointer', opacity: 0.7 } }, 'Details'),
                    h('pre', {
                      style: {
                        fontSize: '9px',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        maxHeight: '100px',
                        overflow: 'auto',
                        margin: '2px 0',
                        padding: '4px',
                        borderRadius: '4px',
                        background: 'rgba(0,0,0,0.15)',
                      },
                    },
                      `Args: ${JSON.stringify(tc.args, null, 1)}\nResult: ${typeof tc.result === 'string' ? tc.result.slice(0, 500) : JSON.stringify(tc.result, null, 1)?.slice(0, 500)}`,
                    ),
                    tc.error ? h('div', { style: { color: '#f87171', marginTop: '2px' } }, `Error: ${tc.error}`) : null,
                  ),
                ),
              ),
            )
          : null,
      ),

      // Reactions
      Object.keys(reactionGroups).length > 0
        ? h('div', { className: `flex gap-0.5 mt-0.5 ${isMe ? 'mr-2 justify-end' : 'ml-2'}` },
            Object.entries(reactionGroups).map(([type, { count, hasFromMe, senders }]) =>
              h('span', {
                key: type,
                title: senders.join(', '),
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '2px',
                  borderRadius: '9999px',
                  padding: '2px 6px',
                  fontSize: '10px',
                  cursor: 'default',
                  backgroundColor: hasFromMe ? '#3b82f6' : 'var(--color-muted, #e5e7eb)',
                  color: hasFromMe ? '#ffffff' : 'var(--color-foreground, #1f2937)',
                },
              },
                h('span', null, REACTION_EMOJI[type] ?? type),
                count > 1 ? h('span', { style: { opacity: 0.8 } }, String(count)) : null,
              ),
            ),
          )
        : null,

      // Time + status (not grouped)
      !grouped
        ? h('div', { className: `flex items-center gap-1 mt-0.5 ${isMe ? 'mr-2 justify-end' : 'ml-2'} text-[10px] text-muted-foreground/50` },
            h('span', null, time),
            isMe && message.error
              ? h('span', { className: 'text-red-400' }, 'Failed')
              : isMe && message.isRead
                ? h('span', null, 'Read')
                : isMe && message.isDelivered
                  ? h('span', null, 'Delivered')
                  : null,
          )
        : null,

      // Context menu
      showMenu
        ? h('div', {
            className: 'mt-1 rounded-lg border border-border/50 bg-card shadow-lg p-1 text-xs',
          },
            privateApiEnabled
              ? h('button', {
                  type: 'button',
                  onClick: () => { onReact(); setShowMenu(false); },
                  className: 'w-full rounded px-3 py-1.5 text-left hover:bg-muted/50',
                }, 'React')
              : null,
            h('button', {
              type: 'button',
              onClick: () => { onReply(); setShowMenu(false); },
              className: 'w-full rounded px-3 py-1.5 text-left hover:bg-muted/50',
            }, 'Reply'),
            isMe && privateApiEnabled
              ? h('button', {
                  type: 'button',
                  onClick: () => { setEditing(true); setShowMenu(false); },
                  className: 'w-full rounded px-3 py-1.5 text-left hover:bg-muted/50',
                }, 'Edit')
              : null,
            isMe && privateApiEnabled
              ? h('button', {
                  type: 'button',
                  onClick: () => { onUnsend(); setShowMenu(false); },
                  className: 'w-full rounded px-3 py-1.5 text-left text-red-400 hover:bg-muted/50',
                }, 'Unsend')
              : null,
          )
        : null,
    ),
  );
}
