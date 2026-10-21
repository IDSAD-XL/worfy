# 81 — Seam: проверки first-run на Windows видят stand-in-ы e2e

Type: task
Status: open
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

- [ ] На Windows `first-run.spec.ts` и `settings-health.spec.ts` — exit 0, без пропусков файла.
- [ ] Watcher `gh.exe` во время прогона — 0 запусков настоящего gh.
- [ ] Без переменной seam-а проверки на Windows читают реестр, как раньше (unit test).
- [ ] На macOS (Mac gate) — без изменений.
- [ ] `pnpm typecheck`, `pnpm lint` — exit 0.
