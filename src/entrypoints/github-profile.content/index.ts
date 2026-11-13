import { findContributionGraph, getProfileLogin } from '../../dom/github-page';

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
    mutation.disconnect();
    intersection?.disconnect();
  };
}
