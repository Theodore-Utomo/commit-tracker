import type { Commit, RepoRef } from '../../core/types';

/** The account that owns the token. */
export interface Viewer {
  login: string;
  id: string;
}

/** The `rateLimit` block that every paged query selects. */
export interface RateLimit {
  remaining: number;
  resetAt: string;
}

export interface RepoListPage {
  repos: { repo: RepoRef; pushedAt: string | null }[];
  nextCursor: string | null;
}

export interface BranchCommitsPage {
  commits: Commit[];
  /** Branches whose first history page had more; each needs a `BRANCH_HISTORY` follow-up. */
  followUps: { branch: string; cursor: string }[];
  nextRefCursor: string | null;
}

export interface BranchHistoryPage {
  commits: Commit[];
  nextCursor: string | null;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nextCursorOf(connection: Json | undefined): string | null {
  const pageInfo = asObject(connection?.pageInfo);
  return pageInfo?.hasNextPage === true && typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null;
}

/** Maps the `data` of a `VIEWER_QUERY` response. Throws when `viewer` is missing or malformed. */
export function mapViewer(data: unknown): Viewer {
  const viewer = asObject(asObject(data)?.viewer);
  if (viewer === undefined) {
    throw new Error('GraphQL response has no viewer.');
  }
  const { login, id } = viewer;
  if (typeof login !== 'string' || typeof id !== 'string') {
    throw new Error('GraphQL viewer is missing login or id.');
  }
  return { login, id };
}

/** The `rateLimit` block of a response's `data`, or `undefined` when absent or malformed. */
export function mapRateLimit(data: unknown): RateLimit | undefined {
  const rateLimit = asObject(asObject(data)?.rateLimit);
  const remaining = rateLimit?.remaining;
  const resetAt = rateLimit?.resetAt;
  return typeof remaining === 'number' && typeof resetAt === 'string' ? { remaining, resetAt } : undefined;
}

/**
 * Maps one `OWNER_REPOS` page. Forks and `null` nodes (for example, an organization behind
 * SAML single sign-on) are dropped. `pushedAt` is kept so the caller can stop at the grid start.
 */
export function mapRepos(data: unknown): RepoListPage {
  const connection = asObject(asObject(asObject(data)?.viewer)?.repositories);
  const repos: RepoListPage['repos'] = [];
  for (const raw of asArray(connection?.nodes)) {
    const node = asObject(raw);
    const owner = asObject(node?.owner)?.login;
    if (
      node === undefined ||
      typeof node.name !== 'string' ||
      typeof owner !== 'string' ||
      typeof node.isPrivate !== 'boolean' ||
      typeof node.isFork !== 'boolean' ||
      node.isFork
    ) {
      continue;
    }
    const pushedAt = typeof node.pushedAt === 'string' ? node.pushedAt : null;
    repos.push({ repo: { owner, name: node.name, isPrivate: node.isPrivate, isFork: false }, pushedAt });
  }
  return { repos, nextCursor: nextCursorOf(connection) };
}

function mapHistoryNodes(history: Json | undefined, repo: RepoRef, branch: string): Commit[] {
  const commits: Commit[] = [];
  for (const raw of asArray(history?.nodes)) {
    const node = asObject(raw);
    if (node === undefined || typeof node.oid !== 'string' || typeof node.authoredDate !== 'string') {
      continue;
    }
    commits.push({
      sha: node.oid,
      authoredDate: node.authoredDate,
      messageHeadline: typeof node.messageHeadline === 'string' ? node.messageHeadline : '',
      repo,
      branch,
      source: 'branch',
    });
  }
  return commits;
}

/**
 * Maps one `BRANCH_COMMITS` page for `repo`. Returns `undefined` when the repository is `null`
 * (not found, or hidden from this token). A branch whose `target` is missing, or is not a commit, is skipped.
 */
export function mapBranchCommits(data: unknown, repo: RepoRef): BranchCommitsPage | undefined {
  const repository = asObject(asObject(data)?.repository);
  if (repository === undefined) {
    return undefined;
  }
  const refs = asObject(repository.refs);
  const page: BranchCommitsPage = { commits: [], followUps: [], nextRefCursor: nextCursorOf(refs) };
  for (const raw of asArray(refs?.nodes)) {
    const node = asObject(raw);
    const history = asObject(asObject(node?.target)?.history);
    if (node === undefined || typeof node.name !== 'string' || history === undefined) {
      continue;
    }
    page.commits.push(...mapHistoryNodes(history, repo, node.name));
    const cursor = nextCursorOf(history);
    if (cursor !== null) {
      page.followUps.push({ branch: node.name, cursor });
    }
  }
  return page;
}

/** Maps one `BRANCH_HISTORY` page. Returns `undefined` when the repository or the branch is gone. */
export function mapBranchHistory(data: unknown, repo: RepoRef, branch: string): BranchHistoryPage | undefined {
  const history = asObject(asObject(asObject(asObject(asObject(data)?.repository)?.ref)?.target)?.history);
  if (history === undefined) {
    return undefined;
  }
  return { commits: mapHistoryNodes(history, repo, branch), nextCursor: nextCursorOf(history) };
}

export interface PrFollowUp {
  repo: RepoRef;
  number: number;
  cursor: string;
}

export interface MergedPrSearchPage {
  commits: Commit[];
  followUps: PrFollowUp[];
  nextCursor: string | null;
  issueCount: number;
}

export interface PrCommitPage {
  commits: Commit[];
  nextCursor: string | null;
}

function emailSet(savedEmails: readonly string[]): Set<string> {
  const emails = new Set<string>();
  for (const email of savedEmails) {
    const trimmed = email.trim().toLowerCase();
    if (trimmed) {
      emails.add(trimmed);
    }
  }
  return emails;
}

function repoFromPullRequest(node: Json | undefined): RepoRef | undefined {
  const repository = asObject(node?.repository);
  const owner = asObject(repository?.owner)?.login;
  if (
    repository === undefined ||
    typeof repository.name !== 'string' ||
    typeof owner !== 'string' ||
    typeof repository.isPrivate !== 'boolean' ||
    typeof repository.isFork !== 'boolean'
  ) {
    return undefined;
  }
  return { owner, name: repository.name, isPrivate: repository.isPrivate, isFork: repository.isFork };
}

/**
 * Keeps a commit whose linked login is the profile, or whose user is null and whose email is saved.
 * A different login is dropped even when the email matches. The email is not copied onto the commit.
 */
function mapPullRequestCommit(
  raw: unknown,
  repo: RepoRef,
  profileLogin: string,
  emails: Set<string>,
): Commit | undefined {
  const commit = asObject(asObject(raw)?.commit);
  if (commit === undefined || typeof commit.oid !== 'string' || typeof commit.authoredDate !== 'string') {
    return undefined;
  }
  const author = asObject(commit.author);
  if (author === undefined) {
    return undefined;
  }
  if (author.user === null) {
    const email = typeof author.email === 'string' ? author.email.trim().toLowerCase() : '';
    if (!emails.has(email)) {
      return undefined;
    }
  } else {
    const login = asObject(author.user)?.login;
    if (typeof login !== 'string' || login.toLowerCase() !== profileLogin.toLowerCase()) {
      return undefined;
    }
  }
  return {
    sha: commit.oid,
    authoredDate: commit.authoredDate,
    messageHeadline: typeof commit.messageHeadline === 'string' ? commit.messageHeadline : '',
    repo,
    source: 'pr',
  };
}

function mapPullRequestCommitNodes(
  nodes: unknown[],
  repo: RepoRef,
  profileLogin: string,
  emails: Set<string>,
): Commit[] {
  const commits: Commit[] = [];
  for (const raw of nodes) {
    const commit = mapPullRequestCommit(raw, repo, profileLogin, emails);
    if (commit !== undefined) {
      commits.push(commit);
    }
  }
  return commits;
}

function walkPullRequests(
  nodes: unknown[],
  profileLogin: string,
  emails: Set<string>,
  skipIndexes: ReadonlySet<number>,
): { commits: Commit[]; followUps: PrFollowUp[] } {
  const commits: Commit[] = [];
  const followUps: PrFollowUp[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (skipIndexes.has(index)) {
      continue;
    }
    const node = asObject(nodes[index]);
    const repo = repoFromPullRequest(node);
    if (node === undefined || repo === undefined) {
      continue;
    }
    const connection = asObject(node.commits);
    commits.push(...mapPullRequestCommitNodes(asArray(connection?.nodes), repo, profileLogin, emails));
    const cursor = nextCursorOf(connection);
    if (cursor !== null && typeof node.number === 'number' && Number.isInteger(node.number)) {
      followUps.push({ repo, number: node.number, cursor });
    }
  }
  return { commits, followUps };
}

/**
 * Maps pull-request search nodes to commits. `source` is `'pr'` and `branch` is omitted.
 * A node with no repository is skipped; forks are kept for `includeRepo` to drop.
 */
export function mapMergedPrCommits(nodes: unknown, profileLogin: string, savedEmails: readonly string[]): Commit[] {
  return walkPullRequests(asArray(nodes), profileLogin, emailSet(savedEmails), new Set()).commits;
}

/** Maps one `MERGED_PR_COMMITS` page. Returns `undefined` when the search connection is missing. */
export function mapMergedPrSearch(
  data: unknown,
  profileLogin: string,
  savedEmails: readonly string[],
  skipIndexes: ReadonlySet<number>,
): MergedPrSearchPage | undefined {
  const search = asObject(asObject(data)?.search);
  if (search === undefined) {
    return undefined;
  }
  const issueCount = search.issueCount;
  return {
    ...walkPullRequests(asArray(search.nodes), profileLogin, emailSet(savedEmails), skipIndexes),
    nextCursor: nextCursorOf(search),
    issueCount: typeof issueCount === 'number' ? issueCount : 0,
  };
}

/** Maps one `PR_COMMITS` page. Returns `undefined` when the pull request is gone. */
export function mapPrCommitPage(
  data: unknown,
  repo: RepoRef,
  profileLogin: string,
  savedEmails: readonly string[],
): PrCommitPage | undefined {
  const connection = asObject(asObject(asObject(asObject(data)?.repository)?.pullRequest)?.commits);
  if (connection === undefined) {
    return undefined;
  }
  return {
    commits: mapPullRequestCommitNodes(asArray(connection.nodes), repo, profileLogin, emailSet(savedEmails)),
    nextCursor: nextCursorOf(connection),
  };
}
