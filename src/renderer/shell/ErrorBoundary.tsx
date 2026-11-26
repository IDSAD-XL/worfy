// The error boundary of the window (worfy-polish ticket 163). React unmounts the whole tree on an error
// in a render that no boundary catches: a throw inside one sidebar section, one Assistant tab or one
// view blanked the window. A boundary keeps the throw where it happened: that part shows what failed,
// the error's message and Reload; the rail, the toolbar and the other parts keep working.
//
// `scope` says what Reload does: a section, a tab or a view mounts its content again (a fresh state,
// the same data); the window — the boundary at the root, around the whole App — reloads the page.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../theme/Button'
import './error-boundary.css'

export type BoundaryScope = 'section' | 'tab' | 'view' | 'window'

interface ErrorBoundaryProps {
  scope: BoundaryScope
  /** What the boundary holds, for the line of the console and the `data-boundary` attribute (AssistantSection, journal, history…). */
  name: string
  children?: ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
  error: unknown
  /** The component the error came from, as React names it: the first line of its component stack. */
  where: string | null
}

const TITLES: Record<BoundaryScope, string> = {
  section: 'This section failed to render',
  tab: 'This tab failed to render',
  view: 'This view failed to render',
  window: 'worfy failed to render this window',
}

/** The message of whatever was thrown: an Error's message, else the value as text. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message === '' ? error.name : error.message
  try {
    return typeof error === 'string' ? error : (JSON.stringify(error) ?? String(error))
  } catch {
    return String(error)
  }
}

/** The innermost component of a React component stack (`    at Journal (…)` in Chromium, `    in Journal` elsewhere). */
export function topComponent(stack: string | null | undefined): string | null {
  const line = stack
    ?.split('\n')
    .map((each) => each.trim())
    .find((each) => each !== '')
  const name = line?.match(/^(?:at|in)\s+([^\s(]+)/)?.[1]
  return name ?? null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false, error: undefined, where: null }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { failed: true, error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({ where: topComponent(info.componentStack) })
    console.error(`[worfy] ${this.props.name} failed to render:`, error, info.componentStack)
  }

  private readonly reload = (): void => {
    if (this.props.scope === 'window') {
      window.location.reload()
      return
    }
    this.setState({ failed: false, error: undefined, where: null })
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const { scope, name } = this.props
    return (
      <div role="alert" className={`w-error-boundary w-error-boundary--${scope}`} data-testid="error-boundary" data-boundary={name}>
        <div className="w-error-boundary__title">{TITLES[scope]}</div>
        <div className="w-error-boundary__message">{errorText(this.state.error)}</div>
        {this.state.where === null ? null : <div className="w-error-boundary__where">in {this.state.where}</div>}
        <Button onClick={this.reload}>{scope === 'window' ? 'Reload window' : 'Reload'}</Button>
      </div>
    )
  }
}
