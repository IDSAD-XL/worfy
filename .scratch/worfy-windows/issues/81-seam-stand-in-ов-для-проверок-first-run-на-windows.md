# 81 — Seam: проверки first-run на Windows видят stand-in-ы e2e

Type: task
Status: done 2026-10-21T08:02Z
Blocked by: 80
Source: ревью PR #665 (тикет 79), Session на Mac, 2026-10-21.

## Что происходит

`settings-health.spec.ts` и `first-run.spec.ts` строят песочницу через login shell: `$HOME/.profile`
ставит stand-in-ы `test/fixtures/first-run-tools/` первыми в PATH. На Windows проверки first-run
берут окружение из реестра (`src/main/agent/env.ts`), а не из login shell. Stand-in-ы там не
вызываются: строки — инструментов самой машины, а gh — настоящий. Поэтому тикет 79 выключил оба
spec-а на Windows целиком (`test.skip(NO_STAND_INS, …)` в `first-run.spec.ts:22` и
`settings-health.spec.ts:19`, причина — `test/e2e/first-run-sandbox.ts`).

## Что делаем

1. Seam в продукте, через который e2e направляет проверки first-run на Windows к stand-in-ам: PATH
   (или окружение целиком) для проверок вместо реестра, только при переменной, которую ставит test;
   gh — через `WORFY_GH` (тикет 80).
2. На Windows stand-in-ы — `.cmd` к Node-портам (`<tool>.mjs`), как в
   `test/contract/first-run-checks.test.ts`.
3. Убрать пропуски в `first-run.spec.ts` и `settings-health.spec.ts`; `CHECK_IDS` — с пятью проверками
   Windows (`limits`, `windows`, `arch`, `powershell`, `git-bash`) только на `win32`.
4. Убрать `test/e2e/first-run-sandbox.ts`, если больше не нужен.

## Готово, когда

- [x] На Windows `first-run.spec.ts` и `settings-health.spec.ts` — exit 0, без пропусков файла.
- [x] Watcher `gh.exe` во время прогона — 0 запусков настоящего gh.
- [x] Без переменной seam-а проверки на Windows читают реестр, как раньше (unit test).
- [ ] На macOS (Mac gate) — без изменений.
- [x] `pnpm typecheck`, `pnpm lint` — exit 0.

## Итог

Seam — stand-in реестра. Переменная `WORFY_REGISTRY_STAND_IN` у процесса worfy называет JSON-файл:
по ключу из `PERSISTENT_ENV_KEYS` — значения, как их отдаёт `RegRead` (`{ name, type, value }`).
`captureWindowsEnv` с этой переменной читает файл вместо реестра, заново при каждом снятии окружения,
и дальше строит окружение тем же кодом (Path machine;user, REG_EXPAND_SZ, Git Bash). Так seam
покрывает всё, что берёт `agentEnv()`: проверки first-run, Harness-скрипты, Sessions, Terminal Node.
Без переменной (или с пустой) реестр читает Windows PowerShell, как раньше. Как любая `WORFY_*`,
переменная не доходит до дочерних процессов. Это аналог `.profile` песочницы на macOS.

Песочница e2e — `writeSandbox` в `test/e2e/first-run-sandbox.ts`, общая для обоих spec-ов. На macOS и
Linux — как было: ссылки на shell stand-in-ы и `$HOME/.profile`. На Windows:
- `<tool>.cmd` в `bin`, которые запускают Node-порт `<tool>.mjs` node-ом test-а, как
  `test/contract/first-run-checks.test.ts`;
- `registry.json` с Path = `bin`, папка с node.exe, папки системы (cmd.exe и Windows PowerShell для
  Terminal Node), и переменными stand-in-ов;
- Harness-скрипты на Windows worfy запускает только `node.exe` с Path (`nodeOnPath`), не `.cmd`. Поэтому
  при `node` среди инструментов в папку после `bin` кладётся hard link на настоящий node.exe;
  `node --version` всё равно находит `bin\node.cmd` первым.
- `WORFY_GH` — `bin\gh.cmd`, `WORFY_CLAUDE` — `claude.mjs`.

`CHECK_IDS` — общий, на Windows с пятью строками машины на своих местах. Что на Windows отличается в
spec-ах, и почему:
- qmd: `src/main/harness/qmd.ts` не находит `qmd.cmd` на Path (тикет 15), так что строки qmd не OK, и
  qmd не вызывается (`NO_QMD`). Первый test `first-run.spec.ts` на Windows кончается после Install:
  дальше нужны строки qmd и все строки OK. А на Windows ещё две строки машины всегда Warning: Limits (у
  dev-сборки нет моста) и PowerShell (pwsh нет на Path песочницы). `settings-health.spec.ts` считает
  прогоны проверок по `jq --version` вместо `qmd --version` и ждёт `1 failed · 6 warnings`.
- Harness scripts: строку `node <profile> --help` в журнале вызовов пишет только stand-in node; на
  Windows скрипт запускает node.exe, и эта проверка журнала — не на Windows.

`NO_STAND_INS` и пропуски файлов убраны.

На ПК 2026-10-21: оба spec-а под watcher-ом `gh.exe` — 11 passed, gh.exe 0, EXIT=0. Unit/contract
(`agent-env`, `agent-env-recapture`, `harness-script-env`, `harness-script-wiring`, `first-run-windows`,
`e2e-gh-stub`, `first-run-checks`, `no-rmsync`) — 220 passed, EXIT=0. `pnpm typecheck` — 0, gate fast
зелёный.

## Где в коде

- `src/main/agent/env.ts` — `REGISTRY_STAND_IN_VAR`, `fileRegRead`, `registryReader`;
  `captureWindowsEnv` берёт `registryReader(source)`.
- `test/unit/agent-env.test.ts` — describe «the registry stand-in of WORFY_REGISTRY_STAND_IN».
- `test/e2e/first-run-sandbox.ts` — `writeSandbox`, `CHECK_IDS`, `NO_QMD`, `toolFile`, `CLAUDE_STAND_IN`.
- `test/e2e/first-run.spec.ts`, `test/e2e/settings-health.spec.ts` — песочница через `writeSandbox`.
