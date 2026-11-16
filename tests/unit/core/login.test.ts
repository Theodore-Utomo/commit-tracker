import { describe, expect, it } from 'vitest';
import { LOGIN_PATTERN } from '../../../src/core/login';

describe('LOGIN_PATTERN', () => {
  it.each([
    ['a single character', 'a'],
    ['a lowercase login', 'octocat'],
    ['a mixed-case login', 'OctoCat'],
    ['a login with one hyphen', 'octo-cat'],
    ['letters, digits, and single hyphens', 'a1-b2-c3'],
    ['a 39-character login', 'a'.repeat(39)],
  ])('accepts %s', (_label, login) => {
    expect(LOGIN_PATTERN.test(login)).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['a leading hyphen', '-octocat'],
    ['a trailing hyphen', 'octocat-'],
    ['a double hyphen', 'octo--cat'],
    ['an underscore', 'octo_cat'],
    ['a dot', 'octo.cat'],
    ['percent-encoded text', 'octo%20cat'],
    ['a space', 'octo cat'],
    ['a slash', 'octocat/x'],
    ['a 40-character login', 'a'.repeat(40)],
  ])('rejects %s', (_label, login) => {
    expect(LOGIN_PATTERN.test(login)).toBe(false);
  });

  it('does not reject route names on its own; the denylist in src/dom/ does that', () => {
    expect(LOGIN_PATTERN.test('settings')).toBe(true);
  });
});
