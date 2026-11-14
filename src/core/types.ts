/** Which privacy rule governs a result. See CLAUDE.md section 3. */
export type PrivacyMode = 'owner' | 'publicPlusCounts' | 'publicOnly';

export interface RepoRef {
  owner: string;
  name: string;
  isPrivate: boolean;
  isFork: boolean;
}

export interface Commit {
  sha: string;
  /** ISO timestamp. Group by this, not `committedDate`, which rebases rewrite. */
  authoredDate: string;
  messageHeadline: string;
  repo: RepoRef;
  /** Undefined for a commit found only through a pull request. */
  branch?: string;
  source: 'branch' | 'pr';
}

/** A private commit stripped to what a count needs: no message, no repository. */
export interface CountOnly {
  sha: string;
  authoredDate: string;
  private: true;
}

export interface DayBucket {
  /** `YYYY-MM-DD` in the viewer's local time zone. */
  date: string;
  count: number;
  /** The items counted into this day: full commits and count-only values. */
  commits?: (Commit | CountOnly)[];
}

export interface Contributions {
  login: string;
  mode: PrivacyMode;
  days: Record<string, DayBucket>;
  totals: { commits: number; repos: number };
  /** True when rate limits cut the fetch short. */
  partial: boolean;
  fetchedAt: string;
}
