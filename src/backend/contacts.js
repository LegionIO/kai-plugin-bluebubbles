export class ContactBook {
    contacts;
    configApi;
    constructor(configApi) {
        this.configApi = configApi;
        const data = configApi.getPluginData();
        this.contacts = data.contacts ?? {};
    }
    get(address) {
        return this.contacts[this.normalizeAddress(address)] ?? null;
    }
    set(address, name) {
        this.contacts[this.normalizeAddress(address)] = name;
        this.persist();
    }
    delete(address) {
        delete this.contacts[this.normalizeAddress(address)];
        this.persist();
    }
    getAll() {
        return { ...this.contacts };
    }
    resolve(address) {
        return this.get(address) ?? this.formatAddress(address);
    }
    reload() {
        const data = this.configApi.getPluginData();
        this.contacts = data.contacts ?? {};
    }
    persist() {
        this.configApi.setPluginData('contacts', { ...this.contacts });
    }
    normalizeAddress(address) {
        const cleaned = address.replace(/[\s\-()]/g, '');
        if (cleaned.match(/^\+?\d{10,}$/)) {
            const digits = cleaned.replace(/\D/g, '');
            if (digits.length === 11 && digits.startsWith('1'))
                return `+${digits}`;
            if (digits.length === 10)
                return `+1${digits}`;
        }
        return cleaned.toLowerCase();
    }
    formatAddress(address) {
        if (address.includes('@'))
            return address.split('@')[0];
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
