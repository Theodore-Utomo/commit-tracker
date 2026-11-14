import { render } from 'preact';
import { localDay } from '../../core/aggregate';
import type { Contributions } from '../../core/types';
import { findContributionGraph, getProfileLogin } from '../../dom/github-page';
import { sendMessage } from '../../messaging/client';
import { KEEPALIVE_PORT, type KeepalivePing } from '../../messaging/protocol';
import { getAlwaysShow } from '../../storage/preferences';
import { Heatmap } from '../../ui/Heatmap';
import { Prompt } from '../../ui/Prompt';
import './style.css';

const PING_INTERVAL_MS = 20_000;
const PING: KeepalivePing = { type: 'PING' };

type View =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'prompt'; loading: boolean; error?: string; resetAt?: string }
  | { kind: 'heatmap'; contributions: Contributions; today: string };

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
  cssInjectionMode: 'ui',
  main(ctx) {
    let teardown = (): void => {};

    const start = (): void => {
      teardown();
      teardown = setup(ctx);
    };

    document.addEventListener('turbo:load', start);
    start();
  },
});

function setup(ctx: InstanceType<typeof ContentScriptContext>): () => void {
  const login = getProfileLogin(location.href);
  if (login === undefined) {
    return () => {};
  }

  let intersection: IntersectionObserver | undefined;
  let started = false;
  let active = true;
  let open = false;
  let stopKeepalive = (): void => {};
  let container: HTMLElement | undefined;
  let ui: { mount: () => void; remove: () => void } | undefined;
  let view: View = { kind: 'idle' };

  const paint = (): void => {
    if (!container) {
      return;
    }
    const loading = view.kind === 'loading' || (view.kind === 'prompt' && view.loading);
    render(
      <div class="commit-tracker">
        {loading && <p>Loading commits…</p>}
        {view.kind === 'prompt' && (
          <Prompt loading={view.loading} error={view.error} resetAt={view.resetAt} onAccept={() => void ask()} />
        )}
        {view.kind === 'heatmap' && <Heatmap contributions={view.contributions} today={view.today} />}
      </div>,
      container,
    );
  };

  const dropUi = (): void => {
    ui?.remove();
    ui = undefined;
    container = undefined;
  };

  const ensureUi = async (): Promise<boolean> => {
    if (!active) {
      return false;
    }
    if (ui) {
      return true;
    }
    const graph = findContributionGraph(document);
    if (!graph) {
      return false;
    }
    const created = await createShadowRootUi(ctx, {
      name: 'commit-tracker',
      position: 'inline',
      anchor: graph,
      append: 'after',
      onMount(uiContainer) {
        container = uiContainer;
        paint();
        return uiContainer;
      },
      onRemove(mounted) {
        if (mounted) {
          render(null, mounted);
        }
        if (container === mounted) {
          container = undefined;
        }
      },
    });
    if (!active) {
      created.remove();
      return false;
    }
    ui = created;
    ui.mount();
    return true;
  };

  const ask = async (): Promise<void> => {
    if (!active || open) {
      return;
    }
    open = true;
    const sentFor = login;
    view = view.kind === 'prompt' ? { kind: 'prompt', loading: true } : { kind: 'loading' };
    paint();
    stopKeepalive = holdWorkerAwake();
    const today = localDay(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    try {
      const response = await sendMessage({ type: 'GET_CONTRIBUTIONS', login: sentFor });
      if (!active) {
        return;
      }
      if (sentFor.toLowerCase() !== getProfileLogin(location.href)?.toLowerCase()) {
        dropUi();
        return;
      }
      if (!response.ok) {
        view = {
          kind: 'prompt',
          loading: false,
          error: response.error,
          resetAt: response.error === 'RATE_LIMITED' ? response.resetAt : undefined,
        };
        if (await ensureUi()) {
          paint();
        }
        return;
      }
      if ('viewerLogin' in response.data) {
        view = { kind: 'idle' };
        dropUi();
        return;
      }
      view = { kind: 'heatmap', contributions: response.data, today };
      if (await ensureUi()) {
        paint();
      }
    } finally {
      stopKeepalive();
      open = false;
    }
  };

  const begin = async (): Promise<void> => {
    const always = await getAlwaysShow().catch(() => false);
    if (!active || login.toLowerCase() !== getProfileLogin(location.href)?.toLowerCase()) {
      return;
    }
    if (always) {
      view = { kind: 'loading' };
      if (await ensureUi()) {
        await ask();
      }
      return;
    }
    view = { kind: 'prompt', loading: false };
    if (await ensureUi()) {
      paint();
    }
  };

  const watchGraph = (graph: Element): void => {
    mutation.disconnect();
    if (intersection) {
      return;
    }
    intersection = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((entry) => entry.intersectionRatio >= 0.5)) {
          return;
        }
        started = true;
        intersection?.disconnect();
        void begin();
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
    dropUi();
  };
}
