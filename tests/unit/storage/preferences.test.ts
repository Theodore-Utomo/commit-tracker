import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as preferences from '../../../src/storage/preferences';
import {
  getAlwaysShow,
  getShowAllBranches,
  setAlwaysShow,
  setShowAllBranches,
} from '../../../src/storage/preferences';

describe('display preferences', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to false', async () => {
    await expect(getAlwaysShow()).resolves.toBe(false);
  });

  it('round-trips alwaysShow', async () => {
    await setAlwaysShow(true);
    await expect(getAlwaysShow()).resolves.toBe(true);
    await expect(fakeBrowser.storage.local.get('alwaysShow')).resolves.toEqual({ alwaysShow: true });

    await setAlwaysShow(false);
    await expect(getAlwaysShow()).resolves.toBe(false);
    await expect(fakeBrowser.storage.local.get('alwaysShow')).resolves.toEqual({ alwaysShow: false });
  });

  it('reads an unset showAllBranches as true', async () => {
    await expect(getShowAllBranches()).resolves.toBe(true);
  });

  it('round-trips showAllBranches', async () => {
    await setShowAllBranches(false);
    await expect(getShowAllBranches()).resolves.toBe(false);
    await expect(fakeBrowser.storage.local.get('showAllBranches')).resolves.toEqual({ showAllBranches: false });

    await setShowAllBranches(true);
    await expect(getShowAllBranches()).resolves.toBe(true);
  });

  it('keeps the two preferences apart', async () => {
    await setShowAllBranches(false);
    await expect(getAlwaysShow()).resolves.toBe(false);
    await setAlwaysShow(true);
    await expect(getShowAllBranches()).resolves.toBe(false);
  });

  it('exports no token getter', () => {
    expect(Object.keys(preferences).sort()).toEqual([
      'getAlwaysShow',
      'getShowAllBranches',
      'setAlwaysShow',
      'setShowAllBranches',
    ]);
  });
});
