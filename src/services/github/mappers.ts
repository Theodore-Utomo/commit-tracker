/** The account that owns the token. */
export interface Viewer {
  login: string;
  id: string;
}

/** Maps the `data` of a `VIEWER_QUERY` response. Throws when `viewer` is missing or malformed. */
export function mapViewer(data: unknown): Viewer {
  const viewer = (data as { viewer?: unknown } | null | undefined)?.viewer;
  if (typeof viewer !== 'object' || viewer === null) {
    throw new Error('GraphQL response has no viewer.');
  }
  const { login, id } = viewer as { login?: unknown; id?: unknown };
  if (typeof login !== 'string' || typeof id !== 'string') {
    throw new Error('GraphQL viewer is missing login or id.');
  }
  return { login, id };
}
