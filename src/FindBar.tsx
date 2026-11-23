import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Regex, Replace, ReplaceAll, WholeWord, X } from 'lucide-react'
import { describeResult, type SearchQuery, type SearchResult } from './search'

type SearchOption = 'caseSensitive' | 'wholeWord' | 'regex'

interface Props {
  query: SearchQuery
  replacement: string
  showReplace: boolean
  /** False in reading mode, which cannot change the document. */
  canReplace: boolean
  result: SearchResult
  /** Changes whenever the search field should take focus again, as on a second Ctrl+F. */
  focusRequest: number
  onQueryChange(query: SearchQuery): void
  onReplacementChange(replacement: string): void
  onShowReplaceChange(show: boolean): void
  onStep(step: 1 | -1): void
  onReplace(): void
  onReplaceAll(): void
  onClose(): void
}

const OPTION_KEYS: Record<string, SearchOption> = { c: 'caseSensitive', w: 'wholeWord', r: 'regex' }

function IconButton({ label, onClick, pressed, disabled, className, children }: {
  label: string
  onClick(): void
  pressed?: boolean
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <button type="button" className={className} title={label} aria-label={label} aria-pressed={pressed} disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )
}

export function FindBar({
  query, replacement, showReplace, canReplace, result, focusRequest,
  onQueryChange, onReplacementChange, onShowReplaceChange, onStep, onReplace, onReplaceAll, onClose,
}: Props) {
  const findRef = useRef<HTMLInputElement>(null)
  const replacing = canReplace && showReplace

  useEffect(() => {
    findRef.current?.focus()
    findRef.current?.select()
  }, [focusRequest])

  const toggle = (option: SearchOption) => onQueryChange({ ...query, [option]: !query[option] })
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const option = event.altKey && !event.ctrlKey ? OPTION_KEYS[event.key.toLowerCase()] : undefined
    if (option) {
      event.preventDefault()
      toggle(option)
    }
  }
  const missing = Boolean(query.text) && (Boolean(result.error) || result.count === 0)

  return (
    <div className="find-bar" role="search" aria-label="查找与替换" onKeyDown={keyDown}>
      {canReplace && (
        <IconButton className="find-toggle" label={replacing ? '隐藏替换' : '替换 (Ctrl+H)'}
          onClick={() => onShowReplaceChange(!replacing)}>
          {replacing ? <ChevronDown /> : <ChevronRight />}
        </IconButton>
      )}
      <div className="find-rows">
        <div className="find-row">
          <div className={`find-field${missing ? ' is-missing' : ''}`}>
            <input ref={findRef} value={query.text} placeholder="查找" aria-label="查找" spellCheck={false}
              onChange={(event) => onQueryChange({ ...query, text: event.currentTarget.value })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                onStep(event.shiftKey ? -1 : 1)
              }} />
            <IconButton label="区分大小写 (Alt+C)" pressed={query.caseSensitive} onClick={() => toggle('caseSensitive')}>
              <CaseSensitive />
            </IconButton>
            <IconButton label="全字匹配 (Alt+W)" pressed={query.wholeWord} onClick={() => toggle('wholeWord')}>
              <WholeWord />
            </IconButton>
            <IconButton label="使用正则表达式 (Alt+R)" pressed={query.regex} onClick={() => toggle('regex')}>
              <Regex />
            </IconButton>
          </div>
          <span className={`find-count${missing ? ' is-missing' : ''}`} aria-live="polite">
            {query.text ? describeResult(result) : ''}
          </span>
          <IconButton label="上一个 (Shift+Enter)" disabled={!result.count} onClick={() => onStep(-1)}><ChevronUp /></IconButton>
          <IconButton label="下一个 (Enter)" disabled={!result.count} onClick={() => onStep(1)}><ChevronDown /></IconButton>
          <IconButton label="关闭查找 (Esc)" onClick={onClose}><X /></IconButton>
        </div>
        {replacing && (
          <div className="find-row">
            <div className="find-field">
              <input value={replacement} placeholder="替换为" aria-label="替换为" spellCheck={false}
                onChange={(event) => onReplacementChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  if (event.ctrlKey && event.altKey) onReplaceAll()
                  else onReplace()
                }} />
            </div>
            <IconButton label="替换 (Enter)" disabled={!result.count} onClick={onReplace}><Replace /></IconButton>
            <IconButton label="全部替换 (Ctrl+Alt+Enter)" disabled={!result.count} onClick={onReplaceAll}><ReplaceAll /></IconButton>
          </div>
        )}
      </div>
    </div>
  )
}
