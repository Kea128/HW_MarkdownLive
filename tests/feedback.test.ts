import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { FeedbackInput } from '../src/contracts'
import {
  createFeedbackRecord, FEEDBACK_AREAS, FEEDBACK_TYPES, feedbackIssueUrl, feedbackTags, formatFeedback, validateFeedback,
} from '../src/feedback'
import {
  groupThemes, isFeedbackIssue, issueToRecord, keywordTags, labelDefinitions, labelsFor, needsLabels, parseIssueBody,
  parseJsonl, renderReport, similarGroups,
} from '../scripts/feedback-report.mjs'

const input: FeedbackInput = {
  type: 'bug',
  area: 'table',
  title: '表格里的长代码覆盖旁边文字',
  details: '在单元格中输入很长的行内代码后，文字重叠到右侧单元格。',
  contact: 'user@example.com',
  includeEnvironment: true,
}
const environment = { app: '2.8.1（安装版）', electron: '43.3.0', os: 'Windows 11 10.0.22631 x64', locale: 'zh-CN' }
const meta = { id: '3f2a9c1e-0000-4000-8000-000000000001', createdAt: '2026-11-04T08:00:00.000Z', channel: 'github' as const, environment }

describe('意见反馈', () => {
  it('校验必填项、选项与长度，并去除首尾空白', () => {
    expect(validateFeedback({ ...input, title: '  标题  ' })).toEqual({ ok: true, value: { ...input, title: '标题' } })
    expect(validateFeedback(null)).toEqual({ ok: false, error: '反馈内容无效' })
    expect(validateFeedback({ ...input, type: 'spam' })).toEqual({ ok: false, error: '请选择反馈类型' })
    expect(validateFeedback({ ...input, area: 'nope' })).toEqual({ ok: false, error: '请选择涉及的功能' })
    expect(validateFeedback({ ...input, title: '短' })).toMatchObject({ ok: false, error: expect.stringContaining('标题') })
    expect(validateFeedback({ ...input, details: '太短' })).toMatchObject({ ok: false, error: expect.stringContaining('详细描述') })
    expect(validateFeedback({ ...input, details: '长'.repeat(4_001) })).toMatchObject({ ok: false })
    expect(validateFeedback({ ...input, contact: 'x'.repeat(121) })).toEqual({ ok: false, error: '联系方式过长' })
  })

  it('按关键词自动打标签，渲染层与汇总脚本结果一致', () => {
    const text = `${input.title}\n${input.details}`
    expect(feedbackTags(text)).toEqual(['layout', 'table'])
    expect(keywordTags(text)).toEqual(feedbackTags(text))
    expect(feedbackTags('打开文件夹后应用崩溃')).toEqual(['crash', 'files'])
    expect(feedbackTags('打开原始typora文件（其中包含图片位置），无法渲染图片')).toEqual(['image', 'compat'])
    expect(feedbackTags('一切正常')).toEqual([])
    expect(feedbackTags('代码示例里写的是纯延迟模型和延迟加载')).toEqual([])
    expect(feedbackTags('长文档输入有延迟，切换视图反应慢')).toEqual(['slow'])
  })

  it('生成带指纹的记录，未授权时不附带运行环境', () => {
    const record = createFeedbackRecord(input, meta)
    expect(record).toMatchObject({ schema: 1, tags: ['layout', 'table'], fingerprint: 'bug:table:layout+table', environment })
    expect(createFeedbackRecord({ ...input, includeEnvironment: false }, meta).environment).toBeNull()
    expect(createFeedbackRecord({ ...input, title: '其他意见', details: '一切都很好用。' }, meta).fingerprint)
      .toBe('bug:table:none')
    const markdown = formatFeedback(record)
    expect(markdown).toContain('# [反馈] 表格里的长代码覆盖旁边文字')
    expect(markdown).toContain('- 自动标签：排版/样式、表格')
    expect(markdown).toContain('- 运行环境：Inkdown 2.8.1（安装版） · Electron 43.3.0 · Windows 11 10.0.22631 x64 · zh-CN')
    expect(markdown).toContain('- 联系方式：user@example.com')
  })

  it('生成预填 GitHub 表单的链接，并在过长时截断', () => {
    const record = createFeedbackRecord(input, meta)
    const { url, truncated } = feedbackIssueUrl(record, 'https://github.com/Kea128/HW_MarkdownLive')
    const parsed = new URL(url)
    expect(truncated).toBe(false)
    expect(parsed.pathname).toBe('/Kea128/HW_MarkdownLive/issues/new')
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({
      template: 'feedback.yml',
      title: '[反馈] 表格里的长代码覆盖旁边文字',
      type: '问题报告',
      area: '表格',
      tags: '排版/样式、表格',
      'feedback-id': meta.id,
    })
    expect(parsed.searchParams.has('contact')).toBe(false)

    const long = createFeedbackRecord({ ...input, details: '很长的描述。'.repeat(600) }, meta)
    const result = feedbackIssueUrl(long, 'https://github.com/Kea128/HW_MarkdownLive')
    expect(result.truncated).toBe(true)
    expect(result.url.length).toBeLessThanOrEqual(7_000)
    expect(new URL(result.url).searchParams.get('details')).toContain('完整反馈已复制到剪贴板')
  })

  it('GitHub 表单模板包含应用预填的全部字段和选项', async () => {
    const template = (await readFile('.github/ISSUE_TEMPLATE/feedback.yml', 'utf8')).replace(/\r\n/g, '\n')
    for (const id of ['type', 'area', 'details', 'tags', 'environment', 'feedback-id']) {
      expect(template).toContain(`id: ${id}\n`)
    }
    for (const { label } of [...FEEDBACK_TYPES, ...FEEDBACK_AREAS]) expect(template).toContain(`- ${label}\n`)
  })
})

describe('反馈汇总脚本', () => {
  const issueBody = (type: string, area: string, details: string, id = '_No response_') => [
    '### 反馈类型', '', type, '', '### 涉及功能', '', area, '', '### 详细描述', '', details, '', '### 小标题不是字段', '仍属于描述',
    '', '### 自动标签', '', '_No response_', '', '### 运行环境', '', 'Inkdown 2.8.1', '', '### 反馈编号', '', id,
  ].join('\n')

  it('解析 issue 表单并合并声明的标签与关键词标签', () => {
    expect(parseIssueBody(issueBody('问题报告', '表格', '文字覆盖'))['详细描述']).toBe('文字覆盖\n\n### 小标题不是字段\n仍属于描述')
    const record = issueToRecord({
      number: 12, title: '[反馈] 表格长代码覆盖文字', state: 'open', html_url: 'https://github.com/o/r/issues/12',
      created_at: '2026-11-04T00:00:00Z', body: issueBody('问题报告', '表格', '单元格内容重叠', 'abc'), reactions: { '+1': 2 },
    })
    expect(record).toMatchObject({
      id: 'abc', title: '表格长代码覆盖文字', type: 'bug', area: 'table', tags: ['layout', 'table'], votes: 2,
    })
    expect(labelsFor(record)).toEqual(['feedback', 'type:bug', 'area:table', 'tag:layout', 'tag:table'])
    for (const label of labelsFor(record)) expect(labelDefinitions()[label]).toBeDefined()
    expect(issueToRecord({ number: 3, title: '随便说说', body: '' })).toMatchObject({ id: 'github-3', type: 'other', area: 'other' })
  })

  it('按标题或标签识别反馈 issue，并找出尚未分类的反馈', () => {
    expect(isFeedbackIssue({ title: '[反馈] 图片问题', labels: [] })).toBe(true)
    expect(isFeedbackIssue({ title: '其他问题', labels: [{ name: 'feedback' }] })).toBe(true)
    expect(isFeedbackIssue({ title: '[反馈] 合并请求', labels: [], pull_request: {} })).toBe(false)
    expect(isFeedbackIssue({ title: 'Bug', labels: ['bug'] })).toBe(false)
    expect(needsLabels({ labels: [] })).toBe(true)
    expect(needsLabels({ labels: [{ name: 'feedback' }] })).toBe(true)
    expect(needsLabels({ labels: [{ name: 'feedback' }, { name: 'type:bug' }] })).toBe(false)
  })

  it('读取本机 JSONL 记录并忽略损坏行', () => {
    const record = createFeedbackRecord(input, meta)
    const records = parseJsonl(`${JSON.stringify(record)}\nnot json\n{"schema":2}\n\n`)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ id: meta.id, source: 'local', type: 'bug', area: 'table', tags: ['layout', 'table'] })
  })

  it('按功能与标签聚合共性主题，识别疑似重复并排序', () => {
    const records = [
      { id: '1', source: 'local', type: 'bug', area: 'table', title: '表格长代码覆盖文字', details: '长代码 覆盖 单元格', tags: ['layout', 'table'], votes: 0 },
      { id: '2', source: 'local', type: 'bug', area: 'table', title: '表格长代码覆盖了文字', details: '长代码 覆盖 右侧', tags: ['layout'], votes: 0 },
      { id: '3', source: 'local', type: 'feature', area: 'files', title: '希望支持打开文件夹', details: '侧栏显示文件', tags: ['files', 'sidebar'], votes: 0 },
      { id: '4', source: 'local', type: 'bug', area: 'editor', title: '保存时崩溃', details: '应用闪退', tags: ['crash'], votes: 0 },
    ]
    const themes = groupThemes(records)
    expect(themes[0]).toMatchObject({ area: 'table', tag: 'layout', score: 6 })
    expect(themes[0].records.map(({ id }: { id: string }) => id)).toEqual(['1', '2'])
    expect(themes.find((theme: { area: string }) => theme.area === 'files')?.tag).toBe('sidebar')
    expect(similarGroups(records).map((group: Array<{ id: string }>) => group.map(({ id }) => id))).toEqual([['1', '2']])

    const report = renderReport(records, new Date('2026-11-04T08:00:00Z'))
    expect(report).toContain('共 4 条反馈（GitHub 0 条，本机记录 4 条）')
    expect(report).toContain('| 问题报告 | 3 |')
    expect(report).toContain('### 1. 表格 · 排版/样式（2 条，优先级 6）')
    expect(report).toContain('- 高频词：')
    expect(report).toContain('## 疑似重复反馈')
    expect(report).toContain('## 其他反馈')
    expect(renderReport([], new Date('2026-11-04T08:00:00Z'))).toContain('暂无反馈。')
  })
})
