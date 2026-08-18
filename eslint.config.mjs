// Flat ESLint config (ESLint 9). Scoped to the V2 app (v2/src) only.
//
// V1 (index.html) is the frozen rollback and is deliberately NOT linted:
// it is one 3.6k-line static file with no build step (CLAUDE.md §3), and a
// linter would only produce noise on code nobody is meant to touch except for
// a rollback fix. New work goes to V2, so V2 is where the guard belongs.
//
// This config is REPORT-ONLY hygiene, not a behaviour gate. It is intentionally
// conservative: it flags real hazards (unused vars, undefined globals, the
// `ref(obj).value !== obj` / self-compare family, empty blocks) and stays quiet
// on style, which Prettier owns. `eslint-config-prettier` is last so no lint
// rule fights the formatter.

import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';

export default [
  {
    // Never lint build output, deps, or the frozen V1 app.
    ignores: ['dist/**', 'node_modules/**', 'vendor/**', 'index.html'],
  },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['v2/src/**/*.{js,vue}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Browser runtime the app actually uses.
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        location: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        Image: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        // Vite injects import.meta.env; flat config needs no extra for that.
      },
    },
    rules: {
      // A caught error that is genuinely ignored is written `catch (e) {}` in a
      // few storage-blocked fallbacks; allow that, flag everything else unused.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      // The §5 defect family: comparing a value to itself is always a bug.
      'no-self-compare': 'error',
      'no-constant-binary-expression': 'error',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Vue: the app is not typed, so keep these as warnings, not build-breakers.
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      // Purely cosmetic layout rules Prettier does not manage for Vue templates.
      // Off deliberately, so the report stays substantive (unused vars, undefined
      // globals, self-compares) rather than drowning in attribute-order noise.
      'vue/attributes-order': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
    },
  },
  prettier,
];
