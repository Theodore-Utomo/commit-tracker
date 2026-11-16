/** Switches between the all-branches heatmap (checked) and GitHub's own graph. */
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />{' '}
      Show commits from all branches
    </label>
  );
}
