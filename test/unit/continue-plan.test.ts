// The plan of a retry after a temporary API error (worfy-retry ticket 03): the pauses and the cap,
// which actions of a turn reach outside the Session, the refusal of a retry while one of them has no
// result, and the continuation text that never carries the turn's original message.
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { TransientError, TurnFailure } from '../../src/shared/agent/turn-failure'
import {
  JITTER,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  externalActions,
  retryDecision,
  retryDelay,
  retryText,
  type ExternalAction,
} from '../../src/shared/agent/continue-plan'

const MINUTE = 60_000
const TRANSIENT: TurnFailure = { kind: 'transient', error: 'api-500' }

const use = (id: string, name: string, input: unknown, parentToolUseId: string | null = null): AgentEvent => ({ type: 'tool_use', id, name, input, parentToolUseId })
const result = (toolUseId: string, parentToolUseId: string | null = null): AgentEvent => ({ type: 'tool_result', toolUseId, content: 'ok', isError: false, parentToolUseId })
const bash = (command: string, extra: Record<string, unknown> = {}): AgentEvent => use('t1', 'Bash', { command, ...extra })

/** The external actions of a turn with one Bash call of `command` and its result. */
const ofCommand = (command: string): ExternalAction[] => externalActions([bash(command), result('t1')])
const isExternal = (command: string): boolean => ofCommand(command).length > 0
const action = (description: string, done: boolean, toolUseId = 't1'): ExternalAction => ({ toolUseId, tool: 'Bash', description, done })

describe('retryDelay', () => {
  it('pauses 1, 5, 15, 30 and 60 minutes, five retries in all', () => {
    expect(MAX_RETRIES).toBe(5)
    expect(RETRY_DELAYS_MS).toEqual([1, 5, 15, 30, 60].map((minutes) => minutes * MINUTE))
    expect([1, 2, 3, 4, 5].map((attempt) => retryDelay(attempt, 0.5))).toEqual([1, 5, 15, 30, 60].map((minutes) => minutes * MINUTE))
  })

  it.each([1, 2, 3, 4, 5])('spreads the pause of attempt %i by ±20 %%', (attempt) => {
    const base = RETRY_DELAYS_MS[attempt - 1] as number
    expect(JITTER).toBe(0.2)
    expect(retryDelay(attempt, 0)).toBe(Math.round(base * 0.8))
    const top = retryDelay(attempt, 0.999_999)
    expect(top).toBeLessThanOrEqual(base * 1.2)
    expect(top).toBeGreaterThan(base * 1.199)
    for (const random of [0.1, 0.25, 0.73, 0.9]) {
      const delay = retryDelay(attempt, random)
      expect(delay).toBeGreaterThanOrEqual(base * 0.8)
      expect(delay).toBeLessThan(base * 1.2)
    }
  })

  it.each([0, 6, 1.5, -1, Number.NaN])('refuses attempt %s', (attempt) => {
    expect(() => retryDelay(attempt, 0.5)).toThrow(RangeError)
  })

  it.each([-0.1, 1, 1.5, Number.NaN])('refuses random %s', (random) => {
    expect(() => retryDelay(1, random)).toThrow(RangeError)
  })
})

describe('retryDecision', () => {
  it.each([1, 2, 3, 4, 5])('retries attempt %i of 5 after its pause', (attempt) => {
    expect(retryDecision({ failure: TRANSIENT, attempt, actions: [], random: 0.3 })).toEqual({
      kind: 'retry',
      attempt,
      of: 5,
      delayMs: retryDelay(attempt, 0.3),
    })
  })

  it('refuses the sixth attempt with cap', () => {
    expect(retryDecision({ failure: TRANSIENT, attempt: 6, actions: [], random: 0.3 })).toEqual({ kind: 'refused', reason: 'cap', inFlight: [] })
  })

  it.each<[string, TurnFailure]>([
    ['other', { kind: 'other' }],
    ['none', { kind: 'none' }],
  ])('refuses a failure of kind %s as not-transient', (_kind, failure) => {
    expect(retryDecision({ failure, attempt: 1, actions: [], random: 0.3 })).toEqual({ kind: 'refused', reason: 'not-transient', inFlight: [] })
  })

  it('refuses a git push without its tool_result as in-flight and names it', () => {
    const actions = externalActions([bash('git push origin main')])
    expect(actions).toEqual([{ toolUseId: 't1', tool: 'Bash', description: 'git push origin main', done: false }])
    expect(retryDecision({ failure: TRANSIENT, attempt: 1, actions, random: 0.3 })).toEqual({ kind: 'refused', reason: 'in-flight', inFlight: actions })
  })

  it('retries after a git push that has its tool_result and names the push in the text', () => {
    const actions = externalActions([bash('git push origin main'), result('t1')])
    const decision = retryDecision({ failure: TRANSIENT, attempt: 1, actions, random: 0.3 })
    expect(decision.kind).toBe('retry')
    expect(retryText({ attempt: 1, of: MAX_RETRIES, error: 'api-500', actions })).toContain('- git push origin main')
  })

  it('names only the actions without a result in inFlight', () => {
    const done = action('git commit -m m', true, 'a')
    const open = action('gh pr merge 12', false, 'b')
    expect(retryDecision({ failure: TRANSIENT, attempt: 2, actions: [done, open], random: 0.3 })).toEqual({ kind: 'refused', reason: 'in-flight', inFlight: [open] })
  })

  it('reads not-transient before in-flight and cap', () => {
    expect(retryDecision({ failure: { kind: 'other' }, attempt: 6, actions: [action('git push', false)], random: 0.3 })).toMatchObject({ reason: 'not-transient' })
  })

  it('reads in-flight before cap: the action may have run whatever the count', () => {
    expect(retryDecision({ failure: TRANSIENT, attempt: 6, actions: [action('git push', false)], random: 0.3 })).toMatchObject({ reason: 'in-flight' })
  })

  it('throws on an attempt below 1: the caller counts from 1', () => {
    expect(() => retryDecision({ failure: TRANSIENT, attempt: 0, actions: [], random: 0.3 })).toThrow(RangeError)
  })
})

describe('externalActions: git', () => {
  it.each(['commit -m fix', 'push origin main', 'merge feature', 'rebase main', 'reset --hard HEAD~1', 'tag v1', 'pull', 'cherry-pick abc', 'revert abc', 'am patch.mbox'])(
    'git %s is external',
    (rest) => {
      expect(isExternal(`git ${rest}`)).toBe(true)
    },
  )

  it.each(['git status', 'git log --grep push', 'git merge-base main HEAD', 'git fetch origin', 'git diff', 'git show HEAD', 'git', 'git --version'])('%s is not external', (command) => {
    expect(isExternal(command)).toBe(false)
  })

  it.each(['git -C ~/repo push', 'git -c user.name=x commit -m m', 'git --git-dir .git --work-tree . push', 'git --no-pager push', '/usr/bin/git push', 'git.exe push', 'GIT push'])(
    'finds the subcommand of %s',
    (command) => {
      expect(isExternal(command)).toBe(true)
    },
  )

  it('does not take the value of -C for the subcommand', () => {
    expect(isExternal('git -C push status')).toBe(false)
  })

  it.each(['cd x && git push', 'npm test; git push', 'npm test;git push', 'npm test|git push', 'npm test || git push', 'make | xargs git push', 'npm test\ngit push', 'echo $(git push)', 'echo `git push`', '(git push)', 'sleep 1 & git push'])(
    'reads each command of %j',
    (command) => {
      expect(isExternal(command)).toBe(true)
    },
  )

  it.each([`bash -c 'git push'`, `ssh host "cd x && git push"`, `sh -c "bash -c 'git push'"`, `bash -c "git push`])('reads the quoted command of %s', (command) => {
    expect(isExternal(command)).toBe(true)
  })

  it('reads an escaped quote as a character, not as the start of a quoted command', () => {
    expect(isExternal(`echo \\'git push \\'`)).toBe(false)
  })

  it('reads a quote left open as running to the end of the line', () => {
    expect(ofCommand('git commit -m "fix it')[0]?.description).toBe('git commit -m "fix it"')
  })

  it('describes only the commands that are external, quoted words in quotes', () => {
    expect(ofCommand('cd x && npm test && git push origin main')[0]?.description).toBe('git push origin main')
    expect(ofCommand('git add -A && git commit -m "fix it" && git push')[0]?.description).toBe('git commit -m "fix it"; git push')
  })
})

describe('externalActions: gh', () => {
  it.each(['pr create --fill', 'pr merge 12 --squash', 'pr close 12', 'pr edit 12 --title x', 'pr ready 12', 'pr comment 12 -b x', 'pr review 12 --approve', 'issue create -t x', 'issue comment 3 -b x', 'release create v1', 'release upload v1 a.zip', 'run rerun 5', 'workflow run ci.yml', 'repo delete o/r'])(
    'gh %s is external',
    (rest) => {
      expect(isExternal(`gh ${rest}`)).toBe(true)
    },
  )

  it.each(['pr view 12', 'pr list', 'pr status', 'pr checks 12 --watch', 'pr diff 12', 'pr checkout 12', 'run watch 5', 'run download 5', 'issue list', 'release view v1', 'search prs x', 'status', 'help', 'version'])(
    'gh %s is not external',
    (rest) => {
      expect(isExternal(`gh ${rest}`)).toBe(false)
    },
  )

  it.each(['gh', 'gh --version', 'gh pr', 'gh pr --help'])('%s alone only prints help', (command) => {
    expect(isExternal(command)).toBe(false)
  })

  it('reads a flag before the group the safe way', () => {
    expect(isExternal('gh -R o/r pr view 12')).toBe(true)
  })

  it.each(['gh api repos/o/r', 'gh api repos/o/r/pulls/1 --jq .state', 'gh api -X GET search/issues -f q=x', 'gh api --method get repos/o/r', 'gh api -X HEAD repos/o/r', 'gh api -XGET repos/o/r'])(
    '%s only reads',
    (command) => {
      expect(isExternal(command)).toBe(false)
    },
  )

  it.each([
    'gh api -X POST repos/o/r/issues',
    'gh api -XPATCH repos/o/r/issues/1',
    'gh api --method DELETE repos/o/r/git/refs/heads/x',
    'gh api --method=PUT repos/o/r/pulls/1/merge',
    // Without -X, a body makes gh send a POST.
    'gh api repos/o/r/issues -f title=x',
    'gh api repos/o/r/issues -F n=1',
    'gh api repos/o/r/issues -ftitle=x',
    'gh api repos/o/r/issues --field title=x',
    'gh api repos/o/r/issues --raw-field=title=x',
    'gh api repos/o/r/issues --input body.json',
    'gh api graphql -f query=x',
    // A method flag with no value: read the safe way.
    'gh api repos/o/r -X',
  ])('%s writes', (command) => {
    expect(isExternal(command)).toBe(true)
  })
})

describe('externalActions: tools', () => {
  it('names a background task, whatever its command', () => {
    expect(externalActions([bash('npm test', { run_in_background: true }), result('t1')])).toEqual([{ toolUseId: 't1', tool: 'Bash', description: 'background task: npm test', done: true }])
  })

  it.each(['PowerShell', 'commandExecution'])('reads the command line of %s', (tool) => {
    expect(externalActions([use('t1', tool, { command: 'git push', cwd: '~/repo' })])).toEqual([{ toolUseId: 't1', tool, description: 'git push', done: false }])
  })

  it('reads a command given as argv', () => {
    expect(externalActions([use('t1', 'commandExecution', { command: ['git', 'push', 1] })])[0]?.description).toBe('git push')
  })

  it.each<[string, unknown, string]>([
    ['Agent', { description: 'Implement ticket 03', subagent_type: 'worfy:implementer' }, 'Agent: Implement ticket 03'],
    ['Agent', { subagent_type: 'worfy:implementer' }, 'Agent: worfy:implementer'],
    ['Agent', { description: '  ' }, 'Agent'],
    ['Agent', null, 'Agent'],
    ['Task', { description: 'Review' }, 'Task: Review'],
    ['Workflow', { name: 'ship' }, 'Workflow: ship'],
    ['SendMessage', { to: 'impl-07', message: 'x' }, 'message to impl-07'],
    ['SendMessage', {}, 'message to another agent'],
  ])('%s is external', (tool, input, description) => {
    expect(externalActions([use('t1', tool, input)])).toEqual([{ toolUseId: 't1', tool, description, done: false }])
  })

  it.each(['mcp__worfy-canvas__create_card', 'mcp__worfy-canvas__update_node', 'mcp__worfy-canvas__autopilot_start', 'mcp__worfy-browser__browser_click', 'mcp__worfy-browser__browser_type'])(
    'the worfy MCP tool %s changes state',
    (tool) => {
      expect(externalActions([use('t1', tool, {})])).toEqual([{ toolUseId: 't1', tool, description: tool, done: false }])
    },
  )

  it.each(['mcp__worfy-canvas__list_nodes', 'mcp__worfy-browser__browser_list', 'mcp__worfy-browser__browser_read', 'mcp__worfy-browser__browser_screenshot'])('the worfy MCP tool %s only reads', (tool) => {
    expect(externalActions([use('t1', tool, {})])).toEqual([])
  })

  it.each(['mcp__worfy-canvas__a_future_tool', 'mcp__github__create_pull_request', 'mcp__slack__send_message', 'mcp__plugin_worfy_qmd__query'])('reads the MCP tool %s it does not know as external', (tool) => {
    expect(externalActions([use('t1', tool, {})])).toHaveLength(1)
  })

  it.each(['Read', 'Edit', 'Write', 'Grep', 'WebFetch', 'fileChange', 'mcp__'])('%s is not external', (tool) => {
    expect(externalActions([use('t1', tool, { command: 'git push' })])).toEqual([])
  })

  it.each([null, 'git push', ['git push']])('reads a Bash input %j that is not an object as no command', (input) => {
    expect(externalActions([use('t1', 'Bash', input)])).toEqual([])
  })

  it('leaves out the calls inside a Subagent: the Agent call stands for them', () => {
    const events = [use('a1', 'Agent', { description: 'Ship 03' }), result('a1'), use('t2', 'Bash', { command: 'git push' }, 'a1')]
    expect(externalActions(events)).toEqual([{ toolUseId: 'a1', tool: 'Agent', description: 'Agent: Ship 03', done: true }])
    expect(retryDecision({ failure: TRANSIENT, attempt: 1, actions: externalActions(events), random: 0.3 }).kind).toBe('retry')
  })

  it('keeps the order of the calls and reads a repeated tool_use once', () => {
    const events = [bash('git commit -m m'), use('t2', 'Bash', { command: 'git push' }), result('t1'), bash('git commit -m m')]
    expect(externalActions(events)).toEqual([action('git commit -m m', true), action('git push', false, 't2')])
  })

  it('keeps a description to one line of at most 160 characters', () => {
    const [long] = ofCommand(`git commit -m "${'x'.repeat(300)}"`)
    expect(long?.description).toHaveLength(160)
    expect(long?.description.endsWith('…')).toBe(true)
    expect(externalActions([bash('npm test\n  --watch=false', { run_in_background: true })])[0]?.description).toBe('background task: npm test --watch=false')
  })
})

describe('retryText', () => {
  const WAVE = '/epic-wave tickets 05, 06 of epic worfy-retry'
  const MESSAGE = 'Please merge the open PRs of the Wave and report back.'

  it('asks to continue, names the retry and the actions that ran, and asks to check before repeating', () => {
    const events: AgentEvent[] = [
      { type: 'notice', kind: 'user', text: `${WAVE}\n${MESSAGE}` },
      { type: 'text', text: 'Pushing the branch now.', messageId: 'm1', parentToolUseId: null, synthetic: false },
      bash('git push origin worfy-retry/03'),
      result('t1'),
      use('a1', 'Agent', { description: 'Implement ticket 05' }),
      result('a1'),
      use('t3', 'Bash', { command: 'gh pr merge 12' }),
    ]
    const text = retryText({ attempt: 2, of: 5, error: 'overloaded', actions: externalActions(events) })
    expect(text).toContain('retry 2 of 5')
    expect(text).toContain('Continue from where you stopped.')
    expect(text).toContain('the API was overloaded')
    expect(text).toContain('These actions of that turn already ran:\n- git push origin worfy-retry/03\n- Agent: Implement ticket 05')
    // An action without a result is never told as one that ran.
    expect(text).not.toContain('gh pr merge')
    expect(text).toContain('git log, gh pr view, the task list')
    expect(text).toContain('do not do it twice')
    expect(text).not.toContain('/epic-wave')
    expect(text).not.toContain(MESSAGE)
    expect(text).not.toContain('Pushing the branch now.')
  })

  it('says it saw no external action when there was none', () => {
    const text = retryText({ attempt: 1, of: 5, error: 'api-500', actions: [] })
    expect(text).toContain('worfy saw no action of that turn that changes something outside this Session.')
    expect(text).not.toContain('already ran')
    expect(text).toContain('do not do it twice')
  })

  it.each<[TransientError, string]>([
    ['api-500', 'API error 500'],
    ['api-502', 'API error 502'],
    ['api-503', 'API error 503'],
    ['api-504', 'API error 504'],
    ['overloaded', 'the API was overloaded'],
    ['connection', 'the connection to the API was lost'],
    ['timeout', 'the request to the API timed out'],
    ['stream', 'the response stream broke off'],
  ])('names the error %s', (error, words) => {
    expect(retryText({ attempt: 1, of: 5, error, actions: [] })).toContain(`temporary API error (${words})`)
  })
})
