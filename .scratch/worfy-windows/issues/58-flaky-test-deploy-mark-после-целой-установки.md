# 58 — Flaky test: «the deploy mark after a whole install» упирается в timeout 5 s под нагрузкой

Type: bug
Status: open
Blocked by: —
Source: gate full на Mac, 2026-10-18: test падал три раза за день, каждый раз в первом прогоне — PR #479,
PR #480 и PR #489; повторный прогон того же дерева зелёный.

## Что происходит

`test/unit/install-stable-functions.test.ts:420` — `describe` «the deploy mark after a whole install». Его
test-ы делают целую установку: git-репозиторий, build-шаг test-а, копия приложения (`ditto` на macOS),
файл метаданных. Один такой test идёт около 430 ms. Unit-проект vitest (`vitest.config.ts:36`) держит
timeout по умолчанию — 5 s; своего `testTimeout`, как у проекта `contract` (`vitest.config.ts:50`, 15 s), у
него нет.

Когда gate full гоняет другие test-ы на том же Mac, эти test-ы выходят за 5 s и падают по timeout. Gate
краснеет, Session тратит второй прогон gate full. Код установки при этом верный.

## Что делаем

Одно из двух, что проще и честнее:

1. Длиннее timeout для этих случаев (третий аргумент `it` или `describe`), с комментарием, почему
   целая установка медленнее unit-test-а.
2. Меньше копия приложения в test-е, чтобы целая установка шла заметно быстрее.

## Готово, когда

- [ ] Причина timeout в test-е названа комментарием рядом с правкой.
- [ ] Три прогона `GATE_SCOPE=all` gate full на Mac под параллельной нагрузкой (другие test-ы на той же
      машине, как в gate full Wave) — каждый exit 0, строка `[gate] зелено (full)`; строки — в Итог.
- [ ] Test-ы `describe` по-прежнему проверяют то же: mark один раз, после копии и метаданных; mark, который
      бросает, не роняет установку.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac.

## Тесты

Сам `test/unit/install-stable-functions.test.ts`; нагрузку даёт параллельный gate full.

## Где в коде

- `test/unit/install-stable-functions.test.ts` (`:420` и test-ы `describe`)
- `vitest.config.ts` (только читать: timeout проектов)

## Итог
