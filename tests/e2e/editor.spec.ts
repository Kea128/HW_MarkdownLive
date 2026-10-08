import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const localElectron = path.resolve(
  'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)

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
    await page.getByLabel('行间距').selectOption('compact')
    const compactLineHeight = Number.parseFloat(await proseParagraph.evaluate(
      (element) => getComputedStyle(element).lineHeight,
    ))
    await page.getByLabel('行间距').selectOption('relaxed')
    const relaxedLineHeight = Number.parseFloat(await proseParagraph.evaluate(
      (element) => getComputedStyle(element).lineHeight,
    ))
    expect(relaxedLineHeight).toBeGreaterThan(compactLineHeight + 5)
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
    expect(helpItems).toEqual(['检查更新…', '访问发布页面', '', '关于 Inkdown'])
    await expect.poll(() => app.evaluate(() =>
      (globalThis as { updateDialogMessages?: string[] }).updateDialogMessages)).toEqual(['开发版本不支持在线更新'])
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
