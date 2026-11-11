import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changelogSection } from './changelog.mjs'
import { resolveGitHubToken } from './github-token.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version, build } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { owner, repo } = build.publish.find(({ provider }) => provider === 'github')
const api = `/repos/${owner}/${repo}`
const tag = `v${version}`
const directory = join(root, 'releases', `Inkdown-v${version}-windows`)
const setup = `Inkdown-${version}-x64-setup.exe`
const portable = `Inkdown-${version}-x64-portable.exe`
const archive = `Inkdown-${version}-x64.zip`
// latest.yml goes last so update clients never see a feed whose installer is still uploading.
const assets = [setup, `${setup}.blockmap`, portable, archive, 'SHA256SUMS.txt', 'latest.yml']

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const read = (name) => readFileSync(join(directory, name))
const digest = (algorithm, data, encoding) => createHash(algorithm).update(data).digest(encoding)

function verifyArtifacts() {
  const sums = new Map(read('SHA256SUMS.txt').toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    const [, hash, name] = /^([\da-f]{64}) {2}(.+)$/.exec(line) ?? []
    return [name, hash]
  }))
  for (const name of assets.filter((asset) => asset !== 'SHA256SUMS.txt')) {
    if (digest('sha256', read(name), 'hex') !== sums.get(name)) throw new Error(`${name} 与 SHA256SUMS.txt 不一致`)
  }
  const feed = read('latest.yml').toString('utf8')
  const feedValue = (key) => new RegExp(`^${key}: (.+?)\\r?$`, 'm').exec(feed)?.[1]
  if (feedValue('version') !== version || feedValue('path') !== setup
    || feedValue('sha512') !== digest('sha512', read(setup), 'base64')) {
    throw new Error('latest.yml 与安装包不一致，客户端在线更新会校验失败')
  }
}

function releaseNotes() {
  return `${changelogSection(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version)}

## 下载

- \`${setup}\`：安装版（推荐），可通过“帮助 > 检查更新”在线升级
- \`${portable}\`：便携版，无需安装
- \`${archive}\`：ZIP 版，解压后运行 \`Inkdown.exe\`

本版本未进行 Windows 代码签名，SmartScreen 可能提示“未知发布者”；请使用 \`SHA256SUMS.txt\` 核对文件哈希。
`
}

const token = resolveGitHubToken()
if (!token) throw new Error('缺少 GitHub 凭据：请设置 GH_TOKEN，或先通过 git 登录 github.com')

async function github(method, url, { body, headers = {}, allowMissing = false } = {}) {
  const response = await fetch(new URL(url, 'https://api.github.com'), {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'inkdown-release',
      'x-github-api-version': '2022-11-28',
      ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body,
  })
  if (allowMissing && response.status === 404) return null
  if (!response.ok) throw new Error(`${method} ${url} 失败：HTTP ${response.status} ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

if (git('status', '--porcelain')) throw new Error('工作区存在未提交的修改，请先提交发布内容')
verifyArtifacts()

const head = git('rev-parse', 'HEAD')
const ref = await github('GET', `${api}/git/ref/tags/${tag}`, { allowMissing: true })
if (!ref) throw new Error(`远端缺少标签 ${tag}，请先执行 git push origin ${tag}`)
const tagged = ref.object.type === 'tag'
  ? (await github('GET', `${api}/git/tags/${ref.object.sha}`)).object.sha
  : ref.object.sha
if (tagged !== head) throw new Error(`远端标签 ${tag} 指向 ${tagged.slice(0, 7)}，与当前提交 ${head.slice(0, 7)} 不一致`)

const details = { name: `Inkdown ${version}`, body: releaseNotes() }
// GitHub lists drafts as "untagged-…", so an interrupted run is resumed by matching the draft's name.
const existing = (await github('GET', `${api}/releases?per_page=100`))
  .find((entry) => entry.tag_name === tag || (entry.draft && entry.name === details.name))
let release = existing
  ? await github('PATCH', `${api}/releases/${existing.id}`, { body: JSON.stringify(details) })
  : await github('POST', `${api}/releases`, { body: JSON.stringify({ ...details, tag_name: tag, draft: true }) })

async function removeAsset(name) {
  const current = (await github('GET', `${api}/releases/${release.id}`)).assets.find((asset) => asset.name === name)
  if (current) await github('DELETE', `${api}/releases/assets/${current.id}`)
}

async function upload(name, data) {
  const target = new URL(release.upload_url.replace(/\{.*\}$/, ''))
  target.searchParams.set('name', name)
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await github('POST', target.href, { body: data, headers: { 'content-type': 'application/octet-stream' } })
    } catch (error) {
      if (!(error instanceof TypeError) || attempt === 3) throw error
      console.log(`上传 ${name} 时网络中断（${error.cause?.code ?? error.message}），重试第 ${attempt} 次…`)
      await removeAsset(name)
    }
  }
}

for (const name of assets) {
  const data = read(name)
  const uploaded = release.assets.find((asset) => asset.name === name)
  if (uploaded?.state === 'uploaded' && uploaded.digest === `sha256:${digest('sha256', data, 'hex')}`) {
    console.log(`跳过 ${name}（已存在）`)
    continue
  }
  if (uploaded) await removeAsset(name)
  await upload(name, data)
  console.log(`已上传 ${name}（${(data.length / 1024 / 1024).toFixed(1)} MB）`)
}

if (release.draft) {
  release = await github('PATCH', `${api}/releases/${release.id}`, {
    body: JSON.stringify({ tag_name: tag, draft: false, make_latest: 'true' }),
  })
}
console.log(`已发布 ${release.html_url}`)
