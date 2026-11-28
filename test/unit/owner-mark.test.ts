// Allow verification change (src/main/github/owner-mark.ts, worfy-harness-guarantees ticket 10): the commit status
// `owner` on the head of a PR that adds a verification path to a trail is written only on the owner's click — never by
// a look, never twice, never on a head the view did not show — and a failure is answered, never retried. gh is a stub
// that records every call, `land --verification` a stub that answers what a test sets; nothing reaches GitHub. The
// handlers of `prInbox.verification` and `prInbox.allowVerification` (src/main/ipc/pr-inbox.ts) only pass the call on.
import { describe, expect, it } from 'vitest'
import { lookOf, OWNER_CONTEXT, OwnerMark, type VerificationAnswer, type VerificationRun } from '../../src/main/github/owner-mark'
import type { GhRunner } from '../../src/main/github/prs'
import { prInboxHandlers } from '../../src/main/ipc/pr-inbox'

const ROOT = '/projects/web'
const REPO = 'example-org/web'
const HEAD = 'a'.repeat(40)
const MOVED = 'b'.repeat(40)
const TOKEN = 'gho_0000000000000000000000000000000000AA'

const extends07: VerificationAnswer = {
  pr: 7,
  head: HEAD,
  state: 'OPEN',
  owner: null,
  needsOwner: true,
  added: [{ file: '.scratch/worfy-x/issues/07-ci.md', ticket: 'worfy-x 07', paths: ['.github/workflows/ci.yml'] }],
  noTicket: null,
}

interface World {
  mark: OwnerMark
  /** Every gh call: its arguments and the environment it got. */
  gh: { args: readonly string[]; env: Record<string, string> | undefined }[]
  /** Every run of land --verification, with the environment it got. */
  land: { repo: string; number: number; env: Record<string, string> }[]
  answer: VerificationAnswer | string
  postFails: string | null
  health: string[]
}

function world(options: { account?: string | null; answer?: VerificationAnswer | string } = {}): World {
  const out: World = { mark: null as unknown as OwnerMark, gh: [], land: [], answer: options.answer ?? extends07, postFails: null, health: [] }
  const run: GhRunner = (args, _cwd, env) => {
    out.gh.push({ args: [...args], env: env as Record<string, string> | undefined })
    if (args[0] === 'auth' && args[1] === 'token') return Promise.resolve(`${TOKEN}\n`)
    if (args[0] === 'api' && args.includes('POST')) {
      if (out.postFails !== null) return Promise.reject(new Error(out.postFails))
      return Promise.resolve('{}')
    }
    return Promise.reject(new Error(`stub gh: unexpected ${args.join(' ')}`))
  }
  const verification = (root: string, repo: string, number: number, env: Record<string, string>): Promise<VerificationRun> => {
    expect(root).toBe(ROOT)
    out.land.push({ repo, number, env })
    const answer = out.answer
    return Promise.resolve(typeof answer === 'string' ? { code: 2, stdout: '', stderr: answer } : { code: answer.error === undefined ? 0 : 2, stdout: `${JSON.stringify(answer)}\n`, stderr: '' })
  }
  out.mark = new OwnerMark({
    run,
    account: () => Promise.resolve(options.account === undefined ? 'owner-login' : options.account),
    verification,
    health: { failed: (_root, reason) => void out.health.push(`failed ${reason}`), signInFailed: (_root, reason) => void out.health.push(`sign-in ${reason}`), answered: () => void out.health.push('answered'), reason: () => null },
  })
  return out
}

const posts = (w: World) => w.gh.filter((call) => call.args.includes('POST'))

describe('the look of the owner\'s mark', () => {
  it('says what the mark allows, read by land --verification with the Project\'s token; it writes nothing', async () => {
    const w = world()
    expect(await w.mark.look(ROOT, REPO, 7)).toEqual({ needed: true, head: HEAD, lines: ['adds .github/workflows/ci.yml to the trail of worfy-x 07'], allowed: false, error: null })
    expect(w.land).toEqual([{ repo: REPO, number: 7, env: { GH_TOKEN: TOKEN } }])
    expect(posts(w)).toEqual([])
  })

  it('a PR with no Ticket that changes a verification path needs the mark too; a plain or a closed PR needs none', () => {
    expect(lookOf({ ...extends07, added: [], noTicket: { reason: 'the branch fix-ci is not <epic>/<NN>', paths: ['CLAUDE.md'] } }).lines).toEqual(['changes CLAUDE.md, and the PR has no Ticket'])
    expect(lookOf({ ...extends07, needsOwner: false, added: [] })).toEqual({ needed: false, head: HEAD, lines: [], allowed: false, error: null })
    expect(lookOf({ ...extends07, state: 'MERGED' }).needed).toBe(false)
    expect(lookOf({ ...extends07, owner: 'success' }).allowed).toBe(true)
    expect(lookOf({ ...extends07, owner: 'pending' }).allowed).toBe(false)
  })

  it('land that cannot say is the look\'s error, and nothing is offered', async () => {
    const w = world({ answer: { pr: 7, error: 'gh pr view 7: gh exit 1: HTTP 502' } })
    expect(await w.mark.look(ROOT, REPO, 7)).toEqual({ needed: false, head: null, lines: [], allowed: false, error: 'gh pr view 7: gh exit 1: HTTP 502' })
    const garbled = world({ answer: 'land: usage' })
    expect((await garbled.mark.look(ROOT, REPO, 7)).error).toBe('land --verification exit 2: land: usage')
  })
})

describe('Allow verification change', () => {
  it('a click writes one commit status owner success on the head the view showed, with the Project\'s token', async () => {
    const w = world()
    const result = await w.mark.allow(ROOT, REPO, 7, HEAD)
    expect(result.outcome).toBe('allowed')
    expect(result.look.allowed).toBe(true)
    expect(posts(w)).toEqual([
      { args: ['api', '--method', 'POST', `repos/${REPO}/statuses/${HEAD}`, '-f', 'state=success', '-f', `context=${OWNER_CONTEXT}`, '-f', 'description=Verification change allowed by the owner in worfy'], env: { GH_TOKEN: TOKEN } },
    ])
    expect(w.health).toEqual(['answered'])
  })

  it('a head whose owner status is success already: answered, nothing written (a second click, a lost answer)', async () => {
    const w = world({ answer: { ...extends07, owner: 'success' } })
    expect((await w.mark.allow(ROOT, REPO, 7, HEAD)).outcome).toBe('already')
    expect(posts(w)).toEqual([])
  })

  it('a head that moved since the view: refused with the new head, nothing written', async () => {
    const w = world({ answer: { ...extends07, head: MOVED } })
    const result = await w.mark.allow(ROOT, REPO, 7, HEAD)
    expect(result).toMatchObject({ outcome: 'refused', reason: 'The PR moved to bbbbbbbb since the view showed aaaaaaaa: look at the new head first' })
    expect(posts(w)).toEqual([])
  })

  it('a PR that needs no mark, a closed one, or one land cannot read: refused, nothing written', async () => {
    for (const answer of [{ ...extends07, needsOwner: false, added: [] }, { ...extends07, state: 'CLOSED' }, { pr: 7, error: 'git fetch origin main (exit 128)' }, 'crashed']) {
      const w = world({ answer })
      expect((await w.mark.allow(ROOT, REPO, 7, HEAD)).outcome).toBe('refused')
      expect(posts(w)).toEqual([])
    }
  })

  it('no github.account in the Profile: refused before any call of gh or land', async () => {
    const w = world({ account: null })
    const result = await w.mark.allow(ROOT, REPO, 7, HEAD)
    expect(result.outcome).toBe('refused')
    expect(w.gh).toEqual([])
    expect(w.land).toEqual([])
    expect(w.health).toEqual([`sign-in ${result.reason}`])
  })

  it('GitHub refuses the POST: failed with its reason, one POST, never retried by itself; the next click looks again', async () => {
    const w = world()
    w.postFails = 'HTTP 403: Resource not accessible by integration\nmore'
    const result = await w.mark.allow(ROOT, REPO, 7, HEAD)
    expect(result).toMatchObject({ outcome: 'failed', reason: 'GitHub did not take the mark: HTTP 403: Resource not accessible by integration' })
    expect(posts(w)).toHaveLength(1)
    expect(w.health).toEqual(['failed HTTP 403: Resource not accessible by integration'])
    w.postFails = null
    w.answer = { ...extends07, owner: 'success' }
    expect((await w.mark.allow(ROOT, REPO, 7, HEAD)).outcome).toBe('already')
    expect(w.land).toHaveLength(2)
    expect(posts(w)).toHaveLength(1)
  })

  it('a second click while the first runs: refused, one POST in all', async () => {
    const w = world()
    const [first, second] = await Promise.all([w.mark.allow(ROOT, REPO, 7, HEAD), w.mark.allow(ROOT, REPO, 7, HEAD)])
    expect([first.outcome, second.outcome].sort()).toEqual(['allowed', 'refused'])
    expect(posts(w)).toHaveLength(1)
  })

  it('a repository or a head that is not one: refused before anything runs', async () => {
    const w = world()
    expect((await w.mark.allow(ROOT, 'not a repo', 7, HEAD)).outcome).toBe('refused')
    expect((await w.mark.allow(ROOT, REPO, 7, 'HEAD')).outcome).toBe('refused')
    expect([...w.gh, ...w.land]).toEqual([])
  })
})

describe('the channels of the owner\'s mark (src/main/ipc/pr-inbox.ts)', () => {
  const handlersOver = () => {
    const calls: string[] = []
    const fakeMark = {
      look: (root: string, repo: string, number: number) => {
        calls.push(`look ${root} ${repo}#${number}`)
        return Promise.resolve(lookOf(extends07))
      },
      allow: (root: string, repo: string, number: number, head: string) => {
        calls.push(`allow ${root} ${repo}#${number} ${head}`)
        return Promise.resolve({ outcome: 'allowed' as const, reason: null, look: lookOf(extends07) })
      },
    }
    const unused = () => {
      throw new Error('not in this test')
    }
    const handlers = prInboxHandlers(unused, { sender: unused, root: unused }, unused, { mark: () => fakeMark, root: () => ROOT })
    const handler = (name: string) => handlers.find((each) => each.channel.name === name)!
    return { calls, handler }
  }

  it('prInbox.verification only looks; prInbox.allowVerification passes the head on, once per call', async () => {
    const { calls, handler } = handlersOver()
    await handler('prInbox.verification').handle({ projectId: 'web-00000001', repo: REPO, number: 7 } as never, {} as never)
    expect(calls).toEqual([`look ${ROOT} ${REPO}#7`])
    await handler('prInbox.allowVerification').handle({ projectId: 'web-00000001', repo: REPO, number: 7, head: HEAD } as never, {} as never)
    expect(calls).toEqual([`look ${ROOT} ${REPO}#7`, `allow ${ROOT} ${REPO}#7 ${HEAD}`])
  })
})
