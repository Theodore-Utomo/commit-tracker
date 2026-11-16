import { describe, expect, it } from 'vitest';
import { gridDays } from '../../../src/core/grid';

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

describe('gridDays', () => {
  it.each([
    ['a Thursday', '2024-01-11'],
    ['the Sunday of that week', '2024-01-07'],
    ['the Saturday of that week', '2024-01-13'],
  ])('gives the same 371-day window for %s', (_label, today) => {
    const days = gridDays(today);
    expect(days).toHaveLength(371);
    expect(days[0]).toBe('2023-01-08');
    expect(days.at(-1)).toBe('2024-01-13');
  });

  it('starts on a Sunday, ends on a Saturday, and steps one civil day at a time', () => {
    const days = gridDays('2024-01-11');
    expect(weekday(days[0] as string)).toBe(0);
    expect(weekday(days.at(-1) as string)).toBe(6);
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i]).toBe(nextDay(days[i - 1] as string));
    }
  });

  it('includes today', () => {
    expect(gridDays('2024-01-11')).toContain('2024-01-11');
  });

  it.each([
    ['across a leap day', '2024-03-01', '2023-02-26', '2024-03-02'],
    ["when today's Sunday is in the previous year", '2025-01-01', '2023-12-31', '2025-01-04'],
  ])('has the right start and end %s', (_label, today, start, end) => {
    const days = gridDays(today);
    expect(days[0]).toBe(start);
    expect(days.at(-1)).toBe(end);
    expect(new Set(days).size).toBe(371);
  });

  it('includes the leap day inside a leap-year window', () => {
    expect(gridDays('2024-03-01')).toContain('2024-02-29');
  });

  it('accepts a real leap day', () => {
    expect(gridDays('2024-02-29')).toHaveLength(371);
  });

  it('gives the same fixed window whatever the machine time zone, because it never parses a timestamp', () => {
    // A Sunday: if gridDays parsed a timestamp and used local getters, a zone west of UTC
    // would turn it into Saturday and move the whole window back a week.
    const before = process.env.TZ;
    try {
      for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
        process.env.TZ = zone;
        const days = gridDays('2024-01-07');
        expect(days[0]).toBe('2023-01-08');
        expect(days.at(-1)).toBe('2024-01-13');
      }
    } finally {
      if (before === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = before;
      }
    }
  });

  it.each(['2024-1-11', '2024/01/11', '2024-01-11T00:00:00Z', '', '2024-02-30', '2023-02-29', '2023-13-01'])(
    'rejects the malformed or impossible date %j',
    (today) => {
      expect(() => gridDays(today)).toThrow(RangeError);
    },
  );
});
