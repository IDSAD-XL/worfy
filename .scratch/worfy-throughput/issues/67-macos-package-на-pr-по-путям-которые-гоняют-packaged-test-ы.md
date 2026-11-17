# 67 — `macos-package` на PR по путям, код которых гоняют `@packaged` test-ы: ошибка упаковки #1898 дошла до `main`

Type: task
Status: claimed 2026-11-16T23:59Z
Blocked by: none
Source: решение владельца 2026-11-17; «Итог» Ticket-а [66](66-повторный-замер-через-неделю-после-63.md), часть 5,
эпизод 8, и заметка после части 6: «Ошибки одного PR доходили до `main`, когда job, который их ловит, на PR не шёл по
scope (`macos-package` у #1898)».

Кто: агент.

## Что происходит

Факты (2026-11-17, проверены `gh` и чтением файлов на `main` f27a868e7):

- **PR #1898** (polish 118, «Read the workflow from the Project's main branch, not the folder»), head
  `adb0674a61d592c6bf099681fec0575b5b122265`, влит commit-ом `beadca4eee14aa41dca0ba787dab6d8d698337df`. 23 файла:
  `src/main/workflow/{fetch,main-ref,reader,watch,folder,profile,release}.ts`, `src/main/docs/watch.ts`,
  `src/main/index.ts`, `src/main/ipc/{docs,tickets,workflow}.ts`, `src/renderer/shell/sidebar/EpicsSection.tsx`,
  `src/renderer/workflow/useWorkflow.ts`, `src/shared/workflow/types.ts`, три test-файла (`test/contract/`,
  `test/unit/`), `test/setup-no-remote-fetch.ts`, `vitest.config.ts`, ADR-0107, `docs/features/workflow.md`, Ticket
  118. Ни одного build input-а.
- **На head PR `macos-package` не шёл.** Единственный CI run на `adb0674a6` — 43810258276 (`pull_request`, `success`):
  `macos-package` — `skipped`, остальные job-ы — `success`. Лог job-а `changes`: «no build input, so no macos-package»
  и `expect={…"macos-package":false…}`.
- **Кто решает.** `.github/workflows/ci.yml:443–445` — job `macos-package` идёт при
  `fromJSON(needs.changes.outputs.expect)['macos-package']`. `expect` считает `scripts/ci-scope.mjs`: на PR
  `pullRequest` (`:558`) выключает `macos-package`, если ни один путь diff-а не build input (`:565–568`). Build input —
  `isBuildInput` (`:104`): множество `BUILD_FILES` (`:81–99`: зависимости, конфиги сборки, скрипты в `.app`,
  `test/e2e/packaged.spec.ts`, `terminal.spec.ts`, `helpers.ts`, `fuses.ts`, `playwright.config.ts`, `ci.yml`) и папка
  `build/` (`BUILD_FOLDERS`, `:101`). Push в `main` гоняет все job-ы.
- **Пропуск — по замыслу, а не сбой таблицы.** Комментарий `scripts/ci-scope.mjs:79–80`: «A change of src/main,
  harness/ or anything else that matters only in the packaged app is not on this list: the push to main packages the
  app whatever it changed, and catches it there.» То же держит test: `test/contract/ci-workflow.test.ts:1036–1053` —
  PR с `src/main/index.ts` и `src/renderer/App.tsx` идёт без `macos-package`; список build input-ов —
  `:1066–1092`.
- **`@packaged` test-ы идут только в `macos-package`.** `package.json:20` — `test:e2e` с `--grep-invert @packaged`,
  поэтому `macos-e2e` и `windows-e2e` их не гоняют; `package.json:21` — `test:package` с `--grep @packaged`.
- **Что упало на `main`.** Push-run 43823694243 (2026-11-16 07:25Z, первая попытка): `macos-package`,
  `test/e2e/packaged.spec.ts:770` (на `beadca4ee`) — «the Autopilot action shows "Harness in main is newer than the
  Stable copy" when origin/main has a lesson in harness/ after the build». Исправление — #1912, правит только
  `test/e2e/packaged.spec.ts` (`harnessClone`): клону test-а дан bare-репозиторий `origin` с тем же `main`. Комментарий
  #1912: «worfy fetches origin's main while a window shows the Project (ADR-0107), so origin must hold the same main».
  Пауза merge — 70 min («Итог» 66).

Догадки (не проверены):

- Причина падения: новый периодический `git fetch` из #1898 (`src/main/workflow/fetch.ts`) перезаписывал
  `refs/remotes/origin/main`, который test ставил через `update-ref` без настоящего `origin`. Основание — комментарий
  #1912 и «Итог» 66; лог run-а 43823694243 с текстом ошибки здесь не разобран.
- Код, который этот `@packaged` test гоняет: чтение `origin/main` Project-а (`src/main/workflow/`, `src/main/update/`
  — chip отставания Harness-а, `harness-lag.ts`). Узкое правило «`src/main/workflow/` → `macos-package`» поймало бы
  #1898; полный список путей, чей код гоняют `@packaged` test-ы (`test/e2e/packaged.spec.ts` и один в
  `test/e2e/terminal.spec.ts`), не составлен.

## Что делаем

1. Составить таблицу путей приложения, код которых гоняют `@packaged` test-ы и которых нет в других job-ах PR (по
   образцу `scripts/e2e-specs.table.json` для e2e или отдельным списком в `scripts/ci-scope.mjs`). Пути #1898
   (`src/main/workflow/`) — в ней. Каждая строка — с причиной (`why`), как в таблице macOS-путей.
2. `pullRequest` в `scripts/ci-scope.mjs`: PR, который трогает путь таблицы, просит `macos-package`. Остальное —
   как было: PR с одним `src/main/index.ts` или `src/renderer/App.tsx` без пути таблицы — без `macos-package`, если
   таблица его не называет (иначе поправить случай `test/contract/ci-workflow.test.ts:1036–1053` и объяснить в PR).
3. Обновить комментарий `scripts/ci-scope.mjs:68–80` и комментарий job-а `macos-package` в `.github/workflows/ci.yml`
   (`:42–45`): теперь `macos-package` идёт и по путям таблицы.

## Готово, когда

- [ ] Contract test в `test/contract/ci-workflow.test.ts`: PR с файлами #1898 (или хотя бы `src/main/workflow/fetch.ts`)
      → `expect['macos-package'] === true`. На старой таблице (`main` f27a868e7) этот test красный — показано в PR
      (вывод run-а до правки).
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts -t "PR #1898"` exit 0 (exit 1 before the change of scripts/ci-scope.mjs) · mac - · b9a18aae18ee6bfca99d6723cb5063f32f0f66bc
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts -t "ackage"` exit 0 (review round 1) · mac - · 107e82c81f7b255aadff9548fae49801902f8d98
- [ ] Contract test: каждая строка новой таблицы указывает на существующий путь, и у неё есть `why`.
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts -t "PACKAGED_PATHS"` exit 0 · mac - · b9a18aae18ee6bfca99d6723cb5063f32f0f66bc
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts -t "ackage"` exit 0; mutants that drop a row or a path are killed · mac - · 107e82c81f7b255aadff9548fae49801902f8d98
- [ ] Contract test: PR без пути таблицы и без build input-а по-прежнему без `macos-package` (случай `:1036`
      остаётся или явно изменён).
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts -t "no packaged path"` exit 0 · mac - · b9a18aae18ee6bfca99d6723cb5063f32f0f66bc
- [ ] Все unit- и contract-test-ы модуля зелёные: `test/contract/ci-workflow.test.ts`,
      `test/contract/ci-scope-e2e.test.ts`, `test/unit/affected-tests.test.ts`; gate fast — exit 0; `ci-ok` на PR
      зелёный (и `macos-package` на этом PR идёт, если PR трогает `ci.yml`).
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts test/contract/auto-approve-shell-sh.test.ts test/contract/cards-watch-edits.test.ts` exit 0 · mac - · b9a18aae18ee6bfca99d6723cb5063f32f0f66bc
  - evidence: gate pass · `gate fast` exit 0 · mac - · b9a18aae18ee6bfca99d6723cb5063f32f0f66bc
  - evidence: gate pass · `gate fast` exit 0 (review round 1) · mac - · 107e82c81f7b255aadff9548fae49801902f8d98
- [ ] В описании PR: сколько PR окна Ticket-а 66 (2026-11-09…16, PR с кодом) попросили бы `macos-package` по новой
      таблице — оценка цены в macOS-минутах.

## Где в коде

- `scripts/ci-scope.mjs` (`:68–104` — build input-ы, `:558–568` — `pullRequest`)
- `scripts/e2e-specs.table.json` (образец таблицы; только чтение) или новый файл таблицы в `scripts/`
- `.github/workflows/ci.yml` (`:42–45`, комментарий job-а `macos-package`; `:443–445` — только чтение)
- `test/contract/ci-workflow.test.ts` (`:1036–1092`)
- `test/e2e/packaged.spec.ts` (только чтение: какой код гоняют `@packaged` test-ы)

## Вне скоупа

- Гонять `macos-package` на каждом PR с кодом: это решение о минутах macOS runner-ов (ADR-0083, amendment 2026-10-28,
  «macOS job-ы PR — по путям diff»), не этот Ticket.
- Перенос `@packaged` test-ов в `macos-e2e`.
