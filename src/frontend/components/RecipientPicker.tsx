import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { XIcon } from '../icons';

export type Recipient = {
  address: string;
  displayName: string;
};

type RecipientPickerProps = {
  contacts: Record<string, string>; // address → display name
  contactPhotos?: Record<string, string>; // address → photo data URI
  recipients: Recipient[];
  onRecipientsChange: (recipients: Recipient[]) => void;
};

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function isPhoneNumber(input: string): boolean {
  const digits = input.replace(/\D/g, '');
  return /^\+?\d/.test(input.trim()) && digits.length >= 7;
}

function isEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

function formatAddress(address: string): string {
  if (address.startsWith('+1') && address.length === 12) {
    const d = address.slice(2);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return address;
}

export function RecipientPicker({
  contacts,
  contactPhotos = {},
  recipients,
  onRecipientsChange,
}: RecipientPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showValidationHint, setShowValidationHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build contact entries for filtering
  const contactEntries = useMemo(() => {
    return Object.entries(contacts).map(([address, name]) => ({ address, name }));
  }, [contacts]);

  // Filter contacts for autocomplete suggestions
  const suggestions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    if (!query) return [];

    const selectedAddresses = new Set(recipients.map((r) => r.address));
    const queryDigits = query.replace(/\D/g, '');

    return contactEntries
      .filter(({ address, name }) => {
        if (selectedAddresses.has(address)) return false;
        if (name.toLowerCase().includes(query)) return true;
        if (address.toLowerCase().includes(query)) return true;
        // Digit-based phone matching
        if (queryDigits.length >= 3) {
          const addrDigits = address.replace(/\D/g, '');
          if (addrDigits.includes(queryDigits)) return true;
        }
        return false;
      })
      .slice(0, 8);
  }, [inputValue, contactEntries, recipients]);

  const addRecipient = useCallback(
    (address: string, displayName?: string) => {
      const normalized = isPhoneNumber(address) ? normalizePhone(address) : address.trim().toLowerCase();
      // Prevent duplicates
      if (recipients.some((r) => r.address === normalized)) return;

      const name = displayName ?? contacts[normalized] ?? formatAddress(normalized);
      onRecipientsChange([...recipients, { address: normalized, displayName: name }]);
      setInputValue('');
      setHighlightedIndex(-1);
      setShowValidationHint(false);
      inputRef.current?.focus();
    },
    [recipients, contacts, onRecipientsChange],
  );

  const removeRecipient = useCallback(
    (address: string) => {
      onRecipientsChange(recipients.filter((r) => r.address !== address));
    },
    [recipients, onRecipientsChange],
  );

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        const { address, name } = suggestions[highlightedIndex];
        addRecipient(address, name);
      } else {
        commitRawInput();
      }
    } else if (e.key === 'Backspace' && inputValue === '' && recipients.length > 0) {
      const last = recipients[recipients.length - 1];
      removeRecipient(last.address);
    } else {
      setShowValidationHint(false);
    }
  };

  const commitRawInput = () => {
    const value = inputValue.trim().replace(/,+$/, '');
    if (!value) return;

    if (isPhoneNumber(value)) {
      addRecipient(value);
    } else if (isEmail(value)) {
      addRecipient(value);
    } else {
      // Try exact name match
      const match = contactEntries.find(
        ({ name }) => name.toLowerCase() === value.toLowerCase(),
      );
      if (match) {
        addRecipient(match.address, match.name);
      } else {
        setShowValidationHint(true);
      }
    }
  };

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset highlighted index when suggestions change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions.length]);

  return (
    <div style={{ flexShrink: 0, position: 'relative' }}>
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '4px',
          minHeight: '44px',
        }}
      >
        <span className="text-sm text-muted-foreground font-medium" style={{ marginRight: '4px' }}>
          To:
        </span>

        {/* Recipient chips */}
        {recipients.map((recipient) => (
          <span
            key={recipient.address}
            className="inline-flex items-center gap-1 rounded-full text-xs font-medium"
            style={{
              backgroundColor: 'hsl(var(--primary) / 0.12)',
              color: 'hsl(var(--primary))',
              border: '1px solid hsl(var(--primary) / 0.25)',
              padding: '3px 8px 3px 10px',
              maxWidth: '180px',
            }}
          >
            <span className="truncate">{recipient.displayName}</span>
            <button
              type="button"
              onClick={() => removeRecipient(recipient.address)}
              className="flex-shrink-0 rounded-full hover:bg-primary/20 transition-colors"
              style={{ padding: '1px', lineHeight: 0 }}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}

        {/* Input for typing */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={() => {
            // Small delay so click on suggestion registers
            setTimeout(() => setHighlightedIndex(-1), 150);
          }}
          placeholder={recipients.length === 0 ? 'Name, phone, or email...' : ''}
          className="flex-1 min-w-[100px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          style={{ border: 'none', padding: '3px 0' }}
        />
      </div>

      {/* Validation hint */}
      {showValidationHint && (
        <div className="text-xs text-destructive px-3 py-1" style={{ borderBottom: '1px solid var(--border)' }}>
          Enter a valid phone number, email, or contact name.
        </div>
      )}

      {/* Autocomplete suggestions dropdown */}
      {suggestions.length > 0 && inputValue.trim() && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: '240px',
            overflowY: 'auto',
          }}
          className="border border-border bg-popover rounded-lg shadow-lg mx-2 mt-1"
        >
          {suggestions.map(({ address, name }, index) => (
            <button
              key={address}
              type="button"
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                index === highlightedIndex ? 'bg-muted' : 'hover:bg-muted/50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur
                addRecipient(address, name);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {/* Contact photo or initial */}
              <div
                className="flex-shrink-0 rounded-full flex items-center justify-center text-xs font-semibold"
                style={{
                  width: '28px',
                  height: '28px',
                  backgroundColor: contactPhotos[address] ? 'transparent' : 'hsl(var(--muted))',
                  backgroundImage: contactPhotos[address] ? `url(${contactPhotos[address]})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  color: 'hsl(var(--muted-foreground))',
                }}
              >
                {!contactPhotos[address] && name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{name}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {formatAddress(address)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
