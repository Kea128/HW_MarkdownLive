export const FRONT_MATTER_LANGUAGE = 'frontmatter'

const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/
const FENCED_FRONT_MATTER = /^(`{3,})frontmatter\n([\s\S]*?)\n?\1[ \t]*(?:\n|$)/

/**
 * Milkdown has no front matter node: a leading `---` block became a horizontal rule plus a setext heading and was
 * rewritten on save. It travels through the editor as a `frontmatter` code block instead.
 */
export function prepareFrontMatter(markdown: string): string {
  const match = FRONT_MATTER.exec(markdown)
  if (!match) return markdown
  const fence = '`'.repeat(Math.max(3, ...(match[1].match(/`{3,}/g) ?? []).map((run) => run.length + 1)))
  return `${fence}${FRONT_MATTER_LANGUAGE}\n${match[1]}\n${fence}\n${markdown.slice(match[0].length)}`
}

export function restoreFrontMatter(markdown: string): string {
  const match = FENCED_FRONT_MATTER.exec(markdown)
  if (!match) return markdown
  return `---\n${match[2]}\n---\n${markdown.slice(match[0].length)}`
}
