// Flat ESLint config. The app source is ESM (Metro/Babel); a few files
// (timeMath.js, jobLogic.js, the __tests__ suites, and config files) are
// CommonJS so Node's built-in test runner can require() them directly.
const expoConfig = require('eslint-config-expo/flat');
const eslintConfigPrettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
  // Global ignores — build output, deps, Deno edge functions, smoke dumps.
  {
    ignores: [
      'node_modules/**',
      'dist-smoke*/**',
      '.expo/**',
      'dist/**',
      'web-build/**',
      'supabase/functions/**',
    ],
  },

  ...expoConfig,
  eslintConfigPrettier,

  // eslint-config-expo 57 ships the React Compiler rule set as errors. This app
  // does not use the React Compiler, and the flagged code is hand-written and
  // correct, so keep these as advisory warnings rather than CI-blocking errors.
  {
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },

  // CommonJS files: allow require/module/__dirname and Node globals.
  {
    files: [
      '**/__tests__/**/*.js',
      '**/*.test.js',
      'src/services/timeMath.js',
      'src/services/jobLogic.js',
      'eslint.config.js',
      'prettier.config.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
];
