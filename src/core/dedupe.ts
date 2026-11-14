import type { Commit } from './types';

/**
 * Keeps one commit per SHA, in first-seen order. A `branch` copy replaces a `pr` copy
 * wherever it appears; among branch copies, the first branch name is kept.
 */
export function dedupeCommits(commits: readonly Commit[]): Commit[] {
  const bySha = new Map<string, Commit>();
  for (const commit of commits) {
    const kept = bySha.get(commit.sha);
    if (kept === undefined || (kept.source === 'pr' && commit.source === 'branch')) {
      bySha.set(commit.sha, commit);
    }
  }
  return [...bySha.values()];
}
