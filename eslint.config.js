import autoImports from './.wxt/eslint-auto-imports.mjs';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.output/**',
      '.wxt/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  autoImports,
  {
    files: ['src/entrypoints/github-profile.content/**', 'src/ui/**', 'src/dom/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/**'],
              message: 'Import display preferences from src/storage/preferences.ts. src/services/ is for the service worker.',
            },
          ],
        },
      ],
    },
  },
);
