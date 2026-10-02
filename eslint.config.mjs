// ESLint 扁平配置（ESLint 9+）。
// 首轮接入只开「警告级」规则：不阻断构建，目的是把 24k 行纯 JS 的显性隐患逐步收敛，
// 格式问题交给 Prettier，二者职责分离（不要用 ESLint 管格式）。
// 启用：npm i -D eslint prettier  然后 npm run lint / npm run format
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.ecache/**',
      'data/**',
      'build/**',
      'src/renderer/test_dice.html'
    ]
  },
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script'
    },
    rules: {
      // 未使用变量/参数：允许下划线前缀（代码中大量 catch (_) 与占位参数）
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-redeclare': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-dupe-keys': 'warn',
      'no-dupe-args': 'warn',
      'no-unreachable': 'warn',
      'no-fallthrough': 'warn',
      // 空块在本项目用于「兜底吞错」，属有意为之，不告警
      'no-empty': 'off'
    }
  }
];
