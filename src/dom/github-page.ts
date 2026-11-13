import { LOGIN_PATTERN } from '../core/login';

/** Path segments that are GitHub routes, not user logins. Matched exactly. */
const DENYLIST = new Set([
  'settings',
  'orgs',
  'organizations',
  'marketplace',
  'features',
  'topics',
  'collections',
  'events',
  'explore',
  'notifications',
  'login',
  'signup',
  'about',
  'pricing',
  'sponsors',
  'customer-stories',
  'security',
  'readme',
  'new',
  'codespaces',
  'account',
  'projects',
  'pulls',
  'issues',
  'search',
  'apps',
  'trending',
  'advisories',
  'copilot',
]);

const CALENDAR_TABLE = '.js-calendar-graph-table';
const YEARLY_CONTRIBUTIONS = '.js-yearly-contributions';

export function getProfileLogin(input: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(input, 'https://github.com').pathname;
  } catch {
    return undefined;
  }

  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 1) {
    return undefined;
  }

  const login = segments[0];
  if (login === undefined || DENYLIST.has(login) || !LOGIN_PATTERN.test(login)) {
    return undefined;
  }
  return login;
}

export function isProfilePage(input: string): boolean {
  return getProfileLogin(input) !== undefined;
}

interface QueryRoot {
  querySelector(selector: string): Element | null;
}

export function findContributionGraph(root: QueryRoot): Element | undefined {
  return root.querySelector(CALENDAR_TABLE) ?? root.querySelector(YEARLY_CONTRIBUTIONS) ?? undefined;
}
