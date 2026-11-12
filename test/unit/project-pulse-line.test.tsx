// The live line of a Project card in the Projects section (worfy-polish ticket 113): «1 busy · 3 PR need you · 20
// waits» never loses a word at the card's edge. The parts that do not fit move whole to the next line, the card grows
// with them, and each part has a tooltip that says in plain words what it counts. jsdom does no layout, so the styles
// that make it so are what is checked here; the boxes are checked against the built app (test/e2e/sidebar-rail.spec.ts).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectPulseState } from '../../src/shared/ipc/project-pulse'
import type { ProjectsState } from '../../src/shared/ipc/projects'

const ALPHA = { id: 'alpha-0000000a', name: 'alpha', path: '/projects/alpha', branch: 'main' }
const BETA = { id: 'beta-0000000b', name: 'beta', path: '/projects/beta', branch: 'main' }
const LIST: ProjectsState = { projects: [ALPHA, BETA], activeId: ALPHA.id, revision: 1 }
const PULSE: ProjectPulseState = {
  projects: [
    { projectId: ALPHA.id, live: [], busy: 1, prNeedYou: 3, waits: 20 },
    { projectId: BETA.id, live: [], busy: 2, prNeedYou: 1, waits: 1 },
  ],
}

beforeEach(() => {
  // useProjects, useProjectPulse and sidebar-scope keep their state in modules: every test starts with fresh ones.
  vi.resetModules()
  localStorage.clear()
  const answers: Record<string, unknown> = { 'projects.list': LIST, 'projectPulse.get': PULSE }
  const bridge: WorfyBridge = {
    invoke: (channel) => Promise.resolve(channel in answers ? { ok: true, value: answers[channel] } : { ok: false, error: `no ${channel}` }),
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  vi.restoreAllMocks()
})

async function mountCards(): Promise<void> {
  const projects = await import('../../src/renderer/projects/useProjects')
  projects.acceptProjectsState(LIST)
  const { default: ProjectsSection } = await import('../../src/renderer/shell/sidebar/ProjectsSection')
  render(<ProjectsSection />)
  await waitFor(() => expect(screen.getAllByTestId('project-pulse')).toHaveLength(2))
}

function lineOf(id: string): HTMLElement {
  const line = screen
    .getAllByTestId('project-row')
    .find((row) => row.getAttribute('data-project-id') === id)
    ?.querySelector<HTMLElement>('[data-testid="project-pulse"]')
  if (line === null || line === undefined) throw new Error(`no live line of ${id}`)
  return line
}

const parts = (line: HTMLElement): HTMLElement[] => [...line.querySelectorAll<HTMLElement>('[data-pulse]')]

/** The element and every element between it and `line`, the line included. */
function upTo(element: HTMLElement, line: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = []
  for (let at: HTMLElement | null = element; at !== null; at = at.parentElement) {
    chain.push(at)
    if (at === line) break
  }
  return chain
}

describe('the live line of a Project card', () => {
  it('cuts no part: the parts wrap whole onto the next line, nothing on the way clips text on one line, the card grows', async () => {
    await mountCards()
    const line = lineOf(ALPHA.id)
    expect(parts(line).map((part) => part.textContent)).toEqual(['1 busy', '3 PR need you', '20 waits'])
    // The row of the parts wraps.
    const row = parts(line)[0]?.parentElement?.parentElement
    expect(row?.style.display).toBe('flex')
    expect(row?.style.flexWrap).toBe('wrap')
    expect(row?.style.rowGap).not.toBe('')
    for (const part of parts(line)) {
      // From the text of a part up to the line, no box keeps it on one line and clips it, and none up from the part
      // has a fixed height (the busy dot inside the part has its own 6 px).
      for (const box of [...part.querySelectorAll<HTMLElement>('*'), ...upTo(part, line)]) {
        expect(box.style.whiteSpace === 'nowrap' && box.style.overflow === 'hidden').toBe(false)
        expect(box.style.textOverflow).toBe('')
      }
      for (const box of upTo(part, line)) expect(box.style.height).toBe('')
    }
    // The card grows with the line: at least its two lines, never a fixed height.
    const card = line.closest('button')
    expect(card?.style.height).not.toBe('44px')
    expect(card?.style.minHeight).toBe('44px')
  })

  it('puts no separator at the start of a line: the first part has none, each other one carries its own before it', async () => {
    await mountCards()
    const line = lineOf(ALPHA.id)
    // The words read as before: «1 busy·3 PR need you·20 waits».
    expect(line.textContent).toBe('1 busy·3 PR need you·20 waits')
    const [first, ...rest] = parts(line)
    expect(first?.parentElement?.querySelector('[data-pulse-separator]')).toBeNull()
    // Every part sits in one wrapping item with the separator before it, so a part moves to the next line with its
    // separator, which the row pushes out past the clipping edge (the boxes are checked in the e2e).
    for (const part of rest) {
      const separator = part.previousElementSibling
      expect(separator?.getAttribute('data-pulse-separator')).toBe('')
      expect(separator?.getAttribute('aria-hidden')).toBe('true')
      expect(separator?.textContent).toBe('·')
    }
    expect(first?.previousElementSibling?.textContent ?? '').toBe('')
    const row = first?.parentElement?.parentElement
    const clip = row?.parentElement
    expect(row?.style.marginLeft).toMatch(/^-/)
    expect(clip?.style.overflow).toBe('hidden')
    expect(clip?.style.whiteSpace).toBe('')
  })

  it('gives each part a tooltip that says what it counts, in the singular and the plural', async () => {
    await mountCards()
    const said = (id: string) => parts(lineOf(id)).map((part) => part.getAttribute('aria-description'))
    expect(said(ALPHA.id)).toEqual(['1 Session is in a turn', '3 pull requests need you: a review, an answer or a fix', '20 Tickets wait: blocked, or waiting for a person, not an agent'])
    expect(said(BETA.id)).toEqual(['2 Sessions are in a turn', '1 pull request needs you: a review, an answer or a fix', '1 Ticket waits: blocked, or waiting for a person, not an agent'])

    // The pointer resting on a part shows its tooltip, and not the path of the Project the row names natively.
    const waits = parts(lineOf(ALPHA.id))[2]
    if (waits === undefined) throw new Error('no waits part')
    expect(waits.getAttribute('title')).toBe('')
    const { TOOLTIP_DELAY_MS } = await import('../../src/renderer/theme/kit/Tooltip')
    fireEvent.pointerEnter(waits, { pointerType: 'mouse' })
    fireEvent.mouseEnter(waits)
    fireEvent.mouseOver(waits)
    fireEvent.pointerMove(waits, { pointerType: 'mouse' })
    fireEvent.mouseMove(waits)
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, TOOLTIP_DELAY_MS + 100)))
    expect(screen.getByRole('tooltip').textContent).toBe('20 Tickets wait: blocked, or waiting for a person, not an agent')
  })

  it('words the tooltips in pulseParts, next to the words of the line', async () => {
    const { pulseParts } = await import('../../src/renderer/projects/useProjectPulse')
    expect(pulseParts({ busy: 1, prNeedYou: 0, waits: 2 }).map((part) => [part.text, part.hint])).toEqual([
      ['1 busy', '1 Session is in a turn'],
      ['2 waits', '2 Tickets wait: blocked, or waiting for a person, not an agent'],
    ])
  })
})
