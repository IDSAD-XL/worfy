# 61 — `macos-tests` в PR только по путям macOS

Type: task
Status: done 2026-11-05T21:39Z
PR: #1459
Branch: worfy-throughput/61
Blocked by: —
Source: решение владельца 2026-11-05, round-2 Q7 («да»): в pull request CI job `macos-tests` идёт, только когда
PR трогает пути macOS; push в `main` по-прежнему гоняет всё. Продолжение Ticket-а
[54](54-меньше-pr-на-полном-наборе-e2e-macos.md) (узкие триггеры macOS-job-ов).

Номер: бриф Orchestrator-а назвал этот Ticket 60, но номер 60 уже занят
([60](60-переключатель-eco-mode-в-чате-orchestrator-а.md), done) — взят следующий свободный, 61.
Ветка — `worfy-throughput/61` (шаблон `tickets.branch` Profile-а) вместо `throughput-60-macos-tests-by-paths` из
брифа. Решено без владельца, подтвердить.

## Что происходит

- `scripts/ci-scope.mjs` (функция `pullRequest`, около строк 498–507) просит `macos-tests` для PR, когда diff
  трогает приложение (`isAppPath`: весь `src/`, e2e test-ы, `harness/`, который несёт приложение), любой файл
  `scripts/`, `harness/`, `test/fixtures/`, способ запуска vitest (`TEST_RUNNER`) или macOS-only test-файл.
- Почти любой PR с кодом трогает `src/` или `scripts/`, поэтому `macos-tests` идёт почти в каждом PR. Это один
  macOS runner из 5, которые бесплатный план даёт на весь account; очередь macOS runner-ов — главная часть
  времени по стене PR (замеры Ticket-ов 54 и 58).
- Сам job в PR гоняет только macOS-only test-файлы (`darwinTestFiles`, output `macos-tests-files`) — те, где есть
  test или assertion только для macOS. Linux и Windows job-ы гоняют всё остальное.
- Комментарии `.github/workflows/ci.yml` (строки 9–12, 29–31, 58–62 и над шагом job-а `macos-tests`) описывают
  сегодняшнее правило.

## Что делаем

1. **Пути macOS — данными, в одном месте** `scripts/ci-scope.mjs`: таблица `MACOS_PATHS` (glob-ы и причина каждой
   строки, как `scripts/e2e-specs.table.json`) и правило имени. Путь macOS — это:
   - macOS-only test-файл (тот же список `darwinTestFiles`, что идёт в `macos-tests-files`);
   - путь, в имени файла или папки которого есть слово `darwin`, `mac`, `macos` или `osx` (отдельным словом между
     `/`, `.`, `-`, `_`);
   - упаковка и подпись: `build/**`, `electron-builder.yml`, файлы `*entitlements*`, `*notariz*`, `*notaris*`;
   - модули, у которых есть код только для macOS, и его проверяет macOS-only test на настоящем macOS: инструменты
     macOS (`sips`, `iconutil`, `ps`, Launch Services, Info.plist, `git` из Xcode), меню приложения, Dock, Finder,
     login shell `zsh` и `$SHELL -l` терминала, watcher-ы на chokidar (на macOS — FSEvents) и на `fs.watch` с
     правилом macOS для удалённого root, platform package SDK, копия `worfy-stable.app`, имя Mac в записи падения
     gate; helper-ы и fixture-ы, которые читают macOS-only test-ы;
   - каждый macOS-only test-файл назван в причине (`why`) строки таблицы или стоит в списке
     `MACOS_TESTS_CHECKED_OTHERWISE` с причиной (contract test держит это в синхроне);
   - CI workflow (`.github/workflows/ci.yml` — по прежнему правилу `ciPackaging`) и сам `scripts/ci-scope.mjs`;
     способ запуска vitest (`vitest.config.ts`, `scripts/vitest-electron.mjs`); зависимости (`package.json`,
     lockfile, `pnpm-workspace.yaml`, `scripts/postinstall.mjs`: нативные пакеты собираются под macOS).
2. PR, который не трогает ни один путь macOS, не получает `macos-tests`. Push в `main`, запуск вручную, diff,
   который нельзя прочитать, BASE из нулей и пустой diff — как сегодня: все job-ы, весь набор.
3. Список macOS-only test-файлов, который нельзя прочитать или назвать одним словом, — как сегодня: `macos-tests`
   с каждым файлом.
4. Логика `macos-e2e`, `windows-e2e` и `macos-package` не меняется: у них своё условие (`isAppPath`,
   `isBuildInput`), с путями macOS оно не общее.
5. Комментарии `ci.yml` — под новое правило; шаги и job-ы `ci.yml` не меняются.

## Готово, когда

- [ ] PR только с правкой приложения (например `src/renderer/App.tsx`) — без `macos-tests`; e2e как раньше.
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts` exit 0 · mac - · e3e0eee44efbcd9b9144e8c24d8af17f7275cbcd
  - evidence: review pass · PR #1459 · - - · 7668cd17327cc5ba737cbecf7466c4d1109eaff7
- [ ] PR с macOS-only test-файлом — `macos-tests` с этим файлом в `macos-tests-files`.
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts` exit 0 · mac - · e3e0eee44efbcd9b9144e8c24d8af17f7275cbcd
  - evidence: review pass · PR #1459 · - - · 7668cd17327cc5ba737cbecf7466c4d1109eaff7
- [ ] PR с исходником, в имени которого `darwin` (или `mac`, `macos`), — `macos-tests`.
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts` exit 0 · mac - · e3e0eee44efbcd9b9144e8c24d8af17f7275cbcd
  - evidence: review pass · PR #1459 · - - · 7668cd17327cc5ba737cbecf7466c4d1109eaff7
- [ ] PR с модулем из таблицы `MACOS_PATHS` — `macos-tests`; каждый glob таблицы без `*` — существующий файл
      репозитория (contract test).
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts` exit 0 · mac - · e3e0eee44efbcd9b9144e8c24d8af17f7275cbcd
  - evidence: review pass · PR #1459 · - - · 7668cd17327cc5ba737cbecf7466c4d1109eaff7
- [ ] Push в `main` — все job-ы; diff, который нельзя прочитать, — все job-ы (test-ы на оба случая).
  - evidence: test-run pass · `pnpm test test/contract/ci-workflow.test.ts test/contract/ci-scope-e2e.test.ts test/unit/affected-tests.test.ts` exit 0 · mac - · e3e0eee44efbcd9b9144e8c24d8af17f7275cbcd
  - evidence: review pass · PR #1459 · - - · 7668cd17327cc5ba737cbecf7466c4d1109eaff7
- [ ] Test-ы `test/contract/ci-workflow.test.ts` (раздел `scripts/ci-scope.mjs`), `test/contract/ci-scope-e2e.test.ts`,
      `test/unit/affected-tests.test.ts` — exit 0; gate fast — `[gate] green (fast)`, exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · e3e0eee44efbcd9b9144e8c24d8af17f7275cbcd
  - evidence: review pass · PR #1459 · - - · 7668cd17327cc5ba737cbecf7466c4d1109eaff7
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42113317831/job/127550220489 · ci - · 7668cd17327cc5ba737cbecf7466c4d1109eaff7

## Тесты

- `test/contract/ci-workflow.test.ts`, `describe('scripts/ci-scope.mjs')` — новые случаи из «Готово, когда» и
  правка ожиданий существующих: PR с приложением, `scripts/` или `harness/` больше не получает `macos-tests`.

## Где в коде

- `scripts/ci-scope.mjs` — `pullRequest` (условие `macos-tests`), `TEST_RUNNER`, `CHECKED_FOLDERS`, новая таблица
  `MACOS_PATHS`, комментарий в начале файла.
- `.github/workflows/ci.yml` — только комментарии (верх файла и job `macos-tests`).
- `test/contract/ci-workflow.test.ts` — test-ы `scripts/ci-scope.mjs`.

## Вне скоупа

- Логика `macos-e2e`, `windows-e2e`, `macos-package`, shard-ы и runner-ы.
- Карта «модуль → test-ы по импортам» (`scripts/affected-tests.mjs` нужны зависимости, а `ci-scope.mjs` идёт до
  install) — таблица явная.

## Решения без владельца

- Номер 61 и ветка `worfy-throughput/61` вместо 60 и `throughput-60-macos-tests-by-paths` (номер 60 занят). Решено
  без владельца, подтвердить.
- Зависимости (`package.json`, lockfile, `pnpm-workspace.yaml`, `scripts/postinstall.mjs`) и способ запуска vitest
  считаются путями macOS: нативные пакеты (`node-pty` под Electron, `fsevents`) собираются под macOS, а такие PR
  уже идут на macOS-job `macos-package`. Решено без владельца, подтвердить.
- Watcher-ы — пути macOS: на chokidar (`src/main/cards/store.ts`, `src/main/workflow/watch.ts`,
  `src/main/claude-home/registry.ts`, `src/main/link-safe-watch.ts`, `src/main/chokidar-close.ts`; на macOS —
  FSEvents) и на `fs.watch` (`src/main/watch-gone.ts`, `src/main/docs/watch.ts`, `src/main/ipc/docs.ts`): их
  macOS-only test-ы (`cards-watch-edits`, `tickets-chokidar`, `docs-watch-root`, `docs`) проверяют это до merge.
  Решено без владельца, подтвердить.
- Модули с веткой `platform === 'darwin'`, которую Linux test-ы проверяют подставленным `platform`
  (`src/shared/shortcuts.ts`, `src/main/window-frame.ts`, `src/main/agent/auto-approve/policy.ts` и др.), путями
  macOS не считаются. Решено без владельца, подтвердить.
- После ревью 1 добавлены строки `src/main/terminal/pty.ts`, `src/main/ipc/terminal.ts`,
  `src/main/vendors/claude/options.ts`, `src/main/update/restart.ts`, `harness/hooks/gate-failures.mjs` и helper-ы
  `test/contract/terminal-harness.ts`, `test/remove.ts`, `test/time-scale.ts`, `test/fixtures/eval-stub/**`.
  `console-request.test.ts`, `terminal-console.test.ts` и `ci-workflow.test.ts` стоят в
  `MACOS_TESTS_CHECKED_OTHERWISE`: их `darwin` — параметр `it.each` или текст регулярного выражения, и их случаи
  идут на Linux тоже. Решено без владельца, подтвердить.

## Итог

- Известные пробелы, оставленные по решению ревью 1. `MACOS_NAME` не видит слово в camelCase: `macMenu.ts` и
  `darwinDock.ts` — не пути macOS, а `mac-menu.ts` и `MacOS.tsx` — пути macOS. Ложное срабатывание:
  `test/quarantine/ci-scope-e2e-imports-run-macos-e2e.json` — путь macOS по слову `macos`, так что правка этой
  записи карантина запускает `macos-tests`.
