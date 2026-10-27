# 21 — Команда выбора test-ов по diff: список unit- и contract-файлов, которые задевает PR

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решение 4; пункт 1 «Что делаем»
Ticket-а [11](11-pr-вливается-по-задетым-test-ам-полный-набор-на-main.md) — вынесен сюда, чтобы e2e по путям
(13) не ждал CI на Linux на PR (12).

## Что происходит

- gate сужает набор только по пакету (`harness/hooks/gate.mjs`, выбор набора около `:861-945`); worfy — один
  пакет, и любая правка `.ts` запускает весь `pnpm test`.
- Около 87 unit- и contract-файлов запускают настоящие процессы (скрипты `harness/bin/*`, `bash`, `git`) или
  читают файлы как текст (`ci.yml`, тексты Harness) — граф import-ов этих связей не видит (spec Epic-а,
  раздел 2026-10-20, «Риски»).
- `scripts/windows-test-list.mjs` проверяет список файлов для runner-а, но не строит его.

## Что делаем

1. `node scripts/affected-tests.mjs <base> <head> [--json]`: печатает test-файлы `test/unit/` и `test/contract/`,
   которые задевает diff — по графу модулей (рекомендация spec-а — граф vite через `vitest related` /
   `vitest list`; окончательный выбор — по фикстурам этого Ticket-а) и по таблице
   `scripts/affected-tests.table.json` («путь или glob → test-файлы») для связей вне графа.
2. Правка конфигурации test-ов, `package.json`, lockfile, setup-файлов — печатает `ALL`. Путь, который не
   покрыт ни графом, ни таблицей, — тоже `ALL`, не пустой список.
3. Изменённый или новый test-файл входит в список всегда.

Нужен ПК: нет. Трогает Harness: нет. Вердикт Windows: не платформенный PR (команда идёт на Mac и Linux).

## Готово, когда

- [ ] `test/unit/affected-tests.test.ts` на фикстуре: правка модуля `src/shared/` — его test-ы и test-ы его
      импортёров; правка `harness/bin/wave-gate` — contract test-ы, которые запускают его процессом (по
      таблице); правка `vitest.config.ts` — `ALL`; неизвестный путь — `ALL`; правка только `.md` — пустой список.
- [ ] Прогон на трёх последних влитых PR с кодом: число файлов и время `pnpm test <файлы>` против полного —
      в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).

## Где в коде

- `scripts/affected-tests.mjs`, `scripts/affected-tests.table.json`, `test/unit/affected-tests.test.ts` — новые
- Только читать: `harness/hooks/gate.mjs`, `scripts/windows-test-list.mjs`, `vitest.config.ts`

## Вне скоупа

- Шаг перед merge по задетым test-ам и bisect на красном `main` — Ticket 11.
- e2e — Ticket 13.
- Набор Windows-runner-а по diff — нет: «Windows tests» идёт `full` на каждый PR (Ticket 24, решение 5). Если
  `full` на PR станет самым долгим шагом до merge, выбор файлов по выводу этой команды — отдельный Ticket.

## Итог
