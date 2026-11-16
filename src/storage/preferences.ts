// Display preferences the content script may read and write. Neither is the token.

/** Whether to fetch the heatmap without asking. */
const alwaysShowItem = storage.defineItem<boolean>('local:alwaysShow', { fallback: false });

/** Whether the all-branches heatmap is shown in place of GitHub's graph. */
const showAllBranchesItem = storage.defineItem<boolean>('local:showAllBranches', { fallback: true });

/** The saved preference. Missing storage reads as false. */
export async function getAlwaysShow(): Promise<boolean> {
  return alwaysShowItem.getValue();
}

/** Saves the preference. */
export async function setAlwaysShow(value: boolean): Promise<void> {
  await alwaysShowItem.setValue(value);
}

/** The saved toggle position. Missing storage reads as true. */
export async function getShowAllBranches(): Promise<boolean> {
  return showAllBranchesItem.getValue();
}

/** Saves the toggle position. */
export async function setShowAllBranches(value: boolean): Promise<void> {
  await showAllBranchesItem.setValue(value);
}
