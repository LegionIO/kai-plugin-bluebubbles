import { useState, useCallback } from '../hooks';
import { Dropdown, AutoManualToggle, useModelCatalog, useProfileCatalog } from './ModelProfileSelectors';

const h = (...args: any[]) => (globalThis as any).React.createElement(...args);

type PluginComponentProps = {
  pluginName: string;
  props?: Record<string, unknown>;
  onAction: (action: string, data?: unknown) => void;
  onClose?: () => void;
  config?: Record<string, unknown>;
  updateConfig?: (path: string, value: unknown) => Promise<void>;
  pluginConfig?: Record<string, unknown>;
  pluginState?: Record<string, unknown>;
  setPluginConfig?: (path: string, value: unknown) => Promise<void>;
};

function SettingsField({ label, description, children }: { label: string; description?: string; children: any }) {
  return h('div', { className: 'space-y-1.5' },
    h('label', { className: 'text-sm font-medium' }, label),
    description ? h('p', { className: 'text-xs text-muted-foreground' }, description) : null,
    children,
  );
}

function SettingsSection({ title, children }: { title: string; children: any }) {
  return h('div', { className: 'space-y-4' },
    h('h3', { className: 'text-sm font-semibold border-b border-border/50 pb-2' }, title),
    children,
  );
}

function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': active,
    onClick: onToggle,
    style: {
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
    },
  },
    h('span', {
      style: {
        position: 'absolute',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        backgroundColor: 'white',
        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        transition: 'transform 0.2s',
        transform: active ? 'translateX(18px)' : 'translateX(2px)',
      },
    }),
  );
}

function Select({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return h('select', {
    value,
    onChange: (e: any) => onChange(e.target.value),
    className: 'rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none',
  },
    options.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
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

  const inputClass = 'w-full rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none';

  const contactEntries = Object.entries((state.contacts ?? {}) as Record<string, string>);

  return h('div', { className: 'space-y-8' },

    // Connection section
    h(SettingsSection, { title: 'Connection' },
      h(SettingsField, {
        label: 'Server URL',
        description: 'The URL of your BlueBubbles server (e.g. http://192.168.1.100:1234)',
      },
        h('input', {
          type: 'text',
          value: config.serverUrl ?? '',
          onChange: (e: any) => updateField('serverUrl', e.target.value),
          placeholder: 'http://192.168.1.100:1234',
          className: inputClass,
        }),
      ),

      h(SettingsField, { label: 'Password' },
        h('input', {
          type: 'password',
          value: config.password ?? '',
          onChange: (e: any) => updateField('password', e.target.value),
          placeholder: 'Server password',
          className: inputClass,
        }),
      ),

      h('div', { className: 'flex items-center gap-3' },
        h('button', {
          type: 'button',
          onClick: handleTestConnection,
          disabled: testing || !config.serverUrl || !config.password,
          className: `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            testing || !config.serverUrl || !config.password
              ? 'bg-muted/50 text-muted-foreground/30'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`,
        }, testing ? 'Testing...' : 'Test Connection'),

        state.connectionStatus === 'connected'
          ? h('span', { className: 'flex items-center gap-1.5 text-xs text-green-500' },
              h('span', { className: 'h-2 w-2 rounded-full bg-green-500' }),
              'Connected',
              state.serverInfo?.server_version
                ? h('span', { className: 'text-muted-foreground ml-1' }, `v${state.serverInfo.server_version}`)
                : null,
            )
          : state.connectionStatus === 'error'
            ? h('span', { className: 'text-xs text-red-400' }, state.error ?? 'Connection failed')
            : null,
      ),
    ),

    // Webhook section
    h(SettingsSection, { title: 'Webhook' },
      h('p', { className: 'text-xs text-muted-foreground' },
        'Configure the local HTTP server that receives events from BlueBubbles.',
      ),

      h('div', { className: 'grid grid-cols-2 gap-3' },
        h(SettingsField, { label: 'Port' },
          h('input', {
            type: 'number',
            value: config.webhookPort ?? 8742,
            onChange: (e: any) => updateField('webhookPort', parseInt(e.target.value, 10) || 8742),
            className: inputClass,
          }),
        ),
        h(SettingsField, { label: 'Bind Address' },
          h('input', {
            type: 'text',
            value: config.webhookHost ?? '0.0.0.0',
            onChange: (e: any) => updateField('webhookHost', e.target.value),
            placeholder: '0.0.0.0',
            className: inputClass,
          }),
        ),
      ),

      h(SettingsField, {
        label: 'Webhook Secret',
        description: 'Optional secret to authenticate incoming webhook requests',
      },
        h('input', {
          type: 'password',
          value: config.webhookSecret ?? '',
          onChange: (e: any) => updateField('webhookSecret', e.target.value),
          placeholder: 'Optional',
          className: inputClass,
        }),
      ),

      h('div', { className: 'rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground space-y-1' },
        h('p', { className: 'font-medium' }, 'Webhook URL for BlueBubbles:'),
        h('code', { className: 'block mt-1 text-primary/80 select-all' },
          `http://<your-ip>:${config.webhookPort ?? 8742}/webhook${config.webhookSecret ? `?secret=${config.webhookSecret}` : ''}`,
        ),
      ),
    ),

    // AI Auto-Reply section
    h(SettingsSection, { title: 'AI Auto-Reply' },
      h('div', { className: 'flex items-center justify-between' },
        h('div', null,
          h('div', { className: 'text-sm font-medium' }, 'Enable AI Auto-Reply'),
          h('div', { className: 'text-xs text-muted-foreground' }, 'Use Kai\'s AI to intelligently respond to incoming messages'),
        ),
        h(Toggle, {
          active: (config as any).aiReply?.enabled ?? false,
          onToggle: () => updateField('aiReply.enabled', !((config as any).aiReply?.enabled ?? false)),
        }),
      ),

      (config as any).aiReply?.enabled
        ? h('div', { className: 'space-y-4' },
            h('div', { className: 'grid grid-cols-2 gap-3' },
              h(SettingsField, { label: 'DM Behavior' },
                h(Select, {
                  value: (config as any).aiReply?.dmBehavior ?? 'smart',
                  options: [
                    { value: 'smart', label: 'Smart (AI decides)' },
                    { value: 'always', label: 'Always reply' },
                    { value: 'never', label: 'Never reply' },
                  ],
                  onChange: (v: string) => updateField('aiReply.dmBehavior', v),
                }),
              ),
              h(SettingsField, { label: 'Group Chat Behavior' },
                h(Select, {
                  value: (config as any).aiReply?.groupBehavior ?? 'smart',
                  options: [
                    { value: 'smart', label: 'Smart (AI decides)' },
                    { value: 'always', label: 'Always reply' },
                    { value: 'never', label: 'Never reply' },
                    { value: 'mentioned', label: 'Only when mentioned' },
                  ],
                  onChange: (v: string) => updateField('aiReply.groupBehavior', v),
                }),
              ),
            ),

            h(SettingsField, {
              label: 'System Prompt',
              description: 'Instructions for the AI personality and behavior',
            },
              h('textarea', {
                value: (config as any).aiReply?.systemPrompt ?? '',
                onChange: (e: any) => updateField('aiReply.systemPrompt', e.target.value),
                placeholder: 'Leave empty for default prompt...',
                rows: 5,
                className: inputClass + ' resize-y',
              }),
            ),

            h('div', { className: 'grid grid-cols-2 gap-3' },
              h(SettingsField, {
                label: 'Max History Per Chat',
                description: 'Messages kept for AI context',
              },
                h('input', {
                  type: 'number',
                  value: (config as any).aiReply?.maxHistoryPerChat ?? 50,
                  onChange: (e: any) => updateField('aiReply.maxHistoryPerChat', parseInt(e.target.value, 10) || 50),
                  className: inputClass,
                }),
              ),
            ),

            h(SettingsModelProfileBar, {
              config: config as any,
              updateField,
            }),
          )
        : null,
    ),

    // Message Chunking section
    h(SettingsSection, { title: 'Message Chunking' },
      h('div', { className: 'grid grid-cols-2 gap-3' },
        h(SettingsField, {
          label: 'Max Chunk Length',
          description: 'Characters per message before splitting',
        },
          h('input', {
            type: 'number',
            value: (config as any).chunking?.maxLength ?? 4000,
            onChange: (e: any) => updateField('chunking.maxLength', parseInt(e.target.value, 10) || 4000),
            className: inputClass,
          }),
        ),
        h(SettingsField, {
          label: 'Split Mode',
          description: 'How to break long messages',
        },
          h(Select, {
            value: (config as any).chunking?.splitMode ?? 'sentence',
            options: [
              { value: 'sentence', label: 'Sentence boundaries' },
              { value: 'word', label: 'Word boundaries' },
              { value: 'newline', label: 'Newlines' },
              { value: 'anywhere', label: 'Exact character count' },
            ],
            onChange: (v: string) => updateField('chunking.splitMode', v),
          }),
        ),
      ),
    ),

    // Contacts section
    h(SettingsSection, { title: 'Contacts' },
      h('p', { className: 'text-xs text-muted-foreground mb-2' },
        'Saved contact names are used by the AI to understand who is messaging and shown in the chat UI.',
      ),

      contactEntries.length > 0
        ? h('div', { className: 'rounded-lg border border-border/50 overflow-hidden mb-3' },
            h('table', { className: 'w-full text-sm' },
              h('thead', null,
                h('tr', { className: 'border-b border-border/50 bg-muted/20' },
                  h('th', { className: 'px-3 py-2 text-left font-medium text-muted-foreground' }, 'Address'),
                  h('th', { className: 'px-3 py-2 text-left font-medium text-muted-foreground' }, 'Name'),
                  h('th', { className: 'px-3 py-2 w-16' }),
                ),
              ),
              h('tbody', null,
                contactEntries.map(([address, name]) =>
                  h('tr', { key: address, className: 'border-b border-border/30 last:border-0' },
                    h('td', { className: 'px-3 py-2 font-mono text-xs' }, address),
                    h('td', { className: 'px-3 py-2' }, name),
                    h('td', { className: 'px-3 py-2' },
                      h('button', {
                        type: 'button',
                        onClick: () => onAction('deleteContact', { address }),
                        className: 'text-xs text-red-400 hover:text-red-300',
                      }, 'Remove'),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h('div', { className: 'text-xs text-muted-foreground/60 py-2' }, 'No contacts saved yet.'),

      h('div', { className: 'flex gap-2 items-end' },
        h('div', { className: 'flex-1' },
          h('input', {
            type: 'text',
            value: newContactAddr,
            onChange: (e: any) => setNewContactAddr(e.target.value),
            placeholder: 'Phone or email',
            className: inputClass,
          }),
        ),
        h('div', { className: 'flex-1' },
          h('input', {
            type: 'text',
            value: newContactName,
            onChange: (e: any) => setNewContactName(e.target.value),
            placeholder: 'Display name',
            className: inputClass,
          }),
        ),
        h('button', {
          type: 'button',
          onClick: handleAddContact,
          disabled: !newContactAddr.trim() || !newContactName.trim(),
          className: `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            newContactAddr.trim() && newContactName.trim()
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted/50 text-muted-foreground/30'
          }`,
        }, 'Add'),
      ),
    ),

    // Notifications section
    h(SettingsSection, { title: 'Notifications' },
      h('div', { className: 'flex items-center justify-between' },
        h('div', null,
          h('div', { className: 'text-sm font-medium' }, 'Show Notifications'),
          h('div', { className: 'text-xs text-muted-foreground' }, 'Display native notifications for new messages'),
        ),
        h(Toggle, {
          active: config.notifications !== false,
          onToggle: () => updateField('notifications', !(config.notifications !== false)),
        }),
      ),
    ),

    // Server Info section
    state.serverInfo
      ? h(SettingsSection, { title: 'Server Info' },
          h('div', { className: 'grid grid-cols-2 gap-x-4 gap-y-1 text-sm' },
            h('span', { className: 'text-muted-foreground' }, 'Server Version:'),
            h('span', null, state.serverInfo.server_version ?? 'Unknown'),
            h('span', { className: 'text-muted-foreground' }, 'macOS Version:'),
            h('span', null, state.serverInfo.os_version ?? 'Unknown'),
            h('span', { className: 'text-muted-foreground' }, 'Private API:'),
            h('span', null, state.privateApiEnabled ? 'Enabled' : 'Disabled'),
            h('span', { className: 'text-muted-foreground' }, 'Proxy:'),
            h('span', null, state.serverInfo.proxy_service ?? 'None'),
          ),
        )
      : null,
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

  return h('div', {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px',
      alignItems: 'center',
      padding: '8px 0',
    },
  },
    h(Dropdown, {
      label: 'Select profile',
      icon: '\uD83D\uDC64',
      value: selectedProfileKey,
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
      value: getValue('model', 'aiReply.modelOverride') as string,
      options: modelOptions,
      onChange: (v: string) => update('model', 'aiReply.modelOverride', v || undefined),
      disabled: isAuto,
      direction: 'down',
    }),
    h(Dropdown, {
      label: 'Select thinking',
      icon: '\uD83E\uDDE0',
      value: getValue('thinking', 'aiReply.reasoningEffort') as string,
      options: thinkingOptions,
      onChange: (v: string) => update('thinking', 'aiReply.reasoningEffort', v || undefined),
      direction: 'down',
    }),
  );
}
