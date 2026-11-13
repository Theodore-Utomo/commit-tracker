import { describe, expect, it } from 'vitest';
import { mapViewer } from '../../../../src/services/github/mappers';

describe('mapViewer', () => {
  it('maps a viewer payload to login and id', () => {
    expect(mapViewer({ viewer: { login: 'octocat', id: 'MDQ6VXNlcjU4MzIzMQ==' } })).toEqual({
      login: 'octocat',
      id: 'MDQ6VXNlcjU4MzIzMQ==',
    });
  });

  it('rejects a payload with no viewer', () => {
    expect(() => mapViewer({})).toThrow();
    expect(() => mapViewer(null)).toThrow();
    expect(() => mapViewer({ viewer: null })).toThrow();
  });

  it('rejects a viewer missing its login or id', () => {
    expect(() => mapViewer({ viewer: { login: 'octocat' } })).toThrow();
    expect(() => mapViewer({ viewer: { id: 'x', login: 7 } })).toThrow();
  });
});
