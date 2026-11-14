import { findContributionGraph, getProfileLogin } from '../../dom/github-page';
import { sendMessage } from '../../messaging/client';
import { KEEPALIVE_PORT, type KeepalivePing } from '../../messaging/protocol';

const PING_INTERVAL_MS = 20_000;
const PING: KeepalivePing = { type: 'PING' };

/**
 * Holds a port to the worker open and pings it, because a Manifest V3 worker is only kept
 * alive while messages arrive. Returns the function that stops it. Never throws.
 */
function holdWorkerAwake(): () => void {
  let port: Browser.runtime.Port | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    try {
      port?.disconnect();
    } catch {
      // the extension was reloaded; the port is already gone
    }
    port = undefined;
  };
  try {
    port = browser.runtime.connect({ name: KEEPALIVE_PORT });
    port.onDisconnect.addListener(stop);
    timer = setInterval(() => {
      try {
        port?.postMessage(PING);
      } catch {
        stop();
      }
    }, PING_INTERVAL_MS);
  } catch {
    stop();
  }
  return stop;
}

export default defineContentScript({
  matches: ['https://github.com/*'],
  main() {
    let teardown = (): void => {};

    const start = (): void => {
      teardown();
      teardown = setup();
    };

    document.addEventListener('turbo:load', start);
    start();
  },
});

function setup(): () => void {
  const login = getProfileLogin(location.href);
  if (login === undefined) {
    return () => {};
  }

  let intersection: IntersectionObserver | undefined;
  let logged = false;
  let active = true;
  let stopKeepalive = (): void => {};

  const askWorker = async (): Promise<void> => {
    stopKeepalive = holdWorkerAwake();
    const response = await sendMessage({ type: 'GET_CONTRIBUTIONS', login });
    stopKeepalive();
    if (!active) {
      return;
    }
    if (!response.ok) {
      console.log(response.error);
    } else if ('viewerLogin' in response.data) {
      console.log(response.data.viewerLogin);
    } else {
      console.log(`${response.data.totals.commits} commits across all branches`);
    }
  };

  const watchGraph = (graph: Element): void => {
    mutation.disconnect();
    if (intersection) {
      return;
    }
    intersection = new IntersectionObserver(
      (entries) => {
        if (logged || !entries.some((entry) => entry.intersectionRatio >= 0.5)) {
          return;
        }
        logged = true;
        intersection?.disconnect();
        console.log(login);
        void askWorker();
      },
      { threshold: 0.5 },
    );
    intersection.observe(graph);
  };

  const mutation = new MutationObserver(() => {
    const graph = findContributionGraph(document);
    if (graph) {
      watchGraph(graph);
    }
  });

  mutation.observe(document.documentElement, { childList: true, subtree: true });

  const existing = findContributionGraph(document);
  if (existing) {
    watchGraph(existing);
  }

  return () => {
    active = false;
    stopKeepalive();
    mutation.disconnect();
    intersection?.disconnect();
  };
}
