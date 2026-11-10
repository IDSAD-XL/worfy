# 97 — Красный `main`: e2e `new-product-session.spec.ts:93` — фиксированная дата transcript-а попала под автоархив

Type: bug
Status: in-progress
PR: —
Blocked by: —
Source: Orchestrator 2026-11-10. С 2026-11-10T08:02Z каждый CI run `main` падает на одном e2e test-е, на macOS и
Windows, повторы тоже; последний зелёный run `main` — 06:48Z.

## Что происходит

`test/e2e/new-product-session.spec.ts:93` — test «a Product Session saved before a restart opens with Resume in its
Session view and resumes as a Product Session». `locator('[data-testid="session-node"][data-node-id="product-1"]')`
так и не становится видимым.

Fixture test-а кладёт в `layout.json` Session Node `product-1` без `touchedAt`, а его transcript — с фиксированным
`timestamp: '2026-11-09T08:00:00.000Z'`. 2026-11-10 в 08:00Z этой записи исполнилось 24 h.

Причина — автоархив завершённых Session (ADR-0076), `src/main/layout/archive.ts`:

- `:71` — порог `'24h'` = 24 h; `src/shared/settings/app-settings.ts:159` — по умолчанию `after: '24h'`.
- `:155–156` (`idleSessions`) — простой считается от последней записи transcript-а (`lastAt`), если у Node нет свежего
  `touchedAt`.
- `:196` (`archiveCandidates`) — `idle > threshold` → кандидат `idle`.

AutoArchiver запускается при первом чтении Layout-а (`:470`, `onFirstRead`), то есть на старте: Node архивируется раньше, чем Canvas его
покажет. Это правило продукта, не ошибка: Session, которая простаивает больше 24 h, уходит с Canvas. Значит,
исправление — в test-е.

Остальные e2e spec-и со старыми фиксированными датами под это правило не попадают: они либо не кладут Session Node
в `layout.json` (Node создаётся при работе и получает `touchedAt`), либо ставят `sessionArchive: { after: 'never' }`
(`arrange-by-epic`, `binding`, `browser-family`, `family`, `session-archive`), либо строят время от `Date.now()`
(`session-archive-history`). `browser-mcp` кладёт Session Node, но transcript-а с датой у него нет.

## Что делаем

- В `new-product-session.spec.ts:93` время записей transcript-а — минуту назад от `Date.now()`, не фиксированная дата.
- Код приложения не меняем.

## Готово, когда

- [ ] Причина названа с file:line в «Итог».
  - evidence: commit pass · test: build the restored Product Session's transcript time from now, not a fixed date (worfy-polish 97) · - - · 1390348036f855d165d3f5dce295168dd7b19c8a
- [ ] `pnpm test:e2e test/e2e/new-product-session.spec.ts` со старой датой — красный на test-е :93, с исправлением —
      зелёный (оба test-а файла).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/new-product-session.spec.ts` exit 0 (2 passed; with the old fixed date exit 1, test :93 failed) · mac - · 1390348036f855d165d3f5dce295168dd7b19c8a
- [ ] Другие e2e spec-и проверены на фиксированные даты, которые попадают под тот же порог; список в «Итог».
  - evidence: commit pass · test: build the restored Product Session's transcript time from now, not a fixed date (worfy-polish 97) · - - · 1390348036f855d165d3f5dce295168dd7b19c8a
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `test/e2e/new-product-session.spec.ts:93` — test; :97–99 — время записей transcript-а (было :96, фиксированная дата).
- `src/main/layout/archive.ts:71`, `:155–156`, `:196`, `:470` — правило автоархива (только чтение).

## Вне скоупа

- Порог автоархива и его значение по умолчанию.

## Итог

Код приложения не менялся: исправлен только fixture test-а.

**Причина.** Автоархив ADR-0076 с порогом по умолчанию 24 h (`src/main/layout/archive.ts:71`,
`src/shared/settings/app-settings.ts:159`). У Node `product-1` нет `touchedAt`, поэтому простой считается от
последней записи transcript-а (`archive.ts:155–156`); с 08:00Z 2026-11-10 он больше 24 h, и `archiveCandidates`
(`archive.ts:196`) отдаёт Node в архив на первом чтении Layout-а (`archive.ts:470`) — до того, как Canvas его
покажет. Правило продукта верное, поэтому чинится test.

**Исправление.** `test/e2e/new-product-session.spec.ts:97` — время записей transcript-а минуту назад от
`Date.now()`.

**Проверка.**
- Со старой датой: `pnpm test:e2e test/e2e/new-product-session.spec.ts` — exit 1, test :93 упал на
  `toBeVisible` для `session-node` `product-1` (element(s) not found), test :46 прошёл.
- С исправлением: та же команда — exit 0, 2 passed.

**Другие spec-и.** Фиксированные даты в `chat-attachments`, `external-session`, `minimap-kinds`, `node-kinds`,
`new-session`, `orchestrator`, `session-picker`, `session-back`, `session-history-tail`, `session-view`,
`session-resume`, `session-two-windows`, `subagent-tree`, `toast-placement`, `zoom-whole-nodes` под порог не
попадают: ни один не кладёт в `layout.json` Session Node kind `session` (пустой список Node-ов, Node-ы других
kind-ов или Orchestrator, которого правило не берёт). Spec-и с Session Node в `layout.json` либо ставят
`sessionArchive: { after: 'never' }`, либо строят время от `Date.now()`.
