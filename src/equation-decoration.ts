import { getBlockEquations } from './equations'

const normalizeSource = (source: string) => source
  .replaceAll('\r\n', '\n')
  .split('\n')
  .map((line) => line.trimEnd())
  .join('\n')
  .trim()

export function readCodeBlockSource(block: HTMLElement): string | null {
  const placeholder = block.querySelector<HTMLElement>('.milkdown-code-block-placeholder code')
  if (placeholder) return normalizeSource(placeholder.textContent ?? '')

  const lines = Array.from(block.querySelectorAll<HTMLElement>('.cm-content .cm-line'))
  if (!lines.length) return null
  return normalizeSource(lines.map((line) => line.textContent ?? '').join('\n'))
}

function clearEquationDecoration(block: HTMLElement) {
  if (block.id.startsWith('eq-')) block.removeAttribute('id')
  block.classList.remove('numbered-equation', 'equation-target')
  block.removeAttribute('aria-label')
}

function syncEquationTag(block: HTMLElement) {
  const renderedTag = block.querySelector<HTMLElement>('.katex-html > .katex-tag')
  if (!renderedTag) {
    delete block.dataset.equationTag
    block.classList.remove('tagged-equation')
    return
  }
  block.classList.add('tagged-equation')
  block.dataset.equationTag = renderedTag.textContent ?? ''
}

export function decorateEquationBlocks(root: HTMLElement, markdown: string) {
  const labelsBySource = new Map(
    getBlockEquations(markdown).flatMap(({ content, label }) =>
      label ? [[normalizeSource(content), label] as const] : []),
  )

  for (const block of root.querySelectorAll<HTMLElement>('.milkdown-code-block')) {
    syncEquationTag(block)
    const source = readCodeBlockSource(block)
    if (source === null) continue
    const label = labelsBySource.get(source)
    if (!label) {
      clearEquationDecoration(block)
      continue
    }
    block.id = `eq-${label}`
    block.classList.add('numbered-equation')
    block.setAttribute('aria-label', `公式 ${label}`)
  }
}

export function hasEquationMutation(records: MutationRecord[]): boolean {
  return records.some(({ target, addedNodes, removedNodes }) => {
    if (target instanceof Element && target.closest('.milkdown-code-block')) return true
    return [...addedNodes, ...removedNodes].some((node) =>
      node instanceof Element
      && (node.matches('.milkdown-code-block, .katex, .katex-display')
        || Boolean(node.querySelector('.milkdown-code-block, .katex, .katex-display'))))
  })
}
