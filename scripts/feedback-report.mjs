import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const taxonomyPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'feedback-taxonomy.json')
const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8'))
const DEFAULT_REPOSITORY = 'Kea128/HW_MarkdownLive'
const FORM_FIELDS = new Set(['反馈类型', '涉及功能', '详细描述', '自动标签', '运行环境', '反馈编号'])
const TYPE_WEIGHT = { bug: 3, performance: 2, ux: 2, feature: 1, other: 1 }
const SEVERE_TAGS = new Set(['crash', 'data-loss'])
const TYPE_COLORS = { bug: 'd73a4a', feature: 'a2eeef', ux: 'fbca04', performance: 'f9d0c4', other: 'ededed' }
const STOPWORDS = new Set([
  '一个', '一些', '这个', '那个', '这些', '可以', '能够', '希望', '觉得', '感觉', '时候', '没有', '什么', '怎么',
  '如何', '还是', '就是', '但是', '因为', '所以', '如果', '已经', '现在', '然后', '之后', '的话', '问题', '功能',
  '建议', '使用', '出现', '目前', '有点', '比较', '非常', 'inkdown', 'the', 'and', 'for', 'with', 'this', 'that',
])
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

const idByLabel = (options, label) => options.find((option) => option.label === label?.trim())?.id
const labelOf = (options, id) => options.find((option) => option.id === id)?.label ?? id
const tagLabel = (tag) => tag === 'general' ? '综合' : labelOf(taxonomy.tags, tag)
const tagOrder = (tags) => taxonomy.tags.map(({ id }) => id).filter((id) => tags.includes(id))
const escapeMarkdown = (text) => text.replace(/[[\]\\|*_`<>]/g, '\\$&')

export function keywordTags(text) {
  const normalized = text.toLowerCase()
  return taxonomy.tags
    .filter(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword.toLowerCase())))
    .map(({ id }) => id)
}

export function parseIssueBody(body = '') {
  const fields = {}
  let current = null
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading && FORM_FIELDS.has(heading[1])) {
      current = heading[1]
      fields[current] = []
    } else if (current) {
      fields[current].push(line)
    }
  }
  return Object.fromEntries(Object.entries(fields).map(([name, lines]) => {
    const value = lines.join('\n').trim()
    return [name, value === '_No response_' ? '' : value]
  }))
}

export function issueToRecord(issue) {
  const fields = parseIssueBody(issue.body ?? '')
  const title = String(issue.title ?? '').replace(/^\s*\[反馈\]\s*/, '').trim()
  const details = fields['详细描述'] ?? ''
  const declared = (fields['自动标签'] ?? '').split(/[、,，\s]+/).map((label) => idByLabel(taxonomy.tags, label))
  return {
    id: fields['反馈编号'] || `github-${issue.number}`,
    source: 'github',
    number: issue.number,
    url: issue.html_url,
    state: issue.state,
    createdAt: issue.created_at,
    type: idByLabel(taxonomy.types, fields['反馈类型']) ?? 'other',
    area: idByLabel(taxonomy.areas, fields['涉及功能']) ?? 'other',
    title,
    details,
    tags: tagOrder([...declared, ...keywordTags(`${title}\n${details}`)]),
    votes: issue.reactions?.['+1'] ?? 0,
  }
}

export function parseJsonl(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return []
    try {
      const record = JSON.parse(line)
      if (record?.schema !== 1 || typeof record.title !== 'string' || typeof record.details !== 'string') return []
      return [{
        id: String(record.id),
        source: 'local',
        createdAt: record.createdAt,
        type: taxonomy.types.some(({ id }) => id === record.type) ? record.type : 'other',
        area: taxonomy.areas.some(({ id }) => id === record.area) ? record.area : 'other',
        title: record.title,
        details: record.details,
        tags: tagOrder(Array.isArray(record.tags) ? record.tags : keywordTags(`${record.title}\n${record.details}`)),
        votes: 0,
      }]
    } catch {
      return []
    }
  })
}

export function labelsFor(record) {
  return ['feedback', `type:${record.type}`, `area:${record.area}`, ...record.tags.map((tag) => `tag:${tag}`)]
}

export function labelDefinitions() {
  return Object.fromEntries([
    ['feedback', { color: 'c5def5', description: '来自 Inkdown 意见反馈' }],
    ...taxonomy.types.map(({ id, label }) => [`type:${id}`, { color: TYPE_COLORS[id] ?? 'ededed', description: `反馈类型：${label}` }]),
    ...taxonomy.areas.map(({ id, label }) => [`area:${id}`, { color: '1d76db', description: `涉及功能：${label}` }]),
    ...taxonomy.tags.map(({ id, label }) => [`tag:${id}`, { color: 'bfdadc', description: `自动标签：${label}` }]),
  ])
}

function priority(records) {
  return records.reduce((score, record) => score
    + (TYPE_WEIGHT[record.type] ?? 1)
    + (record.tags.some((tag) => SEVERE_TAGS.has(tag)) ? 3 : 0)
    + (record.votes ?? 0), 0)
}

export function groupThemes(records) {
  const themes = new Map()
  for (const record of records) {
    const tags = record.tags.filter((tag) => tag !== record.area)
    for (const tag of tags.length ? tags : ['general']) {
      const key = `${record.area}|${tag}`
      const theme = themes.get(key) ?? { area: record.area, tag, records: [] }
      theme.records.push(record)
      themes.set(key, theme)
    }
  }
  return [...themes.values()]
    .map((theme) => ({ ...theme, score: priority(theme.records) }))
    .sort((left, right) => right.score - left.score || right.records.length - left.records.length)
}

export function topTerms(records, limit = 5) {
  const counts = new Map()
  for (const record of records) {
    const seen = new Set()
    for (const { segment, isWordLike } of segmenter.segment(`${record.title}\n${record.details}`)) {
      const word = segment.toLowerCase()
      if (!isWordLike || STOPWORDS.has(word) || /^\d+$/.test(word)) continue
      if (/^[\x20-\x7e]+$/.test(word) ? word.length < 3 : word.length < 2) continue
      seen.add(word)
    }
    for (const word of seen) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
    .slice(0, limit)
    .map(([word]) => word)
}

const bigrams = (text) => {
  const compact = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  const grams = new Set()
  for (let index = 0; index < compact.length - 1; index += 1) grams.add(compact.slice(index, index + 2))
  if (compact.length === 1) grams.add(compact)
  return grams
}

export function similarGroups(records, threshold = 0.5) {
  const parent = records.map((_, index) => index)
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]))
  const grams = records.map((record) => bigrams(record.title))
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      let shared = 0
      for (const gram of grams[left]) if (grams[right].has(gram)) shared += 1
      const union = grams[left].size + grams[right].size - shared
      if (union && shared / union >= threshold) parent[find(right)] = find(left)
    }
  }
  const groups = new Map()
  records.forEach((record, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), record]))
  return [...groups.values()].filter((group) => group.length > 1)
}

function reference(record) {
  const type = labelOf(taxonomy.types, record.type)
  const title = escapeMarkdown(record.title)
  if (record.url) return `[#${record.number} ${title}](${record.url})（${type}${record.state === 'closed' ? '，已关闭' : ''}）`
  return `${title}（${type}，本机记录 ${record.id.slice(0, 8)}）`
}

function countTable(heading, records, key, options) {
  const counts = options
    .map(({ id, label }) => [label, records.filter((record) => record[key] === id).length])
    .filter(([, count]) => count > 0)
  return [`| ${heading} | 数量 |`, '| --- | ---: |', ...counts.map(([label, count]) => `| ${label} | ${count} |`), '']
}

export function renderReport(records, generatedAt = new Date()) {
  const fromGitHub = records.filter((record) => record.source === 'github').length
  const lines = [
    '# Inkdown 意见反馈汇总',
    '',
    `生成时间：${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · 共 ${records.length} 条反馈`
      + `（GitHub ${fromGitHub} 条，本机记录 ${records.length - fromGitHub} 条）`,
    '',
  ]
  if (!records.length) return [...lines, '暂无反馈。', ''].join('\n')

  lines.push('## 概览', '', ...countTable('反馈类型', records, 'type', taxonomy.types),
    ...countTable('涉及功能', records, 'area', taxonomy.areas))

  const common = groupThemes(records).filter((theme) => theme.records.length > 1)
  lines.push('## 共性问题与建议（按优先级排序）', '')
  if (!common.length) lines.push('暂未发现被多次提到的主题。', '')
  common.forEach((theme, index) => {
    const types = taxonomy.types
      .map(({ id, label }) => [label, theme.records.filter((record) => record.type === id).length])
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${label} ${count}`)
    const terms = topTerms(theme.records)
    lines.push(
      `### ${index + 1}. ${labelOf(taxonomy.areas, theme.area)} · ${tagLabel(theme.tag)}（${theme.records.length} 条，优先级 ${theme.score}）`,
      '',
      `- 类型分布：${types.join(' · ')}`,
      ...(terms.length ? [`- 高频词：${terms.join('、')}`] : []),
      '- 代表反馈：',
      ...theme.records.slice(0, 5).map((record) => `  - ${reference(record)}`),
      '',
    )
  })

  const duplicates = similarGroups(records)
  if (duplicates.length) {
    lines.push('## 疑似重复反馈', '', ...duplicates.map((group) => `- ${group.map(reference).join('；')}`), '')
  }
  const covered = new Set(common.flatMap((theme) => theme.records.map((record) => record.id)))
  const others = records.filter((record) => !covered.has(record.id))
  if (others.length) lines.push('## 其他反馈', '', ...others.map((record) => `- ${reference(record)}`), '')
  return lines.join('\n')
}

async function github(pathname, { method = 'GET', body } = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'inkdown-feedback-report',
      'x-github-api-version': '2022-11-28',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`GitHub API ${method} ${pathname} 失败：HTTP ${response.status}`)
  return response.status === 204 ? null : response.json()
}

async function fetchIssues(repository, state) {
  const issues = []
  for (let page = 1; page <= 30; page += 1) {
    const batch = await github(`/repos/${repository}/issues?labels=feedback&state=${state}&per_page=100&page=${page}`)
    issues.push(...batch.filter((issue) => !issue.pull_request))
    if (batch.length < 100) break
  }
  return issues
}

async function labelIssue(repository, number) {
  const issue = await github(`/repos/${repository}/issues/${number}`)
  const labels = labelsFor(issueToRecord(issue))
  const definitions = labelDefinitions()
  const existing = new Set()
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github(`/repos/${repository}/labels?per_page=100&page=${page}`)
    batch.forEach(({ name }) => existing.add(name))
    if (batch.length < 100) break
  }
  for (const name of labels.filter((label) => !existing.has(label))) {
    await github(`/repos/${repository}/labels`, { method: 'POST', body: { name, ...definitions[name] } })
  }
  const stale = issue.labels
    .map(({ name }) => name)
    .filter((name) => /^(type|area|tag):/.test(name) && !labels.includes(name))
  for (const name of stale) {
    await github(`/repos/${repository}/issues/${number}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }
  await github(`/repos/${repository}/issues/${number}/labels`, { method: 'POST', body: { labels } })
  console.log(`#${number}: ${labels.join(', ')}`)
}

const USAGE = `用法：node scripts/feedback-report.mjs [选项]

  --github             汇总 GitHub 上带 feedback 标签的 issue（未指定数据源时默认启用）
  --all                同时包含已关闭的 issue
  --local              汇总本机 Inkdown 保存的反馈记录（%APPDATA%\\Inkdown\\feedback\\feedback.jsonl）
  --jsonl <文件>       汇总指定的反馈记录文件，可重复使用
  --out <文件>         把报告写入文件，默认输出到终端
  --label-issue <编号> 为指定 issue 按类型、功能和关键词打标签（供 GitHub Actions 使用）`

async function main(argv) {
  const options = { github: false, all: false, jsonl: [], out: null, labelIssue: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--github') options.github = true
    else if (argument === '--all') options.all = true
    else if (argument === '--local') {
      options.jsonl.push(path.join(process.env.APPDATA ?? '', 'Inkdown', 'feedback', 'feedback.jsonl'))
    } else if (argument === '--jsonl') options.jsonl.push(argv[++index])
    else if (argument === '--out') options.out = argv[++index]
    else if (argument === '--label-issue') options.labelIssue = Number(argv[++index])
    else if (argument === '--help' || argument === '-h') return console.log(USAGE)
    else throw new Error(`未知参数：${argument}\n\n${USAGE}`)
  }
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY
  if (options.labelIssue) return labelIssue(repository, options.labelIssue)
  if (!options.jsonl.length) options.github = true

  const records = []
  if (options.github) {
    records.push(...(await fetchIssues(repository, options.all ? 'all' : 'open')).map(issueToRecord))
  }
  for (const file of options.jsonl) {
    if (!file) throw new Error('--jsonl 需要文件路径')
    records.push(...parseJsonl(await readFile(file, 'utf8')))
  }
  const ids = new Set()
  const unique = records.filter((record) => !ids.has(record.id) && ids.add(record.id))
  const report = renderReport(unique)
  if (options.out) {
    await writeFile(options.out, report, 'utf8')
    console.log(`已写入 ${options.out}（${unique.length} 条反馈）`)
  } else {
    console.log(report)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
