// The Changes view (worfy-changes-view ticket 08; the owner's decision D1 of 2026-11-21): the diff of a Ticket's worktree
// or branch against the base over the whole main area, as the Pull requests view shows a PR — the same diff screen as
// Review mode (DiffScreen.tsx). The button Changes on the Ticket card, Open changes of the Command palette and the block
// of a comment on code in a sent message open it (changes/open.ts); one button back — «← Canvas», or «← Session» when
// it was opened from a message of the Session view — and Esc go back. Another Project picked in the sidebar goes back
// to the Canvas.
//
// What it reads comes from git in main through the channels of ticket 02 (`changes.scopes`, `changes.list`,
// `changes.file`, `changes.commits`; src/main/changes/). The head is ScopeBar.tsx, the tree and the diff DiffScreen.tsx,
// drawn by windows of a few screens (diff-window.ts). The scope last picked is kept per Ticket while the window lives
// (open.ts); the view — Inline or Side by side, Wrap, Hide whitespace, the filter — is this screen's only. Refresh reads
// it all again; part 1 has no live refresh.
//
// The comments on lines (ticket 05; changes/line-comments.tsx): «+» in the gutter, the key c on the lines picked, the
// tray at the bottom with «To» and Send. A read-only screen (a Linked machine with Read only) reads the diff and has
// none of them.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangesCommit, ChangesScope, ChangesTicketRef } from '../../shared/changes/types'
import { failureReason } from '../../shared/ipc/channels'
// The channels must be declared in this window too: a `project` channel goes to the Machine of the Project (ipc.ts).
import '../../shared/ipc/changes'
import { repoFactsOf } from '../../shared/workflow/types'
import { invoke } from '../ipc'
import { useProjects, useReadOnly } from '../projects/useProjects'
import { setView, useNavigation } from '../session/navigation'
import { Button } from '../theme/Button'
import { useWorkflow } from '../workflow/useWorkflow'
import { type DiffPaneHandle } from './DiffPane'
import { useDiffKeys } from './diff-keys'
import { DiffScreen } from './DiffScreen'
import { orderedFiles, scopeKey, type DiffLayout, type RepoFiles } from './diff-window'
import { useLineComments } from './line-comments'
import { changesScopeFor, closeChanges, setChangesScope, useChangesView, type ChangesBack, type ChangesSubject } from './open'
import { ScopeBar, type RepoList, type RepoScopes } from './ScopeBar'
import './changes.css'

const nn = (num: number): string => String(num).padStart(2, '0')

/** The words of the button back. */
const BACK_WORDS: Record<ChangesBack, string> = { canvas: '← Canvas', session: '← Session' }

/** A read of `key`: its answer, or why it failed. */
type Read<T> = { of: string; value: T; error: null } | { of: string; value: null; error: string }

export interface ChangesViewProps {
  projectId: string
  /** The Project's folder: the workflow model names the Ticket's `Branch:` and `Repo:` lines. */
  root: string | undefined
  subject: ChangesSubject
  back: ChangesBack
  /** The view is on screen: only then it takes keys. */
  active: boolean
}

export function ChangesView({ projectId, root, subject, back, active }: ChangesViewProps) {
  const readOnly = useReadOnly()
  const { model, error: workflowError } = useWorkflow(root)
  const found = model?.tickets.find((each) => each.epic === subject.epic && each.num === subject.num)
  const branch = found?.branch ?? null
  const reposKey = found === undefined ? '' : repoFactsOf(found).repos.join('\n')
  const ticket = useMemo<ChangesTicketRef>(() => ({ kind: 'ticket', epic: subject.epic, num: subject.num, branch, ...(reposKey === '' ? {} : { repos: reposKey.split('\n') }) }), [subject.epic, subject.num, branch, reposKey])
  // The model names the Ticket's `Branch:` and `Repo:` lines: the reads wait for it, unless it failed.
  const ready = model !== undefined || workflowError !== undefined

  const scope = useChangesView((state) => changesScopeFor(state.scopes, projectId, subject))
  const setScope = (next: ChangesScope) => setChangesScope(projectId, subject, next)
  const [layout, setLayout] = useState<DiffLayout>('inline')
  const [wrap, setWrap] = useState(false)
  const [hideWhitespace, setHideWhitespace] = useState(false)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [generation, setGeneration] = useState(0)

  const scopesFor = JSON.stringify([projectId, ticket, generation])
  const [scopesRead, setScopesRead] = useState<Read<RepoScopes[]> | null>(null)
  const [commitsRead, setCommitsRead] = useState<{ of: string; byRepo: Record<string, ChangesCommit[]> } | null>(null)
  useEffect(() => {
    if (!ready) return
    const of = scopesFor
    // An answer for a key that is no longer the view's is dropped: a late one would put the screen back on «Reading…».
    let current = true
    void invoke('changes.scopes', { projectId, subject: ticket }).then((result) => {
      if (!current) return
      if (!result.ok) {
        setScopesRead({ of, value: null, error: failureReason('changes.scopes', result.error) })
        return
      }
      setScopesRead({ of, value: result.value.repos, error: null })
      // The Commit items of the menu: the Ticket's commits in each repository that has a base.
      for (const repo of result.value.repos) {
        if (!repo.scopes.includes('commit') || repo.base === null) continue
        void invoke('changes.commits', { projectId, subject: ticket, repo: repo.repo }).then((commits) => {
          if (!current || !commits.ok) return
          setCommitsRead((previous) => ({ of, byRepo: { ...(previous?.of === of ? previous.byRepo : {}), [repo.repo]: commits.value.commits } }))
        })
      }
    })
    return () => {
      current = false
    }
  }, [ready, scopesFor, projectId, ticket])
  const scopes = scopesRead?.of === scopesFor ? scopesRead : null
  const commits = commitsRead?.of === scopesFor ? commitsRead.byRepo : {}

  const listFor = JSON.stringify([scopesFor, scope, hideWhitespace])
  const [listRead, setListRead] = useState<Read<RepoList[]> | null>(null)
  const hasRepos = (scopes?.value?.length ?? 0) > 0
  useEffect(() => {
    if (!ready || !hasRepos) return
    const of = listFor
    let current = true
    void invoke('changes.list', { projectId, subject: ticket, scope, hideWhitespace }).then((result) => {
      if (!current) return
      setListRead(result.ok ? { of, value: result.value.repos, error: null } : { of, value: null, error: failureReason('changes.list', result.error) })
    })
    return () => {
      current = false
    }
    // `scope` is in `listFor`; the read starts again only when the key does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hasRepos, listFor])
  const list = listRead?.of === listFor ? listRead : null

  const repos: RepoFiles[] = useMemo(() => (list?.value ?? []).map((each) => ({ repo: each.repo, files: each.files, error: each.error })), [list])
  const entries = useMemo(() => orderedFiles(repos, filter, workflowOpen), [repos, filter, workflowOpen])
  const pane = useRef<DiffPaneHandle>(null)
  const frame = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const comments = useLineComments({ projectId, subject, scope, scopes: scopes?.value ?? [], lists: list?.value ?? undefined, entries, readOnly, pane, body, hideWhitespace, generation })
  const select = (key: string) => {
    setChosen(key)
    pane.current?.scrollToFile(key)
  }
  useDiffKeys({ active, frame, entries, chosen, select, pane, commentKey: comments.commentKey, onEscape: closeChanges })

  const ref = `${subject.epic}/${nn(subject.num)}`
  let content
  if (scopes?.error != null) content = <p className="w-changes__message">{scopes.error}</p>
  else if (scopes === null) content = <p className="w-changes__message w-changes__muted">Reading the changes of {ref}…</p>
  else if (!hasRepos)
    content = (
      <p className="w-changes__message" data-testid="changes-none">
        Ticket {ref} has no worktree or branch to read
      </p>
    )
  else
    content = (
      <>
        <ScopeBar
          scopes={scopes.value ?? []}
          commits={commits}
          lists={list?.value ?? undefined}
          scope={scope}
          onScope={setScope}
          onRefresh={() => setGeneration((value) => value + 1)}
          layout={layout}
          onLayout={setLayout}
          wrap={wrap}
          onWrap={setWrap}
          hideWhitespace={hideWhitespace}
          onHideWhitespace={setHideWhitespace}
        />
        {list?.error != null ? <p className="w-changes__message">{list.error}</p> : null}
        <DiffScreen
          tree={{ repos, filter, onFilter: setFilter, selected: chosen, onSelect: select, workflowOpen, onWorkflowOpen: setWorkflowOpen }}
          diff={{
            ref: pane,
            projectId,
            subject: ticket,
            scope,
            hideWhitespace,
            layout,
            wrap,
            entries: list === null ? [] : entries,
            several: repos.length > 1,
            selected: chosen,
            generation,
            ...comments.diff,
          }}
        />
        {comments.tray}
        {comments.overlay}
      </>
    )

  return (
    <section ref={frame} className="w-changes w-changes--view" aria-label={`Changes of ${ref}`} data-testid="changes-view" data-ticket={ref} data-scope={scopeKey(scope)}>
      <header className="w-changes__head">
        <Button data-testid="changes-back" title={`Back to the ${back === 'canvas' ? 'Canvas' : 'Session view'} (Esc)`} onClick={closeChanges}>
          {BACK_WORDS[back]}
        </Button>
        <span className="w-changes__title">
          Changes · Ticket <span className="w-mono">{nn(subject.num)}</span> · <span className="w-mono">{subject.epic}</span>
        </span>
        {readOnly !== null ? (
          <span className="w-changes__chip" title={readOnly}>
            Read only
          </span>
        ) : null}
      </header>
      {/* tabIndex -1: the view takes the focus at each opening, and a click on its empty space keeps it in the view. */}
      <div ref={body} className="w-changes__body" tabIndex={-1} data-testid="changes-body">
        {content}
      </div>
    </section>
  )
}

/**
 * The view as the shell mounts it (AppShell.tsx): the Ticket openChanges gave, the focus on the view at each opening,
 * and back to the Canvas when another Project is picked in the sidebar. One screen per Ticket: another Ticket starts
 * the view anew.
 */
export function ChangesScreen({ activeProjectId }: { activeProjectId?: string | undefined }) {
  const active = useNavigation((state) => state.view === 'changes')
  const projectId = useChangesView((state) => state.projectId)
  const subject = useChangesView((state) => state.subject)
  const back = useChangesView((state) => state.back)
  const opened = useChangesView((state) => state.opened)
  const projects = useProjects()
  const root = projects?.projects.find((project) => project.id === projectId)?.path
  const holder = useRef<HTMLDivElement>(null)
  const focused = useRef(0)
  const lastProject = useRef(activeProjectId)

  // Another Project picked in the sidebar: the Ticket on screen is not its own.
  useEffect(() => {
    const before = lastProject.current
    lastProject.current = activeProjectId
    if (before === activeProjectId) return
    if (useNavigation.getState().view === 'changes') setView('canvas')
  }, [activeProjectId])

  // The focus at each opening, so the keys work at once.
  useEffect(() => {
    if (!active || opened === focused.current) return
    focused.current = opened
    holder.current?.querySelector<HTMLElement>('[data-testid="changes-body"]')?.focus({ preventScroll: true })
  }, [active, opened])

  return (
    <div className="w-changes-holder" ref={holder}>
      {projectId === null || subject === null ? (
        <p className="w-changes__message w-changes__muted">No changes are open. They open from the button Changes of a Ticket card.</p>
      ) : (
        <ChangesView key={`${projectId}:${subject.epic}/${subject.num}`} projectId={projectId} root={root} subject={subject} back={back} active={active} />
      )}
    </div>
  )
}
