import { describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../../../src/messaging/client';
import type { Request, Response } from '../../../src/messaging/protocol';

const request: Request = { type: 'GET_CONTRIBUTIONS', login: 'octocat' };

describe('sendMessage', () => {
  it('turns a rejected send into UNKNOWN instead of throwing', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Extension context invalidated.'));
    await expect(sendMessage(request, send)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('turns an undefined reply into UNKNOWN', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await expect(sendMessage(request, send)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('turns a send that throws synchronously into UNKNOWN', async () => {
    const send = vi.fn(() => {
      throw new Error('Extension context invalidated.');
    });
    await expect(sendMessage(request, send)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it.each([
    ['no ok flag', { viewerLogin: 'octocat' }],
    ['ok true with no data', { ok: true }],
    ['ok false with no error', { ok: false }],
  ])('turns a reply with %s into UNKNOWN', async (_label, reply) => {
    const send = vi.fn().mockResolvedValue(reply);
    await expect(sendMessage(request, send)).resolves.toEqual({ ok: false, error: 'UNKNOWN' });
  });

  it('returns a Response unchanged and sends the request as given', async () => {
    const success: Response = { ok: true, data: { viewerLogin: 'octocat' } };
    const failure: Response = { ok: false, error: 'RATE_LIMITED', resetAt: '2026-11-13T00:00:00.000Z' };
    const send = vi.fn().mockResolvedValueOnce(success).mockResolvedValueOnce(failure);

    await expect(sendMessage(request, send)).resolves.toBe(success);
    await expect(sendMessage(request, send)).resolves.toBe(failure);
    expect(send).toHaveBeenCalledWith(request);
  });
});
