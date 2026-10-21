// The renderer's side of Claude Code's questions with answer options (worfy-ui ticket 17): the card
// in the transcript (session/QuestionCard.tsx through rows/QuestionRequest.tsx), the "Waits for
// answer" badge on a Session Node (canvas/badges/WaitsForAnswer.tsx) and the toast of a question
// whose Session is not on screen (session/question-toast.ts). Against a fake bridge.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { SessionNodeView } from '../../src/shared/ipc/sessions'

type Request = Extract<AgentEvent, { type: 'question_request' }>

const screenState = vi.hoisted(() => ({ readOnly: null as string | null }))
vi.mock('../../src/renderer/projects/useProjects', async (original) => ({
  ...(await original<typeof import('../../src/renderer/projects/useProjects')>()),
  useReadOnly: () => screenState.readOnly,
}))
vi.mock('../../src/renderer/projects/read-only-now', () => ({ readOnlyNow: () => screenState.readOnly, answerReadOnly: () => undefined }))

const DATABASE = {
  question: 'Which database should the cache use?',
  header: 'Database',
  multiSelect: false,
  options: [
    { label: 'Postgres', description: 'The server the app already runs', preview: null },
    { label: 'SQLite', description: 'A file next to the app', preview: null },
  ],
}
const LAYOUT = {
  question: 'Which layout should the report use?',
  header: 'Layout',
  multiSelect: false,
  options: [
    { label: 'Table', description: 'Rows and columns', preview: '| Ticket | State |\n| --- | --- |\n| 17 | open |' },
    { label: 'Cards', description: 'One card per ticket', preview: '## 17\n\nState: **open**' },
  ],
}
const CHECKS = {
  question: 'Which checks should run first?',
  header: 'Checks',
  multiSelect: true,
  options: [
    { label: 'Lint', description: 'ESLint', preview: null },
    { label: 'Typecheck', description: 'tsc', preview: null },
    { label: 'Unit tests', description: 'vitest', preview: null },
  ],
}

const request = (questions: Request['questions'] = [DATABASE], requestId = 'q-1'): Request => ({ type: 'question_request', requestId, toolUseId: 'toolu_q', questions })

const nodeView = (overrides: Partial<SessionNodeView> = {}): SessionNodeView => ({
  projectId: 'alpha',
  nodeId: 'node-7',
  sessionId: 'sdk-7',
  sdkSessionId: 'sdk-7',
  state: 'needs_permission',
  error: null,
  cwd: '/Users/test/alpha',
  model: null,
  version: 1,
  ...overrides,
})

const asked: { channel: string; input: unknown }[] = []
const handlers = new Map<string, ((payload: unknown) => void)[]>()
let answers: Record<string, (input: unknown) => unknown>

beforeEach(() => {
  vi.resetModules()
  screenState.readOnly = null
  asked.length = 0
  handlers.clear()
  answers = {
    'agent.answerQuestion': () => ({ answered: true }),
    'sessions.views': () => ({ views: [] }),
  }
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      const answer = answers[channel]
      return Promise.resolve(answer ? { ok: true, value: answer(input) } : { ok: false, error: `no ${channel}` })
    },
    on: (channel: string, handler: (payload: unknown) => void) => {
      handlers.set(channel, [...(handlers.get(channel) ?? []), handler])
      return handlers.size
    },
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

const emit = (sessionId: string, event: AgentEvent) =>
  act(() => {
    for (const handler of handlers.get('agent.event') ?? []) handler({ sessionId, event })
  })

const answered = () => asked.filter((each) => each.channel === 'agent.answerQuestion').map((each) => each.input)

/** The live transcript of Session s1, fed by `emit`. */
async function renderLive() {
  const { useSessionLog } = await import('../../src/renderer/session/store')
  const { Transcript } = await import('../../src/renderer/session/Transcript')
  function Live() {
    const log = useSessionLog('s1')
    return <Transcript events={log.events} sessionId="s1" />
  }
  return render(<Live />)
}

async function renderCard(events: AgentEvent[]) {
  await renderLive()
  for (const event of events) emit('s1', event)
  return screen.getByTestId('question-card')
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
    await Promise.resolve()
  })
}

async function key(element: HTMLElement, name: string) {
  await act(async () => {
    fireEvent.keyDown(element, { key: name })
    await Promise.resolve()
  })
}

const options = (card: HTMLElement) => within(card).getAllByTestId('question-option')

describe('the question card', () => {
  it('shows the header, the question and the options with their descriptions; Submit waits for an answer', async () => {
    const card = await renderCard([request()])
    expect(within(card).getByTestId('question-header').textContent).toBe('Database')
    expect(within(card).getByTestId('question-text').textContent).toBe('Which database should the cache use?')
    expect(options(card).map((each) => each.textContent)).toEqual(['1PostgresThe server the app already runs', '2SQLiteA file next to the app'])
    expect(options(card).map((each) => each.getAttribute('role'))).toEqual(['radio', 'radio'])
    expect((within(card).getByTestId('question-submit') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByTestId('permission-card')).toBeNull()
  })

  it('one option answers a single-choice question: Submit sends it for this request of this Session', async () => {
    const card = await renderCard([request()])
    await click(options(card)[1]!)
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    // Another option replaces it: one choice only.
    await click(options(card)[0]!)
    await click(options(card)[1]!)
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    await click(within(card).getByTestId('question-submit'))
    expect(answered()).toEqual([{ sessionId: 's1', requestId: 'q-1', answers: [{ selected: ['SQLite'], other: null }] }])
  })

  it('"Other" text answers in place of an option of a single-choice question', async () => {
    const card = await renderCard([request()])
    await click(options(card)[0]!)
    await act(async () => {
      fireEvent.change(within(card).getByTestId('question-other'), { target: { value: 'Redis' } })
      await Promise.resolve()
    })
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    await click(within(card).getByTestId('question-submit'))
    expect(answered()).toEqual([{ sessionId: 's1', requestId: 'q-1', answers: [{ selected: [], other: 'Redis' }] }])
  })

  it('multiSelect options are switches, the "Other" text adds to them; Back / Next go between questions, Submit sends every answer', async () => {
    const card = await renderCard([request([LAYOUT, CHECKS])])
    const submit = within(card).getByTestId('question-submit') as HTMLButtonElement
    expect(within(card).getByTestId('question-text').textContent).toBe(LAYOUT.question)
    await click(options(card)[1]!)
    expect(submit.disabled).toBe(true)
    await click(within(card).getByTestId('question-next'))
    expect(within(card).getByTestId('question-text').textContent).toBe(CHECKS.question)
    expect(options(card).map((each) => each.getAttribute('role'))).toEqual(['checkbox', 'checkbox', 'checkbox'])
    await click(options(card)[2]!)
    await click(options(card)[0]!)
    await click(options(card)[1]!)
    await click(options(card)[1]!)
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
    await act(async () => {
      fireEvent.change(within(card).getByTestId('question-other'), { target: { value: 'Format check' } })
      await Promise.resolve()
    })
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
    expect(submit.disabled).toBe(false)
    // Back keeps what was picked.
    await click(within(card).getByTestId('question-back'))
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    await click(submit)
    expect(answered()).toEqual([
      {
        sessionId: 's1',
        requestId: 'q-1',
        answers: [
          { selected: ['Cards'], other: null },
          { selected: ['Unit tests', 'Lint'], other: 'Format check' },
        ],
      },
    ])
  })

  it('shows the preview of the option pointed at or picked, as markdown', async () => {
    const card = await renderCard([request([LAYOUT])])
    // The card took the focus, nothing else had it: the focused option's preview shows.
    expect(document.activeElement).toBe(options(card)[0])
    expect(within(card).getByTestId('question-preview').querySelector('table')).not.toBeNull()
    act(() => options(card)[0]!.blur())
    expect(within(card).queryByTestId('question-preview')).toBeNull()
    fireEvent.mouseEnter(options(card)[0]!)
    expect(within(card).getByTestId('question-preview').querySelector('table')).not.toBeNull()
    fireEvent.mouseLeave(options(card)[0]!)
    expect(within(card).queryByTestId('question-preview')).toBeNull()
    await click(options(card)[1]!)
    expect(within(card).getByTestId('question-preview').querySelector('h2')?.textContent).toBe('17')
  })

  it('never takes the focus from the field the user types in', async () => {
    const field = document.createElement('textarea')
    document.body.append(field)
    field.focus()
    await renderCard([request()])
    expect(document.activeElement).toBe(field)
    field.remove()
  })

  it('keys: 1–4 pick an option of the question shown, Enter goes on and then submits', async () => {
    const card = await renderCard([request([LAYOUT, CHECKS])])
    const box = card.querySelector('.w-question') as HTMLElement
    await key(box, '2')
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    await key(box, '9')
    await key(box, 'Enter')
    expect(within(card).getByTestId('question-text').textContent).toBe(CHECKS.question)
    await key(box, '1')
    await key(box, '3')
    await key(box, '4')
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
    // Digits typed into "Other" are text, not picks.
    const other = within(card).getByTestId('question-other')
    await key(other, '2')
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true'])
    await key(box, 'Enter')
    expect(answered()).toEqual([
      {
        sessionId: 's1',
        requestId: 'q-1',
        answers: [
          { selected: ['Cards'], other: null },
          { selected: ['Lint', 'Unit tests'], other: null },
        ],
      },
    ])
  })

  it('Enter does nothing while the question shown has no answer', async () => {
    const card = await renderCard([request([LAYOUT, CHECKS])])
    await key(card.querySelector('.w-question') as HTMLElement, 'Enter')
    expect(within(card).getByTestId('question-text').textContent).toBe(LAYOUT.question)
    expect(answered()).toEqual([])
  })

  it('"Decline" sends no answers', async () => {
    const card = await renderCard([request()])
    await click(within(card).getByTestId('question-decline'))
    expect(answered()).toEqual([{ sessionId: 's1', requestId: 'q-1', answers: null }])
  })

  it('an answered card shows each question with its answer and has no controls; declined and cancelled say so', async () => {
    const card = await renderCard([request([LAYOUT, CHECKS])])
    emit('s1', { type: 'question_resolved', requestId: 'q-1', outcome: 'answered', answers: { [LAYOUT.question]: 'Cards', [CHECKS.question]: 'Lint, Unit tests' } })
    const done = screen.getByTestId('question-card')
    expect(done).toBe(card)
    expect(done.dataset.resolution).toBe('answered')
    expect(within(done).getAllByTestId('question-answer-text').map((each) => each.textContent)).toEqual(['Cards', 'Lint, Unit tests'])
    expect(within(done).getByTestId('question-resolution').textContent).toBe('Answered')
    expect(within(done).queryByTestId('question-submit')).toBeNull()
    expect(within(done).queryByTestId('question-option')).toBeNull()

    emit('s1', request([DATABASE], 'q-2'))
    emit('s1', { type: 'question_resolved', requestId: 'q-2', outcome: 'cancelled', answers: {} })
    const cancelled = screen.getAllByTestId('question-card')[1]!
    expect(within(cancelled).getByTestId('question-resolution').textContent).toBe('Cancelled')
    expect(within(cancelled).getByTestId('question-answer-text').textContent).toBe('—')
  })

  it('says so when the question is no longer open, and shows main\'s refusal', async () => {
    answers['agent.answerQuestion'] = () => ({ answered: false })
    const card = await renderCard([request()])
    await click(options(card)[0]!)
    await click(within(card).getByTestId('question-submit'))
    expect(screen.getByRole('alert').textContent).toBe('This question is no longer open')
  })

  it('on a read-only screen shows the question and answers nothing: options, Submit, Decline and keys do nothing', async () => {
    screenState.readOnly = 'Studio gives this Machine read-only access'
    const card = await renderCard([request()])
    expect(options(card).every((each) => each.getAttribute('aria-disabled') === 'true')).toBe(true)
    await click(options(card)[0]!)
    await key(card.querySelector('.w-question') as HTMLElement, '1')
    expect(options(card).map((each) => each.getAttribute('aria-checked'))).toEqual(['false', 'false'])
    expect(within(card).getByTestId('question-decline').getAttribute('title')).toBe('Studio gives this Machine read-only access')
    expect((within(card).getByTestId('question-other') as HTMLInputElement).readOnly).toBe(true)
    await click(within(card).getByTestId('question-decline'))
    await click(within(card).getByTestId('question-submit'))
    expect(answered()).toEqual([])
  })

  it('a screen that turns read-only with an answer picked does not send it', async () => {
    const { QuestionCard } = await import('../../src/renderer/session/QuestionCard')
    const { rerender } = render(<QuestionCard request={request()} sessionId="s1" />)
    await click(screen.getAllByTestId('question-option')[0]!)
    expect((screen.getByTestId('question-submit') as HTMLButtonElement).disabled).toBe(false)
    screenState.readOnly = 'Studio gives this Machine read-only access'
    rerender(<QuestionCard request={request()} sessionId="s1" />)
    expect(screen.getByTestId('question-submit').getAttribute('aria-disabled')).toBe('true')
    await click(screen.getByTestId('question-submit'))
    await key(screen.getByTestId('question-card').querySelector('.w-question') as HTMLElement, 'Enter')
    expect(answered()).toEqual([])
  })

  it('a permission request of another tool still gets the permission card', async () => {
    await renderLive()
    emit('s1', { type: 'permission_request', requestId: 'r-1', toolName: 'Bash', toolUseId: null, input: { command: 'ls' }, title: null, description: null, blockedPath: null, alwaysAllow: true, suggestions: [] })
    expect(screen.getByTestId('permission-card')).toBeTruthy()
    expect(screen.queryByTestId('question-card')).toBeNull()
  })
})

describe('the "Waits for answer" badge', () => {
  const subject = { kind: 'session' as const, projectId: 'alpha', root: '/Users/test/alpha', sessionId: 'sdk-7' }

  async function mountBadges() {
    const { default: WaitsForAnswer } = await import('../../src/renderer/canvas/badges/WaitsForAnswer')
    const { default: NeedsPermission } = await import('../../src/renderer/canvas/badges/NeedsPermission')
    render(
      <>
        <WaitsForAnswer subject={subject} />
        <NeedsPermission subject={subject} />
      </>,
    )
    await act(async () => {
      await Promise.resolve()
    })
  }

  it('stands instead of "Needs permission" while every open request is a question, opens the Session, and goes once answered', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView()] })
    await mountBadges()
    emit('sdk-7', request())
    const badge = await screen.findByTestId('badge-waits-for-answer')
    expect(badge.textContent).toContain('Waits for answer')
    expect(screen.queryByTestId('badge-needs-permission')).toBeNull()
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    fireEvent.click(badge)
    expect(useNavigation.getState()).toMatchObject({ view: 'session', opened: { nodeId: 'node-7', projectId: 'alpha' } })

    emit('sdk-7', { type: 'question_resolved', requestId: 'q-1', outcome: 'answered', answers: {} })
    expect(screen.queryByTestId('badge-waits-for-answer')).toBeNull()
  })

  it('a permission request open next to a question shows both badges', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView()] })
    await mountBadges()
    emit('sdk-7', request())
    emit('sdk-7', { type: 'permission_request', requestId: 'r-1', toolName: 'Bash', toolUseId: null, input: { command: 'ls' }, title: null, description: null, blockedPath: null, alwaysAllow: true, suggestions: [] })
    await screen.findByTestId('badge-waits-for-answer')
    expect(screen.getByTestId('badge-needs-permission')).toBeTruthy()
  })

  it('shows nothing while the Session is busy, and "Needs permission" alone for a permission request', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView()] })
    await mountBadges()
    emit('sdk-7', { type: 'permission_request', requestId: 'r-1', toolName: 'Bash', toolUseId: null, input: { command: 'ls' }, title: null, description: null, blockedPath: null, alwaysAllow: true, suggestions: [] })
    await screen.findByTestId('badge-needs-permission')
    expect(screen.queryByTestId('badge-waits-for-answer')).toBeNull()
  })

  it('is in the badge slot, in the order of "Needs permission"', async () => {
    const { badges } = await import('../../src/renderer/canvas/badges/index')
    const order = (id: string) => badges.find((each) => each.id === id)?.order
    expect(order('WaitsForAnswer')).toBe(order('NeedsPermission'))
  })
})

describe('the toast of a question whose Session is not on screen', () => {
  async function start() {
    const { startQuestionToasts } = await import('../../src/renderer/session/question-toast')
    const { toasts } = await import('../../src/renderer/toast/toasts')
    startQuestionToasts()
    return () => toasts.getState().toasts
  }

  it('a simple question: its text and options as buttons that answer it through agent.answerQuestion, then "Open"', async () => {
    const shown = await start()
    emit('sdk-7', request())
    const [toast] = shown()
    expect(toast).toMatchObject({ kind: 'action', key: 'question:q-1', text: 'Asks: Which database should the cache use?', testId: 'question-toast' })
    expect(toast?.actions?.map((each) => each.label)).toEqual(['Postgres', 'SQLite', 'Open'])
    await act(async () => {
      toast?.actions?.[1]?.run()
      await Promise.resolve()
    })
    expect(answered()).toEqual([{ sessionId: 'sdk-7', requestId: 'q-1', answers: [{ selected: ['SQLite'], other: null }] }])
  })

  it('goes when the question is resolved, wherever it was answered', async () => {
    const shown = await start()
    emit('sdk-7', request())
    expect(shown()).toHaveLength(1)
    emit('sdk-7', { type: 'question_resolved', requestId: 'q-1', outcome: 'cancelled', answers: {} })
    expect(shown()).toEqual([])
  })

  it('anything but a simple question gets "Open" only; so does a read-only screen', async () => {
    const shown = await start()
    emit('sdk-7', request([CHECKS], 'q-multi'))
    emit('sdk-7', request([LAYOUT], 'q-preview'))
    emit('sdk-7', request([DATABASE, CHECKS], 'q-two'))
    screenState.readOnly = 'Studio gives this Machine read-only access'
    emit('sdk-7', request([DATABASE], 'q-read-only'))
    expect(shown().map((each) => [each.key, each.actions?.map((action) => action.label)])).toEqual([
      ['question:q-multi', ['Open']],
      ['question:q-preview', ['Open']],
      ['question:q-two', ['Open']],
      ['question:q-read-only', ['Open']],
    ])
  })

  it('"Open" shows the Session of the Node that runs it', async () => {
    answers['sessions.views'] = () => ({ views: [nodeView({ state: 'busy' })] })
    const { useSessionNodeViewOf } = await import('../../src/renderer/session/node-sessions')
    function Load() {
      useSessionNodeViewOf('alpha', 'sdk-7')
      return null
    }
    render(<Load />)
    await act(async () => {
      await Promise.resolve()
    })
    const shown = await start()
    emit('sdk-7', request())
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    act(() => shown()[0]?.actions?.at(-1)?.run())
    expect(useNavigation.getState()).toMatchObject({ view: 'session', opened: { nodeId: 'node-7', projectId: 'alpha' } })
  })

  it('no toast while the Session view shows that Session', async () => {
    const shown = await start()
    const { useNavigation } = await import('../../src/renderer/session/navigation')
    useNavigation.setState({ view: 'session' })
    render(
      <div className="w-shell__view" data-view="session">
        <div data-testid="session-view" data-session-id="sdk-7" />
      </div>,
    )
    emit('sdk-7', request())
    expect(shown()).toEqual([])
    emit('sdk-8', request([DATABASE], 'q-other'))
    expect(shown().map((each) => each.key)).toEqual(['question:q-other'])
  })
})
