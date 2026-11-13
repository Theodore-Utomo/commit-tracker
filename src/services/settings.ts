/** The personal access token. Read only by the service worker and the options page. */
const tokenItem = storage.defineItem<string>('local:githubToken');

/** The saved token, or `undefined` when it is missing, blank, or whitespace only. */
export async function getToken(): Promise<string | undefined> {
  const value = (await tokenItem.getValue())?.trim();
  return value ? value : undefined;
}

/** Saves a trimmed token. A blank value removes the saved token. */
export async function setToken(token: string): Promise<void> {
  const value = token.trim();
  if (value) {
    await tokenItem.setValue(value);
  } else {
    await tokenItem.removeValue();
  }
}

/** Whether a usable token is saved, without handing the token to the caller. */
export async function hasToken(): Promise<boolean> {
  return (await getToken()) !== undefined;
}
