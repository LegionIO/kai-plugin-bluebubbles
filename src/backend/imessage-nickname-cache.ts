/**
 * Reads iMessage "Name and Photo Sharing" data from the local macOS NickNameCache.
 * Uses macOS system tools (sqlite3, plutil) — no external dependencies.
 *
 * Location: ~/Library/Messages/NickNameCache/
 * Data sources:
 *   - pendingNicknamesKeyStore.db: richest (firstName, lastName, displayName, avatar path)
 *   - handledNicknamesKeyStore.db: fallback (avatar path, no names)
 *   - nicknameRecordsStore.db/activeNicknameRecords: phone→recordID mapping
 *   - <recordID>-ad files: avatar PNGs
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

type LogAPI = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

export type NickNameResult = {
  names: Record<string, string>;  // normalized address -> display name
  photos: Record<string, string>; // normalized address -> data URI
};

type ParsedNickname = {
  handleId: string;       // phone number or email
  recordId: string;       // base64 record ID
  firstName?: string;
  lastName?: string;
  displayName?: string;
  avatarPath?: string;    // absolute path to avatar PNG
};

// ─── XML Plist / NSKeyedArchiver Parser ───────────────────────────────────────

type PlistValue = string | number | boolean | null | PlistValue[] | { [key: string]: PlistValue } | { 'CF$UID': number };

/**
 * Parse plutil XML1 output into a JavaScript object.
 * Handles: <string>, <integer>, <real>, <true/>, <false/>, <data>, <dict>, <array>, CF$UID
 */
function parsePlistXml(xml: string): PlistValue {
  // Remove XML header and doctype
  const body = xml.replace(/<\?xml[^?]*\?>\s*/g, '').replace(/<!DOCTYPE[^>]*>\s*/g, '');

  let pos = 0;

  function skipWhitespace(): void {
    while (pos < body.length && /\s/.test(body[pos])) pos++;
  }

  function readTag(): { name: string; selfClosing: boolean } | null {
    skipWhitespace();
    if (pos >= body.length || body[pos] !== '<') return null;
    const end = body.indexOf('>', pos);
    if (end === -1) return null;
    const tag = body.slice(pos + 1, end);
    pos = end + 1;
    const selfClosing = tag.endsWith('/');
    const rawName = tag.replace(/\/$/, '').trim();
    // Strip attributes (e.g. 'plist version="1.0"' -> 'plist')
    const spaceIdx = rawName.indexOf(' ');
    const name = spaceIdx > 0 ? rawName.slice(0, spaceIdx) : rawName;
    return { name, selfClosing };
  }

  function readUntilClose(tagName: string): string {
    const closeTag = `</${tagName}>`;
    const idx = body.indexOf(closeTag, pos);
    if (idx === -1) return '';
    const content = body.slice(pos, idx);
    pos = idx + closeTag.length;
    return content;
  }

  function parseValue(): PlistValue {
    skipWhitespace();
    const tag = readTag();
    if (!tag) return null;

    switch (tag.name) {
      case 'string':
        return readUntilClose('string');
      case 'integer':
        return parseInt(readUntilClose('integer'), 10);
      case 'real':
        return parseFloat(readUntilClose('real'));
      case 'true':
        return true;
      case 'false':
        return false;
      case 'data':
        return readUntilClose('data').replace(/\s/g, '');
      case 'dict':
        return parseDict();
      case 'array':
        return parseArray();
      case 'plist':
        return parseValue(); // recurse into plist wrapper
      default:
        // Skip unknown elements
        if (!tag.selfClosing) readUntilClose(tag.name);
        return null;
    }
  }

  function parseDict(): { [key: string]: PlistValue } {
    const result: { [key: string]: PlistValue } = {};
    while (true) {
      skipWhitespace();
      if (pos >= body.length) break;
      // Check for closing </dict>
      if (body.slice(pos, pos + 7) === '</dict>') {
        pos += 7;
        break;
      }
      // Read <key>...</key>
      const keyTag = readTag();
      if (!keyTag || keyTag.name !== 'key') break;
      const key = readUntilClose('key');
      // Read value
      const value = parseValue();
      result[key] = value;
    }
    return result;
  }

  function parseArray(): PlistValue[] {
    const result: PlistValue[] = [];
    while (true) {
      skipWhitespace();
      if (pos >= body.length) break;
      if (body.slice(pos, pos + 8) === '</array>') {
        pos += 8;
        break;
      }
      const value = parseValue();
      if (value !== null || (pos < body.length && body.slice(pos - 8, pos) !== '</array>')) {
        result.push(value);
      }
    }
    return result;
  }

  return parseValue();
}

/**
 * Resolve an NSKeyedArchiver plist into a usable JS structure.
 * NSKeyedArchiver stores objects in a flat $objects array with CF$UID references.
 */
function resolveKeyedArchiver(plist: any): any {
  if (!plist || plist['$archiver'] !== 'NSKeyedArchiver') return null;

  const objects: any[] = plist['$objects'];
  if (!Array.isArray(objects)) return null;

  const resolved = new Map<number, any>();

  function resolve(idx: number, depth = 0): any {
    if (depth > 20) return null; // prevent infinite recursion
    if (idx === 0) return null; // $null
    if (resolved.has(idx)) return resolved.get(idx);

    const obj = objects[idx];
    if (obj === undefined || obj === null) return null;
    if (obj === '$null') return null;

    // Primitive values (string, number, boolean)
    if (typeof obj !== 'object') {
      resolved.set(idx, obj);
      return obj;
    }

    // CF$UID reference within a value (shouldn't appear at top level of $objects but handle it)
    if ('CF$UID' in obj && Object.keys(obj).length === 1) {
      const result = resolve(obj['CF$UID'], depth + 1);
      resolved.set(idx, result);
      return result;
    }

    // NSDictionary / NSMutableDictionary
    if (obj['NS.keys'] && obj['NS.objects']) {
      const keys: any[] = obj['NS.keys'];
      const vals: any[] = obj['NS.objects'];
      const dict: Record<string, any> = {};

      for (let i = 0; i < keys.length; i++) {
        const keyRef = keys[i];
        const valRef = vals[i];
        const keyIdx = typeof keyRef === 'object' && 'CF$UID' in keyRef ? keyRef['CF$UID'] : null;
        const valIdx = typeof valRef === 'object' && 'CF$UID' in valRef ? valRef['CF$UID'] : null;

        const key = keyIdx !== null ? resolve(keyIdx, depth + 1) : keyRef;
        const val = valIdx !== null ? resolve(valIdx, depth + 1) : valRef;

        if (typeof key === 'string') {
          dict[key] = val;
        }
      }

      resolved.set(idx, dict);
      return dict;
    }

    // NSArray / NSMutableArray
    if (obj['NS.objects'] && !obj['NS.keys']) {
      const items: any[] = obj['NS.objects'];
      const arr: any[] = [];
      for (const item of items) {
        const itemIdx = typeof item === 'object' && 'CF$UID' in item ? item['CF$UID'] : null;
        arr.push(itemIdx !== null ? resolve(itemIdx, depth + 1) : item);
      }
      resolved.set(idx, arr);
      return arr;
    }

    // NSSet / NSMutableSet
    if (obj['NS.objects']) {
      const items: any[] = obj['NS.objects'];
      const arr: any[] = [];
      for (const item of items) {
        const itemIdx = typeof item === 'object' && 'CF$UID' in item ? item['CF$UID'] : null;
        arr.push(itemIdx !== null ? resolve(itemIdx, depth + 1) : item);
      }
      resolved.set(idx, arr);
      return arr;
    }

    // Class definition objects (skip)
    if (obj['$classes'] && obj['$classname']) {
      resolved.set(idx, null);
      return null;
    }

    // Generic dict with CF$UID values
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      if (key === '$class') continue;
      if (typeof val === 'object' && val !== null && 'CF$UID' in val) {
        result[key] = resolve((val as any)['CF$UID'], depth + 1);
      } else {
        result[key] = val;
      }
    }
    resolved.set(idx, result);
    return result;
  }

  // Resolve root object
  const topRef = plist['$top']?.root;
  if (!topRef || typeof topRef !== 'object' || !('CF$UID' in topRef)) return null;
  return resolve(topRef['CF$UID']);
}

// ─── NickNameCache Reader ─────────────────────────────────────────────────────

export function normalizeAddress(address: string): string {
  const cleaned = address.replace(/[\s\-()]/g, '');
  if (cleaned.match(/^\+?\d{10,}$/)) {
    const digits = cleaned.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
  }
  return cleaned.toLowerCase();
}

export class IMessageNicknameCache {
  private cacheDir: string;
  private addressBookDir: string;
  private log: LogAPI;

  constructor(log: LogAPI) {
    this.log = log;
    this.cacheDir = join(homedir(), 'Library', 'Messages', 'NickNameCache');
    this.addressBookDir = join(homedir(), 'Library', 'Application Support', 'AddressBook');
  }

  /** Check if the NickNameCache/AddressBook directories are accessible */
  isAvailable(): 'available' | 'not-found' | 'permission-denied' {
    try {
      const cacheExists = existsSync(this.cacheDir);
      const abExists = existsSync(this.addressBookDir);
      if (cacheExists || abExists) return 'available';

      // Check if the directories likely exist but are permission-blocked
      const messagesDir = join(homedir(), 'Library', 'Messages');
      if (existsSync(messagesDir)) {
        // Messages dir exists but NickNameCache is not visible — likely TCC/FDA block
        return 'permission-denied';
      }
      return 'not-found';
    } catch {
      return 'not-found';
    }
  }

  /** Load all shared nicknames and photos from the local NickNameCache and AddressBook.
   *  @param relevantAddresses If provided, only load photos for these normalized addresses (performance optimization)
   */
  async load(relevantAddresses?: Set<string>): Promise<NickNameResult> {
    const names: Record<string, string> = {};
    const photos: Record<string, string> = {};

    if (this.isAvailable() !== 'available') {
      return { names, photos };
    }

    try {
      // 1. Parse pending nicknames (richest: has names + avatar paths)
      const pendingDb = join(this.cacheDir, 'pendingNicknamesKeyStore.db');
      const pendingNicknames = this.parseNicknameDb(pendingDb, true);

      // 2. Parse handled nicknames (fallback: avatar paths only, no names)
      const handledDb = join(this.cacheDir, 'handledNicknamesKeyStore.db');
      const handledNicknames = this.parseNicknameDb(handledDb, false);

      // 3. Merge — pending takes priority (has names)
      const allNicknames = new Map<string, ParsedNickname>();

      for (const nick of handledNicknames) {
        const key = normalizeAddress(nick.handleId);
        allNicknames.set(key, nick);
      }
      for (const nick of pendingNicknames) {
        const key = normalizeAddress(nick.handleId);
        allNicknames.set(key, nick); // overwrite handled with pending
      }

      // 4. Also try to find avatars via activeNicknameRecords for contacts not in pending/handled
      const activeRecords = this.parseActiveRecords();
      for (const [address, recordId] of Object.entries(activeRecords)) {
        const key = normalizeAddress(address);
        if (!allNicknames.has(key)) {
          // Check if avatar file exists
          const avatarPath = this.findAvatarPath(recordId);
          if (avatarPath) {
            allNicknames.set(key, { handleId: address, recordId, avatarPath });
          }
        }
      }

      // 5. Build output — names first (cheap), then photos (expensive, yielding between batches)
      const photoQueue: Array<{ addr: string; path: string }> = [];

      for (const [normalizedAddr, nick] of allNicknames) {
        const displayName = nick.displayName
          || [nick.firstName, nick.lastName].filter(Boolean).join(' ')
          || null;
        if (displayName) {
          names[normalizedAddr] = displayName;
        }

        if (nick.avatarPath) {
          const passesFilter = !relevantAddresses || relevantAddresses.has(normalizedAddr);
          if (passesFilter) {
            photoQueue.push({ addr: normalizedAddr, path: nick.avatarPath });
          }
        }
      }

      // Load photos in small batches, yielding to the event loop between batches
      for (let i = 0; i < photoQueue.length; i += 5) {
        if (i > 0) await new Promise(r => setTimeout(r, 0));
        const batch = photoQueue.slice(i, i + 5);
        for (const { addr, path } of batch) {
          const dataUri = this.loadAvatarAsDataUri(path);
          if (dataUri) {
            photos[addr] = dataUri;
          }
        }
      }

      this.log.info(
        `iMessage NickNameCache: ${Object.keys(names).length} names, ${Object.keys(photos).length} photos`,
      );
    } catch (err) {
      this.log.warn('Failed to read iMessage NickNameCache:', err);
    }

    // Also load contacts from macOS AddressBook (Contacts app)
    try {
      const abResult = this.loadAddressBookContacts(relevantAddresses);
      // AddressBook is lower priority than NickNameCache (shared names/photos are user-chosen)
      for (const [addr, name] of Object.entries(abResult.names)) {
        if (!names[addr]) {
          names[addr] = name;
        }
      }
      for (const [addr, photo] of Object.entries(abResult.photos)) {
        if (!photos[addr]) {
          photos[addr] = photo;
        }
      }
      this.log.info(
        `AddressBook: ${Object.keys(abResult.names).length} names, ${Object.keys(abResult.photos).length} photos`,
      );
    } catch (err) {
      this.log.warn('Failed to read AddressBook:', err);
    }

    return { names, photos };
  }

  /** Load contact names and photos from macOS AddressBook (Contacts app) */
  private loadAddressBookContacts(relevantAddresses?: Set<string>): NickNameResult {
    const names: Record<string, string> = {};
    const photos: Record<string, string> = {};

    if (!existsSync(this.addressBookDir)) return { names, photos };

    // Find all AddressBook source databases
    const sourcesDir = join(this.addressBookDir, 'Sources');
    const dbPaths: string[] = [];

    // Main database
    const mainDb = join(this.addressBookDir, 'AddressBook-v22.abcddb');
    if (existsSync(mainDb)) dbPaths.push(mainDb);

    // Source databases (iCloud, Exchange, etc.)
    if (existsSync(sourcesDir)) {
      try {
        for (const entry of readdirSync(sourcesDir)) {
          const srcDb = join(sourcesDir, entry, 'AddressBook-v22.abcddb');
          if (existsSync(srcDb)) dbPaths.push(srcDb);
        }
      } catch {
        // ignore permission errors
      }
    }

    for (const dbPath of dbPaths) {
      try {
        this.parseAddressBookDb(dbPath, names, photos, relevantAddresses);
      } catch (err) {
        this.log.warn(`Failed to parse AddressBook database ${dbPath}:`, err);
      }
    }

    return { names, photos };
  }

  /** Parse a single AddressBook database for contacts with phone/email and optionally photos */
  private parseAddressBookDb(dbPath: string, names: Record<string, string>, photos: Record<string, string>, relevantAddresses?: Set<string>): void {
    // Query contacts with their phone numbers and image data
    // The image data has a 1-byte prefix before the actual JPEG data
    const query = `
      SELECT r.Z_PK, r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, r.ZNICKNAME,
             CASE WHEN r.ZTHUMBNAILIMAGEDATA IS NOT NULL THEN 1 ELSE 0 END as has_thumb,
             CASE WHEN r.ZIMAGEDATA IS NOT NULL THEN 1 ELSE 0 END as has_image
      FROM ZABCDRECORD r
      WHERE r.ZFIRSTNAME IS NOT NULL OR r.ZLASTNAME IS NOT NULL OR r.ZORGANIZATION IS NOT NULL;`;

    let output: string;
    try {
      output = execFileSync('/usr/bin/sqlite3', ['-separator', '\t', dbPath, query], {
        encoding: 'utf-8',
        timeout: 15000,
      });
    } catch {
      return;
    }

    // Build a map of contact PKs to their info
    const contactMap = new Map<string, { firstName: string; lastName: string; org: string; nickname: string; hasThumb: boolean; hasImage: boolean }>();
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      const [pk, firstName, lastName, org, nickname, hasThumb, hasImage] = parts;
      contactMap.set(pk, {
        firstName: firstName || '',
        lastName: lastName || '',
        org: org || '',
        nickname: nickname || '',
        hasThumb: hasThumb === '1',
        hasImage: hasImage === '1',
      });
    }

    if (contactMap.size === 0) return;

    // Get phone numbers for all contacts
    const phoneQuery = `SELECT ZOWNER, ZFULLNUMBER FROM ZABCDPHONENUMBER WHERE ZFULLNUMBER IS NOT NULL;`;
    let phoneOutput: string;
    try {
      phoneOutput = execFileSync('/usr/bin/sqlite3', ['-separator', '\t', dbPath, phoneQuery], {
        encoding: 'utf-8',
        timeout: 15000,
      });
    } catch {
      phoneOutput = '';
    }

    // Get email addresses for all contacts
    const emailQuery = `SELECT ZOWNER, ZADDRESS FROM ZABCDEMAILADDRESS WHERE ZADDRESS IS NOT NULL;`;
    let emailOutput: string;
    try {
      emailOutput = execFileSync('/usr/bin/sqlite3', ['-separator', '\t', dbPath, emailQuery], {
        encoding: 'utf-8',
        timeout: 15000,
      });
    } catch {
      emailOutput = '';
    }

    // Map contact PKs to normalized addresses
    const pkToAddresses = new Map<string, string[]>();
    for (const line of phoneOutput.trim().split('\n')) {
      if (!line) continue;
      const [owner, fullNumber] = line.split('\t');
      if (!owner || !fullNumber) continue;
      const normalized = normalizeAddress(fullNumber);
      if (!pkToAddresses.has(owner)) pkToAddresses.set(owner, []);
      pkToAddresses.get(owner)!.push(normalized);
    }
    for (const line of emailOutput.trim().split('\n')) {
      if (!line) continue;
      const [owner, address] = line.split('\t');
      if (!owner || !address) continue;
      const normalized = normalizeAddress(address);
      if (!pkToAddresses.has(owner)) pkToAddresses.set(owner, []);
      pkToAddresses.get(owner)!.push(normalized);
    }

    // Build names for all contacts with addresses
    for (const [pk, contact] of contactMap) {
      const addresses = pkToAddresses.get(pk);
      if (!addresses || addresses.length === 0) continue;

      // Build display name
      const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
        || contact.nickname
        || contact.org
        || null;

      if (!displayName) continue;

      for (const addr of addresses) {
        if (!names[addr]) {
          names[addr] = displayName;
        }
      }
    }

    // Load photos for contacts that have them (only if not already in photos map)
    // When relevantAddresses is provided, only load photos for contacts with matching addresses
    const pksNeedingPhotos: string[] = [];
    for (const [pk, contact] of contactMap) {
      if (!contact.hasThumb && !contact.hasImage) continue;
      const addresses = pkToAddresses.get(pk);
      if (!addresses) continue;
      // If a filter is provided, even an empty one, skip contacts with no
      // matching addresses. Startup passes an empty set intentionally to avoid
      // loading every AddressBook photo into plugin/frontend memory.
      if (relevantAddresses && !addresses.some(addr => relevantAddresses.has(addr))) continue;
      // Only load if at least one address doesn't have a photo yet
      if (addresses.some(addr => !photos[addr])) {
        pksNeedingPhotos.push(pk);
      }
    }

    if (pksNeedingPhotos.length === 0) return;

    // Load in batches of 20 to avoid excessive memory from hex-encoded image data
    const batchSize = 20;
    for (let i = 0; i < pksNeedingPhotos.length; i += batchSize) {
      const batch = pksNeedingPhotos.slice(i, i + batchSize);
      this.loadAddressBookPhotoBatch(dbPath, batch, pkToAddresses, photos);
    }
  }

  /** Load a batch of photos from AddressBook database */
  private loadAddressBookPhotoBatch(
    dbPath: string,
    pks: string[],
    pkToAddresses: Map<string, string[]>,
    photos: Record<string, string>,
  ): void {
    // Use ZTHUMBNAILIMAGEDATA (smaller) if available, otherwise ZIMAGEDATA
    const photoQuery = `
      SELECT Z_PK, hex(COALESCE(ZTHUMBNAILIMAGEDATA, ZIMAGEDATA))
      FROM ZABCDRECORD
      WHERE Z_PK IN (${pks.join(',')})
      AND (ZTHUMBNAILIMAGEDATA IS NOT NULL OR ZIMAGEDATA IS NOT NULL);`;

    let photoOutput: string;
    try {
      photoOutput = execFileSync('/usr/bin/sqlite3', ['-separator', '\t', dbPath, photoQuery], {
        encoding: 'utf-8',
        timeout: 15000,
        maxBuffer: 20 * 1024 * 1024, // 20MB buffer (enough for 20 photos as hex)
      });
    } catch {
      return;
    }

    for (const line of photoOutput.trim().split('\n')) {
      if (!line) continue;
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) continue;
      const pk = line.slice(0, tabIdx);
      const hexData = line.slice(tabIdx + 1);
      if (!hexData || hexData.length < 10) continue;

      const addresses = pkToAddresses.get(pk);
      if (!addresses) continue;

      // Convert hex to buffer, skip the 1-byte prefix (0x01) before JPEG data
      const buffer = Buffer.from(hexData, 'hex');
      const imageBuffer = buffer[0] === 0x01 ? buffer.slice(1) : buffer;

      // Detect format
      const isJpeg = imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8;
      const isPng = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50;
      const mime = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : 'image/jpeg';

      const dataUri = `data:${mime};base64,${imageBuffer.toString('base64')}`;

      for (const addr of addresses) {
        if (!photos[addr]) {
          photos[addr] = dataUri;
        }
      }
    }
  }

  /** Parse a nickname key store database (pending or handled) */
  private parseNicknameDb(dbPath: string, hasNames: boolean): ParsedNickname[] {
    if (!existsSync(dbPath)) return [];

    const results: ParsedNickname[] = [];

    try {
      // Query all records as key|hexblob
      const output = execFileSync('/usr/bin/sqlite3', [dbPath, 'SELECT key, hex(value) FROM kvtable;'], {
        encoding: 'utf-8',
        timeout: 10000,
      });

      for (const line of output.trim().split('\n')) {
        if (!line) continue;
        const pipeIdx = line.indexOf('|');
        if (pipeIdx === -1) continue;

        const key = line.slice(0, pipeIdx);
        const hexBlob = line.slice(pipeIdx + 1);

        try {
          const parsed = this.parseBplistBlob(hexBlob);
          if (!parsed) continue;

          const nickname: ParsedNickname = {
            handleId: (parsed.hid as string) || key,
            recordId: (parsed.rid as string) || '',
          };

          if (hasNames) {
            nickname.firstName = parsed.fn as string | undefined;
            nickname.lastName = parsed.ln as string | undefined;
            nickname.displayName = parsed.dn as string | undefined;
          }

          // Extract avatar path from 'ai' (avatar info) dict
          const avatarInfo = parsed.ai;
          if (avatarInfo && typeof avatarInfo === 'object' && 'imageFilePath' in avatarInfo) {
            const imgPath = (avatarInfo as any).imageFilePath as string;
            if (imgPath && existsSync(imgPath)) {
              nickname.avatarPath = imgPath;
            }
          }

          // If no avatar from ai dict, try finding by recordId
          if (!nickname.avatarPath && nickname.recordId) {
            const fallbackPath = this.findAvatarPath(nickname.recordId);
            if (fallbackPath) {
              nickname.avatarPath = fallbackPath;
            }
          }

          results.push(nickname);
        } catch (err) {
          this.log.warn(`Failed to parse nickname record for ${key}:`, err);
        }
      }
    } catch (err) {
      this.log.warn(`Failed to query database ${dbPath}:`, err);
    }

    return results;
  }

  /** Parse the activeNicknameRecords blob from nicknameRecordsStore.db */
  private parseActiveRecords(): Record<string, string> {
    const dbPath = join(this.cacheDir, 'nicknameRecordsStore.db');
    if (!existsSync(dbPath)) return {};

    try {
      const output = execFileSync('/usr/bin/sqlite3', [
        dbPath,
        "SELECT hex(value) FROM kvtable WHERE key='activeNicknameRecords';",
      ], { encoding: 'utf-8', timeout: 10000 });

      const hexBlob = output.trim();
      if (!hexBlob) return {};

      const parsed = this.parseBplistBlob(hexBlob);
      if (!parsed || typeof parsed !== 'object') return {};

      // It's a dict mapping phone numbers to record IDs
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string' && (key.startsWith('+') || key.includes('@'))) {
          result[key] = value;
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  /** Convert a hex-encoded bplist blob to a resolved JS object */
  private parseBplistBlob(hexBlob: string): any {
    // Convert hex string to binary buffer
    const buffer = Buffer.from(hexBlob, 'hex');

    // Use plutil to convert bplist to XML (reads from stdin with `-- -`)
    let xml: string;
    try {
      xml = execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '--', '-'], {
        input: buffer,
        encoding: 'utf-8',
        timeout: 5000,
      });
    } catch {
      return null;
    }

    // Parse XML into plist structure
    const plist = parsePlistXml(xml);
    if (!plist || typeof plist !== 'object') return null;

    // Resolve NSKeyedArchiver references
    return resolveKeyedArchiver(plist);
  }

  /** Find the avatar PNG file for a given record ID */
  private findAvatarPath(recordId: string): string | null {
    if (!recordId) return null;

    // Record IDs like "wb2imEV0vetbynUOROi+lQ==" become filenames with / replaced by _
    // and the suffix -ad for avatar data
    const safeId = recordId.replace(/\//g, '_');
    const avatarFile = join(this.cacheDir, `${safeId}-ad`);

    if (existsSync(avatarFile)) return avatarFile;

    // Also try finding in directory listing (handles edge cases in encoding)
    try {
      const files = readdirSync(this.cacheDir);
      const match = files.find((f) => f.endsWith('-ad') && f.startsWith(safeId.slice(0, -3)));
      if (match) return join(this.cacheDir, match);
    } catch {
      // ignore
    }

    return null;
  }

  /** Load a PNG avatar file and convert to data URI */
  /** Load a PNG/JPEG avatar file, resize to thumbnail, and convert to data URI */
  private loadAvatarAsDataUri(avatarPath: string): string | null {
    try {
      if (!existsSync(avatarPath)) return null;
      const buffer = readFileSync(avatarPath);
      if (buffer.length === 0) return null;

      // If the file is already small enough (<50KB), use it directly
      if (buffer.length < 50 * 1024) {
        const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
        const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
        const mime = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/png';
        return `data:${mime};base64,${buffer.toString('base64')}`;
      }

      // Use sips (built-in macOS tool) to resize to 200x200 JPEG for smaller payload
      try {
        const tmpOut = join(this.cacheDir, '.tmp_avatar_resize.jpg');
        execFileSync('/usr/bin/sips', [
          '-z', '200', '200',
          '-s', 'format', 'jpeg',
          '-s', 'formatOptions', '70',
          avatarPath,
          '--out', tmpOut,
        ], { timeout: 5000, stdio: 'pipe' });

        if (existsSync(tmpOut)) {
          const resized = readFileSync(tmpOut);
          try { unlinkSync(tmpOut); } catch { /* ignore */ }
          if (resized.length > 100) {
            return `data:image/jpeg;base64,${resized.toString('base64')}`;
          }
        }
      } catch {
        // sips failed, fall back to raw file
      }

      // Fallback: use raw file (will be large but functional)
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
      const mime = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }
}
