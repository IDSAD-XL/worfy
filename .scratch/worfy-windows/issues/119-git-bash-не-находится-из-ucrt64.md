# 119 — Git Bash не находится из `git.exe` в `ucrt64\bin`

Type: task
Status: claimed 2026-11-01T02:26Z
Branch: worfy-windows/119
Blocked by: —
Source: решение Orchestrator-а, 2026-11-01, по находке из третьего круга #1173 (windows 15). Платформенный: делает Session на ПК,
проверяет и вливает Mac (ADR-0056).

## Что происходит

В новом Git for Windows вместо `mingw64` папка `ucrt64`: так на GitHub runner (job `windows (harness-scripts 2/2)`, run 41254843327).
`findGitBash` (`src/main/agent/env.ts:509`) поднимается к корню Git только из `mingw64`. При `git.exe` в `<Git>\ucrt64\bin` он ищет
несуществующий `<Git>\ucrt64\bin\bash.exe`.

Если Git стоит не в `%ProgramFiles%\Git`, `%ProgramFiles(x86)%\Git` или `%LOCALAPPDATA%\Programs\Git` и в Path нет `<Git>\cmd` или
`<Git>\bin`, приложение остаётся без Git Bash, хотя он есть. Обычная установка кладёт в Path `<Git>\cmd`, поэтому её это не задевает.
Как часто встречается случай с одной только `ucrt64\bin` в Path, не измерялось.

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
