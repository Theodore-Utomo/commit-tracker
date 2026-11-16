import { describe, expect, it } from 'vitest';
import {
  aggregateByDay,
  colorLevels,
  inGridYear,
  isCountOnly,
  localDay,
  startOfLocalDayIso,
} from '../../../src/core/aggregate';
import { gridDays } from '../../../src/core/grid';
import { commit, countOnly, privateRepo } from './fixtures';

const NEW_YORK = 'America/New_York';

describe('localDay', () => {
  it.each([
    ['just before local midnight', '2024-01-11T04:30:00Z', '2024-01-10'],
    ['just after local midnight', '2024-01-11T05:30:00Z', '2024-01-11'],
  ])('puts a timestamp %s in New York on the right day', (_label, iso, day) => {
    expect(localDay(iso, NEW_YORK)).toBe(day);
  });

  it('uses the given time zone, not the machine zone', () => {
    expect(localDay('2024-01-11T04:30:00Z', 'UTC')).toBe('2024-01-11');
    expect(localDay('2024-01-11T23:30:00Z', 'Asia/Tokyo')).toBe('2024-01-12');
  });

  it('reads a timestamp that carries its own offset', () => {
    expect(localDay('2024-01-10T23:30:00-05:00', NEW_YORK)).toBe('2024-01-10');
    expect(localDay('2024-01-10T23:30:00-05:00', 'UTC')).toBe('2024-01-11');
  });

  it('throws RangeError for a timestamp that is not a date', () => {
    expect(() => localDay('not-a-date', 'UTC')).toThrow(RangeError);
  });

  it('throws RangeError for an unknown time zone', () => {
    expect(() => localDay('2024-01-11T12:00:00Z', 'Not/AZone')).toThrow(RangeError);
  });

  it('handles a daylight-saving change', () => {
    // US clocks spring forward on 2024-03-10; 04:30Z is 23:30 EST the night before, 07:30Z is 03:30 EDT.
    expect(localDay('2024-03-10T04:30:00Z', NEW_YORK)).toBe('2024-03-09');
    expect(localDay('2024-03-10T07:30:00Z', NEW_YORK)).toBe('2024-03-10');
  });
});

describe('inGridYear', () => {
  const grid = gridDays('2024-01-11'); // 2023-01-08 .. 2024-01-13

  it('keeps items on the grid start and the grid end', () => {
    const start = commit({ sha: 's', authoredDate: '2023-01-08T12:00:00Z' });
    const end = commit({ sha: 'e', authoredDate: '2024-01-13T12:00:00Z' });
    expect(inGridYear([start, end], grid, 'UTC')).toEqual([start, end]);
  });

  it('drops items on the day before the start and the day after the end', () => {
    const before = commit({ sha: 'b', authoredDate: '2023-01-07T12:00:00Z' });
    const after = commit({ sha: 'a', authoredDate: '2024-01-14T12:00:00Z' });
    expect(inGridYear([before, after], grid, 'UTC')).toEqual([]);
  });

  it('decides by local day, so a UTC timestamp just inside the grid can fall outside it', () => {
    // 2023-01-08T03:00Z is 2023-01-07 22:00 in New York, the day before the grid start.
    const early = commit({ authoredDate: '2023-01-08T03:00:00Z' });
    expect(inGridYear([early], grid, 'UTC')).toEqual([early]);
    expect(inGridYear([early], grid, NEW_YORK)).toEqual([]);
  });

  it('keeps count-only values too', () => {
    const value = countOnly({ authoredDate: '2023-06-01T12:00:00Z' });
    expect(inGridYear([value], grid, 'UTC')).toEqual([value]);
  });
});

describe('isCountOnly', () => {
  it('tells a count-only value from a full commit', () => {
    expect(isCountOnly(countOnly())).toBe(true);
    expect(isCountOnly(commit())).toBe(false);
  });
});

describe('aggregateByDay', () => {
  it('groups by local day in the given time zone', () => {
    const late = commit({ sha: 'late', authoredDate: '2024-01-11T04:30:00Z' });
    const early = commit({ sha: 'early', authoredDate: '2024-01-11T05:30:00Z' });
    const { days } = aggregateByDay([late, early], NEW_YORK);
    expect(days['2024-01-10']).toEqual({ date: '2024-01-10', count: 1, commits: [late] });
    expect(days['2024-01-11']).toEqual({ date: '2024-01-11', count: 1, commits: [early] });
  });

  it('counts a repeated SHA once and stores it once', () => {
    const first = commit({ branch: 'main' });
    const repeat = commit({ branch: 'feature' });
    const { days, totals } = aggregateByDay([first, repeat], 'UTC');
    expect(days['2024-01-11']).toEqual({ date: '2024-01-11', count: 1, commits: [first] });
    expect(totals.commits).toBe(1);
  });

  it('counts a repeated SHA once even when the copies have different dates', () => {
    const first = commit({ authoredDate: '2024-01-11T12:00:00Z' });
    const shifted = commit({ authoredDate: '2024-01-12T12:00:00Z' });
    const { days, totals } = aggregateByDay([first, shifted], 'UTC');
    expect(Object.keys(days)).toEqual(['2024-01-11']);
    expect(totals.commits).toBe(1);
  });

  it('counts a count-only value, stores it on its day, and adds no repository', () => {
    const full = commit({ sha: 'a1' });
    const hidden = countOnly({ sha: 'p1' });
    const { days, totals } = aggregateByDay([full, hidden], 'UTC');
    expect(days['2024-01-11']).toEqual({ date: '2024-01-11', count: 2, commits: [full, hidden] });
    expect(totals).toEqual({ commits: 2, repos: 1 });
  });

  it('keeps the first item when a count-only value and a full commit share a SHA', () => {
    const hidden = countOnly({ sha: 'x' });
    const full = commit({ sha: 'x' });
    const { days, totals } = aggregateByDay([hidden, full], 'UTC');
    expect(days['2024-01-11']).toEqual({ date: '2024-01-11', count: 1, commits: [hidden] });
    expect(totals).toEqual({ commits: 1, repos: 0 });
  });

  it('counts distinct owner/name pairs as repositories', () => {
    const items = [
      commit({ sha: 'a1' }),
      commit({ sha: 'a2' }),
      commit({ sha: 'b1', repo: privateRepo }),
      commit({ sha: 'c1', repo: { ...privateRepo, owner: 'other' } }),
    ];
    expect(aggregateByDay(items, 'UTC').totals.repos).toBe(3);
  });

  it('inserts no empty days and returns zero totals for no items', () => {
    expect(aggregateByDay([], 'UTC')).toEqual({ days: {}, totals: { commits: 0, repos: 0 } });
  });

  it('does not mutate its input', () => {
    const items = [commit({ sha: 'a1' }), commit({ sha: 'a1', branch: 'feature' })];
    const copy = structuredClone(items);
    aggregateByDay(items, 'UTC');
    expect(items).toEqual(copy);
  });
});

describe('colorLevels', () => {
  it('keeps every zero at level 0', () => {
    expect(colorLevels([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('maps one distinct positive count to level 1', () => {
    expect(colorLevels([0, 4, 4])).toEqual([0, 1, 1]);
  });

  it('maps two days with count 2 and one day with count 9 to levels 1 and 3', () => {
    expect(colorLevels([2, 9, 2])).toEqual([1, 3, 1]);
  });

  it('maps distinct counts 1, 2, 3 to levels 1, 2, 3', () => {
    expect(colorLevels([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('maps four increasing counts to levels 1, 2, 3, and 4', () => {
    expect(colorLevels([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('maps eight distinct counts to 1, 1, 2, 2, 3, 3, 4, 4', () => {
    expect(colorLevels([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('sorts counts numerically, so 2 ranks below 10', () => {
    expect(colorLevels([10, 2])).toEqual([3, 1]);
  });

  it('gives days with the same count the same level', () => {
    const counts = [5, 1, 5, 9, 1, 0, 9];
    const levels = colorLevels(counts);
    for (let i = 0; i < counts.length; i += 1) {
      for (let j = i + 1; j < counts.length; j += 1) {
        if (counts[i] === counts[j]) {
          expect(levels[i]).toBe(levels[j]);
        }
      }
    }
    expect(levels[5]).toBe(0);
    expect(new Set(levels.filter((level) => level > 0)).size).toBe(3);
  });
});

describe('startOfLocalDayIso', () => {
  it.each([
    ['2023-01-08', 'America/New_York', '2023-01-08T00:00:00-05:00'],
    ['2023-07-09', 'America/New_York', '2023-07-09T00:00:00-04:00'],
    ['2023-01-08', 'UTC', '2023-01-08T00:00:00+00:00'],
    ['2023-01-08', 'Asia/Kolkata', '2023-01-08T00:00:00+05:30'],
    ['2023-01-08', 'Asia/Kathmandu', '2023-01-08T00:00:00+05:45'],
    ['2023-01-08', 'Pacific/Kiritimati', '2023-01-08T00:00:00+14:00'],
    ['2023-01-08', 'Pacific/Pago_Pago', '2023-01-08T00:00:00-11:00'],
    ['2024-03-31', 'Europe/London', '2024-03-31T00:00:00+00:00'],
  ])('gives the start of %s in %s', (day, zone, expected) => {
    expect(startOfLocalDayIso(day, zone)).toBe(expected);
  });

  it('gives the first real local time when clocks skip midnight', () => {
    // Chile springs forward from 00:00 to 01:00 on 2024-09-08.
    expect(startOfLocalDayIso('2024-09-08', 'America/Santiago')).toBe('2024-09-08T01:00:00-03:00');
  });

  it('names the instant that starts the day, so a minute earlier is the previous day', () => {
    for (const zone of ['America/New_York', 'Asia/Kathmandu', 'America/Santiago']) {
      const start = Date.parse(startOfLocalDayIso('2024-09-08', zone));
      const day = (ms: number) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
      expect(day(start)).toBe('2024-09-08');
      expect(day(start - 60_000)).toBe('2024-09-07');
    }
  });
});
