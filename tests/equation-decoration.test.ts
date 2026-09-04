import { describe, expect, it } from 'vitest'
import { decorateEquationBlocks, hasEquationMutation } from '../src/equation-decoration'

describe('公式 DOM 装饰', () => {
  it('跳过未就绪块并继续装饰后续公式', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="milkdown-code-block"></div>
      <div class="milkdown-code-block">
        <pre class="milkdown-code-block-placeholder"><code>% @eq second
b
\\tag{2}</code></pre>
        <span class="katex-html"><span class="katex-tag">(2)</span></span>
      </div>
    `
    decorateEquationBlocks(root, [
      '$$', '% @eq first', 'a', '\\tag{1}', '$$', '',
      '$$', '% @eq second', 'b', '\\tag{2}', '$$',
    ].join('\n'))

    const blocks = root.querySelectorAll<HTMLElement>('.milkdown-code-block')
    expect(blocks[0]).not.toHaveAttribute('id')
    expect(blocks[1]).toHaveAttribute('id', 'eq-second')
    expect(blocks[1]).toHaveAttribute('data-equation-tag', '(2)')
  })

  it('忽略与公式无关的正文变化', () => {
    const paragraph = document.createElement('p')
    const equation = document.createElement('div')
    equation.className = 'milkdown-code-block'
    expect(hasEquationMutation([{
      target: paragraph,
      addedNodes: paragraph.childNodes,
      removedNodes: paragraph.childNodes,
    } as unknown as MutationRecord])).toBe(false)
    expect(hasEquationMutation([{
      target: equation,
      addedNodes: equation.childNodes,
      removedNodes: equation.childNodes,
    } as unknown as MutationRecord])).toBe(true)
  })
})
