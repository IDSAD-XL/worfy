import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChangesCommit, ChangesScope } from '../../../shared/changes/types'
import { failureReason } from '../../../shared/ipc/channels'
// The channels must be declared in this window too: a `project` channel goes to the Machine of the Project (ipc.ts).
import '../../../shared/ipc/changes'
import { repoFactsOf } from '../../../shared/workflow/types'
import { changesScopeOf, changesSubjectOf, CHANGES_KIND, CHANGES_SIZE, type ChangesSubject } from '../../changes/open'
import { DiffPane, type ChangesTicket, type DiffPaneHandle } from '../../changes/DiffPane'
import { orderedFiles, scopeKey, type DiffLayout, type RepoFiles } from '../../changes/diff-window'
import { FileTree } from '../../changes/FileTree'
import { useLineComments } from '../../changes/line-comments'
import { ScopeBar, type RepoList, type RepoScopes } from '../../changes/ScopeBar'
import '../../changes/changes.css'
import { invoke } from '../../ipc'
import { activeProject, useProjects, useReadOnly } from '../../projects/useProjects'
import { useWorkflow } from '../../workflow/useWorkflow'
import { NodeResizeClamp } from '../NodeResizeClamp'
import { NODE_HEADER } from '../node-header'
import { useLayoutOps } from '../useLayout'
import type { CanvasNodeProps } from './index'

// The Changes Node (worfy-changes-view ticket 03; the screen of the spec): the diff of a Ticket's worktree or branch against
// the base, read from git in main through the channels of ticket 02 (`changes.scopes`, `changes.list`,
// `changes.file`, `changes.commits`; src/main/changes/). Its data is its subject, the Ticket, and the scope last
// picked (changes/open.ts); the view — Inline or Side by side, Wrap, Hide whitespace, the filter — is this screen's
// only. One Node per Ticket: the button Changes on the card and Open changes of the Command palette go to it once it
// is there (canvas/actions/Changes.tsx).
//
// The comments on lines (ticket 05; changes/line-comments.tsx): «+» in the gutter, the key c on the lines picked, the
// tray at the bottom with «To» and Send. A read-only screen has none of them.
//
// The head is ScopeBar.tsx, the tree FileTree.tsx, the diff DiffPane.tsx, drawn by windows of a few screens
// (diff-window.ts). Keys while the focus is in the Node: j and k — the next and the previous file, n and p — the next
// and the previous hunk, c — a comment on the lines picked. Refresh reads it all again; part 1 has no live refresh. In a focus tile (focus mode) the Node
// works as on the Canvas: the tile draws this component. The kind is neutral, as every Node type without an ADR of its
// own colour (ADR-0077): no band, no icon colour, the minimap's grey.
export const kind = 'changes' satisfies typeof CHANGES_KIND
export const defaultWidth = 960 satisfies typeof CHANGES_SIZE.w
export const defaultHeight = 640 satisfies typeof CHANGES_SIZE.h
export const minimapColor = 'var(--border-strong)'

const nn = (num: number): string => String(num).padStart(2, '0')

/** A read of `key`: its answer, or why it failed. */
type Read<T> = { of: string; value: T; error: null } | { of: string; value: null; error: string }

/** The keys of the Node: true when it took the press. */
type KeyAction = 'next-file' | 'previous-file' | 'next-hunk' | 'previous-hunk'
const KEYS: Readonly<Record<string, KeyAction>> = { j: 'next-file', k: 'previous-file', n: 'next-hunk', p: 'previous-hunk' }

/** The title row of the Node: the grip that moves it, and what the toasts of a focus tile keep clear of. */
function Head({ children }: { children: ReactNode }) {
  return (
    <div className="w-changes__head" {...NODE_HEADER}>
      {children}
    </div>
  )
}

function Screen({ id, projectId, root, subject, data, selected }: { id: string; projectId: string; root: string | undefined; subject: ChangesSubject; data: Record<string, unknown>; selected: boolean }) {
  const ops = useLayoutOps()
  const readOnly = useReadOnly()
  const { model, error: workflowError } = useWorkflow(root)
  const found = model?.tickets.find((each) => each.epic === subject.epic && each.num === subject.num)
  const branch = found?.branch ?? null
  const reposKey = found === undefined ? '' : repoFactsOf(found).repos.join('\n')
  const ticket = useMemo<ChangesTicket>(() => ({ epic: subject.epic, num: subject.num, branch, ...(reposKey === '' ? {} : { repos: reposKey.split('\n') }) }), [subject.epic, subject.num, branch, reposKey])
  // The model names the Ticket's `Branch:` and `Repo:` lines: the reads wait for it, unless it failed.
  const ready = model !== undefined || workflowError !== undefined

  // The scope is the Node's data; on a read-only screen, which cannot change the Layout, this screen's own.
  const [ownScope, setOwnScope] = useState<ChangesScope | null>(null)
  const scope = readOnly !== null && ownScope !== null ? ownScope : changesScopeOf(data)
  const setScope = (next: ChangesScope) => {
    if (readOnly !== null) setOwnScope(next)
    else void ops.apply({ op: 'patchData', id, data: { scope: next } })
  }
  const [layout, setLayout] = useState<DiffLayout>('inline')
  const [wrap, setWrap] = useState(false)
  const [hideWhitespace, setHideWhitespace] = useState(false)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<string | null>(null)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const [generation, setGeneration] = useState(0)

  const scopesFor = JSON.stringify([projectId, ticket, generation])
  const [scopesRead, setScopesRead] = useState<Read<RepoScopes[]> | null>(null)
  const [commitsRead, setCommitsRead] = useState<{ of: string; byRepo: Record<string, ChangesCommit[]> } | null>(null)
  useEffect(() => {
    if (!ready) return
    const of = scopesFor
    // An answer for a key that is no longer the Node's is dropped: a late one would put the screen back on «Reading…».
    let current = true
    void invoke('changes.scopes', { projectId, ticket }).then((result) => {
      if (!current) return
      if (!result.ok) {
        setScopesRead({ of, value: null, error: failureReason('changes.scopes', result.error) })
        return
      }
      setScopesRead({ of, value: result.value.repos, error: null })
      // The Commit items of the menu: the Ticket's commits in each repository that has a base.
      for (const repo of result.value.repos) {
        if (!repo.scopes.includes('commit') || repo.base === null) continue
        void invoke('changes.commits', { projectId, ticket, repo: repo.repo }).then((commits) => {
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
    void invoke('changes.list', { projectId, ticket, scope, hideWhitespace }).then((result) => {
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
  const root$ = useRef<HTMLDivElement>(null)
  const comments = useLineComments({ projectId, subject, scope, scopes: scopes?.value ?? [], lists: list?.value ?? undefined, entries, readOnly, pane, body: root$, hideWhitespace, generation })
  const select = (key: string) => {
    setChosen(key)
    pane.current?.scrollToFile(key)
  }

  // j, k, n, p and c while the focus is in the Node, not in its filter or a menu.
  const latest = useRef({ entries, chosen, select, commentKey: comments.commentKey })
  useEffect(() => {
    latest.current = { entries, chosen, select, commentKey: comments.commentKey }
  })
  useEffect(() => {
    const element = root$.current
    if (element === null) return
    const onKey = (event: KeyboardEvent) => {
      const action = KEYS[event.key]
      if ((action === undefined && event.key !== 'c') || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]') !== null) return
      if (action === undefined) {
        if (latest.current.commentKey()) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
      const { entries: files, chosen: at, select: go } = latest.current
      event.preventDefault()
      event.stopPropagation()
      if (action === 'next-hunk' || action === 'previous-hunk') {
        pane.current?.moveHunk(action === 'next-hunk' ? 1 : -1)
        return
      }
      if (files.length === 0) return
      const index = files.findIndex((entry) => entry.key === at)
      const next = action === 'next-file' ? Math.min(files.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1)
      go(files[next]!.key)
    }
    element.addEventListener('keydown', onKey)
    return () => element.removeEventListener('keydown', onKey)
  }, [])

  const ref = `${subject.epic}/${nn(subject.num)}`
  let body
  if (scopes?.error != null) body = <p className="w-changes__message">{scopes.error}</p>
  else if (scopes === null) body = <p className="w-changes__message w-changes__muted">Reading the changes of {ref}…</p>
  else if (!hasRepos)
    body = (
      <p className="w-changes__message" data-testid="changes-none">
        Ticket {ref} has no worktree or branch to read
      </p>
    )
  else
    body = (
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
        <div className="w-changes__main">
          <FileTree
            repos={repos}
            filter={filter}
            onFilter={setFilter}
            selected={chosen}
            onSelect={select}
            workflowOpen={workflowOpen}
            onWorkflowOpen={setWorkflowOpen}
            toggled={toggled}
            onToggle={(key) =>
              setToggled((set) => {
                const next = new Set(set)
                if (!next.delete(key)) next.add(key)
                return next
              })
            }
          />
          <DiffPane
            ref={pane}
            projectId={projectId}
            ticket={ticket}
            scope={scope}
            hideWhitespace={hideWhitespace}
            layout={layout}
            wrap={wrap}
            entries={list === null ? [] : entries}
            several={repos.length > 1}
            selected={chosen}
            generation={generation}
            {...comments.diff}
          />
        </div>
        {comments.tray}
        {comments.overlay}
      </>
    )

  return (
    <article className="w-node-surface w-changes" aria-label={`Changes of ${ref}`} data-testid="changes-node" data-node-id={id} data-ticket={ref} data-scope={scopeKey(scope)}>
      <NodeResizeClamp isVisible={selected} minWidth={560} minHeight={320} onResizeEnd={(_event, { x, y, width, height }) => ops.apply({ op: 'resize', id, x, y, w: width, h: height })} />
      <Head>
        <span className="w-changes__title">
          Changes · Ticket <span className="w-mono">{nn(subject.num)}</span> · <span className="w-mono">{subject.epic}</span>
        </span>
        {readOnly !== null ? (
          <span className="w-changes__chip" title={readOnly}>
            Read only
          </span>
        ) : null}
      </Head>
      {/* tabIndex -1: a click anywhere in the screen puts the focus here, so j, k, n and p reach the Node's keys. */}
      <div ref={root$} className="w-changes__body" tabIndex={-1} data-testid="changes-body">
        {body}
      </div>
    </article>
  )
}

export default function ChangesNode({ id, data, selected }: CanvasNodeProps) {
  const project = activeProject(useProjects())
  const subject = changesSubjectOf(data.node.data)
  if (project === undefined) return null
  if (subject === null) {
    return (
      <article className="w-node-surface w-changes" aria-label="Changes" data-testid="changes-node" data-node-id={id}>
        <Head>
          <span className="w-changes__title">Changes</span>
        </Head>
        <p className="w-changes__message">This Node names no Ticket</p>
      </article>
    )
  }
  return <Screen id={id} projectId={project.id} root={project.path} subject={subject} data={data.node.data} selected={selected} />
}
