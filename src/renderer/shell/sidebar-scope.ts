// What the sidebar shows (worfy-polish ticket 94): which section its panel holds, and which Projects
// the sections draw from — the Project switcher above the rail.
//
// - The switcher has two answers: «All» — the sections that can mix the Projects of the window's
//   Machine show them all — and one Project. Choosing one Project in it opens that Project (as a row of
//   the Projects section does), and the sections then show it alone; while the switcher stays on one
//   Project it follows the open one. So the saved answer is `all` or `project`, never an id.
// - The sections that hold data for every Project in the renderer (Pipeline, Pull requests, Epics) are
//   filtered by it (projectsInScope). The others (Sessions, ADR) show the open Project in either answer
//   and say so in their header while «All» is chosen (SidebarSection, `scope="current"`).
// - Both choices are kept in this window's localStorage, which lives in userData — worfy's data folder
//   (ADR-0005) — as the drafts of the chat fields are (session/drafts.ts). A window keeps its own
//   choice while it is open; a new window and a restart start from the last choice made in any window.
//   A storage that cannot be read reads as the defaults: «All» and the first section.
import { create } from 'zustand'

/** The answer of the Project switcher: every Project of the window's Machine, or the open one alone. */
export type SidebarScope = 'all' | 'project'

/** The name of the switcher's answer «All». */
export const ALL_PROJECTS = 'All Projects'

/** The keys in localStorage. */
export const SIDEBAR_SCOPE_KEY = 'worfy.sidebar.scope'
export const SIDEBAR_SECTION_KEY = 'worfy.sidebar.section'

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch (error) {
    // Full or refused: the choice holds in this window while it is open.
    console.error(`localStorage: ${key} could not be saved`, error)
  }
}

/** A saved answer of the switcher; anything else, nothing saved included, is «All». */
export function parseScope(saved: string | null): SidebarScope {
  return saved === 'project' ? 'project' : 'all'
}

/**
 * The Projects a section that can mix them draws from: all of them under «All»; under one Project the
 * open one alone — all of them while none is open, so a window without an open Project hides nothing.
 */
export function projectsInScope<T extends { id: string }>(projects: readonly T[], scope: SidebarScope, activeId: string | null | undefined): readonly T[] {
  if (scope === 'all') return projects
  const active = projects.filter((project) => project.id === activeId)
  return active.length ? active : projects
}

/** The section the panel holds: the saved one while a section of that id exists, else the first. */
export function pickSection(saved: string | null, ids: readonly string[]): string | undefined {
  return saved !== null && ids.includes(saved) ? saved : ids[0]
}

interface SidebarScopeStore {
  scope: SidebarScope
  /** The id of the section the panel holds (ShellExtension.id); null — none chosen yet, the first. */
  section: string | null
}

export const useSidebarScope = create<SidebarScopeStore>(() => ({
  scope: parseScope(read(SIDEBAR_SCOPE_KEY)),
  section: read(SIDEBAR_SECTION_KEY),
}))

export function setSidebarScope(scope: SidebarScope): void {
  useSidebarScope.setState({ scope })
  write(SIDEBAR_SCOPE_KEY, scope)
}

/** Shows section `id` in the panel: a press on its rail button, or a section that has to be seen (an ADR the palette opens). */
export function showSidebarSection(id: string): void {
  useSidebarScope.setState({ section: id })
  write(SIDEBAR_SECTION_KEY, id)
}

/** Reads both choices from the storage again: for tests, which share one module between cases. */
export function reloadSidebarScope(): void {
  useSidebarScope.setState({ scope: parseScope(read(SIDEBAR_SCOPE_KEY)), section: read(SIDEBAR_SECTION_KEY) })
}

/**
 * What a section shows on its rail button while it is not in the panel: a count (live Sessions, pull
 * requests that need you) or a dot (a Ticket waits, a Linked machine is offline). `label` is the
 * tooltip and what a screen reader hears.
 */
export interface RailBadge {
  tone: 'working' | 'blocked' | 'ready' | 'muted'
  count?: number
  label: string
}

const useRailBadges = create<Readonly<Record<string, RailBadge | undefined>>>(() => ({}))

function sameBadge(a: RailBadge | undefined, b: RailBadge | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && a.tone === b.tone && a.count === b.count && a.label === b.label)
}

/** Sets or clears the badge of section `id`; a section calls it from an effect as its numbers change. */
export function setRailBadge(id: string, badge: RailBadge | undefined): void {
  if (sameBadge(useRailBadges.getState()[id], badge)) return
  useRailBadges.setState({ [id]: badge })
}

export function useRailBadge(id: string): RailBadge | undefined {
  return useRailBadges((badges) => badges[id])
}
