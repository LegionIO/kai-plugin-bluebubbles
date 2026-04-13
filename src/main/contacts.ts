type ConfigAPI = {
  getPluginData: () => Record<string, unknown>;
  setPluginData: (path: string, value: unknown) => void;
};

export class ContactBook {
  private contacts: Record<string, string>;
  private configApi: ConfigAPI;

  constructor(configApi: ConfigAPI) {
    this.configApi = configApi;
    const data = configApi.getPluginData();
    this.contacts = (data.contacts as Record<string, string>) ?? {};
  }

  get(address: string): string | null {
    return this.contacts[this.normalizeAddress(address)] ?? null;
  }

  set(address: string, name: string): void {
    this.contacts[this.normalizeAddress(address)] = name;
    this.persist();
  }

  delete(address: string): void {
    delete this.contacts[this.normalizeAddress(address)];
    this.persist();
  }

  getAll(): Record<string, string> {
    return { ...this.contacts };
  }

  resolve(address: string): string {
    return this.get(address) ?? this.formatAddress(address);
  }

  reload(): void {
    const data = this.configApi.getPluginData();
    this.contacts = (data.contacts as Record<string, string>) ?? {};
  }

  private persist(): void {
    this.configApi.setPluginData('contacts', { ...this.contacts });
  }

  private normalizeAddress(address: string): string {
    const cleaned = address.replace(/[\s\-()]/g, '');
    if (cleaned.match(/^\+?\d{10,}$/)) {
      const digits = cleaned.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
      if (digits.length === 10) return `+1${digits}`;
    }
    return cleaned.toLowerCase();
  }

  private formatAddress(address: string): string {
    if (address.includes('@')) return address.split('@')[0];
    const digits = address.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return address;
  }
}
