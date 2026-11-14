import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getCommitEmails, getToken, hasToken, setCommitEmails, setToken } from '../../../src/services/settings';

describe('token settings', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('returns undefined when no token is saved', async () => {
    await expect(getToken()).resolves.toBeUndefined();
    await expect(hasToken()).resolves.toBe(false);
  });

  it('returns undefined for a blank or whitespace-only stored value', async () => {
    for (const blank of ['', '   ', '\n\t']) {
      await fakeBrowser.storage.local.set({ githubToken: blank });
      await expect(getToken()).resolves.toBeUndefined();
      await expect(hasToken()).resolves.toBe(false);
    }
  });

  it('round-trips a token under local:githubToken, trimmed', async () => {
    await setToken('  ghp_example  ');

    await expect(getToken()).resolves.toBe('ghp_example');
    await expect(hasToken()).resolves.toBe(true);
    await expect(fakeBrowser.storage.local.get('githubToken')).resolves.toEqual({ githubToken: 'ghp_example' });
  });

  it('removes the saved token when given a blank value', async () => {
    await setToken('ghp_example');
    await setToken('   ');

    await expect(getToken()).resolves.toBeUndefined();
    await expect(fakeBrowser.storage.local.get('githubToken')).resolves.toEqual({});
  });
});

describe('commit emails', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to an empty list', async () => {
    await expect(getCommitEmails()).resolves.toEqual([]);
  });

  it('round-trips a list under local:commitEmails', async () => {
    await setCommitEmails(['dev@example.com', 'other@example.com']);

    await expect(getCommitEmails()).resolves.toEqual(['dev@example.com', 'other@example.com']);
    await expect(fakeBrowser.storage.local.get('commitEmails')).resolves.toEqual({
      commitEmails: ['dev@example.com', 'other@example.com'],
    });
  });

  it('drops blank entries and trims the rest', async () => {
    await setCommitEmails(['  dev@example.com  ', '', '   ', 'other@example.com']);

    await expect(getCommitEmails()).resolves.toEqual(['dev@example.com', 'other@example.com']);
  });
});
