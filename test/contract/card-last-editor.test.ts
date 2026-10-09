// Which Session last edited a Card (src/shared/cards/last-editor.ts), from the `tool_use` events of
// Sessions on the fake agent, and how main keeps the answer in the Card Node's data
// (cardEditRecorder in src/main/mcp/canvas-server.ts) so it survives a restart.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type QueryFactory } from '../../src/main/agent/session'
import { LayoutStore } from '../../src/main/layout/store'
import { canvasForSession, cardEditRecorder, type CanvasDeps } from '../../src/main/mcp/canvas-server'
import type { AgentEvent } from '../../src/shared/agent/events'
import { cardEditedBy, cardOfPath, lastEditor, normalizePath, type ToolUseRecord } from '../../src/shared/cards/last-editor'
import type { Layout } from '../../src/shared/layout/types'

const PROJECT = 'demo-0a1b2c3d'

let scratch: string
let repo: string
let dataDir: string
let cardsDir: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-last-editor-')))
  repo = join(scratch, 'repo')
  dataDir = join(scratch, 'data')
  cardsDir = join(dataDir, PROJECT, 'cards')
  mkdirSync(repo)
  mkdirSync(cardsDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('lastEditor: paths', () => {
  it('normalizes ., .., repeated slashes and a path relative to the cwd', () => {
    expect(normalizePath('/a//b/./c/../d', '/x')).toBe('/a/b/d')
    expect(normalizePath('cards/c1/index.html', '/data/p')).toBe('/data/p/cards/c1/index.html')
    expect(normalizePath('../../..', '/a')).toBe('/')
    expect(normalizePath('', '/a')).toBeNull()
    expect(normalizePath('a\0b', '/a')).toBeNull()
  })

  it('names the Card whose folder holds a file, and nothing for the folder itself, a sibling folder or a lookalike prefix', () => {
    const at = (path: string, cwd = '/') => cardOfPath(path, cardsDir, cwd)
    expect(at(`${cardsDir}/c1/index.html`)).toBe('c1')
    expect(at(`${cardsDir}/c1/assets/app.js`)).toBe('c1')
    expect(at(`${cardsDir}/c1`)).toBeNull()
    expect(at(`${cardsDir}/c1/`)).toBeNull()
    expect(at(`${cardsDir}/c10/index.html`)).toBe('c10')
    expect(at(`${cardsDir}-evil/c1/index.html`)).toBeNull()
    expect(at(`${cardsDir}/c1/../c2/index.html`)).toBe('c2')
    expect(at(`${cardsDir}/c1/../../layout.json`)).toBeNull()
    expect(at('index.html', `${cardsDir}/c1`)).toBe('c1')
    expect(cardOfPath(`${cardsDir}/c1/x`, `${cardsDir}/`, '/')).toBe('c1')
  })

  it('counts Write, Edit, MultiEdit and NotebookEdit, and not Read, Bash or a tool without a path', () => {
    const file = `${cardsDir}/c1/index.html`
    expect(cardEditedBy({ cwd: '/', name: 'Write', input: { file_path: file, content: '<html>' } }, cardsDir)).toBe('c1')
    expect(cardEditedBy({ cwd: '/', name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }, cardsDir)).toBe('c1')
    expect(cardEditedBy({ cwd: '/', name: 'MultiEdit', input: { file_path: file, edits: [] } }, cardsDir)).toBe('c1')
    expect(cardEditedBy({ cwd: '/', name: 'NotebookEdit', input: { notebook_path: `${cardsDir}/c1/n.ipynb` } }, cardsDir)).toBe('c1')
    expect(cardEditedBy({ cwd: '/', name: 'Read', input: { file_path: file } }, cardsDir)).toBeNull()
    expect(cardEditedBy({ cwd: '/', name: 'Bash', input: { command: `echo > ${file}` } }, cardsDir)).toBeNull()
    expect(cardEditedBy({ cwd: '/', name: 'Write', input: { file_path: 42 } }, cardsDir)).toBeNull()
    expect(cardEditedBy({ cwd: '/', name: 'Write', input: null }, cardsDir)).toBeNull()
    expect(cardEditedBy({ cwd: '/', name: 'toString', input: { file_path: file } }, cardsDir)).toBeNull()
  })

  it('A writes c1, B edits c1, C writes outside and through c1/../c2: the last editor of c1 is B', () => {
    const uses: ToolUseRecord[] = [
      { sessionId: 'A', cwd: repo, name: 'Write', input: { file_path: `${cardsDir}/c1/index.html` } },
      { sessionId: 'B', cwd: repo, name: 'Edit', input: { file_path: `${cardsDir}/c1/app.js` } },
      { sessionId: 'C', cwd: repo, name: 'Write', input: { file_path: `${repo}/notes.md` } },
      { sessionId: 'C', cwd: repo, name: 'Write', input: { file_path: `${cardsDir}/c1/../c2/index.html` } },
      { sessionId: 'C', cwd: repo, name: 'Read', input: { file_path: `${cardsDir}/c1/index.html` } },
    ]
    expect(lastEditor(uses, cardsDir, 'c1')).toBe('B')
    expect(lastEditor(uses, cardsDir, 'c2')).toBe('C')
    expect(lastEditor(uses, cardsDir, 'c3')).toBeNull()
  })
})

// Claude Code on Windows gives `file_path` with `\` (evidence of worfy-windows ticket 01, section 13).
describe('lastEditor: Windows paths (worfy-windows ticket 08)', () => {
  const winCards = 'C:\\p\\data\\cards'

  it('normalizes a Windows path: `\\` and `/` are one separator, the drive letter is upper case', () => {
    expect(normalizePath('C:\\a\\\\b\\.\\c\\..\\d', 'C:\\x')).toBe('C:\\a\\b\\d')
    expect(normalizePath('C:/a/b', '/x')).toBe('C:\\a\\b')
    expect(normalizePath('c:\\a', '/x')).toBe('C:\\a')
    expect(normalizePath('cards\\c1/x.md', 'C:\\p\\data')).toBe('C:\\p\\data\\cards\\c1\\x.md')
    expect(normalizePath('..\\..\\..', 'C:\\a')).toBe('C:\\')
    expect(normalizePath('\\\\srv\\share\\a\\..\\b', '/x')).toBe('\\\\srv\\share\\b')
    // `C:a` is in the current folder of drive C:, known only when the cwd is on C:.
    expect(normalizePath('C:a', 'D:\\x')).toBeNull()
    expect(normalizePath('c:a\\b', 'C:\\x')).toBe('C:\\x\\a\\b')
    // `\a` is the root of the cwd's drive.
    expect(normalizePath('\\a\\b', 'D:\\x\\y')).toBe('D:\\a\\b')
  })

  it('reads a Git Bash path /c/… as drive C: against a Windows folder of Cards', () => {
    expect(cardOfPath('/c/p/data/cards/abc/x.md', winCards, 'C:\\')).toBe('abc')
    expect(cardOfPath('/C/p/data/cards/abc/x.md', winCards, '/')).toBe('abc')
    expect(cardOfPath('/d/p/data/cards/abc/x.md', winCards, 'C:\\')).toBeNull()
    expect(cardOfPath('/c', winCards, 'C:\\')).toBeNull()
  })

  it('keeps the POSIX rules for a POSIX path: `\\` is part of a name, case counts', () => {
    expect(normalizePath('/a/b\\c', '/')).toBe('/a/b\\c')
    expect(normalizePath('b\\c', '/a')).toBe('/a/b\\c')
    expect(cardOfPath('/P/data/cards/abc/x', '/p/data/cards', '/')).toBeNull()
    expect(cardOfPath('/p/data/cards/abc\\x', '/p/data/cards', '/')).toBeNull()
    expect(cardOfPath('/c/p/data/cards/abc/x', '/c/p/data/cards', '/')).toBe('abc')
  })

  it('names the Card of a Write with a `C:\\…` file_path, of a relative `cards\\…` path and of a path in another case', () => {
    const write = (file_path: string, cwd = 'C:\\p\\data') => cardEditedBy({ cwd, name: 'Write', input: { file_path, content: 'x' } }, winCards)
    expect(write('C:\\p\\data\\cards\\abc\\index.html')).toBe('abc')
    expect(write('cards\\abc\\x.md')).toBe('abc')
    expect(write('c:\\P\\DATA\\cards\\abc\\x.md')).toBe('abc')
    expect(write('C:/p/data/cards/abc/x.md', '/')).toBe('abc')
  })

  it('names nothing for the folder itself, a lookalike prefix, another drive or a POSIX path', () => {
    const at = (path: string) => cardOfPath(path, winCards, 'C:\\')
    expect(at('C:\\p\\data\\cards\\abc')).toBeNull()
    expect(at('C:\\p\\data\\cards-evil\\abc\\x')).toBeNull()
    expect(at('D:\\p\\data\\cards\\abc\\x')).toBeNull()
    expect(at('/p/data/cards/abc/x')).toBeNull()
    expect(at('C:\\p\\data\\cards\\abc\\..\\..\\layout.json')).toBeNull()
  })

  it('A writes abc with `\\`, B edits it with `/`: the last editor of abc is B', () => {
    const uses: ToolUseRecord[] = [
      { sessionId: 'A', cwd: 'C:\\p', name: 'Write', input: { file_path: 'C:\\p\\data\\cards\\abc\\index.html' } },
      { sessionId: 'B', cwd: 'C:\\p', name: 'Edit', input: { file_path: 'C:/p/data/cards/abc/app.js' } },
    ]
    expect(lastEditor(uses, winCards, 'abc')).toBe('B')
  })
})

/** One fake-agent turn: init, then one assistant message with the given tool calls, then result. */
function script(name: string, uses: { name: string; input: Record<string, unknown> }[]): string {
  const lines = [
    { fake: 'wait_message' },
    { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: [], mcp_servers: [], model: 'fake', permissionMode: 'bypassPermissions', apiKeySource: 'none', slash_commands: [], uuid: `${name}-1` },
    {
      type: 'assistant',
      message: { id: `msg-${name}`, type: 'message', role: 'assistant', content: uses.map((use, index) => ({ type: 'tool_use', id: `${name}-tool-${index}`, ...use })) },
      parent_tool_use_id: null,
      session_id: '{{session}}',
      uuid: `${name}-2`,
    },
    { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0, duration_ms: 1, num_turns: 1, session_id: '{{session}}', uuid: `${name}-3` },
  ]
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
}

describe('lastEditor: Sessions on the fake agent', () => {
  it('the Card Node keeps B, the last Session that wrote into its folder, and a new store reads it back', async () => {
    const scriptsDir = join(scratch, 'scripts')
    mkdirSync(scriptsDir)
    writeFileSync(join(scriptsDir, 'session-a.jsonl'), script('a', [{ name: 'Write', input: { file_path: `${cardsDir}/c1/index.html`, content: '<title>Clock</title>' } }]))
    writeFileSync(
      join(scriptsDir, 'session-b.jsonl'),
      script('b', [
        { name: 'Read', input: { file_path: `${cardsDir}/c1/index.html` } },
        { name: 'MultiEdit', input: { file_path: `${cardsDir}/c1/app.js`, edits: [] } },
      ]),
    )
    writeFileSync(
      join(scriptsDir, 'session-c.jsonl'),
      script('c', [
        { name: 'Write', input: { file_path: 'README.md', content: 'outside' } },
        { name: 'Edit', input: { file_path: `${cardsDir}/c1/../c2/index.html` } },
      ]),
    )

    const written: Layout[] = []
    const store = new LayoutStore((projectId) => join(dataDir, projectId), { write: (_file, layout) => written.push(layout) })
    for (const id of ['c1', 'c2']) store.apply(PROJECT, { op: 'create', node: { id, kind: 'card', x: 0, y: 0, w: 360, h: 280, data: { title: id } } })
    const deps: CanvasDeps = {
      projects: () => [{ id: PROJECT, name: 'demo', path: repo }],
      dataDir: (projectId) => join(dataDir, projectId),
      layout: store,
      workflow: () => Promise.resolve({ epics: [], tickets: [], error: null }),
    }

    // The fake agent in place of Claude Code, wrapped the way the SDK factory wraps the real one.
    const fake = fakeQueryFactory({ scriptsDir, script: (request) => request.resume ?? 'none' })
    const factory: QueryFactory = async (request) => {
      const query = await fake(request)
      const canvas = await canvasForSession({ cwd: request.cwd, resume: request.resume }, deps)
      return canvas ? canvas.observe(query) : query
    }
    const registry = new SessionRegistry(factory)
    const records: ToolUseRecord[] = []
    const runTurn = (sessionId: string) =>
      new Promise<void>((resolve) => {
        const session = registry.start(repo, sessionId, (id, event: AgentEvent) => {
          if (event.type === 'tool_use') records.push({ sessionId: id, cwd: repo, name: event.name, input: event.input })
          if (event.type === 'result') resolve()
        })
        session.send('go')
      })
    for (const sessionId of ['session-a', 'session-b', 'session-c']) await runTurn(sessionId)
    registry.closeAll()

    // The pure function over the events the Sessions sent...
    expect(lastEditor(records, cardsDir, 'c1')).toBe('session-b')
    expect(lastEditor(records, cardsDir, 'c2')).toBe('session-c')
    // ...and what main recorded on the Nodes while the Sessions ran.
    const node = (id: string) => store.get(PROJECT).layout.nodes.find((each) => each.id === id)
    expect(node('c1')?.data).toEqual({ title: 'c1', lastEditor: 'session-b' })
    expect(node('c2')?.data).toEqual({ title: 'c2', lastEditor: 'session-c' })

    // Written into the Layout file, so a restarted app reads it back.
    store.flushAll()
    expect(written.at(-1)?.nodes.find((each) => each.id === 'c1')?.data.lastEditor).toBe('session-b')
  })

  it('a write into the folder of a Card with no Node, or by a Session not yet known, changes nothing', () => {
    const store = new LayoutStore((projectId) => join(dataDir, projectId), { write: () => undefined })
    store.apply(PROJECT, { op: 'create', node: { id: 'n1', kind: 'note', x: 0, y: 0, w: 220, h: 120 } })
    let sessionId: string | null = null
    const record = cardEditRecorder({ projectId: PROJECT, cardsDir, cwd: repo, layout: store, sessionId: () => sessionId })
    const message = (path: string) => ({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: path } }] },
      parent_tool_use_id: null,
      session_id: 'S',
    })
    record(message(`${cardsDir}/c1/index.html`))
    expect(store.get(PROJECT).revision).toBe(1)
    sessionId = 'S'
    record(message(`${cardsDir}/missing/index.html`))
    // A note with the id of the folder is not a Card.
    record(message(`${cardsDir}/n1/index.html`))
    expect(store.get(PROJECT).revision).toBe(1)
    store.apply(PROJECT, { op: 'create', node: { id: 'c1', kind: 'card', x: 0, y: 0, w: 360, h: 280 } })
    record(message(`${cardsDir}/c1/index.html`))
    record(message(`${cardsDir}/c1/index.html`))
    // The second write by the same Session changes nothing more.
    expect(store.get(PROJECT).revision).toBe(3)
    expect(store.get(PROJECT).layout.nodes.find((node) => node.id === 'c1')?.data).toEqual({ lastEditor: 'S' })
  })
})
