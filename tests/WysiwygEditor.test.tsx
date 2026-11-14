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
  setReadonly: vi.fn(),
  view: null as null | { dom: HTMLElement; state: { selection: object }; dispatch: () => void },
  features: {} as Record<string, boolean>,
  featureConfigs: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('@milkdown/kit/utils', () => ({
  replaceAll: vi.fn((markdown: string) => ({ markdown })),
}))

vi.mock('../src/code-languages', () => ({
  plainTextLanguage: { name: 'text', alias: ['text', 'plaintext', 'txt'] },
  applyDefaultCodeLanguage: vi.fn(),
}))

vi.mock('../src/editor-images', () => ({
  IMAGE_MENU_ICON: '<svg></svg>',
  insertImages: vi.fn(),
  installImagePlugins: vi.fn(),
}))

vi.mock('../src/editor-breaks', () => ({
  keepInlineBreaks: vi.fn(),
}))

vi.mock('../src/editor-guards', () => ({ guardReadOnly: vi.fn() }))
vi.mock('../src/link-definitions', () => ({ preserveLinkDefinitions: vi.fn() }))
vi.mock('../src/latex-fences', () => ({ keepLatexFences: vi.fn() }))

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
    editor = { action: crepeState.action, config: vi.fn(), remove: vi.fn(async () => undefined), use: vi.fn() }
    readonly = false
    private root: HTMLElement

    setReadonly(value: boolean) {
      this.readonly = value
      crepeState.setReadonly(value)
      return this
    }

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
      this.root.innerHTML = `<div class="ProseMirror" contenteditable="${!this.readonly}"><p>初始</p></div>`
      crepeState.view = { dom: this.root.firstElementChild as HTMLElement, state: { selection: {} }, dispatch: vi.fn() }
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

import { commandsCtx } from '@milkdown/kit/core'
import { setBlockTypeCommand } from '@milkdown/kit/preset/commonmark'
import WysiwygEditor, { type EditorApi } from '../src/WysiwygEditor'
import { applyDefaultCodeLanguage } from '../src/code-languages'
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
    crepeState.view = null
    crepeState.action.mockClear()
    crepeState.action.mockImplementation((command?: { markdown?: string } | ((ctx: { get(): unknown }) => unknown)) => {
      if (typeof command === 'function') return command({ get: () => crepeState.view })
      if (typeof command?.markdown === 'string') crepeState.markdown = command.markdown
    })
    crepeState.destroy.mockClear()
    crepeState.setReadonly.mockClear()
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
    expect(renderMermaidPreview).toHaveBeenCalledWith('flowchart LR\n  A --> B', apply, null)
    expect(codeMirror.languages.map(({ name }) => name)).toEqual(expect.arrayContaining(['mermaid', 'frontmatter']))
    expect(codeMirror.languages.some(({ name }) => name === 'TypeScript')).toBe(true)
    expect((crepeState.featureConfigs.CodeMirror as { theme: unknown }).theme).toBeNull()
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
    const onNotice = vi.fn()
    rerender(<WysiwygEditor markdown="# 初始" documentPath={'D:\\其他\\b.md'} onChange={vi.fn()} onNotice={onNotice} />)
    expect(options.resolve('a.png')).toBe(toImageUrl('D:\\其他\\a.png'))
    vi.mocked(window.inkdown.document.pathForFile).mockReturnValueOnce('')
    await expect(options.store([new File(['png'], 'image.png', { type: 'image/png' })])).resolves.toEqual([{
      src: '初始.assets/image-20261112170000000.png',
      alt: 'image-20261112170000000',
      notice: '图片已保存到 初始.assets/image-20261112170000000.png',
    }])
    expect(onNotice).toHaveBeenCalledWith('图片已保存到 初始.assets/image-20261112170000000.png')
  })

  it('编辑时 Ctrl+单击打开链接、单击只放置光标；阅读模式单击即打开', async () => {
    const onNotice = vi.fn()
    const { container, rerender } = render(<WysiwygEditor markdown="# 初始" onChange={vi.fn()} onNotice={onNotice} />)
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
    expect(window.inkdown.external.open).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledWith('按住 Ctrl 单击可打开链接')
    fireEvent.click(screen.getByRole('link', { name: '外链' }), { ctrlKey: true })
    expect(window.inkdown.external.open).toHaveBeenCalledWith('https://example.com/')
    fireEvent.click(screen.getByRole('link', { name: '公式引用' }), { ctrlKey: true })
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })

    rerender(<WysiwygEditor markdown="# 初始" readOnly onChange={vi.fn()} onNotice={onNotice} />)
    fireEvent.click(screen.getByRole('link', { name: '外链' }))
    expect(window.inkdown.external.open).toHaveBeenCalledTimes(2)
  })

  it('父组件回传编辑器刚报告的内容时不重新载入，避免撤销记录和光标丢失', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<WysiwygEditor markdown="# 初始" documentId={1} onChange={onChange} />)
    await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    crepeState.action.mockClear()
    crepeState.markdownUpdated?.({}, 'see \\[1]')
    expect(onChange).toHaveBeenLastCalledWith('see \\[1]')
    rerender(<WysiwygEditor markdown="see \[1]" documentId={1} onChange={onChange} />)
    expect(crepeState.action).not.toHaveBeenCalledWith(expect.objectContaining({ markdown: expect.anything() }))
    rerender(<WysiwygEditor markdown="# 新文档" documentId={2} onChange={onChange} />)
    await waitFor(() => expect(crepeState.action).toHaveBeenCalledWith({ markdown: '# 新文档' }))
  })

  it('初始化失败时回退为可编辑源码框', async () => {
    crepeState.rejectCreate = true
    const onChange = vi.fn()
    render(<WysiwygEditor markdown="原文" onChange={onChange} />)
    const fallback = await screen.findByRole('textbox', { name: 'Markdown 源码' })
    fireEvent.change(fallback, { target: { value: '回退编辑' } })
    expect(onChange).toHaveBeenCalledWith('回退编辑')
  })

  it('阅读模式在创建前就只读，切换时不重建编辑器', async () => {
    const { container, rerender } = render(<WysiwygEditor markdown="# 初始" readOnly onChange={vi.fn()} />)
    const editor = await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    expect(crepeState.setReadonly).toHaveBeenCalledWith(true)
    expect(editor).toHaveAttribute('aria-readonly', 'true')
    expect(container.querySelector('.visual-editor')).toHaveClass('is-readonly')

    rerender(<WysiwygEditor markdown="# 初始" onChange={vi.fn()} />)
    expect(crepeState.setReadonly).toHaveBeenLastCalledWith(false)
    expect(editor).toHaveAttribute('aria-readonly', 'false')
    expect(container.querySelector('.visual-editor')).not.toHaveClass('is-readonly')
    rerender(<WysiwygEditor markdown="# 初始" readOnly onChange={vi.fn()} />)
    expect(editor).toHaveAttribute('aria-readonly', 'true')
    expect(crepeState.destroy).not.toHaveBeenCalled()
  })

  it('斜杠菜单和 ``` 输入按设置的默认语言创建代码块', async () => {
    const { rerender } = render(<WysiwygEditor markdown="# 初始" codeLanguage="python" onChange={vi.fn()} />)
    await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    const language = vi.mocked(applyDefaultCodeLanguage).mock.calls.at(-1)![1]
    expect(language()).toBe('python')

    const blockEdit = crepeState.featureConfigs.BlockEdit as { buildMenu: (builder: unknown) => void }
    const items: Array<{ key: string; onRun?: (ctx: unknown) => void }> = [{ key: 'code' }]
    const addItem = vi.fn()
    blockEdit.buildMenu({ getGroup: () => ({ group: { items }, addItem }) })
    expect(addItem).toHaveBeenCalledWith('image', expect.objectContaining({ label: '图片' }))
    rerender(<WysiwygEditor markdown="# 初始" codeLanguage="text" onChange={vi.fn()} />)
    expect(language()).toBe('text')
    const commands = { call: vi.fn() }
    items[0].onRun?.({ get: (slice: unknown) => slice === commandsCtx ? commands : { nodes: { code_block: 'CODE_BLOCK' } } })
    expect(commands.call).toHaveBeenLastCalledWith(setBlockTypeCommand.key, {
      nodeType: 'CODE_BLOCK', attrs: { language: 'text' },
    })
  })

  it('切换到源码前交出尚未通知的最新内容', async () => {
    const onChange = vi.fn()
    let api: EditorApi | null = null
    render(<WysiwygEditor markdown="# 初始" onChange={onChange} onReady={(value) => { api = value }} />)
    await screen.findByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    await waitFor(() => expect(api).not.toBeNull())
    crepeState.markdown = '# 刚输入'
    api!.flush()
    expect(onChange).toHaveBeenCalledWith('# 刚输入')
    expect(api!.anchor()).toBeNull()
  })
})
