/**
 * The token's account and the profile user. `restrictedContributionsCount` is selected
 * and then ignored: other profiles stay `publicOnly` until that signal is confirmed.
 */
export const VIEWER_AND_USER = `query ViewerAndUser($login: String!) {
  viewer { login id }
  user(login: $login) {
    id
    login
    contributionsCollection { restrictedContributionsCount }
  }
  rateLimit { remaining resetAt }
}`;

/**
 * One page of the viewer's repositories, newest-pushed first, forks excluded.
 * `ownerAffiliations` repeats the list because its default ([OWNER, COLLABORATOR])
 * would leave out repositories owned by the viewer's organizations.
 */
export const OWNER_REPOS = `query OwnerRepos($cursor: String) {
  viewer {
    repositories(
      first: 50
      after: $cursor
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      isFork: false
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { name owner { login } isPrivate isFork pushedAt }
    }
  }
  rateLimit { remaining resetAt }
}`;

/**
 * One page of a user's public repositories and of the public repositories they contributed to.
 * Each connection is skipped with `@include` once it has been paged to the end or past `since`.
 */
export const PUBLIC_REPOS = `query PublicRepos($login: String!, $ownedCursor: String, $contributedCursor: String, $includeOwned: Boolean!, $includeContributed: Boolean!) {
  user(login: $login) {
    repositories(
      privacy: PUBLIC
      isFork: false
      first: 50
      after: $ownedCursor
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) @include(if: $includeOwned) {
      pageInfo { hasNextPage endCursor }
      nodes { name owner { login } isPrivate isFork pushedAt }
    }
    repositoriesContributedTo(
      privacy: PUBLIC
      first: 50
      after: $contributedCursor
      orderBy: { field: PUSHED_AT, direction: DESC }
    ) @include(if: $includeContributed) {
      pageInfo { hasNextPage endCursor }
      nodes { name owner { login } isPrivate isFork pushedAt }
    }
  }
  rateLimit { remaining resetAt }
}`;

/** One page of a repository's branches, each with the first page of the author's history since `$since`. */
export const BRANCH_COMMITS = `query BranchCommits($owner: String!, $name: String!, $author: CommitAuthor!, $since: GitTimestamp!, $refCursor: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 50, after: $refCursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        target {
          ... on Commit {
            history(first: 100, author: $author, since: $since) {
              pageInfo { hasNextPage endCursor }
              nodes { oid authoredDate messageHeadline }
            }
          }
        }
      }
    }
  }
  rateLimit { remaining resetAt }
}`;

/**
 * One page of merged pull requests authored by `$q`'s login. `commits` is only the first page;
 * a longer list continues with `PR_COMMITS`. The login is a search variable, never pasted into this text.
 */
export const MERGED_PR_COMMITS = `query MergedPrCommits($q: String!, $cursor: String) {
  search(query: $q, type: ISSUE, first: 25, after: $cursor) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        repository { owner { login } name isPrivate isFork }
        commits(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes { commit { oid authoredDate messageHeadline author { email user { login } } } }
        }
      }
    }
  }
  rateLimit { remaining resetAt }
}`;

/** The next page of one merged pull request's commits. */
export const PR_COMMITS = `query PrCommits($owner: String!, $name: String!, $number: Int!, $cursor: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { commit { oid authoredDate messageHeadline author { email user { login } } } }
      }
    }
  }
  rateLimit { remaining resetAt }
}`;

/** The next page of one branch's history. The branch arrives as `$qualifiedName`, never in the query text. */
export const BRANCH_HISTORY = `query BranchHistory($owner: String!, $name: String!, $qualifiedName: String!, $author: CommitAuthor!, $since: GitTimestamp!, $cursor: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $qualifiedName) {
      target {
        ... on Commit {
          history(first: 100, after: $cursor, author: $author, since: $since) {
            pageInfo { hasNextPage endCursor }
            nodes { oid authoredDate messageHeadline }
          }
        }
      }
    }
  }
  rateLimit { remaining resetAt }
}`;
