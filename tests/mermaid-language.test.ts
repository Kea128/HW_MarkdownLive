import { ensureSyntaxTree, LanguageDescription } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'
import { mermaidLanguage } from '../src/mermaid-language'

function tokens(doc: string) {
  const state = EditorState.create({ doc, extensions: [mermaidLanguage.support!] })
  const tree = ensureSyntaxTree(state, state.doc.length, 5_000)!
  const result: string[] = []
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    result.push(`${state.doc.sliceString(from, to)}:${classes.replace('tok-', '')}`)
  })
  return result
}

describe('Mermaid 代码高亮', () => {
  it('以小写语言名注册，便于输出可移植的代码围栏', () => {
    expect(mermaidLanguage.name).toBe('mermaid')
    expect(LanguageDescription.matchLanguageName([mermaidLanguage], 'Mermaid', true)).toBe(mermaidLanguage)
    expect(LanguageDescription.matchLanguageName([mermaidLanguage], 'mmd', true)).toBe(mermaidLanguage)
  })

  it('高亮图表类型、关键字、箭头、字符串、数字和注释', () => {
    expect(tokens('stateDiagram-v2\n  A --> B : "完成" %% 备注\n  pie showData\n  "A" : 42')).toEqual([
      'stateDiagram-v2:keyword',
      '-->:operator',
      '"完成":string',
      '%% 备注:comment',
      'pie:keyword',
      'showData:keyword',
      '"A":string',
      '42:number',
    ])
    expect(tokens('flowchart LR\n  step_1[开始] -.-> B')).toEqual([
      'flowchart:keyword',
      '[:punctuation',
      ']:punctuation',
      '-.->:operator',
    ])
  })
})
