# 58 — Flaky test: «the deploy mark after a whole install» упирается в timeout 5 s под нагрузкой

Type: bug
Status: done 2026-10-18T17:49Z
PR: #492
Branch: worfy-windows/58-deploy-mark-flaky
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

- [x] Причина timeout в test-е названа комментарием рядом с правкой.
- [ ] Три прогона `GATE_SCOPE=all` gate full на Mac под параллельной нагрузкой (другие test-ы на той же
      машине, как в gate full Wave) — каждый exit 0, строка `[gate] зелено (full)`; строки — в Итог.
- [x] Test-ы `describe` по-прежнему проверяют то же: mark один раз, после копии и метаданных; mark, который
      бросает, не роняет установку.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac.

## Тесты

Сам `test/unit/install-stable-functions.test.ts`; нагрузку даёт параллельный gate full.

## Где в коде

- `test/unit/install-stable-functions.test.ts` (`:420` и test-ы `describe`)
- `vitest.config.ts` (только читать: timeout проектов)

## Итог

Причина найдена замером, а не догадкой. Каждый test `describe` запускает stand-in `lsregister` — shell-скрипт,
который `useStandInBuild` (`test/unit/install-stable-harness.ts`) пишет заново перед каждым test-ом в новую
временную папку. macOS проверяет новый исполняемый файл перед первым запуском: первый запуск такого скрипта —
около 400 ms, второй запуск того же файла — 3 ms, `/bin/sh <скрипт>` и `/usr/bin/true` — 1–3 ms (замер
`spawnSync` по шагам внутри vitest и отдельным скриптом). Остальные программы целой установки дешёвые: `git` —
около 10 ms, `ps -axo` — 30 ms, `ditto` маленькой копии — 3 ms. Копия приложения в test-е и так из одного файла:
уменьшать её нечего. Под нагрузкой gate full проверка нового файла растягивается на секунды, отсюда timeout 5 s.

Правка — `test/unit/install-stable-functions.test.ts`, `describe` «the deploy mark after a whole install»:

- свой `beforeEach` после `useStandInBuild()` на macOS ставит `WORFY_STABLE_LSREGISTER=/usr/bin/true`: эти
  test-ы не смотрят, что зарегистрировано, а системная программа запускается сразу. `afterEach` из
  `useStandInBuild` возвращает переменную, как была до test-а;
- `{ timeout: 15_000 }` у `describe`, с комментарием: в test-ах остаются настоящие программы (`git`, `ps` дважды,
  `ditto`; на Windows — дважды список процессов PowerShell), как у проекта `contract` с его 15 s. Глобальный
  `testTimeout` не тронут.

Время трёх test-ов (verbose reporter vitest), Mac, до → после:

- без нагрузки, по 3 прогона: 496–1311 ms → 91–140 ms;
- под нагрузкой (параллельно `pnpm typecheck` и `pnpm test test/unit/install-stable.test.ts`), по 5 прогонов,
  каждый exit 0: до — 472–1205 ms, после — 101–180 ms.

Что test-ы проверяют, не изменилось: пять mutant-ов `scripts/install-stable.mjs` (mark до записи файла
метаданных, mark без `try/catch`, mark дважды, `prebuilt: false` всегда, чужой commit в mark) — каждый красный
на этом `describe` (exit 1).

Не сделано: три прогона `GATE_SCOPE=all` gate full под нагрузкой — бриф оркестратора велел gate fast, не gate
full; это пункт для gate full Wave.

### Мерж и проверки на Mac (Session на Mac, 2026-10-18)

- PR #492 влит как `8d014c65`. Перед мержем ([комментарий](https://github.com/IDSAD-XL/worfy/pull/492#issuecomment-6250702783)) `GATE_SCOPE=all` gate full на Mac, дерево `29e4ff11` с main `cf506ee0` — exit 0, `[gate] зелено (full): worfy/.:lint worfy/.:typecheck worfy/.:test worfy/.:test:e2e worfy/.:test:package`. Ревью на Mac (medium, test-ы) — без находок; пять своих мутантов deploy mark убиты; файл три раза подряд зелёный (43 passed), lint и typecheck exit 0.
- PR только про test-ы и не платформенный. На Windows `describe` идёт без подменного `lsregister` (`registerCommand` отдаёт `null`, `scripts/install-stable.mjs:261`); там меняется только timeout 15 s. Вердикта Windows нет: файл стоит в Windows checks следующего прогона ПК. Linux CI — batch CI на main.
