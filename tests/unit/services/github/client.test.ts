import { describe, expect, it, vi } from 'vitest';
import { createGitHubClient } from '../../../../src/services/github/client';
import { VIEWER_QUERY } from '../../../../src/services/github/queries';

const TOKEN = 'test-token';
const NOW = Date.parse('2026-11-13T00:00:00.000Z');
const VIEWER = { viewer: { login: 'octocat', id: 'U_1' } };

function reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function clientReturning(response: Response | Error) {
  const fetch = vi.fn(async () => {
    if (response instanceof Error) {
      throw response;
    }
    return response;
  });
  return { fetch, client: createGitHubClient({ fetch, now: () => NOW }) };
}

describe('GitHubClient.getViewer', () => {
  it('POSTs the viewer query as JSON to the GraphQL endpoint with a bearer token', async () => {
    const { fetch, client } = clientReturning(reply(200, { data: VIEWER }));

    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: true, data: { login: 'octocat', id: 'U_1' } });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` });
    expect(JSON.parse(init.body as string)).toEqual({ query: VIEWER_QUERY });
  });

  it('maps status 401 to UNAUTHORIZED', async () => {
    const { client } = clientReturning(reply(401, { message: 'Bad credentials' }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('maps a 200 body with an UNAUTHENTICATED error to UNAUTHORIZED', async () => {
    const { client } = clientReturning(reply(200, { data: null, errors: [{ type: 'UNAUTHENTICATED' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('maps status 403 with x-ratelimit-remaining 0 to RATE_LIMITED with the reset as ISO', async () => {
    const reset = 1_794_528_000;
    const { client } = clientReturning(
      reply(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(reset * 1000).toISOString(),
    });
  });

  it('maps status 429 with retry-after to RATE_LIMITED about that many seconds ahead', async () => {
    const { client } = clientReturning(reply(429, {}, { 'retry-after': '60' }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(NOW + 60_000).toISOString(),
    });
  });

  it('maps a 200 body with a RATE_LIMITED error to RATE_LIMITED', async () => {
    const { client } = clientReturning(
      reply(200, { data: null, errors: [{ type: 'RATE_LIMITED' }] }, { 'x-ratelimit-reset': '1794528000' }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(1_794_528_000 * 1000).toISOString(),
    });
  });

  it('maps a 403 with only retry-after (secondary rate limit) to RATE_LIMITED', async () => {
    const { client } = clientReturning(reply(403, {}, { 'retry-after': '30' }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(NOW + 30_000).toISOString(),
    });
  });

  it('prefers x-ratelimit-reset over retry-after when both are present', async () => {
    const { client } = clientReturning(
      reply(429, {}, { 'x-ratelimit-reset': '1794528000', 'retry-after': '60' }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({
      ok: false,
      error: 'RATE_LIMITED',
      resetAt: new Date(1_794_528_000 * 1000).toISOString(),
    });
  });

  it('falls back to retry-after when x-ratelimit-reset is zero or not a number', async () => {
    for (const reset of ['0', 'abc']) {
      const { client } = clientReturning(
        reply(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset, 'retry-after': '60' }),
      );
      await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({
        ok: false,
        error: 'RATE_LIMITED',
        resetAt: new Date(NOW + 60_000).toISOString(),
      });
    }
  });

  it('omits resetAt when no header gives a usable time', async () => {
    const { client } = clientReturning(reply(429, {}, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('maps a 200 RATE_LIMITED error with no headers to RATE_LIMITED without resetAt', async () => {
    const { client } = clientReturning(reply(200, { data: null, errors: [{ type: 'RATE_LIMITED' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'RATE_LIMITED' });
  });

  it('maps a 200 body with data and an UNAUTHENTICATED error to UNAUTHORIZED, not data', async () => {
    const { client } = clientReturning(reply(200, { data: VIEWER, errors: [{ type: 'UNAUTHENTICATED' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'UNAUTHORIZED' });
  });

  it('maps a 429 with no rate-limit headers to NETWORK', async () => {
    const { client } = clientReturning(reply(429, {}));
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'NETWORK' });
  });

  it('maps a 403 with remaining quota (a permission error) to NETWORK, not RATE_LIMITED', async () => {
    const { client } = clientReturning(
      reply(403, {}, { 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1794528000' }),
    );
    await expect(client.getViewer(TOKEN)).resolves.toStrictEqual({ ok: false, error: 'NETWORK' });
  });

  it('maps 403 without rate-limit headers, 500, and a thrown TypeError to NETWORK', async () => {
    for (const response of [reply(403, {}), reply(500, {}), new TypeError('Failed to fetch')]) {
      const { client } = clientReturning(response);
      await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'NETWORK' });
    }
  });

  it('maps any other thrown error to UNKNOWN', async () => {
    const { client } = clientReturning(new Error('boom'));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('returns the data when a 200 body has both data and errors', async () => {
    const errors = [{ type: 'FORBIDDEN', path: ['viewer', 'organization'] }];
    const { client } = clientReturning(reply(200, { data: VIEWER, errors }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({
      ok: true,
      data: { login: 'octocat', id: 'U_1' },
      errors,
    });
  });

  it('maps a 200 body with errors and no data to UNKNOWN', async () => {
    const { client } = clientReturning(reply(200, { data: null, errors: [{ type: 'INTERNAL' }] }));
    await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('maps a body without a viewer, or one that is not JSON, to UNKNOWN', async () => {
    const notJson = new Response('<html>', { status: 200 });
    for (const response of [reply(200, { data: {} }), notJson]) {
      const { client } = clientReturning(response);
      await expect(client.getViewer(TOKEN)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
    }
  });
});
