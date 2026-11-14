/** The login and node id of the account that owns the token. */
export const VIEWER_QUERY = 'query Viewer { viewer { login id } }';

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
