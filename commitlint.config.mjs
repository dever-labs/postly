/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => {
    const header = message.split('\n', 1)[0] ?? ''
    const hasDependabotHeader = /^(build|chore)\(deps(?:-dev)?\): bump .+/.test(header)
    const hasDependabotSignoff =
      /^Signed-off-by: dependabot\[bot\] <49699333\+dependabot\[bot\]@users\.noreply\.github\.com>$/m.test(message)
    return hasDependabotHeader && hasDependabotSignoff
  }],
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
