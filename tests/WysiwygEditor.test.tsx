import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const crepeState = vi.hoisted(() => ({
  rejectCreate: false,
  markdown: '# 初始',
  markdownUpdated: undefined as undefined | ((ctx: unknown, markdown: string) => void),
  blur: undefined as undefined | (() => void),
  action: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('@milkdown/kit/utils', () => ({
  replaceAll: vi.fn((markdown: string) => ({ markdown })),
}))

vi.mock('@milkdown/crepe', () => {
  class MockCrepe {
    static Feature = {
      Latex: 'Latex',
      Table: 'Table',
      CodeMirror: 'CodeMirror',
      Toolbar: 'Toolbar',
      Placeholder: 'Placeholder',
    }
    editor = { action: crepeState.action }
    private root: HTMLElement

    constructor(options: { root: HTMLElement; defaultValue: string }) {
      this.root = options.root
      crepeState.markdown = options.defaultValue
    }

    on(register: (listener: {
      markdownUpdated(callback: (ctx: unknown, markdown: string) => void): void
      blur(callback: () => void): void
    }) => void) {
      register({
        markdownUpdated: (callback) => { crepeState.markdownUpdated = callback },
        blur: (callback) => { crepeState.blur = callback },
      })
    }

    async create() {
      if (crepeState.rejectCreate) throw new Error('create failed')
      this.root.innerHTML = '<div contenteditable="true"><p>初始</p></div>'
    }

    getMarkdown() {
      return crepeState.markdown
    }

    destroy() {
      crepeState.destroy()
      return Promise.resolve()
    }
  }
  return { Crepe: MockCrepe }
})

import WysiwygEditor from '../src/WysiwygEditor'

describe('WysiwygEditor 生命周期', () => {
  beforeEach(() => {
    crepeState.rejectCreate = false
    crepeState.markdown = '# 初始'
    crepeState.markdownUpdated = undefined
    crepeState.blur = undefined
    crepeState.action.mockClear()
    crepeState.destroy.mockClear()
  })

  it('创建编辑器、发布变更并同步外部 Markdown', async () => {
    const onChange = vi.fn()
    const { rerender, unmount } = render(
      <WysiwygEditor markdown="# 初始" onChange={onChange} />,
    )
    expect(await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' }))
      .toBeInTheDocument()

    crepeState.markdownUpdated?.({}, '# 已修改')
    expect(onChange).toHaveBeenCalledWith('# 已修改')

    rerender(<WysiwygEditor markdown="# 外部更新" onChange={onChange} />)
    await waitFor(() => expect(crepeState.action).toHaveBeenCalled())
    unmount()
    expect(crepeState.destroy).toHaveBeenCalledOnce()
  })

  it('拦截安全外链并遵循减少动态效果设置', async () => {
    const { container } = render(<WysiwygEditor markdown="# 初始" onChange={vi.fn()} />)
    await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    const host = container.querySelector('.visual-editor > div')!
    host.insertAdjacentHTML('beforeend', [
      '<a href="https://example.com">外链</a>',
      '<a href="#eq-target">公式引用</a>',
      '<div id="eq-target"></div>',
    ].join(''))
    const target = container.querySelector<HTMLElement>('#eq-target')!
    target.scrollIntoView = vi.fn()

    fireEvent.click(screen.getByRole('link', { name: '外链' }))
    expect(window.inkdown.external.open).toHaveBeenCalledWith('https://example.com/')
    fireEvent.click(screen.getByRole('link', { name: '公式引用' }))
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('初始化失败时回退为可编辑源码框', async () => {
    crepeState.rejectCreate = true
    const onChange = vi.fn()
    render(<WysiwygEditor markdown="原文" onChange={onChange} />)
    const fallback = await screen.findByRole('textbox', { name: 'Markdown 源码' })
    fireEvent.change(fallback, { target: { value: '回退编辑' } })
    expect(onChange).toHaveBeenCalledWith('回退编辑')
  })
})
