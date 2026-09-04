import { useCallback, type RefObject } from 'react'
import { insertMarkdown, insertMarkdownBlock, setMarkdownHeading } from '../utils'

interface Options {
  editorRef: RefObject<HTMLTextAreaElement | null>
  content: string
  updateContent: (content: string) => void
}

export function useSourceEditorActions({ editorRef, content, updateContent }: Options) {
  const applyResult = useCallback((result: {
    value: string
    selectionStart: number
    selectionEnd: number
  }) => {
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

  return { applyFormat, applyHeading, applyBlockFormat, insertLiteral }
}
