import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', '.git/**', 'test/**', 'admin/**', 'tesla-cmd-api/**'],
  },
  ...config,
  {
    files: ['**/*.{js,cjs,mjs,d.ts}'],
    languageOptions: {
      globals: {
        ...globals.mocha,
        WebSocket: 'readonly',
      },
    },
    rules: {
      'prettier/prettier': 'off',
      'prefer-template': 'off',
      curly: 'off',
      'no-else-return': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'jsdoc/check-alignment': 'off',
      'jsdoc/check-tag-names': 'off',
      'jsdoc/no-defaults': 'off',
      'jsdoc/reject-any-type': 'off',
      'jsdoc/require-jsdoc': 'off',
      'jsdoc/require-param': 'off',
      'jsdoc/require-param-description': 'off',
      'jsdoc/require-returns-description': 'off',
      'jsdoc/tag-lines': 'off',
      'jsdoc/valid-types': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
