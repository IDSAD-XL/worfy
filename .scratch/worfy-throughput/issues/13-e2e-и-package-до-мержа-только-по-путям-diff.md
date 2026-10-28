# 13 — e2e и `test:package` до merge — только когда diff трогает renderer, main process, упаковку или watcher-ы; иначе — ночной run на `main`

Type: task
Status: open
Blocked by: 10, 21, 35
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов», решение Q5;
[ADR-0081](../../../docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md) (принят 2026-10-20), пункт 3;
Ticket [03](03-implementer-гоняет-только-свои-e2e.md) (done, PR #385). Правка 2026-10-28 (раздел «Решения
владельца 2026-10-28: процесс»): было «весь e2e или ни одного», стало «только spec-и, которые задевает diff»;
блокер 11 заменён на 21 (команда выбора test-ов); слово владельца на правки Harness дано 2026-10-28.

## Что происходит

- gate full перед merge гоняет весь `test:e2e` (88 файлов в `test/e2e`; 87 из них запускают Electron через
  `launchApp` → `_electron.launch`, `test/e2e/helpers.ts:146`, кроме `linked-autopilot.spec.ts`) и
  `test:package` (собранный `.app`) на каждом PR с кодом или на наборе Wave. Playwright идёт в один
  поток: `workers: 1`, `fullyParallel: false` (`playwright.config.ts`).
- Ticket 03 записал правило implementer-а: e2e — только файлы, которые трогает Ticket; весь `test:e2e` —
  в gate full Orchestrator-а перед merge (`harness/agents/implementer.md:174-179`).
- Пути, от которых зависит e2e: renderer — `src/renderer/`, `src/preload/`; main process — `src/main/`;
  упаковка — `electron-builder.yml`, `electron.vite.config.ts`, `build/`; watcher-ы —
  `src/main/workflow/watch.ts`, `src/main/link-safe-watch.ts`, `src/main/chokidar-close.ts`,
  `src/main/watch-gone.ts`, `src/main/cards/store.ts`, `src/main/claude-home/registry.ts`. Списка путей в
  Profile-е нет.

## Правка 2026-10-28: CI на runner-ах

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): e2e и `test:package` идут на macOS-runner-е в `ci-ok` каждого PR и
push в `main` (Ticket 35). Цель этого Ticket-а теперь — скорость и стабильность `ci-ok`, а не экономия Mac:
macOS job PR-а гоняет только spec-и по таблице ниже, весь `test:e2e` — push в `main`. Список spec-ов
передаётся в job `ci-ok` (выводом команды, не правкой `playwright.config.ts`); «ночной run» пункта 3 заменяет
run на push в `main`. Точку передачи выбрать при claim по PR Ticket-а 35.

## Что делаем

1. Поле Profile-а — таблица «путь (glob) → spec-и e2e» и список путей, при которых нужен `test:package`. Для
   worfy — пути из «Что происходит»; окончательная таблица — в «Итог».
2. Шаг перед merge: e2e — только spec-и, которые задевает diff PR против базы (по таблице пункта 1 и по
   `scripts/affected-tests.mjs` Ticket-а 21 для import-ов из `test/e2e/helpers.ts`). Путь в `src/main`,
   `src/preload` или `src/renderer`, которого нет в таблице, — весь `test:e2e`, не пустой список. diff не
   трогает ни одного пути таблицы — e2e до merge нет. `test:package` — по своему списку путей.
   Список spec-ов передаётся через gate или `land` (Ticket 27) — **не** правкой `playwright.config.ts`: этот
   файл в списке `PC_ONLY` (`scripts/windows-verdict-scope.mjs`), и такой PR ждал бы ПК.
3. Ночной run на `main`: весь `test:e2e` и `test:package`. Что делать с красным ночным run-ом — в
   «Открытые вопросы».
4. **Связь с Ticket-ом 03.** Первая половина правила 03 остаётся: implementer гоняет только e2e-файлы,
   которые трогает Ticket. Вторая половина — «весь `test:e2e` — в gate full перед merge» — меняется:
   перед merge — только spec-и по таблице пункта 1, весь `test:e2e` — ночью. Текст
   `harness/agents/implementer.md:174-179` и пункт `rules.md` Profile-а, который записал 03, правятся
   под это.
5. `docs/lessons/agents.md:57-66` и `:95-101` (заблокированный экран — e2e падает на первом окне) касаются и
   ночного run-а: экран Mac ночью должен быть включён.

Платформенный PR (ADR-0056, пункт 2): меняются скрипты Harness — до merge нужен вердикт Windows (ADR-0071).

## Готово, когда

- [ ] `profile` читает и проверяет поле списка путей; неверный тип — exit 1 с причиной;
      `harness/bin/tests/profile.test.sh` это проверяет.
- [ ] На временном репозитории: diff в файле из таблицы — шаг перед merge гоняет только его spec-и; diff в
      `src/renderer/` вне таблицы — весь `test:e2e`; diff только в `src/shared/` без связи с e2e — e2e нет;
      shell test это проверяет. `playwright.config.ts` в diff PR-а нет.
- [ ] Текст implementer-а и skill-ов говорит новое правило; `harness/bin/tests/agents-text.test.sh`
      проверяет фразу; правило Ticket-а 03 о своих e2e-файлах на месте.
- [ ] Ночной run на `main` запущен хотя бы один раз; ссылка или лог и код выхода — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
      Windows; gate full — шаг Orchestrator-а перед merge (последний по старой схеме).

## Открытые вопросы

Решает владелец по числам Ticket-а 10; исполнитель не выбирает сам.

- **Кто и где запускает ночной run.** Job-а на macOS нет (Q4), e2e нужен экран Mac. Варианты:
  scheduled task на Mac, отдельный Autopilot run, ручной `full-macos` по расписанию — последний
  противоречит Q4.
- **Красный ночной run.** Q5 решает только, что e2e и `test:package` идут ночью на `main`. Тот же порядок,
  что красный `main` у Ticket-а 11 (bisect и revert), или только отчёт — не решено.
- **Точный список путей.** Входит ли `src/shared/` (общий код renderer-а и main process) и
  `harness/` (Harness ставится из приложения, `harness-install.spec.ts`).

## Где в коде

- `harness/bin/profile`, `harness/bin/tests/profile.test.sh`
- `harness/bin/wave-gate`, `harness/skills/epic-wave/SKILL.md` (раздел 3 «Verification gate»)
- `harness/agents/implementer.md` (`:174-179`), `harness/bin/tests/agents-text.test.sh`
- `harness/profiles/README.md`, `harness/profiles/draft.schema.json`
- `playwright.config.ts` (только чтение)

Вне репозитория (шаг Orchestrator-а после merge): live Profile worfy (список путей) и `rules.md` (правило
о замке e2e).

## Вне скоупа

- Параллельный Playwright (`workers` больше 1) — отдельный Ticket по числам Ticket-а 10.
- e2e в CI на GitHub — нет (Q4).

## Итог

- **CI-половина (2026-10-28, ветка `ci/macos-jobs-by-diff`).** Было: каждый PR с кодом просил 3 macOS job-а
  (`macos-tests` и два shard-а `macos-e2e`), и зелёные run-ы PR шли 57–81 минуту при самом долгом job-е
  19 минут: macOS job-ы ждали 26–67 минут одного из 5 macOS runner-ов бесплатного плана. Стало
  (`scripts/ci-scope.mjs`, `.github/workflows/ci.yml`, test-ы — `test/contract/ci-workflow.test.ts`):
  - `macos-e2e` на PR — только когда diff трогает приложение: `src/` (вся папка, `card-runtime` тоже),
    `test/e2e/`, `test/fixtures/`, `test/quarantine/` и файлы `test/*.ts`, которые импортирует e2e
    (contract test сверяет каждый import `test/e2e` со списком), `playwright.config.ts`,
    `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig*.json`, `build/`, `package.json`,
    `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/workflows/`, скрипты сборки и job-а
    (`build-version.ts`, `dev-bundle.ts`, `postinstall.mjs`, `install-stable.mjs`, `statusline-bridge.*`,
    `ci-display.js`). `harness/`, `test/unit`, `test/contract`, прочие скрипты и документы — e2e на PR нет.
  - `macos-tests` на PR — вариант (a): только test-файлы с проверкой для одной macOS (guard
    `platform === / !== 'darwin'`; список строит `ci-scope.mjs` при каждом run-е, второй output
    `macos-tests-files`), когда diff трогает приложение, такой файл, `vitest.config.ts` или
    `scripts/vitest-electron.mjs`. Замер по логу `macos-tests` run-а 40744007856 на `main`: 18 таких файлов
    из 462 — 179 s из 1131 s времени файлов (весь набор шёл 640 s, job 11 минут); самые тяжёлые из 18 —
    `harness-evals` 57 s, `harness-evals-outcome` 36 s, `harness-install` 31 s.
  - `macos-package` — без изменений (входы сборки на PR, всегда на push).
  - Push в `main` и ручной `full-macos` — все job-ы, весь набор в каждом. Поправка ADR-0083 записана.
  - Цена: test без guard-а, который краснеет только на macOS (FSEvents, case-insensitive FS, BSD-утилиты), и
    e2e Harness-копии приложения (`harness-install.spec.ts`) при PR только с `harness/` ловит run push-а в `main`.
  Открыто (Harness-половина): поле Profile-а, шаг gate, `implementer.md`, `rules.md`.
