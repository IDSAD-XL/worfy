// The head of the Changes screen (worfy-changes-view ticket 03): two rows under the Node's title. The first — the menu
// of scopes, built from the answer of `changes.scopes` (a Ticket without a worktree has no Uncommitted; the commits of
// the Ticket are its Commit items), the base and the head with the merge-base, the number of files and the lines
// added and deleted, and Refresh. The second — Inline | Side by side, Wrap, Hide whitespace, and Compare against, the
// branches the answer lists. Part 2 adds Last turn and Since my last look to the same answer: this menu does not
// change for them.
import { useState } from 'react'
import type { ChangesCommit, ChangesScope } from '../../shared/changes/types'
import type { changesRepoListSchema, changesRepoScopesSchema } from '../../shared/ipc/changes'
import type { z } from 'zod'
import { Menu, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../theme/kit/Menu'
import { ToggleGroup, ToggleGroupItem } from '../theme/kit/ToggleGroup'
import { count, scopeKey, type DiffLayout } from './diff-window'

export type RepoScopes = z.infer<typeof changesRepoScopesSchema>
export type RepoList = z.infer<typeof changesRepoListSchema>

const short = (sha: string): string => sha.slice(0, 7)

/** The words of the scope on its menu button. */
function scopeLabel(scope: ChangesScope, commits: Readonly<Record<string, readonly ChangesCommit[]>>): string {
  switch (scope.kind) {
    case 'all':
      return 'All changes'
    case 'uncommitted':
      return 'Uncommitted'
    case 'commit': {
      const commit = commits[scope.repo]?.find((each) => each.sha === scope.sha)
      return commit === undefined ? `Commit ${short(scope.sha)}` : `${commit.short} ${commit.subject}`
    }
    case 'compare':
      return `Compare against ${scope.ref}`
  }
}

export interface ScopeBarProps {
  scopes: readonly RepoScopes[]
  /** The Ticket's commits by repository, for the Commit items. */
  commits: Readonly<Record<string, readonly ChangesCommit[]>>
  /** The answer of `changes.list` for the scope; undefined while it is read. */
  lists: readonly RepoList[] | undefined
  scope: ChangesScope
  onScope: (scope: ChangesScope) => void
  onRefresh: () => void
  layout: DiffLayout
  onLayout: (layout: DiffLayout) => void
  wrap: boolean
  onWrap: (wrap: boolean) => void
  hideWhitespace: boolean
  onHideWhitespace: (hide: boolean) => void
}

/** «origin/main ← demo/03 · base 1a2b3c4 · 6 files + 2 workflow · +184 −22» of one repository. */
function Meta({ list, several }: { list: RepoList; several: boolean }) {
  const workflow = list.files.filter((file) => file.workflow).length
  const files = list.files.length - workflow
  return (
    <span className="w-changes__meta" data-testid="changes-meta" data-repo={list.repo}>
      {several ? <span className="w-changes__strong">{list.repo}: </span> : null}
      {list.base === null ? null : (
        <>
          <span className="w-mono w-changes__strong">{list.base.ref}</span> ← <span className="w-mono w-changes__strong">{list.branch}</span> · base{' '}
          <span className="w-mono w-changes__strong">{short(list.base.mergeBase)}</span> ·{' '}
        </>
      )}
      <span className="w-mono w-changes__strong" data-testid="changes-file-count">
        {count(files)}
      </span>{' '}
      {files === 1 ? 'file' : 'files'}
      {workflow > 0 ? ` + ${count(workflow)} workflow` : ''} · <span className="w-mono w-changes__add-n">+{count(list.additions)}</span>{' '}
      <span className="w-mono w-changes__del-n">−{count(list.deletions)}</span>
      {list.error === null ? null : <span className="w-changes__error"> · {list.error}</span>}
    </span>
  )
}

function Check({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (checked: boolean) => void; testId: string }) {
  return (
    <label className="w-changes__check nodrag">
      <input type="checkbox" checked={checked} data-testid={testId} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

export function ScopeBar({ scopes, commits, lists, scope, onScope, onRefresh, layout, onLayout, wrap, onWrap, hideWhitespace, onHideWhitespace }: ScopeBarProps) {
  const [scopeOpen, setScopeOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const several = scopes.length > 1
  const has = (kind: RepoScopes['scopes'][number]) => scopes.some((repo) => repo.scopes.includes(kind))
  const pick = (key: string) => {
    if (key === 'all' || key === 'uncommitted') onScope({ kind: key })
    else {
      const [kind, repo, value] = key.split('\u0000')
      if (kind === 'commit' && repo !== undefined && value !== undefined) onScope({ kind: 'commit', repo, sha: value })
      if (kind === 'compare' && repo !== undefined && value !== undefined) onScope({ kind: 'compare', repo, ref: value })
    }
  }
  const choose = (key: string) => {
    pick(key)
    setScopeOpen(false)
    setCompareOpen(false)
  }
  const commitRepos = scopes.filter((repo) => repo.scopes.includes('commit') && (commits[repo.repo]?.length ?? 0) > 0)
  const compareRepos = scopes.filter((repo) => repo.scopes.includes('compare') && repo.branches.length > 0)
  const compared = scope.kind === 'compare' ? scope.ref : (scopes[0]?.base?.ref ?? 'base')

  return (
    <div className="w-changes__bars">
      <div className="w-changes__bar">
        <Menu
          open={scopeOpen}
          onOpenChange={setScopeOpen}
          label="Scope"
          testId="changes-scope-menu"
          inNode
          className="w-changes__menu"
          focusOnOpen='[aria-checked="true"]'
          trigger={
            <button type="button" className="w-changes__dropdown nodrag" data-testid="changes-scope" aria-label={`Scope: ${scopeLabel(scope, commits)}`}>
              {scopeLabel(scope, commits)}
            </button>
          }
        >
          <MenuRadioGroup value={scopeKey(scope)} onValueChange={choose}>
            {has('all') ? (
              <MenuRadioItem value="all" className="w-row" testId="changes-scope-item" data-scope="all" closeOnClick>
                <span className="w-row__label">All changes</span>
                <span className="w-row__trailing">the Ticket against the base</span>
              </MenuRadioItem>
            ) : null}
            {has('uncommitted') ? (
              <MenuRadioItem value="uncommitted" className="w-row" testId="changes-scope-item" data-scope="uncommitted" closeOnClick>
                <span className="w-row__label">Uncommitted</span>
                <span className="w-row__trailing">work tree against HEAD</span>
              </MenuRadioItem>
            ) : null}
          </MenuRadioGroup>
          {commitRepos.map((repo) => (
            <div key={repo.repo}>
              <MenuSeparator className="w-changes__menu-separator" />
              <MenuRadioGroup value={scopeKey(scope)} onValueChange={choose} heading={several ? `Commit · ${repo.repo}` : 'Commit'} headingClassName="w-changes__menu-heading">
                {(commits[repo.repo] ?? []).map((commit) => (
                  <MenuRadioItem key={commit.sha} value={scopeKey({ kind: 'commit', repo: repo.repo, sha: commit.sha })} className="w-row" testId="changes-scope-item" data-scope="commit" closeOnClick>
                    <span className="w-row__label">
                      <span className="w-mono">{commit.short}</span> {commit.subject}
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </div>
          ))}
        </Menu>
        {lists === undefined ? <span className="w-changes__meta w-changes__muted">Reading…</span> : lists.map((list) => <Meta key={list.repo} list={list} several={several} />)}
        <span className="w-changes__spacer" />
        <button type="button" className="w-changes__button nodrag" data-testid="changes-refresh" title="Read the diff again" onClick={onRefresh}>
          ↻ Refresh
        </button>
      </div>
      <div className="w-changes__bar">
        <ToggleGroup aria-label="Diff view" className="w-segmented" value={layout} onValueChange={(next: DiffLayout | null) => onLayout(next ?? layout)}>
          <ToggleGroupItem value="inline" className="w-segmented__item nodrag" data-testid="changes-inline">
            Inline
          </ToggleGroupItem>
          <ToggleGroupItem value="side-by-side" className="w-segmented__item nodrag" data-testid="changes-side-by-side">
            Side by side
          </ToggleGroupItem>
        </ToggleGroup>
        <Check label="Wrap" checked={wrap} onChange={onWrap} testId="changes-wrap" />
        <Check label="Hide whitespace" checked={hideWhitespace} onChange={onHideWhitespace} testId="changes-hide-whitespace" />
        <span className="w-changes__spacer" />
        {compareRepos.length > 0 ? (
          <>
            <span className="w-changes__meta">Compare</span>
            <Menu
              open={compareOpen}
              onOpenChange={setCompareOpen}
              label="Compare against"
              testId="changes-compare-menu"
              inNode
              className="w-changes__menu"
              focusOnOpen='[aria-checked="true"]'
              trigger={
                <button type="button" className="w-changes__dropdown w-mono nodrag" data-testid="changes-compare" aria-label={`Compare against ${compared}`}>
                  {compared}
                </button>
              }
            >
              {compareRepos.map((repo) => (
                <MenuRadioGroup key={repo.repo} value={scopeKey(scope)} onValueChange={choose} heading={several ? `Compare against · ${repo.repo}` : 'Compare against'} headingClassName="w-changes__menu-heading">
                  {repo.branches.map((branch) => (
                    <MenuRadioItem key={branch} value={scopeKey({ kind: 'compare', repo: repo.repo, ref: branch })} className="w-row" testId="changes-compare-item" closeOnClick>
                      <span className="w-row__label w-mono">{branch}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              ))}
            </Menu>
          </>
        ) : null}
      </div>
    </div>
  )
}
