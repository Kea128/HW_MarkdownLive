import { Decoration as CodeDecoration, EditorView as CodeView, ViewPlugin, type DecorationSet as CodeDecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Editor } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import {
  compileQuery, findMatches, MAX_MATCHES, replacementAt, type SearchQuery, type SearchResult,
} from './search'

export interface TextMatch {
  from: number
  to: number
  /** Position of the code block holding the match; its text is drawn by CodeMirror, not ProseMirror. */
  block: number | null
}

interface SearchState {
  query: SearchQuery | null
  pattern: RegExp | null
  matches: TextMatch[]
  current: number
  decorations: DecorationSet
}

type SearchMeta =
  | { type: 'query'; query: SearchQuery | null }
  | { type: 'current'; index: number }
  /** The next match is the first one at or after `pos`, so a replacement that still matches is not replaced again. */
  | { type: 'after'; pos: number }

export const searchKey = new PluginKey<SearchState>('inkdown-search')
const EMPTY: SearchState = { query: null, pattern: null, matches: [], current: -1, decorations: DecorationSet.empty }
// Atoms (inline math, images, raw HTML) take one position, so each stands in as one character a match cannot cross.
const LEAF = '\uFFFC'

function blockText(node: ProseNode): string {
  return node.textBetween(0, node.content.size, undefined, LEAF)
}

export function collectMatches(doc: ProseNode, pattern: RegExp): TextMatch[] {
  const matches: TextMatch[] = []
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_MATCHES) return false
    if (!node.isTextblock) return true
    const block = node.type.spec.code ? pos : null
    for (const { start, end } of findMatches(blockText(node), pattern, MAX_MATCHES - matches.length)) {
      matches.push({ from: pos + 1 + start, to: pos + 1 + end, block })
    }
    return false
  })
  return matches
}

const firstFrom = (matches: TextMatch[], pos: number) => {
  if (!matches.length) return -1
  const index = matches.findIndex((match) => match.from >= pos)
  return index === -1 ? 0 : index
}

function decorate(doc: ProseNode, matches: TextMatch[], current: number): DecorationSet {
  const decorations = matches.flatMap((match, index) => match.block === null
    ? [Decoration.inline(match.from, match.to, { class: index === current ? 'search-match search-current' : 'search-match' })]
    : [])
  return DecorationSet.create(doc, decorations)
}

function nextState(tr: Transaction, previous: SearchState): SearchState {
  const meta = tr.getMeta(searchKey) as SearchMeta | undefined
  if (!meta && !(tr.docChanged && previous.pattern)) return previous
  if (meta?.type === 'query') {
    const compiled = meta.query ? compileQuery(meta.query) : null
    if (!(compiled instanceof RegExp)) return { ...EMPTY, query: meta.query }
    const matches = collectMatches(tr.doc, compiled)
    const current = firstFrom(matches, tr.selection.from)
    return { query: meta.query, pattern: compiled, matches, current, decorations: decorate(tr.doc, matches, current) }
  }
  if (!previous.pattern) return previous
  const matches = tr.docChanged ? collectMatches(tr.doc, previous.pattern) : previous.matches
  let current: number
  if (meta?.type === 'current') current = matches.length ? (meta.index % matches.length + matches.length) % matches.length : -1
  else if (meta?.type === 'after') current = firstFrom(matches, meta.pos)
  else {
    const before = previous.matches[previous.current]
    current = firstFrom(matches, before ? tr.mapping.map(before.from) : tr.selection.from)
  }
  return { ...previous, matches, current, decorations: decorate(tr.doc, matches, current) }
}

/** What CodeMirror needs to highlight matches inside code blocks, including blocks that are mounted later. */
const codeSearch = {
  pattern: null as RegExp | null,
  currentBlock: null as Element | null,
  currentRange: null as readonly [number, number] | null,
  version: 0,
}

class CodeSearchHighlight {
  decorations: CodeDecorationSet = CodeDecoration.none
  version = -1

  constructor(view: CodeView) {
    this.decorations = this.build(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || this.version !== codeSearch.version) this.decorations = this.build(update.view)
  }

  build(view: CodeView): CodeDecorationSet {
    this.version = codeSearch.version
    if (!codeSearch.pattern) return CodeDecoration.none
    const current = codeSearch.currentBlock?.contains(view.dom) ? codeSearch.currentRange : null
    return CodeDecoration.set(findMatches(view.state.doc.toString(), codeSearch.pattern).map(({ start, end }) =>
      CodeDecoration.mark({
        class: current?.[0] === start && current[1] === end ? 'cm-search-match cm-search-current' : 'cm-search-match',
      }).range(start, end)))
  }
}

export const codeSearchHighlight = ViewPlugin.fromClass(CodeSearchHighlight, { decorations: (plugin) => plugin.decorations })

function syncCodeBlocks(view: EditorView, state: SearchState): void {
  const match = state.matches[state.current]
  codeSearch.pattern = state.pattern
  codeSearch.currentBlock = match?.block != null ? view.nodeDOM(match.block) as Element | null : null
  codeSearch.currentRange = match?.block != null ? [match.from - match.block - 1, match.to - match.block - 1] : null
  codeSearch.version += 1
  for (const element of view.dom.querySelectorAll<HTMLElement>('.cm-editor')) CodeView.findFromDOM(element)?.dispatch({})
}

export function searchResult(view: EditorView): SearchResult {
  const state = searchKey.getState(view.state) ?? EMPTY
  return { count: state.matches.length, current: state.current }
}

/** Highlights search matches and reports how many there are after every change. */
export function installSearch(editor: Editor, onResult: (result: SearchResult) => void): void {
  editor.use($prose(() => searchPlugin(onResult)))
}

export function searchPlugin(onResult: (result: SearchResult) => void): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchKey,
    state: {
      init: () => EMPTY,
      apply: (tr, previous) => nextState(tr, previous),
    },
    props: {
      decorations: (state) => searchKey.getState(state)?.decorations,
    },
    view: (view) => {
      let shown = searchKey.getState(view.state)
      return {
        update: (current) => {
          const state = searchKey.getState(current.state)
          if (!state || state === shown) return
          const changed = state.matches !== shown?.matches || state.current !== shown.current || state.pattern !== shown.pattern
          shown = state
          if (!changed) return
          syncCodeBlocks(current, state)
          onResult({ count: state.matches.length, current: state.current })
        },
        destroy: () => {
          codeSearch.pattern = null
          codeSearch.version += 1
        },
      }
    },
  })
}

/** Scrolls the current match to the middle of the pane; a code block may first have to mount its CodeMirror. */
function revealCurrent(view: EditorView): void {
  const state = searchKey.getState(view.state)
  const match = state?.matches[state.current]
  if (!match) return
  const block = match.block === null ? null : view.nodeDOM(match.block) as HTMLElement | null
  const attempt = (tries: number) => {
    if (view.isDestroyed) return
    const target = block ? block.querySelector('.cm-search-current') : view.dom.querySelector('.search-current')
    if (target) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' })
      return
    }
    if (tries === 0) block?.scrollIntoView({ block: 'center' })
    if (block && tries < 10) requestAnimationFrame(() => {
      syncCodeBlocks(view, searchKey.getState(view.state) ?? EMPTY)
      attempt(tries + 1)
    })
  }
  attempt(0)
}

/** Moving to a match also selects it, so closing the search bar leaves the caret there. */
function dispatchAndSelect(view: EditorView, tr: Transaction, select: boolean): void {
  view.dispatch(tr)
  if (!select) return
  const state = searchKey.getState(view.state)
  const match = state?.matches[state.current]
  if (!match) return
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)))
  revealCurrent(view)
}

/** `select` is false when a query is re-applied to new text, which should not move the caret. */
export function setSearchQuery(view: EditorView, query: SearchQuery | null, select = true): void {
  dispatchAndSelect(view, view.state.tr.setMeta(searchKey, { type: 'query', query } satisfies SearchMeta), select && Boolean(query))
}

export function moveSearch(view: EditorView, step: 1 | -1): void {
  const state = searchKey.getState(view.state)
  if (!state?.matches.length) return
  dispatchAndSelect(view, view.state.tr.setMeta(searchKey, { type: 'current', index: state.current + step } satisfies SearchMeta), true)
}

function replacementFor(view: EditorView, state: SearchState, match: TextMatch, replacement: string): string {
  const $from = view.state.doc.resolve(match.from)
  return replacementAt(blockText($from.parent), match.from - $from.start(), state.pattern!, state.query!, replacement)
}

export function replaceCurrent(view: EditorView, replacement: string): boolean {
  const state = searchKey.getState(view.state)
  const match = state?.matches[state.current]
  if (!state || !match || !view.editable) return false
  const text = replacementFor(view, state, match, replacement)
  const tr = text ? view.state.tr.insertText(text, match.from, match.to) : view.state.tr.delete(match.from, match.to)
  dispatchAndSelect(view, tr.setMeta(searchKey, { type: 'after', pos: match.from + text.length } satisfies SearchMeta), true)
  return true
}

/** One transaction, so a single undo brings every replaced match back. */
export function replaceAllMatches(view: EditorView, replacement: string): number {
  const state = searchKey.getState(view.state)
  if (!state?.matches.length || !view.editable) return 0
  const tr = view.state.tr
  for (const match of [...state.matches].reverse()) {
    const text = replacementFor(view, state, match, replacement)
    if (text) tr.insertText(text, match.from, match.to)
    else tr.delete(match.from, match.to)
  }
  view.dispatch(tr.setMeta(searchKey, { type: 'after', pos: 0 } satisfies SearchMeta))
  return state.matches.length
}
