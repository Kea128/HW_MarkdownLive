import { beforeEach, describe, expect, it, vi } from 'vitest'

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async () => ({ diagramType: 'flowchart-v2' })),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })),
  mermaidAPI: {
    defaultConfig: {
      theme: 'default',
      fontSize: 16,
      flowchart: { theme: 'redux-color', look: 'neo' },
      sequence: { theme: 'redux-color' },
      gantt: { useMaxWidth: true },
    },
  },
}))

vi.mock('mermaid', () => ({ default: mermaid }))

async function loadPreview() {
  vi.resetModules()
  return import('../src/mermaid-preview')
}

describe('Mermaid 图表预览', () => {
  beforeEach(() => {
    mermaid.initialize.mockClear()
    mermaid.parse.mockClear()
    mermaid.render.mockClear()
    mermaid.parse.mockImplementation(async () => ({ diagramType: 'flowchart-v2' }))
    mermaid.render.mockImplementation(async (id: string) => ({ svg: `<svg id="${id}"></svg>` }))
  })

  it('只识别 mermaid 语言标记', async () => {
    const { isMermaidLanguage } = await loadPreview()
    expect(['mermaid', ' Mermaid ', 'MERMAID'].every(isMermaidLanguage)).toBe(true)
    expect(['mermaid-js', 'ts', ''].some(isMermaidLanguage)).toBe(false)
  })

  it('以严格安全级别分别渲染浅色和深色图表，深色沿用各图表类型对应的暗色主题', async () => {
    const { renderMermaidPreview } = await loadPreview()
    const apply = vi.fn()
    expect(renderMermaidPreview('flowchart LR\n  A --> B', apply)).toBeUndefined()
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(apply).toHaveBeenCalledWith(
      '<div class="mermaid-diagram"><div class="mermaid-variant mermaid-light"><svg id="inkdown-mermaid-1"></svg></div>'
      + '<div class="mermaid-variant mermaid-dark"><svg id="inkdown-mermaid-2"></svg></div></div>',
    )
    const [[light], [dark]] = mermaid.initialize.mock.calls
    const base = { startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, fontFamily: expect.any(String) }
    expect(light).toEqual(base)
    expect(dark).toEqual({
      ...base,
      theme: 'dark',
      flowchart: { theme: 'redux-dark-color' },
      sequence: { theme: 'redux-dark-color' },
    })
  })

  it('空闲时直接返回缓存，避免重复渲染', async () => {
    const { renderMermaidPreview } = await loadPreview()
    const apply = vi.fn()
    renderMermaidPreview('pie\n  "A" : 1', apply)
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(renderMermaidPreview('pie\n  "A" : 1', vi.fn())).toBe(apply.mock.calls[0][0])
    expect(mermaid.render).toHaveBeenCalledTimes(2)
  })

  it('按请求顺序回填结果，排队中的缓存命中不会被旧结果覆盖', async () => {
    const { renderMermaidPreview } = await loadPreview()
    const first = vi.fn()
    renderMermaidPreview('graph TD\n  A', first)
    await vi.waitFor(() => expect(first).toHaveBeenCalledOnce())

    let releaseSlow: () => void = () => undefined
    mermaid.render.mockImplementationOnce((id: string) => new Promise((resolve) => {
      releaseSlow = () => resolve({ svg: `<svg id="${id}">slow</svg>` })
    }))
    const order: string[] = []
    renderMermaidPreview('graph TD\n  B', () => order.push('B'))
    expect(renderMermaidPreview('graph TD\n  A', () => order.push('A cached'))).toBeUndefined()
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(3))
    releaseSlow()
    await vi.waitFor(() => expect(order).toEqual(['B', 'A cached']))
  })

  it('语法错误显示转义后的错误信息', async () => {
    const { renderMermaidPreview } = await loadPreview()
    mermaid.parse.mockRejectedValueOnce(new Error('Parse error on line 2: <img src=x onerror=alert(1)>'))
    const apply = vi.fn()
    renderMermaidPreview('flowchart LR\n  A -->', apply)
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce())
    const html = apply.mock.calls[0][0] as string
    expect(html).toContain('Mermaid 图表无法渲染')
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;')
    expect(html).not.toContain('<img')
    expect(mermaid.render).not.toHaveBeenCalled()
  })

  it('渲染失败时显示错误，后续图表仍可继续渲染', async () => {
    const { renderMermaidPreview } = await loadPreview()
    mermaid.render.mockRejectedValueOnce(new Error('render failed'))
    const failed = vi.fn()
    const next = vi.fn()
    renderMermaidPreview('gantt\n  title 计划', failed)
    renderMermaidPreview('journey\n  title 体验', next)
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())
    expect(failed.mock.calls[0][0]).toContain('render failed')
    expect(next.mock.calls[0][0]).toContain('mermaid-diagram')
  })
})
