/** Whether to fetch the heatmap without asking. The content script may read this. It is not the token. */
const alwaysShowItem = storage.defineItem<boolean>('local:alwaysShow', { fallback: false });

/** The saved preference. Missing storage reads as false. */
export async function getAlwaysShow(): Promise<boolean> {
  return alwaysShowItem.getValue();
}

/** Saves the preference. */
export async function setAlwaysShow(value: boolean): Promise<void> {
  await alwaysShowItem.setValue(value);
}
