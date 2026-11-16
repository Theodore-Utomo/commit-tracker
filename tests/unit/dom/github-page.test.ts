import { describe, expect, it } from 'vitest';
import { findContributionGraph, getProfileLogin, isProfilePage } from '../../../src/dom/github-page';

const DENYLIST = [
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
] as const;

function expectLogin(input: string, login: string | undefined): void {
  expect(getProfileLogin(input)).toBe(login);
  expect(isProfilePage(input)).toBe(login !== undefined);
}

describe('getProfileLogin', () => {
  it('reads a single path segment from a path or an absolute URL', () => {
    const cases = [
      '/octocat',
      '/octocat/',
      '/octocat?tab=repositories',
      '/octocat#contributions',
      'https://github.com/octocat',
      'https://github.com/octocat/',
      'https://github.com/octocat?tab=repositories',
      'https://github.com/octocat#contributions',
      'https://github.com/octocat/?tab=repositories#contributions',
    ];

    for (const input of cases) {
      expectLogin(input, 'octocat');
    }
  });

  it('preserves the segment casing', () => {
    expectLogin('/OctoCat', 'OctoCat');
    expectLogin('https://github.com/OctoCat?tab=overview#year', 'OctoCat');
  });

  it('accepts a 39-character login and a login with a single hyphen', () => {
    const maxLogin = 'a'.repeat(39);
    expectLogin(`/${maxLogin}`, maxLogin);
    expectLogin('/octo-cat', 'octo-cat');
  });

  it('rejects other routes, malformed segments, and logins longer than 39 characters', () => {
    const rejected = [
      '/octocat/hello-world',
      '/orgs/github',
      '/',
      '/octo%20cat',
      '/octo_cat',
      '/octo.cat',
      '/-octocat',
      '/octocat-',
      '/octo--cat',
      `/${'a'.repeat(40)}`,
      ...DENYLIST.map((segment) => `/${segment}`),
    ];

    for (const input of rejected) {
      expectLogin(input, undefined);
    }
  });
});

describe('findContributionGraph', () => {
  const table = { id: 'table' } as Element;
  const yearly = { id: 'yearly' } as Element;

  function rootFor(found: Record<string, Element>): { querySelector(selector: string): Element | null } {
    return {
      querySelector(selector: string) {
        return found[selector] ?? null;
      },
    };
  }

  it('returns the calendar table when the stub has it', () => {
    const root = rootFor({
      '.js-calendar-graph-table': table,
      '.js-yearly-contributions': yearly,
    });
    expect(findContributionGraph(root)).toBe(table);
  });

  it('falls back to the yearly contributions container', () => {
    const root = rootFor({ '.js-yearly-contributions': yearly });
    expect(findContributionGraph(root)).toBe(yearly);
  });

  it('returns undefined when neither selector matches', () => {
    expect(findContributionGraph(rootFor({}))).toBeUndefined();
  });
});
