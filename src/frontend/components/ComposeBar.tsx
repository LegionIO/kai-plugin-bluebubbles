import React, { useState, useCallback, useRef, useEffect } from 'react';
import { SendIcon, XIcon } from '../icons';

type StagedFile = {
  file: File;
  previewUrl: string;
};

type ComposeBarProps = {
  onSend: (text: string, attachments?: File[]) => void;
  sending: boolean;
  replyTo: any | null;
  onCancelReply: () => void;
  onTyping?: () => void;
  allowAttach?: boolean;
};

export function ComposeBar({ onSend, sending, replyTo, onCancelReply, onTyping, allowAttach }: ComposeBarProps) {
  const [text, setText] = useState('');
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef<number>(0);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    };
  }, []);

  const handleTextChange = useCallback((e: any) => {
    setText(e.target.value);
    if (onTyping && e.target.value) {
      const now = Date.now();
      if (now - lastTypingRef.current > 3000) {
        lastTypingRef.current = now;
        onTyping();
      }
    }
  }, [onTyping]);

  const hasContent = text.trim() || staged.length > 0;

  const handleSend = useCallback(() => {
    if (!hasContent || sending) return;
    const files = staged.map((s) => s.file);
    onSend(text.trim(), files.length > 0 ? files : undefined);
    staged.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    setText('');
    setStaged([]);
  }, [text, staged, sending, onSend, hasContent]);

  const handleKeyDown = useCallback((e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileSelect = useCallback((e: any) => {
    const files = Array.from(e.target.files ?? []) as File[];
    if (files.length > 0) {
      const newStaged = files.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setStaged((prev) => [...prev, ...newStaged]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removeStaged = useCallback((index: number) => {
    setStaged((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  return (
    <div className="border-t border-border/50" style={{ flexShrink: 0 }}>
      {/* Reply indicator */}
      {replyTo ? (
        <div className="flex items-center gap-2 border-b border-border/30 px-4 py-2 text-xs text-muted-foreground">
          <div className="h-4 w-0.5 rounded-full bg-primary" />
          <span className="flex-1 truncate">
            {`Replying to: ${replyTo.text?.slice(0, 60) ?? '[Attachment]'}`}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            className="text-muted-foreground/60 hover:text-muted-foreground"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {/* Staged attachment previews */}
      {staged.length > 0 ? (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            padding: '8px 12px',
            overflowX: 'auto',
            borderBottom: '1px solid var(--color-border, rgba(128,128,128,0.15))',
          }}
        >
          {staged.map((s, i) => (
            <div
              key={i}
              style={{
                position: 'relative',
                flexShrink: 0,
                width: '64px',
                height: '64px',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid var(--color-border, rgba(128,128,128,0.2))',
              }}
            >
              {s.file.type.startsWith('video/') ? (
                <video
                  src={s.previewUrl}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <img
                  src={s.previewUrl}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              <button
                type="button"
                onClick={() => removeStaged(i)}
                style={{
                  position: 'absolute',
                  top: '2px',
                  right: '2px',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: 'none',
                  background: 'rgba(0,0,0,0.6)',
                  color: '#fff',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {'×'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {/* Input area */}
      <div
        className="flex items-center gap-2"
        style={{ padding: '10px 12px 22px' }}
      >
        {/* Attach button */}
        {allowAttach ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              border: '1.5px solid var(--color-muted-foreground, #888)',
              background: 'none',
              cursor: 'pointer',
              fontSize: '18px',
              color: 'var(--color-muted-foreground, #888)',
              flexShrink: 0,
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseOver={(e: any) => { e.currentTarget.style.color = 'var(--color-foreground, #333)'; e.currentTarget.style.borderColor = 'var(--color-foreground, #333)'; }}
            onMouseOut={(e: any) => { e.currentTarget.style.color = 'var(--color-muted-foreground, #888)'; e.currentTarget.style.borderColor = 'var(--color-muted-foreground, #888)'; }}
            title="Attach image or video"
          >
            {'+'}
          </button>
        ) : null}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="iMessage"
          rows={1}
          className="flex-1 resize-none rounded-2xl border border-border/50 bg-muted/30 px-4 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!hasContent || sending}
          style={{
            display: 'flex',
            width: '36px',
            height: '36px',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            border: 'none',
            cursor: hasContent && !sending ? 'pointer' : 'default',
            background: hasContent && !sending ? 'var(--color-primary, #3b82f6)' : 'var(--color-muted, #e5e7eb)',
            color: hasContent && !sending ? '#fff' : 'var(--color-muted-foreground, #aaa)',
            transition: 'background 0.15s, color 0.15s',
            flexShrink: 0,
          }}
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
