import { fireEvent, render, screen, within } from '@testing-library/react'
import { forwardRef, lazy, memo, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { collectExtensions } from '../../src/renderer/shell/registry'
import { SidebarView } from '../../src/renderer/shell/Sidebar'
import { ToolbarView } from '../../src/renderer/shell/Toolbar'
import { AppShell } from '../../src/renderer/shell/AppShell'
import { ListRow, PrimaryButton, SegmentedControl, StatusChip } from '../../src/renderer/theme/primitives'

const section = (text: string) =>
  function Section() {
    return <p>{text}</p>
  }

describe('collectExtensions', () => {
  it('turns glob results into components ordered by `order`, then by file name', () => {
    const extensions = collectExtensions({
      './sidebar/SessionsSection.tsx': { default: section('Sessions'), order: 30 },
      './sidebar/ProjectsSection.tsx': { default: section('Projects'), order: 10 },
      './sidebar/AdrSection.tsx': { default: section('ADR'), order: 30 },
    })
    expect(extensions.map(({ id, order }) => [id, order])).toEqual([
      ['ProjectsSection', 10],
      ['AdrSection', 30],
      ['SessionsSection', 30],
    ])
  })

  it('accepts components wrapped in memo, forwardRef or lazy', () => {
    const Plain = section('Plain')
    const extensions = collectExtensions({
      './sidebar/MemoSection.tsx': { default: memo(Plain), order: 1 },
      './sidebar/RefSection.tsx': { default: forwardRef<HTMLParagraphElement>((_props, ref) => <p ref={ref}>Ref</p>), order: 2 },
      './sidebar/LazySection.tsx': { default: lazy(() => Promise.resolve({ default: Plain })), order: 3 },
    })
    expect(extensions.map(({ id }) => id)).toEqual(['MemoSection', 'RefSection', 'LazySection'])
    render(<SidebarView sections={extensions.slice(0, 2)} />)
    expect(screen.getByText('Plain')).toBeTruthy()
    expect(screen.getByText('Ref')).toBeTruthy()
  })

  it('rejects a module whose default export is not a component', () => {
    expect(() => collectExtensions({ './sidebar/TextSection.tsx': { default: 'div', order: 1 } })).toThrow(/TextSection.tsx must default-export/)
    expect(() => collectExtensions({ './sidebar/NullSection.tsx': { default: null, order: 1 } })).toThrow(/NullSection.tsx must default-export/)
  })

  it('rejects a module without a component', () => {
    expect(() => collectExtensions({ './sidebar/BrokenSection.tsx': { order: 1 } })).toThrow(/BrokenSection.tsx must default-export/)
  })

  it('rejects a module without a numeric order', () => {
    expect(() => collectExtensions({ './toolbar/Gate.tsx': { default: section('Gate') } })).toThrow(/Gate.tsx must export a numeric `order`/)
  })
})

describe('SidebarView', () => {
  it('renders one block per section file, in order, without knowing the sections', () => {
    const sections = collectExtensions({
      './sidebar/EpicsSection.tsx': { default: section('Epics body'), order: 20 },
      './sidebar/ProjectsSection.tsx': { default: section('Projects body'), order: 10 },
    })
    render(<SidebarView sections={sections} />)
    const nav = screen.getByRole('navigation', { name: 'Sidebar' })
    expect(within(nav).getAllByText(/body$/).map((node) => node.textContent)).toEqual(['Projects body', 'Epics body'])
  })
})

describe('ToolbarView', () => {
  const base = { items: [], view: 'canvas' as const, onViewChange: () => {}, sidebarVisible: true, onToggleSidebar: () => {} }

  it('shows the project name and branch', () => {
    render(<ToolbarView {...base} project={{ name: 'auction', branch: 'main' }} />)
    expect(screen.getByText('worfy — auction')).toBeTruthy()
    expect(screen.getByText('main').className).toContain('w-mono')
  })

  it('places toolbar items before the command palette hint', () => {
    const items = collectExtensions({ './toolbar/Gate.tsx': { default: section('Gate item'), order: 1 } })
    render(<ToolbarView {...base} items={items} />)
    const header = screen.getByRole('banner')
    const text = header.textContent ?? ''
    expect(text.indexOf('Gate item')).toBeGreaterThan(text.indexOf('Session'))
    expect(text.indexOf('Gate item')).toBeLessThan(text.indexOf('⌘K'))
  })
})

describe('AppShell', () => {
  it('switches between the Canvas and Session views', () => {
    render(<AppShell canvas={<p>canvas body</p>} session={<p>session body</p>} />)
    expect(screen.getByText('canvas body').closest('[hidden]')).toBeNull()
    expect(screen.getByText('session body').closest('[hidden]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Session' }))
    expect(screen.getByRole('main', { name: 'Session' })).toBeTruthy()
    expect(screen.getByText('session body').closest('[hidden]')).toBeNull()
    expect(screen.getByText('canvas body').closest('[hidden]')).not.toBeNull()
  })

  it('keeps the inactive view mounted, so its in-memory state survives a switch', () => {
    function Counter() {
      const [count, setCount] = useState(0)
      return (
        <button type="button" onClick={() => setCount((n) => n + 1)}>
          clicks {count}
        </button>
      )
    }
    render(<AppShell canvas={<Counter />} session={<p>session body</p>} />)
    fireEvent.click(screen.getByRole('button', { name: 'clicks 0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }))
    expect(screen.getByRole('button', { name: 'clicks 1' })).toBeTruthy()
  })

  it('hides and shows the sidebar', () => {
    render(<AppShell />)
    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeTruthy()
  })
})

describe('primitives', () => {
  it.each(['ready', 'working', 'blocked', 'done'] as const)('a %s chip always carries its label and an icon', (status) => {
    const { container } = render(<StatusChip status={status} label={`label ${status}`} />)
    const chip = container.querySelector(`[data-status="${status}"]`)
    expect(chip?.textContent).toBe(`label ${status}`)
    expect(chip?.querySelector('svg, .w-chip__dot')).not.toBeNull()
  })

  it('a list row marks the selected item and reports clicks', () => {
    const onSelect = vi.fn()
    render(<ListRow label="payments-v2" mono selected onSelect={onSelect} trailing="3/9" />)
    const row = screen.getByRole('button', { name: /payments-v2/ })
    expect(row.getAttribute('aria-current')).toBe('true')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('the primary button runs its action', () => {
    const onClick = vi.fn()
    render(<PrimaryButton onClick={onClick}>Run wave</PrimaryButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Run wave' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('the segmented control presses exactly one segment', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="View"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value="a"
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'B' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
