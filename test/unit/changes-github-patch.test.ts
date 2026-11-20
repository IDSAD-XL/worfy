// The diff of a pull request read from GitHub (worfy-pr-review ticket 06, src/main/changes/github.ts): a file of
// `GET /repos/{o}/{r}/pulls/{n}/files` becomes a ChangedFile, and its `patch` — hunks without the git headers — becomes
// the same hunks src/shared/changes/parse.ts gives for a local diff. A file GitHub sends without `patch` (too large, or
// binary) reads as «Large diff · Open on GitHub». The repository, the paths and the texts are made up.
import { describe, expect, it } from 'vitest'
import { patchHunks, prFileDiff, prFileOf, type GithubFile } from '../../src/main/changes/github'

const BLOB = 'https://github.com/acme/api/blob/1111111111111111111111111111111111111111'

function raw(fields: Partial<GithubFile> & Pick<GithubFile, 'filename'>): GithubFile {
  return { status: 'modified', additions: 0, deletions: 0, changes: 0, sha: 'a'.repeat(40), blob_url: `${BLOB}/${fields.filename}`, ...fields }
}

describe('the patch of a file GitHub sends', () => {
  it('reads as hunks with the numbers of both sides, the section and «No newline at end of file»', () => {
    const hunks = patchHunks('@@ -1,3 +1,4 @@ export function retry()\n const a = 1\n-const b = 2\n+const b = 3\n+const c = 4\n const d = 5\n@@ -10,2 +11,2 @@\n x\n-y\n\\ No newline at end of file\n+z\n\\ No newline at end of file')
    expect(hunks).toHaveLength(2)
    const [first, second] = hunks
    expect(first).toMatchObject({ header: '@@ -1,3 +1,4 @@ export function retry()', oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, section: 'export function retry()' })
    expect(first!.lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text])).toEqual([
      ['context', 1, 1, 'const a = 1'],
      ['del', 2, null, 'const b = 2'],
      ['add', null, 2, 'const b = 3'],
      ['add', null, 3, 'const c = 4'],
      ['context', 3, 4, 'const d = 5'],
    ])
    expect(second!.lines.map((line) => [line.kind, line.oldLine, line.newLine, line.noNewline])).toEqual([
      ['context', 10, 11, false],
      ['del', 11, null, true],
      ['add', null, 12, true],
    ])
  })

  it('a deleted line that reads like a header of git stays a line of its hunk', () => {
    const [hunk] = patchHunks('@@ -1,2 +1,1 @@\n--- a/old\n keep')
    expect(hunk!.lines.map((line) => [line.kind, line.text])).toEqual([
      ['del', '-- a/old'],
      ['context', 'keep'],
    ])
  })

  it('a modified file: status M, its counts, the blob id of the new side, its page on GitHub; the diff is the hunks', () => {
    const entry = prFileOf(raw({ filename: 'src/net/retry.ts', additions: 2, deletions: 1, changes: 3, patch: '@@ -1,2 +1,3 @@\n a\n-b\n+B\n+c' }))
    expect(entry.file).toMatchObject({ path: 'src/net/retry.ts', oldPath: null, status: 'M', additions: 2, deletions: 1, binary: false, newBlob: 'a'.repeat(40), oldBlob: null, untracked: false, workflow: false, fold: null, url: `${BLOB}/src/net/retry.ts` })
    const diff = prFileDiff(entry, {})
    expect(diff).toMatchObject({ kind: 'hunks', path: 'src/net/retry.ts', oldPath: null, whole: false })
    expect(diff.kind === 'hunks' ? diff.hunks[0]!.lines.map((line) => line.kind) : []).toEqual(['context', 'del', 'add', 'add'])
  })

  it('a renamed file: status R with its old path, and the hunks of what changed in it', () => {
    const entry = prFileOf(raw({ filename: 'src/net/backoff.ts', previous_filename: 'src/net/delay.ts', status: 'renamed', additions: 1, deletions: 1, changes: 2, patch: '@@ -3,1 +3,1 @@\n-const ms = 100\n+const ms = 200' }))
    expect(entry.file).toMatchObject({ path: 'src/net/backoff.ts', oldPath: 'src/net/delay.ts', status: 'R', additions: 1, deletions: 1 })
    expect(prFileDiff(entry, {})).toMatchObject({ kind: 'hunks', path: 'src/net/backoff.ts', oldPath: 'src/net/delay.ts' })
  })

  it('a renamed file with no line changed: no patch, not binary, no hunks', () => {
    const entry = prFileOf(raw({ filename: 'b.ts', previous_filename: 'a.ts', status: 'renamed' }))
    expect(entry.file).toMatchObject({ status: 'R', binary: false, additions: 0, deletions: 0 })
    expect(prFileDiff(entry, {})).toMatchObject({ kind: 'hunks', hunks: [] })
  })

  it('a file without patch and with lines counted — too large for GitHub — reads as «Large diff · Open on GitHub»', () => {
    const entry = prFileOf(raw({ filename: 'data/big.json', additions: 25_000, deletions: 3, changes: 25_003 }))
    expect(entry.file).toMatchObject({ binary: false, additions: 25_000, deletions: 3, fold: null })
    expect(prFileDiff(entry, {})).toEqual({ kind: 'no-patch', path: 'data/big.json', url: `${BLOB}/data/big.json` })
    expect(prFileDiff(entry, { expand: true })).toEqual({ kind: 'no-patch', path: 'data/big.json', url: `${BLOB}/data/big.json` })
  })

  it('a binary file — no patch, no lines — is binary, without counts, and reads as «Large diff · Open on GitHub» too', () => {
    const entry = prFileOf(raw({ filename: 'img/logo.png', status: 'added' }))
    expect(entry.file).toMatchObject({ status: 'A', binary: true, additions: null, deletions: null, fold: null })
    expect(prFileDiff(entry, {})).toEqual({ kind: 'no-patch', path: 'img/logo.png', url: `${BLOB}/img/logo.png` })
  })

  it('a deleted file has no blob on the new side; added, removed, changed and copied map to A, D, T, A', () => {
    expect(prFileOf(raw({ filename: 'x', status: 'removed', deletions: 1, changes: 1, patch: '@@ -1 +0,0 @@\n-x' })).file).toMatchObject({ status: 'D', newBlob: null })
    expect(prFileOf(raw({ filename: 'x', status: 'added', additions: 1, changes: 1, patch: '@@ -0,0 +1 @@\n+x' })).file.status).toBe('A')
    expect(prFileOf(raw({ filename: 'x', status: 'changed' })).file.status).toBe('T')
    expect(prFileOf(raw({ filename: 'x', previous_filename: 'y', status: 'copied', additions: 1, changes: 1, patch: '@@ -0,0 +1 @@\n+x' })).file).toMatchObject({ status: 'A', oldPath: null })
  })

  it('a lock file and a long patch come folded until «Show» asks for them, as a local diff does', () => {
    const lock = prFileOf(raw({ filename: 'pnpm-lock.yaml', additions: 2, deletions: 0, changes: 2, patch: '@@ -1 +1,3 @@\n a\n+b\n+c' }))
    expect(lock.file.fold).toBe('lock')
    expect(prFileDiff(lock, {})).toEqual({ kind: 'folded', path: 'pnpm-lock.yaml', reason: 'lock', lines: 2 })
    expect(prFileDiff(lock, { expand: true }).kind).toBe('hunks')
  })
})
