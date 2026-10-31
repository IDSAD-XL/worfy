# 02 — Autopilot из чата — тот же Run, что кнопкой?

Type: research
Status: done 2026-10-31T22:15Z
Blocked by: —
Source: [map.md](../map.md), пожелание владельца в ответе 01

## Question

Создаёт ли Autopilot, запущенный из чата Session (команда `/worfy:epic-wave …`), тот же Run, что кнопка Autopilot: тот же файл Journal, те же события `run-started` / `wave-started` / `run-stopped`, ту же строку статуса на Canvas? Какие ещё пути запуска есть и чем они отличаются? Что показывает интерфейс в момент остановки Run — туда встанет предложение посмотреть историю.

## Answer

Нет. Run создаёт только кнопка Autopilot. Разведка 2026-11-01, все места проверены чтением кода:

| Путь запуска | Run и Journal | Строка статуса |
|---|---|---|
| Кнопка Autopilot (`AutopilotAction.tsx:173` → `Autopilot.start`, `src/main/autopilot/run.ts:626`) | да: `openRun` (единственный вызов — `src/main/ipc/autopilot.ts:165`) пишет `run-started`, дальше `wave-started`, `run-stopped` | да |
| «Run wave» в Command palette или на Canvas (`src/main/actions/launch.ts:216`, `sendWave(…, autopilot=false)`) | нет | нет |
| `/worfy:epic-wave …` руками в чате Session, Orchestrator сам, skill Harness | нет | нет |

Чат-запуск видно только как привязку агента к Epic (`skillRule('epic-wave')`, `src/shared/binding/resolve.ts:215`). Кроме Journal, кнопка делает то, чего чат-запуск не делает: держит Machine бодрой, ждёт Limits и background tasks, ведёт узкий круг исправления, обрабатывает очередь gate, продолжает Wave после Force stop.

Остановка Run (15 причин, `src/shared/autopilot/cycle.ts:38-54`) идёт через `Autopilot.end` (`run.ts:1375`). Интерфейс показывает только строку статуса `stopped: <причина>` над кнопкой (`AutopilotAction.tsx:366`). Toast, уведомления и ссылки нет. Предложение посмотреть историю встанет либо в `end()`/`publish`, либо в подписчик `AutopilotAction.tsx:145`. Читателя Journal для интерфейса нет: `listRuns`/`readRun` (`src/main/autopilot/journal.ts:156`, `:184`) не вызываются.

Предположение «из чата уже работает как кнопка» не подтвердилось. Отсюда новый вопрос 09.
