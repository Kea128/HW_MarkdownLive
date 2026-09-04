export interface EquationDefinition {
  label: string
  number: number
}

export interface BlockEquation {
  content: string
  label?: string
}

const blockEquationPattern = /(^|\n)(\$\$\s*\n)([\s\S]*?)(\n\$\$)(?=\n|$)/g
const equationLabelPattern = /^\s*%\s*@eq\s+([A-Za-z][\w.-]*)\s*$/m
const generatedTagPattern = /\n?\\tag\{\d+\}\s*$/

export function getBlockEquations(markdown: string): BlockEquation[] {
  const labels = new Set<string>()
  return Array.from(markdown.matchAll(blockEquationPattern), (match) => {
    const content = match[3]
    const candidate = equationLabelPattern.exec(content)?.[1]
    const label = candidate && !labels.has(candidate) ? candidate : undefined
    if (label) labels.add(label)
    return { content, label }
  })
}

export function getBlockEquationLabels(markdown: string): Array<string | undefined> {
  return getBlockEquations(markdown).map(({ label }) => label)
}

export function getEquationDefinitions(markdown: string): EquationDefinition[] {
  const definitions: EquationDefinition[] = []
  const labels = new Set<string>()

  for (const match of markdown.matchAll(blockEquationPattern)) {
    const label = equationLabelPattern.exec(match[3])?.[1]
    if (!label || labels.has(label)) continue
    labels.add(label)
    definitions.push({ label, number: definitions.length + 1 })
  }

  return definitions
}

export function createEquationLabel(markdown: string): string {
  const labels = new Set(getEquationDefinitions(markdown).map(({ label }) => label))
  let index = labels.size + 1
  while (labels.has(`formula-${index}`)) index += 1
  return `formula-${index}`
}

export function prepareEquationMarkdown(markdown: string): string {
  const numbers = new Map(
    getEquationDefinitions(markdown).map(({ label, number }) => [label, number]),
  )
  const renderedLabels = new Set<string>()

  const withNumberedEquations = markdown.replace(
    blockEquationPattern,
    (block, leading: string, opening: string, content: string, closing: string) => {
      const label = equationLabelPattern.exec(content)?.[1]
      if (!label || renderedLabels.has(label)) return block
      const number = label ? numbers.get(label) : undefined
      if (!number) return block
      renderedLabels.add(label)
      const cleanContent = content.replace(generatedTagPattern, '')
      return `${leading}${opening}${cleanContent}\n\\tag{${number}}${closing}`
    },
  )

  return withNumberedEquations.replace(
    /\[式\s+@([A-Za-z][\w.-]*)\]\(#eq-\1\)/g,
    (reference, label: string) => {
      const number = numbers.get(label)
      return number ? `[式 (${number})](#eq-${label})` : reference
    },
  )
}

export function restoreEquationMarkdown(markdown: string): string {
  const withoutGeneratedTags = markdown.replace(
    blockEquationPattern,
    (_block, leading: string, opening: string, content: string, closing: string) => {
      const hasLabel = equationLabelPattern.test(content)
      const cleanContent = hasLabel ? content.replace(generatedTagPattern, '') : content
      return `${leading}${opening}${cleanContent}${closing}`
    },
  )

  return withoutGeneratedTags.replace(
    /\[式\s+\(\d+\)\]\(#eq-([A-Za-z][\w.-]*)\)/g,
    (_reference, label: string) => `[式 @${label}](#eq-${label})`,
  )
}
