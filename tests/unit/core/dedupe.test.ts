import { describe, expect, it } from 'vitest';
import { dedupeCommits } from '../../../src/core/dedupe';
import { commit } from './fixtures';

describe('dedupeCommits', () => {
  it('collapses three branch copies of one SHA and keeps the first branch name', () => {
    const result = dedupeCommits([
      commit({ branch: 'main' }),
      commit({ branch: 'feature' }),
      commit({ branch: 'release' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.branch).toBe('main');
  });

  it('keeps the branch copy when it comes before the pull-request copy', () => {
    const result = dedupeCommits([commit({ branch: 'feature' }), commit({ source: 'pr', branch: undefined })]);
    expect(result).toEqual([commit({ branch: 'feature' })]);
  });

  it('keeps the branch copy when it comes after the pull-request copy', () => {
    const result = dedupeCommits([commit({ source: 'pr', branch: undefined }), commit({ branch: 'feature' })]);
    expect(result).toEqual([commit({ branch: 'feature' })]);
  });

  it('after a pull-request copy, keeps the first branch copy that follows, not a later one', () => {
    const result = dedupeCommits([
      commit({ source: 'pr', branch: undefined }),
      commit({ branch: 'x' }),
      commit({ branch: 'y' }),
    ]);
    expect(result).toEqual([commit({ branch: 'x' })]);
  });

  it('keeps the first pull-request copy when there is no branch copy', () => {
    const first = commit({ source: 'pr', branch: undefined, messageHeadline: 'first' });
    const second = commit({ source: 'pr', branch: undefined, messageHeadline: 'second' });
    expect(dedupeCommits([first, second])).toEqual([first]);
  });

  it('keeps two different SHAs in first-seen order', () => {
    const a = commit({ sha: 'a1' });
    const b = commit({ sha: 'b2' });
    expect(dedupeCommits([b, a, b])).toEqual([b, a]);
  });

  it('returns an empty list for no commits', () => {
    expect(dedupeCommits([])).toEqual([]);
  });
});
