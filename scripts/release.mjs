import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version, build } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { owner, repo } = build.publish.find(({ provider }) => provider === 'github')
const releasesUrl = `https://github.com/${owner}/${repo}/releases`
const releaseRoot = join(root, 'releases')
const output = join(releaseRoot, `Inkdown-v${version}-windows`)
const buildOutput = join(root, 'release-build')
const setup = `Inkdown-${version}-x64-setup.exe`

mkdirSync(releaseRoot, { recursive: true })
const artifacts = readdirSync(buildOutput)
  .filter((name) => name.startsWith(`Inkdown-${version}-`) && /\.(?:exe|zip|blockmap)$/i.test(name))
  .sort()
if (!artifacts.includes(setup)) throw new Error('未找到 Windows 安装包')
const updateFeed = readFileSync(join(buildOutput, 'latest.yml'), 'utf8')
const feedValue = (key) => new RegExp(`^${key}: (.+?)\\r?$`, 'm').exec(updateFeed)?.[1]
if (feedValue('version') !== version || feedValue('path') !== setup) {
  throw new Error('latest.yml 与当前安装包不一致')
}
artifacts.push('latest.yml')

for (const entry of readdirSync(releaseRoot)) {
  if (entry !== basename(output) && /^Inkdown-v.+-(?:windows|web)$/i.test(entry)) {
    rmSync(join(releaseRoot, entry), { recursive: true, force: true })
  }
}
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

for (const artifact of artifacts) cpSync(join(buildOutput, artifact), join(output, artifact))
for (const entry of readdirSync(buildOutput)) {
  if (/^Inkdown-\d+\.\d+\.\d+-.*\.(?:exe|zip|blockmap)$/i.test(entry) && !artifacts.includes(entry)) {
    rmSync(join(buildOutput, entry), { force: true })
  }
}

writeFileSync(join(output, '安装与运行说明.md'), `# Inkdown v${version} Windows 版

Inkdown 是本地 Markdown 实时编辑器，不需要 Web 服务器或浏览器。

## 安装与运行

- 安装版：运行名称含 \`setup\` 的 EXE，按向导安装。
- 便携版：运行名称含 \`portable\` 的 EXE，无需安装。
- ZIP：解压后运行其中的 \`Inkdown.exe\`。
- 支持 Windows x64；可直接打开、编辑和覆盖保存 \`.md\`、\`.markdown\`、\`.txt\`。

## 在线更新

- 安装版：通过“帮助 > 检查更新”获取 GitHub 上的最新正式版本；确认后自动下载并校验 SHA-512，
  重启即可完成升级，也可以选择在退出 Inkdown 时自动安装。
- 便携版与 ZIP：检查到新版本时会打开发布页面，请下载后手动替换。
- 更新源：${releasesUrl}
- 仅在手动检查更新时访问网络；网络受限时请确认系统代理可以访问 GitHub。

## 数学公式

- 行内公式：\`$E = mc^2$\`
- 块级公式：使用独占行的 \`$$\` 包围 LaTeX。
- 导入文档时也兼容 \`\\(...\\)\` 行内公式和 \`\\[...\\]\` 块级公式。
- 支持分数、上下标、矩阵、求和与希腊字母等常见语法；非法公式保留源码且不影响其他预览。

## 安全提示

本次构建未配置 Windows 代码签名证书，因此 SmartScreen 可能显示“未知发布者”。请先用同目录
\`SHA256SUMS.txt\` 核对文件哈希。应用不加载远程页面，外链只通过系统默认浏览器打开。

本项目仅参考 Typora 公开可见的低干扰写作理念；未下载、复制或逆向其私有源码和品牌资产。
`, 'utf8')

writeFileSync(join(output, 'CHANGELOG.md'), readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), 'utf8')

const checksums = [...artifacts, '安装与运行说明.md', 'CHANGELOG.md'].map((name) => {
  const digest = createHash('sha256').update(readFileSync(join(output, name))).digest('hex')
  return `${digest}  ${name}`
})
writeFileSync(join(output, 'SHA256SUMS.txt'), `${checksums.join('\n')}\n`, 'utf8')
writeFileSync(join(releaseRoot, 'SHA256SUMS.txt'), `${checksums.map((line) =>
  line.replace('  ', `  ${basename(output)}/`)).join('\n')}\n`, 'utf8')

console.log(`Windows release: ${output}`)
console.log(checksums.join('\n'))
