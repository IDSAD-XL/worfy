# 80 — e2e на Windows запускают настоящий `gh.exe`

Type: task
Status: done 2026-10-21T06:37Z
PR: #667
Branch: worfy-windows/80-e2e-gh-stub
Blocked by: —
Source: прогоны на ПК владельца 2026-10-21 (тикет 79, PR #665); решение Session на Mac того же дня.

## Что происходит

Правило: из test-ов настоящий gh не запускается, только stand-in (`test/fixtures/gh/gh-stub.mjs`
через `WORFY_GH`). На Windows e2e его нарушают.

- Watcher процессов `gh.exe` во время прогона `window.spec.ts` (ветка тикета 79) увидел 4 запуска:
  `gh --version` и `gh auth status` от двух процессов `electron.exe` приложения под test-ом.
- `settings-health.spec.ts` и `first-run.spec.ts` на Windows запускали те же команды: проверки first-run
  (`src/main/first-run/checks.ts`, строки gh и GitHub accounts) ищут gh по PATH и не смотрят на
  `WORFY_GH`, а на Windows этот PATH — из реестра, с настоящим gh. Эти два spec-а тикет 79 выключил
  на Windows (тикет 81 вернёт их).
- В прогонах 2026-10-21 на ПК настоящий gh так запускался несколько раз: PR #661, main `85cec301` и
  ветка тикета 79 (`window.spec.ts`, `settings-health.spec.ts`, `first-run.spec.ts`). Только
  `gh --version` и `gh auth status`: команды, которые ничего не меняют и не запускают Actions.
  Вреда нет, но правило нарушено.

`launchApp` ставит `WORFY_GH` на stub и `WORFY_FIRST_RUN_AUTO=0`. Кто делает 4 запуска из
`window.spec.ts` при этих переменных — выяснить в этом тикете. Возможная причина:
`src/main/github/accounts.ts` на Windows требует от `WORFY_GH` полный путь к `gh.exe`.

## Что делаем

1. Найти, какой код запускает gh в обход stub-а в e2e на Windows, и закрыть каждый путь.
2. Все запуски приложения в e2e — через `WORFY_GH` на stub, и все места worfy, что запускают gh,
   слушают `WORFY_GH`.
3. Guard test, который падает, если запуск приложения в e2e может дойти до настоящего `gh.exe`.

## Готово, когда

- [x] Названо, что запускало gh в `window.spec.ts`, и этот путь закрыт.
- [x] Guard test: красный, если e2e запускает приложение без stub-а gh или если код worfy запускает
      gh в обход `WORFY_GH`; мутанты фикса — красные.
- [x] На Windows прогон `window.spec.ts` под watcher-ом `gh.exe` — 0 запусков настоящего gh.
- [x] `pnpm typecheck`, `pnpm lint` — exit 0.

## Вне скоупа

- Seam, чтобы проверки first-run на Windows видели stand-in-ы остальных инструментов, и включение
  `settings-health.spec.ts` и `first-run.spec.ts` на Windows — тикет 81.

## Итог

Причина — два пути, оба закрыты.

- `window.spec.ts` (2 запуска) и `packaged.spec.ts` (2 запуска) запускали Electron сами, через `spawn`,
  и собирали env вручную: без `WORFY_FIRST_RUN_AUTO=0`. Приложение открывало экран first-run, и его
  проверки запускали gh. Теперь эти запуски берут env из `directStartEnv` (`test/e2e/launch-env.ts`):
  те же переменные изоляции, что `launchEnv` у Playwright (`WORFY_GH` на stub, first-run выключен).
- Проверки first-run (`src/main/first-run/checks.ts`) запускали gh по имени из PATH и не смотрели на
  `WORFY_GH`. Теперь обе строки gh (`--version`, `auth status`) идут через `programStart`, как
  `ghRunner` в `src/main/github/prs.ts`. Окружение: login shell поверх окружения самого worfy, так что до
  stand-in-а доходят и настройки из `.profile` sandbox-а, и переменные, что есть только у worfy.
  `src/main/ipc/first-run.ts` передаёт `ghOverride(process.env)` (пустой `WORFY_GH` = не задан).
  Полный путь на Windows читает одно правило, `windowsProgramPath` в `src/main/program.ts`, и для
  проверок, и для «Sign in with gh» (`src/main/github/accounts.ts`). `first-run.spec.ts` и
  `settings-health.spec.ts` ставят `WORFY_GH` на свой gh из sandbox, чтобы на macOS их поведение
  не изменилось.

Guard test `test/unit/e2e-gh-stub.test.ts`:
- каждый запуск приложения в e2e получает stub gh: Electron от Playwright только в `helpers.ts`, а
  каждый процесс, который spec запускает по вычисленному пути, — известный инструмент или приложение
  с env из `directStartEnv` (любой API child_process, любая папка `test/e2e`);
- в `src/main` нет запуска gh по голому имени, а места, где выбирается программа gh, — известный
  список, все через `WORFY_GH`.
Плюс describe «the gh rows and WORFY_GH» в `test/unit/first-run-windows.test.ts`. Мутанты красные:
без `gh` в ipc, gh по имени в checks.ts, `spawn` без `directStartEnv`, env spec-а собран вручную,
строки gh с окружением login shell.

Намеренное исключение: `gh auth login` действия «Sign in…» экрана first-run (`checks.ts`,
`actions.ts`). worfy печатает эту команду в Terminal Node, и запускает её shell пользователя, а не worfy.

На ПК 2026-10-21, ветка тикета: gate fast exit 0; unit-тесты зелёные. `window.spec.ts` и
`projects-connect.spec.ts` под watcher-ом `gh.exe`: 0 запусков gh. `window.spec.ts` зелёный.

Дальше, отдельным тикетом: одна функция `appGh()` для всех четырёх мест, что читают `WORFY_GH`
(`src/main/ipc/checks.ts`, `projects.ts`, `gate-queue.ts`, `first-run.ts`).

Заметка: 3 test-а `projects-connect.spec.ts` (`:73`, `:230`, `:294`) на Windows падают — экран
connect-project показывает стадию `harness`, а не `form`. Так же они падают на базе (ветка тикета 79),
тоже с 0 запусков gh: тикет 80 их не вызывает, это отдельная проблема Windows.
