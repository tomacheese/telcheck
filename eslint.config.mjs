import baseConfig from '@book000/eslint-config';

/**
 * @type {import('eslint').Linter.Config[]}
 */
const config = [
  ...baseConfig,
  {
    // unicorn/catch-error-name が err を要求するが、
    // unicorn/prevent-abbreviations のデフォルトで err → error に置換しようとするため競合する。
    // JS ファイルで prevent-abbreviations の err 置換ルールを無効にする。
    files: ['**/*.js'],
    rules: {
      'unicorn/prevent-abbreviations': [
        'error',
        {
          replacements: {
            err: false,
          },
        },
      ],
    },
  },
];

export default config;
