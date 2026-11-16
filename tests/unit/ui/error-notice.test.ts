import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '../../../src/messaging/protocol';
import { errorText, PARTIAL_TEXT, showOptionsButton, showRetry } from '../../../src/ui/ErrorNotice';

/** ICU may put a narrow no-break space before AM/PM. */
const spaced = (text: string): string => text.replace(/\s/gu, ' ');

const CODES: ErrorCode[] = ['NO_TOKEN', 'UNAUTHORIZED', 'RATE_LIMITED', 'NOT_FOUND', 'NETWORK', 'UNKNOWN'];

describe('errorText', () => {
  it.each<[ErrorCode, string]>([
    ['NO_TOKEN', 'Add a token in the extension options.'],
    ['UNAUTHORIZED', 'The saved token was rejected. Save a new one in the extension options.'],
    ['RATE_LIMITED', 'GitHub rate limit reached.'],
    ['NOT_FOUND', 'GitHub has no user with that login.'],
    ['NETWORK', 'Could not reach GitHub. Try again.'],
    ['UNKNOWN', 'Something went wrong. Try again.'],
  ])('gives %s its sentence', (code, text) => {
    expect(errorText(code)).toBe(text);
  });

  it('adds the local reset time to RATE_LIMITED when resetAt is present', () => {
    const resetAt = '2024-01-11T15:05:00Z';
    expect(spaced(errorText('RATE_LIMITED', resetAt, 'UTC', 'en-US'))).toBe(
      'GitHub rate limit reached. It resets at 3:05 PM.',
    );
    expect(spaced(errorText('RATE_LIMITED', resetAt, 'America/New_York', 'en-US'))).toBe(
      'GitHub rate limit reached. It resets at 10:05 AM.',
    );
  });

  it('leaves the time out when resetAt is missing or not a timestamp', () => {
    expect(errorText('RATE_LIMITED', undefined, 'UTC', 'en-US')).toBe('GitHub rate limit reached.');
    expect(errorText('RATE_LIMITED', 'soon', 'UTC', 'en-US')).toBe('GitHub rate limit reached.');
  });

  it('ignores resetAt on every other code', () => {
    for (const code of CODES.filter((c) => c !== 'RATE_LIMITED')) {
      expect(errorText(code, '2024-01-11T15:05:00Z', 'UTC', 'en-US')).toBe(errorText(code));
    }
  });
});

describe('buttons', () => {
  it.each<[ErrorCode, boolean, boolean]>([
    ['NO_TOKEN', true, false],
    ['UNAUTHORIZED', true, false],
    ['RATE_LIMITED', false, true],
    ['NOT_FOUND', false, false],
    ['NETWORK', false, true],
    ['UNKNOWN', false, true],
  ])('%s: options button %s, Try again %s', (code, options, retry) => {
    expect(showOptionsButton(code)).toBe(options);
    expect(showRetry(code)).toBe(retry);
  });
});

it('names the partial-results sentence', () => {
  expect(PARTIAL_TEXT).toBe('Results are incomplete because the rate limit was close.');
});
