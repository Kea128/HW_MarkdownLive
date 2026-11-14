import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const editorTheme = EditorView.theme({
  '&': { color: 'var(--code-text)' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--code-selection)',
  },
  '.cm-gutters': { color: 'var(--faint)', border: 'none' },
  '&.cm-focused .cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
  '&.cm-focused .cm-activeLineGutter': { color: 'var(--text)', backgroundColor: 'var(--code-active-line)' },
  '&:not(.cm-focused) .cm-activeLine': { backgroundColor: 'transparent' },
  '&:not(.cm-focused) .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--code-selection)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  '.cm-foldPlaceholder': { color: 'var(--faint)', backgroundColor: 'transparent', border: 'none' },
  '.cm-tooltip': { color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { color: 'var(--text)', backgroundColor: 'var(--hover)' },
})

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--code-keyword)' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: 'var(--code-name)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--code-function)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--code-constant)' },
  { tag: [t.definition(t.name), t.separator], color: 'var(--code-text)' },
  {
    tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace],
    color: 'var(--code-type)',
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: 'var(--code-operator)',
  },
  { tag: [t.meta, t.comment], color: 'var(--code-comment)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--code-comment)', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', color: 'var(--code-name)' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: 'var(--code-constant)' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: 'var(--code-string)' },
  { tag: t.invalid, color: 'var(--danger)' },
])

/**
 * Crepe gives every code block One Dark, whose light grey text was hard to read on the light theme's pale background.
 * Same token mapping, coloured from CSS variables so code blocks follow the app theme without being rebuilt.
 */
export const codeTheme = [editorTheme, syntaxHighlighting(highlightStyle)]
