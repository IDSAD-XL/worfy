# 79 — e2e `window.spec.ts` и `settings-health.spec.ts` падают на Windows

Type: task
Status: claimed 2026-10-21T06:04Z
Branch: worfy-windows/79-e2e-windows
Blocked by: —
Source: прогон PR #661 на ПК владельца 2026-10-21; те же 5 падений на main `85cec301`; Session на Mac
попросила завести тикет. Строки — на main `85cec301`.

## Что происходит

`playwright test test/e2e/window.spec.ts test/e2e/settings-health.spec.ts --grep-invert @packaged`
на Windows (1 worker) — 4 passed, 5 failed, одинаково на PR #661 и на main.

1. `settings-health.spec.ts:126`, `:191`, `:296` — `[data-check]`: ждут 15, на экране 20. `CHECK_IDS`
   в spec-е — список macOS и Linux, а на Windows `CHECKS` (`src/main/first-run/checks.ts`) добавляет
   пять проверок: `limits`, `windows`, `arch`, `powershell`, `git-bash` (worfy-windows ticket 13).
   За счётом стоит вторая причина: на Windows проверки берут окружение из реестра
   (`src/main/agent/env.ts`), а не login shell, который строит песочница spec-а (`$HOME/.profile`,
   `/bin/sh`). Stand-in-ы `test/fixtures/first-run-tools/` там не вызываются: лог вызовов пуст,
   статусы — инструментов самой машины. `:126` проверяет статусы и число прогонов проверок по логу,
   `:191` — прогон проверок после Esc по логу.
2. `window.spec.ts:164` — `window.getWindowButtonPosition is not a function`. Этот метод есть только на
   macOS; на Windows и Linux у окна системная рамка с заголовком (`src/main/window-frame.ts`), то есть
   то, что test проверяет, там и не задумано.
3. `window.spec.ts:218` — `EBUSY ... unlink ...\worfy-data-*\declarative_performance_observer.db-journal`
   при удалении папки данных. `launched.app.process()` на Windows — `cmd.exe`, через который Playwright
   запускает Electron; `kill('SIGKILL')` убивал только его, приложение продолжало работать и держать
   папку данных.


## Что делаем

1. `settings-health.spec.ts` и `first-run.spec.ts` не идут на Windows: `test.skip` в начале файла с
   причиной из нового `test/e2e/first-run-sandbox.ts`. Ревью (2026-10-21) нашло, что на Windows проверки
   этих spec-ов не просто видят инструменты машины, а запускают настоящий `gh.exe` (`gh --version`,
   `gh auth status`): `tool('gh')` и `gh-auth` в `src/main/first-run/checks.ts` ищут gh по PATH из
   реестра и не смотрят на `WORFY_GH`. Правило — из test-ов настоящий gh не запускать, поэтому
   пропускается весь spec, а не только утверждения про stand-in-ы. `CHECK_IDS` с пятью
   Windows-проверками понадобится, когда появится seam (см. «Вне скоупа»).
2. `window.spec.ts:164` — только macOS (`test.skip` с причиной).
3. `window.spec.ts:218` — приложение завершается через `endApp` из `test/e2e/end-app.ts`: SIGKILL по
   PID самого приложения, потом по процессу Playwright, и ожидание, пока процесс приложения исчезнет.
   `test/e2e/helpers.ts` не меняется.

## Готово, когда

- [x] На Windows `window.spec.ts` — exit 0, `:164` пропущен; `settings-health.spec.ts` и
      `first-run.spec.ts` пропущены целиком.
- [x] `window.spec.ts:218` — 3 прогона подряд зелёные; со старым кодом — снова `EBUSY`.
- [x] `pnpm typecheck`, `pnpm lint`, gate fast — exit 0; `no-rmsync`, `e2e-no-spawn-on-load`,
      `check-cyrillic` — exit 0.
- [ ] На macOS (Mac gate) — без изменений: ни один из трёх spec-ов там не пропускается.

## Вне скоупа

- Seam, через который e2e направляет проверки first-run на Windows к stand-in-ам (и к gh-stub), чтобы
  `settings-health.spec.ts` и `first-run.spec.ts` шли и там. Это изменение продукта, отдельный тикет.
- Настоящий `gh.exe` запускают и другие e2e на Windows: при прогоне `window.spec.ts` после этой правки
  watcher увидел 4 запуска (`gh --version` и `gh auth status` от двух процессов electron.exe), хотя
  `launchApp` ставит `WORFY_GH` на `gh-stub.mjs`, а `WORFY_FIRST_RUN_AUTO=0` выключает проверки на
  старте. Кто их делает — не выяснено. Возможная причина: `src/main/github/accounts.ts` на Windows
  требует от `WORFY_GH` полный путь к `gh.exe`. Отдельный тикет; до него e2e на Windows не гонять.

## Итог

### Закрытие (2026-10-21)

Прогон на ПК, ветка `worfy-windows/79-e2e-windows` от main `85cec301`:

- `window.spec.ts`, `settings-health.spec.ts`, `first-run.spec.ts` (`--grep-invert @packaged`, 1 worker):
  exit 0, 5 passed, 12 skipped. До правки на main: `window.spec.ts` + `settings-health.spec.ts` — 4
  passed, 5 failed; `first-run.spec.ts` — 8 failed (тот же счёт 20 против 15 и stand-in-ы не вызываются).
- `window.spec.ts:218` с правкой — 3 из 3 зелёных (`--repeat-each 3`); со старым кодом — `EBUSY` на
  `declarative_performance_observer.db-journal`.
- Ревью (lens: корректность test-ов): находка [med] про настоящий gh — исправлена пропуском spec-ов
  целиком; [low] — если `endApp` откажет (приложение пережило SIGKILL), `removeDir` в `finally` может
  заменить его сообщение своим `EBUSY`; оставлено.
