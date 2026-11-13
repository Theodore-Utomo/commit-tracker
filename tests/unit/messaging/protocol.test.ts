import { describe, expect, it } from 'vitest';
import { isRequest } from '../../../src/messaging/protocol';

describe('isRequest', () => {
  it('accepts a GET_CONTRIBUTIONS request with a string login', () => {
    expect(isRequest({ type: 'GET_CONTRIBUTIONS', login: 'octocat' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'GET_CONTRIBUTIONS'],
    ['an empty object', {}],
    ['an unknown type', { type: 'OTHER', login: 'x' }],
    ['a missing login', { type: 'GET_CONTRIBUTIONS' }],
    ['a non-string login', { type: 'GET_CONTRIBUTIONS', login: 42 }],
  ])('rejects %s', (_label, message) => {
    expect(isRequest(message)).toBe(false);
  });
});
