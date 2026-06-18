/**
 * Secret storage with OS keychain primary + AES-256-GCM fallback.
 * Primary: Kai's safeStorage API (Electron safeStorage → OS keychain).
 * Fallback: AES-256-GCM keyed by a per-install random secret on disk.
 *
 * Ported from kai-plugin-pim/src/backend/credential-store.ts, generalized to
 * store multiple named secrets (BlueBubbles password, webhook secret).
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, lstatSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { hostname, userInfo, homedir } from 'os';

const INSTALL_KEY_PATH = join(homedir(), '.kai', 'bluebubbles.key');

type SafeStorageAPI = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plaintext: string) => string;
  decryptString: (base64Cipher: string) => string;
};

type ConfigAPI = {
  getPluginData: () => Record<string, unknown>;
  setPluginData: (path: string, value: unknown) => void;
};

type LogAPI = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type SecretStoreAPI = {
  safeStorage?: SafeStorageAPI;
  config: ConfigAPI;
  pluginDir: string;
  log: LogAPI;
};

type SafeStorageRecord = { method: 'safeStorage'; ciphertext: string };
type AesRecord = { method: 'aes256gcm'; iv: string; authTag: string; ciphertext: string };
type SecretRecord = SafeStorageRecord | AesRecord;

function getOrCreateInstallKey(): Buffer {
  let st;
  try { st = lstatSync(INSTALL_KEY_PATH); } catch { st = null; }
  if (st) {
    if (!st.isFile()) {
      throw new Error(`Install key at ${INSTALL_KEY_PATH} is not a regular file`);
    }
    if ((st.mode & 0o077) !== 0) {
      chmodSync(INSTALL_KEY_PATH, 0o600);
    }
    const hex = readFileSync(INSTALL_KEY_PATH, 'utf-8').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(`Install key at ${INSTALL_KEY_PATH} is malformed (expected 64 hex chars)`);
    }
    return Buffer.from(hex, 'hex');
  }
  const key = randomBytes(32);
  mkdirSync(dirname(INSTALL_KEY_PATH), { recursive: true });
  writeFileSync(INSTALL_KEY_PATH, key.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  return key;
}

function machineSalt(): Buffer {
  const material = `${hostname()}:${userInfo().username}:${homedir()}`;
  return createHash('sha256').update(material).digest();
}

function deriveAesKey(): Buffer {
  return pbkdf2Sync(getOrCreateInstallKey(), machineSalt(), 100_000, 32, 'sha512');
}

function encryptAes(plaintext: string, key: Buffer): AesRecord {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    method: 'aes256gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

function decryptAes(rec: AesRecord, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(rec.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(rec.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function getSecretsFilePath(pluginDir: string): string {
  return join(pluginDir, 'secrets.enc.json');
}

function readAesFile(pluginDir: string): Record<string, AesRecord> {
  const path = getSecretsFilePath(pluginDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, AesRecord>;
  } catch {
    return {};
  }
}

function writeAesFile(pluginDir: string, data: Record<string, AesRecord>): void {
  const path = getSecretsFilePath(pluginDir);
  writeFileSync(path, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
}

export class SecretStore {
  private api: SecretStoreAPI;

  constructor(api: SecretStoreAPI) {
    this.api = api;
  }

  set(name: string, value: string): void {
    try {
      if (this.api.safeStorage?.isEncryptionAvailable()) {
        const rec: SafeStorageRecord = {
          method: 'safeStorage',
          ciphertext: this.api.safeStorage.encryptString(value),
        };
        const all = (this.api.config.getPluginData().encryptedSecrets as Record<string, SecretRecord>) ?? {};
        this.api.config.setPluginData('encryptedSecrets', { ...all, [name]: rec });
        // Remove any stale AES-file record so a later safeStorage failure
        // can't resurrect an old value via the get() fallback.
        const file = readAesFile(this.api.pluginDir);
        if (name in file) {
          delete file[name];
          writeAesFile(this.api.pluginDir, file);
        }
        return;
      }
    } catch {
      // fall through to AES
    }

    // safeStorage unavailable — clear any stale safeStorage record so get()
    // doesn't read it ahead of the AES file we're about to write.
    const all = (this.api.config.getPluginData().encryptedSecrets as Record<string, SecretRecord>) ?? {};
    if (name in all) {
      const { [name]: _removed, ...rest } = all;
      this.api.config.setPluginData('encryptedSecrets', rest);
    }

    const file = readAesFile(this.api.pluginDir);
    file[name] = encryptAes(value, deriveAesKey());
    writeAesFile(this.api.pluginDir, file);
  }

  get(name: string): string | null {
    const all = (this.api.config.getPluginData().encryptedSecrets as Record<string, SecretRecord>) ?? {};
    const rec = all[name];
    if (rec?.method === 'safeStorage') {
      try {
        const plain = this.api.safeStorage?.decryptString(rec.ciphertext);
        if (plain != null) return plain;
      } catch (err) {
        this.api.log.error(`Failed to decrypt safeStorage secret '${name}':`, err);
      }
      // fall through to AES file in case a newer fallback write exists
    }

    const file = readAesFile(this.api.pluginDir);
    const aesRec = file[name];
    if (aesRec?.method === 'aes256gcm') {
      try {
        return decryptAes(aesRec, deriveAesKey());
      } catch (err) {
        this.api.log.error(`Failed to decrypt AES secret '${name}':`, err);
        return null;
      }
    }

    return null;
  }

  has(name: string): boolean {
    const all = (this.api.config.getPluginData().encryptedSecrets as Record<string, SecretRecord>) ?? {};
    if (all[name]) return true;
    const file = readAesFile(this.api.pluginDir);
    return !!file[name];
  }

  delete(name: string): void {
    const all = (this.api.config.getPluginData().encryptedSecrets as Record<string, SecretRecord>) ?? {};
    if (name in all) {
      const { [name]: _removed, ...rest } = all;
      this.api.config.setPluginData('encryptedSecrets', rest);
    }
    const file = readAesFile(this.api.pluginDir);
    if (name in file) {
      delete file[name];
      writeAesFile(this.api.pluginDir, file);
    }
  }

  encryptionMethod(): 'os-keychain' | 'aes256gcm' {
    try {
      if (this.api.safeStorage?.isEncryptionAvailable()) return 'os-keychain';
    } catch { /* not available */ }
    return 'aes256gcm';
  }
}
