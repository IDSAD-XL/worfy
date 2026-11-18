# 08 — Update во время работы: "Restart now" рядом с "Restart when idle", Run в Wait не держит Update

Type: task
Status: done 2026-11-18T11:07Z
PR: #1993
Blocked by: 04, 06
Source: [spec.md](../spec.md), «Ticket-ы», 8; «Решения по реализации» → «Update во время работы»; «Вопросы владельцу», Q1
((а), решено без владельца, подтвердить; меняет решение 7 worfy-update); «Решения по test-ам», Contract и e2e; «Риски», 5

Кто: агент.

Платформенный Ticket (ADR-0056, пункт 2): перезапуск в Update через swap-helper на macOS и Windows. Глубина ревью —
`medium`; снимок экрана toast-а.

## Что происходит

- "Restart now" предлагается, только пока ничего не работает; пока что-то работает — только "Restart when idle"
  (`docs/features/updates.md:114–115`). Отказ `BUSY` — `src/main/update/restart.ts:35`, его возвращает `plan()`
  (`:465`).
- Run в Wait (Limits, Start window, budget) тоже считается работой: `idle()` возвращает `false`, пока Autopilot идёт
  (`src/main/update/idle.ts:30–32`). Ночной Run держит Update до своего конца.
- Так решил владелец в worfy-update (решение 7, `.scratch/worfy-update/spec.md:138–140`), когда работа после
  перезапуска терялась. Q1 этого Epic-а — (а): решение 7 меняется.
- Перед перезапуском worfy пишет `restart.json` (`src/main/update/restart.ts:41`, `restartFile` — `:68`).

## Что делаем

1. "Restart now" и во время работы, рядом с "Restart when idle": в toast-е «worfy <version> ready», в меню chip-а версии,
   в Settings и в Command palette. Отказ `BUSY` уходит; нажатие — согласие на grace и приостановку (координатор
   Ticket-а 04, причина `update`).
2. Run в Wait больше не держит "Restart when idle": `idle()` считает такой Run простаивающим; он приостанавливается и
   после перезапуска продолжает со своим Wait-ом (Ticket 06).
3. Причина перезапуска — в `restart.json`, чтобы `run-continued` и `notice` сказали `update`, а не `crash`.
4. Английская страница `docs/features/updates.md`: таблица toast-ов, строки Settings, абзац «The restart»; перевод —
   Ticket 14.

## Готово, когда

- [ ] Contract test (рядом с `test/contract/update-restart.test.ts`): "Restart now" во время turn-а — не отказ, выход
      через координатор с причиной `update`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts` exit 0 · mac - · 43a481af00596439170a331f1d1bbe90f9a2a33c
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-wiring.test.ts test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts test/unit/update-quit.test.ts` exit 0 · mac - · 2c0304b931b7ab54cdf2d243a89b761b2edbbba1
- [ ] Contract test: Run в Wait Limits не держит "Restart when idle" — перезапуск начинается.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts` exit 0 · mac - · 43a481af00596439170a331f1d1bbe90f9a2a33c
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-wiring.test.ts test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts test/unit/update-quit.test.ts` exit 0 · mac - · 2c0304b931b7ab54cdf2d243a89b761b2edbbba1
- [ ] Unit test `idle()`: Run в Wait — простаивает; Run с Wave в работе — нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts` exit 0 · mac - · 43a481af00596439170a331f1d1bbe90f9a2a33c
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-wiring.test.ts test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts test/unit/update-quit.test.ts` exit 0 · mac - · 2c0304b931b7ab54cdf2d243a89b761b2edbbba1
- [ ] Contract test: `restart.json` несёт причину; после старта `run-continued {after: update}`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts` exit 0 · mac - · 43a481af00596439170a331f1d1bbe90f9a2a33c
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/update-wiring.test.ts test/contract/update-restart.test.ts test/contract/update-restart-continuity.test.ts test/unit/update-idle.test.ts test/unit/update-quit.test.ts` exit 0 · mac - · 2c0304b931b7ab54cdf2d243a89b761b2edbbba1
- [ ] e2e test (рядом с `test/e2e/update-toasts.spec.ts`, `update-toolbar.spec.ts`, `update-settings.spec.ts`): во
      время работы видны обе кнопки.
- [ ] Английская страница `docs/features/updates.md` описывает "Restart now" во время работы.
  - evidence: commit pass · worfy-continuity/08: Restart now during work, a Run in a Wait does not hold Update · - - · 43a481af00596439170a331f1d1bbe90f9a2a33c
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): job Windows в составе `ci-ok` зелёный на head PR до merge.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 43a481af00596439170a331f1d1bbe90f9a2a33c
  - evidence: gate pass · `gate fast` exit 0 · mac - · 2c0304b931b7ab54cdf2d243a89b761b2edbbba1
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44285064242/job/134757834275 · ci - · 140689882a1462d05c750fc64315fbf9b0384ed5

## Тесты

- `test/contract/update-restart.test.ts`, unit для `src/main/update/idle.ts`, e2e рядом с `test/e2e/update-toasts.spec.ts`.
  Каждый test сначала красный.

## Где в коде

- `src/main/update/restart.ts`
- `src/main/update/idle.ts`
- `src/main/ipc/update.ts`
- `src/renderer/update/toasts.ts`, `src/renderer/update/store.ts`
- `test/contract/update-restart.test.ts`
- `test/e2e/update-toasts.spec.ts`, `test/e2e/update-toolbar.spec.ts`, `test/e2e/update-settings.spec.ts`
- `docs/features/updates.md`

Только читать: `src/main/quit-grace.ts` (Ticket 04), `scripts/install-stable.mjs`.

## Вне скоупа

- Перенос простаивающих Session-ов в новую копию без перезапуска процессов (daemon, шаг 2 — Q5).
