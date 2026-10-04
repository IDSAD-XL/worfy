# Передача контекста — снимок на 2026-10-05, main @ первый коммит, кода ещё нет

## Сейчас в работе

- Эпик `worfy-mvp` нарезан: 33 тикета, 11 волн, все `open` — [.scratch/worfy-mvp/spec.md](.scratch/worfy-mvp/spec.md). Первый в очереди — 01, каркас репозитория.
- Модель предметной области — [CONTEXT.md](CONTEXT.md); решения — ADR 0001–0005 в [docs/adr/](docs/adr/).
- Дизайн выбран: вариант F «Native frame, Graphite instrument», светлая и тёмная тема — [docs/design/F-SPEC.md](docs/design/F-SPEC.md) и макеты `F-*.dc.html` рядом; все варианты A–F — артефакт https://claude.ai/artifact/K1CotzYYUeuVK8M5ajC4uW.

## Ждёт владельца

- Обобщить skill `/ship-ticket` в `~/.claude` под проекты кроме Auction (сейчас завязан на пути и деплой Auction) — нужно, чтобы вести сам worfy по своему workflow; вне этого репозитория.
- Синхронизация состояния worfy (карточки, раскладка) с облаком — решить отдельно.

## Риски и долги

- Agent SDK из packaged `.app`: CLI внутри asar и `PATH` GUI-приложения на macOS (тикеты 06, 07).
- Stop hook пользователя может принудительно продолжать ход сессии при красном gate (тикет 07).
- Источник лимитов: `rate_limit_event` SDK отдаёт `utilization` не всегда; поле `rate_limits` статус-строки не проверено (тикет 22).

## Дальше

- Взять тикет 01 (каркас репозитория, gate fast).

## Где остальное

- Поведение оригинала (Morphy) — инвентари в scratchpad сессии 2026-10-05, в репозиторий не переносились (ADR 0001).
- Карта workflow пользователя: `~/Work/claude-workflow-kit/kit/MANIFEST.md`.
