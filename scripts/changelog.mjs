export function changelogSection(changelog, version) {
  const start = changelog.indexOf(`## [${version}]`)
  if (start === -1) throw new Error(`CHANGELOG.md 缺少 ${version} 的版本说明`)
  const bodyStart = changelog.indexOf('\n', start) + 1
  const end = changelog.indexOf('\n## [', bodyStart)
  return changelog.slice(bodyStart, end === -1 ? undefined : end).trim()
}

// Inkdown 2.7.0 cuts notes longer than 600 characters mid-line, so stay below that on whole lines.
// The app parses notes as HTML (stripping tags, decoding entities), so literal <, > and & must be escaped.
export function updateNotes(markdown, maxLength = 560) {
  const lines = markdown.split(/\r?\n/)
    .map((line) => line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+/, '• ')
      .replace(/^>\s?/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim())
    .filter(Boolean)
  const kept = []
  let length = 0
  for (const line of lines) {
    if (length + line.length > maxLength) {
      kept.push(kept.length ? '…' : `${line.slice(0, maxLength - 1)}…`)
      break
    }
    kept.push(line)
    length += line.length + 1
  }
  return kept.join('\n')
}

export function withReleaseNotes(feed, notes) {
  if (/^releaseNotes:/m.test(feed)) throw new Error('latest.yml 已包含 releaseNotes')
  const block = notes.split('\n').map((line) => `  ${line}`).join('\n')
  return `${feed.trimEnd()}\nreleaseNotes: |-\n${block}\n`
}
