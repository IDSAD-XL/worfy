// The draft of a review (worfy-pr-review ticket 07, src/main/github/pr-review-draft.ts), its pure part:
// - the draft's `payload` is the body of GitHub's POST .../pulls/{n}/reviews that harness/bin/review-draft-lint takes —
//   the lint of the repository, over a temporary HOME and HARNESS_HOME, finds nothing in it;
// - a change of the person makes the comment theirs (`by: 'person'`), the other comments keep their author;
// - after a new head a comment is found again by the text of its lines, and stays on its old line, marked moved, when
//   that text is gone.
// The texts, owners and repositories are invented.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newReviewDraft, putComment, reanchor, removeComment, reviewDraftFilePath, reviewPayloadOf, ReviewDraftRefusal, setViewed } from '../../src/main/github/pr-review-draft'
import { reviewDraftSchema, type ReviewDraft } from '../../src/shared/ipc/pr-review'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const LINT = join(process.cwd(), 'harness', 'bin', 'review-draft-lint')
const RULES = join(process.cwd(), 'harness', 'skills', 'human-review-setup', 'template', 'lint.json')
const REPO = 'demo-org/api'
const PR = 118
const HEAD = 'a1b2c3d4e5f6'
const NEXT = 'f6e5d4c3b2a1'

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) removeTestTree(dir)
})

function temp(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-pr-review-')))
  temps.push(dir)
  return dir
}

/** review-draft-lint of the repository on `draft`, with the template's lint.json, in a folder of no registered project. */
function lint(draft: unknown): { status: number | null; stdout: string; stderr: string } {
  const base = temp()
  const home = join(base, 'home')
  const harnessHome = join(base, 'harness-home')
  const project = join(base, 'project')
  for (const dir of [home, join(harnessHome, 'gate'), project]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [] }))
  const file = join(base, 'draft.json')
  writeFileSync(file, JSON.stringify(draft))
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
  for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete env[name]
  const run = spawnSync(scriptNode(), [LINT, file, '--rules', RULES, '-C', project], { encoding: 'utf8', env })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

/** A draft with two comments of an Agent review: one on a line, one on a range. */
function agentDraft(): ReviewDraft {
  const draft = newReviewDraft(REPO, PR, HEAD)
  draft.payload.body = 'Two small things before this goes in.'
  draft.payload.comments.push(
    { path: 'src/upload.ts', line: 12, side: 'RIGHT', body: 'Three tries hide a server that is down.' },
    { path: 'src/upload.ts', start_line: 20, start_side: 'RIGHT', line: 21, side: 'RIGHT', body: 'This wait grows without a cap.' },
  )
  draft.anchors.push({ text: '  const tries = 3', by: 'agent' }, { text: '  wait *= 2\n  await sleep(wait)', by: 'agent' })
  return draft
}

describe('the draft and the payload of review-draft-lint', () => {
  it('lives in state/pr-review/ of the Profile folder, one file per PR', () => {
    expect(reviewDraftFilePath('/p', REPO, PR)).toBe(join('/p', 'state', 'pr-review', 'demo-org-api-118.json'))
  })

  it('a new draft starts on the head, empty, with no verdict chosen', () => {
    const draft = newReviewDraft(REPO, PR, HEAD)
    expect(draft).toEqual({ schema: 1, repo: REPO, pr: PR, startedOn: HEAD, payload: { body: '', comments: [] }, anchors: [], viewed: {}, state: 'draft' })
    expect(reviewDraftSchema.parse(draft)).toEqual(draft)
  })

  it('the payload is the body of the GitHub request, without a field of worfy; the lint finds nothing in it', () => {
    const draft = putComment(agentDraft(), { comment: { path: 'src/retry.ts', line: 3, side: 'LEFT', body: 'Was this removed on purpose?' }, anchor: 'import { retry } from "./old"' })
    draft.payload.event = 'COMMENT'
    // A field of a later worfy inside `payload` itself: kept in the file, never sent.
    Object.assign(draft.payload, { worfyLater: { kept: true } })
    draft.suggestedEvent = 'REQUEST_CHANGES'
    draft.viewed['src/upload.ts'] = 'b10b5a'
    const payload = reviewPayloadOf(draft)
    expect(payload).toEqual({
      event: 'COMMENT',
      body: 'Two small things before this goes in.',
      comments: [
        { path: 'src/upload.ts', line: 12, side: 'RIGHT', body: 'Three tries hide a server that is down.' },
        { path: 'src/upload.ts', start_line: 20, start_side: 'RIGHT', line: 21, side: 'RIGHT', body: 'This wait grows without a cap.' },
        { path: 'src/retry.ts', line: 3, side: 'LEFT', body: 'Was this removed on purpose?' },
      ],
    })
    const run = lint({ payload, tiers: payload.comments.map(() => 'argued'), body_tier: 'argued' })
    // No error of the draft's shape on stderr: only the note that the folder is no registered project.
    expect(run.stderr).not.toMatch(/the draft|payload|tier/u)
    expect(run.stdout).toBe('review-draft-lint: clean (4 texts)\n')
    expect(run.status).toBe(0)
  })

  it('the lint reads a payload whose verdict is not chosen yet, and still finds a trace of the workflow in it', () => {
    const draft = agentDraft()
    draft.payload.comments[0]!.body = 'See HANDOFF for why.'
    const payload = reviewPayloadOf(draft)
    expect(payload).not.toHaveProperty('event')
    const run = lint({ payload, tiers: ['argued', 'argued'], body_tier: 'argued' })
    expect(run.status).toBe(1)
    expect(run.stdout).toContain('comments[0] src/upload.ts:12')
  })

  it('the file of a draft parses back to the same draft, fields this version does not know included', () => {
    const draft = { ...agentDraft(), later: { kept: true } }
    expect(reviewDraftSchema.parse(JSON.parse(JSON.stringify(draft)))).toEqual(draft)
    expect(() => reviewDraftSchema.parse({ ...draft, anchors: [] })).toThrow(/one entry for each comment/u)
  })
})

describe('who wrote a comment', () => {
  it('a change of the person makes that comment theirs; the other keeps the agent', () => {
    const before = agentDraft()
    const after = putComment(before, {
      ref: { index: 1, path: 'src/upload.ts', body: 'This wait grows without a cap.' },
      comment: { path: 'src/upload.ts', start_line: 20, start_side: 'RIGHT', line: 21, side: 'RIGHT', body: 'Cap the wait at 30 s.' },
      anchor: '  wait *= 2\n  await sleep(wait)',
    })
    expect(after.anchors.map((anchor) => anchor.by)).toEqual(['agent', 'person'])
    expect(after.payload.comments[1]!.body).toBe('Cap the wait at 30 s.')
    // The draft given is not changed.
    expect(before.anchors[1]!.by).toBe('agent')
  })

  it('a new comment of the person is appended as theirs', () => {
    const after = putComment(agentDraft(), { comment: { path: 'README.md', line: 1, side: 'RIGHT', body: 'Typo.' }, anchor: '# Api' })
    expect(after.payload.comments).toHaveLength(3)
    expect(after.anchors[2]).toEqual({ text: '# Api', by: 'person' })
  })

  it('a comment the agent rewrote meanwhile is not taken for another: a change or a delete is refused', () => {
    const ref = { index: 0, path: 'src/upload.ts', body: 'An older text of the agent.' }
    expect(() => putComment(agentDraft(), { ref, comment: { path: 'src/upload.ts', line: 12, side: 'RIGHT', body: 'x' }, anchor: '' })).toThrow(ReviewDraftRefusal)
    expect(() => removeComment(agentDraft(), ref)).toThrow(ReviewDraftRefusal)
  })

  it('a comment moved by the agent is found by its file and text, the nearest to its old place', () => {
    const draft = agentDraft()
    draft.payload.comments.unshift({ path: 'src/a.ts', line: 1, side: 'RIGHT', body: 'New of the agent.' })
    draft.anchors.unshift({ text: 'x', by: 'agent' })
    const after = removeComment(draft, { index: 0, path: 'src/upload.ts', body: 'Three tries hide a server that is down.' })
    expect(after.payload.comments.map((comment) => comment.body)).toEqual(['New of the agent.', 'This wait grows without a cap.'])
    expect(after.anchors.map((anchor) => anchor.text)).toEqual(['x', '  wait *= 2\n  await sleep(wait)'])
  })

  it('the text of a comment has exactly the lines it comments; a trailing line end does not count as a line', () => {
    const range = { path: 'src/upload.ts', start_line: 10, start_side: 'RIGHT' as const, line: 12, side: 'RIGHT' as const, body: 'Why?' }
    expect(() => putComment(agentDraft(), { comment: range, anchor: 'one line' })).toThrow(ReviewDraftRefusal)
    expect(() => putComment(agentDraft(), { comment: range, anchor: 'a\nb\nc\nd' })).toThrow(/3 lines/u)
    expect(putComment(agentDraft(), { comment: range, anchor: 'a\nb\nc' }).anchors[2]).toEqual({ text: 'a\nb\nc', by: 'person' })
    expect(putComment(agentDraft(), { comment: range, anchor: 'a\r\nb\r\nc\r\n' }).anchors[2]!.text).toBe('a\r\nb\r\nc')
    const single = { path: 'src/upload.ts', line: 7, side: 'RIGHT' as const, body: 'Why?' }
    expect(putComment(agentDraft(), { comment: single, anchor: 'x\n' }).anchors[2]!.text).toBe('x')
    // Two lines whose second is empty, taken as they are: the count already fits.
    expect(putComment(agentDraft(), { comment: { ...single, start_line: 6, start_side: 'RIGHT' }, anchor: 'x\n' }).anchors[2]!.text).toBe('x\n')
  })

  it('a submitted draft is not changed any more', () => {
    const draft = { ...agentDraft(), state: 'submitted' as const }
    expect(() => putComment(draft, { comment: { path: 'a', line: 1, side: 'RIGHT', body: 'x' }, anchor: '' })).toThrow(/submitted/u)
    expect(() => setViewed(draft, 'a', 'b10b')).toThrow(/submitted/u)
  })

  it('Viewed keeps the blob of a file, and drops it on un-view', () => {
    const viewed = setViewed(agentDraft(), 'src/upload.ts', 'b10b5a')
    expect(viewed.viewed).toEqual({ 'src/upload.ts': 'b10b5a' })
    expect(setViewed(viewed, 'src/upload.ts', null).viewed).toEqual({})
  })
})

describe('finding the lines again after a new head', () => {
  /** src/upload.ts on the new head: three lines added above the first comment, the range two lines lower still. */
  const moved = ['// a', '// b', '// c', ...Array.from({ length: 11 }, (_, i) => `line ${i + 1}`), '  const tries = 3', ...Array.from({ length: 10 }, (_, i) => `more ${i}`), '  wait *= 2  ', '  await sleep(wait)'].join('\n')

  it('a comment whose text moved goes to its new line, a range with it, and the draft is placed on the new head', () => {
    const after = reanchor(agentDraft(), NEXT, (path) => (path === 'src/upload.ts' ? moved : null))
    expect(after.payload.comments[0]).toMatchObject({ line: 15 })
    expect(after.payload.comments[1]).toMatchObject({ start_line: 26, line: 27 })
    expect(after.anchors.map((anchor) => anchor.moved)).toEqual([undefined, undefined])
    expect(after.anchoredOn).toBe(NEXT)
    expect(after.startedOn).toBe(HEAD)
  })

  it('a comment whose text is gone stays on its old line, marked moved; found again later, the mark goes', () => {
    const gone = moved.replace('  const tries = 3', '  const tries = 5')
    const after = reanchor(agentDraft(), NEXT, () => gone)
    expect(after.payload.comments[0]).toMatchObject({ line: 12 })
    expect(after.anchors[0]).toEqual({ text: '  const tries = 3', by: 'agent', moved: true })
    expect(after.payload.comments[1]).toMatchObject({ start_line: 26, line: 27 })
    const back = reanchor(after, HEAD, () => moved)
    expect(back.anchors[0]).toEqual({ text: '  const tries = 3', by: 'agent' })
  })

  it('a file gone from the head marks its comments moved', () => {
    const after = reanchor(agentDraft(), NEXT, () => null)
    expect(after.anchors.map((anchor) => anchor.moved)).toEqual([true, true])
    expect(after.payload.comments.map((comment) => comment.line)).toEqual([12, 21])
  })

  it('of two places with the same text, the one nearest the old line', () => {
    const twice = ['  const tries = 3', ...Array.from({ length: 12 }, () => ''), '  const tries = 3'].join('\n')
    const after = reanchor(agentDraft(), NEXT, () => twice)
    expect(after.payload.comments[0]!.line).toBe(14)
  })

  it('a range keeps its size whatever the text written beside it; the draft still parses', () => {
    // An Agent review (bin/pr-review-draft) may write a range 20–22 with the text of its first line only.
    const draft = agentDraft()
    draft.payload.comments[1] = { ...draft.payload.comments[1]!, start_line: 20, line: 22 }
    draft.anchors[1] = { text: '  wait *= 2', by: 'agent' }
    const after = reanchor(draft, NEXT, () => `${moved}\n  return wait`)
    expect(after.payload.comments[1]).toMatchObject({ start_line: 26, line: 28 })
    expect(reviewDraftSchema.parse(after)).toEqual(after)
  })

  it('a range that would run past the end of the file stays in place, marked moved', () => {
    // Range 1–3 with the text of one line only, found on the last line of a three-line file: 3–5 would not exist.
    const draft = newReviewDraft(REPO, PR, HEAD)
    draft.payload.comments.push({ path: 'src/a.ts', start_line: 1, start_side: 'RIGHT', line: 3, side: 'RIGHT', body: 'Why?' })
    draft.anchors.push({ text: 'target', by: 'agent' })
    const after = reanchor(draft, NEXT, () => 'x\ny\ntarget\n')
    expect(after.payload.comments[0]).toMatchObject({ start_line: 1, line: 3 })
    expect(after.anchors[0]).toEqual({ text: 'target', by: 'agent', moved: true })
    // The same range found where it fits moves as usual.
    expect(reanchor(draft, NEXT, () => 'target\ny\nz\n').payload.comments[0]).toMatchObject({ start_line: 1, line: 3 })
    expect(reanchor(draft, NEXT, () => 'w\ntarget\ny\nz').payload.comments[0]).toMatchObject({ start_line: 2, line: 4 })
  })

  it('a trailing line end in the text of the lines does not move the comment a line down', () => {
    const draft = agentDraft()
    draft.anchors[0] = { text: '  const tries = 3\n', by: 'agent' }
    draft.anchors[1] = { text: '  wait *= 2\n  await sleep(wait)\n', by: 'agent' }
    const after = reanchor(draft, NEXT, () => `${moved}\n`)
    expect(after.payload.comments[0]).toMatchObject({ line: 15 })
    expect(after.payload.comments[1]).toMatchObject({ start_line: 26, line: 27 })
    expect(after.anchors.map((anchor) => anchor.moved)).toEqual([undefined, undefined])
  })

  it('a comment on the old side of the diff stays where it is', () => {
    const draft = putComment(newReviewDraft(REPO, PR, HEAD), { comment: { path: 'src/retry.ts', line: 3, side: 'LEFT', body: 'Why?' }, anchor: 'gone' })
    const after = reanchor(draft, NEXT, () => 'nothing like it')
    expect(after.payload.comments[0]!.line).toBe(3)
    expect(after.anchors[0]!.moved).toBeUndefined()
  })
})
