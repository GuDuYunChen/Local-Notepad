import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      const { fallback, label = '组件' } = this.props
      if (fallback) {
        return fallback(this.state.error, this.handleReset)
      }
      return (
        <div className="error-boundary">
          <div className="error-icon">⚠️</div>
          <div className="error-title">{label}发生错误</div>
          <div className="error-message">{this.state.error?.message || '未知错误'}</div>
          <button className="btn primary" onClick={this.handleReset}>
            重试
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
