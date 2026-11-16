import type { ErrorCode } from '../messaging/protocol';

/** Shown under a heatmap whose result is `partial: true`. */
export const PARTIAL_TEXT = 'Results are incomplete because the rate limit was close.';

const TEXT: Record<ErrorCode, string> = {
  NO_TOKEN: 'Add a token in the extension options.',
  UNAUTHORIZED: 'The saved token was rejected. Save a new one in the extension options.',
  RATE_LIMITED: 'GitHub rate limit reached.',
  NOT_FOUND: 'GitHub has no user with that login.',
  NETWORK: 'Could not reach GitHub. Try again.',
  UNKNOWN: 'Something went wrong. Try again.',
};

/**
 * The sentence for an error code. `RATE_LIMITED` adds the local time of `resetAt` when it is
 * a valid timestamp. `timeZone` and `locale` default to the browser's and are set by tests.
 */
export function errorText(error: ErrorCode, resetAt?: string, timeZone?: string, locale?: string): string {
  const text = TEXT[error];
  if (error !== 'RATE_LIMITED' || resetAt === undefined) {
    return text;
  }
  const reset = new Date(resetAt);
  if (Number.isNaN(reset.getTime())) {
    return text;
  }
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(reset);
  return `${text} It resets at ${time}.`;
}

/** True when the fix is in the options page. */
export function showOptionsButton(error: ErrorCode): boolean {
  return error === 'NO_TOKEN' || error === 'UNAUTHORIZED';
}

/** True when sending the same request again may succeed. */
export function showRetry(error: ErrorCode): boolean {
  return error === 'NETWORK' || error === 'UNKNOWN' || error === 'RATE_LIMITED';
}

/** One failure, with the buttons that can fix it. Draws no squares. */
export function ErrorNotice({
  error,
  resetAt,
  onOpenOptions,
  onRetry,
}: {
  error: ErrorCode;
  resetAt?: string;
  onOpenOptions: () => void;
  onRetry: () => void;
}) {
  return (
    <div class="error-notice">
      <p role="alert">{errorText(error, resetAt)}</p>
      {showOptionsButton(error) && (
        <button type="button" onClick={onOpenOptions}>
          Open extension options
        </button>
      )}
      {showRetry(error) && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
