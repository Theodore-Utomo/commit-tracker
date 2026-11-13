import { findContributionGraph, getProfileLogin } from '../../dom/github-page';
import { sendMessage } from '../../messaging/client';

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

  const askWorker = async (): Promise<void> => {
    const response = await sendMessage({ type: 'GET_CONTRIBUTIONS', login });
    if (!active) {
      return;
    }
    console.log(response.ok ? response.data.viewerLogin : response.error);
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
    mutation.disconnect();
    intersection?.disconnect();
  };
}
