import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/generated/**',
      'commitlint.config.js',
      'lint-staged.config.js',
      '**/jest.config.js',
      'eslint.config.mjs',
      // k6 scripts: run by k6's own TypeScript engine (tests/load/README.md), not
      // tsc — they import 'k6/http' and similar module specifiers that don't exist
      // in this repo's `node_modules` and aren't covered by any tsconfig project,
      // which typescript-eslint's `projectService` requires every linted file to
      // belong to. Verified by actually running them with k6, not by this linter.
      'tests/load/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.spec.ts',
      '**/*.e2e-spec.ts',
      '**/tests/**/*.ts',
      '**/test/**/*.ts',
    ],
    rules: {
      // node:test's test() returns a Promise by design.
      '@typescript-eslint/no-floating-promises': 'off',
      // Test assertions exercise response bodies typed as `any` by supertest.
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  {
    files: ['**/scripts/**/*.ts', '**/prisma/seed.ts'],
    rules: {
      // CLI entrypoints emit progress/status to stdout.
      'no-console': 'off',
    },
  },
);
