import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Contributions } from '../../../src/core/types';
import { createCacheStore, type CacheEntry, type CacheKey } from '../../../src/services/cache/store';

const store = createCacheStore();

const key: CacheKey = { viewerLogin: 'monalisa', profileLogin: 'monalisa', mode: 'owner' };

const contributions: Contributions = {
  login: 'monalisa',
  mode: 'owner',
  days: {},
  totals: { commits: 0, repos: 0 },
  partial: false,
  fetchedAt: '2024-01-11T17:00:00.000Z',
};

function entry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return { contributions, lastSync: '2024-01-11T17:00:00.000Z', schemaVersion: 1, ...overrides };
}

beforeEach(() => store.clear());

describe('createCacheStore', () => {
  it('returns a put entry, and a different mode, viewer, or profile is a miss', async () => {
    await store.put(key, entry());
    await expect(store.get(key)).resolves.toEqual(entry());
    await expect(store.get({ ...key, mode: 'publicOnly' })).resolves.toBeUndefined();
    await expect(store.get({ ...key, viewerLogin: 'octocat' })).resolves.toBeUndefined();
    await expect(store.get({ ...key, profileLogin: 'hubot' })).resolves.toBeUndefined();

    const db = await openDB('commit-tracker', 1);
    await expect(db.getAllKeys('entries')).resolves.toEqual(['monalisa|monalisa|owner|1']);
    db.close();
  });

  it('treats logins that differ only by case as the same entry', async () => {
    await store.put({ viewerLogin: 'MonaLisa', profileLogin: 'MonaLisa', mode: 'owner' }, entry());
    await expect(store.get({ viewerLogin: 'monalisa', profileLogin: 'monalisa', mode: 'owner' })).resolves.toEqual(entry());
  });

  it('reads an entry stored with schemaVersion 0 as a miss', async () => {
    await store.put(key, entry({ schemaVersion: 0 }));
    await expect(store.get(key)).resolves.toBeUndefined();
  });

  it('clear removes the entry', async () => {
    await store.put(key, entry());
    await store.clear();
    await expect(store.get(key)).resolves.toBeUndefined();
  });
});
