# 20 — SessionHandle Codex

Type: task
Status: done 2026-11-03T00:35Z
PR: #1260
Blocked by: 14, 19
Source: [spec.md](../spec.md), «Модель» (SessionHandle, Нейтральные события — соответствие Codex), «Цель», п. 3–5; решение 06 ([06-граница-vendor.md](06-граница-vendor.md), часть session); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 02 ([02-codex-управление-сессией.md](02-codex-управление-сессией.md), таблица механизмов)

## Что делаем

1. `src/main/vendors/codex/session.ts` — SessionHandle Codex: `start` — `thread/start {cwd}`, `resume` —
   `thread/resume {threadId}`; `send` — `turn/start`, а во время хода — `turn/steer {expectedTurnId}`;
   `interrupt` — `turn/interrupt`; `setModel`, `setEffort`, `setPermissionPreset` — значения следующего
   `turn/start` (stable-поверхность; смена посреди хода — нет); `close` — конец процесса. Очередь сообщений —
   worfy (`src/main/agent/queue.ts`), не `thread/queue/*`.
2. Presets → approval policy + sandbox: «Read only» — `read-only` + `on-request`; «Auto» — `workspace-write` +
   `on-request`; «Full access» — `danger-full-access` + `never`.
3. `src/main/vendors/codex/items.ts` — item-ы и notification-ы → `AgentEvent`: `item/agentMessage/delta` → `delta`;
   `agentMessage` → `text`; `reasoning` (summary) → `thinking`; `commandExecution`, `fileChange`, `mcpToolCall` →
   `tool_use` и `tool_result`; `turn/completed` → `result` (`interrupted` и `failed` — с текстом);
   `error` → `result` с ошибкой; `thread/tokenUsage/updated` → `context`; незнакомое — `unknown`.
4. `src/main/vendors/codex/approvals.ts` — `item/commandExecution/requestApproval` и
   `item/fileChange/requestApproval` → `permission_request` с `subject` (команда или файлы) и вариантами `accept`,
   `acceptForSession`, `decline`, `cancel`; Interrupt и закрытие отвечают `cancel`.
5. Изменения — только в `session.ts`, `items.ts`, `approvals.ts`, `capabilities.ts` (п. 6); `index.ts` driver-а Codex не
   правится.
6. Модель и effort: список — `model/list` (`supportedReasoningEfforts`, `defaultReasoningEffort`), отдаётся
   capabilities по версии. Capabilities Codex лежат в `src/main/vendors/codex/capabilities.ts` (Ticket 17): список
   моделей правится там. У Claude функция capabilities пока в `src/main/vendors/claude/index.ts` (долг Ticket-а 13;
   позже её может перенести в `claude/capabilities.ts` отдельный Ticket).

Глубина review — `high` (driver Codex).

## Готово, когда

- [ ] Unit test перевода item-ов: каждый вид из п. 3 на записях сценариев фейка даёт ожидаемые события.
- [ ] Contract test на фейке: ход, steer во время хода, interrupt, resume, смена Model, effort и preset со
      следующего хода (видно в логе request-ов).
- [ ] Contract test approval-а: команда и правка файлов → `permission_request` с четырьмя вариантами; ответ уходит
      в фейк; Interrupt отвечает `cancel`.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `src/main/vendors/codex/items.ts`, `approvals.ts` (новые)
- `src/main/vendors/codex/session.ts` — stub Ticket-а 17 заменяется; `index.ts` не правится
- `src/main/vendors/codex/capabilities.ts` (файл Ticket-а 17) — модели и effort из `model/list` (п. 6)
- `test/unit/codex-items.test.ts`, `test/contract/codex-session.test.ts` (новые)

Только читать: `src/main/vendors/session.ts` и `src/main/vendors/claude/session.ts` (Ticket 14),
`src/shared/agent/events.ts:67-274`, `src/main/agent/queue.ts`.

## Итог

- `session.ts` — SessionHandle Codex поверх одного `codex app-server` на handle (`app-server.ts` Ticket-а 19):
  `start` — `thread/start {cwd, approvalPolicy, sandbox, model}`, `resume` — `thread/resume {threadId, …}`. Проверка
  старта — ответ thread-а: после него handle даёт `account` (`loggedIn: true`; вход в Codex — вопрос части account,
  Ticket 21), и Session принимает сообщения. `send` — `turn/start`, во время хода — `turn/steer {expectedTurnId}`;
  отправки идут друг за другом, поэтому второе сообщение, посланное до ответа на `turn/start`, тоже идёт steer-ом.
  Отказ steer-а при идущем ходе — `notice`, отказ `turn/start` — `result` с ошибкой (Session не зависает в `busy`).
  `setModel`, `setEffort`, `setPermissionPreset` — только значения следующего `turn/start`, и только то, что
  изменилось с прошлого раза; `null` («Default») — модель с `isDefault` из `model/list` и её
  `defaultReasoningEffort`. Turn, который Codex не начал, возвращает изменения следующему ходу.
- Presets: «Read only», «Auto», «Full access» → approval policy + sandbox (`capabilities.ts`, `codexPresetFor`,
  `codexSandboxPolicy`: `turn/start` берёт policy-объект, `thread/start` — режим). Настройки Session пока несут
  режимы Claude (`settings.ts` не правился): `bypassPermissions` → Full access, `acceptEdits` → Auto, `default` и
  `plan` → Read only; помечено `shortcut:` до Ticket-а 23/25.
- `items.ts` — notification-ы → `AgentEvent` по списку п. 3; `error` с `willRetry` — `notice`, без него — `result`
  с ошибкой, после которого `turn/completed` того же хода второго `result` не даёт; незнакомое — `unknown`.
  События чужого thread-а (Subagent) Session не показывает, но его tool item-ы `items.ts` помнит (`follow`): approval
  Subagent-а называет свой item только по id.
- `approvals.ts` — `item/commandExecution/requestApproval` и `item/fileChange/requestApproval` →
  `permission_request` (subject — команда или файлы item-а) с вариантами `accept`, `acceptForSession`, `decline`,
  `cancel`. Interrupt и close сначала отвечают `cancel` на открытые approval-ы, потом шлют `turn/interrupt` или
  закрывают процесс; `serverRequest/resolved` отзывает запрос без ответа. Прочие server→client request-ы получают
  JSON-RPC ошибку −32601 и событие `unknown`.
- `capabilities.ts` — модели и effort из `model/list` (все страницы, один раз на процесс; отказ — спросить заново):
  `capabilities(session)` и строки пикера (`codexModelOptions`, первая — «Default (…)»).

Долги прошлых ревью:

- Ticket 14, unattended Session: approval-ы отклоняются сразу (`decline`), каждый — через `refused` с `reason`
  Codex; contract test.
- Ticket 19, `start()` во время `initialize`: процесс сообщается Session-у (`spawned`) в момент spawn, до
  handshake; любой отказ старта закрывает процесс (`CodexAppServer.start` и `open()`), а handle, пришедший после
  закрытия Session, она закрывает сама. Отдельного прерывания старта не нужно; contract test-ы на падение в
  `initialize` и на отказ `thread/resume` проверяют, что процесс вышел.
- Ticket 19, bundle схемы 750 KB: `session.ts` грузит `app-server.ts` через `import()` при первом старте; статически —
  только типы.
- Ticket 19, stderr в `Error.message`: stderr процесса идёт в `SessionStart.stderr` (Session держит ограниченный
  хвост, как у Claude); ошибка конца событий и отказа старта называет только exit code; текст ошибки app-server в
  `result`/`notice` обрезан до 2000 символов (`boundedText`).
- Ticket 14, `allow_always` по subject: id вариантов одинаковы у всех request-ов (решения Codex), поэтому
  запомненный id всегда есть среди вариантов; `permissions.ts` не правился.
- Ticket 14, `permissionMode` — enum Claude: перевод — только на стороне Codex (`codexPresetFor`).

Фейк: новые сценарии в отдельных файлах — `items.jsonl`, `turn-failed.jsonl`, `settings.jsonl` (`model/list` в две
страницы), `approval-interrupt.jsonl`; сам `fake-app-server.mjs` не менялся. Test, который пришлось поправить:
`test/unit/codex-capabilities.test.ts` — из проверки stub-ов убраны `session.start`/`resume` (stub заменён), добавлены
test-ы presets, sandbox policy и `model/list`.

Доработка, раунд 1 (REJECTED в PR #1260):

- Approval-ы Subagent-а: item-ы и `serverRequest/resolved` любого thread-а процесса больше не отбрасываются фильтром
  thread-а — фильтр снимает только события, которые Session показывает. File change Subagent-а спрашивается с путями
  своего item-а, а запрос, который Codex отозвал в thread-е Subagent-а, отзывается и в Session.
- Approval, чей item worfy не видел (команду или файлы не называет ни запрос, ни item): subject — `a command (item <id>)`
  или `file changes (item <id>)`, и варианта «Accept for this Session» нет. Выбраны обе меры: без `allow_always` gate
  (`permissions.ts`) не может запомнить такой subject, а id item-а в subject не даёт ему совпасть с уже запомненным
  subject-ом (gate отвечает запомненным до того, как смотрит на варианты). Contract test идёт через настоящий
  `PermissionGate`.
- Test-ы на долги ревью: ожидание stdout после выхода процесса (ребёнок фейка держит stdout: строка через ~300 мс
  доходит; держит дольше `OUTPUT_AFTER_EXIT_MS` — события кончаются ошибкой примерно через этот предел), отзыв
  открытого approval-а при смерти процесса, Interrupt вместе с send без ожидания друг друга. Новый сценарий фейка —
  `subagent-approval.jsonl`; `fake-app-server.mjs` не менялся (ребёнок, держащий stdout, — в preload самого test-а).
- Красный Windows в CI run 41546176352: ребёнок, унаследовавший stdout фейка, на Windows не держит pipe после выхода
  фейка. Ожидание конца вывода теперь проверяют на всех ОС два test-а, которые держат `close` процесса фейка в самом
  test-е (`holdClose`): события кончаются только после `close`, если он пришёл до предела, и через
  `OUTPUT_AFTER_EXIT_MS`, если `close` нет; оба mutant-а `session.ts:176` (без ожидания и без предела) красные. Test-ы с
  ребёнком — только вне Windows (`it.skipIf`), строка пишется через 100 мс после выхода вместо 300.

Ревью (PR #1260):

- Ступень `high` по тексту тикета — решено без владельца, подтвердить. Круг 1 — verifier, два reviewer-а, два
  sceptic-а: REJECTED, четыре пункта (approval-ы Subagent-а без путей и три пробела test-ов, которые сторожат остановку
  процесса и Interrupt; закрыты доработкой выше), 631 561 subagent-токен. Круг 2 — verifier и reviewer (`medium`):
  VERIFIED; debt, 144 743 токена.
- Consider (low):
  - steer теряет сообщение, если отказ `turn/steer` пришёл раньше `turn/completed` того же хода
    (`session.ts:319-329`). Сегодня путь недостижим: Session ставит сообщения в очередь во время хода
    (`src/main/agent/session.ts:285`). Долг блокирует тот Ticket, который начнёт слать сообщения во время хода в steer;
    дешёвая починка — при отказе «no active turn» сразу `turn/start` (по схеме 0.166 `turn/start` на идущем ходе его
    steer-ит). Понижено с med с согласия reviewer-а;
  - Interrupt при открытом approval сначала отвечает `cancel`, потом ждёт ответа на `turn/interrupt` до 60 с, если
    Codex не ответит (`session.ts:207-212`);
  - timeout `turn/start`, когда Codex всё же начал ход, даёт два `result` на одно сообщение (`session.ts:296-311`);
  - после смены preset-а `turn/start` шлёт явную policy `workspace-write` (`networkAccess: false`, `writableRoots: []`),
    которая может перекрыть `config.toml` пользователя посреди Session — строже, не мягче (`codexSandboxPolicy`);
  - безопасность: `console.warn` пишет в log весь объект ошибки, `CodexAppServerExit` несёт до 16 KB stderr
    (`session.ts:248`, `:384`) — писать только `exitText`;
  - нет test-а на стороне Codex для закрытия Session, пока app-server стартует; процесс ограничен `consume`/`exited`
    Session и timeout-ом request-а 60 с;
  - вне диффа: `src/main/agent/permissions.ts:76` запоминает ответ только по subject, без имени tool-а: «Accept for this
    Session» на правку `/p/build.sh` примет и команду, чья строка ровно `/p/build.sh`.
- Debt круга 2 (low): `codex-session.test.ts:769` проверяет только нижнюю границу; выжили mutant-ы
  `approvals.ts:72` (вариант Session привязан к `cwd`, а не к команде) и `approvals.ts:65` (без копии вариантов).
- Noted (low): без test-ов — защита `lastEnded`/`activeTurn` (`session.ts:346`, `:402-403`), переход опоздавшего steer
  в `turn/start` (`:294`, `:325`), `error` без `willRetry` через Session (`:396`), отказ `turn/interrupt` закончившегося
  хода (`:215`), выбор «Default» до следующего хода (`codex-session.test.ts:421-428`), 8 из 10 `QUIET`
  (`items.ts:53-61`), предел 2000 символов (`items.ts:30`, `:269`, `session.ts:110`) — mutation круга 1 172/232;
  `model/list` молча обрезается после 10 страниц. Вопросы к настоящему Codex: уникальны ли id item-ов между thread-ами
  (общая карта `started`, `items.ts:148/169`; запасной путь безопасен); `item/fileChange/patchUpdated` не читается.
- Dismissed: нет.
