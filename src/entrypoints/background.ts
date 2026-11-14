import { isRequest, KEEPALIVE_PORT } from '../messaging/protocol';
import type { ContributionsDeps } from '../services/contributions';
import { createGitHubClient } from '../services/github/client';
import { handleGetContributions } from '../services/handle-message';
import { getToken } from '../services/settings';

export default defineBackground(() => {
  const deps: ContributionsDeps = {
    client: createGitHubClient(),
    getToken,
    now: () => new Date(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || !isRequest(message)) {
      return false;
    }

    switch (message.type) {
      case 'GET_CONTRIBUTIONS':
        void handleGetContributions(message, deps)
          .catch(() => ({ ok: false, error: 'UNKNOWN' }) as const)
          .then(sendResponse);
        return true;
      default:
        return false;
    }
  });

  // The content script pings this port while a request is open. Each message keeps the
  // worker alive; the port carries no data and nothing is done with it.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== KEEPALIVE_PORT || port.sender?.id !== browser.runtime.id) {
      port.disconnect();
      return;
    }
    port.onMessage.addListener(() => {});
  });
});
