// The renderer's copy of the Project lists. Each Machine owns its list (src/main/projects/store.ts);
// this module keeps the latest state each sent, for every component that shows it: the Projects
// section of the sidebar and the toolbar (main.tsx). One subscription and one list call per Machine
// serve them all.
//
// A window shows the Projects of one Machine (worfy-link ticket 09; ADR-0053): this Machine's by
// default, or a Linked machine's, named in the window's address (windowMachine, src/renderer/ipc.ts).
// useProjects() is the list of the window's Machine. In a window on a Linked machine M its
// `activeId` is the Project this window shows — the window's own choice, kept in its address: M's
// active Project is M's own screens' and does not change from here. Opening a Project of another
// Machine (openProject) loads the window again on that Machine: every module of the renderer keeps
// its state by Project id, and the same folder on two Machines has one id, so a fresh renderer is
// the one way not to mix two Projects up.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { LinkState } from '../../shared/ipc/link'
import type { LinkedState } from '../../shared/ipc/linked'
import type { ProjectsState, ProjectView } from '../../shared/ipc/projects'
import { invoke, invokeOn, MACHINE_PARAM, subscribe, subscribeOn, windowMachine } from '../ipc'
import { linkStateNow, useMachineName } from '../machines/useMachines'
import { readOnlyHint } from './read-only'
import { answerReadOnly } from './read-only-now'

/** The parameter of the window's address that names the Project a window on a Linked machine shows. */
export const PROJECT_PARAM = 'project'

/** How the window changes its address; tests replace these. */
export const navigation = {
  /** Loads the window again at `url`. */
  load: (url: string): void => window.location.assign(url),
  /** Loads the window again at the same address. */
  reload: (): void => window.location.reload(),
  /** Changes the address without loading the page again. */
  replace: (url: string): void => window.history.replaceState(window.history.state, '', url),
}

interface ProjectsStore {
  /** The list of the window's Machine. */
  state: ProjectsState | undefined
  /** The Project a window on a Linked machine shows; null in a window on this Machine. */
  shown: string | null
}

const initialShown = (): string | null => (windowMachine() === null ? null : new URLSearchParams(globalThis.location?.search ?? '').get(PROJECT_PARAM))

const useProjectsStore = create<ProjectsStore>(() => ({ state: undefined, shown: initialShown() }))

/** In a window on a Linked machine, the active Project is the one the window shows. */
function asShown(state: ProjectsState, shown: string | null): ProjectsState {
  if (windowMachine() === null) return state
  const activeId = shown !== null && state.projects.some((project) => project.id === shown) ? shown : null
  return activeId === state.activeId ? state : { ...state, activeId }
}

/**
 * Takes a state of the window's Machine unless a newer one is already here. Broadcasts and list
 * answers can arrive out of order; an equal revision is taken, since it may carry a fresher branch.
 */
export function acceptProjectsState(state: ProjectsState): void {
  const { state: current, shown } = useProjectsStore.getState()
  if (!current || state.revision >= current.revision) useProjectsStore.setState({ state: asShown(state, shown) })
}

/** Asks the window's Machine for the list again (also refreshes the branches). */
export async function refreshProjects(): Promise<void> {
  const result = await invoke('projects.list')
  if (result.ok) acceptProjectsState(result.value)
  else console.error('projects.list failed:', result.error)
}

let started = false

function start(): void {
  if (started) return
  started = true
  try {
    subscribe('projects.changed', acceptProjectsState)
  } catch (error) {
    // No bridge (the preload did not run): show what the list call returns, as other views do,
    // instead of taking the whole window down.
    console.error('projects.changed: cannot subscribe', error)
  }
  // The branch changes outside worfy (a checkout in a terminal); coming back to the window is
  // the moment to look again.
  window.addEventListener('focus', () => void refreshProjects())
  void refreshProjects()
  const machine = windowMachine()
  if (machine !== null) {
    void showOn(machine, useProjectsStore.getState().shown)
    followLinked()
  }
}

/** The Project list and the active Project of the window's Machine; undefined until it has answered once. */
export function useProjects(): ProjectsState | undefined {
  useEffect(start, [])
  return useProjectsStore((store) => store.state)
}

export function activeProject(state: ProjectsState | undefined): ProjectView | undefined {
  return state?.projects.find((project) => project.id === state.activeId)
}

/** The window's address for Machine `machine` (null — this Machine) and Project `projectId`. */
export function addressFor(machine: string | null, projectId: string | null): string {
  const url = new URL(window.location.href)
  if (machine === null) {
    url.searchParams.delete(MACHINE_PARAM)
    url.searchParams.delete(PROJECT_PARAM)
  } else {
    url.searchParams.set(MACHINE_PARAM, machine)
    if (projectId === null) url.searchParams.delete(PROJECT_PARAM)
    else url.searchParams.set(PROJECT_PARAM, projectId)
  }
  return url.href
}

/** Tells Linked machine `machine` which of its Projects this window shows. */
async function showOn(machine: string, projectId: string | null): Promise<void> {
  const result = await invoke('linked.open', { machine, projectId })
  if (!result.ok) console.warn('linked.open failed:', result.error)
}

/**
 * Opens Project `projectId` of Machine `machine` (null — this Machine) in this window: the one way
 * the sidebar, "Add Project" on a Linked machine (worfy-link ticket 11) and a notification
 * (ticket 13) open a Project. On the window's own Machine the window stays loaded: on this Machine
 * the Project becomes its active one (`projects.select`), on a Linked machine only this window
 * shows it. Another Machine loads the window again. Resolves to the reason when it did not open.
 */
export async function openProject(machine: string | null, projectId: string): Promise<string | undefined> {
  const current = windowMachine()
  if (machine === null) {
    // This Machine's own Project: it becomes active here, as a click in the list always did.
    const result = await invokeOn(null, 'projects.select', { id: projectId })
    if (!result.ok) return result.error
    if (current === null) {
      acceptProjectsState(result.value)
      return undefined
    }
    navigation.load(addressFor(null, null))
    return undefined
  }
  if (machine !== current) {
    navigation.load(addressFor(machine, projectId))
    return undefined
  }
  useProjectsStore.setState(({ state }) => ({ shown: projectId, state: state === undefined ? state : asShown(state, projectId) }))
  navigation.replace(addressFor(machine, projectId))
  await showOn(machine, projectId)
  return undefined
}

// ── the Machines and their lists (the sidebar) ─────────────────────────────────

interface LinkedStore {
  /** What this Machine's main knows of the Linked machines: online, sharing, epoch. */
  linked: LinkedState | undefined
  /** The Project lists of Machines other than the window's, by Machine id ('' — this Machine). */
  lists: Record<string, { state?: ProjectsState; error?: string }>
}

const useLinkedStore = create<LinkedStore>(() => ({ linked: undefined, lists: {} }))

const listKey = (machine: string | null): string => machine ?? ''

/** The epoch of the window's Machine when the window loaded; a later one loads the window again. */
let loadedEpoch: number | undefined

/** Takes a linked state from main unless a newer one is already here; may load the window again. */
export function acceptLinkedState(linked: LinkedState): void {
  const current = useLinkedStore.getState().linked
  if (current && linked.revision < current.revision) return
  useLinkedStore.setState({ linked })
  const machine = windowMachine()
  if (machine === null) return
  const info = linked.machines.find((candidate) => candidate.id === machine)
  if (info === undefined) return
  if (loadedEpoch === undefined) {
    loadedEpoch = info.epoch
    return
  }
  // The Machine is back (another connection, sharing on again): what this window subscribed to
  // there is gone; a fresh load takes the current state.
  if (info.epoch !== loadedEpoch && info.online && info.sharing !== 'no') reloadOnceAnswering(info.epoch)
}

/** The epoch reloadOnceAnswering is asking the window's Machine over; undefined when none. */
let asking: number | undefined

/**
 * Loads the window again for `epoch` once the window's Machine answers over it. Both sides dial
 * each other, so a Machine that quits closes two connections: when the first one closes the second
 * takes over (a new epoch, still online), and it closes a moment later. A reload then comes up on
 * a Machine it cannot reach, with no Project and no Canvas. Without an answer the window keeps its
 * Canvas under the "unreachable" line, and the next new epoch (the Machine back) asks again.
 */
function reloadOnceAnswering(epoch: number): void {
  if (asking === epoch) return
  asking = epoch
  void invoke('projects.list').then((result) => {
    if (asking === epoch) asking = undefined
    if (!result.ok) return
    loadedEpoch = epoch
    navigation.reload()
  })
}

let linkedStarted = false

function followLinked(): void {
  if (linkedStarted) return
  linkedStarted = true
  try {
    subscribe('linked.changed', acceptLinkedState)
  } catch (error) {
    console.error('linked.changed: cannot subscribe', error)
  }
  void invoke('linked.state').then((result) => {
    if (result.ok) acceptLinkedState(result.value)
    else console.error('linked.state failed:', result.error)
  })
}

/** What this Machine knows of its Linked machines (online, sharing); undefined until main answered. */
export function useLinked(): LinkedState | undefined {
  useEffect(followLinked, [])
  return useLinkedStore((store) => store.linked)
}

/**
 * The hint of Machine `machine` (null — this Machine) when it shares its Projects with this Machine
 * read-only (worfy-link ticket 25, ADR-0066); null otherwise, and while main has not said yet.
 */
function readOnlyOf(machine: string | null, linked: LinkedState | undefined, name: string | undefined): string | null {
  if (machine === null || linked?.machines.find((candidate) => candidate.id === machine)?.readOnly !== true) return null
  return readOnlyHint(name)
}

/**
 * Why the write actions on Projects of Machine `machine` are inactive: "<Machine> gives this Machine
 * read-only access", or null when they are not. Left out: the window's Machine. Follows the level
 * as main learns it, so a change takes effect without loading the window again.
 */
export function useReadOnly(machine: string | null = windowMachine()): string | null {
  // This Machine's Projects are never read-only: no call to main for them.
  useEffect(() => {
    if (machine !== null) followLinked()
  }, [machine])
  const linked = useLinkedStore((store) => store.linked)
  return readOnlyOf(machine, linked, useMachineName(machine))
}

/** useReadOnly() of the window's Machine outside React: for the code that sends, not only the buttons. */
export function readOnlyNow(): string | null {
  const machine = windowMachine()
  return readOnlyOf(machine, useLinkedStore.getState().linked, linkStateNow()?.linked.find((candidate) => candidate.id === machine)?.name)
}
answerReadOnly(readOnlyNow)

/** The followed lists of Machines other than the window's: key → what was followed and the unsubscribe. */
const followed = new Map<string, { version: string; stop: () => void }>()

function setList(key: string, entry: { state?: ProjectsState; error?: string }): void {
  useLinkedStore.setState(({ lists }) => ({ lists: { ...lists, [key]: entry } }))
}

function acceptListOf(key: string, state: ProjectsState): void {
  const current = useLinkedStore.getState().lists[key]?.state
  if (current && state.revision < current.revision) return
  setList(key, { state })
}

/**
 * Follows the list of Machine `machine` (null — this Machine): one list call and one subscription,
 * made again when `version` changes (the Machine came back, or shares again).
 */
function followList(machine: string | null, version: string): void {
  const key = listKey(machine)
  const before = followed.get(key)
  if (before?.version === version) return
  before?.stop()
  let stop = (): void => undefined
  try {
    stop = subscribeOn(machine, 'projects.changed', (state) => acceptListOf(key, state))
  } catch (error) {
    console.error('projects.changed: cannot subscribe', error)
  }
  followed.set(key, { version, stop })
  void invokeOn(machine, 'projects.list').then((result) => {
    if (followed.get(key)?.version !== version) return
    if (result.ok) acceptListOf(key, result.value)
    else setList(key, { error: result.error })
  })
}

/** Takes a list Machine `machine` (null — this Machine) answered with, whichever Machine the window shows. */
export function acceptMachineProjects(machine: string | null, state: ProjectsState): void {
  if (machine === windowMachine()) acceptProjectsState(state)
  else acceptListOf(listKey(machine), state)
}

function unfollowList(key: string): void {
  followed.get(key)?.stop()
  followed.delete(key)
}

/** A Machine in the sidebar, with its Projects. */
export interface ProjectGroup {
  /** null — this Machine. */
  machine: string | null
  name: string
  /** `this` for this Machine; a Linked machine is online or unavailable (worfy-link ticket 02). */
  state: 'this' | 'online' | 'unavailable'
  /** False when the Machine does not let this one work with its Projects: no Projects are shown. */
  sharing: boolean
  /** It shares its Projects with this Machine read-only (worfy-link ticket 25): the sidebar marks it. */
  readOnly: boolean
  projects: ProjectView[]
  /** The Project this window shows, when it is in this group. */
  selectedId: string | null
  /** Why the list could not be read. */
  error: string | null
}

export interface GroupInput {
  windowMachine: string | null
  /** The list of the window's Machine (useProjects). */
  windowState: ProjectsState | undefined
  link: LinkState | undefined
  linked: LinkedState | undefined
  lists: LinkedStore['lists']
}

/**
 * The sidebar's Projects by Machine; null while there is nothing to group (no Linked machine, and
 * the window on this Machine): the list is then the window's list, as before worfy-link.
 * This Machine first, then the Linked machines by name.
 */
export function groupProjects({ windowMachine: shownMachine, windowState, link, linked, lists }: GroupInput): ProjectGroup[] | null {
  const linkedMachines = link?.linked ?? []
  if (linkedMachines.length === 0 && shownMachine === null) return null
  const listOf = (machine: string | null): { state?: ProjectsState; error?: string } =>
    machine === shownMachine ? (windowState === undefined ? {} : { state: windowState }) : (lists[listKey(machine)] ?? {})
  const own = listOf(null)
  const groups: ProjectGroup[] = [
    {
      machine: null,
      name: link?.machine?.name ?? 'This Machine',
      state: 'this',
      sharing: true,
      readOnly: false,
      projects: own.state?.projects ?? [],
      selectedId: shownMachine === null ? (own.state?.activeId ?? null) : null,
      error: own.error ?? null,
    },
  ]
  const others = [...linkedMachines].sort((a, b) => a.name.localeCompare(b.name))
  for (const machine of others) {
    const info = linked?.machines.find((candidate) => candidate.id === machine.id)
    const online = machine.state === 'online' && !machine.certificateChanged
    const sharing = info?.sharing !== 'no'
    const list = listOf(machine.id)
    groups.push({
      machine: machine.id,
      name: machine.name,
      state: online ? 'online' : 'unavailable',
      sharing,
      readOnly: sharing && info?.readOnly === true,
      projects: online && sharing ? (list.state?.projects ?? []) : [],
      selectedId: machine.id === shownMachine ? (list.state?.activeId ?? null) : null,
      error: online && sharing ? (list.error ?? null) : null,
    })
  }
  return groups
}

/**
 * The sidebar's groups (groupProjects), following the list of every Machine shown: this Machine's
 * and those of the Linked machines that are online and share their Projects.
 */
export function useProjectGroups(link: LinkState | undefined): ProjectGroup[] | null {
  const windowState = useProjects()
  const linked = useLinked()
  const lists = useLinkedStore((store) => store.lists)
  const shownMachine = windowMachine()

  // What to follow, as one string, so the effect runs when it changes and not on every render.
  const wanted = JSON.stringify([
    ...(shownMachine === null ? [] : [['', 'this']]),
    ...(link?.linked ?? [])
      .filter((machine) => machine.id !== shownMachine && machine.state === 'online')
      .map((machine) => {
        const info = linked?.machines.find((candidate) => candidate.id === machine.id)
        return info?.sharing === 'no' ? null : [machine.id, `${info?.epoch ?? 0}:${info?.sharing ?? 'unknown'}`]
      })
      .filter((entry) => entry !== null),
  ])

  useEffect(() => {
    const targets = JSON.parse(wanted) as [string, string][]
    const keys = new Set(targets.map(([key]) => key))
    for (const key of [...followed.keys()]) if (!keys.has(key)) unfollowList(key)
    for (const [key, version] of targets) followList(key === '' ? null : key, version)
  }, [wanted])

  return groupProjects({ windowMachine: shownMachine, windowState, link, linked, lists })
}
