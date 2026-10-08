import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { DocumentCommand, UpdateState } from '../src/contracts'

vi.mock('../src/WysiwygEditor', () => ({
  default: ({ markdown, onChange }: { markdown: string; onChange: (value: string) => void }) => (
    <div aria-label="Markdown 所见即所得编辑器">
      <h1>{markdown.match(/^#\s+(.+)$/m)?.[1]}</h1>
      <textarea aria-label="所见即所得测试输入" value={markdown} onChange={(event) => onChange(event.target.value)} />
    </div>
  ),
}))

const toggleSource = () => fireEvent.keyDown(window, { key: '/', code: 'Slash', ctrlKey: true })

describe('Inkdown 桌面编辑器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.mocked(window.inkdown.document.initialize).mockResolvedValue({
      content: '# 初始文稿',
      filePath: 'C:\\中文\\初始.md',
      fileName: '初始.md',
      dirty: false,
    })
  })

  it('载入桌面文档并在所见即所得模式直接编辑', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: '初始文稿' }, { timeout: 3_000 })).toBeInTheDocument()
    const editor = screen.getByRole('textbox', { name: '所见即所得测试输入' })
    fireEvent.change(editor, { target: { value: '# 新标题\n\n<script>alert(1)</script>' } })
    expect(screen.getByRole('heading', { name: '新标题' })).toBeInTheDocument()
    expect(document.querySelector('script')).not.toBeInTheDocument()
    await waitFor(() => expect(window.inkdown.document.changed)
      .toHaveBeenCalledWith('# 新标题\n\n<script>alert(1)</script>'))
  })

  it('通过桌面桥接执行新建、打开、保存和另存为', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    await userEvent.click(screen.getByTitle('新建 (Ctrl+N)'))
    await userEvent.click(screen.getByTitle('打开 (Ctrl+O)'))
    await userEvent.click(screen.getByTitle('保存 (Ctrl+S)'))
    await userEvent.click(screen.getByTitle('另存为 (Ctrl+Shift+S)'))
    await waitFor(() => {
      expect(window.inkdown.document.newDocument).toHaveBeenCalledOnce()
      expect(window.inkdown.document.open).toHaveBeenCalledOnce()
      expect(window.inkdown.document.save).toHaveBeenCalledOnce()
      expect(window.inkdown.document.saveAs).toHaveBeenCalledOnce()
    })
  })

  it('保存前等待最后一次编辑同步完成', async () => {
    const order: string[] = []
    vi.mocked(window.inkdown.document.changed).mockImplementation(async () => {
      await Promise.resolve()
      order.push('changed')
    })
    vi.mocked(window.inkdown.document.save).mockImplementation(async () => {
      order.push('save')
      return { ok: true }
    })
    render(<App />)
    const editor = await screen.findByRole('textbox', { name: '所见即所得测试输入' })
    fireEvent.change(editor, { target: { value: '# 最后输入' } })
    await userEvent.click(screen.getByTitle('保存 (Ctrl+S)'))
    await waitFor(() => expect(window.inkdown.document.save).toHaveBeenCalledOnce())
    expect(order).toEqual(['changed', 'save'])
  })

  it('原生菜单命令复用渲染层保存入口', async () => {
    let commandListener: ((command: DocumentCommand) => void) | undefined
    vi.mocked(window.inkdown.document.onCommand).mockImplementation((listener) => {
      commandListener = listener
      return () => undefined
    })
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    act(() => commandListener?.({ action: 'save' }))
    await waitFor(() => expect(window.inkdown.document.save).toHaveBeenCalledOnce())
  })

  it('格式化选区并显示脏状态', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    toggleSource()
    const editor = await screen.findByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
    editor.setSelectionRange(2, 6)
    await userEvent.click(screen.getByTitle('粗体'))
    expect(editor).toHaveValue('# **初始文稿**')
    expect(screen.getByLabelText('未保存')).toBeInTheDocument()
  })

  it('主进程回显脏文档时保持未保存状态文案', async () => {
    let updateListener: ((snapshot: {
      content: string
      filePath: string | null
      fileName: string
      dirty: boolean
    }) => void) | undefined
    vi.mocked(window.inkdown.document.onUpdated).mockImplementation((listener) => {
      updateListener = listener
      return () => undefined
    })
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    act(() => updateListener?.({
      content: '# 已修改',
      filePath: 'C:\\中文\\初始.md',
      fileName: '初始.md',
      dirty: true,
    }))
    expect(screen.getByText('有未保存的更改')).toBeInTheDocument()
  })

  it('提供大纲、行号与公式快捷输入', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    await userEvent.click(screen.getByRole('button', { name: '展开侧栏' }))
    toggleSource()
    const editor = await screen.findByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
    expect(screen.getByRole('navigation', { name: '文档大纲' })).toHaveTextContent('初始文稿')
    expect(document.querySelector('.line-numbers')).toHaveTextContent('1')
    editor.setSelectionRange(editor.value.length, editor.value.length)
    await userEvent.click(screen.getByTitle('行内公式'))
    expect(editor).toHaveValue('# 初始文稿$E = mc^2$')
  })

  it('提供完整标题层级、编号公式和公式引用', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    toggleSource()
    const editor = await screen.findByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
    editor.setSelectionRange(2, editor.value.length)
    await userEvent.selectOptions(screen.getByLabelText('段落样式'), '3')
    expect(editor).toHaveValue('### 初始文稿')
    await waitFor(() => expect(editor.selectionStart).toBe(4))

    editor.setSelectionRange(editor.value.length, editor.value.length)
    await userEvent.click(screen.getByRole('button', { name: '插入编号公式' }))
    expect(editor.value).toContain('\n\n$$\n% @eq formula-1\n\\sum_{i=1}^{n} i\n$$')
    await waitFor(() => expect(editor.selectionStart).toBe(editor.value.indexOf('\\sum')))

    editor.setSelectionRange(editor.value.length, editor.value.length)
    await userEvent.selectOptions(screen.getByLabelText('引用公式'), 'formula-1')
    expect(editor.value).toContain('[式 @formula-1](#eq-formula-1)')
  })

  it('响应主进程视图和主题事件', async () => {
    let modeListener: ((mode: 'visual' | 'source' | 'toggle') => void) | undefined
    let themeListener: ((theme: 'system' | 'light' | 'dark') => void) | undefined
    vi.mocked(window.inkdown.view.onMode).mockImplementation((listener) => {
      modeListener = listener
      return () => undefined
    })
    vi.mocked(window.inkdown.view.onTheme).mockImplementation((listener) => {
      themeListener = listener
      return () => undefined
    })
    render(<App />)
    await waitFor(() => expect(modeListener).toBeDefined())
    act(() => modeListener?.('source'))
    expect(screen.getByTitle('源码')).toHaveAttribute('aria-pressed', 'true')
    act(() => modeListener?.('toggle'))
    expect(screen.getByTitle('所见即所得')).toHaveAttribute('aria-pressed', 'true')
    act(() => themeListener?.('dark'))
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    await userEvent.click(screen.getByRole('button', { name: '切换明暗主题' }))
    expect(window.inkdown.view.setTheme).toHaveBeenCalledWith('light')
  })

  it('在状态栏显示在线更新进度', async () => {
    let updateListener: ((state: UpdateState) => void) | undefined
    vi.mocked(window.inkdown.updates.onState).mockImplementation((listener) => {
      updateListener = listener
      return () => undefined
    })
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    act(() => updateListener?.({ phase: 'checking' }))
    expect(screen.getByText('正在检查更新…')).toBeInTheDocument()
    act(() => updateListener?.({ phase: 'downloading', version: '2.8.0', percent: 42.7 }))
    expect(screen.getByText('正在下载 v2.8.0（42%）')).toBeInTheDocument()
    act(() => updateListener?.({ phase: 'downloaded', version: '2.8.0' }))
    expect(screen.getByText('v2.8.0 已下载，退出时自动安装')).toBeInTheDocument()
    act(() => updateListener?.({ phase: 'idle' }))
    expect(document.querySelector('.update-status')).not.toBeInTheDocument()
  })

  it('调整并记住排版行间距', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    await userEvent.selectOptions(screen.getByLabelText('行间距'), 'relaxed')
    expect(document.querySelector('.app')).toHaveAttribute('data-line-spacing', 'relaxed')
    expect(localStorage.getItem('inkdown-line-spacing')).toBe('relaxed')
  })

  it('拖放文件仅把受控路径交给主进程', async () => {
    render(<App />)
    const file = new File(['# drop'], '文档.md')
    fireEvent.drop(document.querySelector('.app')!, { dataTransfer: { files: [file] } })
    await waitFor(() => expect(window.inkdown.document.openPath).toHaveBeenCalledWith('C:\\测试\\文档.md'))
  })
})
