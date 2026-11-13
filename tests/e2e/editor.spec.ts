import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { _electron as electron, expect, test } from '@playwright/test'

const localElectron = path.resolve(
  'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)

function png(width: number, height: number, color: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const frame = Buffer.alloc(8 + data.length + 4)
    frame.writeUInt32BE(data.length, 0)
    body.copy(frame, 4)
    frame.writeUInt32BE(crc32(body), 8 + data.length)
    return frame
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.from([0, ...Array.from({ length: width }, () => color).flat()])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('真实桌面进程完成打开、编辑、预览、菜单快捷键与覆盖保存', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-'))
  const filePath = path.join(directory, '中文测试.md')
  const sample = [
    '# Inkdown 写作样例',
    '',
    '安静、清晰的正文，包含 **强调**、[安全链接](https://example.com) 与行内公式 $E=mc^2$。',
    '',
    '## 数学',
    '',
    '$$',
    '% @eq total',
    '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
    '$$',
    '',
    '求和结果见[式 @total](#eq-total)。',
    '',
    '远处矩阵见[式 @matrix](#eq-matrix)。',
    '',
    '公式之间保留足够正文，用于验证未进入视口的编号公式仍可直接导航。',
    '',
    '第一段说明用于模拟较长技术文档。',
    '',
    '第二段说明用于模拟较长技术文档。',
    '',
    '第三段说明用于模拟较长技术文档。',
    '',
    '第四段说明用于模拟较长技术文档。',
    '',
    '第五段说明用于模拟较长技术文档。',
    '',
    '第六段说明用于模拟较长技术文档。',
    '',
    '$$',
    '% @eq matrix',
    '\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}',
    '$$',
    '',
    '$$',
    '\\begin{bmatrix} \\frac{a_1}{U} & \\frac{b_1}{U} & \\frac{c_1}{U} & \\frac{d_1}{U} & \\frac{e_1}{U} & \\frac{f_1}{U} \\end{bmatrix}\\tag{K18}',
    '$$',
    '',
    '> 内容优先的引用排版。',
    '',
    '- [x] 桌面测试',
    '- [ ] 明暗主题',
    '',
    '| 能力 | 状态 |',
    '| --- | --- |',
    '| KaTeX | 正常 |',
    '',
    '```ts',
    'const desktop = true',
    '```',
  ].join('\n')
  await writeFile(filePath, `\uFEFF${sample}`, 'utf8')
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${path.join(directory, 'profile')}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((target) => window.inkdown.document.openPath(target), filePath)
    const visualEditor = page.getByRole('textbox', { name: 'Markdown 所见即所得编辑器' })
    await expect(visualEditor).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Inkdown 写作样例' })).toBeVisible()
    await expect(page.locator('.milkdown-list-item-block .checked')).toHaveCount(1)
    await expect(visualEditor.locator('code').filter({ hasText: 'desktop' })).toContainText('desktop')
    const proseParagraph = visualEditor.locator('p').filter({ hasText: '安静、清晰的正文' })
    const spacing = () => proseParagraph.evaluate((element) => {
      const style = getComputedStyle(element)
      return { lineHeight: Number.parseFloat(style.lineHeight), gap: Number.parseFloat(style.marginBottom) }
    })
    await page.getByLabel('行间距').selectOption('compact')
    const compact = await spacing()
    await page.getByLabel('行间距').selectOption('standard')
    const standard = await spacing()
    await page.getByLabel('行间距').selectOption('relaxed')
    const relaxed = await spacing()
    expect(standard.lineHeight).toBeGreaterThan(compact.lineHeight + 4)
    expect(relaxed.lineHeight).toBeGreaterThan(standard.lineHeight + 4)
    expect(standard.gap).toBeGreaterThan(compact.gap + 5)
    expect(relaxed.gap).toBeGreaterThan(standard.gap + 5)
    await page.getByLabel('行间距').selectOption('standard')
    await expect(page.locator('#eq-total .katex-display .katex')).not.toBeEmpty()
    await expect(page.locator('.katex math').first()).toBeAttached()
    const numberedEquation = page.locator('#eq-total.numbered-equation')
    const distantEquation = page.locator('#eq-matrix.numbered-equation')
    await expect(numberedEquation).toBeVisible()
    await expect(numberedEquation).toHaveAttribute('data-equation-tag', '(1)')
    await expect(numberedEquation.locator('.katex-tag')).toBeHidden()
    const equationBox = await numberedEquation.boundingBox()
    const displayBox = await numberedEquation.locator('.katex-display').boundingBox()
    const formulaBox = await numberedEquation.locator('.katex-html').evaluate((html) => {
      const boxes = Array.from(html.children)
        .filter((child) => !child.classList.contains('katex-tag'))
        .map((child) => child.getBoundingClientRect())
      const left = Math.min(...boxes.map(({ left }) => left))
      const right = Math.max(...boxes.map(({ right }) => right))
      return { x: left, width: right - left }
    })
    expect(equationBox).not.toBeNull()
    expect(displayBox).not.toBeNull()
    expect(equationBox!.x + equationBox!.width - displayBox!.x - displayBox!.width)
      .toBeGreaterThanOrEqual(50)
    expect(Math.abs(
      formulaBox.x + formulaBox.width / 2 - (equationBox!.x + equationBox!.width / 2),
    )).toBeLessThanOrEqual(3)
    await expect(distantEquation).toBeAttached()
    const equationReference = page.getByRole('link', { name: '式 (1)' })
    await expect(equationReference).toBeVisible()
    await equationReference.click()
    await expect(numberedEquation).toHaveClass(/equation-target/)
    await page.getByRole('link', { name: '式 (2)' }).click()
    await expect(distantEquation).toBeVisible()
    await expect(distantEquation).toHaveClass(/equation-target/)
    await expect(distantEquation.locator('.katex-display .katex')).not.toBeEmpty()
    const manualEquation = page.locator('.tagged-equation[data-equation-tag="(K18)"]')
    await manualEquation.scrollIntoViewIfNeeded()
    await expect(manualEquation).toBeVisible()
    await expect(manualEquation.locator('.katex-tag')).toBeHidden()
    const manualEquationBox = await manualEquation.boundingBox()
    const manualDisplayBox = await manualEquation.locator('.katex-display').boundingBox()
    expect(manualEquationBox).not.toBeNull()
    expect(manualDisplayBox).not.toBeNull()
    expect(manualEquationBox!.x + manualEquationBox!.width
      - manualDisplayBox!.x - manualDisplayBox!.width).toBeGreaterThanOrEqual(50)
    const katexAssets = await page.evaluate(async () => ({
      fontLoaded: await document.fonts.load('16px KaTeX_Main').then((fonts) => fonts.length > 0),
      fontFamily: getComputedStyle(document.querySelector('.katex')!).fontFamily,
      displayOverflow: getComputedStyle(document.querySelector('.katex-display')!).overflowX,
    }))
    expect(katexAssets.fontLoaded).toBe(true)
    expect(katexAssets.fontFamily).toContain('KaTeX')
    expect(['auto', 'visible']).toContain(katexAssets.displayOverflow)

    await visualEditor.locator('p').filter({ hasText: '第六段说明' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' 已直接编辑')
    await expect(visualEditor).toContainText('已直接编辑')
    await expect(page.getByLabel('未保存')).toBeVisible()

    await page.keyboard.press('Control+/')
    const editor = page.getByRole('textbox', { name: 'Markdown 源码' })
    await expect(editor).toBeVisible()
    await expect(editor).toHaveValue(/已直接编辑/)
    await page.keyboard.press('Control+/')
    await expect(visualEditor).toBeVisible()
    await expect(page.locator('#eq-total .katex')).not.toBeEmpty()

    const screenshotDirectory = path.resolve('docs', 'screenshots')
    await mkdir(screenshotDirectory, { recursive: true })
    await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((item) => item.label.includes('视图'))
      const themes = view?.submenu?.items.find((item) => item.label === '主题')
      const light = themes?.submenu?.items.find((item) => item.label === '浅色')
      light?.click?.(light, undefined, {} as Electron.KeyboardEvent)
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.evaluate(() => {
      const visual = document.querySelector('.visual-pane')
      if (visual) visual.scrollTop = 0
    })
    await page.screenshot({
      path: path.join(screenshotDirectory, 'inkdown-latest-light.png'),
      timeout: 30_000,
    })
    await page.getByRole('button', { name: '切换明暗主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({
      path: path.join(screenshotDirectory, 'inkdown-latest-dark.png'),
      timeout: 30_000,
    })

    await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((item) => item.label.includes('视图'))
      const toggle = view?.submenu?.items.find((item) => item.label === '切换源码')
      toggle?.click?.(toggle, undefined, {} as Electron.KeyboardEvent)
    })
    await expect(editor).toBeVisible()
    await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((item) => item.label.includes('视图'))
      const toggle = view?.submenu?.items.find((item) => item.label === '切换源码')
      toggle?.click?.(toggle, undefined, {} as Electron.KeyboardEvent)
    })
    await expect(visualEditor).toBeVisible()

    await page.keyboard.press('Control+/')
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n即时保存内容')
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()?.items.find((item) => item.label.includes('文件'))
      const save = file?.submenu?.items.find((item) => item.label === '保存')
      save?.click?.(save, undefined, {} as Electron.KeyboardEvent)
    })
    await expect(page.getByLabel('未保存')).toHaveCount(0)
    expect(await readFile(filePath, 'utf8')).toContain('# Inkdown 写作样例')
    expect(await readFile(filePath, 'utf8')).toContain('即时保存内容')

    const security = await page.evaluate(() => ({
      hasRequire: typeof (globalThis as { require?: unknown }).require,
      hasProcess: typeof (globalThis as { process?: unknown }).process,
    }))
    expect(security).toEqual({ hasRequire: 'undefined', hasProcess: 'undefined' })
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('Mermaid 图表在排版视图中渲染、跟随主题并提示语法错误', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-mermaid-'))
  const filePath = path.join(directory, '图表.md')
  await writeFile(filePath, [
    '# 图表',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[开始] --> B{是否完成？}',
    '  B -- 是 --> C[发布]',
    '```',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  Alice->>Bob: 你好',
    '  Bob-->>Alice: 收到',
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '  A -->',
    '```',
  ].join('\n'), 'utf8')
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${path.join(directory, 'profile')}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  try {
    const page = await app.firstWindow()
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find((item) => item.label.includes('视图'))
      const light = view?.submenu?.items.find((item) => item.label === '主题')
        ?.submenu?.items.find((item) => item.label === '浅色')
      light?.click?.(light, undefined, {} as Electron.KeyboardEvent)
    })
    await page.evaluate((target) => window.inkdown.document.openPath(target), filePath)

    const diagrams = page.locator('.mermaid-diagram')
    await expect(diagrams).toHaveCount(2, { timeout: 30_000 })
    const flowchart = diagrams.first().locator('.mermaid-light svg')
    await expect(flowchart).toBeVisible()
    await expect(flowchart).toContainText('开始')
    await expect(diagrams.first().locator('.mermaid-dark svg')).toBeHidden()
    await expect(diagrams.nth(1).locator('.mermaid-light svg')).toContainText('你好')
    const size = await flowchart.boundingBox()
    expect(size!.width).toBeGreaterThan(150)
    expect(size!.height).toBeGreaterThan(30)
    await expect(page.locator('.mermaid-error')).toContainText('Mermaid 图表无法渲染')
    await expect(page.locator('.milkdown-code-block .preview-toggle-button').first()).toContainText('编辑')

    await page.getByRole('button', { name: '切换明暗主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(diagrams.first().locator('.mermaid-dark svg')).toBeVisible()
    await expect(flowchart).toBeHidden()
    expect(consoleErrors.filter((text) => /Content Security Policy|Refused to|EvalError/i.test(text))).toEqual([])
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('打开文件夹、拖动侧栏、表格长代码换行、源码铺满并提交意见反馈', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-folder-'))
  const folder = path.join(directory, '笔记')
  await mkdir(path.join(folder, '子目录'), { recursive: true })
  await writeFile(path.join(folder, '表格.md'), [
    '# 表格',
    '',
    '| 名称 | 说明 | 备注 |',
    '| --- | --- | --- |',
    '| `averyveryveryverylonginlinecodeidentifier_without_any_spaces_to_break_on` | '
      + '`很长很长的中文行内代码内容用于验证单元格内换行而不会覆盖旁边列的文字` | 普通文字 |',
    '| 普通 | `short` | 其他 |',
  ].join('\n'), 'utf8')
  await writeFile(path.join(folder, '子目录', '说明.md'), '# 说明\n\n子目录中的文档', 'utf8')
  await writeFile(path.join(folder, '忽略.txt'), '不是 Markdown', 'utf8')
  const profile = path.join(directory, 'profile')
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ dialog, shell }, target) => {
      const openedUrls: string[] = []
      Object.assign(globalThis, { openedUrls })
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog
      shell.openExternal = async (url: string) => { openedUrls.push(url) }
    }, folder)

    await page.getByRole('button', { name: '打开文件夹', exact: true }).click()
    const files = page.getByRole('navigation', { name: '文件夹中的 Markdown 文件' })
    await expect(files.getByRole('button', { name: '说明.md' })).toBeVisible()
    await expect(files.getByText('忽略.txt')).toHaveCount(0)
    await files.getByRole('button', { name: '表格.md' }).click()
    await expect(page.getByRole('heading', { name: '表格' })).toBeVisible()
    await expect(files.getByRole('button', { name: '表格.md' })).toHaveAttribute('aria-current', 'page')
    await page.waitForTimeout(600)
    await expect(page.getByLabel('未保存')).toHaveCount(0)
    await files.getByRole('button', { name: '说明.md' }).click()
    await expect(page.getByRole('heading', { name: '说明' })).toBeVisible()
    await files.getByRole('button', { name: '表格.md' }).click()
    await expect(page.getByRole('heading', { name: '表格' })).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page.getByLabel('未保存')).toHaveCount(0)

    const sidebar = page.locator('.sidebar')
    const before = (await sidebar.boundingBox())!.width
    const handle = (await page.getByRole('separator', { name: '调整侧栏宽度' }).boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 240)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 140, handle.y + 240, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(before + 120)
    expect(Number(await page.evaluate(() => localStorage.getItem('inkdown-sidebar-width')))).toBeGreaterThan(before + 120)

    const cells = await page.locator('.ProseMirror td').evaluateAll((elements) => elements.map((cell) => {
      const bounds = cell.getBoundingClientRect()
      return [...cell.querySelectorAll('code')].every((code) => {
        const box = code.getBoundingClientRect()
        return box.left >= bounds.left - 1 && box.right <= bounds.right + 1
      })
    }))
    expect(cells.length).toBeGreaterThanOrEqual(6)
    expect(cells.every(Boolean)).toBe(true)

    await page.keyboard.press('Control+/')
    const source = page.getByRole('textbox', { name: 'Markdown 源码' })
    await expect(source).toBeVisible()
    const sourceBox = (await source.boundingBox())!
    const paneBox = (await page.locator('.editor-pane').boundingBox())!
    expect(sourceBox.width).toBeGreaterThan(paneBox.width - 80)
    await page.keyboard.press('Control+/')

    await page.getByRole('button', { name: '意见反馈' }).click()
    const dialog = page.getByRole('dialog', { name: '意见反馈' })
    await dialog.getByLabel('涉及功能').selectOption('table')
    await dialog.getByLabel(/^标题/).fill('表格长代码覆盖文字')
    await dialog.getByLabel(/^详细描述/).fill('单元格里的行内代码重叠到右侧单元格')
    await expect(dialog.locator('.feedback-tags')).toContainText('排版/样式')
    await dialog.getByRole('button', { name: /提交到 GitHub/ }).click()
    await expect(dialog.getByText('感谢你的反馈！')).toBeVisible()
    const urls = await app.evaluate(() => (globalThis as { openedUrls?: string[] }).openedUrls ?? [])
    expect(urls).toHaveLength(1)
    const issue = new URL(urls[0])
    expect(issue.origin + issue.pathname).toBe('https://github.com/Kea128/HW_MarkdownLive/issues/new')
    expect(issue.searchParams.get('area')).toBe('表格')
    expect(issue.searchParams.get('environment')).toContain('Electron')
    const stored = (await readFile(path.join(profile, 'feedback', 'feedback.jsonl'), 'utf8')).trim().split('\n')
    expect(stored).toHaveLength(1)
    expect(JSON.parse(stored[0])).toMatchObject({
      schema: 1, channel: 'github', type: 'bug', area: 'table', tags: ['layout', 'table'],
    })
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('Typora 文档的本地图片与缩放图片正常显示，编辑后保留图片说明', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-images-'))
  const folder = path.join(directory, '笔记')
  await mkdir(path.join(folder, 'assets'), { recursive: true })
  await mkdir(path.join(directory, '外部'), { recursive: true })
  await writeFile(path.join(folder, 'assets', 'red.png'), png(40, 20, [220, 40, 40]))
  await writeFile(path.join(folder, 'assets', 'my image.png'), png(30, 30, [40, 160, 60]))
  await writeFile(path.join(folder, 'assets', 'zoom.png'), png(200, 100, [40, 90, 220]))
  const absolute = path.join(directory, '外部', 'blue.png')
  await writeFile(absolute, png(50, 25, [30, 30, 200]))
  const filePath = path.join(folder, '图片.md')
  await writeFile(filePath, [
    '# 图片',
    '',
    '![相对路径](assets/red.png)',
    '',
    `![绝对路径](<${absolute}>)`,
    '',
    '文字中的 ![行内](assets/red.png) 图片。',
    '',
    '<img src="assets/zoom.png" alt="缩放" style="zoom:50%;" />',
    '',
    '![空格](<assets/my image.png>)',
    '',
    '![编码](assets/my%20image.png)',
  ].join('\n'), 'utf8')
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${path.join(directory, 'profile')}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  try {
    const page = await app.firstWindow()
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((target) => window.inkdown.document.openPath(target), filePath)
    await expect(page.getByRole('heading', { name: '图片' })).toBeVisible()
    const images = page.locator('.ProseMirror img:not(.ProseMirror-separator)')
    await expect(images).toHaveCount(6)
    await expect.poll(() => images.evaluateAll((elements) => elements.map((image) => (image as HTMLImageElement).naturalWidth)))
      .toEqual([40, 50, 40, 200, 30, 30])
    await expect(images.nth(0)).toHaveAttribute('alt', '相对路径')
    const zoomed = page.locator('.inkdown-image img[alt="缩放"]')
    await expect(zoomed).toHaveCount(1)
    await expect(zoomed).toHaveCSS('zoom', '0.5')
    await expect(page.locator('.ProseMirror')).not.toContainText('<img')
    await page.waitForTimeout(600)
    await expect(page.getByLabel('未保存')).toHaveCount(0)

    await page.locator('.ProseMirror p').filter({ hasText: '文字中的' }).click({ position: { x: 4, y: 8 } })
    await page.keyboard.press('End')
    await page.keyboard.type('已编辑')
    await expect(page.getByLabel('未保存')).toBeVisible()
    await page.keyboard.press('Control+/')
    const source = page.getByRole('textbox', { name: 'Markdown 源码' })
    await expect(source).toHaveValue(/已编辑/)
    const markdown = await source.inputValue()
    expect(markdown).toContain('![相对路径](assets/red.png)')
    expect(markdown).toContain('![行内](assets/red.png)')
    expect(markdown).toContain('![空格](<assets/my image.png>)')
    expect(markdown).toContain('<img src="assets/zoom.png" alt="缩放" style="zoom:50%;" />')
    expect(markdown).not.toContain('![1.00]')
    expect(consoleErrors.filter((text) => /Content Security Policy|Refused to|ERR_/i.test(text))).toEqual([])
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('Ctrl+V 粘贴截图保存到文档同名 .assets 文件夹，未保存文档首次保存时移入', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-paste-'))
  const folder = path.join(directory, '笔记')
  await mkdir(folder, { recursive: true })
  const filePath = path.join(folder, '周报.md')
  await writeFile(filePath, '# 周报\n\n本周进展', 'utf8')
  const profile = path.join(directory, 'profile')
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  const paste = (image: Buffer, html?: string) => app.evaluate(({ BrowserWindow, clipboard, nativeImage }, data) => {
    const bitmap = nativeImage.createFromBuffer(Buffer.from(data.image, 'base64'))
    if (data.html) clipboard.write({ html: data.html, text: '来自 Word 的文字', image: bitmap })
    else clipboard.writeImage(bitmap)
    BrowserWindow.getAllWindows()[0].webContents.paste()
  }, { image: image.toString('base64'), html })
  const timestamped = /^image-\d{17}(?:-\d+)?\.png$/
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((target) => window.inkdown.document.openPath(target), filePath)
    await page.locator('.ProseMirror p').filter({ hasText: '本周进展' }).click()
    await page.keyboard.press('End')
    await paste(png(64, 32, [200, 60, 60]))
    const images = page.locator('.ProseMirror img:not(.ProseMirror-separator)')
    await expect(images).toHaveCount(1)
    await expect.poll(() => images.first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(64)
    await expect(page.locator('.status-messages')).toContainText('图片已保存到 周报.assets/image-')
    const assets = path.join(folder, '周报.assets')
    expect((await readdir(assets)).filter((name) => timestamped.test(name))).toHaveLength(1)

    await paste(png(30, 30, [0, 0, 0]), '<p>来自 Word 的文字</p>')
    await expect(page.locator('.ProseMirror')).toContainText('来自 Word 的文字')
    await expect(images).toHaveCount(1)

    await page.getByTitle('保存 (Ctrl+S)').click()
    await expect(page.getByLabel('未保存')).toHaveCount(0)
    expect(await readFile(filePath, 'utf8')).toMatch(/本周进展!\[image-\d{17}\]\(周报\.assets\/image-\d{17}\.png\)/)

    await page.keyboard.press('Control+/')
    const source = page.getByRole('textbox', { name: 'Markdown 源码' })
    await source.click()
    await page.keyboard.press('Control+End')
    await paste(png(48, 24, [60, 60, 200]))
    await expect(source).toHaveValue(/!\[image-\d{17}(?:-\d+)?\]\(周报\.assets\/image-\d{17}(?:-\d+)?\.png\)$/)
    expect((await source.inputValue()).match(/周报\.assets\//g)).toHaveLength(2)
    expect((await readdir(assets)).filter((name) => timestamped.test(name))).toHaveLength(2)
    await page.keyboard.press('Control+/')
    await page.getByTitle('保存 (Ctrl+S)').click()
    await expect(page.getByLabel('未保存')).toHaveCount(0)

    await page.getByTitle('新建 (Ctrl+N)').click()
    await expect(page.locator('.title-area')).toContainText('未命名')
    await page.locator('.ProseMirror').click()
    await paste(png(40, 40, [60, 160, 60]))
    await expect(page.locator('.status-messages')).toContainText('图片已暂存')
    await expect.poll(() => images.first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(40)
    const staging = path.join(profile, 'pasted-images')
    expect(await readdir(staging)).toHaveLength(1)

    const newPath = path.join(folder, '新文档.md')
    await app.evaluate(({ dialog }, target) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
    }, newPath)
    await page.getByTitle('保存 (Ctrl+S)').click()
    await expect.poll(() => readFile(newPath, 'utf8').catch(() => ''))
      .toMatch(/^!\[image-\d{17}\]\(新文档\.assets\/image-\d{17}\.png\)\n?$/)
    expect(await readdir(path.join(folder, '新文档.assets'))).toHaveLength(1)
    expect(await readdir(staging)).toEqual([])
    await expect(page.locator('.title-area')).toContainText('新文档.md')
    await expect.poll(() => images.first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(40)
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('图片可对齐、拖动调整大小和修改说明；块手柄即时跟随；保留 CRLF 与 <br>', async () => {
  test.setTimeout(90_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-image-edit-'))
  const folder = path.join(directory, '笔记')
  await mkdir(path.join(folder, '周报.assets'), { recursive: true })
  await writeFile(path.join(folder, '周报.assets', 'chart.png'), png(640, 300, [60, 120, 200]))
  const extra = path.join(directory, '素材.png')
  await writeFile(extra, png(80, 40, [200, 120, 60]))
  const filePath = path.join(folder, '周报.md')
  await writeFile(filePath, [
    '# 周报', '', '第一段正文。', '', '第二段正文。', '', '段落一<br>段落二', '',
    '![chart](周报.assets/chart.png)', '', '| 列一 | 列二 |', '| --- | --- |', '| 第一行<br>换行 | 值 |', '',
  ].join('\r\n'), 'utf8')
  const profile = path.join(directory, 'profile')
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${profile}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((target) => window.inkdown.document.openPath(target), filePath)
    await expect(page.getByRole('heading', { name: '周报' })).toBeVisible()
    await expect(page.locator('.ProseMirror td .html-break br')).toHaveCount(1)
    await expect(page.locator('.ProseMirror > p .html-break br')).toHaveCount(1)
    await page.waitForTimeout(500)
    await expect(page.getByLabel('未保存')).toHaveCount(0)

    const paragraphs = page.locator('.ProseMirror > p')
    const first = (await paragraphs.nth(0).boundingBox())!
    const second = (await paragraphs.nth(1).boundingBox())!
    await page.mouse.move(first.x + 40, first.y + first.height / 2)
    await page.waitForTimeout(300)
    const started = Date.now()
    await page.mouse.move(second.x + 40, second.y + second.height / 2, { steps: 3 })
    await page.waitForFunction((target) => {
      const handle = document.querySelector<HTMLElement>('.milkdown-block-handle')
      const box = handle?.getBoundingClientRect()
      return handle?.dataset.show === 'true' && box !== undefined && Math.abs(box.top + box.height / 2 - target) < 20
    }, second.y + second.height / 2, { polling: 'raf' })
    expect(Date.now() - started).toBeLessThan(160)
    expect(await page.locator('.milkdown-block-handle').evaluate((handle) => getComputedStyle(handle).transitionProperty))
      .toBe('opacity')
    await paragraphs.nth(0).click()
    await page.mouse.move(2, 2)
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.milkdown-block-handle')).toHaveAttribute('data-show', 'true')

    const image = () => page.locator('.inkdown-image').first()
    await image().locator('img').click()
    await expect(image().getByRole('toolbar', { name: '图片操作' })).toBeVisible()
    await image().getByRole('button', { name: '居中' }).click()
    await image().getByRole('button', { name: '图片大小' }).click()
    await image().getByRole('menuitemradio', { name: '宽度 50%' }).click()
    await expect(image()).toHaveAttribute('data-align', 'center')
    const before = (await image().locator('.inkdown-image-frame').boundingBox())!.width
    const handle = (await image().locator('.image-handle[data-side="right"]').boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 50, handle.y + handle.height / 2, { steps: 5 })
    await expect(image().locator('.image-size')).toContainText('×')
    await page.mouse.up()
    await expect.poll(async () => (await image().locator('.inkdown-image-frame').boundingBox())!.width)
      .toBeGreaterThan(before + 80)
    await image().locator('img').click()
    await image().getByRole('button', { name: '图片说明' }).click()
    await page.keyboard.press('Control+A')
    await page.keyboard.type('季度趋势图')
    await page.keyboard.press('Enter')
    await expect(image().locator('img')).toHaveAttribute('alt', '季度趋势图')

    await page.getByTitle('保存 (Ctrl+S)').click()
    await expect(page.getByLabel('未保存')).toHaveCount(0)
    const saved = await readFile(filePath, 'utf8')
    expect(saved).toMatch(/<p align="center"><img src="周报\.assets\/chart\.png" alt="季度趋势图" width="\d+" \/><\/p>/)
    expect(saved).toContain('段落一<br>段落二')
    expect(saved).toMatch(/第一行<br>换行/)
    expect(saved.split('\n').every((line, index, lines) => index === lines.length - 1 || line.endsWith('\r'))).toBe(true)

    await image().locator('img').click()
    await image().getByRole('button', { name: '图片大小' }).click()
    await image().getByRole('menuitemradio', { name: '原始大小' }).click()
    await image().getByRole('button', { name: '左对齐' }).click()
    await page.keyboard.press('Control+/')
    await expect(page.getByRole('textbox', { name: 'Markdown 源码' })).toHaveValue(/!\[季度趋势图\]\(周报\.assets\/chart\.png\)/)
    await page.keyboard.press('Control+/')

    await page.locator('.ProseMirror p').filter({ hasText: '第二段正文' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await expect(page.locator('.milkdown-slash-menu')).toContainText('一级标题')
    await expect(page.locator('.milkdown-slash-menu')).toContainText('图片')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Backspace')

    await page.getByRole('button', { name: '设置' }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await settings.getByRole('radio', { name: /自定义文件夹/ }).check()
    await settings.getByRole('textbox', { name: '自定义图片文件夹' }).fill('images/${filename}')
    await expect(settings.locator('.settings-preview')).toContainText('images/周报')
    await settings.getByRole('button', { name: '保存' }).click()
    await expect(settings).toHaveCount(0)
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog
    }, extra)
    await app.evaluate(({ Menu }) => {
      const edit = Menu.getApplicationMenu()?.items.find((item) => item.label.includes('编辑'))
      const insert = edit?.submenu?.items.find((item) => item.label === '插入图片…')
      insert?.click?.(insert, undefined, {} as Electron.KeyboardEvent)
    })
    await expect(page.locator('.status-messages')).toContainText('images/周报/素材.png')
    expect(await readdir(path.join(folder, 'images', '周报'))).toEqual(['素材.png'])
    await expect(page.locator('.inkdown-image img[alt="素材"]')).toHaveCount(1)
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('编辑保存后保留 front matter、列表与分隔线写法', async () => {
  test.setTimeout(60_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-front-matter-'))
  const filePath = path.join(directory, '博客.md')
  await writeFile(filePath, [
    '---', 'title: 博客', 'tags: [写作, Markdown]', '---', '', '# 文章', '', '第一段。', '', '- 要点一', '- 要点二', '', '---', '',
    '结尾。', '',
  ].join('\n'), 'utf8')
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${path.join(directory, 'profile')}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate((target) => window.inkdown.document.openPath(target), filePath)
    await expect(page.getByRole('heading', { name: '文章' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /title: 博客/ })).toHaveCount(0)
    await expect(page.locator('.milkdown-code-block').first()).toContainText('title: 博客')
    await page.locator('.ProseMirror p').filter({ hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('已修改')
    await page.getByTitle('保存 (Ctrl+S)').click()
    await expect(page.getByLabel('未保存')).toHaveCount(0)
    const saved = await readFile(filePath, 'utf8')
    expect(saved.startsWith('---\ntitle: 博客\ntags: [写作, Markdown]\n---\n')).toBe(true)
    expect(saved).toContain('第一段。已修改')
    expect(saved).toContain('- 要点一\n- 要点二')
    expect(saved).toMatch(/\n---\n\n结尾。/)
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test('帮助菜单提供在线检查更新入口', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inkdown-e2e-update-'))
  const app = await electron.launch({
    executablePath: existsSync(localElectron) ? localElectron : undefined,
    args: ['.', `--user-data-dir=${path.join(directory, 'profile')}`],
    env: { ...process.env, INKDOWN_E2E: '1' },
  })
  try {
    await (await app.firstWindow()).waitForLoadState('domcontentloaded')
    const helpItems = await app.evaluate(({ dialog, Menu }) => {
      const messages: string[] = []
      Object.assign(globalThis, { updateDialogMessages: messages })
      dialog.showMessageBox = (async (...args: unknown[]) => {
        messages.push((args.at(-1) as Electron.MessageBoxOptions).message)
        return { response: 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
      const help = Menu.getApplicationMenu()?.items.find((item) => item.label.includes('帮助'))
      const check = help?.submenu?.items.find((item) => item.label === '检查更新…')
      check?.click?.(check, undefined, {} as Electron.KeyboardEvent)
      return help?.submenu?.items.map((item) => item.label) ?? []
    })
    expect(helpItems).toEqual(['检查更新…', '访问发布页面', '', '意见反馈…', '关于 Inkdown'])
    await expect.poll(() => app.evaluate(() =>
      (globalThis as { updateDialogMessages?: string[] }).updateDialogMessages)).toEqual(['开发版本不支持在线更新'])
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
