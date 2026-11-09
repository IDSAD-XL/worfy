// The "Remove project…" dialog (worfy-polish ticket 79, src/renderer/projects/RemoveProject.tsx): what
// leaves the Harness and what stays, the refusal of a Workflow folder with tickets and of the script,
// and "Remove from list" as the other choice. The dialog runs over the real renderer IPC client and a
// fake preload whose answers each test gives.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { ProjectsState, ProjectView, RemovalPreview } from '../../src/shared/ipc/projects'

const SHOP: ProjectView = { id: 'shop-0000000a', name: 'shop', path: '/Users/someone/code/shop', branch: 'main' }
const AFTER: ProjectsState = { projects: [], activeId: null, revision: 2 }

const ready = (over: Partial<Extract<RemovalPreview, { status: 'ready' }>> = {}): RemovalPreview => ({
  status: 'ready',
  profile: 'shop',
  profileDir: '/Users/someone/.claude/worfy-harness/projects/shop',
  paths: ['/Users/someone/code/shop'],
  runs: '/Users/someone/.claude/worfy-harness/runs/shop',
  qmd: ['shop-docs'],
  mode: 'full',
  workflowFolder: null,
  alsoListed: [],
  ...over,
})

/** The preload: `answers` answer by channel; every call is noted. */
async function mount(answers: Record<string, (input: unknown) => unknown>) {
  const calls: [string, unknown][] = []
  const bridge: WorfyBridge = {
    invoke: (channel, input) => {
      calls.push([channel, input])
      const answer = answers[channel]
      return Promise.resolve((answer ? { ok: true, value: answer(input) } : { ok: false, error: `unexpected ${channel}` }) as never)
    },
    on: () => 1,
    off: () => undefined,
  }
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
  vi.resetModules()
  const { RemoveProject } = await import('../../src/renderer/projects/RemoveProject')
  const props = { onCancel: vi.fn(), onRemoveFromList: vi.fn(), onRemoved: vi.fn() }
  render(<RemoveProject project={SHOP} {...props} />)
  return { calls, ...props }
}

const confirm = () => screen.getByTestId<HTMLButtonElement>('remove-project-confirm')

afterEach(() => {
  cleanup()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

describe('Remove project: what goes and what stays', () => {
  it('a Full mode Project: the Profile, the gate registry entries, the marks and the qmd collections go; the repository and its tickets stay', async () => {
    await mount({ 'projects.removal.preview': () => ready() })
    const goes = await screen.findByTestId('remove-project-goes')
    expect(goes.textContent).toContain('The Profile shop (/Users/someone/.claude/worfy-harness/projects/shop)')
    expect(goes.textContent).toContain('The gate registry entry for /Users/someone/code/shop: this folder can be connected again')
    expect(goes.textContent).toContain("The agents' marks in /Users/someone/.claude/worfy-harness/runs/shop")
    expect(goes.textContent).toContain('The qmd collections shop-docs')
    const stays = screen.getByTestId('remove-project-stays')
    expect(stays.textContent).toContain('The repositories in /Users/someone/code/shop and every file in them: worfy deletes no repository, branch or file of yours')
    expect(stays.textContent).toContain('The tickets, spec, ADRs and state file in the repository')
    expect(confirm().disabled).toBe(false)
    expect(screen.queryByTestId('remove-project-refused')).toBeNull()
  })

  it('a Silent mode Project over the folder above its repositories: that Workflow folder and its tickets stay', async () => {
    await mount({
      'projects.removal.preview': () =>
        ready({ mode: 'silent', paths: ['/w/api', '/w/web'], workflowFolder: { path: '/Users/someone/code/shop', inside: false, holdsFiles: true } }),
    })
    const stays = await screen.findByTestId('remove-project-stays')
    expect(stays.textContent).toContain('Your Workflow folder /Users/someone/code/shop and the tickets in it')
    expect(stays.textContent).not.toContain('state file in the repository')
    expect(screen.getByTestId('remove-project-goes').textContent).toContain('The gate registry entries for /w/api, /w/web: these folders can be connected again')
    expect(confirm().disabled).toBe(false)
  })

  it('another listed Project inside the folder is named as staying, without a Profile', async () => {
    await mount({ 'projects.removal.preview': () => ready({ alsoListed: ['m1 (/Users/someone/code/shop/m1)'] }) })
    expect((await screen.findByTestId('remove-project-stays')).textContent).toContain('The Project m1 (/Users/someone/code/shop/m1) in the list, without a Profile until its folder is connected again')
  })

  it('an empty default Workflow folder goes with the Profile', async () => {
    const folder = '/Users/someone/.claude/worfy-harness/projects/shop/workflow'
    await mount({ 'projects.removal.preview': () => ready({ mode: 'silent', workflowFolder: { path: folder, inside: true, holdsFiles: false } }) })
    expect((await screen.findByTestId('remove-project-goes')).textContent).toContain(`The empty Workflow folder ${folder}`)
  })
})

describe('Remove project: the removal and its refusals', () => {
  it('"Remove project" removes in main and hands the new list and the notes on', async () => {
    const view = await mount({
      'projects.removal.preview': () => ready(),
      'projects.removeProject': () => ({ status: 'removed', state: AFTER, notes: ['qmd collections: kept, another profile names them: shared'] }),
    })
    await waitFor(() => expect(confirm().disabled).toBe(false))
    fireEvent.click(confirm())
    await waitFor(() => expect(view.onRemoved).toHaveBeenCalledWith(AFTER, ['qmd collections: kept, another profile names them: shared']))
    expect(view.calls.filter(([channel]) => channel === 'projects.removeProject')).toStrictEqual([['projects.removeProject', { id: SHOP.id }]])
    expect(view.onRemoveFromList).not.toHaveBeenCalled()
  })

  it('tickets in the default Workflow folder: the refusal shows, "Remove project" is off, and Show in Finder asks main for the folder', async () => {
    const folder = '/Users/someone/.claude/worfy-harness/projects/shop/workflow'
    const view = await mount({
      'projects.removal.preview': () => ready({ mode: 'silent', workflowFolder: { path: folder, inside: true, holdsFiles: true } }),
      'projects.removal.reveal': () => ({ path: folder }),
    })
    const refused = await screen.findByTestId('remove-project-refused')
    // The folder goes out whole: its .git alone keeps the Harness refusing.
    expect(refused.textContent).toBe(
      `The Workflow folder ${folder} holds the project's own files (its tickets). worfy never deletes them: move the folder ${folder} out of /Users/someone/.claude/worfy-harness/projects/shop first, then remove the project.`,
    )
    expect(confirm().disabled).toBe(true)
    fireEvent.click(screen.getByTestId('remove-project-reveal'))
    await waitFor(() => expect(view.calls.map(([channel]) => channel)).toContain('projects.removal.reveal'))
    expect(view.calls.find(([channel]) => channel === 'projects.removal.reveal')?.[1]).toStrictEqual({ id: SHOP.id })
    expect(view.calls.map(([channel]) => channel)).not.toContain('projects.removeProject')
  })

  it("a refusal of the script stays in the dialog with its words, and the Project is not handed on as removed", async () => {
    const folder = '/Users/someone/.claude/worfy-harness/projects/shop/workflow'
    const view = await mount({
      'projects.removal.preview': () => ready({ mode: 'silent', workflowFolder: { path: folder, inside: true, holdsFiles: false } }),
      'projects.removeProject': () => ({ status: 'refused', reason: 'The Harness did not remove the Profile shop, so the Project stays in the list: holds the project\'s own files and commits', workflowFolder: folder }),
    })
    await waitFor(() => expect(confirm().disabled).toBe(false))
    fireEvent.click(confirm())
    expect((await screen.findByTestId('remove-project-refused')).textContent).toBe(
      "The Harness did not remove the Profile shop, so the Project stays in the list: holds the project's own files and commits",
    )
    expect(screen.queryByTestId('remove-project-reveal')).not.toBeNull()
    expect(view.onRemoved).not.toHaveBeenCalled()
  })

  it('a preview the Harness refuses: its reason, no "Remove project", and "Remove from list" is still the other choice', async () => {
    const view = await mount({ 'projects.removal.preview': () => ({ status: 'refused', reason: 'The Profile pair also covers /w/web, outside /w/api.' }) })
    expect((await screen.findByTestId('remove-project-refused')).textContent).toBe('The Profile pair also covers /w/web, outside /w/api.')
    expect(confirm().disabled).toBe(true)
    fireEvent.click(screen.getByTestId('remove-project-list-only'))
    expect(view.onRemoveFromList).toHaveBeenCalledTimes(1)
    expect(view.calls.map(([channel]) => channel)).toStrictEqual(['projects.removal.preview'])
  })

  it('Cancel and Escape close without a call', async () => {
    const view = await mount({ 'projects.removal.preview': () => ready() })
    await screen.findByTestId('remove-project-goes')
    fireEvent.keyDown(screen.getByTestId('remove-project'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(view.onCancel).toHaveBeenCalledTimes(2)
    expect(view.calls.map(([channel]) => channel)).toStrictEqual(['projects.removal.preview'])
  })
})
