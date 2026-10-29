# 34 — Карантин e2e-spec-ов и flaky проверка Dock в `quiet-windows.spec.ts`

Type: task
Status: done 2026-10-29T12:31Z
PR: #985
Branch: worfy-throughput/34-quarantine
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

- [x] `test/unit/quarantine.test.ts` (Ticket 20) проверяет и e2e-записи; exit 0.
- [x] e2e-spec в карантине пропускается с пометкой; `WORFY_QUARANTINE=only pnpm test:e2e` гоняет только его.
- [x] `quiet-windows.spec.ts` — 10 повторов под нагрузкой зелёные, или запись карантина с причиной в «Итог».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge `ci-ok` (Ticket 35; до него — gate full на Mac) и вердикт Windows `pc` (gate full на
      ПК) — перед merge.

## Где в коде

- `test/e2e/helpers.ts`, `test/e2e/quiet-windows.spec.ts`, `test/quarantine.ts`, `test/quarantine/`
- `test/e2e/epic-frame-undo.spec.ts`, `test/e2e/projects-connect.spec.ts` — только пометки

## Вне скоупа

- Повторы в Playwright — нет (`playwright.config.ts:17`).

## Итог
2026-10-29, ПК (Windows 11), ветка `worfy-throughput/34-quarantine`.

- Шаг 1 уже влит в #878 (2026-10-28): `test/e2e/quarantine.ts` — `quarantined('<id>')` вместо `test(...)`, те же записи `test/quarantine/<id>.json` с `"runner": "playwright"`, режимы `WORFY_QUARANTINE` из `test/quarantine.ts`. `test/unit/quarantine.test.ts` проверяет и e2e-spec-и (свой fixture `test/e2e/fixture.spec.ts`). Второй раз не делался.
- Шаг 2, `quiet-windows.spec.ts`, причины по условию:
  - `:40`, проверка Dock: `app.dock.isVisible()` читался один раз сразу после запуска, а политика активации `accessory` (`src/main/index.ts:109`) на нагруженном Mac может дойти до Dock позже. Теперь `expect.poll` до `false`.
  - `:72`: macos-e2e run 40824106891 (PR-ветка worfy-throughput/13) — тест упёрся в свои 60 s, retry прошёл за 2 s, но worker закрывался ещё 60 s, и job кончился exit 1. По trace: `launchApp` вернулся на 0.8 s, а `app.evaluate` теста не вернулся до timeout-а. Внутри он ждёт `'closed'` первого окна после `close()`; `close()` сначала спрашивает страницу и ждёт ответа без предела. Свой опрос нового окна там ограничен 30 s, значит, висело закрытие. Теперь `destroy()`: закрывает без вопроса странице, а тест проверяет окно, открытое после.
  - Карантин не нужен: причины найдены.
  - ПК: `pnpm test:e2e test/e2e/quiet-windows.spec.ts:72 --retries=0 --repeat-each=10` до правки — 10 passed, и под полной загрузкой CPU (16 потоков busy loop) — 10 passed. На Windows не воспроизводится: красный был на macOS. После правки весь spec ×10 под той же загрузкой — exit 0, 40 passed. Проверка Dock идёт только на macOS — нужен прогон Mac-а.
- Шаг 3, `epic-frame-undo.spec.ts:125` и `projects-connect.spec.ts:217`: флейков сейчас нет. В 206 job-ах windows-e2e с #921 (и 12 job-ах probe #963) у них ни одной строки FLAKY и ни одного красного. ПК: оба ×10 без нагрузки — 20 passed, ×10 под загрузкой — 20 passed. В карантин не перенесены.

Влит #985 (`b5e5f827`): `ci-ok` success, `macos-e2e` 1/1 (проверка Dock на macOS), `check/windows` по gate full на ПК;
ревью bridge (11 строк spec-а).
