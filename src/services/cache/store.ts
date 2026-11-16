import { openDB, type IDBPDatabase } from 'idb';
import type { Contributions, PrivacyMode } from '../../core/types';

const DB_NAME = 'commit-tracker';
const STORE = 'entries';

/** Bump when the stored shape changes. Older values read as a miss. */
export const SCHEMA_VERSION = 1;

export interface CacheKey {
  viewerLogin: string;
  profileLogin: string;
  mode: PrivacyMode;
}

export interface CacheEntry {
  contributions: Contributions;
  /** ISO time the fetch started. Not a commit date. */
  lastSync: string;
  schemaVersion: number;
  /**
   * SHA-256 of the saved emails the entry was fetched with, `''` when none were used. A different
   * value reads as a miss, so an added email's older commits are found and a removed one's dropped.
   * Older entries have no value and match only `''`.
   */
  emailsKey?: string;
}

export interface CacheStore {
  get(key: CacheKey): Promise<CacheEntry | undefined>;
  put(key: CacheKey, entry: CacheEntry): Promise<void>;
  clear(): Promise<void>;
}

/** `${viewer}|${profile}|${mode}|1`, both logins lowercased. */
function idFor(key: CacheKey): string {
  return `${key.viewerLogin.toLowerCase()}|${key.profileLogin.toLowerCase()}|${key.mode}|${SCHEMA_VERSION}`;
}

function readable(value: unknown): CacheEntry | undefined {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    return undefined;
  }
  return value.schemaVersion === SCHEMA_VERSION ? (value as CacheEntry) : undefined;
}

/** IndexedDB cache. One record per viewer, profile, and mode. */
export function createCacheStore(): CacheStore {
  let opening: Promise<IDBPDatabase> | undefined;

  function database(): Promise<IDBPDatabase> {
    opening ??= openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
    return opening;
  }

  return {
    async get(key) {
      return readable(await (await database()).get(STORE, idFor(key)));
    },
    async put(key, entry) {
      await (await database()).put(STORE, entry, idFor(key));
    },
    async clear() {
      await (await database()).clear(STORE);
    },
  };
}
