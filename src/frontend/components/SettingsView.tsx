import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Dropdown, AutoManualToggle, useModelCatalog, useProfileCatalog } from './ModelProfileSelectors';
import type { PluginComponentProps } from '../hooks';
import { HISTORY_PER_CHAT_RANGE, TOOL_HISTORY_LIMIT_RANGES } from '../../shared/constants';

function formatSyncTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function SettingsField({ label, description, children }: { label: string; description?: string; children: any }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: any }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border/50 p-3">
      <legend className="px-1 text-[10px] font-medium text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        width: '36px',
        height: '20px',
        borderRadius: '10px',
        backgroundColor: active ? 'var(--color-primary, #3b82f6)' : 'rgba(128,128,128,0.3)',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'background-color 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: 'white',
          boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
          transition: 'transform 0.2s',
          transform: active ? 'translateX(18px)' : 'translateX(2px)',
        }}
      />
    </button>
  );
}

function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e: any) => onChange(e.target.value)}
      className="w-full rounded-xl border border-border/70 bg-card/80 px-2.5 py-1.5 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function SettingsView({
  onAction,
  pluginConfig,
  pluginState,
  setPluginConfig,
}: PluginComponentProps) {
  const config = pluginConfig ?? {};
  const state = (pluginState ?? {}) as any;
  const [testing, setTesting] = useState(false);
  const [newContactAddr, setNewContactAddr] = useState('');
  const [newContactName, setNewContactName] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);
  const secretCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const hasPassword = Boolean(state.hasPassword);
  const webhookSecret = (state.webhookSecret as string) ?? '';

  const updateField = useCallback((path: string, value: unknown) => {
    setPluginConfig?.(path, value);
  }, [setPluginConfig]);

  const updateBoundedInteger = useCallback((
    path: string,
    rawValue: string,
    range: { default: number; min: number; max: number },
  ) => {
    const parsed = Number.parseInt(rawValue, 10);
    const value = Number.isFinite(parsed)
      ? Math.min(range.max, Math.max(range.min, parsed))
      : range.default;
    updateField(path, value);
  }, [updateField]);

  const handleSavePassword = useCallback(() => {
    onAction('savePassword', { password: passwordDraft });
    setPasswordDraft('');
  }, [onAction, passwordDraft]);

  const handleCopySecret = useCallback(() => {
    if (!webhookSecret) return;
    void navigator.clipboard?.writeText(webhookSecret).then(() => {
      if (!mountedRef.current) return;
      if (secretCopiedTimerRef.current) clearTimeout(secretCopiedTimerRef.current);
      setSecretCopied(true);
      secretCopiedTimerRef.current = setTimeout(() => {
        setSecretCopied(false);
        secretCopiedTimerRef.current = null;
      }, 1500);
    });
  }, [webhookSecret]);

  const handleTestConnection = useCallback(async () => {
    if (testingTimerRef.current) clearTimeout(testingTimerRef.current);
    setTesting(true);
    onAction('testConnection');
    testingTimerRef.current = setTimeout(() => {
      setTesting(false);
      testingTimerRef.current = null;
    }, 3000);
  }, [onAction]);

  const handleAddContact = useCallback(() => {
    if (newContactAddr.trim() && newContactName.trim()) {
      onAction('saveContact', { address: newContactAddr.trim(), name: newContactName.trim() });
      setNewContactAddr('');
      setNewContactName('');
    }
  }, [onAction, newContactAddr, newContactName]);

  const inputClass = 'w-full rounded-xl border border-border/70 bg-card/80 px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none';

  const contactEntries = Object.entries((state.contacts ?? {}) as Record<string, string>);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (secretCopiedTimerRef.current) clearTimeout(secretCopiedTimerRef.current);
      if (testingTimerRef.current) clearTimeout(testingTimerRef.current);
    };
  }, []);

  // Group contacts by name to collapse duplicates (e.g. "SPAM" with 50+ numbers)
  const groupedContacts = React.useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const [address, name] of contactEntries) {
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(address);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [contactEntries.length, state.contacts]);

  return (
    <div className="space-y-6">
      {/* Connection section */}
      <SettingsSection title="Connection">
        <SettingsField
          label="Server URL"
          description="The URL of your BlueBubbles server (e.g. http://192.168.1.100:1234)"
        >
          <input
            type="text"
            value={(config as any).serverUrl ?? ''}
            onChange={(e: any) => updateField('serverUrl', e.target.value)}
            placeholder="http://192.168.1.100:1234"
            className={inputClass}
          />
        </SettingsField>

        <SettingsField
          label="Password"
          description={
            hasPassword
              ? `Saved (encrypted via ${state.secretsEncryptionMethod === 'os-keychain' ? 'OS keychain' : 'AES-256-GCM'}). Enter a new value to replace it.`
              : 'Stored encrypted via OS keychain (or AES-256-GCM fallback).'
          }
        >
          <div className="flex gap-2">
            <input
              type="password"
              value={passwordDraft}
              onChange={(e: any) => setPasswordDraft(e.target.value)}
              placeholder={hasPassword ? '•••••••• (saved)' : 'Server password'}
              className={inputClass}
            />
            <button
              type="button"
              onClick={handleSavePassword}
              disabled={!passwordDraft}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                passwordDraft
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted/50 text-muted-foreground/30'
              }`}
            >
              Save
            </button>
            {hasPassword && (
              <button
                type="button"
                onClick={() => onAction('savePassword', { password: '' })}
                className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-muted/30"
              >
                Clear
              </button>
            )}
          </div>
        </SettingsField>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !(config as any).serverUrl || !hasPassword}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              testing || !(config as any).serverUrl || !hasPassword
                ? 'bg-muted/50 text-muted-foreground/30'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>

          {state.connectionStatus === 'connected' ? (
            <span className="flex items-center gap-1.5 text-xs text-green-500">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Connected
              {state.serverInfo?.server_version ? (
                <span className="text-muted-foreground ml-1">{`v${state.serverInfo.server_version}`}</span>
              ) : null}
            </span>
          ) : state.connectionStatus === 'error' ? (
            <span className="text-xs text-red-400">{state.error ?? 'Connection failed'}</span>
          ) : null}
        </div>
      </SettingsSection>

      {/* Webhook section */}
      <SettingsSection title="Webhook">
        <p className="text-xs text-muted-foreground">
          Configure the local HTTP server that receives events from BlueBubbles.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <SettingsField label="Port">
            <input
              type="number"
              value={(config as any).webhookPort ?? 8742}
              onChange={(e: any) => updateField('webhookPort', parseInt(e.target.value, 10) || 8742)}
              className={inputClass}
            />
          </SettingsField>
          <SettingsField label="Bind Address">
            <input
              type="text"
              value={(config as any).webhookHost ?? '0.0.0.0'}
              onChange={(e: any) => updateField('webhookHost', e.target.value)}
              placeholder="0.0.0.0"
              className={inputClass}
            />
          </SettingsField>
        </div>

        <SettingsField
          label="Webhook Secret"
          description="Auto-generated. Required to authenticate incoming webhook requests — add it to your BlueBubbles webhook URL below."
        >
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={webhookSecret || '(generated on first connect)'}
              className={`${inputClass} font-mono text-[10px]`}
            />
            <button
              type="button"
              onClick={handleCopySecret}
              disabled={!webhookSecret}
              className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-muted/30 disabled:opacity-40"
            >
              {secretCopied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => onAction('regenerateWebhookSecret')}
              className="rounded-lg border border-border/70 px-3 py-1.5 text-xs font-medium hover:bg-muted/30"
            >
              Regenerate
            </button>
          </div>
        </SettingsField>

        <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Webhook URL for BlueBubbles:</p>
          <code className="block mt-1 break-all text-primary/80 select-all">
            {`http://<your-ip>:${(config as any).webhookPort ?? 8742}/webhook?secret=${webhookSecret || '<secret>'}`}
          </code>
        </div>
      </SettingsSection>

      {/* AI Auto-Reply section */}
      <SettingsSection title="AI Auto-Reply">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Enable AI Auto-Reply</div>
            <div className="text-xs text-muted-foreground">{"Use Kai's AI to intelligently respond to incoming messages"}</div>
          </div>
          <Toggle
            active={(config as any).aiReply?.enabled ?? false}
            onToggle={() => updateField('aiReply.enabled', !((config as any).aiReply?.enabled ?? false))}
          />
        </div>

        {(config as any).aiReply?.enabled ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <SettingsField label="DM Behavior">
                <Select
                  value={(config as any).aiReply?.dmBehavior ?? 'smart'}
                  options={[
                    { value: 'smart', label: 'Smart (AI decides)' },
                    { value: 'always', label: 'Always reply' },
                    { value: 'never', label: 'Never reply' },
                  ]}
                  onChange={(v: string) => updateField('aiReply.dmBehavior', v)}
                />
              </SettingsField>
              <SettingsField label="Group Chat Behavior">
                <Select
                  value={(config as any).aiReply?.groupBehavior ?? 'smart'}
                  options={[
                    { value: 'smart', label: 'Smart (AI decides)' },
                    { value: 'always', label: 'Always reply' },
                    { value: 'never', label: 'Never reply' },
                    { value: 'mentioned', label: 'Only when mentioned' },
                  ]}
                  onChange={(v: string) => updateField('aiReply.groupBehavior', v)}
                />
              </SettingsField>
            </div>

            <SettingsField
              label="System Prompt"
              description="Instructions for the AI personality and behavior"
            >
              <textarea
                value={(config as any).aiReply?.systemPrompt ?? ''}
                onChange={(e: any) => updateField('aiReply.systemPrompt', e.target.value)}
                placeholder="Leave empty for default prompt..."
                rows={5}
                className={inputClass + ' resize-y'}
              />
            </SettingsField>

            <div className="grid grid-cols-2 gap-3">
              <SettingsField
                label="Max History Per Chat"
                description={`Messages kept for AI context. Default ${HISTORY_PER_CHAT_RANGE.default}; range ${HISTORY_PER_CHAT_RANGE.min}–${HISTORY_PER_CHAT_RANGE.max}.`}
              >
                <input
                  type="number"
                  min={HISTORY_PER_CHAT_RANGE.min}
                  max={HISTORY_PER_CHAT_RANGE.max}
                  step={1}
                  value={(config as any).aiReply?.maxHistoryPerChat ?? HISTORY_PER_CHAT_RANGE.default}
                  onChange={(e: any) => updateBoundedInteger('aiReply.maxHistoryPerChat', e.target.value, HISTORY_PER_CHAT_RANGE)}
                  className={inputClass}
                />
              </SettingsField>
              <SettingsField
                label="Max Tool String Characters"
                description={`Characters kept per string in historical tool arguments/results. Default ${TOOL_HISTORY_LIMIT_RANGES.maxStringLength.default}; range ${TOOL_HISTORY_LIMIT_RANGES.maxStringLength.min}–${TOOL_HISTORY_LIMIT_RANGES.maxStringLength.max}.`}
              >
                <input
                  type="number"
                  min={TOOL_HISTORY_LIMIT_RANGES.maxStringLength.min}
                  max={TOOL_HISTORY_LIMIT_RANGES.maxStringLength.max}
                  step={1}
                  value={(config as any).aiReply?.toolHistoryMaxStringLength ?? TOOL_HISTORY_LIMIT_RANGES.maxStringLength.default}
                  onChange={(e: any) => updateBoundedInteger('aiReply.toolHistoryMaxStringLength', e.target.value, TOOL_HISTORY_LIMIT_RANGES.maxStringLength)}
                  className={inputClass}
                />
              </SettingsField>
              <SettingsField
                label="Max Tool Array Items"
                description={`Items kept per array in historical tool arguments/results. Default ${TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.default}; range ${TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.min}–${TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.max}.`}
              >
                <input
                  type="number"
                  min={TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.min}
                  max={TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.max}
                  step={1}
                  value={(config as any).aiReply?.toolHistoryMaxArrayLength ?? TOOL_HISTORY_LIMIT_RANGES.maxArrayLength.default}
                  onChange={(e: any) => updateBoundedInteger('aiReply.toolHistoryMaxArrayLength', e.target.value, TOOL_HISTORY_LIMIT_RANGES.maxArrayLength)}
                  className={inputClass}
                />
              </SettingsField>
              <SettingsField
                label="Max Tool Object Keys"
                description={`Keys kept per object in historical tool arguments/results. Default ${TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.default}; range ${TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.min}–${TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.max}.`}
              >
                <input
                  type="number"
                  min={TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.min}
                  max={TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.max}
                  step={1}
                  value={(config as any).aiReply?.toolHistoryMaxObjectKeys ?? TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys.default}
                  onChange={(e: any) => updateBoundedInteger('aiReply.toolHistoryMaxObjectKeys', e.target.value, TOOL_HISTORY_LIMIT_RANGES.maxObjectKeys)}
                  className={inputClass}
                />
              </SettingsField>
              <SettingsField
                label="Max Tool Nesting Depth"
                description={`Object/array levels kept in historical tool arguments/results. Default ${TOOL_HISTORY_LIMIT_RANGES.maxDepth.default}; range ${TOOL_HISTORY_LIMIT_RANGES.maxDepth.min}–${TOOL_HISTORY_LIMIT_RANGES.maxDepth.max}.`}
              >
                <input
                  type="number"
                  min={TOOL_HISTORY_LIMIT_RANGES.maxDepth.min}
                  max={TOOL_HISTORY_LIMIT_RANGES.maxDepth.max}
                  step={1}
                  value={(config as any).aiReply?.toolHistoryMaxDepth ?? TOOL_HISTORY_LIMIT_RANGES.maxDepth.default}
                  onChange={(e: any) => updateBoundedInteger('aiReply.toolHistoryMaxDepth', e.target.value, TOOL_HISTORY_LIMIT_RANGES.maxDepth)}
                  className={inputClass}
                />
              </SettingsField>
            </div>

            <SettingsModelProfileBar
              config={config as any}
              updateField={updateField}
            />
          </div>
        ) : null}
      </SettingsSection>

      {/* Message Chunking section */}
      <SettingsSection title="Message Chunking">
        <div className="grid grid-cols-2 gap-3">
          <SettingsField
            label="Max Chunk Length"
            description="Characters per message before splitting"
          >
            <input
              type="number"
              value={(config as any).chunking?.maxLength ?? 4000}
              onChange={(e: any) => updateField('chunking.maxLength', parseInt(e.target.value, 10) || 4000)}
              className={inputClass}
            />
          </SettingsField>
          <SettingsField
            label="Split Mode"
            description="How to break long messages"
          >
            <Select
              value={(config as any).chunking?.splitMode ?? 'sentence'}
              options={[
                { value: 'sentence', label: 'Sentence boundaries' },
                { value: 'word', label: 'Word boundaries' },
                { value: 'newline', label: 'Newlines' },
                { value: 'anywhere', label: 'Exact character count' },
              ]}
              onChange={(v: string) => updateField('chunking.splitMode', v)}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      {/* Contacts section */}
      <SettingsSection title="Contacts">
        <p className="text-xs text-muted-foreground mb-2">
          Saved contact names are used by the AI to understand who is messaging and shown in the chat UI.
          Contact photos from macOS Contacts and iMessage require Full Disk Access.
        </p>

        <div className="mb-3">
          <button
            type="button"
            onClick={() => onAction('openFdaSettings')}
            className="rounded-md px-2.5 py-1 text-xs font-medium bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors"
          >
            Open Full Disk Access Settings
          </button>
        </div>

        {/* Sync status summary */}
        {state.contactSyncInfo ? (
          <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/40 px-3 py-2 mb-3">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{state.contactSyncInfo.syncedCount}</span> contacts synced from BlueBubbles
              {state.contactSyncInfo.photoCount > 0 ? (
                <span> ({state.contactSyncInfo.photoCount} with photos)</span>
              ) : null}
              {state.contactSyncInfo.lastSyncTime ? (
                <span className="ml-1.5 text-muted-foreground/60">
                  {' · '}last synced {formatSyncTime(state.contactSyncInfo.lastSyncTime)}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onAction('syncContacts')}
              className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              Re-sync
            </button>
          </div>
        ) : state.connectionStatus === 'connected' ? (
          <div className="flex items-center justify-between rounded-lg bg-muted/30 border border-border/40 px-3 py-2 mb-3">
            <div className="text-xs text-muted-foreground">No contacts synced from BlueBubbles yet.</div>
            <button
              type="button"
              onClick={() => onAction('syncContacts')}
              className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              Sync Now
            </button>
          </div>
        ) : null}

        {groupedContacts.length > 0 ? (
          <div className="rounded-lg border border-border/50 overflow-hidden mb-3 max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Addresses</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-16">Source</th>
                  <th className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {groupedContacts.map(([name, addresses]) => {
                  const isSynced = addresses.some(a => state.contactSyncInfo?.syncedAddresses?.includes(a));
                  return (
                    <tr key={name + addresses[0]} className="border-b border-border/30 last:border-0">
                      <td className="px-3 py-2 font-medium">{name}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {addresses.length <= 3 ? (
                          addresses.join(', ')
                        ) : (
                          <span title={addresses.join('\n')}>
                            {addresses.slice(0, 2).join(', ')}
                            <span className="text-muted-foreground ml-1">+{addresses.length - 2} more</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {isSynced ? (
                          <span className="inline-flex items-center rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                            BB
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            manual
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => {
                            for (const address of addresses) {
                              onAction('deleteContact', { address });
                            }
                          }}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Remove{addresses.length > 1 ? ' all' : ''}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground/60 py-2">No contacts saved yet.</div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <input
              type="text"
              value={newContactAddr}
              onChange={(e: any) => setNewContactAddr(e.target.value)}
              placeholder="Phone or email"
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <input
              type="text"
              value={newContactName}
              onChange={(e: any) => setNewContactName(e.target.value)}
              placeholder="Display name"
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={handleAddContact}
            disabled={!newContactAddr.trim() || !newContactName.trim()}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              newContactAddr.trim() && newContactName.trim()
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted/50 text-muted-foreground/30'
            }`}
          >
            Add
          </button>
        </div>
      </SettingsSection>

      {/* Notifications section */}
      <SettingsSection title="Notifications">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Show Notifications</div>
            <div className="text-xs text-muted-foreground">Display native notifications for new messages</div>
          </div>
          <Toggle
            active={(config as any).notifications !== false}
            onToggle={() => updateField('notifications', !((config as any).notifications !== false))}
          />
        </div>
      </SettingsSection>

      {/* Diagnostics section */}
      <SettingsSection title="Diagnostics">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Advanced Debug Logs</div>
            <div className="text-xs text-muted-foreground">
              Store detailed rolling logs at ~/.kai/plugin-logs/bluebubbles/advanced-debug.log
            </div>
          </div>
          <Toggle
            active={(config as any).advancedDebugLogs === true}
            onToggle={() => updateField('advancedDebugLogs', !((config as any).advancedDebugLogs === true))}
          />
        </div>
        <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
          Max file size: 20MB. The active file rolls to advanced-debug.1.log when full.
        </div>
      </SettingsSection>

      {/* Server Info section */}
      {state.serverInfo ? (
        <SettingsSection title="Server Info">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Server Version:</span>
            <span>{state.serverInfo.server_version ?? 'Unknown'}</span>
            <span className="text-muted-foreground">macOS Version:</span>
            <span>{state.serverInfo.os_version ?? 'Unknown'}</span>
            <span className="text-muted-foreground">Private API:</span>
            <span>{state.privateApiEnabled ? 'Enabled' : 'Disabled'}</span>
            <span className="text-muted-foreground">Proxy:</span>
            <span>{state.serverInfo.proxy_service ?? 'None'}</span>
          </div>
        </SettingsSection>
      ) : null}
    </div>
  );
}

function SettingsModelProfileBar({ config, updateField }: { config: any; updateField: (path: string, value: unknown) => void }) {
  const { models } = useModelCatalog();
  const { profiles } = useProfileCatalog();
  const [localOverrides, setLocalOverrides] = useState<Record<string, unknown>>({});

  const getValue = (key: string, configPath: string) => {
    if (key in localOverrides) return localOverrides[key] as string;
    const parts = configPath.split('.');
    let val: any = config;
    for (const p of parts) val = val?.[p];
    return val ?? '';
  };

  const update = (key: string, path: string, value: unknown) => {
    setLocalOverrides((prev) => ({ ...prev, [key]: value ?? '' }));
    updateField(path, value);
  };

  const isAuto = getValue('fallback', 'aiReply.fallbackEnabled') === true || getValue('fallback', 'aiReply.fallbackEnabled') === 'true';
  const selectedProfileKey = getValue('profile', 'aiReply.profileOverride') as string;
  const selectedProfile = profiles.find((p: any) => p.key === selectedProfileKey);

  const modelOptions = [
    { value: '', label: 'Default' },
    ...models.map((m: any) => ({ value: m.key, label: m.displayName })),
  ];

  const profileOptions = [
    { value: '', label: 'Default (no profile)' },
    ...profiles.map((p: any) => ({ value: p.key, label: p.name })),
  ];

  const thinkingOptions = [
    { value: '', label: 'Default' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'xhigh', label: 'Extra High' },
  ];

  const handleProfileChange = (key: string) => {
    const profile = profiles.find((p: any) => p.key === key);
    update('profile', 'aiReply.profileOverride', key || undefined);
    update('fallback', 'aiReply.fallbackEnabled', Boolean(key));
    if (profile) {
      update('model', 'aiReply.modelOverride', profile.primaryModelKey);
    } else {
      update('model', 'aiReply.modelOverride', undefined);
    }
  };

  const handleAutoToggle = (auto: boolean) => {
    update('fallback', 'aiReply.fallbackEnabled', auto);
    if (auto && selectedProfile) {
      update('model', 'aiReply.modelOverride', selectedProfile.primaryModelKey);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        alignItems: 'center',
        padding: '8px 0',
      }}
    >
      <Dropdown
        label="Select profile"
        icon={'👤'}
        value={selectedProfileKey}
        options={profileOptions}
        onChange={handleProfileChange}
        direction="down"
      />
      <AutoManualToggle
        enabled={isAuto}
        onToggle={handleAutoToggle}
      />
      <Dropdown
        label="Select model"
        icon={'⚙'}
        value={getValue('model', 'aiReply.modelOverride') as string}
        options={modelOptions}
        onChange={(v: string) => update('model', 'aiReply.modelOverride', v || undefined)}
        disabled={isAuto}
        direction="down"
      />
      <Dropdown
        label="Select thinking"
        icon={'🧠'}
        value={getValue('thinking', 'aiReply.reasoningEffort') as string}
        options={thinkingOptions}
        onChange={(v: string) => update('thinking', 'aiReply.reasoningEffort', v || undefined)}
        direction="down"
      />
    </div>
  );
}
