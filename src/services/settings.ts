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

/** Extra commit emails. Used only as a GraphQL author filter, and only in owner mode. */
const emailsItem = storage.defineItem<string[]>('local:commitEmails', { fallback: [] });

function cleanEmails(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const cleaned: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) {
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

/** The saved emails, trimmed, with blanks removed. Missing storage reads as an empty list. */
export async function getCommitEmails(): Promise<string[]> {
  return cleanEmails(await emailsItem.getValue());
}

/** Saves a trimmed email list. Blank entries are dropped. */
export async function setCommitEmails(emails: readonly string[]): Promise<void> {
  await emailsItem.setValue(cleanEmails(emails));
}
