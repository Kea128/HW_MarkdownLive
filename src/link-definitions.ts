import type { Editor } from '@milkdown/kit/core'
import { remarkInlineLinkPlugin } from '@milkdown/kit/preset/commonmark'
import { $remark } from '@milkdown/kit/utils'

export interface LinkNode {
  type: string
  children?: LinkNode[]
  identifier?: string
  label?: string | null
  url?: string
  title?: string | null
  alt?: string | null
  value?: string
  position?: { start: { offset?: number }; end: { offset?: number } }
}

const normalize = (identifier: string) => identifier.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase().toUpperCase()

function definitionSource(node: LinkNode, source: string | undefined): string {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (source && start !== undefined && end !== undefined) return source.slice(start, end)
  return `[${node.label ?? node.identifier}]: ${node.url ?? ''}${node.title ? ` "${node.title}"` : ''}`
}

/**
 * Milkdown has no node for link definitions: its plugin turned references into inline links and deleted every
 * definition, including `[//]: # (comment)` lines, on the first save. References still become inline links, but
 * each definition stays in the document as its original line of Markdown.
 */
export function inlineReferences(tree: LinkNode, source?: string): void {
  const definitions = new Map<string, LinkNode>()
  const collect = (node: LinkNode) => {
    if (node.type === 'definition' && node.identifier && !definitions.has(normalize(node.identifier))) {
      definitions.set(normalize(node.identifier), node)
    }
    node.children?.forEach(collect)
  }
  collect(tree)

  const visit = (node: LinkNode) => {
    if (!node.children) return
    node.children = node.children.map((child): LinkNode => {
      if (child.type === 'definition') {
        return { type: 'paragraph', children: [{ type: 'html', value: definitionSource(child, source) }] }
      }
      const definition = child.identifier && (child.type === 'linkReference' || child.type === 'imageReference')
        ? definitions.get(normalize(child.identifier))
        : undefined
      if (!definition) return child
      return child.type === 'imageReference'
        ? { type: 'image', url: definition.url, title: definition.title, alt: child.alt }
        : { type: 'link', url: definition.url, title: definition.title, children: child.children }
    })
    node.children.forEach(visit)
  }
  visit(tree)
}

const keepDefinitions = $remark('inkdownInlineLinks', () => () => (tree, file) => {
  inlineReferences(tree as unknown as LinkNode, typeof file?.value === 'string' ? file.value : undefined)
})

export function preserveLinkDefinitions(editor: Editor): void {
  void editor.remove(remarkInlineLinkPlugin.plugin)
  editor.use(keepDefinitions)
}
