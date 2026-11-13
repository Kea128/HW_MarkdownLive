import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CircleCheck, Copy, ExternalLink, X } from 'lucide-react'
import type { FeedbackChannel, FeedbackInput } from './contracts'
import {
  FEEDBACK_AREAS, FEEDBACK_LIMITS, FEEDBACK_TYPES, feedbackTagLabels, feedbackTags, validateFeedback,
} from './feedback'

const placeholders: Record<string, string> = {
  bug: '1. 做了什么操作\n2. 期望出现什么结果\n3. 实际发生了什么（可附上能复现问题的 Markdown 片段）',
  feature: '希望增加什么功能？会在什么场景下使用？',
  ux: '哪里用起来不顺手？你期望它是什么样子？',
  performance: '在什么操作下变慢或卡顿？文档大约有多大？',
  other: '请写下你的建议或意见',
}

interface Submitted {
  id: string
  channel: FeedbackChannel
  truncated: boolean
}

export function FeedbackDialog({ onClose }: { onClose(): void }) {
  const [form, setForm] = useState<FeedbackInput>({
    type: 'bug', area: 'editor', title: '', details: '', contact: '', includeEnvironment: true,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState<Submitted | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const tags = useMemo(() => feedbackTagLabels(feedbackTags(`${form.title}\n${form.details}`)), [form.title, form.details])
  const update = (patch: Partial<FeedbackInput>) => {
    setForm((current) => ({ ...current, ...patch }))
    setError(null)
  }

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.querySelector<HTMLElement>('select, input, textarea')?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    if (submitted) dialogRef.current?.querySelector<HTMLElement>('.dialog-actions .primary')?.focus()
  }, [submitted])

  const submit = async (channel: FeedbackChannel) => {
    const validated = validateFeedback(form)
    if (!validated.ok) {
      setError(validated.error)
      return
    }
    setBusy(true)
    try {
      const response = await window.inkdown.feedback.submit(validated.value, channel)
      if (response.ok) setSubmitted({ id: response.id, channel, truncated: response.truncated })
      else setError(response.error)
    } catch {
      setError('提交失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea, button')]
      .filter((element) => !element.hasAttribute('disabled'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="app-dialog" role="dialog" aria-modal="true"
        aria-labelledby="feedback-title" onKeyDown={keyDown}>
        <header>
          <h2 id="feedback-title">意见反馈</h2>
          <button type="button" className="icon" onClick={onClose} aria-label="关闭意见反馈"><X /></button>
        </header>
        {submitted ? (
          <div className="feedback-done" aria-live="polite">
            <CircleCheck className="feedback-done-icon" />
            <p className="feedback-done-title">感谢你的反馈！</p>
            <p>反馈编号：<code>{submitted.id.slice(0, 8)}</code></p>
            {submitted.channel === 'github' ? (
              <p>
                已在浏览器中打开 GitHub 反馈表单并预填内容，确认后点击“Create”即可提交。
                {submitted.truncated && '内容较长，完整反馈已复制到剪贴板，可粘贴到表单中补充。'}
              </p>
            ) : <p>反馈内容已复制到剪贴板，可以通过邮件或即时通讯发送给开发者。</p>}
            <p className="feedback-hint">本机也保存了一份反馈记录，便于离线汇总。</p>
            <div className="dialog-actions">
              <button type="button" onClick={() => void window.inkdown.feedback.openFolder()}>打开反馈记录</button>
              <button type="button" className="primary" onClick={onClose}>完成</button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); void submit('github') }}>
            <p className="dialog-intro">
              说说你遇到的问题或想要的功能。反馈只包含你填写的内容，不会附带正在编辑的文档。
            </p>
            <div className="feedback-row">
              <label>
                <span>反馈类型</span>
                <select value={form.type} onChange={(event) => update({ type: event.currentTarget.value })}>
                  {FEEDBACK_TYPES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>涉及功能</span>
                <select value={form.area} onChange={(event) => update({ area: event.currentTarget.value })}>
                  {FEEDBACK_AREAS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span>标题<small>{form.title.trim().length}/{FEEDBACK_LIMITS.title}</small></span>
              <input value={form.title} maxLength={FEEDBACK_LIMITS.title} placeholder="一句话概括"
                onChange={(event) => update({ title: event.currentTarget.value })} />
            </label>
            <label>
              <span>详细描述<small>{form.details.trim().length}/{FEEDBACK_LIMITS.details}</small></span>
              <textarea value={form.details} maxLength={FEEDBACK_LIMITS.details} rows={7}
                placeholder={placeholders[form.type]} onChange={(event) => update({ details: event.currentTarget.value })} />
            </label>
            <p className="feedback-tags" aria-live="polite">
              自动标签：{tags.length ? tags.map((tag) => <span key={tag}>{tag}</span>) : <em>输入内容后自动识别</em>}
            </p>
            <label>
              <span>联系方式（可选）</span>
              <input value={form.contact} maxLength={FEEDBACK_LIMITS.contact} placeholder="邮箱或工号，便于回访；不会公开到 GitHub"
                onChange={(event) => update({ contact: event.currentTarget.value })} />
            </label>
            <label className="feedback-check">
              <input type="checkbox" checked={form.includeEnvironment}
                onChange={(event) => update({ includeEnvironment: event.currentTarget.checked })} />
              附带应用版本和系统信息（帮助定位问题）
            </label>
            {error && <p className="dialog-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" disabled={busy} onClick={() => void submit('copy')}
                title="复制为 Markdown，适合无法访问 GitHub 时发送给开发者">
                <Copy />复制内容
              </button>
              <button type="submit" className="primary" disabled={busy}>
                <ExternalLink />提交到 GitHub
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
