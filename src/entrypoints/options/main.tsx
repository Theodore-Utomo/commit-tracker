import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { hasToken, setToken } from '../../services/settings';
import { getAlwaysShow, setAlwaysShow } from '../../storage/preferences';

function Options() {
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState('');
  const [alwaysShow, setAlwaysShowChecked] = useState(false);

  useEffect(() => {
    void hasToken().then(setSaved);
    void getAlwaysShow().then(setAlwaysShowChecked);
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
    </main>
  );
}

const root = document.getElementById('app');
if (root) {
  render(<Options />, root);
}
