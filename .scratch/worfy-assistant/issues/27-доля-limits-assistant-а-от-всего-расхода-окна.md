# 27 — Доля Limits Assistant-а считается от всего расхода окна

Type: task
Status: claimed 2026-11-26T13:15Z
Blocked by: —
Source: найдено Ticket-ом 19 (PR #2281), раздел «Вне скоупа»; [spec.md](../spec.md), «Ticket-ы», строка 27.
Пункт Ticket-а 20 «Владелец смотрит, сколько token-ов и какую долю Limits потратил Assistant» опирается на эту долю.

Кто: агент.

## Что происходит

Ticket 05 завёл журнал расхода Assistant-а (`<WORFY_DATA_DIR>/assistant/usage.json`,
`src/main/assistant/budget/ledger.ts`). Долю Assistant-а в окне Limits он оценивает по цене: доля = процент окна ×
цена вызовов Assistant-а / (цена вызовов Assistant-а + цена остальных ходов worfy) — `limitsShare`,
`src/shared/assistant/budget.ts:198-212`. Цену остальных ходов должен приносить `noteOtherTurn(costUsd)`
(`ledger.ts:80`); комментарий в начале файла (`:10-11`) говорит, что его зовёт `result` каждой другой Session worfy.

Но у `noteOtherTurn` нет ни одного вызова в `src` (`grep -rn noteOtherTurn src` — только объявление и комментарии).
Поле `otherCost` журнала всегда пусто, и после первого же вызова Assistant-а `limitsShare` отдаёт ему весь процент
окна: `share = utilization × assistant / (assistant + 0) = utilization`. Строка расхода в разделе Assistant-а
(`src/renderer/assistant/AssistantPanel.tsx:393-415`) и Settings → Assistant (`src/renderer/settings/AssistantSection.tsx:358`)
показывают «≈N% · estimate», где N — весь расход окна, а не доля Assistant-а. Обе берут долю у
`ledger.limitsShare` (`src/main/assistant/window/app.ts:89`, `src/main/assistant/settings/app.ts:42`).

## Что строить

1. **Цена каждой другой Session доходит до `noteOtherTurn` ровно один раз.** Каждый `result` хода, который worfy
   запускает сам и который не ход Assistant-а, отдаёт свою цену в `appAssistantUsage().noteOtherTurn`
   (`ledger.ts:117`).
2. **Ход Assistant-а не считается дважды.** Session Assistant-а и проверки источников уже записаны через `noteCall`;
   в `noteOtherTurn` они не идут.
3. **Цена хода, а не процесса.** `total_cost_usd` в `result` Claude Code растёт от хода к ходу в пределах одного
   процесса (комментарий `CostCounter`, `src/main/agent/orchestrator.ts:103-108`). Передать его как есть — значит
   посчитать прошлые ходы снова. В `noteOtherTurn` идёт разница с прошлым `result` того же процесса; новый процесс
   (меньшая цифра) считается с нуля — как `CostCounter.result` (`orchestrator.ts:119-123`).
4. Где подключить — решает агент (один observer реестра Session-ов, отдельные места для запросов вне реестра) и пишет
   решение в «Решено без владельца».

## Где в коде

- Журнал: `src/main/assistant/budget/ledger.ts:80` (`noteOtherTurn`), `:103-104` (`limitsShare`), `:117`
  (`appAssistantUsage`). Формула: `src/shared/assistant/budget.ts:198-212`, `otherCost` по часам — `:73`, `:127`.
- **Session-ы реестра** — Orchestrator, Session Node-ы Canvas-а, Session-ы, которые запускает Autopilot (через
  Orchestrator, `src/main/agent/orchestrator.ts:754`, `registry.start`), Product Session. Все идут через
  `SessionRegistry` (`src/main/agent/session/registry.ts`): `observe` (`:95-98`) получает каждое событие каждой
  Session (`:115-125`). `result` с `costUsd` уходит из `Session.onEvent` (`src/main/agent/session.ts:1205-1208`);
  `costUsd` — это `total_cost_usd` SDK (`src/shared/vendors/claude/events.ts:370`). Observer-ы реестра уже есть у
  Assistant-а (`src/main/assistant/core/install.ts:67`, `src/main/assistant/actions/limits-waits.ts:57`) и у
  Orchestrator-а (`orchestrator.ts:826-830` — свой `CostCounter` на Node). Приложение собирает реестр в
  `src/main/agent/app-registry.ts:60`, `:83`.
- **Session-ы Codex** приходят тем же путём, но с `costUsd: 0` (`src/main/vendors/codex/session.ts:542`,
  `src/main/vendors/codex/items.ts:386`) — `noteOtherTurn` их пропускает (`ledger.ts:82`); окно Limits у них не
  Claude-окно.
- **Запросы вне реестра** (свой `query()` Agent SDK, не Session):
  - one-shot Claude Code — черновик профиля Project-а (`src/main/projects/connect.ts`), Code story
    (`src/main/stories/one-shot.ts`) и вопрос по её строкам (`src/main/stories/ask.ts:321`); все читают `result` в
    одном месте — `readOneShot`, `src/main/vendors/claude/one-shot.ts:175`;
  - narrator Product Session — `src/main/vendors/claude/narrator.ts:107` (зовёт `src/main/agent/narrator.ts`);
  - Terminal AI — `src/main/terminal-ai/assist.ts:512` (запрос через `sdk.query`, `src/main/vendors/claude/terminal-ai.ts:125`;
    процесс-«запаска», ADR-0058 — агент проверяет, один ли ход у процесса).
- **Не считать** (это ходы Assistant-а, их пишет `noteCall`): Session Assistant-а —
  `src/main/assistant/session/runner.ts:139-157` (`src/main/vendors/claude/assistant-session.ts`, не через реестр);
  проверка источника — `src/main/assistant/sources/connector-check.ts:105`
  (`src/main/vendors/claude/connector-check.ts:322`).
- Не ходы: запрос Limits (`src/main/vendors/claude/limits.ts`, control request `usage`, без модели).
- Test-ы: `test/unit/assistant-usage-ledger.test.ts` (`:101-125` — `noteOtherTurn` пишет файл; `:137-155` — формула
  `limitsShare` с ценой других ходов, записанной в test-е руками; `:156` — весь процент окна, когда других ходов нет:
  именно это и видит пользователь сейчас). Test-а, что кто-то в приложении зовёт `noteOtherTurn`, нет.

## Решения

- ADR не меняется: Ticket доделывает то, что Ticket 05 описал, но не подключил.
- Session-ы второй машины (Linked machine, Ticket 18) считает журнал той машины. Если обе машины на одном аккаунте
  Claude, доля на каждой остаётся завышенной на расход другой. Это вне Ticket-а; подпись «estimate» остаётся.

## Test-ы

- Unit test `limitsShare`: при цене других ходов в окне доля Assistant-а меньше процента окна и равна
  `utilization × assistant / (assistant + other)` — test `:137-155` уже есть; агент добавляет случай, где цена других
  ходов пришла через подключение, а не записана руками.
- Test подключения: `result` Session реестра (два хода одного процесса, затем новый процесс) доводит до
  `noteOtherTurn` цену каждого хода один раз; `result` one-shot, narrator-а и Terminal AI — тоже; ход Session
  Assistant-а и проверка источника — нет. Сначала красный на нынешнем коде.

## Готово, когда

- [ ] Цена `result` каждой другой Session и запроса worfy доходит до `noteOtherTurn` ровно один раз (разница с прошлым
      `result` процесса), а ходы Assistant-а — Session и проверки источников — не доходят.
  - evidence: test-run pass · `pnpm test test/unit/other-turn-costs.test.ts test/unit/vendor-driver-types.test.ts test/contract/terminal-ai-assist.test.ts test/unit/assistant-session.test.ts test/unit/assistant-source-check.test.ts` exit 0 · mac - · c5a3c6200
  - evidence: test-run pass · `pnpm test test/unit/other-turn-costs.test.ts test/contract/orchestrator.test.ts test/unit/assistant-usage-ledger.test.ts test/unit/vendor-driver-types.test.ts test/contract/terminal-ai-assist.test.ts test/unit/assistant-session.test.ts test/unit/assistant-source-check.test.ts` exit 0 · mac - · 6e5436d09
- [ ] Unit test `limitsShare` с ценой других ходов: доля Assistant-а меньше процента окна.
  - evidence: test-run pass · `pnpm test test/unit/other-turn-costs.test.ts` exit 0 · mac - · c5a3c6200
  - evidence: test-run pass · `pnpm test test/unit/other-turn-costs.test.ts test/contract/orchestrator.test.ts test/unit/assistant-usage-ledger.test.ts test/unit/vendor-driver-types.test.ts test/contract/terminal-ai-assist.test.ts test/unit/assistant-session.test.ts test/unit/assistant-source-check.test.ts` exit 0 · mac - · 6e5436d09
- [ ] Test, что подключение зовёт `noteOtherTurn`: Session реестра, one-shot, narrator, Terminal AI — да; Session
      Assistant-а и проверка источника — нет.
  - evidence: test-run pass · `pnpm test test/unit/other-turn-costs.test.ts test/unit/vendor-driver-types.test.ts test/contract/terminal-ai-assist.test.ts test/unit/assistant-session.test.ts test/unit/assistant-source-check.test.ts` exit 0 · mac - · c5a3c6200
  - evidence: test-run pass · `pnpm test test/unit/other-turn-costs.test.ts test/contract/orchestrator.test.ts test/unit/assistant-usage-ledger.test.ts test/unit/vendor-driver-types.test.ts test/contract/terminal-ai-assist.test.ts test/unit/assistant-session.test.ts test/unit/assistant-source-check.test.ts` exit 0 · mac - · 6e5436d09
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · c5a3c6200
  - evidence: gate pass · `gate fast` exit 0 · mac - · c5a3c6200
  - evidence: gate pass · `gate fast` exit 0 · mac - · 6e5436d09

## Итог

- Новый модуль `src/main/agent/turn-cost.ts`: один sink цены «чужих» ходов. Приложение при старте направляет его в
  журнал Assistant-а (`ledgerTurnCostSink(appAssistantUsage)`, `src/main/index.ts`, до первой Session). Без sink-а
  (test-ы, до старта) цена никуда не пишется.
- **Цена хода Session-а — прирост итога её беседы.** `total_cost_usd` — итог беседы: Claude Code при resume
  восстанавливает его из записей `cost-state` транскрипта, а не начинает с нуля (найдено review PR #2284, линза
  correctness). Журнал хранит последний итог каждой беседы в своём файле (`otherTotals` в `assistant/usage.json`,
  срок хранения тот же, 8 дней) и считает ход как разницу с ним (`noteOtherTotal`, общее правило `costSinceLast`).
  Так ход считается один раз через crash, relaunch Autopilot-а, Restart, новую Session той же беседы и перезапуск
  worfy. Итог меньше прошлого (процесс ничего не восстановил) считается с нуля.
- **Session-ы реестра** — Orchestrator, Session Node-ы, Session-ы Autopilot-а, Product Session: один observer
  `turnCostObserver`, его подключает `sharedRegistry()` (`src/main/agent/app-registry.ts`) при создании реестра. Он
  отдаёт каждый `result` как итог беседы под id Session-а (с первого init это id беседы SDK), а `renamed` — как
  продолжение беседы под новым id в том же процессе (журнал переносит последний итог, если у нового id его нет).
- **`CostCounter` Node-а Orchestrator-а** (`src/main/agent/orchestrator.ts`) — то же правило: новый процесс продолжает
  от последнего итога беседы, который данные Node-а хранят отдельным полем `reportedUsd`
  (`src/shared/ipc/orchestrator.ts`); `processEnded` и его вызовы (crash, relaunch) убраны.
  Раньше после relaunch, crash или перезапуска worfy цена Node-а прибавляла всё прошлое беседы ещё раз.
- **Запросы вне реестра** — один процесс Claude Code на один ход, поэтому их `total_cost_usd` и есть цена хода
  (`noteOneTurnResult`): `readOneShot` (черновик профиля, Code story и вопрос по её строкам), narrator Product
  Session-а (`narratorAskOver`), Terminal AI (`AssistService.attempt`; spare-процесс закрывается после каждого
  запроса, ADR-0058).
- **Не считаются**: Session Assistant-а (`runner.ts`) и проверка источника (`connector-check.ts`) идут мимо реестра и
  мимо `noteOneTurnResult`, их пишет только `noteCall`. Codex-Session-ы приходят с `costUsd: 0` — ничего не пишется.
- `docs/features/assistant.md` (английская): вместо «upper bound» — какие ходы считаются, что беседа после resume
  продолжает восстановленный итог, и в какую сторону ошибается оценка: выше — на расход вне worfy и Linked machine
  того же аккаунта; ниже — когда прошлое беседы считается снова (итог после resume меньше прошлого, resume после 8
  дней без ходов). Русский перевод не трогался (ADR-0088).
- Test-ы: `test/unit/other-turn-costs.test.ts` (реестр на fake agent, журнал — настоящий: два хода, crash и resume с
  восстановленным итогом → всего 0.05; новая Session той же беседы после перезапуска worfy — новый журнал из того же
  файла → прошлое не считается снова; новая беседа и итог меньше прошлого — с нуля; доля в `limitsShare` меньше
  процента окна; `renamed`, прерванный ход, Codex; one-shot на `result` из `test/fixtures/sdk-messages/controls.jsonl`;
  narrator), `test/contract/orchestrator.test.ts` (`CostCounter`; цена Node-а после перезапуска и после crash не
  удваивается; Node старого кода и resume без восстановленного итога через перезапуск — второй раунд review; схема
  данных Node-а с `reportedUsd` и без него), `test/unit/assistant-usage-ledger.test.ts` (`otherTotals` старше недели удаляются), `test/unit/vendor-driver-types.test.ts`
  (реестр приложения отдаёт observer-у события с первого), `test/contract/terminal-ai-assist.test.ts` (два запроса —
  две цены), `test/unit/assistant-session.test.ts` и `test/unit/assistant-source-check.test.ts` (ходы Assistant-а в
  sink не попадают). Новые test-ы подключения сначала красные (5 упали), после правки зелёные.

### Решено без владельца

1. **Подключение — один sink и четыре места, а не одно общее место.** Общего места, через которое идут все `result`
   SDK, нет: каждый путь сам зовёт `query()` (`vendors/claude/query.ts`, `one-shot.ts`, `narrator.ts`,
   `terminal-ai.ts`, `assistant-session.ts`, `connector-check.ts`), а обёртка Limits `appLimits().observe` оборачивает
   только фабрику Session-ов. Обёртка вокруг всех `query()` потребовала бы правки тех же мест и исключения для
   Assistant-а. Выбрано: observer реестра для Session-ов и вызов `noteOneTurnResult` в трёх читателях вне реестра;
   все — в один sink.
2. **Sink ставит `src/main/index.ts`, а не модуль `agent` сам.** Модуль `src/main/agent/turn-cost.ts` не импортирует
   Assistant, а test-ы без sink-а никогда не пишут в настоящий `usage.json`. Цена — одна строка в `index.ts`, файл вне
   раздела «Где в коде».
3. **Последний итог беседы хранится в файле журнала, а не в памяти observer-а** (после review PR #2284, которое нашло
   восстановление итога при resume). Иначе каждый перезапуск worfy считал бы всё прошлое каждой возобновлённой беседы
   ещё раз. Ключ — id беседы SDK; хранится 8 дней, как остальной журнал. Цена — запись файла на каждый ход с ростом
   итога (её и так делал `noteOtherTurn`) и поле `otherTotals` в `usage.json`; прежняя сборка (Roll back) его
   пропускает. Беседа, возобновлённая после 8 дней без ходов, считается заново — ошибка в сторону заниженной доли
   Assistant-а. Первая версия PR сбрасывала счёт на `starting` и `error` — это было неверно.
3а. **Итог меньше прошлого считается с нуля**: процесс ничего не восстановил, и его цифра — только новые ходы, так что
   счёт точный. Перенос итога при `renamed` — только если у нового id итога нет. Ошибка остаётся, когда итог
   восстановлен лишь частично: тогда прошлое считается снова.
3б. **Последний итог беседы Node-а хранится в данных Node-а отдельным полем `reportedUsd`** (после второго раунда
   review PR #2284). Сохранённая цена Node-а `costUsd` равна итогу беседы, только пока ничего не сломалось: после
   процесса, который ничего не восстановил, и у Node-а, сохранённого старым кодом, она больше. Если считать её
   последним итогом, следующий итог шёл бы с нуля при каждом перезапуске worfy и открытии Orchestrator-а, и цена росла
   бы без конца. Node без поля (сохранён до этого Ticket-а): первый `result` после старта берётся как восстановленный
   итог и ничего не добавляет. Цена этого — ход первого `result` в цену Node-а не войдёт: какая часть итога его, не
   известно. Новая беседа пишет `reportedUsd: 0`. Прежняя сборка поле не читает (`readOrchestratorData` берёт только
   ключи своей схемы); если она, запущенная через Roll back, обновит `costUsd`, а `reportedUsd` оставит старым, следующий
   ход в новой сборке добавит и её ходы — завышение один раз.
4. **Ход без ответа тоже считается**: one-shot с `error_max_turns`, прерванный ход — цена уже потрачена. Прерванный ход
   Claude Code повторяет прежнюю цифру (`controls.jsonl`), и разница 0 ничего не пишет.
5. **Цена пишется и при выключенном Assistant-е.** Окно Limits начинается раньше включения, и доля после включения
   должна видеть ходы с начала окна. Файл `assistant/usage.json` уже есть в описи состояния (ADR-0005, PR #2282).
6. Не ходы и не считаются: запрос Limits (`usage`) и опрос MCP (inventory) — модель не вызывается.
