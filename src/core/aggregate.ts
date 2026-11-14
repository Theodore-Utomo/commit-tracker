import type { Commit, CountOnly, DayBucket } from './types';

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
