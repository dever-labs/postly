/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allowed types — must match the table in .github/copilot-instructions.md
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'security', 'perf', 'refactor', 'revert', 'docs', 'test', 'chore', 'build', 'ci'],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
}
