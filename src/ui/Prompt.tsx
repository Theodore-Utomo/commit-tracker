export function Prompt({ loading, onAccept }: { loading: boolean; onAccept: () => void }) {
  return (
    <div>
      <button type="button" disabled={loading} onClick={onAccept}>
        See commits across all branches
      </button>
    </div>
  );
}
