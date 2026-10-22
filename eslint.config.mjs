import config from '@book000/eslint-config'

export default [
  ...config,
  {
    // node:test の describe / it は Promise を返すが、テストランナーが待機するため await 不要
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
]
