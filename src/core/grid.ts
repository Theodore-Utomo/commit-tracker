const DAY_MS = 86_400_000;
const WEEKS = 53;
const GRID_LENGTH = WEEKS * 7;
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The 371 civil dates (`YYYY-MM-DD`) of the heatmap for `today`: from the Sunday
 * 52 weeks before today's week, through the Saturday of today's week.
 * `today` is a civil date, not a timestamp, so no time zone is involved.
 */
export function gridDays(today: string): string[] {
  const match = CIVIL_DATE.exec(today);
  if (match === null) {
    throw new RangeError(`Expected a YYYY-MM-DD date, got "${today}".`);
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const todayMs = Date.UTC(year, month - 1, day);
  const check = new Date(todayMs);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`"${today}" is not a real calendar date.`);
  }

  const sundayMs = todayMs - check.getUTCDay() * DAY_MS;
  const startMs = sundayMs - (WEEKS - 1) * 7 * DAY_MS;
  return Array.from({ length: GRID_LENGTH }, (_, i) => new Date(startMs + i * DAY_MS).toISOString().slice(0, 10));
}
