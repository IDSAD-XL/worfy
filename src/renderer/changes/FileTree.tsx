// The tree of files of the Changes screen (worfy-changes-view ticket 03): the files of the scope by folder, each with
// its status (A, M, D, R, T) and its lines added and deleted. A Ticket in several repositories has the repositories as
// the top level. The files of the workflow (under the Tickets root, `.scratch/`) stand last, as the group Workflow
// files, folded until it is opened. Over MANY_FILES files the folders come folded. The filter narrows the tree to the
// files whose path holds its text, opens every folder that keeps one, and says how many of how many are left; the diff
// beside it shows the same files (DiffScreen.tsx). The diff of a pull request read from GitHub may name fewer files
// than it has (worfy-pr-review ticket 06): `truncatedAt` puts «GitHub lists the first 3,000 files» over the tree.
import type { ReactNode } from 'react'
import type { ChangedFile } from '../../shared/changes/types'
import { count, MANY_FILES, nameOf, treeOf, type FileEntry, type RepoFiles } from './diff-window'

/** «+12 −3», or «binary»; the counts without a separator of thousands. */
export function FileStats({ file }: { file: Pick<ChangedFile, 'additions' | 'deletions' | 'binary'> }) {
  if (file.binary || file.additions === null || file.deletions === null) return <span className="w-changes__stats w-changes__muted">binary</span>
  return (
    <span className="w-changes__stats">
      {file.additions > 0 ? <span className="w-changes__add-n">+{count(file.additions)}</span> : null}
      {file.additions > 0 && file.deletions > 0 ? ' ' : null}
      {file.deletions > 0 ? <span className="w-changes__del-n">−{count(file.deletions)}</span> : null}
    </span>
  )
}

export function StatusLetter({ status }: { status: ChangedFile['status'] }) {
  const words = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', T: 'type changed' } as const
  return (
    <span className={`w-changes__status w-changes__status--${status}`} title={words[status]}>
      {status}
    </span>
  )
}

export interface FileTreeProps {
  repos: readonly RepoFiles[]
  filter: string
  onFilter: (filter: string) => void
  selected: string | null
  onSelect: (key: string) => void
  /** The group Workflow files is open. */
  workflowOpen: boolean
  onWorkflowOpen: (open: boolean) => void
  /** The folders the user opened or folded, against how they come. */
  toggled: ReadonlySet<string>
  onToggle: (key: string) => void
  /** GitHub listed only this many files of a pull request; null or absent when it listed all. */
  truncatedAt?: number | null
  /** What stands at the end of a file's row: the counts and Viewed of Review mode (worfy-pr-review ticket 09); nothing by default. */
  renderRowEnd?: (entry: FileEntry) => ReactNode
}

export function FileTree({ repos, filter, onFilter, selected, onSelect, workflowOpen, onWorkflowOpen, toggled, onToggle, truncatedAt, renderRowEnd }: FileTreeProps) {
  const total = repos.reduce((sum, repo) => sum + repo.files.length, 0)
  const tree = treeOf(repos, filter)
  const filtering = filter.trim() !== ''
  const left = tree.repos.reduce((sum, repo) => sum + repo.folders.reduce((inner, folder) => inner + folder.files.length, 0), 0) + tree.workflow.length
  const foldedFirst = total > MANY_FILES
  const several = repos.length > 1
  const open = (key: string): boolean => filtering || foldedFirst === toggled.has(key)

  const fileRow = (entry: FileEntry, depth: number) => (
    <li key={entry.key}>
      <button
        type="button"
        className={`w-changes__row w-changes__row--file${selected === entry.key ? ' is-selected' : ''}${entry.file.workflow ? ' w-changes__row--workflow' : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        aria-current={selected === entry.key ? 'true' : undefined}
        title={entry.file.oldPath === null ? entry.file.path : `${entry.file.path}\nrenamed from ${entry.file.oldPath}`}
        data-testid="changes-tree-file"
        data-path={entry.file.path}
        data-repo={entry.repo}
        onClick={() => onSelect(entry.key)}
      >
        <StatusLetter status={entry.file.status} />
        <span className="w-changes__name">{nameOf(entry.file.path)}</span>
        <FileStats file={entry.file} />
        {renderRowEnd?.(entry) ?? null}
      </button>
    </li>
  )

  return (
    <div className="w-changes__tree">
      <input
        className="w-changes__filter nodrag"
        type="search"
        placeholder="Filter files…"
        aria-label="Filter files"
        value={filter}
        data-testid="changes-filter"
        onChange={(event) => onFilter(event.target.value)}
      />
      {truncatedAt !== undefined && truncatedAt !== null ? (
        <p className="w-changes__filtered" role="status" data-testid="changes-truncated">
          GitHub lists the first {truncatedAt.toLocaleString('en-US')} files
        </p>
      ) : null}
      {filtering ? (
        <p className="w-changes__filtered" data-testid="changes-filter-count">
          {count(left)} of {count(total)} files
        </p>
      ) : null}
      <ul className="w-changes__list nodrag nowheel" aria-label="Changed files" data-testid="changes-tree">
        {tree.repos.map((repo) => (
          <li key={repo.repo}>
            {several ? (
              <div className="w-changes__row w-changes__row--repo" data-testid="changes-tree-repo">
                {repo.repo}
              </div>
            ) : null}
            {repo.error !== null ? <p className="w-changes__note-text">{repo.error}</p> : null}
            <ul>
              {repo.folders.map((folder) => {
                const unfolded = open(folder.key)
                const depth = several ? 1 : 0
                return (
                  <li key={folder.key}>
                    {folder.path === '' ? null : (
                      <button
                        type="button"
                        className="w-changes__row w-changes__row--folder"
                        style={{ paddingLeft: 8 + depth * 14 }}
                        aria-expanded={unfolded}
                        data-testid="changes-tree-folder"
                        data-path={folder.path}
                        onClick={() => onToggle(folder.key)}
                      >
                        <span aria-hidden="true">{unfolded ? '▾' : '▸'}</span> {folder.path}
                      </button>
                    )}
                    {unfolded || folder.path === '' ? <ul>{folder.files.map((entry) => fileRow(entry, depth + 1))}</ul> : null}
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
        {tree.workflow.length > 0 ? (
          <li>
            <button
              type="button"
              className="w-changes__row w-changes__row--folder w-changes__row--group"
              aria-expanded={workflowOpen || filtering}
              data-testid="changes-workflow-group"
              title="The files under the Tickets root (.scratch/)"
              onClick={() => onWorkflowOpen(!workflowOpen)}
            >
              <span aria-hidden="true">{workflowOpen || filtering ? '▾' : '▸'}</span> Workflow files ({count(tree.workflow.length)})
            </button>
            {workflowOpen || filtering ? <ul>{tree.workflow.map((entry) => fileRow(entry, 1))}</ul> : null}
          </li>
        ) : null}
      </ul>
      {filtering && left === 0 ? (
        <p className="w-changes__empty" data-testid="changes-filter-empty">
          No files match “{filter.trim()}”
        </p>
      ) : null}
    </div>
  )
}
