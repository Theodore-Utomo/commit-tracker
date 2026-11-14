export function Prompt({
  loading,
  error,
  resetAt,
  onAccept,
}: {
  loading: boolean;
  error?: string;
  resetAt?: string;
  onAccept: () => void;
}) {
  return (
    <div>
      {error && (
        <p role="alert">
          {error}
          {resetAt ? ` ${resetAt}` : null}
        </p>
      )}
      <button type="button" disabled={loading} onClick={onAccept}>
        See commits across all branches
      </button>
    </div>
  );
}
