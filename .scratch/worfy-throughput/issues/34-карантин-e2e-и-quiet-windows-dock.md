# 34 — Карантин e2e-spec-ов и flaky проверка Dock в `quiet-windows.spec.ts`

Type: task
Status: blocked
Blocked reason: нужен Windows-ПК — файлы `test/e2e/**` и `playwright.config.ts` в списке `PC_ONLY`, PR ждёт gate full на ПК; ПК на паузе до слова владельца
Waits: owner
Blocked by: 20
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решения 2 и 3; gate full на Mac
2026-10-27 — `test/e2e/quiet-windows.spec.ts`
красный под нагрузкой.

## Что происходит

- `test/e2e/quiet-windows.spec.ts:31` («the window is on screen but takes no focus, has no Dock icon and is
  transparent», проверка Dock `:40`) краснел в gate full под load average 30–60.
- Карантин Ticket-а 20 — только для vitest; e2e идут через Playwright, без повторов нарочно
  (`playwright.config.ts:17`).
- `test/e2e/**` и `playwright.config.ts` — `PC_ONLY` (`scripts/windows-verdict-scope.mjs:76,78`).

## Что делаем

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): e2e теперь идут на macOS-runner-е на каждый PR и push в `main`; flaky e2e краснит
`ci-ok` у всех PR, поэтому карантин e2e нужнее, чем при gate full на Mac. Файлы остаются в `PC_ONLY` — Ticket
всё равно ждёт ПК.


1. Те же записи `test/quarantine/<id>.json` читает `test/e2e/helpers.ts`: spec в карантине для текущей
   платформы — `test.skip` с пометкой владельца и даты; `WORFY_QUARANTINE=only` — только они.
2. `quiet-windows.spec.ts`: причина красного под нагрузкой (ожидание состояния Dock по условию, а не по
   времени); запись карантина — на время починки, снять в этом же PR, если причина найдена.
3. Перенести в карантин e2e-flaky Windows из `worfy-polish` 41 (`epic-frame-undo.spec.ts:125`,
   `projects-connect.spec.ts:217`) с владельцем 41.

Нужен ПК: **да** (вердикт `pc`). Трогает Harness: нет.

## Готово, когда

- [ ] `test/unit/quarantine.test.ts` (Ticket 20) проверяет и e2e-записи; exit 0.
- [ ] e2e-spec в карантине пропускается с пометкой; `WORFY_QUARANTINE=only pnpm test:e2e` гоняет только его.
- [ ] `quiet-windows.spec.ts` — 10 повторов под нагрузкой зелёные, или запись карантина с причиной в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge `ci-ok` (Ticket 35; до него — gate full на Mac) и вердикт Windows `pc` (gate full на
      ПК) — перед merge.

## Где в коде

- `test/e2e/helpers.ts`, `test/e2e/quiet-windows.spec.ts`, `test/quarantine.ts`, `test/quarantine/`
- `test/e2e/epic-frame-undo.spec.ts`, `test/e2e/projects-connect.spec.ts` — только пометки

## Вне скоупа

- Повторы в Playwright — нет (`playwright.config.ts:17`).

## Итог
