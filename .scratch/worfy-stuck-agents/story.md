# Code story — worfy-stuck-agents

Kind: epic · Epic: worfy-stuck-agents · Language: ru

## Начало

Ночной Run Autopilot останавливался целиком из-за одного Ticket-а: Ticket, оставшийся в работе после хода
(`wave-unfinished`), или та же Wave, готовая снова (`no-progress`), давали остановку всего Run-а, и остальные Epic-и
очереди утром стояли не начатыми. Красный main выглядел для Run-а так же, как застрявший Ticket. Ход агента, который
молчит посреди работы, ничем не отличался от долгого: chip говорил `busy`, Subagent оставался `running`, у фазы `turn`
цикла не было таймера. Повторы одной и той же упавшей команды никто не считал.

Epic (часть 1) сделал два механизма и одну запись. Лестница Run-а: два продолжения на Ticket, потом просьба к
Orchestrator-у отложить его с `Waits: owner`, и только потом прежняя остановка; красный main (маркер, который пишет
`land`) останавливает Run с новой причиной `main-red`. Пометка тишины хода: Session помнит последний признак жизни,
chip говорит `busy · quiet N min`, на hint line появляются Interrupt и Restart, Subagent Node показывает `quiet N min`,
а в Autopilot 30 минут тишины останавливают Run с `turn-hung`, ничего не прерывая. Call log Harness считает повторы
упавших вызовов в `loops.jsonl`, и агент этого не видит.

Все девять глав взяты из Code story своих PR (у каждого PR story есть; ни одна глава не собрана по diff-у). Story
Ticket-а 10 лежит только на head PR #1961, который на момент сборки открыт, прошёл review (`VERIFIED`) и `ci-ok`.
Ticket 11 — приёмка владельцем, кода нет. Ticket 12 — замер `loop-log` не раньше чем через 14 дней после merge 07, кода
нет. Ticket 08 ушёл из Epic-а по critic-у 2026-11-17.

- Требование: [Решение](spec.md#решение)

## PR #1945 · 01 — Цикл Autopilot: лестница продолжений, `set-aside` и `main-red`

### 1. Лестница: продолжить, отложить или остановиться

Code: `src/shared/autopilot/cycle.ts:334-351` · key lines: 337, 339, 342, 344, 349

```ts
function ladder(state: CycleState, stuck: readonly number[], cause: ContinuationCause, before: CycleEffect[]): CycleStep {
  const max = state.maxContinuations ?? 0
  const setAside = state.setAside ?? []
  if (max === 0 || stuck.length === 0 || stuck.some((num) => setAside.includes(num))) return stop(state, cause, before)
  const spent = (num: number): number => state.continued?.[num] ?? 0
  const over = stuck.filter((num) => spent(num) >= max)
  if (over.length > 0) {
    const asked: CycleState = { ...state, phase: 'turn', setAside: [...setAside, ...over], asked: { kind: 'set-aside' } }
    return { state: asked, effects: [{ kind: 'set-aside', tickets: over, attempts: max, cause }] }
  }
  const continued = stuck.map((num) => ({ num, attempt: spent(num) + 1 }))
  const counts = { ...state.continued, ...Object.fromEntries(continued.map((each) => [each.num, each.attempt])) }
  const continuation: Continuation = { attempt: Math.max(...continued.map((each) => each.attempt)), of: max, cause }
  return {
    state: { ...state, phase: 'sending', continued: counts, asked: { kind: 'continue', continuation } },
    effects: [...before, { kind: 'continue-tickets', tickets: continued, of: max, cause }],
  }
}
```

- Что делает: одна чистая функция заменяет оба прежних `stop(...)` — по `settle-timeout` (`wave-unfinished`) и по той же
  готовой Wave (`no-progress`). Потолок 0, пустой список или Ticket, который уже откладывали, — прежняя остановка. Ticket
  исчерпал попытки — эффект `set-aside` и фаза `turn`. Иначе — эффект `continue-tickets` со счётчиком попыток по номеру
  Ticket-а. Тот же PR добавил причину `main-red`: она действует, только пока продолжение или `set-aside` ещё не ушли
  (окно `asked`), и строки Journal `ticket-continued` и `ticket-set-aside`.
- Почему здесь: spec требует, чтобы решения цикла оставались чистыми, а исполнение жило в `run.ts` (Ticket 05). Потолок
  по умолчанию 0, поэтому до Ticket-а 05 поведение main не менялось.
- Без него: Run останавливался бы на первом застрявшем Ticket-е, как до Epic-а.
- Требование: [Что делаем](issues/01-цикл-лестница-продолжений.md#что-делаем)
- Риски и пробелы test-ов: отрицательный или дробный `maxContinuations` не проверяется и не покрыт test-ом; если в одной
  Wave есть Ticket-ы и с попытками, и без, сначала откладываются исчерпавшие — это выбрал implementer, в spec-е не
  записано. Review: 17 и ещё 4 mutant-а `cycle.ts` убиты test-ами.

## PR #1946 · 02 — Маркер красного main: `land` пишет `main-red-<key>.json`, worfy его читает

### 2. worfy читает маркер по корню Project-а и ничего не пишет

Code: `src/main/gate/state.ts:525-534` · key lines: 526, 529, 530

```ts
export async function readMainRed(gateDir: string, root: string, platform: NodeJS.Platform = process.platform): Promise<MainRedMarker | null> {
  const key = await gateKey(await readGateConfig(gateDir), root, platform)
  if (key === null) return null
  try {
    const parsed = mainRedSchema.safeParse(JSON.parse(await readFile(join(gateDir, 'state', mainRedFileName(key)), 'utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
```

- Что делает: находит ключ registry gate-а так же, как для маркеров `red-<key>-<tag>`, читает
  `<gate>/state/main-red-<key>.json` и проверяет его форму схемой; нет ключа, файла или не та форма — `null`. Другая
  сторона маркера — `land`: он строит путь через `gate-resolve.mjs --which`, пишет файл атомарно (временный файл и
  rename) с sha, PR-виновником, временем и URL run-а, удаляет его, когда main не красный, и не трогает, пока идёт повтор
  красного push run-а (`attempt > 1`).
- Почему здесь: свой `gh run list` Run-у Autopilot запрещён инвариантом И2, а строка `mainRed` жила только в памяти
  процесса `land`. Маркер держится во время повтора по critic-у 2026-11-17: иначе Run отложил бы невиновные Ticket-ы.
- Без него: Ticket 05 не мог бы узнать о красном main и отличить его от застрявшего Ticket-а.
- Требование: [Что делаем](issues/02-маркер-красного-main.md#что-делаем)
- Риски и пробелы test-ов: review нашёл, что если красный run повторяют раньше, чем `land` увидел его красным, маркер
  за весь повтор не пишется, и Run Ticket-а 05 не остановится. Ветка «нет зелёного run-а среди 50 новейших» пишет
  маркер без test-а. Запись маркера на Windows поверх открытого файла может не пройти и только пишется в log.

## PR #1948 · 03 — Признаки жизни Session: время последнего признака и тишина хода

### 3. Правило тишины — чистая функция

Code: `src/shared/agent/quiet.ts:42-47` · key lines: 43, 45, 46

```ts
export function quietFor(now: number, facts: QuietFacts, thresholdMs: number = QUIET_MARK_MS): number {
  if (facts.state !== 'busy' || facts.openHooks > 0 || facts.e2eLockHeld) return 0
  const outside = [facts.taskOutputAt, facts.gateOutputAt].filter((at): at is number => at !== null)
  if (outside.some((at) => now - at < thresholdMs)) return 0
  return Math.max(0, now - Math.max(facts.lastSignAt, ...outside))
}
```

- Что делает: отвечает, сколько миллисекунд ход идёт без признаков жизни. Ноль, если Session не `busy` (в том числе при
  открытом запросе разрешения), если идёт hook, если занят e2e lock или если output file background task-а либо вывод
  gate-а изменились в пределах порога. Вокруг неё PR сделал остальное: оба driver-а (Claude Code и Codex) дают событие
  `alive` на hook-и и thinking, которые раньше отбрасывались; Session двигает `lastSignAt` на каждом событии, раз в
  минуту смотрит на ход и шлёт событие `quiet` с `quietSince`, а `controls()` отдаёт `quietSince` окну, открытому позже.
- Почему здесь: функция без часов и файлов, поэтому все исключения проверяются unit test-ом; порог `QUIET_MARK_MS`
  (10 минут) отсюда берут Ticket-ы 04, 06 и 09.
- Без него: зависший ход нельзя было бы отличить от долгого hook-а или долгого рассуждения.
- Требование: [Что делаем](issues/03-признаки-жизни-session.md#что-делаем)
- Риски и пробелы test-ов: начало хода обнуляет открытые hook-и, поэтому hook, начатый перед самым `init` хода и ещё
  идущий, может дать одну ложную пометку (долг review). На Windows gate не пишет `.run-*.out` для команд через
  `cmd.exe`, и признак «вырос вывод gate-а» там почти не срабатывает.

## PR #1953 · 04 — Тишина Subagent-а: `quiet N min` на Subagent Node и в rail-е

### 4. Тишина Subagent-а по времени изменения его файла

Code: `src/shared/transcript/subagents.ts:803-813` · key lines: 804, 806, 812

```ts
export function subagentQuietFor(info: Pick<SubagentInfo, 'status' | 'changedAt'>, now: number, thresholdMs: number = QUIET_MARK_MS): number | null {
  if (info.status !== 'running' || info.changedAt === undefined) return null
  const quiet = now - info.changedAt
  return quiet >= thresholdMs ? quiet : null
}

/** The mark of a quiet Subagent, `quiet 21 min` (whole minutes, rounded down); null when it is not quiet. */
export function subagentQuietLabel(info: Pick<SubagentInfo, 'status' | 'changedAt'>, now: number): string | null {
  const quiet = subagentQuietFor(info, now)
  return quiet === null ? null : `quiet ${Math.floor(quiet / 60_000)} min`
}
```

- Что делает: тишина Subagent-а — `now − changedAt`, только у `running` и только от порога Ticket-а 03. `changedAt`
  даёт `SubagentReader`: позднее из mtime файла `agent-<id>.jsonl` и времени его последней записи; в схеме поле
  необязательное, чтобы ответ старой сборки Linked machine не отвергался. Пометка стоит отдельным элементом на последней
  строке Subagent Node и своей строкой под именем в rail-е; статус `running` не меняется.
- Почему здесь: Node и rail зовут одну функцию и не считают тишину каждый по-своему; порог общий с тишиной хода.
- Без него: молчащий час background implementer выглядел бы так же, как работающий.
- Требование: [Что делаем](issues/04-тишина-subagent-а.md#что-делаем)
- Риски и пробелы test-ов: у Subagent-а Codex файла нет, и пометки у него нет. Что имя Subagent-а видно целиком,
  показали снимки собранного приложения, не test. Часы Linked machine и окна могут расходиться, test-а нет.

## PR #1954 · 05 — Run: продолжение застрявшего Ticket-а, откладывание и остановка `main-red`

### 5. Продолжение: маркер, строки Journal и следующая Wave

Code: `src/main/autopilot/run.ts:2192-2202` · key lines: 2193, 2197, 2200, 2201

```ts
  private async continueTickets(run: Run, effect: Extract<CycleEffect, { kind: 'continue-tickets' }>): Promise<void> {
    if (await this.mainIsRed(run)) {
      await this.feed(run, { type: 'main-red' })
      return
    }
    for (const each of effect.tickets) await this.write(run, { kind: 'ticket-continued', ticket: ticketNumber(each.num), attempt: each.attempt, of: effect.of, cause: effect.cause })
    const nums = effect.tickets.map((each) => each.num)
    run.continuation = { tickets: nums, attempt: Math.max(...effect.tickets.map((each) => each.attempt)), of: effect.of, cause: effect.cause }
    run.resume = [...new Set([...run.resume, ...nums])]
    await this.sendWave(run)
  }
```

- Что делает: сначала читает маркер Ticket-а 02; есть — событие `main-red` циклу, и Run останавливается, пока окно
  `asked` ещё открыто. Иначе пишет `ticket-continued` на каждый Ticket и посылает следующую Wave с этими Ticket-ами как
  возобновлёнными — тем же путём, каким первая Wave после Force stop подхватывает Ticket-ы в работе. Потолок 2 Run
  передаёт в `initialCycle` при старте и при переходе к следующему Epic-у очереди. Строка `Continuation 1 of 2 for
  ticket 05: …` идёт после команды `/worfy:epic-wave`, а не перед ней, чтобы Claude Code развернул skill.
- Почему здесь: Ticket называет `runWaveState` с Ticket-ами как `resumable` и чтение маркера перед эффектом.
- Без него: цикл просил бы продолжение, а Run молчал бы в фазе `sending`.
- Требование: [Что делаем](issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: продолженная Wave не получает `wave-finished` и в Run history остаётся открытой до
  `wave-started` продолжения; test-а нет. Чтение маркера, которое бросило ошибку, считается «не красный». Настоящая
  связка `mainRed` и `ticketTool` в `src/main/ipc/autopilot.ts` test-ом не покрыта (review, средний риск).

### 6. Просьба отложить — только факты worfy

Code: `src/shared/autopilot/continuation.ts:40-49` · key lines: 43, 46, 48

```ts
export function setAsideText(input: { epic: string; tickets: readonly number[]; attempts: number; cause: ContinuationCause; ticketTool?: string }): string {
  const { epic, attempts, cause } = input
  const nums = input.tickets.map(ticketNumber)
  const what = cause === 'wave-unfinished' ? 'stayed claimed' : 'came back as the same wave'
  const short = cause === 'wave-unfinished' ? 'claimed' : 'same wave'
  const tool = toolWord(input.ticketTool ?? 'ticket')
  const commands = nums.map((num) => `${tool} block ${epic} ${num} "stuck: ${short} after ${attempts} continuations" --waits owner`)
  const who = `${nums.length === 1 ? 'Ticket' : 'Tickets'} ${nums.join(', ')}`
  return `${who} ${what} after ${attempts} continuations. Run: ${commands.join('; ')}. Then end the turn.`
}
```

- Что делает: строит сообщение `set-aside`: по одной команде `ticket block <epic> <NN> "stuck: …" --waits owner` на
  Ticket и просьбу закончить ход. Входы — номера, попытки, причина и путь к `ticket`; слов модели среди них нет. Run
  пишет `ticket-set-aside` в Journal и шлёт текст в Session Orchestrator-а; отказ отправки идёт циклу как
  `session-error` или `session-closed`, потому что в фазе `turn` цикл `send-failed` не слушает (находка review
  Ticket-а 01). Свежее чтение после хода видит `Waits: owner`, Epic кончается `waits-owner`, и очередь идёт дальше.
- Почему здесь: ADR-0002 — статус Ticket-а пишут агенты, worfy в Project ничего не пишет; поэтому Run просит
  Orchestrator, а в Fault scenarios `blocked` пишет fake Orchestrator. Инвариант И9 проверяет по Journal: не больше двух
  `ticket-continued` на Ticket, после `ticket-set-aside` — `blocked` или остановка с той же причиной.
- Без него: Run нечего было бы послать Orchestrator-у, и очередь не дошла бы до следующего Epic-а.
- Требование: [Что делаем](issues/05-run-продолжение-и-откладывание.md#что-делаем)
- Риски и пробелы test-ов: `ticket-set-aside` пишется до отправки, поэтому неудачная отправка оставляет в Journal
  откладывание, которое не ушло; ветки `session-closed` и брошенного `send` test-ами не покрыты.

## PR #1958 · 06 — UI тишины хода: chip `busy · quiet N min`, Interrupt и Restart на hint line

### 7. Restart как публичный метод Session

Code: `src/main/agent/session.ts:868-876` · key lines: 870, 871, 872, 873

```ts
  async restart(): Promise<RestartAnswer> {
    this.assertOpen()
    if (this.launch.unattended) throw new Error('An unattended Session is not restarted by hand: its run decides')
    if (this.halted) throw new Error('This Session was stopped: a Restart would start a second process on its conversation')
    if (this.liveTaskList.length > 0) return { restarted: false, reason: restartWouldEndTasks(this.liveTaskList.length) }
    if (await this.restartProcess()) return { restarted: true, reason: null }
    // A task started while the turn was ending kept the process: the turn stays interrupted, as after an Interrupt.
    return { restarted: false, reason: restartWouldEndTasks(this.liveTaskList.length) }
  }
```

- Что делает: Restart с hint line (канал `agent.restart`) отказывает unattended и остановленной Session и не трогает
  ход с живыми background tasks. Иначе прерывает ход и запускает новый процесс на тот же разговор, дождавшись выхода
  старого (ADR-0064). Остальной PR показывает тишину человеку: хранилище renderer-а держит `quietSince` из события
  `quiet` Ticket-а 03 (или из `agent.controls`), chip пишет `busy · quiet N min`, а пункт `QuietTurn.tsx` на hint line
  несёт Interrupt и Restart.
- Почему здесь: `restartProcess` приватный и живёт в этом классе; отказы — как у MCP Restart. Автоматического
  Interrupt или Restart нет (ADR-0050): только по нажатию человека.
- Без него: Restart с тем же разговором был бы доступен только из popover-а MCP-серверов.
- Требование: [Что делаем](issues/06-ui-тишины-хода.md#что-делаем)
- Риски и пробелы test-ов: Restart через этот путь на Codex test-ами не проверен; отказ `halted` своего contract
  test-а не имеет; у порога e2e `WORFY_QUIET_MARK_MS` нет unit test-а — его проверяет только e2e в CI. Orchestrator
  Node и Session Node на Canvas пометку не показывают.

## PR #1947 · 07 — Call log Harness, только запись: повторы упавших вызовов считаются, агент ничего не видит

### 8. Шаблон «тот же вызов с тем же неуспехом»

Code: `harness/hooks/loop-patterns.mjs:39-49` · key lines: 39, 41, 46, 48

```js
const failed = (call) => call.fail === true
const succeeded = (call) => call.fail === false
const key = (call) => `${call.tool}\u0000${call.in}\u0000${call.out}`

// The same call with the same failed outcome: how many of `calls` repeat the newest one.
function sameFailure(calls) {
    const last = calls[calls.length - 1]
    if (!failed(last)) return 0
    const k = key(last)
    return calls.filter((call) => key(call) === k).length
}
```

- Что делает: для самого нового вызова считает, сколько раз среди последних 20 был тот же tool с тем же хэшем ввода и
  тем же неуспешным исходом. Рядом в модуле — «правка туда и обратно» и A-B-A-B. Hook `calls.mjs` на PostToolUse и
  PostToolUseFailure пишет запись вызова и по третьему повтору дописывает в `loops.jsonl` строку `would-hint`, по
  четвёртому — `would-deny`, один раз на шаблон и owner; выходит с exit 0 и пустым stdout. `loop-log` считает случаи.
- Почему здесь: условие разбора 2026-10-15 вернуться к детектору зацикливания — три случая и больше, а посчитать их было
  нечем; spec оставил в Epic-е только запись, без подсказки и отказа.
- Без него: ни один случай не попал бы в `loops.jsonl`, и замер Ticket-а 12 нечего было бы читать.
- Требование: [Что делаем](issues/07-call-log-harness-только-запись.md#что-делаем)
- Риски и пробелы test-ов: у shell-вызова Codex нет exit code, его исход не неуспех и не успех — зацикленная shell-команда
  на Codex случая не даёт. Два параллельных вызова одного агента могут потерять запись. Время hook-а на Windows не
  мерили; на Mac медиана 56.8 ms на вызов.

## PR #1957 · 09 — `turn-hung` в Autopilot: замолчавший ход останавливает Run, ничего не прерывая

### 9. Таймер зависшего хода

Code: `src/main/autopilot/run.ts:3010-3028` · key lines: 3014, 3016, 3017, 3022

```ts
  private hungTimer(run: Run): void {
    const clock = this.deps.tasksClock ?? realClock
    if (run.hungTimer !== null) clock.clearTimeout(run.hungTimer)
    run.hungTimer = null
    const since = run.cycle.phase === 'turn' ? this.quietSince(run) : null
    if (since === null) return
    const hung = (): Promise<void> => (run.cycle.phase === 'turn' && this.quietSince(run) === since ? this.feed(run, { type: 'turn-quiet' }) : Promise.resolve())
    const left = since + (this.deps.quietHungMs ?? QUIET_HUNG_MS) - this.now()
    if (left <= 0) {
      void run.enqueue(hung)
      return
    }
    const timer = clock.setTimeout(() => {
      if (run.hungTimer !== timer) return
      run.hungTimer = null
      void run.enqueue(hung)
    }, left)
    run.hungTimer = timer
  }
```

- Что делает: в фазе `turn`, пока Session Ticket-а 03 говорит, что ход молчит, ставит таймер на `quietSince + 30 минут`
  (`QUIET_HUNG_MS`). Отсчёт идёт от последнего признака жизни, а не от пометки через 10 минут. Когда таймер сработал, Run
  ещё раз проверяет фазу и тот же `quietSince` и шлёт циклу `turn-quiet`; цикл даёт `turn-hung` только в фазе `turn`.
  Остановка идёт обычным путём: Session уходит человеку без Interrupt, background tasks живы.
- Почему здесь: ответ владельца на вопрос 3 spec-а (вариант (а)) — ничего не прерывать; порог через dep
  `quietHungMs`, чтобы Fault scenario 7 на fake agent и на fake Codex двигал часы test-а сам.
- Без него: ход Orchestrator-а, который завис и молчит, держал бы Run в фазе `turn` всю ночь.
- Требование: [Что делаем](issues/09-turn-hung-в-autopilot.md#что-делаем)
- Риски и пробелы test-ов: `turn-quiet` во время graceful Stop даёт `turn-hung`, а `main-red` в том же случае даёт
  `user-stop`; это не записано и не покрыто test-ом. Открытый запрос разрешения отдельным сценарием не проверен — он
  опирается на `quietFor` Ticket-а 03.

## PR #1961 · 10 — Документы: переводы страниц Feature, термины CONTEXT.md, тексты Guide

### 10. Строка ограничений Guide: лестница вместо немедленной остановки

Code: `src/renderer/guide/topics/autopilot/en.json:104-104` · key lines: 104

```json
      "A Ticket of the Wave still in work 10 minutes after the turn, or the same Wave ready again: the run continues the Ticket in the next Wave, at most twice, then asks the Orchestrator to set it aside with Waits: owner, and stops with wave-unfinished or no-progress only if that fails too. A red main stops the run with main-red instead. The Orchestrator's own turn quiet for 30 minutes: turn-hung. Background tasks with no event and no change of their output files for an hour: background-stalled.",
```

- Что делает: Guide в Topic Autopilot больше не обещает немедленную остановку по `wave-unfinished`: он называет лестницу,
  `main-red`, `turn-hung` и оставшийся `background-stalled`; строка 104 `ru.json` говорит то же по-русски, и unit test
  требует эти слова в обоих языках. Тот же PR перевёл в `docs/features/ru/` правки Ticket-ов 02–09 и добавил в
  CONTEXT.md три термина: Ticket continuation, Set-aside Ticket и Quiet turn.
- Почему здесь: Ticket-ы 02–09 правили только английские страницы Feature (возражение 3 critic-а); перевод, словарь и
  Guide spec отдал одному Ticket-у документов.
- Без него: Guide описывал бы остановку, которой после Ticket-а 05 нет, а «silent» и «hung» путались бы с Silent mode и
  `turn-hung`.
- Требование: [Что делаем](issues/10-документы-перевод-context-guide.md#что-делаем)
- Риски и пробелы test-ов: test проверяет слова, а не смысл фразы. `topic.json` Topic-а держит старый sha страниц, и
  `guide-lag` покажет отставание. `ru/sessions.md` и `ru/skills-agents-and-hooks.md` отстают ещё на 29 и 17 commit-ов
  вне Epic-а; их метка перевода оставлена старой намеренно.

## 11. Стыки между Ticket-ами

Цикл (01) и маркер (02) сходятся в Run-е (05); признаки жизни Session (03) питают три потребителя: Subagent (04), UI
хода (06) и `turn-hung` (09). Call log (07) ни с кем из кода не связан и отдаёт данные замеру (12). Брошены две
передачи: продолженная Wave так и осталась без `wave-finished`, а замер `loop-log` ещё не наступил.

- 01 → 05: эффекты `continue-tickets` и `set-aside`, причина `main-red` с окном `asked`, строки Journal `ticket-continued` и `ticket-set-aside` · done: yes
- 01 → 05: отказ отправки `set-aside` передать циклу как `session-error` или `session-closed` (находка review 01) · done: yes
- 01 → 05: проверить, что продолженная Wave получает `wave-finished` в Run history (находка review 01) · done: no — Ticket 05 только описал это в story: продолженная Wave остаётся открытой, test-а и follow-up Ticket-а нет
- 02 → 05: маркер `main-red-<key>.json` и `readMainRed` для остановки Run-а · done: yes
- 03 → 04: порог `QUIET_MARK_MS` (10 минут) из `src/shared/agent/quiet.ts` · done: yes
- 03 → 06: событие `quiet` с `quietSince` и `quietSince` в `agent.controls` · done: yes
- 04 → 06: правка `sessions.md` по очереди (оба Ticket-а правят страницу; 06 ждал 04) · done: yes
- 03 → 09: `quietSince` через `controls()` Session и событие `quiet` для таймера · done: yes
- 05 → 09: `run.ts` с лестницей, на которую лёг таймер зависшего хода · done: yes
- 05 → 10: английская страница `autopilot-faults.md` с лестницей — для перевода, строки Guide и терминов CONTEXT.md · done: yes
- 07 → 12: `loops.jsonl` и команда `loop-log` для замера через две недели · done: no — замер не раньше 14 дней после merge PR #1947 (2026-11-17), Ticket 12 открыт

## Итог

Run Autopilot больше не останавливается на первом застрявшем Ticket-е: он дважды продолжает Ticket в следующей Wave,
потом просит Orchestrator отложить его с `Waits: owner`, и очередь идёт к следующему Epic-у; прежняя остановка остаётся
последней ступенью. Красный main останавливает Run с `main-red` без продолжений. Тишина хода видна в chip-е Session, на
hint line с Interrupt и Restart, на Subagent Node, а в Autopilot 30 минут тишины дают `turn-hung`, ничего не прерывая.
Повторы упавших вызовов пишутся в `loops.jsonl`, агент их не видит.

Осталось: продолженная Wave без `wave-finished` в Run history; маркер не пишется, если красный run повторили раньше,
чем `land` увидел его красным; связка `mainRed` в `src/main/ipc/autopilot.ts` без test-а; `turn-hung` во время
graceful Stop вместо `user-stop`; зацикленная shell-команда на Codex не считается. Приёмка владельцем (Ticket 11) и замер
`loop-log` (Ticket 12) впереди.

## Проверка

Каждый из девяти PR — review `VERIFIED` (глубина high у 01 и 07, medium у 02, low у остальных) и зелёный `ci-ok` на
head PR, включая job-ы Windows для платформенных PR 02 и 07. Лестница проверена Fault scenarios 1–5 на fake agent и
сценарием 2 на fake Codex, `turn-hung` — Fault scenario 7 на обоих; инвариант И9 проверяется во всех Fault scenarios.
gate fast — `[gate] green (fast)` у 01, 02, 03, 05, 09 (у 05 и 09 — в окружении без пробела в `TMPDIR`); у 10 gate fast в
окружении агента красный на watcher test-ах, которые отдельно проходят, вердикт — `ci-ok`. e2e `quiet-turn.spec.ts`
гоняет только CI. Ночной Run над очередью на живом приложении ещё не проверяли: это приёмка Ticket-а 11.

## Проверить себя

1. Почему красный main не превращается в продолжение или откладывание невиновного Ticket-а?
   - Ответ: Run читает маркер `land` перед каждым эффектом лестницы и шлёт циклу `main-red`, пока окно `asked` открыто;
     цикл останавливает Run с `main-red`, ничего не отправив. `land` держит маркер и во время повтора красного run-а.
   - Строки: `src/main/autopilot/run.ts:2193-2196`, `src/shared/autopilot/cycle.ts:428-431`, `harness/bin/land:535-538`
2. Почему hook, идущий 40 минут, не даёт ни пометки `quiet`, ни `turn-hung`?
   - Ответ: начало hook-а — событие `alive` с id его run-а; пока hook открыт, `quietFor` возвращает ноль, Session не
     шлёт `quietSince`, и таймер Run-а не ставится.
   - Строки: `src/shared/agent/quiet.ts:43`, `src/main/autopilot/run.ts:3014-3015`
3. Какая передача между Ticket-ами брошена в коде Run-а и чем это видно?
   - Ответ: от 01 к 05 — продолженная Wave не получает `wave-finished`: цикл не шлёт его на `settle-timeout`, и в Run
     history Wave остаётся открытой до `wave-started` продолжения.
   - Строки: `src/shared/autopilot/cycle.ts:426-427`, `src/main/autopilot/run.ts:2192-2202`
