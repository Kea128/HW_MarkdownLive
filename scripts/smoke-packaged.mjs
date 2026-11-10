import { _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const executablePath = path.resolve(process.argv[2] ?? path.join(
  root,
  'release-build',
  'win-unpacked',
  'Inkdown.exe',
))

const { version, build } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const { owner, repo } = build.publish.find(({ provider }) => provider === 'github')
const updateConfig = await readFile(path.join(path.dirname(executablePath), 'resources', 'app-update.yml'), 'utf8')
if (!['provider: github', `owner: ${owner}`, `repo: ${repo}`].every((line) => updateConfig.includes(line))) {
  throw new Error(`打包版在线更新配置无效: ${updateConfig}`)
}

const profile = await mkdtemp(path.join(tmpdir(), 'inkdown-packaged-smoke-'))
const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${profile}`],
  env: { ...process.env, INKDOWN_E2E: '1' },
  timeout: 90_000,
})

try {
  const page = await app.firstWindow({ timeout: 60_000 })
  const policyViolations = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text())) {
      policyViolations.push(message.text().slice(0, 200))
    }
  })
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: '源码模式' }).click()
  const editor = page.getByRole('textbox', { name: 'Markdown 源码' })
  await editor.waitFor({ state: 'visible' })
  await editor.fill('# 打包版验证\n\n行内 $E=mc^2$\n\n$$\n\\frac{a_1}{b^2}\n$$\n\n```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```')
  await page.getByRole('button', { name: '所见即所得模式' }).click()
  await page.locator('.katex').first().waitFor({ state: 'visible' })
  await page.locator('.mermaid-diagram .mermaid-light svg').waitFor({ state: 'visible', timeout: 60_000 })
  await page.getByRole('button', { name: '切换明暗主题' }).click()
  const result = await page.evaluate(async () => ({
    katex: document.querySelectorAll('.katex').length,
    display: document.querySelectorAll('.katex-display').length,
    fontLoaded: (await document.fonts.load('16px KaTeX_Main')).length > 0,
    theme: document.documentElement.dataset.theme,
    css: getComputedStyle(document.querySelector('.katex')).fontFamily,
    mermaidSvgs: document.querySelectorAll('.mermaid-diagram svg').length,
    mermaidText: document.querySelector('.mermaid-dark svg')?.textContent ?? '',
  }))
  if (result.katex !== 2 || result.display !== 1 || !result.fontLoaded || !result.css.includes('KaTeX')) {
    throw new Error(`打包版公式资源验证失败: ${JSON.stringify(result)}`)
  }
  if (result.mermaidSvgs !== 2 || !result.mermaidText.includes('开始')) {
    throw new Error(`打包版 Mermaid 渲染验证失败: ${JSON.stringify(result)}`)
  }
  if (policyViolations.length) throw new Error(`打包版违反内容安全策略: ${policyViolations.join(' | ')}`)
  const helpMenu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items
    .find((item) => item.label.includes('帮助'))?.submenu?.items.map((item) => item.label) ?? [])
  if (!helpMenu.includes('检查更新…')) throw new Error(`打包版缺少检查更新菜单: ${JSON.stringify(helpMenu)}`)
  const updater = await app.evaluate(() => {
    const loadedAtStartup = Object.keys(process.mainModule.constructor._cache)
      .some((file) => file.includes('electron-updater'))
    const { autoUpdater, CancellationToken } = process.mainModule.require('electron-updater')
    return {
      loadedAtStartup,
      version: autoUpdater.currentVersion.version,
      cancellable: typeof CancellationToken === 'function',
    }
  })
  if (updater.loadedAtStartup || updater.version !== version || !updater.cancellable) {
    throw new Error(`打包版更新模块异常: ${JSON.stringify(updater)}`)
  }
  console.log(JSON.stringify({
    executablePath, ...result, mermaidText: undefined, updateFeed: `github:${owner}/${repo}`, helpMenu, updater,
  }))
} finally {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
