import { isCountOnly } from '../core/aggregate';
import type { DayBucket } from '../core/types';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The text lines for one day: one per full commit (message, `owner/name`, and branch when
 * present), then one `<n> private commits` line when any count-only value is present. A day
 * whose count arrived without commits shows only the count. Nothing is fetched here.
 */
export function dayLines(day: DayBucket | undefined): string[] {
  const items = day?.commits ?? [];
  if (items.length === 0) {
    return day !== undefined && day.count > 0 ? [plural(day.count, 'commit')] : ['No commits'];
  }

  const lines: string[] = [];
  let hidden = 0;
  for (const item of items) {
    if (isCountOnly(item)) {
      hidden += 1;
      continue;
    }
    const where = `${item.repo.owner}/${item.repo.name}`;
    lines.push(`${item.messageHeadline} — ${item.branch === undefined ? where : `${where} (${item.branch})`}`);
  }
  if (hidden > 0) {
    lines.push(plural(hidden, 'private commit'));
  }
  return lines;
}

/** Lists one day's commits as text. `date` is the `YYYY-MM-DD` that was clicked. */
export function DayDetail({ date, day }: { date: string; day: DayBucket | undefined }) {
  return (
    <section class="day-detail" aria-label={`Commits on ${date}`}>
      <h3>{date}</h3>
      <ul>
        {dayLines(day).map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
