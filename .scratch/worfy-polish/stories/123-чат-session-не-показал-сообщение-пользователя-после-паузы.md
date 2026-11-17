# Code story — worfy-polish 123: Session view не показал сообщение пользователя, отправленное после двух часов простоя

Kind: pr · Epic: worfy-polish · Ticket: 123 · PR: - · Language: ru

## 1. Что было не так

Владелец отправил Orchestrator-у вопрос через два часа после его последнего хода. Агент ответил, но строки вопроса в
Session view не было: после «Turn finished» сразу шли Thinking и ответ. Между ходами Autopilot отдал Orchestrator
обратно: старая Session закрылась, новая запустилась с `resume` и до первого `system/init` своего процесса жила под
временным id `pending-…`. Событие `prompt` ушло под этим id, затем `renamed` вернул Session к id SDK-сессии, под которым
store renderer-а уже держал ходы старой Session. Ветка `renamed` в `acceptAgentEvent` ставила события временного id
первыми, и строка вопроса оказалась над ходами до паузы, вне экрана. Порядок событий main записан test-ом на настоящей
Session с fake agent: `pending-…:prompt`, затем `<sdk>:renamed`, `<sdk>:init`, `<sdk>:result`.

- Требование: [Что происходит](../issues/123-чат-session-не-показал-сообщение-пользователя-после-паузы.md#что-происходит)

## 2. store нумерует свои log-и по порядку, в котором их завёл

Code: `src/renderer/session/store.ts:127-132` · key lines: 128, 131

```ts
/** How many Session logs the store has opened (SessionLog.opened). */
let openedLogs = 0

function update(sessionId: string, change: (log: SessionLog) => SessionLog): void {
  useSessionLogs.setState(({ logs }) => ({ logs: { ...logs, [sessionId]: change(logs[sessionId] ?? { ...EMPTY_LOG, opened: (openedLogs += 1) }) } }))
}
```

- Что делает: каждый новый log Session-и получает `opened` — номер по счётчику всех log-ов, которые store завёл. Log
  старой Session под id SDK-сессии заведён раньше log-а временного id новой Session, значит, его номер меньше.
- Почему здесь: Ticket называет `src/renderer/session/store.ts` в «Где в коде»; все события и ответы main попадают в log
  через `update`, так что номер ставится там, где log появляется. Почему номер, а не время прихода (`at`): у событий
  одного мгновения `at` совпадает, а счётчик однозначен.
- Без него: `renamed` не может узнать, какой из двух log-ов старше, и полагается на предположение, что log нового id
  новее, — а у Session, запущенной заново с `resume`, это не так.
- Требование: [Что делаем, пункт 2](../issues/123-чат-session-не-показал-сообщение-пользователя-после-паузы.md#что-делаем)
- Риски и пробелы test-ов: log, который `renamed` склеил, номера не несёт и считается самым старым (0); это верно, пока
  `renamed` склеивает log временного id в log нового id, как делает main. Log, положенный в store прямо через `setState`
  (так делают некоторые test-ы), тоже без номера.

## 3. `renamed` ставит первым log, заведённый раньше, и берёт последние значения из более нового

Code: `src/renderer/session/store.ts:147-168` · key lines: 149, 150, 151, 152, 161, 163

```ts
      // The log opened first holds the older events: the temporary id's as a rule, the new id's when an
      // earlier Session ran under it (a Session started again with `resume`, worfy-polish ticket 123).
      const afterIsOlder = after !== undefined && (after.opened ?? 0) < (before.opened ?? 0)
      const older = afterIsOlder ? after : before
      const newer = after === undefined ? before : afterIsOlder ? before : after
      const merged = after ? capped([...older.events, ...newer.events], before.first) : before
      // An `init` in the newer log came after any pick made in the older one.
      const modelPick = newer !== older && (newer.modelPick !== null || newer.events.some((each) => each.type === 'init')) ? newer.modelPick : older.modelPick
      return {
        logs: {
          ...rest,
          [sessionId]: {
            events: merged.events,
            first: merged.first,
            echo: newer.echo ?? older.echo,
            queue: newer.queue ?? older.queue,
            settings: newer.settings ?? older.settings,
            modelPick,
            context: newer.context ?? older.context,
            narration: newer.narration ?? older.narration ?? NO_NARRATION,
            ...((newer.mcp ?? older.mcp) === undefined ? {} : { mcp: newer.mcp ?? older.mcp }),
            ...(newer.quietSince !== undefined ? { quietSince: newer.quietSince } : older.quietSince !== undefined ? { quietSince: older.quietSince } : {}),
```

- Что делает: события склеиваются как «старший log, потом младший»; обычно старший — log временного id (как и раньше),
  у Session, запущенной заново с `resume`, — log нового id. Echo, очередь, settings, context, narration, MCP,
  `quietSince` и выбор модели берутся из младшего log-а, а старший служит запасом, как раньше log временного id.
- Почему здесь: подозрение 1 Ticket-а называет эту ветку `acceptAgentEvent`; решение 2 владельца требует правило «каждое
  сообщение, которое агент получил, видно ровно один раз», а не исправление одного пути.
- Без него: строка сообщения, отправленного после перезапуска процесса агента, стоит над ходами до него. Без echo из
  младшего log-а echo SDK этого сообщения не отбрасывается, если прошлый ход Session кончился без `result` (строка
  задваивается). Без settings из младшего log-а header после возврата Orchestrator-а показывает settings запуска
  Autopilot-а (`bypassPermissions`) до следующего события `settings`.
- Требование: [Решения владельца, пункт 2](../issues/123-чат-session-не-показал-сообщение-пользователя-после-паузы.md#решения-владельца-2026-11-17-grilling-на-все-ок)
- Риски и пробелы test-ов: два log-а склеиваются целиком, не по событию; если бы main слал события под старым и
  временным id вперемешку, порядок внутри был бы неточен. Main так не делает: старая Session закрыта до запуска новой, а
  `renamed` — первое событие под новым id (test `session-resume-event-order`). `first` по-прежнему берётся из log-а
  временного id.

## 4. Что сознательно не меняли

- `src/main/agent/session.ts`: временный id при `resume` остаётся — Claude Code может назвать сессию иначе, и окна уже
  умеют с ним работать. Ошибка была в предположении store-а.
- Страховки из transcript-а нет (решение 4 владельца): Session view не подставляет строку пользователя из файла.
- `joinPastAndLive` и `fold.ts` не менялись: живые события они не теряют.

## 5. Как проверено

- `pnpm test test/unit/session-prompt-after-restart.test.tsx test/unit/session-resume-event-order.test.ts` — exit 0;
  на `store.ts` до исправления 9 test-ов из 11 красные (два оставшихся — запись порядка событий main).
- Мутанты исправления (log нового id всегда новее; echo и settings из log-а нового id; без счётчика `opened`) — на каждом
  краснеет хотя бы один test.
- `pnpm lint`, `pnpm typecheck` — exit 0. Все unit и contract test-ы, которые импортируют `src/renderer/session/` или
  `src/main/agent/session` (155 файлов), — зелёные, кроме одного timeout-а под нагрузкой в
  `test/contract/getting-started-state.test.ts`, который отдельно — exit 0.
- Полный `pnpm test` и gate fast на Mac красные только на test-ах слежения за файлами (`docs.test.ts`,
  `workflow-reader.test.ts`, `product-watch.test.ts` и др., 19 штук): `fseventsd` держит 3,5 GB, уведомления приходят
  с задержкой до 600 ms. Эти test-ы изменения не касаются; вердикт — CI.

## Проверить себя

1. Почему строка вопроса встала над ходами до паузы, а не пропала из log-а?
   - Строки: `src/renderer/session/store.ts:149-152`
   - Ответ: событие `prompt` пришло под временным id, а до исправления `renamed` склеивал «log временного id, потом log
     нового id», хотя log нового id держал более старые ходы. Теперь первым идёт log с меньшим `opened`.
2. Что сломалось бы, если бы echo после склейки брался из log-а нового id?
   - Строки: `src/renderer/session/store.ts:161`
   - Ответ: если прошлый ход кончился без `result`, там остался echo старого текста; echo SDK нового сообщения не совпал
     бы с ним и встал бы второй строкой.
3. Почему `opened`, а не время `at` события?
   - Строки: `src/renderer/session/store.ts:131`
   - Ответ: `at` — миллисекунды прихода, у событий одного мгновения он совпадает; номер log-а из счётчика однозначен.
