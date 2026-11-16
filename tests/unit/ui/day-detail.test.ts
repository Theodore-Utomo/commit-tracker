import { describe, expect, it } from 'vitest';
import { dayLines } from '../../../src/ui/DayDetail';
import { commit, countOnly, privateRepo } from '../core/fixtures';

const DATE = '2024-01-11';

describe('dayLines', () => {
  it('gives a full commit its message, owner/name, and branch', () => {
    const lines = dayLines({ date: DATE, count: 1, commits: [commit()] });
    expect(lines).toEqual(['Add widget — acme/widgets (main)']);
  });

  it('leaves out the branch when a commit was found only through a pull request', () => {
    const fromPr = commit({ branch: undefined, source: 'pr', messageHeadline: 'Squashed work' });
    expect(dayLines({ date: DATE, count: 1, commits: [fromPr] })).toEqual(['Squashed work — acme/widgets']);
  });

  it('passes markup in a message through as plain text', () => {
    const marked = commit({ messageHeadline: '<img src=x onerror=alert(1)>' });
    expect(dayLines({ date: DATE, count: 1, commits: [marked] })).toEqual([
      '<img src=x onerror=alert(1)> — acme/widgets (main)',
    ]);
  });

  it('lists one line per full commit, in order', () => {
    const first = commit({ sha: 'a1', messageHeadline: 'First' });
    const second = commit({ sha: 'a2', messageHeadline: 'Second', repo: privateRepo, branch: 'feature' });
    expect(dayLines({ date: DATE, count: 2, commits: [first, second] })).toEqual([
      'First — acme/widgets (main)',
      'Second — acme/secret (feature)',
    ]);
  });

  it('turns count-only values into one private-commits line with no message or repository', () => {
    const lines = dayLines({
      date: DATE,
      count: 3,
      commits: [countOnly({ sha: 'p1' }), commit(), countOnly({ sha: 'p2' })],
    });
    expect(lines).toEqual(['Add widget — acme/widgets (main)', '2 private commits']);
  });

  it('gives a day of only count-only values just the private-commits line', () => {
    const lines = dayLines({ date: DATE, count: 1, commits: [countOnly()] });
    expect(lines).toEqual(['1 private commit']);
    expect(lines.join(' ')).not.toMatch(/acme|widget|secret/);
  });

  it.each([
    ['no commits field', { date: DATE, count: 3 }],
    ['an empty commits list', { date: DATE, count: 3, commits: [] }],
  ])('gives a positive count with %s as the count alone', (_label, day) => {
    expect(dayLines(day)).toEqual(['3 commits']);
  });

  it('says "1 commit" for a count of one with no commits', () => {
    expect(dayLines({ date: DATE, count: 1 })).toEqual(['1 commit']);
  });

  it.each([
    ['a missing day', undefined],
    ['a zero count', { date: DATE, count: 0 }],
    ['a zero count with an empty list', { date: DATE, count: 0, commits: [] }],
  ])('gives %s "No commits"', (_label, day) => {
    expect(dayLines(day)).toEqual(['No commits']);
  });
});
