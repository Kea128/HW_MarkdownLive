import { describe, expect, it } from 'vitest'
import {
  createEquationLabel,
  getBlockEquations,
  getBlockEquationLabels,
  getEquationDefinitions,
  prepareEquationMarkdown,
  restoreEquationMarkdown,
} from '../src/equations'

const numberedDocument = [
  '$$',
  '% @eq energy',
  'E = mc^2',
  '$$',
  '',
  '由[式 @energy](#eq-energy)可知能量关系。',
  '',
  '$$',
  '% @eq sum',
  '\\sum_{i=1}^{n} i',
  '$$',
].join('\n')

describe('公式编号与引用', () => {
  it('按文档顺序提取公式标签和编号', () => {
    expect(getEquationDefinitions(numberedDocument)).toEqual([
      { label: 'energy', number: 1 },
      { label: 'sum', number: 2 },
    ])
    expect(getBlockEquationLabels(numberedDocument)).toEqual(['energy', 'sum'])
  })

  it('为排版视图注入编号并把引用显示为当前编号', () => {
    const prepared = prepareEquationMarkdown(numberedDocument)
    expect(prepared).toContain('E = mc^2\n\\tag{1}\n$$')
    expect(prepared).toContain('\\sum_{i=1}^{n} i\n\\tag{2}\n$$')
    expect(prepared).toContain('[式 (1)](#eq-energy)')
    expect(restoreEquationMarkdown(prepared)).toBe(numberedDocument)
  })

  it('插入新公式后自动顺延已有编号并生成唯一标签', () => {
    const inserted = `$$\n% @eq formula-3\nx = 1\n$$\n\n${numberedDocument}`
    const prepared = prepareEquationMarkdown(inserted)
    expect(prepared).toContain('[式 (2)](#eq-energy)')
    expect(createEquationLabel(numberedDocument)).toBe('formula-3')
  })

  it('重复标签只编号和装饰首次出现的公式', () => {
    const duplicate = `${numberedDocument}\n\n$$\n% @eq energy\nE = duplicate\n$$`
    const prepared = prepareEquationMarkdown(duplicate)
    expect(getEquationDefinitions(duplicate)).toEqual([
      { label: 'energy', number: 1 },
      { label: 'sum', number: 2 },
    ])
    expect(getBlockEquationLabels(duplicate)).toEqual(['energy', 'sum', undefined])
    expect(getBlockEquations(prepared).map(({ label }) => label))
      .toEqual(['energy', 'sum', undefined])
    expect(prepared.match(/\\tag\{1\}/g)).toHaveLength(1)
    expect(restoreEquationMarkdown(prepared)).toBe(duplicate)
  })
})
