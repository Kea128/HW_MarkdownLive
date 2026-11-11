import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const crepeState = vi.hoisted(() => ({
  rejectCreate: false,
  markdown: '# 初始',
  canonicalize: (markdown: string) => markdown,
  markdownUpdated: undefined as undefined | ((ctx: unknown, markdown: string) => void),
  blur: undefined as undefined | (() => void),
  action: vi.fn(),
  destroy: vi.fn(),
  features: {} as Record<string, boolean>,
  featureConfigs: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('@milkdown/kit/utils', () => ({
  replaceAll: vi.fn((markdown: string) => ({ markdown })),
}))

vi.mock('../src/editor-images', () => ({
  installImagePlugins: vi.fn(),
}))

vi.mock('../src/mermaid-preview', () => ({
  isMermaidLanguage: (language: string) => language.toLowerCase() === 'mermaid',
  renderMermaidPreview: vi.fn(() => undefined),
}))

vi.mock('@milkdown/crepe', () => {
  class MockCrepe {
    static Feature = {
      Latex: 'Latex',
      Table: 'Table',
      CodeMirror: 'CodeMirror',
      Toolbar: 'Toolbar',
      Placeholder: 'Placeholder',
      BlockEdit: 'BlockEdit',
      ImageBlock: 'ImageBlock',
    }
    editor = { action: crepeState.action }
    private root: HTMLElement

    constructor(options: {
      root: HTMLElement
      defaultValue: string
      features: Record<string, boolean>
      featureConfigs: Record<string, Record<string, unknown>>
    }) {
      this.root = options.root
      crepeState.markdown = options.defaultValue
      crepeState.features = options.features
      crepeState.featureConfigs = options.featureConfigs
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
      return crepeState.canonicalize(crepeState.markdown)
    }

    destroy() {
      crepeState.destroy()
      return Promise.resolve()
    }
  }
  return { Crepe: MockCrepe }
})

import WysiwygEditor from '../src/WysiwygEditor'
import { installImagePlugins } from '../src/editor-images'
import { toImageUrl } from '../src/image-source'
import { renderMermaidPreview } from '../src/mermaid-preview'

describe('WysiwygEditor 生命周期', () => {
  beforeEach(() => {
    crepeState.rejectCreate = false
    crepeState.markdown = '# 初始'
    crepeState.canonicalize = (markdown) => markdown
    crepeState.markdownUpdated = undefined
    crepeState.blur = undefined
    crepeState.action.mockClear()
    crepeState.action.mockImplementation((command?: { markdown?: string }) => {
      if (typeof command?.markdown === 'string') crepeState.markdown = command.markdown
    })
    crepeState.destroy.mockClear()
  })

  it('编辑器只是规范化载入的 Markdown 时不视为修改', async () => {
    crepeState.canonicalize = (markdown) => markdown.replaceAll('|---|', '| --- |')
    const onChange = vi.fn()
    const { rerender } = render(<WysiwygEditor markdown={'| 列 |\n|---|\n| 甲 |'} onChange={onChange} />)
    await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    crepeState.markdownUpdated?.({}, '| 列 |\n| --- |\n| 甲 |')
    crepeState.blur?.()
    expect(onChange).not.toHaveBeenCalled()

    crepeState.markdownUpdated?.({}, '| 列 |\n| --- |\n| 乙 |')
    expect(onChange).toHaveBeenLastCalledWith('| 列 |\n| --- |\n| 乙 |')
    crepeState.markdownUpdated?.({}, '| 列 |\n| --- |\n| 甲 |')
    expect(onChange).toHaveBeenLastCalledWith('| 列 |\n|---|\n| 甲 |')

    onChange.mockClear()
    rerender(<WysiwygEditor markdown={'| 新 |\n|---|\n| 丙 |'} onChange={onChange} />)
    await waitFor(() => expect(crepeState.action).toHaveBeenCalled())
    crepeState.markdownUpdated?.({}, '| 新 |\n| --- |\n| 丙 |')
    crepeState.blur?.()
    expect(onChange).not.toHaveBeenCalled()
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

  it('为 mermaid 代码块提供图表预览、语言选项和中文操作文案', async () => {
    render(<WysiwygEditor markdown="# 初始" onChange={vi.fn()} />)
    await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    const codeMirror = crepeState.featureConfigs.CodeMirror as {
      languages: Array<{ name: string }>
      renderPreview: (language: string, content: string, apply: (value: string | null) => void) => unknown
      previewToggleText: (previewOnly: boolean) => string
      copyText: string
    }
    const apply = vi.fn()
    expect(codeMirror.renderPreview('ts', 'const a = 1', apply)).toBeNull()
    expect(codeMirror.renderPreview('Mermaid', '   ', apply)).toBeNull()
    expect(codeMirror.renderPreview('Mermaid', 'flowchart LR\n  A --> B', apply)).toBeUndefined()
    expect(renderMermaidPreview).toHaveBeenCalledWith('flowchart LR\n  A --> B', apply)
    expect(codeMirror.languages.at(-1)?.name).toBe('mermaid')
    expect(codeMirror.languages.some(({ name }) => name === 'TypeScript')).toBe(true)
    expect([codeMirror.copyText, codeMirror.previewToggleText(true), codeMirror.previewToggleText(false)])
      .toEqual(['复制', '编辑', '隐藏'])
    const blockEdit = crepeState.featureConfigs.BlockEdit as { blockHandle: { getOffset: () => number } }
    expect(blockEdit.blockHandle.getOffset()).toBe(6)
  })

  it('关闭会改写图片说明的图片块，并按当前文档位置解析本地图片', async () => {
    const { rerender } = render(<WysiwygEditor markdown="# 初始" documentPath={'C:\\笔记\\a.md'} onChange={vi.fn()} />)
    await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    expect(crepeState.features.ImageBlock).toBe(false)
    const options = vi.mocked(installImagePlugins).mock.calls.at(-1)![1]
    expect(options.resolve('assets/图.png')).toBe(toImageUrl('C:\\笔记\\assets\\图.png'))
    expect(options.resolve('https://example.com/a.png')).toBe('https://example.com/a.png')
    rerender(<WysiwygEditor markdown="# 初始" documentPath={'D:\\其他\\b.md'} onChange={vi.fn()} />)
    expect(options.documentPath()).toBe('D:\\其他\\b.md')
    expect(options.resolve('a.png')).toBe(toImageUrl('D:\\其他\\a.png'))
    expect(options.pathForFile(new File([''], 'x.png'))).toBe('C:\\测试\\文档.md')
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
