# 53 — Updater ставит сборку старее работающей и отказывает в установке на «Restart now»

Type: bug
Status: open
Blocked by:
Source: владелец 2026-11-04 («опять»), приёмка worfy-multi-vendor 32 на Mac Stable; журналы updater-а в
`~/Library/Application Support/worfy/update/` (`state.json`, `restart.json`, `restart.log`)

## Что происходит

Две ошибки встроенного updater-а (`src/main/update/`, helper установки `scripts/install-stable.mjs`), подряд в
одной смене Stable 2026-11-04:

**A. Откат на старую сборку.** Updater собрал 0.3.1399 (commit `6580cba7`), пока работала копия `460fb561`. Затем
Stable заменили снаружи на `b09dfab0` (новее: `6580cba7` — его предок). Через четыре минуты updater поставил свою
готовую сборку `6580cba7` поверх `b09dfab0`: `worfy-stable.json` получил `source` из `update/repo/dist`. Проверка
«head впереди работающей копии» (`src/main/update/check.ts`, `compare(...) !== 'ahead'`) идёт при поиске
обновления, но не перед установкой уже готовой сборки: работающая копия могла смениться после сборки.

**B. Отказ на «Restart now».** Сразу после этого updater нашёл и собрал 0.3.1403 (`b09dfab0`). «Restart now»
закрыл worfy, но `install-stable` ответил «the stable copy at … is running. Quit it (stop Autopilot first, or wait
for the gap between waves)…», и worfy открылся снова на старой копии. В `restart.log` — процесс Claude Code одной
из Session (`app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude --resume=…`): он
ещё завершался, когда главный процесс worfy уже вышел. `install-stable` ждёт только `--wait-pid` (главный процесс,
`waitForExit`), а потом один раз проверяет все процессы копии (`refuseIfRunning`) — дочерним процессам Session не
даётся времени выйти. Внешний скрипт смены Stable, который ждёт выхода всех процессов копии (до 3 минут), ставит
ту же сборку с первой попытки.

## Что делаем

1. Перед установкой готовой сборки (restart и idle restart) — тот же вопрос, что при поиске: сборка впереди
   commit-а копии, которая работает сейчас? Если нет (равна, старее, разошлась) — не ставить, сборку отбросить,
   тост убрать; в `state.json` — причина.
2. `install-stable` после выхода `--wait-pid` ждёт с пределом (например, тот же `WAIT_LIMIT_MS`), пока не выйдут
   все процессы копии, и только потом отказывает; отказ называет pid и команду того, что осталось.
3. Тост отказа не обрезает самое важное: что делать дальше видно целиком (сейчас обрезано на «wait for the g…»).

Глубина review — `medium`. Платформенный: helper установки и поиск процессов работают на macOS и Windows —
Windows-часть `install-stable` проверяется на ПК.

## Готово, когда

- [ ] Unit test restart-а: готовая сборка, чей sha — предок работающего commit-а, не ставится; причина в state.
- [ ] Unit test `install-stable`: дочерний процесс копии, который выходит через несколько секунд после
      `--wait-pid`, не даёт отказа; процесс, который не выходит до предела, — даёт отказ с его pid.
- [ ] Все unit и contract test-ы `src/main/update/` и `scripts/install-stable.mjs`, `pnpm typecheck`,
      `pnpm lint` — exit 0.
