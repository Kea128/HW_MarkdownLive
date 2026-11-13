import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import type { DocumentCommand, UpdateState, WorkspaceSnapshot } from '../src/contracts'

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

  it('在源码模式插入可编辑的 Mermaid 图表模板', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    toggleSource()
    const editor = await screen.findByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
    editor.setSelectionRange(editor.value.length, editor.value.length)
    await userEvent.click(screen.getByRole('button', { name: '插入 Mermaid 图表' }))
    expect(editor.value).toBe('# 初始文稿\n\n```mermaid\nflowchart LR\n  A[开始] --> B{是否完成？}\n'
      + '  B -- 是 --> C[发布]\n  B -- 否 --> D[继续修改]\n```')
    await waitFor(() => expect(editor.value.slice(editor.selectionStart, editor.selectionEnd))
      .toMatch(/^flowchart LR\n[\s\S]*继续修改\]$/))
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
    expect(screen.getByText('正在下载 v2.8.0（42%）')).toHaveAttribute('aria-live', 'off')
    act(() => updateListener?.({ phase: 'downloaded', version: '2.8.0' }))
    expect(screen.getByText('v2.8.0 已下载，退出时自动安装')).not.toHaveAttribute('aria-live')
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

  it('源码模式粘贴截图时保存图片并插入 Markdown 链接', async () => {
    vi.mocked(window.inkdown.document.pathForFile).mockReturnValue('')
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    toggleSource()
    const editor = await screen.findByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
    editor.setSelectionRange(editor.value.length, editor.value.length)
    const image = new File([new Uint8Array([1, 2])], 'image.png', { type: 'image/png' })
    fireEvent.paste(editor, {
      clipboardData: { files: [image], items: [{ kind: 'file', type: 'image/png' }], getData: () => '' },
    })
    await waitFor(() => expect(editor).toHaveValue('# 初始文稿![image-20261112170000000](初始.assets/image-20261112170000000.png)'))
    expect(window.inkdown.images.save).toHaveBeenCalledWith({ name: 'image.png', type: 'image/png', data: new Uint8Array([1, 2]) })
    expect(screen.getByText('图片已保存到 初始.assets/image-20261112170000000.png')).toBeInTheDocument()
  })

  it('设置中修改图片保存位置，自定义文件夹会先校验', async () => {
    let showListener: (() => void) | undefined
    vi.mocked(window.inkdown.settings.onShow).mockImplementation((listener) => {
      showListener = listener
      return () => undefined
    })
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    await userEvent.click(screen.getByRole('button', { name: '设置' }))
    const dialog = await screen.findByRole('dialog', { name: '设置' })
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: /与文档同名的 \.assets 文件夹/ })).toBeChecked())
    expect(within(dialog).getByText('“初始”的图片将保存到文档所在文件夹下的 初始.assets')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('radio', { name: /自定义文件夹/ }))
    const custom = within(dialog).getByRole('textbox', { name: '自定义图片文件夹' })
    await userEvent.clear(custom)
    await userEvent.type(custom, 'img|{{filename}')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('不能包含')
    expect(within(dialog).getByRole('button', { name: '保存' })).toBeDisabled()
    await userEvent.clear(custom)
    await userEvent.type(custom, 'images/${{filename}')
    expect(within(dialog).getByText('“初始”的图片将保存到文档所在文件夹下的 images/初始')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(window.inkdown.settings.setImageFolder)
      .toHaveBeenCalledWith({ mode: 'custom', template: 'images/${filename}' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/已更新图片保存位置/)).toBeInTheDocument()

    act(() => showListener?.())
    expect(await screen.findByRole('dialog', { name: '设置' })).toBeInTheDocument()
  })

  it('源码模式插入图片时选择文件并写入相对路径', async () => {
    vi.mocked(window.inkdown.images.choose).mockResolvedValueOnce([
      { ok: true, src: '初始.assets/架构图.png', location: 'saved' },
    ])
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    toggleSource()
    const editor = await screen.findByRole('textbox', { name: 'Markdown 源码' }) as HTMLTextAreaElement
    editor.setSelectionRange(editor.value.length, editor.value.length)
    await userEvent.click(screen.getByRole('button', { name: '插入图片' }))
    await waitFor(() => expect(editor).toHaveValue('# 初始文稿![架构图](初始.assets/架构图.png)'))
  })

  it('拖入图片交给编辑器插入，不当作文档打开', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    const image = new File(['png'], '截图.png', { type: 'image/png' })
    fireEvent.drop(document.querySelector('.app')!, { dataTransfer: { files: [image] } })
    expect(window.inkdown.document.openPath).not.toHaveBeenCalled()
  })

  it('打开文件夹后在侧栏列出 Markdown 文件并点击打开', async () => {
    const workspace: WorkspaceSnapshot = {
      root: 'C:\\中文',
      name: '中文',
      fileCount: 3,
      truncated: false,
      entries: [
        { name: '指南', path: 'C:\\中文\\指南', children: [{ name: '安装.md', path: 'C:\\中文\\指南\\安装.md' }] },
        { name: '初始.md', path: 'C:\\中文\\初始.md' },
        { name: '说明.md', path: 'C:\\中文\\说明.md' },
      ],
    }
    let workspaceListener: ((snapshot: WorkspaceSnapshot | null) => void) | undefined
    vi.mocked(window.inkdown.workspace.onUpdated).mockImplementation((listener) => {
      workspaceListener = listener
      return () => undefined
    })
    vi.mocked(window.inkdown.workspace.open).mockResolvedValue(workspace)
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    await userEvent.click(screen.getByRole('button', { name: '打开文件夹' }))

    const files = await screen.findByRole('navigation', { name: '文件夹中的 Markdown 文件' })
    expect(screen.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true')
    expect(within(files).getByRole('button', { name: '初始.md' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(files).getByRole('button', { name: '说明.md' }))
    expect(window.inkdown.document.openPath).toHaveBeenCalledWith('C:\\中文\\说明.md')

    const folder = within(files).getByRole('button', { name: '指南' })
    expect(folder).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(folder)
    expect(folder).toHaveAttribute('aria-expanded', 'false')
    expect(within(files).queryByRole('button', { name: '安装.md' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: '大纲' }))
    expect(screen.getByRole('navigation', { name: '文档大纲' })).toHaveTextContent('初始文稿')
    await userEvent.click(screen.getByRole('tab', { name: '文件' }))
    await userEvent.click(screen.getByRole('button', { name: '刷新文件列表' }))
    expect(window.inkdown.workspace.refresh).toHaveBeenCalledOnce()
    act(() => workspaceListener?.(null))
    expect(screen.getByText(/打开文件夹后，这里会列出/)).toBeInTheDocument()
  })

  it('侧栏分隔条支持键盘与双击调整宽度并记住', async () => {
    localStorage.setItem('inkdown-sidebar-width', '300')
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    await userEvent.click(screen.getByRole('button', { name: '展开侧栏' }))
    const workspace = document.querySelector<HTMLElement>('.workspace')!
    const resizer = screen.getByRole('separator', { name: '调整侧栏宽度' })
    expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('300px')
    fireEvent.keyDown(resizer, { key: 'ArrowRight' })
    expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('316px')
    expect(localStorage.getItem('inkdown-sidebar-width')).toBe('316')
    fireEvent.keyDown(resizer, { key: 'Home' })
    expect(resizer).toHaveAttribute('aria-valuenow', '180')
    fireEvent.doubleClick(resizer)
    expect(workspace.style.getPropertyValue('--sidebar-width')).toBe('260px')
    expect(localStorage.getItem('inkdown-sidebar-width')).toBe('260')
  })

  it('意见反馈：校验、提交到 GitHub 并显示结果', async () => {
    let showListener: (() => void) | undefined
    vi.mocked(window.inkdown.feedback.onShow).mockImplementation((listener) => {
      showListener = listener
      return () => undefined
    })
    render(<App />)
    await screen.findByRole('heading', { name: '初始文稿' })
    act(() => showListener?.())
    const dialog = screen.getByRole('dialog', { name: '意见反馈' })
    await userEvent.click(within(dialog).getByRole('button', { name: /提交到 GitHub/ }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('标题需为')
    expect(window.inkdown.feedback.submit).not.toHaveBeenCalled()

    await userEvent.selectOptions(within(dialog).getByLabelText('涉及功能'), 'table')
    await userEvent.type(within(dialog).getByLabelText(/^标题/), '表格长代码覆盖文字')
    await userEvent.type(within(dialog).getByLabelText(/^详细描述/), '单元格里的行内代码重叠到右侧')
    expect(within(dialog).getByText('排版/样式')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByLabelText(/附带应用版本/))
    await userEvent.click(within(dialog).getByRole('button', { name: /提交到 GitHub/ }))
    await waitFor(() => expect(window.inkdown.feedback.submit).toHaveBeenCalledWith({
      type: 'bug', area: 'table', title: '表格长代码覆盖文字', details: '单元格里的行内代码重叠到右侧',
      contact: '', includeEnvironment: false,
    }, 'github'))
    expect(await within(dialog).findByText('感谢你的反馈！')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '打开反馈记录' }))
    expect(window.inkdown.feedback.openFolder).toHaveBeenCalledOnce()
    await userEvent.click(within(dialog).getByRole('button', { name: '完成' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '意见反馈' }))
    expect(screen.getByRole('dialog', { name: '意见反馈' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
