import React, { useState, useCallback } from 'react';
import { Dropdown, AutoManualToggle, useModelCatalog, useProfileCatalog } from './ModelProfileSelectors';
import type { PluginComponentProps } from '../hooks';

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

  const updateField = useCallback((path: string, value: unknown) => {
    setPluginConfig?.(path, value);
  }, [setPluginConfig]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    onAction('testConnection');
    setTimeout(() => setTesting(false), 3000);
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

        <SettingsField label="Password">
          <input
            type="password"
            value={(config as any).password ?? ''}
            onChange={(e: any) => updateField('password', e.target.value)}
            placeholder="Server password"
            className={inputClass}
          />
        </SettingsField>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !(config as any).serverUrl || !(config as any).password}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              testing || !(config as any).serverUrl || !(config as any).password
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
          description="Optional secret to authenticate incoming webhook requests"
        >
          <input
            type="password"
            value={(config as any).webhookSecret ?? ''}
            onChange={(e: any) => updateField('webhookSecret', e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </SettingsField>

        <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Webhook URL for BlueBubbles:</p>
          <code className="block mt-1 text-primary/80 select-all">
            {`http://<your-ip>:${(config as any).webhookPort ?? 8742}/webhook${(config as any).webhookSecret ? `?secret=${(config as any).webhookSecret}` : ''}`}
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
                description="Messages kept for AI context"
              >
                <input
                  type="number"
                  value={(config as any).aiReply?.maxHistoryPerChat ?? 50}
                  onChange={(e: any) => updateField('aiReply.maxHistoryPerChat', parseInt(e.target.value, 10) || 50)}
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
        </p>

        {contactEntries.length > 0 ? (
          <div className="rounded-lg border border-border/50 overflow-hidden mb-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Address</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                  <th className="px-3 py-2 w-16" />
                </tr>
              </thead>
              <tbody>
                {contactEntries.map(([address, name]) => (
                  <tr key={address} className="border-b border-border/30 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{address}</td>
                    <td className="px-3 py-2">{name}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => onAction('deleteContact', { address })}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
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
