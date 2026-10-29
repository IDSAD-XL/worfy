# 13 — e2e и `test:package` до merge — только когда diff трогает renderer, main process, упаковку или watcher-ы; иначе — ночной run на `main`

Type: task
Status: claimed 2026-10-29T04:15Z
Branch: worfy-throughput/13
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
  Решено Orchestrator-ом (2026-10-28, PR #927): `harness/` считается приложением, кроме того, что сборка не
  несёт; `src/shared/` входит.

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
    `harness/`, кроме того, что сборка не несёт (`HARNESS_NOT_BUNDLED`: `bin/tests`, `hooks/tests`, `evals`,
    `evals-outcome`; contract test сверяет список с `electron.vite.config.ts`),
    `test/e2e/`, `test/fixtures/`, `test/quarantine/` и файлы `test/*.ts`, которые импортирует e2e
    (contract test сверяет каждый import `test/e2e` со списком), `playwright.config.ts`,
    `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig*.json`, `build/`, `package.json`,
    `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/workflows/`, скрипты сборки и job-а
    (`build-version.ts`, `dev-bundle.ts`, `postinstall.mjs`, `install-stable.mjs`, `statusline-bridge.*`,
    `ci-display.js`). `test/unit`, `test/contract`, прочие скрипты, test-ы и eval-ы Harness и документы —
    e2e на PR нет.
  - `macos-tests` на PR — вариант (a): только test-файлы с проверкой для одной macOS (guard
    `platform === / !== 'darwin'`; список строит `ci-scope.mjs` при каждом run-е, второй output
    `macos-tests-files`), когда diff трогает приложение, `scripts/`, `harness/`, такой файл, `vitest.config.ts`
    или `scripts/vitest-electron.mjs`: эти файлы проверяют и код скриптов и Harness (`make-icons.test.ts` —
    настоящий `sips`, `hang-sample.test.ts` — `ps` macOS, `harness-evals.test.ts`, `harness-install.test.ts`).
    Guard распознаётся в формах `platform === / !== 'darwin'`, `'darwin' === platform` и `case 'darwin'`;
    contract test краснеет на test-файле, который проверяет macOS иначе (импортированный `isMac` в
    `skipIf`/`runIf`, `if`, `?:`) и которого нет в списке. Замер по логу `macos-tests` run-а 40744007856 на `main`: 18 таких файлов
    из 462 — 179 s из 1131 s времени файлов (весь набор шёл 640 s, job 11 минут); самые тяжёлые из 18 —
    `harness-evals` 57 s, `harness-evals-outcome` 36 s, `harness-install` 31 s.
  - `macos-package` — без изменений (входы сборки на PR, всегда на push).
  - `windows-e2e` (#921) идёт тогда же, когда `macos-e2e`: PR без пути приложения не просит e2e ни на macOS,
    ни на Windows.
  - Push в `main` и ручной `full-macos` — все job-ы, весь набор в каждом. Поправка ADR-0083 записана.
  - Открытый вопрос «входит ли `harness/`» — решено Orchestrator-ом: `harness/` считается приложением, кроме
    того, что сборка не несёт. `src/shared/` входит вместе со всей `src/`.
  - Цена: test без guard-а, который краснеет только на macOS (FSEvents, case-insensitive FS, BSD-утилиты), ловит
    только run push-а в `main`; PR только с unit/contract test-ами не просит ни одного macOS job-а.
  Открыто (Harness-половина): поле Profile-а, шаг gate, `implementer.md`, `rules.md`.

- **e2e по spec-ам diff (2026-10-29, ветка `worfy-throughput/13`).** Решено без владельца, подтвердить:
  Orchestrator сузил CI-половину Ticket-а под полную автономию (владелец одобрил «e2e по путям» 2026-10-20 и
  CI на runner-ах 2026-10-28, ADR-0083). Было: PR с путём приложения гонял весь `test:e2e` — 2 shard-а
  `macos-e2e` и 4 shard-а `windows-e2e`. Стало (`scripts/ci-scope.mjs`, таблица `scripts/e2e-specs.table.json`,
  `.github/workflows/ci.yml`; test-ы — `test/contract/ci-scope-e2e.test.ts` и новый describe в
  `test/contract/ci-workflow.test.ts`):
  - На `pull_request` `ci-scope.mjs` выдаёт три новых output-а: `e2e-files` (spec-и через пробел, пусто — все),
    `macos-e2e-shards` и `windows-e2e-shards` (JSON-список `i/n` для matrix).
  - Правило для каждого пути приложения из diff, по порядку:
    - изменённый spec-файл (`test/e2e/**/*.spec.ts`) идёт сам; удалённый ничего не просит;
    - любой другой путь приложения вне `src/` и `harness/` — весь `test:e2e`: helper-ы `test/e2e`, `timings.json`,
      `test/fixtures`, `test/quarantine`, `playwright.config.ts`, входы сборки, `package.json`, `tsconfig*`,
      `test/*.ts`, которые импортирует e2e;
    - путь `src/` или `harness/` — объединение spec-ов всех правил таблицы, чей glob его покрывает; путь, которого
      нет в таблице, — весь `test:e2e`, никогда не пустой список.
  - Таблица, которую не удалось прочитать, неверное правило или spec, которого нет, — тоже весь `test:e2e`.
  - diff без пути приложения — e2e нет, как раньше.
  - Число shard-ов для короткого списка — по `test/e2e/timings.json`: столько, чтобы shard был не дольше
    shard-а полного run-а, от 1 до полного числа и не больше числа файлов. Полный run: 2 shard-а macOS с
    разбиением по времени Ticket-а 48 (#940), 4 shard-а Windows.
  - Push в `main` и ручной run — всегда весь `test:e2e` в полных shard-ах.
  - `playwright.config.ts` не правился: он в `PC_ONLY` `scripts/windows-verdict-scope.mjs`.
  - Windows получает список так: `pnpm test:e2e "--shard=$env:SHARD" @(-split $env:E2E_FILES | Where-Object { $_ })`.
- **Таблица — три правила, консервативно** (каждое с причиной в поле `why`):
  - `harness/` (`agents`, `bin`, `hooks`, `lib`, `profiles`, `skills`, `README.md`, `.mcp.json`) — 9 spec-ов:
    `first-run`, `finder-path`, `harness-install`, `harness-migrate`, `launch`, `projects-connect`, `select`,
    `settings-health`, `toolbar`. Без правила, то есть весь `test:e2e`: `harness/.claude-plugin/` (версию видит
    каждый spec) и `harness/package.json`.
  - `src/main/link/*` без `caller.ts`, `messages.ts`, `ipc-adapter.ts`, `autopilot-runs.ts`, плюс
    `src/main/ipc/link.ts` и `linked.ts` — 12 spec-ов `linked-*`, `sidebar-sections`, `focus-sidebar`, `autopilot`.
  - Browser: `src/main/browser/*` без `read-only.ts`, `cdp.ts`, `origins.ts`; `src/main/ipc/browser.ts`;
    `src/renderer/browser/*` без `profiles.ts`; `BrowserLayer.tsx`, `browser-pages.ts`, `BrowserNode.tsx/.css`.
    Spec-и: 10 `browser*`, `linked-browser`, `controls`.
  - Отвергнуты scout-ом и мной: `src/main/terminal`, `terminal-ai` (`shell-link.ts` подключён к каждому
    terminal-у), `src/renderer/pipeline`, `src/renderer/machines`, autopilot, limits, memory.
- **Замер на последних 20 PR с кодом (#921–#949):**
  - 7 PR без e2e, как и сейчас; 8 — весь `test:e2e`: `ci.yml`, `test/quarantine.ts`, `test/fixtures`,
    `src/main/autopilot`, `src/main/agent`; 5 — подмножество (#949, #945, #941, #935, #934, все правки Harness).
  - Из 13 PR, которые сейчас гоняют e2e, подмножество получили бы 5 (38 %).
  - Такой PR гоняет 9–11 spec-ов, 125–195 s test-ов вместо 1686 s, в 1 shard-е на macOS и 1 на Windows вместо
    2 и 4.
  - Экономия — около 129 минут времени test-ов macOS на 20 PR и 5 macOS- и 15 Windows-job-ов. Самый долгий
    macOS e2e job такого PR — около 2 минут test-ов вместо 14 (плюс установка и сборка, они не меняются).
- **Проверки:** `pnpm lint`, `pnpm typecheck` — exit 0. `pnpm test` на `ci-scope-e2e`, `ci-workflow`,
  `e2e-shard`, `windows-verdict-scope` — exit 0. 14 мутантов в копии под scratchpad убиты все. gate fast и
  `ci-ok` PR-а — в отчёте implementer-а.
- **Открыто (вне этого PR):**
  - тексты Harness: правило 03 в `implementer.md`, формулировка gate full;
  - поле Profile-а со списком путей;
  - `test:package` по путям;
  - подтверждение владельцем решения выше.
