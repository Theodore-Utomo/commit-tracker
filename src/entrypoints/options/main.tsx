import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getCommitEmails, hasToken, setCommitEmails, setToken } from '../../services/settings';
import { getAlwaysShow, setAlwaysShow } from '../../storage/preferences';

function Options() {
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState('');
  const [alwaysShow, setAlwaysShowChecked] = useState(false);
  const [emails, setEmails] = useState('');
  const [emailStatus, setEmailStatus] = useState('');

  useEffect(() => {
    void hasToken().then(setSaved);
    void getAlwaysShow().then(setAlwaysShowChecked);
    void getCommitEmails().then((savedEmails) => setEmails(savedEmails.join('\n')));
  }, []);

  async function onAlwaysShow(checked: boolean): Promise<void> {
    setAlwaysShowChecked(checked);
    try {
      await setAlwaysShow(checked);
    } catch {
      setAlwaysShowChecked(!checked);
    }
  }

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const value = new FormData(form).get('token');
    const token = typeof value === 'string' ? value.trim() : '';
    if (!token) {
      setStatus('Enter a token first.');
      return;
    }
    try {
      await setToken(token);
    } catch {
      setStatus('Could not save the token.');
      return;
    }
    form.reset();
    setSaved(true);
    setStatus('Token saved.');
  }

  async function onSaveEmails(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    try {
      await setCommitEmails(emails.split(/[\n,]+/));
      const savedEmails = await getCommitEmails();
      setEmails(savedEmails.join('\n'));
    } catch {
      setEmailStatus('Could not save the emails.');
      return;
    }
    setEmailStatus('Emails saved.');
  }

  return (
    <main>
      <h1>Commit Tracker</h1>
      <form onSubmit={(event) => void onSubmit(event)}>
        <label htmlFor="token">GitHub personal access token</label>
        <input id="token" name="token" type="password" autoComplete="off" spellcheck={false} />
        <button type="submit">Save token</button>
      </form>
      {saved && <p>A token is saved.</p>}
      {status && <p role="status">{status}</p>}
      <label>
        <input
          type="checkbox"
          checked={alwaysShow}
          onChange={(event) => void onAlwaysShow(event.currentTarget.checked)}
        />
        Always show
      </label>
      <form onSubmit={(event) => void onSaveEmails(event)}>
        <label htmlFor="emails">Extra commit emails</label>
        <textarea
          id="emails"
          name="emails"
          rows={4}
          autoComplete="off"
          spellcheck={false}
          value={emails}
          onInput={(event) => setEmails(event.currentTarget.value)}
        />
        <button type="submit">Save emails</button>
      </form>
      {emailStatus && <p role="status">{emailStatus}</p>}
    </main>
  );
}

const root = document.getElementById('app');
if (root) {
  render(<Options />, root);
}
