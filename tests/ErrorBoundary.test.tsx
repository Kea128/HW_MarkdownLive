import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../src/ErrorBoundary'

function Broken() {
  throw new Error('render failed')
}

describe('ErrorBoundary', () => {
  it('正常渲染子内容', () => {
    render(<ErrorBoundary><p>正常内容</p></ErrorBoundary>)
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })

  it('捕获渲染异常并显示恢复提示', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><Broken /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toHaveTextContent('页面遇到问题')
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
