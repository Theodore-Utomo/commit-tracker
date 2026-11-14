import type { Commit, CountOnly, DayBucket } from './types';

const MINUTE_MS = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The `YYYY-MM-DD` of an ISO timestamp in `timeZone`. */
export function localDay(iso: string, timeZone: string): string {
  const parts = formatterFor(timeZone).formatToParts(new Date(iso));
  const part = (type: 'year' | 'month' | 'day'): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The first instant of civil `day` (`YYYY-MM-DD`) in `timeZone`, as an ISO timestamp with that
 * zone's offset, for example `2023-01-08T00:00:00-05:00`. Where midnight does not exist because
 * clocks spring forward at 00:00, this is the first local time that does exist that day.
 */
export function startOfLocalDayIso(day: string, timeZone: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  // Every zone's offset is within ±14 hours, so the day starts inside this window. Local day
  // only moves forward with time, so a binary search over minutes finds the first one in `day`.
  let low = Date.UTC(year, month - 1, date) / MINUTE_MS - 15 * 60;
  let high = low + 30 * 60;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDay(new Date(middle * MINUTE_MS).toISOString(), timeZone) < day) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return formatWithOffset(low * MINUTE_MS, timeZone);
}

function zoneParts(instant: number, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatWithOffset(instant: number, timeZone: string): string {
  const p = zoneParts(instant, timeZone);
  // `longOffset` gives "GMT-05:00", or plain "GMT" for a zero offset.
  const offset = /^GMT([+-]\d{2}:\d{2})$/.exec(p.timeZoneName ?? '')?.[1] ?? '+00:00';
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

/** Keeps the items whose local day (from `authoredDate`) is one of the `grid` dates. */
export function inGridYear<T extends { authoredDate: string }>(
  items: readonly T[],
  grid: readonly string[],
  timeZone: string,
): T[] {
  const days = new Set(grid);
  return items.filter((item) => days.has(localDay(item.authoredDate, timeZone)));
}

export function isCountOnly(item: Commit | CountOnly): item is CountOnly {
  return 'private' in item && item.private === true;
}

export interface Aggregate {
  days: Record<string, DayBucket>;
  totals: { commits: number; repos: number };
}

/**
 * Groups items by local day. Each SHA counts once, on the day of its first occurrence.
 * Count-only values add to the counts but never to `totals.repos`. Empty days are not inserted.
 */
export function aggregateByDay(items: readonly (Commit | CountOnly)[], timeZone: string): Aggregate {
  const days: Record<string, DayBucket> = {};
  const seen = new Set<string>();
  const repos = new Set<string>();

  for (const item of items) {
    if (seen.has(item.sha)) {
      continue;
    }
    seen.add(item.sha);

    const date = localDay(item.authoredDate, timeZone);
    const bucket = (days[date] ??= { date, count: 0, commits: [] });
    bucket.count += 1;
    bucket.commits?.push(item);

    if (!isCountOnly(item)) {
      repos.add(`${item.repo.owner}/${item.repo.name}`);
    }
  }

  return { days, totals: { commits: seen.size, repos: repos.size } };
}
