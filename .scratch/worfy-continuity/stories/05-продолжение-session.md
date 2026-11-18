# Code story — worfy-continuity 05: Продолжение Session после перезапуска: сообщение-продолжение, очередь на месте, chip и Continue

Kind: pr · Epic: worfy-continuity · Ticket: 05 · PR: - · Language: ru

## 1. Что было не так

После перезапуска worfy Session, оборванная в turn-е, просто останавливалась: человек сам находил её, открывал и
писал «продолжай», а очередь сообщений пропадала. Запись `live-sessions.json` (Ticket 03) уже говорит, какие Session-ы
были в turn-е или с очередью, а функция Ticket-а 16 — какие внешние вызовы остались без результата; никто их не
читал при старте.

- Требование: [Что происходит](../issues/05-продолжение-session.md#что-происходит)

## 2. Только оборванный turn

Code: `src/main/agent/continuity.ts:75-88` · key lines: 76, 84, 87

```ts
export function cutOffTurn(entries: readonly TranscriptEntry[]): { events: AgentEvent[]; since: number | null } {
  const own = entries.filter((entry) => !entry.sidechain)
  let start = -1
  for (let index = own.length - 1; index >= 0; index--) {
    if (startsTurn((own[index] as TranscriptEntry).event)) {
      start = index
      break
    }
  }
  if (start < 0) return { events: mainThreadEvents(own), since: null }
  const stamp = own[start]?.timestamp
  const since = stamp === undefined ? Number.NaN : Date.parse(stamp)
  return { events: mainThreadEvents(own.slice(start)), since: Number.isFinite(since) ? since : null }
}
```

- Что делает: из транскрипта Session оставляет её собственную ветку (без `sidechain`) от последнего сообщения
  человека (`notice` вида `user`, кроме Interrupt, или `prompt`) до конца и время этого сообщения. Без такого
  сообщения — вся ветка и `since: null`.
- Почему здесь: `unknownSideEffects` считает каждый вызов без результата среди данных ему событий; review Ticket-а 16
  записал долг — Ticket 05 передаёт только оборванный turn и проверяет это test-ом приёмки.
- Без него: `git push` прошлого turn-а, у которого не было результата (например, после Interrupt человека), навсегда
  блокировал бы продолжение.
- Требование: [Что делаем, пункт 3](../issues/05-продолжение-session.md#что-делаем)
- Риски и пробелы test-ов: Subagent-ы берутся по `since` — время изменения их файла не раньше начала turn-а;
  Subagent-ы Session-а Codex не читаются вовсе (`shortcut:` в заголовке модуля).

## 3. Решение по одной записи: Run, вызовы, час, прежний процесс

Code: `src/main/agent/continuity.ts:344-406` · key lines: 347, 354, 374, 376, 382, 387, 395, 401, 404

```ts
  private async one(project: ContinuityProject, record: LiveSession, startedAt: number, updatedAt: number | null): Promise<ContinuityOutcome> {
    const done = (outcome: ContinuityOutcome['outcome'], reason: string | null): ContinuityOutcome => ({ projectId: project.id, nodeId: record.nodeId, kind: record.kind, outcome, reason })
    // 1. A Run's Session: the Run continues it (ticket 06).
    if (record.runId !== null) return done('skipped', `the Run ${record.runId} owns it`)
    if (record.vendorSessionId === null) return done('skipped', 'its agent had not named its session yet')
    const sessionId = record.vendorSessionId
    const queue = queueEntries(record.queue)
    // A Node that names another session than the one cut off: resuming either could send the message to the wrong
    // session. The Node keeps the chip; Continue resumes its own session and sends nothing, its queue held.
    const kept = record.kind === 'session-node' ? this.deps.keptSession(project.id, record.nodeId) : null
    if (kept !== null && kept !== sessionId) {
      const reason = `its Node names the session ${kept}, not ${sessionId} that the restart cut off`
      this.log(`worfy: the Session of ${record.nodeId} (${project.id}) was not continued: ${reason}`)
      const delivery: RestartDelivery = { text: null, queue: { ...queue, paused: true }, before: [`worfy: not continued: ${reason}`], after: [] }
      this.deps.interrupted(project.id, record.nodeId, { at: startedAt, reason, sessionId, delivery })
      return done('interrupted', reason)
    }

    const turn = inTurn(record)
    const at = this.deps.clock(startedAt, startedAt)
    const cause = restartCause(updatedAt, record.lastEventAt, startedAt)
    let reason: string | null = null
    let text: string | null = null
    // 2. The unknown side effects, over the cut-off turn alone, read before the resume.
    if (turn) {
      const transcript = await this.deps.transcript(project, record)
      if (transcript === null) reason = 'its transcript could not be read, so its last commands are not known'
      else {
        const cut = cutOffTurn(transcript.entries)
        const subagents = interruptedSubagents(transcript.subagents, cut.since)
        const found = unknownSideEffects({ session: record, events: cut.events, subagents, workflow: undefined })
        if (hasCalls(found)) reason = `${callsText(found)} may or may not have run`
        text = restartText({ at, cause, subagents: restartSubagents(subagents) })
      }
      text ??= restartText({ at, cause, subagents: [] })
    }
    // 3. The hour and the cap.
    if (reason === null) {
      const rule = continuityRule(record, startedAt)
      if (rule === 'too-old') reason = 'it was cut off more than an hour before worfy started again'
      else if (rule === 'cap') reason = `worfy continued it ${CONTINUE_CAP} times within the hour already`
    }
    // 4. The previous process of the Session.
    if (reason === null) reason = await this.previousGone(project, record)

    const said = cause === 'update' ? `worfy: restarted at ${at} (update)` : `worfy: restarted at ${at}`
    const after = [text === null ? `${said}; the queue is back` : `${said}, sent "continue"`]
    if (reason !== null) {
      this.log(`worfy: the Session of ${record.nodeId} (${project.id}) was not continued: ${reason}`)
      if (record.kind === 'session-node') {
        const delivery: RestartDelivery = { text, queue, before: [`worfy: not continued: ${reason}`], after }
        this.deps.interrupted(project.id, record.nodeId, { at: startedAt, reason, sessionId, delivery })
      }
      return done('interrupted', reason)
    }

    // 5. The continuation, counted against the cap before it starts.
    for (const continued of record.continuedAt) this.deps.noteContinued(record.nodeId, continued)
    this.deps.noteContinued(record.nodeId, startedAt)
    const session = record.kind === 'orchestrator' ? await this.deps.orchestrator(project.id) : await this.deps.node(project.id, record.nodeId, sessionId)
    deliverRestart(session, { text, queue, before: [], after })
    return done('continued', null)
  }
```

- Что делает: Session Run-а пропускает; Node, чей `data.sessionId` в `layout.json` называет другую Session, чем
  запись `live-sessions.json`, получает chip без продолжения — Continue возобновит её собственную Session, ничего не
  отправит и вернёт очередь held; для Session в turn-е читает транскрипт до resume, ищет вызовы без результата
  и строит `restartText`; затем правило часа и cap; затем прежний процесс. Есть причина — Session Node получает метку
  (chip и Continue), Orchestrator только пишется в log. Нет — продолжение засчитывается в cap до старта, Session
  стартует и получает сообщение, очередь и строку `notice`.
- Почему здесь: Ticket называет новый модуль `src/main/agent/continuity.ts` и порядок пунктов 2–6; транскрипт читается
  до resume, потому что после SIGKILL resume Claude Code сам дописывает «Tool call interrupted» к вызову (spike 01,
  «Итог»).
- Без него: Session с оборванным `gh pr merge` продолжалась бы сама, и модель могла бы повторить merge.
- Требование: [Что делаем, пункты 2–6](../issues/05-продолжение-session.md#что-делаем)
- Риски и пробелы test-ов: причина выхода (выход или падение) не различается — текст говорит «it quit or crashed»,
  если `update/restart.json` не указывает на Update. Второй перезапуск до Continue теряет chip: запись уже не в turn-е.

## 4. Прежний процесс: ждать, потом завершить

Code: `src/main/agent/continuity.ts:409-422` · key lines: 412, 414, 416, 420

```ts
  private async previousGone(project: ContinuityProject, record: LiveSession): Promise<string | null> {
    const previous = await this.deps.previous(project, record)
    if (previous === null) return null
    if (!previous.orphan) return `it runs in another program (pid ${previous.pid})`
    this.log(`worfy: waiting for the previous process of the Session of ${record.nodeId} (pid ${previous.pid}) to exit`)
    if (await this.deps.exited(previous, this.deps.exitWaitMs ?? EXIT_WAIT_MS)) return null
    try {
      this.deps.kill(previous)
    } catch (error) {
      this.log(`worfy: could not stop the previous process (pid ${previous.pid}): ${messageOf(error)}`)
    }
    if (await this.deps.exited(previous, this.deps.killExitMs ?? KILL_EXIT_MS)) return null
    return `its previous Claude Code process (pid ${previous.pid}) did not exit`
  }
```

- Что делает: процесс Claude Code этой Session, оставшийся без родителя, ждёт 7,5 с, потом получает SIGKILL и ещё 2 с;
  процесс с живым родителем (другая программа) не трогает, и Session не продолжается.
- Почему здесь: пункт 5 Ticket-а и ADR-0064 (те же сроки ожидания); процесс ищется по реестру `sessions/<pid>.json`
  Claude home и списку процессов (`parentState`: `ps` на macOS, `Win32_Process` с `CreationDate` на Windows).
- Без него: два процесса писали бы в один транскрипт.
- Требование: [Что делаем, пункт 5](../issues/05-продолжение-session.md#что-делаем)
- Риски и пробелы test-ов: список процессов Windows проверен только разбором вывода в unit test-е; на Windows он не
  запускался — его проверит job Windows в `ci-ok`.

## 5. Сообщение-продолжение

Code: `src/shared/agent/continue-plan.ts:1073-1089` · key lines: 1076, 1077, 1084, 1087

```ts
export function restartText({ at, cause, subagents }: RestartTextInput): string {
  const lines = [
    cause === 'update'
      ? `worfy was updated and restarted at ${at}, which cut off your previous turn before it finished. From now on this Session runs under the Harness of the new copy of worfy.`
      : `worfy restarted at ${at} (it quit or crashed), which cut off your previous turn before it finished.`,
  ]
  // An id is named only when it is one short word (SAFE_WORD): it comes from a file name, never from the model's text.
  const named = subagents.filter((subagent) => SAFE_WORD.test(subagent.agentId))
  if (named.length > 0) {
    const ticket = (subagent: RestartSubagent): string =>
      subagent.ticket === null ? 'no Ticket' : `Ticket ${subagent.ticket.epic}/${String(subagent.ticket.num).padStart(2, '0')}`
    lines.push(`These Subagents of yours became Interrupted with it:\n${named.map((subagent) => `- \`${subagent.agentId}\` (${ticket(subagent)})`).join('\n')}`)
  }
  lines.push('Continue from where you stopped. A Ticket that was in work goes on as the skill epic-wave says in its section "How to resume a wave".')
  lines.push(CUT_SENTENCE, CHECK_SENTENCE)
  return lines.join('\n')
}
```

- Что делает: одно английское сообщение: когда и почему worfy перезапустился (Update — отдельной фразой про новый
  Harness), какие Subagent-ы стали Interrupted и их Ticket-ы, ссылка на «How to resume a wave», фраза spike-а 01 про
  вызов без результата и просьба проверить каждую команду перед повтором. Исходного сообщения turn-а в нём нет.
- Почему здесь: Ticket требует `restartText` рядом с `retryText`; `CHECK_SENTENCE` — общий с ним.
- Без него: модель не знала бы, что turn оборван, и могла бы повторить команду, которая успела выполниться.
- Требование: [Что делаем, пункт 6](../issues/05-продолжение-session.md#что-делаем)
- Риски и пробелы test-ов: id Subagent-а берётся из имени файла и называется только как одно короткое слово
  (`SAFE_WORD`).

## 6. Метка на Node и Continue

Code: `src/main/agent/node-sessions.ts:334-375` · key lines: 338, 341, 353, 361, 369, 371

```ts
  interrupted(projectId: string, nodeId: string, mark: RestartMark): void {
    if (this.runs.has(nodeId)) return
    const node = this.deps.layout.get(projectId).layout.nodes.find((each) => each.id === nodeId)
    if (!node || !isWorfyNode(node)) throw new Error(`${nodeId} is not a Session Node of worfy`)
    const saved = keptSession(node) ?? mark.sessionId
    const vendor = node.data.vendor === undefined ? UNNAMED_VENDOR : knownVendor(String(node.data.vendor))
    const kind = typeof node.data.kind === 'string' ? knownKind(node.data.kind) : undefined
    this.marks.set(nodeId, mark)
    this.setView({
      projectId,
      nodeId,
      vendor,
      ...(kind === undefined ? {} : { kind }),
      sessionId: saved,
      sdkSessionId: saved,
      state: 'closed',
      error: null,
      cwd: this.deps.projectPath(projectId),
      model: null,
      restart: { at: mark.at, reason: mark.reason },
    })
  }

  /** The session id the Session Node keeps in layout.json; null when it keeps none yet. Throws for another Node. */
  keptSessionOf(projectId: string, nodeId: string): string | null {
    const node = this.deps.layout.get(projectId).layout.nodes.find((each) => each.id === nodeId)
    if (!node || !isWorfyNode(node)) throw new Error(`${nodeId} is not a Session Node of worfy`)
    return keptSession(node)
  }

  /** Gives the Session that just started on the Node what continuity.ts kept for it after the restart, once. */
  private deliverMark(nodeId: string): void {
    const mark = this.marks.get(nodeId)
    const session = this.runs.get(nodeId)?.session
    if (mark === undefined || session === null || session === undefined) return
    this.marks.delete(nodeId)
    try {
      deliverRestart(session, mark.delivery)
    } catch (error) {
      console.warn(`[sessions] could not give ${nodeId} its message after the restart`, error)
    }
  }
```

- Что делает: `interrupted` хранит метку и публикует закрытый view с `restart: {at, reason}`; `deliverMark`, после
  старта Session из `start()`, один раз отдаёт ей то же сообщение, очередь и строки `notice` («not continued» перед
  сообщением) и снимает метку. Resume из History (`resume()`) тоже снимает метку: сообщение и очередь там уже
  устарели. Node без `data.sessionId` (crash раньше записи `layout.json`, она идёт через 250–1000 мс) возобновляет
  Session записи — `start(…, cutOff)` или `mark.sessionId`, а не запускает новую.
- Почему здесь: пункт 9 Ticket-а — Continue на Node это Resume (`sessions.start`) плюс `restartText`; поле
  `restart` добавлено в `sessionNodeViewSchema` (`src/shared/ipc/sessions.ts` — вне списка файлов Ticket-а).
- Без него: Continue после «Interrupted by restart» открыл бы Session без сообщения, как обычный Resume.
- Требование: [Что делаем, пункты 3, 4 и 9](../issues/05-продолжение-session.md#что-делаем)
- Риски и пробелы test-ов: метка живёт в памяти; перезапуск до Continue её теряет. Повторную доставку и Resume из
  History держат contract test-ы; мутанты без `this.marks.delete` краснеют.

## 7. Chip на Node

Code: `src/renderer/canvas/nodes/SessionNode.tsx:306-311` · key lines: 307, 311

```tsx
  const restartMark = view?.restart ?? null
  const cutOff = running ? null : restartMark
  const chip: { status: Status; label: string } = running
    ? STATE_CHIPS[view.state]
    : cutOff !== null
      ? { status: 'blocked', label: 'Interrupted by restart' }
```

- Что делает: закрытая Session с полем `restart` показывает chip «Interrupted by restart» (причина — в tooltip
  «Not continued: …»), а вместо Resume — кнопку Continue, которая вызывает тот же `sessions.start`.
- Почему здесь: Ticket называет `SessionNode.tsx`; вид chip-а — из наброска экрана spec-а.
- Без него: человек не увидел бы, какие Session-ы worfy сам не продолжил и почему.
- Требование: [Что делаем, пункты 3, 4 и 9](../issues/05-продолжение-session.md#что-делаем)
- Риски и пробелы test-ов: вид проверяет только e2e (`snapshotThemes`), он локально не запускался.

## 8. Когда продолжение запускается

Code: `src/main/agent/app-orchestrators.ts:301-308` · key lines: 303, 305

```ts
/** Opens the active Project; on the first window, once its page has loaded, continues the Sessions a restart cut off. */
function onWindow(_event?: unknown, window?: BrowserWindow): void {
  openActive()
  if (continuing || window === undefined) return
  continuing = true
  window.webContents.once('did-finish-load', () => {
    continueAfterRestart().catch((error: unknown) => console.error('[continuity] the Sessions cut off by the restart were not continued', error))
  })
```

- Что делает: тот же обработчик первого окна, что открывает активный Project, один раз, после загрузки страницы окна,
  запускает `continueAfterRestart`.
- Почему здесь: Ticket называет `app-orchestrators.ts` — продолжение после открытия Project-ов; страница должна уже
  слушать события, иначе строки `notice` уйдут в пустоту.
- Без него: модуль никто бы не вызвал.
- Требование: [Что делаем, пункт 1](../issues/05-продолжение-session.md#что-делаем)
- Риски и пробелы test-ов: один обработчик, а не второй `app.once`: contract test проводки main ждёт ровно одного
  слушателя `browser-window-created`. e2e на собранном приложении (`test/e2e/session-restart.spec.ts`) локально не
  запускался — его прогонит gate full.

## 9. Что сознательно не меняли

- `src/main/vendors/codex/session.ts`: Codex уже продолжает Session через `thread/resume`; contract test на fake
  app-server это показывает.
- Замки (пункт 10 Ticket-а): замок worktree ключён по `session_id` Claude Code, а продолжение возобновляет тот же id —
  запись остаётся своей; снять замок непродолженной Session значило бы писать в `~/.claude`, что brief запрещает, и
  срок 60 мин его снимет. e2e-замок не называет владельца, и команда после падения могла продолжить работу (spike 01):
  его снимает правило 30 мин. Кода для замков нет.
- Картинки очереди не сохранялись в записи Ticket-а 03: Session получает строку `notice` с их числом.

## 10. Как проверено

- `pnpm test test/unit/continuity-rules.test.ts test/unit/continue-plan.test.ts test/contract/continuity.test.ts` —
  exit 0; `test/unit/continuity-rules.test.ts` был красным до модуля.
- Мутанты: `cutOffTurn`, отдающий всю ветку, — краснеет test «push прошлого turn-а не считается»; без
  `deliverMark` в `start()` — краснеет test Continue после `git push` без результата.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (836 файлов test-ов); gate fast — exit 0. e2e не запускался
  локально — его прогонит gate full; job Windows — в `ci-ok` на head PR.

## Проверить себя

1. Почему транскрипт читается до resume, а не после?
   - Строки: `src/main/agent/continuity.ts:367-378`
   - Ответ: после SIGKILL resume Claude Code сам дописывает результат «Tool call interrupted» к оборванному вызову —
     прочитанный после resume, вызов выглядел бы завершённым.
2. Session прошлого turn-а сделала `git push` без результата, а оборванный turn — только чтение файлов. Продолжится
   ли она сама?
   - Строки: `src/main/agent/continuity.ts:75-88`
   - Ответ: да: в `unknownSideEffects` попадают только события от последнего сообщения человека.
3. Что получит Session Node, которую оборвали 2 часа назад, когда человек нажмёт Continue?
   - Строки: `src/main/agent/node-sessions.ts:365-375`
   - Ответ: Resume, затем строку «worfy: not continued: …», то же сообщение `restartText`, очередь и строку
     «restarted at …».
