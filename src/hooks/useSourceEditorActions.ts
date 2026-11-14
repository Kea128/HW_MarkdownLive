import { useCallback, type RefObject } from 'react'
import {
  indentLines, insertMarkdown, insertMarkdownBlock, setMarkdownHeading, toggleLinePrefix, type LinePrefix,
} from '../utils'

interface Options {
  editorRef: RefObject<HTMLTextAreaElement | null>
  content: string
  updateContent: (content: string) => void
}

/** Replaces only the changed span through the browser so Ctrl+Z can undo toolbar edits; assigning `value` clears history. */
function replaceUndoably(editor: HTMLTextAreaElement, next: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const current = editor.value
  if (current === next) return true
  let start = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start += 1
  let currentEnd = current.length
  let nextEnd = next.length
  while (currentEnd > start && nextEnd > start && current[currentEnd - 1] === next[nextEnd - 1]) {
    currentEnd -= 1
    nextEnd -= 1
  }
  editor.focus()
  editor.setSelectionRange(start, currentEnd)
  const inserted = next.slice(start, nextEnd)
  const applied = inserted ? document.execCommand('insertText', false, inserted) : document.execCommand('delete')
  return applied && editor.value === next
}

export function useSourceEditorActions({ editorRef, content, updateContent }: Options) {
  const applyResult = useCallback((result: {
    value: string
    selectionStart: number
    selectionEnd: number
  }) => {
    const editor = editorRef.current
    if (editor && replaceUndoably(editor, result.value)) {
      editor.setSelectionRange(result.selectionStart, result.selectionEnd)
      return
    }
    updateContent(result.value)
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      editorRef.current?.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }, [editorRef, updateContent])

  const selection = useCallback(() => {
    const editor = editorRef.current
    return editor ? [editor.selectionStart, editor.selectionEnd] as const : null
  }, [editorRef])

  const applyFormat = useCallback((prefix: string, suffix = prefix, placeholder = '文本') => {
    const range = selection()
    if (range) applyResult(insertMarkdown(content, ...range, prefix, suffix, placeholder))
  }, [applyResult, content, selection])

  const applyHeading = useCallback((level: number) => {
    const range = selection()
    if (range) applyResult(setMarkdownHeading(content, ...range, level))
  }, [applyResult, content, selection])

  const applyBlockFormat = useCallback((prefix: string, suffix: string, placeholder: string) => {
    const range = selection()
    if (range) applyResult(insertMarkdownBlock(content, ...range, prefix, suffix, placeholder))
  }, [applyResult, content, selection])

  const applyLinePrefix = useCallback((kind: LinePrefix, placeholder: string) => {
    const range = selection()
    if (range) applyResult(toggleLinePrefix(content, ...range, kind, placeholder))
  }, [applyResult, content, selection])

  const indent = useCallback((outdent: boolean) => {
    const range = selection()
    if (range) applyResult(indentLines(content, ...range, outdent))
  }, [applyResult, content, selection])

  const insertLiteral = useCallback((text: string) => {
    const range = selection()
    if (!range) return
    const [start, end] = range
    applyResult({
      value: content.slice(0, start) + text + content.slice(end),
      selectionStart: start + text.length,
      selectionEnd: start + text.length,
    })
  }, [applyResult, content, selection])

  return { applyFormat, applyHeading, applyBlockFormat, applyLinePrefix, indent, insertLiteral }
}
