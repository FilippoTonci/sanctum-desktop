import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'sidecar-build/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'coverage/**',
      '*.config.js',
      '*.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  // Plain CommonJS build scripts — currently the electron-builder
  // beforePack hook, which must be .cjs because electron-builder requires
  // it from a CJS context. They belong to no tsconfig project, so the
  // type-aware parser errors out on them. Lint them with untyped rules
  // rather than ignoring them: this code gates every packaging run.
  {
    files: ['**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      sourceType: 'commonjs',
      parserOptions: {
        project: false,
        projectService: false,
        program: null,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Spread first: this key would otherwise replace disableTypeChecked's
      // own rules wholesale and switch every type-aware rule back on.
      ...tseslint.configs.disableTypeChecked.rules,
      // The whole point of a .cjs file is CommonJS; require() is correct
      // here, not a legacy import to be migrated.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
