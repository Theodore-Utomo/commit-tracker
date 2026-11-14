import { colorLevels } from '../core/aggregate';
import { gridDays } from '../core/grid';
import type { Contributions } from '../core/types';

const COLUMNS = 53;
const ROWS = 7;
const CELL = 10;
const GAP = 3;
const STEP = CELL + GAP;

export function Heatmap({ contributions, today }: { contributions: Contributions; today: string }) {
  const dates = gridDays(today);
  const levels = colorLevels(dates.map((date) => contributions.days[date]?.count ?? 0));
  const rects = [];
  for (let col = 0; col < COLUMNS; col += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      const index = col * 7 + row;
      const date = dates[index];
      if (date === undefined) {
        continue;
      }
      rects.push(
        <rect
          key={date}
          x={col * STEP}
          y={row * STEP}
          width={CELL}
          height={CELL}
          fill={`var(--contribution-default-bgColor-${levels[index] ?? 0})`}
        />,
      );
    }
  }

  return (
    <section>
      <h2>All commits across branches</h2>
      <svg width={COLUMNS * STEP - GAP} height={ROWS * STEP - GAP}>
        {rects}
      </svg>
    </section>
  );
}
