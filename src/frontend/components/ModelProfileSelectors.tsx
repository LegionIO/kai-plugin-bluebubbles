import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeftRightIcon, ChevronDownIcon } from '../icons';
import { useDarkMode } from '../hooks';

const appApi = () => (globalThis as any).window?.app;

type ModelInfo = { key: string; displayName: string };
type ProfileInfo = { key: string; name: string; primaryModelKey: string };

export function useModelCatalog() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultKey, setDefaultKey] = useState<string | null>(null);
  useEffect(() => {
    appApi()?.modelCatalog?.()
      .then((data: any) => {
        setModels(data?.models ?? []);
        setDefaultKey(data?.defaultKey ?? null);
      })
      .catch(() => {});
  }, []);
  return { models, defaultKey };
}

export function useProfileCatalog() {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [defaultKey, setDefaultKey] = useState<string | null>(null);
  useEffect(() => {
    appApi()?.profileCatalog?.()
      .then((data: any) => {
        setProfiles(data?.profiles ?? []);
        setDefaultKey(data?.defaultKey ?? null);
      })
      .catch(() => {});
  }, []);
  return { profiles, defaultKey };
}

type DropdownProps = {
  label: string;
  icon: React.ReactNode;
  value: string;
  options: Array<{ value: string; label: string; detail?: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  direction?: 'up' | 'down';
};

export function Dropdown({ label, icon, value, options, onChange, disabled, direction = 'down' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const isDark = useDarkMode();

  useEffect(() => {
    if (!open) return;
    const handler = (e: any) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  // Theme-aware colors
  // In dark mode, native Kai buttons are transparent/borderless with foreground-colored text
  // Note: oklch() with nested var() may fail for some CSS variables (e.g. --color-popover)
  // so we provide appropriate dark fallbacks alongside the CSS variable references.
  const btnBg = isDark ? 'transparent' : 'var(--color-card, rgba(255,255,255,0.7))';
  const btnColor = isDark ? 'var(--color-foreground, #e8e0d4)' : 'var(--color-foreground, #1f2937)';
  const btnBorder = isDark ? 'transparent' : 'var(--color-border, rgba(128,128,128,0.25))';
  const popoverBg = isDark ? 'var(--color-popover, #2a2720)' : 'var(--color-popover, rgba(255,255,255,0.95))';
  const popoverColor = isDark ? 'var(--color-foreground, #e8e0d4)' : 'var(--color-foreground, #1f2937)';
  const popoverBorder = isDark ? 'var(--color-border, rgba(255,255,255,0.08))' : 'var(--color-border, rgba(128,128,128,0.25))';
  const hoverBg = isDark ? 'var(--color-muted, rgba(255,255,255,0.08))' : 'rgba(128,128,128,0.1)';
  const mutedColor = isDark ? 'var(--color-muted-foreground, #a89e8c)' : 'var(--color-muted-foreground, #888)';

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          borderRadius: '12px',
          border: `1px solid ${btnBorder}`,
          background: btnBg,
          padding: '4px 10px',
          fontSize: '11px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          color: btnColor,
          transition: 'background 0.15s',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
        <span style={{ fontWeight: 500, maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.label ?? label}</span>
        <ChevronDownIcon size={10} />
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            [direction === 'down' ? 'top' : 'bottom']: '100%',
            [direction === 'down' ? 'marginTop' : 'marginBottom']: '6px',
            left: 0,
            zIndex: 50,
            width: '240px',
            borderRadius: '16px',
            border: `1px solid ${popoverBorder}`,
            background: popoverBg,
            color: popoverColor,
            padding: '6px',
            boxShadow: '0 16px 40px rgba(5,4,15,0.28)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div style={{ padding: '6px 12px', fontSize: '13px', fontWeight: 500, color: mutedColor }}>{label}</div>
          <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  gap: '8px',
                  borderRadius: '12px',
                  padding: '8px 12px',
                  fontSize: '13px',
                  border: 'none',
                  background: opt.value === value ? 'var(--color-primary, #3b82f6)' : 'none',
                  color: opt.value === value ? 'var(--color-primary-foreground, #fff)' : popoverColor,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseOver={(e: any) => { if (opt.value !== value) e.currentTarget.style.background = hoverBg; }}
                onMouseOut={(e: any) => { if (opt.value !== value) e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ flex: 1, fontWeight: 500 }}>{opt.label}</span>
                {opt.detail ? <span style={{ fontSize: '10px', opacity: 0.6 }}>{opt.detail}</span> : null}
                {opt.value === value ? <span>{'✓'}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AutoManualToggleProps = {
  enabled: boolean;
  onToggle: (value: boolean) => void;
};

export function AutoManualToggle({ enabled, onToggle }: AutoManualToggleProps) {
  const isDark = useDarkMode();
  const btnBg = enabled ? 'rgba(59,130,246,0.1)' : (isDark ? 'transparent' : 'var(--color-card, rgba(255,255,255,0.7))');
  const btnColor = enabled ? 'var(--color-primary, #3b82f6)' : (isDark ? 'var(--color-foreground, #e8e0d4)' : 'var(--color-foreground, #1f2937)');
  const btnBorder = enabled ? 'var(--color-primary, #3b82f6)' : (isDark ? 'transparent' : 'var(--color-border, rgba(128,128,128,0.25))');

  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      title={enabled ? 'Auto-routing enabled (click for manual)' : 'Manual routing (click for auto)'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        borderRadius: '12px',
        border: `1px solid ${btnBorder}`,
        background: btnBg,
        color: btnColor,
        padding: '4px 10px',
        fontSize: '11px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <ArrowLeftRightIcon size={12} />
      <span>{enabled ? 'Auto' : 'Manual'}</span>
    </button>
  );
}
