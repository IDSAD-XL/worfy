# 0095 — Node Orchestrator-а хранит Vendor своей Session рядом с её id
Дата: 2026-11-04. Статус: принят. Дополняет [ADR-0010](0010-orchestrator-state-session-id-and-cost-only.md). Epic
`worfy-multi-vendor`, Ticket 37 ([37-orchestrator-и-autopilot-на-codex.md](../../.scratch/worfy-multi-vendor/issues/37-orchestrator-и-autopilot-на-codex.md));
граница Vendor-ов — [ADR-0094](0094-vendor-seam.md).

**Контекст.** ADR-0010 оставил в `data` Node-а `orchestrator` только `sessionId` (для `resume`) и `costUsd`. Всё
остальное — модель, блок статуса — берётся из транскрипта и событий живой Session, чтобы в Layout не лежало
устаревшее состояние. С Ticket-ом 37 Orchestrator идёт на Vendor-е `defaultVendor` Project-а, и Vendor можно сменить
в Settings Project-а. `sessionId` сам по себе не говорит, чья это Session: id Claude Code, отданный Codex для
`resume`, — отказ app-server-а при каждом старте после смены. Модель Claude, отданная Codex, — та же ошибка.

**Решение.** В `data` Node-а `orchestrator` — необязательное поле `vendor`, Vendor той Session, чей id лежит в
`sessionId`. Main пишет его при первом `init` новой Session на другом Vendor-е, чем записанный (`apply`, ветка
`init`, `src/main/agent/orchestrator.ts`), вместе с её `sessionId` и `costUsd: 0`. До этого Node держит прежние
`sessionId`, `costUsd` и `vendor` (`leaveSession`), так что старт, не дошедший до `init`, оставляет прежнюю Session
возобновляемой. Node без поля — Session Claude Code, как до этого ADR, так что Node-ы, которые Vendor не меняли,
остаются `{sessionId, costUsd}`. При старте Orchestrator-а Vendor Project-а сравнивается с `vendor` Node-а: при
расхождении сохранённая Session не возобновляется, начинается новая; модель и effort Node-а сбрасываются в Default,
режим разрешений переводится в равный режим нового Vendor-а.

**Что не меняется.** Остальное правило ADR-0010 в силе: состояние Session (модель, блок статуса, ход) в Layout не
пишется, оно приходит из транскрипта и событий. `vendor` — не состояние Session, а ключ к её `sessionId`.

**Последствия.**
- Схема `data` Node-а и view Orchestrator-а (`src/shared/ipc/orchestrator.ts`) получают необязательное `vendor`;
  test схемы (`test/contract/orchestrator.test.ts`) называет ключ.
- Смена Vendor-а теряет выбранные модель и effort Node-а; обратная смена их не возвращает.
- Старая сборка `vendor` не знает: она возобновит id как Session Claude Code, а `patchData` сливает `data`
  (`src/main/layout/store.ts:257`), так что рядом с записанным ею id Claude Code остаётся `vendor: 'codex'`. Откат
  worfy и обратное обновление после смены Vendor-а Orchestrator-а на Codex стоят по одному отказанному `resume`,
  затем новая Session.

## Considered Options

- **`vendor` в `data` рядом с `sessionId`** (выбрано): один ключ на одну запись, Claude-Node-ы не меняются.
- **Пробовать сохранённый id на новом Vendor-е:** без поля, но каждый старт после смены — отказанный `resume` и
  модель не того Vendor-а в запросе.
- **Хранить `sessionId` по Vendor-у (`sessions: {claude, codex}`):** возврат на прежний Vendor возобновлял бы его
  Session, но меняет форму `data` для всех Node-ов и требует миграции Layout ради редкой смены.
