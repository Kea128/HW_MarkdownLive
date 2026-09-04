import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const executablePath = path.resolve(process.argv[2] ?? path.join(
  root,
  'release-build',
  'win-unpacked',
  'Inkdown.exe',
))

const profile = await mkdtemp(path.join(tmpdir(), 'inkdown-packaged-smoke-'))
const app = await electron.launch({
  executablePath,
  args: [`--user-data-dir=${profile}`],
  env: { ...process.env, INKDOWN_E2E: '1' },
  timeout: 90_000,
})

try {
  const page = await app.firstWindow({ timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: '源码模式' }).click()
  const editor = page.getByRole('textbox', { name: 'Markdown 源码' })
  await editor.waitFor({ state: 'visible' })
  await editor.fill('# 打包版验证\n\n行内 $E=mc^2$\n\n$$\n\\frac{a_1}{b^2}\n$$')
  await page.getByRole('button', { name: '所见即所得模式' }).click()
  await page.locator('.katex').first().waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '切换明暗主题' }).click()
  const result = await page.evaluate(async () => ({
    katex: document.querySelectorAll('.katex').length,
    display: document.querySelectorAll('.katex-display').length,
    fontLoaded: (await document.fonts.load('16px KaTeX_Main')).length > 0,
    theme: document.documentElement.dataset.theme,
    css: getComputedStyle(document.querySelector('.katex')).fontFamily,
  }))
  if (result.katex !== 2 || result.display !== 1 || !result.fontLoaded || !result.css.includes('KaTeX')) {
    throw new Error(`打包版公式资源验证失败: ${JSON.stringify(result)}`)
  }
  console.log(JSON.stringify({ executablePath, ...result }))
} finally {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
