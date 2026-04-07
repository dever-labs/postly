/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => /^Signed-off-by: dependabot\[bot\]/m.test(message)],
  rules: {
    // Allowed types — must match the table in .github/copilot-instructions.md
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'security', 'perf', 'refactor', 'revert', 'docs', 'test', 'chore', 'build', 'ci'],
    ],
    'subject-full-stop': [2, 'never', '.'],
    'subject-case': [0],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
}
