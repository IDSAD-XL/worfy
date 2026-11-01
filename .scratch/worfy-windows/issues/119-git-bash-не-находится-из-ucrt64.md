# 119 — Git Bash не находится из `git.exe` в `ucrt64\bin`

Type: task
Status: done 2026-11-01T07:06Z
PR: #1193
Branch: worfy-windows/119
Blocked by: —
Source: решение Orchestrator-а, 2026-11-01, по находке из третьего круга #1173 (windows 15). Платформенный: делает Session на ПК,
проверяет и вливает Mac (ADR-0056).

## Что происходит

В новом Git for Windows вместо `mingw64` папка `ucrt64`: так на GitHub runner (job `windows (harness-scripts 2/2)`, run 41254843327).
`findGitBash` (`src/main/agent/env.ts:509`) поднимается к корню Git только из `mingw64`. При `git.exe` в `<Git>\ucrt64\bin` он ищет
несуществующий `<Git>\ucrt64\bin\bash.exe`.

Если Git стоит не в `%ProgramFiles%\Git`, `%ProgramFiles(x86)%\Git` или `%LOCALAPPDATA%\Programs\Git` и `ucrt64\bin` стоит в Path раньше
`<Git>\cmd` и `<Git>\bin`, приложение остаётся без Git Bash, хотя он есть: смотрится только первый `git.exe`. Такой порядок даёт своим
процессам shell Git Bash. Обычная установка кладёт в Path только `<Git>\cmd`, поэтому её это не задевает. Как часто встречается этот
случай, не измерялось.

## Что делаем

- `findGitBash` считает `ucrt64` таким же уровнем, как `mingw64`.
- То же в `gitBash` (`scripts/statusline-bridge.mjs:133`): он повторяет порядок `findGitBash`.
- `harness/lib/qmd-common.cjs` уже исправлен в #1173.

Других вариантов папки (`mingw32`, `clangarm64`) не добавляем: их никто не видел на практике.

## Готово, когда

- [x] `findGitBash` находит `<Git>\bin\bash.exe` из `git.exe` в `<Git>\ucrt64\bin`; unit test.
- [x] `gitBash` в `scripts/statusline-bridge.mjs` — то же; test.
- [x] Поиск по `mingw64` в `src`, `scripts` и `harness/lib` не находит места, где `ucrt64` забыт.

## Где в коде

- `src/main/agent/env.ts` (`findGitBash`), `scripts/statusline-bridge.mjs` (`gitBash`), образец — `harness/lib/qmd-common.cjs:202`.
- `docs/adr/0057-agent-environment-on-windows.md:87` называет только `mingw64`. ADR не меняется.

## Итог

`findGitBash` и `gitBash` в `scripts/statusline-bridge.mjs` поднимаются к корню Git и из `ucrt64`, как уже делал `gitBashDir` из #1173.
Новые test-ы были красными до правки. Проверено подстановкой файлов: на ПК Git 2.45 с `mingw64`, настоящего `ucrt64` здесь нет. Запуск на
настоящем `ucrt64` был только у `gitBashDir` на GitHub runner, в CI #1173. Остальные упоминания `mingw64` — в комментариях
`scripts/eval-run-env.mjs` и shell-тестах, поиск Git Bash они не задают.

Попутно: `gitBash` не смотрел в `%ProgramFiles(x86)%\Git`, хотя его комментарий обещает порядок `findGitBash`. Добавлено с test-ом.

Остаётся: `harness/hooks/tests/gate-verdict.test.sh:323`, `gate-shim.test.sh:140`, `gate-notverified.test.sh:114` и
`harness/bin/tests/eval-env.test.sh:282` задают PATH `/usr/bin:/mingw64/bin`. В `/usr/bin` нет `git`, поэтому на Git с `ucrt64` первые три
файла пропускают свои проверки «нет node» со строкой skip; `eval-env.test.sh` не читался. В CI это не проверялось.

**Долг (low, 2026-11-01).** Из ревью #1193, не исправлено:
- `statusline-bridge.test.ts:441-442` не закрепляет порядок `ProgramFiles`, `ProgramFiles(x86)`, `LOCALAPPDATA`.
- Нет test-а с `UCRT64` в верхнем регистре: мутанты `toLowerCase` выживают в `env.ts:509` и `statusline-bridge.mjs:133`.
