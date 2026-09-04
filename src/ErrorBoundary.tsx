import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Inkdown render error', error, info)
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-error" role="alert">
          <h1>页面遇到问题</h1>
          <p>已同步的内容和恢复草稿仍保存在本机。请重新加载编辑器。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
