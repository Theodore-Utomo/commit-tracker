import { isRequest } from '../messaging/protocol';
import { createGitHubClient } from '../services/github/client';
import { handleGetContributions } from '../services/handle-message';
import { getToken } from '../services/settings';

export default defineBackground(() => {
  const client = createGitHubClient();

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || !isRequest(message)) {
      return false;
    }

    switch (message.type) {
      case 'GET_CONTRIBUTIONS':
        void handleGetContributions(message, { getToken, client })
          .catch(() => ({ ok: false, error: 'UNKNOWN' }) as const)
          .then(sendResponse);
        return true;
      default:
        return false;
    }
  });
});
