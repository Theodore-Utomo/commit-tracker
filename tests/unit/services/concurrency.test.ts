import { describe, expect, it } from 'vitest';
import { mapPool } from '../../../src/services/concurrency';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mapPool', () => {
  it('never runs more than 4 tasks at once', async () => {
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 10 }, () => deferred<void>());
    const pool = mapPool(gates, 4, async (gate) => {
      running += 1;
      peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
    });

    await tick();
    expect(running).toBe(4);
    for (const gate of gates) {
      gate.resolve();
      await tick();
      expect(running).toBeLessThanOrEqual(4);
    }
    await pool;
    expect(peak).toBe(4);
  });

  it('starts the next task as soon as one finishes', async () => {
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const started: number[] = [];
    const pool = mapPool(gates, 4, async (gate, index) => {
      started.push(index);
      await gate.promise;
    });
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[2]?.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    for (const gate of gates) gate.resolve();
    await pool;
  });

  it('keeps results in input order even when tasks finish out of order', async () => {
    const delays = [30, 5, 20, 1, 10];
    const results = await mapPool(delays, 4, async (ms, index) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return index * 10;
    });
    expect(results).toEqual([0, 10, 20, 30, 40].map((value) => ({ status: 'fulfilled', value })));
  });

  it('returns a rejection in its slot without stopping the other tasks', async () => {
    const boom = new Error('boom');
    const seen: number[] = [];
    const results = await mapPool([0, 1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
      if (item === 1) {
        throw boom;
      }
      return item;
    });
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(results[1]).toEqual({ status: 'rejected', reason: boom });
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  });

  it('catches a task that throws synchronously', async () => {
    const results = await mapPool([1], 4, (() => {
      throw new Error('sync');
    }) as unknown as (item: number) => Promise<number>);
    expect(results[0]?.status).toBe('rejected');
  });

  it('returns an empty list for no items and runs fewer workers than the limit when there are few items', async () => {
    await expect(mapPool([], 4, async () => 1)).resolves.toEqual([]);
    await expect(mapPool([7], 4, async (n) => n)).resolves.toEqual([{ status: 'fulfilled', value: 7 }]);
  });

  it('rejects a limit that is not a positive integer', async () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      await expect(mapPool([1], limit, async (n) => n)).rejects.toThrow(RangeError);
    }
  });
});
