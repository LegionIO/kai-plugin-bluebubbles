/**
 * Slash commands answered directly in an iMessage thread, without the model.
 *
 * Everything here is pure: the caller collects the catalogs and status, and
 * gets back the reply text plus any thread settings to persist.
 */

import type { AIReplyConfig, ThreadSettings } from '../shared/types.js';

export type CommandName = 'model' | 'profile' | 'status' | 'ping';

export type ParsedCommand = { name: CommandName; argument: string };

export type CatalogEntry = {
  key: string;
  label: string;
  /** Shown after the label — the profile's primary model, for instance. */
  detail?: string;
};

export type StatusSnapshot = {
  serverUrl?: string;
  connectionStatus?: string;
  serverVersion?: string;
  privateApi?: boolean;
  chatCount?: number;
  webhookHost?: string;
  webhookPort?: number;
  webhookListening?: boolean;
  /** Milliseconds for a round trip to the BlueBubbles server; null if it did not answer. */
  pingMs?: number | null;
};

export type CommandContext = {
  command: ParsedCommand;
  config: AIReplyConfig;
  threadSettings: ThreadSettings | undefined;
  isGroup: boolean;
  models: CatalogEntry[];
  profiles: CatalogEntry[];
  defaultModelKey?: string;
  defaultProfileKey?: string;
  status: StatusSnapshot;
  /** False when the host config is unreadable, which makes the catalogs unusable. */
  catalogAvailable: boolean;
  /** False when thread settings cannot be persisted, so switching is refused rather than silently lost. */
  canPersist: boolean;
};

export type CommandResult = {
  reply: string;
  /** Present only when the thread's settings changed; replaces the stored object. */
  threadSettings?: ThreadSettings;
};

const COMMAND_ALIASES: Record<string, CommandName> = {
  model: 'model',
  models: 'model',
  profile: 'profile',
  profiles: 'profile',
  status: 'status',
  health: 'status',
  ping: 'ping',
};

// Words that put a thread back on the plugin-wide selection.
const CLEAR_WORDS = new Set(['default', 'defaults', 'none', 'clear', 'reset', 'unset', '-']);

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Recognizes a leading slash command, ignoring surrounding and repeated
 * whitespace. Returns null for anything else, including unknown commands, so
 * ordinary messages that merely start with "/" still reach the model.
 */
export function parseCommand(text: string | null | undefined): ParsedCommand | null {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const match = /^\/([A-Za-z]+)\b([\s\S]*)$/.exec(trimmed);
  if (!match) return null;

  const name = COMMAND_ALIASES[match[1].toLowerCase()];
  if (!name) return null;

  return { name, argument: collapseWhitespace(match[2]) };
}

export function modelCatalog(appConfig: Record<string, unknown> | undefined): CatalogEntry[] {
  const models = (appConfig as any)?.models;
  const providers = (models?.providers ?? {}) as Record<string, { enabled?: boolean }>;
  const catalog = Array.isArray(models?.catalog) ? models.catalog : [];

  return catalog
    .filter((model: any) => {
      if (!model?.key) return false;
      const provider = providers[model.provider];
      // Mirrors the host's own catalog resolution: a model whose provider is
      // missing or disabled is not selectable.
      return Boolean(provider) && provider.enabled !== false;
    })
    .map((model: any) => ({
      key: String(model.key),
      label: String(model.displayName ?? model.key),
    }));
}

export function profileCatalog(appConfig: Record<string, unknown> | undefined): CatalogEntry[] {
  const profiles = (appConfig as any)?.profiles;
  if (!Array.isArray(profiles)) return [];

  return profiles
    .filter((profile: any) => Boolean(profile?.key))
    .map((profile: any) => ({
      key: String(profile.key),
      label: String(profile.name ?? profile.key),
      ...(profile.primaryModelKey ? { detail: String(profile.primaryModelKey) } : {}),
    }));
}

export function defaultModelKey(appConfig: Record<string, unknown> | undefined): string | undefined {
  const key = (appConfig as any)?.models?.defaultModelKey;
  return typeof key === 'string' && key ? key : undefined;
}

export function defaultProfileKey(appConfig: Record<string, unknown> | undefined): string | undefined {
  const key = (appConfig as any)?.defaultProfileKey;
  return typeof key === 'string' && key ? key : undefined;
}

type Match = { entry?: CatalogEntry; candidates: CatalogEntry[] };

/**
 * Resolves a spoken name to a catalog entry: exact key or label first, then a
 * unique prefix, then a unique substring. Comparison ignores case and
 * collapses whitespace, so "Llama 3.3   70B" finds "Llama 3.3 70B".
 */
export function matchEntry(entries: CatalogEntry[], query: string): Match {
  const wanted = collapseWhitespace(query).toLowerCase();
  if (!wanted) return { candidates: [] };

  const normalized = entries.map((entry) => ({
    entry,
    key: entry.key.toLowerCase(),
    label: collapseWhitespace(entry.label).toLowerCase(),
  }));

  const exact = normalized.filter((e) => e.key === wanted || e.label === wanted);
  if (exact.length === 1) return { entry: exact[0].entry, candidates: [] };
  if (exact.length > 1) return { candidates: exact.map((e) => e.entry) };

  for (const test of [
    (e: (typeof normalized)[number]) => e.key.startsWith(wanted) || e.label.startsWith(wanted),
    (e: (typeof normalized)[number]) => e.key.includes(wanted) || e.label.includes(wanted),
  ]) {
    const hits = normalized.filter(test);
    if (hits.length === 1) return { entry: hits[0].entry, candidates: [] };
    if (hits.length > 1) return { candidates: hits.map((e) => e.entry) };
  }

  return { candidates: [] };
}

function labelFor(entries: CatalogEntry[], key: string | undefined): string {
  if (!key) return 'default';
  return entries.find((entry) => entry.key === key)?.label ?? key;
}

function formatList(entries: CatalogEntry[], activeKey: string | undefined): string {
  if (entries.length === 0) return '(none configured)';
  return entries
    .map((entry) => {
      const marker = entry.key === activeKey ? '→ ' : '   ';
      const detail = entry.detail ? ` — ${entry.detail}` : '';
      return `${marker}${entry.label}${detail}`;
    })
    .join('\n');
}

function describeSource(threadValue: string | undefined, globalValue: string | undefined): string {
  if (threadValue) return 'this chat';
  if (globalValue) return 'plugin default';
  return 'Kai default';
}

function selection(
  entries: CatalogEntry[],
  threadValue: string | undefined,
  globalValue: string | undefined,
  hostDefault: string | undefined,
): { key: string | undefined; text: string } {
  const key = threadValue ?? globalValue ?? hostDefault;
  return {
    key,
    text: `${labelFor(entries, key)} (${describeSource(threadValue, globalValue)})`,
  };
}

function profileSelection(context: CommandContext) {
  return selection(
    context.profiles,
    context.threadSettings?.profileOverride,
    context.config.profileOverride,
    context.defaultProfileKey,
  );
}

/**
 * An explicit model override wins; otherwise the active profile supplies the
 * model, and only with no profile does the host default apply. Reporting the
 * profile's model by name avoids naming a model that is not actually in use.
 */
function modelSelection(context: CommandContext) {
  const threadValue = context.threadSettings?.modelOverride;
  const globalValue = context.config.modelOverride;
  if (threadValue || globalValue) {
    return selection(context.models, threadValue, globalValue, context.defaultModelKey);
  }

  const profile = profileSelection(context);
  const profileEntry = context.profiles.find((entry) => entry.key === profile.key);
  if (profileEntry?.detail) {
    return {
      key: profileEntry.detail,
      text: `${labelFor(context.models, profileEntry.detail)} (from profile ${profileEntry.label})`,
    };
  }

  return selection(context.models, undefined, undefined, context.defaultModelKey);
}

export function runCommand(context: CommandContext): CommandResult {
  switch (context.command.name) {
    case 'model':
      return runSelectionCommand(context, 'model');
    case 'profile':
      return runSelectionCommand(context, 'profile');
    case 'status':
      return { reply: formatStatus(context) };
    case 'ping':
      return { reply: formatPing(context) };
  }
}

function runSelectionCommand(context: CommandContext, kind: 'model' | 'profile'): CommandResult {
  const isModel = kind === 'model';
  const entries = isModel ? context.models : context.profiles;
  const threadValue = isModel
    ? context.threadSettings?.modelOverride
    : context.threadSettings?.profileOverride;
  const globalValue = isModel ? context.config.modelOverride : context.config.profileOverride;
  const hostDefault = isModel ? context.defaultModelKey : context.defaultProfileKey;
  const argument = context.command.argument;

  if (!context.catalogAvailable) {
    return { reply: `Cannot read the ${kind} list from Kai right now.` };
  }

  if (!argument) {
    const current = isModel ? modelSelection(context) : profileSelection(context);
    const heading = isModel ? 'Model' : 'Profile';
    const usage = `Switch with: /${kind} <name>   ·   reset with: /${kind} default`;
    return {
      reply: [
        `${heading} for this chat: ${current.text}`,
        usage,
        '',
        `Available ${isModel ? 'models' : 'profiles'} (${entries.length}):`,
        formatList(entries, current.key),
      ].join('\n'),
    };
  }

  if (!context.canPersist) {
    return { reply: `Cannot save a ${kind} for this chat right now.` };
  }

  const existing = context.threadSettings ?? {};

  if (CLEAR_WORDS.has(argument.toLowerCase())) {
    const next: ThreadSettings = { ...existing };
    if (isModel) delete next.modelOverride;
    else delete next.profileOverride;
    const after: CommandContext = { ...context, threadSettings: next };
    const cleared = isModel ? modelSelection(after) : profileSelection(after);
    return {
      reply: `${isModel ? 'Model' : 'Profile'} override cleared. This chat now uses ${cleared.text}.`,
      threadSettings: next,
    };
  }

  const { entry, candidates } = matchEntry(entries, argument);
  if (!entry) {
    if (candidates.length > 0) {
      return {
        reply: [
          `"${argument}" matches ${candidates.length} ${isModel ? 'models' : 'profiles'}:`,
          formatList(candidates, undefined),
          '',
          'Send a more specific name.',
        ].join('\n'),
      };
    }
    return { reply: `No ${kind} matches "${argument}". Send /${kind} for the list.` };
  }

  const next: ThreadSettings = { ...existing };
  if (isModel) {
    next.modelOverride = entry.key;
    return {
      reply: `Model for this chat: ${entry.label}`,
      threadSettings: next,
    };
  }

  next.profileOverride = entry.key;
  // A leftover per-chat model would otherwise outrank the one the profile
  // carries, so a profile switch starts from the profile's own model.
  const hadModelOverride = Boolean(next.modelOverride);
  delete next.modelOverride;
  const lines = [`Profile for this chat: ${entry.label}`];
  if (entry.detail) lines.push(`Model: ${labelFor(context.models, entry.detail)}`);
  if (hadModelOverride) lines.push('Cleared this chat\'s model override so the profile picks the model.');
  return { reply: lines.join('\n'), threadSettings: next };
}

function formatStatus(context: CommandContext): string {
  const { status, config } = context;
  const model = modelSelection(context);
  const profile = profileSelection(context);

  const behavior = context.isGroup ? config.groupBehavior : config.dmBehavior;
  const server = [
    status.connectionStatus ?? 'unknown',
    status.serverUrl ? `at ${status.serverUrl}` : '',
    status.serverVersion ? `(v${status.serverVersion})` : '',
  ].filter(Boolean).join(' ');

  const lines = [
    `Server: ${server}`,
    typeof status.pingMs === 'number' ? `Round trip: ${status.pingMs} ms` : '',
    typeof status.chatCount === 'number' ? `Chats loaded: ${status.chatCount}` : '',
    status.webhookPort
      ? `Webhook: ${status.webhookListening ? 'listening' : 'not listening'} on ${status.webhookHost ?? '0.0.0.0'}:${status.webhookPort}`
      : '',
    `Auto-reply: ${config.enabled ? 'on' : 'off'} (${context.isGroup ? 'group' : 'DM'} behavior: ${behavior})`,
    context.catalogAvailable ? `Model: ${model.text}` : '',
    context.catalogAvailable ? `Profile: ${profile.text}` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

function formatPing(context: CommandContext): string {
  const { pingMs } = context.status;
  if (typeof pingMs === 'number') {
    return `pong — BlueBubbles server answered in ${pingMs} ms`;
  }
  return 'pong — the plugin is running, but the BlueBubbles server did not answer';
}
