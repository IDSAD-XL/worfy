// The list of Projects and the active one, kept in `<WORFY_DATA_DIR>/projects.json` (ADR 0005).
// A Project is a git repository, or a folder above several repositories that the Harness knows as
// one Project (ADR-0045: `profile -C <folder>` answers with code 0 and a `_resolved.workspace`).
// worfy only reads the repository, with `git rev-parse` and `git symbolic-ref`, and never writes
// into it: the list, the settings and the data folder of a Project all live under worfy's data root.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'
import { z } from 'zod'
import type { ProjectsState, ProjectView } from '../../shared/ipc/projects'
import { harnessScriptEnv, type HarnessScriptEnvSource } from '../harness/script-env'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import { claudeHome, dataRoot } from '../storage/paths'
import { readResolvedProfile } from '../workflow/profile'
import { ensureProjectSettings } from './settings'

const storedProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
})
export type StoredProject = z.output<typeof storedProjectSchema>

const projectsFileSchema = z.object({
  projects: z.array(storedProjectSchema),
  activeId: z.string().nullable(),
})
type ProjectsFile = z.output<typeof projectsFileSchema>

/** Runs git with `args`; resolves to trimmed stdout, rejects when git fails. Tests pass a fake. */
export type GitRunner = (args: readonly string[]) => Promise<string>

/**
 * git without the caller's GIT_* variables (a GIT_DIR from a hook would point every call at
 * another repository) and without optional locks, so not even an index refresh is written.
 */
export const runGit: GitRunner = (args) => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value
  }
  env.GIT_OPTIONAL_LOCKS = '0'
  return new Promise((resolve, reject) => {
    execFile('git', args, { env, timeout: 5_000, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout.trim())
    })
  })
}

/**
 * The folder above several repositories that the Harness knows as one Project, for a folder outside
 * git; null when it knows none. Tests pass a fake.
 */
export type WorkspaceOf = (folder: string) => Promise<string | null>

/**
 * `_resolved.workspace` of `bin/profile -C <folder> --json` of the Harness in the app's Claude home.
 * The script runs with the environment of `env` (src/main/harness/script-env.ts): it is
 * `#!/usr/bin/env node`, and worfy's own PATH from Finder has no node.
 */
export function harnessWorkspaceOf(env: HarnessScriptEnvSource): WorkspaceOf {
  return async (folder) => {
    const read = await readResolvedProfile({ root: folder, claudeHome: claudeHome(), env: await env(), log: () => undefined })
    return read.ok ? read.profile.workspace : null
  }
}

/** Hex characters of the path hash that ends every Project id. */
const ID_HASH_LENGTH = 8
const ID_HASH_PATTERN = new RegExp(`^[0-9a-f]{${ID_HASH_LENGTH}}$`)
const ID_HASH_SUFFIX = new RegExp(`-([0-9a-f]{${ID_HASH_LENGTH}})$`)

/**
 * `<folder name>-<sha256(path)[0:8]>`: the Project's id and the name of its data folder. `path` is the
 * root as git (or the Harness) spells it, not the stored path: on Windows git writes `C:/…`, and
 * Project ids saved before the stored path became `C:\…` must stay the same.
 */
export function projectId(repositoryRoot: string): string {
  const hash = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, ID_HASH_LENGTH)
  return `${basename(repositoryRoot) || 'root'}-${hash}`
}

/**
 * The path hash that ends a Project id, or null when the id does not end with one. Unlike the
 * folder-name part, it is always lowercase ASCII, so other parts of main may use it where only
 * such text fits (the host of a Card's address, src/main/cards/protocol.ts).
 */
export function projectIdHash(id: string): string | null {
  return ID_HASH_SUFFIX.exec(id)?.[1] ?? null
}

/** Whether a text has the form of the hash that ends a Project id. */
export function isProjectIdHash(text: string): boolean {
  return ID_HASH_PATTERN.test(text)
}

export type AddResult =
  | { status: 'added'; project: StoredProject; notice: string | null }
  | { status: 'rejected'; reason: string }

export interface ProjectsChange {
  activeId: string | null
  previousActiveId: string | null
  revision: number
}

type Resolved = { ok: true; root: string; notice: string | null } | { ok: false; reason: string }

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export class ProjectStore {
  private loaded: ProjectsFile | undefined
  private revision = 0
  private readonly listeners = new Set<(change: ProjectsChange) => void>()

  /** Does no I/O: the file is read on first use. */
  constructor(
    private readonly root: string,
    private readonly git: GitRunner,
    private readonly workspaceOf: WorkspaceOf,
  ) {}

  get file(): string {
    return join(this.root, 'projects.json')
  }

  /** The folder for a Project's own data (settings, layout, cards); never inside its repository. */
  dataDir(id: string): string {
    return join(this.root, id)
  }

  private data(): ProjectsFile {
    if (!this.loaded) {
      const saved = readJsonFile(this.file, projectsFileSchema) ?? { projects: [], activeId: null }
      const activeId = saved.projects.some((project) => project.id === saved.activeId) ? saved.activeId : null
      // A list saved on Windows before the paths were resolved holds git's `C:/…` spelling.
      const projects = saved.projects.map((project) => ({ ...project, path: resolvePath(project.path) }))
      this.loaded = { projects, activeId }
    }
    return this.loaded
  }

  private commit(next: ProjectsFile): void {
    const previousActiveId = this.data().activeId
    writeJsonFile(this.file, projectsFileSchema, next)
    this.loaded = next
    this.revision += 1
    const change = { activeId: next.activeId, previousActiveId, revision: this.revision }
    for (const listener of this.listeners) {
      try {
        listener(change)
      } catch (error) {
        console.error('[projects] a change listener threw', error)
      }
    }
  }

  /**
   * Called after every change of the list or of the active Project. This is the event other parts
   * of main subscribe to for "the active Project switched" (compare activeId with previousActiveId).
   * Returns the function that unsubscribes.
   */
  onChange(listener: (change: ProjectsChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): readonly StoredProject[] {
    return this.data().projects
  }

  active(): StoredProject | undefined {
    const { projects, activeId } = this.data()
    return projects.find((project) => project.id === activeId)
  }

  find(id: string): StoredProject | undefined {
    return this.data().projects.find((project) => project.id === id)
  }

  /** Like find, but an unknown id is an error. */
  get(id: string): StoredProject {
    const project = this.find(id)
    if (!project) throw new Error(`No Project with id ${id}`)
    return project
  }

  /** The checked-out branch, `HEAD` when detached, null when git cannot read the repository. */
  async branch(path: string): Promise<string | null> {
    try {
      // symbolic-ref also answers in a repository without commits yet, where rev-parse fails.
      return await this.git(['-C', path, 'symbolic-ref', '--short', '-q', 'HEAD'])
    } catch {
      try {
        return await this.git(['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD'])
      } catch {
        return null
      }
    }
  }

  /** The state for the renderer, with each Project's current branch. */
  async state(): Promise<ProjectsState> {
    // Read synchronously before the git calls, so the revision matches the list it goes with.
    const { projects, activeId } = this.data()
    const revision = this.revision
    const views: ProjectView[] = await Promise.all(projects.map(async (project) => ({ ...project, branch: await this.branch(project.path) })))
    return { projects: views, activeId, revision }
  }

  /** Finds the repository root for a folder the user picked. */
  private async resolve(folder: string): Promise<Resolved> {
    try {
      if (!statSync(folder).isDirectory()) return { ok: false, reason: `${folder} is not a folder.` }
    } catch {
      return { ok: false, reason: `${folder} does not exist.` }
    }
    let toplevel: string
    let commonDir: string
    try {
      toplevel = await this.git(['-C', folder, 'rev-parse', '--show-toplevel'])
      commonDir = await this.git(['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    } catch {
      return this.resolveWorkspace(folder)
    }
    if (!toplevel) return { ok: false, reason: `${folder} is not inside a working tree of a git repository.` }

    // A linked worktree shares the main repository's .git folder: its parent is the repository root.
    const root = basename(commonDir) === '.git' ? dirname(commonDir) : toplevel
    let notice: string | null = null
    if (realpathOrSelf(root) !== realpathOrSelf(toplevel)) {
      notice = `${resolvePath(toplevel)} is a worktree of ${resolvePath(root)}; the repository root was added instead.`
    } else if (realpathOrSelf(folder) !== realpathOrSelf(root)) {
      notice = `${folder} is inside the repository ${resolvePath(root)}; the repository root was added instead.`
    }
    return { ok: true, root, notice }
  }

  /**
   * A folder outside git: a Project over several repositories when the Harness knows it as one
   * (ADR-0045), its common folder as the root; any other is refused.
   */
  private async resolveWorkspace(folder: string): Promise<Resolved> {
    const workspace = await this.workspaceOf(folder).catch(() => null)
    if (workspace === null) {
      return {
        ok: false,
        reason: `${folder} is not a git repository. Choose the folder of a git repository; a Project over several repositories is connected in the Harness first.`,
      }
    }
    const notice = realpathOrSelf(folder) === realpathOrSelf(workspace) ? null : `${folder} is inside the Project ${workspace} over several repositories; its folder was added instead.`
    return { ok: true, root: workspace, notice }
  }

  /**
   * Adds the repository that contains `folder` and makes it active (or selects it, if it is already
   * listed). With `keepActive` the active Project stays as it is: an add from a Linked machine does
   * not switch the screens of this Machine (worfy-link ticket 08).
   */
  async add(folder: string, options: { keepActive?: boolean } = {}): Promise<AddResult> {
    const resolved = await this.resolve(folder)
    if (!resolved.ok) return { status: 'rejected', reason: resolved.reason }

    const id = projectId(resolved.root)
    // The git calls above awaited; re-read the list now, so a concurrent change is not lost.
    const { projects, activeId } = this.data()
    const existing = projects.find((project) => project.id === id)
    const path = resolvePath(resolved.root)
    const project = existing ?? { id, name: basename(path) || path, path }

    mkdirSync(this.dataDir(id), { recursive: true })
    ensureProjectSettings(this.dataDir(id))
    this.commit({ projects: existing ? projects : [...projects, project], activeId: options.keepActive === true ? activeId : id })

    const notice = resolved.notice ?? (existing ? `${project.name} is already in the list.` : null)
    return { status: 'added', project, notice }
  }

  select(id: string): void {
    this.get(id)
    this.commit({ ...this.data(), activeId: id })
  }

  /**
   * Removes the Project from the list; its data folder is kept. With `keepActive` the active
   * Project may not be removed (a Linked machine does not switch the screens of this Machine,
   * worfy-link ticket 08): that throws, and nothing changes.
   */
  remove(id: string, options: { keepActive?: boolean } = {}): void {
    this.get(id)
    const { projects, activeId } = this.data()
    if (options.keepActive === true && activeId === id) throw new Error(`${this.get(id).name} is the active Project of this Machine; only its own screen removes it`)
    const rest = projects.filter((project) => project.id !== id)
    this.commit({ projects: rest, activeId: activeId === id ? (rest[0]?.id ?? null) : activeId })
  }
}

let shared: ProjectStore | undefined

/** The store of the running app, over dataRoot(). Created on first use; creating it does no I/O. */
export function projectStore(): ProjectStore {
  shared ??= new ProjectStore(dataRoot(), runGit, harnessWorkspaceOf(harnessScriptEnv))
  return shared
}
