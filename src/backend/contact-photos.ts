import type { BlueBubblesClient } from './bb-client.js';
import type { BBContact } from '../shared/types.js';

/** Cache TTL: re-fetch from BlueBubbles if older than 24 hours */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeAddress(address: string): string {
  const cleaned = address.replace(/[\s\-()]/g, '');
  if (cleaned.match(/^\+?\d{10,}$/)) {
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
  }
  return cleaned.toLowerCase();
}

function getContactDisplayName(contact: BBContact): string | null {
  if (contact.displayName?.trim()) return contact.displayName.trim();
  const first = contact.firstName?.trim() ?? '';
  const last = contact.lastName?.trim() ?? '';
  const full = `${first} ${last}`.trim();
  return full || null;
}

export type ContactSyncResult = {
  photos: Record<string, string>; // normalized address -> data URI
  names: Record<string, string>; // normalized address -> display name
};

export type CachedContactData = {
  photos: Record<string, string>;
  names: Record<string, string>;
  lastFetched: number; // timestamp
};

type ConfigAPI = {
  getPluginData: () => Record<string, unknown>;
  setPluginData: (path: string, value: unknown) => void;
};

export class ContactPhotoCache {
  private photos: Record<string, string> = {};
  private names: Record<string, string> = {};
  private bbPhotos: Record<string, string> = {}; // BB-only photos for disk persistence
  private configApi: ConfigAPI;

  constructor(configApi: ConfigAPI) {
    this.configApi = configApi;
    this.loadFromDisk();
  }

  /** Returns true if the cache is stale and should be refreshed from BlueBubbles */
  isCacheStale(): boolean {
    const data = this.configApi.getPluginData();
    const cached = data.contactPhotoCache as CachedContactData | undefined;
    if (!cached?.lastFetched) return true;
    return Date.now() - cached.lastFetched > CACHE_TTL_MS;
  }

  /** Load cached data from disk (plugin data) */
  private loadFromDisk(): void {
    const data = this.configApi.getPluginData();
    const cached = data.contactPhotoCache as CachedContactData | undefined;
    if (cached) {
      this.photos = cached.photos ?? {};
      this.bbPhotos = { ...(cached.photos ?? {}) };
      this.names = cached.names ?? {};
    }
  }

  /** Save current state to disk (only persists BB photos, not large local ones) */
  private persistToDisk(): void {
    const cached: CachedContactData = {
      photos: this.bbPhotos,
      names: this.names,
      lastFetched: Date.now(),
    };
    this.configApi.setPluginData('contactPhotoCache', cached);
  }

  /** Save only names to disk (photos are too large for settings JSON) */
  private persistNamesToDisk(): void {
    const data = this.configApi.getPluginData();
    const existing = data.contactPhotoCache as CachedContactData | undefined;
    const cached: CachedContactData = {
      photos: existing?.photos ?? {},  // keep only previously-persisted BB photos
      names: this.names,
      lastFetched: Date.now(),
    };
    this.configApi.setPluginData('contactPhotoCache', cached);
  }

  /** Fetch fresh contact data from BlueBubbles and update cache */
  async refreshFromBlueBubbles(client: BlueBubblesClient, addresses: string[]): Promise<ContactSyncResult> {
    const unique = [...new Set(addresses)];
    if (unique.length === 0) return { photos: this.photos, names: this.names };

    const contacts = await client.queryContacts(unique);
    for (const contact of contacts) {
      const displayName = getContactDisplayName(contact);
      const dataUri = contact.avatar ? `data:image/jpeg;base64,${contact.avatar}` : null;

      // Map to all addresses for this contact
      const allAddresses: string[] = [];
      for (const phone of contact.phoneNumbers ?? []) {
        allAddresses.push(normalizeAddress(phone.address));
      }
      for (const email of contact.emails ?? []) {
        allAddresses.push(normalizeAddress(email.address));
      }

      for (const addr of allAddresses) {
        if (dataUri) {
          this.photos[addr] = dataUri;
          this.bbPhotos[addr] = dataUri; // track for disk persistence
        }
        if (displayName) {
          this.names[addr] = displayName;
        }
      }
    }

    this.persistToDisk();
    return { photos: { ...this.photos }, names: { ...this.names } };
  }

  /**
   * Merge locally-sourced iMessage nickname photos and names.
   * iMessage shared photos take priority over BlueBubbles photos
   * (they represent the person's chosen identity).
   * Note: Only names are persisted to disk; photos are kept in-memory only
   * to avoid bloating the settings JSON.
   */
  mergeLocalNicknames(localPhotos: Record<string, string>, localNames: Record<string, string>): void {
    // iMessage photos override BB photos (higher quality / user-chosen)
    for (const [addr, dataUri] of Object.entries(localPhotos)) {
      this.photos[addr] = dataUri;
    }
    // iMessage names fill in gaps (don't override existing BB names)
    for (const [addr, name] of Object.entries(localNames)) {
      if (!this.names[addr]) {
        this.names[addr] = name;
      }
    }
    // Only persist names (not photos — they're too large for settings JSON)
    this.persistNamesToDisk();
  }

  getPhotos(): Record<string, string> {
    return { ...this.photos };
  }

  getNames(): Record<string, string> {
    return { ...this.names };
  }

  getLastFetched(): number | null {
    const data = this.configApi.getPluginData();
    const cached = data.contactPhotoCache as CachedContactData | undefined;
    return cached?.lastFetched ?? null;
  }
}
