import type { FeedbackChannel, FeedbackInput } from './contracts'
import taxonomy from './feedback-taxonomy.json'

export interface FeedbackOption {
  id: string
  label: string
}

export interface FeedbackEnvironment {
  app: string
  electron: string
  os: string
  locale: string
}

export interface FeedbackRecord {
  schema: 1
  id: string
  createdAt: string
  channel: FeedbackChannel
  type: string
  area: string
  title: string
  details: string
  contact: string
  tags: string[]
  fingerprint: string
  environment: FeedbackEnvironment | null
}

export const FEEDBACK_TYPES: FeedbackOption[] = taxonomy.types
export const FEEDBACK_AREAS: FeedbackOption[] = taxonomy.areas
export const FEEDBACK_LIMITS = { title: 80, details: 4_000, contact: 120 }
const MAX_ISSUE_URL_LENGTH = 7_000

const labelOf = (options: Array<{ id: string; label: string }>, id: string) =>
  options.find((option) => option.id === id)?.label ?? id

export function feedbackTagLabels(tags: string[]): string[] {
  return tags.map((tag) => labelOf(taxonomy.tags, tag))
}

export function validateFeedback(input: unknown): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: '反馈内容无效' }
  const candidate = input as Record<string, unknown>
  const text = (key: string) => typeof candidate[key] === 'string' ? (candidate[key] as string).trim() : ''
  const value: FeedbackInput = {
    type: text('type'),
    area: text('area'),
    title: text('title'),
    details: text('details'),
    contact: text('contact'),
    includeEnvironment: candidate.includeEnvironment !== false,
  }
  if (!FEEDBACK_TYPES.some(({ id }) => id === value.type)) return { ok: false, error: '请选择反馈类型' }
  if (!FEEDBACK_AREAS.some(({ id }) => id === value.area)) return { ok: false, error: '请选择涉及的功能' }
  if (value.title.length < 2 || value.title.length > FEEDBACK_LIMITS.title) {
    return { ok: false, error: `标题需为 2–${FEEDBACK_LIMITS.title} 个字` }
  }
  if (value.details.length < 5 || value.details.length > FEEDBACK_LIMITS.details) {
    return { ok: false, error: `详细描述需为 5–${FEEDBACK_LIMITS.details} 个字` }
  }
  if (value.contact.length > FEEDBACK_LIMITS.contact) return { ok: false, error: '联系方式过长' }
  return { ok: true, value }
}

export function feedbackTags(text: string): string[] {
  const normalized = text.toLowerCase()
  return taxonomy.tags
    .filter(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword.toLowerCase())))
    .map(({ id }) => id)
}

export function createFeedbackRecord(
  input: FeedbackInput,
  meta: { id: string; createdAt: string; channel: FeedbackChannel; environment: FeedbackEnvironment },
): FeedbackRecord {
  const tags = feedbackTags(`${input.title}\n${input.details}`)
  return {
    schema: 1,
    id: meta.id,
    createdAt: meta.createdAt,
    channel: meta.channel,
    type: input.type,
    area: input.area,
    title: input.title,
    details: input.details,
    contact: input.contact,
    tags,
    fingerprint: `${input.type}:${input.area}:${tags.join('+') || 'none'}`,
    environment: input.includeEnvironment ? meta.environment : null,
  }
}

function environmentLine(environment: FeedbackEnvironment | null): string {
  return environment
    ? `Inkdown ${environment.app} · Electron ${environment.electron} · ${environment.os} · ${environment.locale}`
    : '未附带'
}

export function formatFeedback(record: FeedbackRecord): string {
  return [
    `# [反馈] ${record.title}`,
    '',
    `- 反馈类型：${labelOf(FEEDBACK_TYPES, record.type)}`,
    `- 涉及功能：${labelOf(FEEDBACK_AREAS, record.area)}`,
    `- 自动标签：${feedbackTagLabels(record.tags).join('、') || '无'}`,
    `- 运行环境：${environmentLine(record.environment)}`,
    record.contact ? `- 联系方式：${record.contact}` : null,
    `- 反馈编号：${record.id}`,
    '',
    '## 详细描述',
    '',
    record.details,
  ].filter((line) => line !== null).join('\n')
}

export function feedbackIssueUrl(record: FeedbackRecord, repositoryUrl: string): { url: string; truncated: boolean } {
  const build = (details: string) => {
    const query = new URLSearchParams({
      template: 'feedback.yml',
      title: `[反馈] ${record.title}`,
      type: labelOf(FEEDBACK_TYPES, record.type),
      area: labelOf(FEEDBACK_AREAS, record.area),
      details,
      tags: feedbackTagLabels(record.tags).join('、'),
      environment: environmentLine(record.environment),
      'feedback-id': record.id,
    })
    return `${repositoryUrl}/issues/new?${query.toString()}`
  }
  let url = build(record.details)
  if (url.length <= MAX_ISSUE_URL_LENGTH) return { url, truncated: false }
  let details = record.details
  const note = '\n\n……（内容过长，完整反馈已复制到剪贴板，请粘贴补充）'
  while (url.length > MAX_ISSUE_URL_LENGTH && details.length > 0) {
    details = details.slice(0, Math.floor(details.length * 0.8))
    url = build(`${details}${note}`)
  }
  return { url, truncated: true }
}
