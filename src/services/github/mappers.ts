import type { Commit, RepoRef } from '../../core/types';

/** The account that owns the token. */
export interface Viewer {
  login: string;
  id: string;
}

/** A repository as it was stored, and as GitHub reports it now. `null`: gone or hidden from the token. */
export interface RepoState {
  checked: RepoRef;
  current: RepoRef | null;
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

/** Maps the `data` of a viewer selection. Throws when `viewer` is missing or malformed. */
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

/** The token's account and the profile the request asked for. */
export interface ViewerAndUser {
  viewer: Viewer;
  user: Viewer;
  /** Requested so the query matches the API. Mode selection does not read it. */
  restrictedContributionsCount: number;
}

export type ViewerAndUserMapped = { status: 'ok'; account: ViewerAndUser } | { status: 'not-found' };

/**
 * Maps a `VIEWER_AND_USER` payload. `user: null` is not-found. A missing or malformed
 * viewer, or a user object without its id, login, and restricted count, throws.
 */
export function mapViewerAndUser(data: unknown): ViewerAndUserMapped {
  const root = asObject(data);
  if (root === undefined) {
    throw new Error('GraphQL response has no viewer.');
  }
  const viewer = mapViewer({ viewer: root.viewer });
  if (!('user' in root)) {
    throw new Error('GraphQL response has no user.');
  }
  if (root.user === null) {
    return { status: 'not-found' };
  }
  const user = asObject(root.user);
  const restricted = asObject(user?.contributionsCollection)?.restrictedContributionsCount;
  if (user === undefined || typeof user.login !== 'string' || typeof user.id !== 'string' || typeof restricted !== 'number') {
    throw new Error('GraphQL user is missing login, id, or restrictedContributionsCount.');
  }
  return {
    status: 'ok',
    account: { viewer, user: { login: user.login, id: user.id }, restrictedContributionsCount: restricted },
  };
}

/** A repository as it was stored, and as GitHub reports it now. `null`: gone or hidden from the token. */
export interface RepoState {
  checked: RepoRef;
  current: RepoRef | null;
}

/** The `rateLimit` block of a response's `data`, or `undefined` when absent or malformed. */
export function mapRateLimit(data: unknown): RateLimit | undefined {
  const rateLimit = asObject(asObject(data)?.rateLimit);
  const remaining = rateLimit?.remaining;
  const resetAt = rateLimit?.resetAt;
  return typeof remaining === 'number' && typeof resetAt === 'string' ? { remaining, resetAt } : undefined;
}

/**
 * Maps one repository connection. Forks and `null` nodes (for example, an organization behind
 * SAML single sign-on) are dropped. `pushedAt` is kept so the caller can stop at the grid start.
 */
function mapRepoConnection(connection: Json | undefined): RepoListPage {
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

/** Maps one `OWNER_REPOS` page. */
export function mapRepos(data: unknown): RepoListPage {
  return mapRepoConnection(asObject(asObject(asObject(data)?.viewer)?.repositories));
}

/** Maps `user.repositories` from one `PUBLIC_REPOS` page. */
export function mapPublicRepos(data: unknown): RepoListPage {
  return mapRepoConnection(asObject(asObject(asObject(data)?.user)?.repositories));
}

/** Maps `user.repositoriesContributedTo` from one `PUBLIC_REPOS` page. */
export function mapContributedRepos(data: unknown): RepoListPage {
  return mapRepoConnection(asObject(asObject(asObject(data)?.user)?.repositoriesContributedTo));
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

/** A `{ name owner { login } isPrivate isFork }` node, or `undefined` when a field is missing. */
function repoFromNode(repository: Json | undefined): RepoRef | undefined {
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
    const repo = repoFromNode(asObject(node?.repository));
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

/**
 * Maps a `repoStatesQuery` reply for `batch`, in order. An explicit `null` alias is `null`: the
 * repository is gone or hidden from the token. A missing or malformed alias is left out, so the
 * caller treats that repository as not checked rather than gone.
 */
export function mapRepoStates(data: unknown, batch: readonly RepoRef[]): RepoState[] {
  const root = asObject(data);
  const states: RepoState[] = [];
  batch.forEach((checked, i) => {
    const node = root?.[`r${i}`];
    const current = node === null ? null : repoFromNode(asObject(node));
    if (current !== undefined) {
      states.push({ checked, current });
    }
  });
  return states;
}
