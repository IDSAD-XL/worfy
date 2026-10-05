# Передача контекста — снимок на 2026-10-05, main @ 5da0b98

## Сейчас в работе

- Эпик `worfy-mvp`: 1 из 33 тикетов done, заблокированных нет (`~/.claude/bin/epic-status worfy-mvp` → `worfy-mvp 1/33`). План и таблица волн — [.scratch/worfy-mvp/spec.md](.scratch/worfy-mvp/spec.md), раздел «Волны».
- Волна 1 закрыта. Влит тикет 01 — каркас репозитория: Electron + electron-vite + React, vitest, Playwright `_electron`, ESLint с правилом границы процессов `worfy/process-boundary`, минимальный CI (job `check` на `macos-latest`: lint, typecheck, unit test) — [PR #1](https://github.com/IDSAD-XL/worfy/pull/1). Подробности и принятые решения — раздел «Итог» в [01-каркас-репозитория-и-gate.md](.scratch/worfy-mvp/issues/01-каркас-репозитория-и-gate.md).
- Gate для worfy зарегистрирован в `~/.claude/gate/config.json` (вне репозитория): `fast` = lint, typecheck, test; `full` добавляет `test:e2e`.
- Следующая волна — 2: тикеты 02, 03, 06, 09, 32. Дальше по таблице: волна 3 — 04, 07, 10, 13; волна 4 — 05; волна 5 — 08, 11, 24, 25, 27, 28, 29; волна 6 — 33; волна 7 — 12, 14, 19, 22; волна 8 — 15, 17, 18, 20; волна 9 — 16, 21, 26; волна 10 — 23, 30; волна 11 — 31.
- Модель предметной области — [CONTEXT.md](CONTEXT.md); решения — ADR 0001–0005 в [docs/adr/](docs/adr/). Номер 0006 занят тикетом 02 (ADR о контракте IPC через declaration merging).
- Дизайн: вариант F «Native frame, Graphite instrument», светлая и тёмная тема — [docs/design/F-SPEC.md](docs/design/F-SPEC.md) и макеты `F-*.dc.html` рядом; все варианты A–F — артефакт https://claude.ai/artifact/K1CotzYYUeuVK8M5ajC4uW.

## Ждёт владельца

- Обобщить skill `/ship-ticket` в `~/.claude` под проекты кроме Auction — нужно, чтобы вести сам worfy по своему workflow; вне этого репозитория. Похоже, уже сделано: skill читает профиль проекта (`~/.claude/bin/profile`), Auction в нём не упоминается, тикет 01 прошёл через него. Закрыть пункт, если согласен.
- Синхронизация состояния worfy (карточки, раскладка) с облаком — решить отдельно.
- Не проверено, тикет 01: проверка e2e test-а с удалённой строкой `app.setPath('userData', …)` запустила Electron без переопределения пути, и он записал свои файлы в настоящий `~/Library/Application Support/Electron`. Папку не удаляли: она могла существовать раньше, данных worfy в ней нет. Решить, удалять ли её.

## Риски и долги

- Agent SDK из packaged `.app`: CLI внутри asar и `PATH` GUI-приложения на macOS (тикеты 06, 07).
- Stop hook пользователя может принудительно продолжать ход сессии при красном gate (тикет 07).
- Источник лимитов: `rate_limit_event` SDK отдаёт `utilization` не всегда; поле `rate_limits` статус-строки не проверено (тикет 22).
- pnpm 11 не читает поле `pnpm` в `package.json`. Список пакетов, которым разрешены install-скрипты, — настройка `allowBuilds` в `pnpm-workspace.yaml`. Новая зависимость со скриптом, которой нет в списке, роняет `pnpm install` (`ERR_PNPM_IGNORED_BUILDS`) — её нужно явно добавить туда. `node-pty` (тикеты 27, 32) в списке уже есть.
- CI пока гоняет только lint, typecheck и unit test. e2e (`pnpm test:e2e`) и сборка `.app` проверяются только локально, до тикета 32.
- Electron 44 скачивает свой бинарник при первом запуске, а не в `pnpm install`: в CI загрузка идёт в шаге `pnpm test`, без сети unit test-ы под Electron не стартуют.
- Запись gate в `~/.claude/gate/config.json` живёт вне репозитория. Новый скрипт проверки в `package.json` (например, от тикета 32) сам в gate не попадёт — запись нужно править вручную.
- Версии ниже последних из-за совместимости: `vite` 7 (electron-vite 5 не поддерживает vite 8), `typescript` 6.0 (typescript-eslint 8.71 требует `<6.1`). Обновлять вместе.

## Дальше

- Волна 2: тикеты 02 (типизированный IPC), 03 (окно macOS, sidebar, toolbar, темы), 06 (research: Agent SDK в Electron main с настройками пользователя), 09 (research: формат реестра сессий и транскриптов Claude Code), 32 (e2e и сборка `.app` в CI, node-pty под ABI Electron). Брать параллельно.

## Где остальное

- Поведение оригинала (Morphy) — инвентари в scratchpad сессии 2026-10-05, в репозиторий не переносились (ADR 0001).
- Карта workflow пользователя: `~/Work/claude-workflow-kit/kit/MANIFEST.md`.
