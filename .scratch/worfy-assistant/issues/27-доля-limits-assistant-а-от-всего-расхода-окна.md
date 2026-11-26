# 27 — Доля Limits Assistant-а считается от всего расхода окна

Type: task
Status: open 2026-11-26T13:07Z
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
- [ ] Unit test `limitsShare` с ценой других ходов: доля Assistant-а меньше процента окна.
- [ ] Test, что подключение зовёт `noteOtherTurn`: Session реестра, one-shot, narrator, Terminal AI — да; Session
      Assistant-а и проверка источника — нет.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
