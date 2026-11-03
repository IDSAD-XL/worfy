// The pure parts of worfy-multi-vendor ticket 22: which threads of Codex's `thread/list` are a
// Project's past Sessions (by folder, on macOS, Linux and Windows) and where each was started; a thread
// of `thread/read` as transcript entries; the rows of a Codex Session's slash menu and what a message
// that starts with one of them sends. The app-server itself is the contract test's
// (test/contract/codex-history.test.ts, test/contract/codex-session.test.ts).
import { describe, expect, it } from 'vitest'
import { codexCommandOf, codexSlashCommands, CODEX_BUILT_IN_COMMANDS, slashName } from '../../src/main/vendors/codex/commands'
import { codexHistorySessions, codexTranscript } from '../../src/main/vendors/codex/history'
import type { Thread } from '../../src/main/vendors/codex/protocol/ts/v2/Thread'
import type { SkillMetadata } from '../../src/main/vendors/codex/protocol/ts/v2/SkillMetadata'
import { userInput } from '../../src/main/vendors/codex/session'

/** A thread as `thread/list` gives it, with the fields a test names. */
function thread(fields: Partial<Thread> & Pick<Thread, 'id' | 'cwd'>): Thread {
  return {
    sessionId: `ses_${fields.id}`,
    forkedFromId: null,
    parentThreadId: null,
    preview: '',
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: 'legacy',
    modelProvider: 'openai',
    model: 'gpt-5.5-codex',
    reasoningEffort: null,
    createdAt: 1793000000,
    updatedAt: 1793000060,
    recencyAt: null,
    status: { type: 'notLoaded' },
    path: null,
    cliVersion: '0.166.0',
    originator: 'worfy',
    source: 'appServer',
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
    ...fields,
  } as Thread
}

const skill = (name: string, fields: Partial<SkillMetadata> = {}): SkillMetadata => ({
  name,
  description: `The ${name} skill.`,
  path: `/home/me/.codex/skills/${name}/SKILL.md`,
  scope: 'user',
  enabled: true,
  pluginId: null,
  ...fields,
})

describe('the past Sessions of a Project, from thread/list', () => {
  it('keeps the threads of the folder and of the folders inside it, and none of a folder that only starts like it', () => {
    const threads = [
      thread({ id: 'root', cwd: '/p/proj' }),
      thread({ id: 'inside', cwd: '/p/proj/src/deep' }),
      thread({ id: 'sibling', cwd: '/p/proj-other' }),
      thread({ id: 'parent', cwd: '/p' }),
    ]
    expect(codexHistorySessions(threads, '/p/proj', 'darwin').map((each) => each.id)).toEqual(['root', 'inside'])
    expect(codexHistorySessions(threads, '/p/proj/', 'linux').map((each) => each.id)).toEqual(['root', 'inside'])
  })

  it('on Windows takes either separator and ignores case, as the file system does', () => {
    const threads = [
      thread({ id: 'same', cwd: 'C:\\Users\\Me\\Proj' }),
      thread({ id: 'case', cwd: 'c:\\users\\me\\proj\\src' }),
      thread({ id: 'slashes', cwd: 'C:/Users/Me/Proj/test' }),
      thread({ id: 'other', cwd: 'C:\\Users\\Me\\Proj2' }),
      thread({ id: 'drive', cwd: 'D:\\Users\\Me\\Proj' }),
    ]
    expect(codexHistorySessions(threads, 'C:\\Users\\Me\\Proj', 'win32').map((each) => each.id)).toEqual(['same', 'case', 'slashes'])
    // On macOS and Linux case counts.
    expect(codexHistorySessions([thread({ id: 'case', cwd: '/P/Proj' })], '/p/proj', 'darwin')).toEqual([])
  })

  it('compares the names in NFC: a folder named in NFD is the same folder', () => {
    const nfd = '/p/Cafe\u0301'
    expect(codexHistorySessions([thread({ id: 'nfd', cwd: nfd })], '/p/Café', 'darwin').map((each) => each.id)).toEqual(['nfd'])
  })

  it('names each by its title, else its first message; the time in ms; worfy\'s own by the originator', () => {
    const threads = [
      thread({ id: 'mine', cwd: '/p', originator: 'worfy', preview: 'Fix the build', updatedAt: 1793000060 }),
      thread({ id: 'cli', cwd: '/p', originator: 'codex_cli_rs', source: 'cli', name: 'Test walkthrough', preview: 'Explain the tests' }),
      thread({ id: 'unknown', cwd: '/p', originator: null, preview: '  ' }),
    ]
    expect(codexHistorySessions(threads, '/p', 'linux')).toEqual([
      { id: 'mine', cwd: '/p', title: 'Fix the build', updatedAt: 1793000060000, origin: 'worfy' },
      { id: 'cli', cwd: '/p', title: 'Test walkthrough', updatedAt: 1793000060000, origin: 'external' },
      { id: 'unknown', cwd: '/p', title: null, updatedAt: 1793000060000, origin: null },
    ])
  })
})

describe('a thread of thread/read as transcript entries', () => {
  it('gives the user\'s messages, the thinking, the commands with their output and the answers, in order, with the time of their turn', () => {
    const read = thread({
      id: 'thr_1',
      cwd: '/p',
      turns: [
        {
          id: 'turn_1',
          rootTurnId: null,
          itemsView: 'full',
          status: 'completed',
          error: null,
          startedAt: 1793000000,
          completedAt: 1793000060,
          durationMs: 60000,
          items: [
            { type: 'userMessage', id: 'u1', clientId: null, content: [{ type: 'text', text: 'Fix the build', text_elements: [] }] },
            { type: 'reasoning', id: 'r1', summary: ['Looking at the lint output'], content: [] },
            { type: 'reasoning', id: 'r2', summary: [], content: [] },
            { type: 'commandExecution', id: 'c1', command: 'pnpm lint', commandActions: [], cwd: '/p', status: 'failed', exitCode: 1, aggregatedOutput: '1 problem\n', durationMs: 900 },
            { type: 'agentMessage', id: 'm1', text: 'The build is fixed.' },
            { type: 'contextCompaction', id: 'cc1' },
          ],
        },
        {
          id: 'turn_2',
          rootTurnId: null,
          itemsView: 'full',
          status: 'completed',
          error: null,
          startedAt: null,
          completedAt: null,
          durationMs: null,
          items: [{ type: 'userMessage', id: 'u2', clientId: null, content: [{ type: 'skill', name: 'triage', path: '/s/triage/SKILL.md' }] }],
        },
      ] as unknown as Thread['turns'],
    })
    const at = '2026-10-26T07:33:20.000Z'
    expect(codexTranscript(read)).toEqual([
      { uuid: 'u1', timestamp: at, sidechain: false, event: { type: 'notice', kind: 'user', text: 'Fix the build' } },
      { uuid: 'r1', timestamp: at, sidechain: false, event: { type: 'thinking', text: 'Looking at the lint output', messageId: 'r1', parentToolUseId: null } },
      { uuid: 'c1', timestamp: at, sidechain: false, event: { type: 'tool_use', id: 'c1', name: 'commandExecution', input: { command: 'pnpm lint', cwd: '/p' }, parentToolUseId: null } },
      { uuid: 'c1', timestamp: at, sidechain: false, event: { type: 'tool_result', toolUseId: 'c1', content: '1 problem\n', isError: true, parentToolUseId: null } },
      { uuid: 'm1', timestamp: at, sidechain: false, event: { type: 'text', text: 'The build is fixed.', messageId: 'm1', parentToolUseId: null, synthetic: false } },
      { uuid: 'cc1', timestamp: at, sidechain: false, event: { type: 'unknown', sdkType: 'item/contextCompaction' } },
      { uuid: 'u2', sidechain: false, event: { type: 'notice', kind: 'user', text: '$triage' } },
    ])
  })
})

describe('the slash menu of a Codex Session', () => {
  it('lists /compact and /review, then the enabled skills by name, each once, with their short description', () => {
    const rows = codexSlashCommands([
      skill('triage'),
      skill('release-notes', { interface: { shortDescription: 'Draft release notes', iconSmallUrl: null, iconLargeUrl: null } }),
      skill('off', { enabled: false }),
      skill('triage', { path: '/repo/.codex/skills/triage/SKILL.md' }),
      skill('compact'),
      skill('two words'),
      skill('team/triage'),
    ])
    expect(rows).toEqual([
      ...CODEX_BUILT_IN_COMMANDS,
      { name: 'release-notes', description: 'Draft release notes', argumentHint: '', kind: 'skill' },
      { name: 'triage', description: 'The triage skill.', argumentHint: '', kind: 'skill' },
    ])
    expect(CODEX_BUILT_IN_COMMANDS.map((row) => `${row.kind}:${row.name}`)).toEqual(['command:compact', 'command:review'])
  })

  it('reads the /name a message starts with', () => {
    expect(['/compact', '  /review focus', '/a:b x', 'no', '/', '//x', 'a /review'].map(slashName)).toEqual(['compact', 'review', 'a:b', null, null, null, null])
  })

  it('turns /compact, /review and a skill into what Codex runs; anything else is a plain message', () => {
    const skills = [skill('triage'), skill('off', { enabled: false })]
    const message = (text: string) => ({ text, attachments: [] })
    expect(codexCommandOf(message('/compact'), skills)).toEqual({ kind: 'compact' })
    expect(codexCommandOf(message('/compact now please'), skills)).toBeNull()
    expect(codexCommandOf(message('/review'), skills)).toEqual({ kind: 'review', target: { type: 'uncommittedChanges' } })
    expect(codexCommandOf(message('/review  the tests only '), skills)).toEqual({ kind: 'review', target: { type: 'custom', instructions: 'the tests only' } })
    expect(codexCommandOf(message('/triage the new ones'), skills)).toEqual({ kind: 'skill', name: 'triage', path: '/home/me/.codex/skills/triage/SKILL.md', text: '$triage the new ones' })
    expect(codexCommandOf(message('/triage'), skills)).toMatchObject({ kind: 'skill', text: '$triage' })
    expect(codexCommandOf(message('/off'), skills)).toBeNull()
    expect(codexCommandOf(message('/model gpt-5'), skills)).toBeNull()
    expect(codexCommandOf(message('just text'), skills)).toBeNull()
  })

  it('sends a built-in command with attachments as a plain message, so nothing attached is dropped', () => {
    const attachments = [{ kind: 'file' as const, name: 'notes.md', path: '/p/notes.md', size: 10, copied: false }]
    expect(codexCommandOf({ text: '/review', attachments }, [])).toBeNull()
    expect(codexCommandOf({ text: '/triage', attachments }, [skill('triage')])).toMatchObject({ kind: 'skill' })
  })

  it('a skill goes as its $name in the text and a skill item after it', () => {
    const call = { kind: 'skill' as const, name: 'triage', path: '/s/triage/SKILL.md', text: '$triage the new ones' }
    expect(userInput({ text: '/triage the new ones', attachments: [] }, call)).toEqual([
      { type: 'text', text: '$triage the new ones', text_elements: [] },
      { type: 'skill', name: 'triage', path: '/s/triage/SKILL.md' },
    ])
    expect(userInput({ text: '/triage the new ones', attachments: [] })).toEqual([{ type: 'text', text: '/triage the new ones', text_elements: [] }])
  })

  it('a skill call keeps its attachments: each image before the text, the paths of the files in it', () => {
    const call = { kind: 'skill' as const, name: 'triage', path: '/s/triage/SKILL.md', text: '$triage the new ones' }
    const image = { kind: 'image' as const, name: 'shot.png', mediaType: 'image/png' as const, size: 3, data: 'AAAA' }
    const file = { kind: 'file' as const, name: 'notes.md', path: '/p/notes.md', size: 10, copied: false }
    const input = userInput({ text: '/triage the new ones', attachments: [image, file] }, call)
    expect(input.map((each) => each.type)).toEqual(['image', 'text', 'skill'])
    expect(input[0]).toEqual({ type: 'image', url: 'data:image/png;base64,AAAA' })
    const text = (input[1] as { text: string }).text
    expect(text.startsWith('$triage the new ones')).toBe(true)
    expect(text).toContain('/p/notes.md')
    expect(text).not.toContain('/triage')
    expect(input[2]).toEqual({ type: 'skill', name: 'triage', path: '/s/triage/SKILL.md' })
  })
})
