import { describe, expect, it } from 'vitest';
import { policyFor } from '../../../src/core/privacy';
import type { PrivacyMode } from '../../../src/core/types';
import { commit, forkRepo, privateFork, privateRepo, publicRepo } from './fixtures';

const MODES: PrivacyMode[] = ['owner', 'publicPlusCounts', 'publicOnly'];

describe('policyFor', () => {
  it('returns the policy for each mode', () => {
    for (const mode of MODES) {
      expect(policyFor(mode).mode).toBe(mode);
    }
  });

  describe('every mode', () => {
    it.each(MODES)('%s rejects a public fork and a private fork', (mode) => {
      const policy = policyFor(mode);
      for (const repo of [forkRepo, privateFork]) {
        expect(policy.includeRepo(repo)).toBe(false);
        expect(policy.present(commit({ repo }))).toBeUndefined();
      }
    });

    it.each(MODES)('%s keeps a public non-fork as a new full copy', (mode) => {
      const input = commit({ repo: publicRepo });
      const output = policyFor(mode).present(input);
      expect(output).toEqual(input);
      expect(output).not.toBe(input);
    });
  });

  describe('owner', () => {
    it('includes private and public non-forks', () => {
      expect(policyFor('owner').includeRepo(privateRepo)).toBe(true);
      expect(policyFor('owner').includeRepo(publicRepo)).toBe(true);
    });

    it('keeps a private non-fork as a full copy', () => {
      const input = commit({ repo: privateRepo });
      const output = policyFor('owner').present(input);
      expect(output).toEqual(input);
      expect(output).not.toBe(input);
    });
  });

  describe('publicPlusCounts', () => {
    it('includes private non-forks', () => {
      expect(policyFor('publicPlusCounts').includeRepo(privateRepo)).toBe(true);
    });

    it('turns a private non-fork into a new count-only object with no message and no repo', () => {
      const input = commit({ sha: 'p9', authoredDate: '2024-01-11T12:00:00Z', repo: privateRepo });
      const output = policyFor('publicPlusCounts').present(input);
      expect(output).toStrictEqual({ sha: 'p9', authoredDate: '2024-01-11T12:00:00Z', private: true });
      expect(output).not.toHaveProperty('messageHeadline');
      expect(output).not.toHaveProperty('repo');
      expect(output).not.toHaveProperty('branch');
    });

    it("leaves the input's message and repo in place", () => {
      const input = commit({ repo: privateRepo });
      policyFor('publicPlusCounts').present(input);
      expect(input.messageHeadline).toBe('Add widget');
      expect(input.repo).toBe(privateRepo);
    });
  });

  describe('publicOnly', () => {
    it('excludes private repositories', () => {
      expect(policyFor('publicOnly').includeRepo(privateRepo)).toBe(false);
      expect(policyFor('publicOnly').includeRepo(publicRepo)).toBe(true);
    });

    it('returns undefined for a private commit', () => {
      expect(policyFor('publicOnly').present(commit({ repo: privateRepo }))).toBeUndefined();
    });
  });

  describe('includeRepo and present agree', () => {
    const repos = { publicRepo, privateRepo, forkRepo, privateFork };
    const expected: Record<PrivacyMode, Record<keyof typeof repos, 'full' | 'count' | 'drop'>> = {
      owner: { publicRepo: 'full', privateRepo: 'full', forkRepo: 'drop', privateFork: 'drop' },
      publicPlusCounts: { publicRepo: 'full', privateRepo: 'count', forkRepo: 'drop', privateFork: 'drop' },
      publicOnly: { publicRepo: 'full', privateRepo: 'drop', forkRepo: 'drop', privateFork: 'drop' },
    };

    for (const mode of MODES) {
      for (const [name, repo] of Object.entries(repos) as [keyof typeof repos, (typeof repos)[keyof typeof repos]][]) {
        const outcome = expected[mode][name];
        it(`${mode} × ${name} → ${outcome}`, () => {
          const policy = policyFor(mode);
          const input = commit({ repo });
          const output = policy.present(input);
          expect(policy.includeRepo(repo)).toBe(outcome !== 'drop');
          if (outcome === 'drop') {
            expect(output).toBeUndefined();
          } else if (outcome === 'count') {
            expect(output).toStrictEqual({ sha: input.sha, authoredDate: input.authoredDate, private: true });
          } else {
            expect(output).toEqual(input);
          }
        });
      }
    }
  });

  it('copies only known fields, dropping anything extra a mapper attached', () => {
    const widened = {
      ...commit({ repo: { ...publicRepo, url: 'https://example.test/acme/widgets' } as typeof publicRepo }),
      authorEmail: 'dev@example.com',
    };
    for (const mode of MODES) {
      const output = policyFor(mode).present(widened);
      expect(output).toStrictEqual(commit({ repo: publicRepo }));
    }
  });

  it('keeps an absent branch absent rather than undefined', () => {
    const output = policyFor('owner').present(commit({ source: 'pr', branch: undefined }));
    expect(output).not.toHaveProperty('branch');
  });

  it('never mutates the input, in any mode', () => {
    for (const mode of MODES) {
      for (const repo of [publicRepo, privateRepo, forkRepo]) {
        const input = commit({ repo });
        const snapshot = structuredClone(input);
        const output = policyFor(mode).present(input);
        expect(input).toEqual(snapshot);
        if (output && 'repo' in output) {
          expect(output.repo).not.toBe(input.repo);
        }
      }
    }
  });
});
