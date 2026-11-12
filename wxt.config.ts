import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

export default defineConfig({
  srcDir: 'src',
  vite: () => ({ plugins: [preact()] }),
  manifest: {
    name: 'Commit Tracker',
    description: 'See GitHub commits across all branches, not just the default branch.',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
  },
});
