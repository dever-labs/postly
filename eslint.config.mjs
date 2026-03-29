import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

export default [
  // Base JS recommended
  js.configs.recommended,

  // All TS/TSX source files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // TypeScript recommended (manually listed to avoid .configs.recommended compat issue)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Disable base rules superseded by TS equivalents
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-redeclare': 'off', // TS handles declaration merging

      // Allow intentional empty catch blocks: catch (e) {}
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-assignment': 'off',

      // React
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Ignore patterns
  {
    ignores: ['node_modules/**', 'dist/**', 'out/**', '**/*.config.js', '**/*.config.ts', '**/*.config.cjs'],
  },
]
