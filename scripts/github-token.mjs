import { execFileSync } from 'node:child_process'

/** Prefers GH_TOKEN/GITHUB_TOKEN and falls back to the credential git already stores for github.com. */
export function resolveGitHubToken() {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (fromEnv) return fromEnv
  try {
    const output = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return /^password=(.+?)\r?$/m.exec(output)?.[1]
  } catch {
    return undefined
  }
}
