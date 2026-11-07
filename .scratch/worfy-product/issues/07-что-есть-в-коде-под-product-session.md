# 07 — Что есть в коде под Product Session

Type: research
Status: done 2026-11-07T18:50Z
Blocked by: 05
Source: [map.md](../map.md), решение 05

## Question

Что в worfy уже есть, на чём Product Session с живой Mind map может стоять, и чего не хватает?

## Answer

Исследование — [`docs/research/2026-11-07-product-session-основа.md`](../../../docs/research/2026-11-07-product-session-основа.md), влито в #1586. Только чтение кода; приложение не запускалось. Коротко:

- Вида Session нет. Orchestrator — булево поле `orchestrator`, и оно выбирает лишь окно autocompact. Product Session нужно новое поле вида.
- Layout один на все Session; правая колонка зафиксирована на 300px; общего разделителя нет — его надо завести.
- Hook `SessionStart` Harness-а кладёт правила Orchestrator-а в каждую главную Session без условий. Пока он не умеет выбирать набор правил по виду Session, Product Session получит и их.
- Ограничения tools по пути сегодня нет: главная Session не передаёт ни `allowedTools`, ни `disallowedTools`. Границу «пишет только `docs/product/`» может обеспечить только PreToolUse hook.
- Набор `mind_map_*` строится по образцу `worfy-canvas`: zod-схемы, одна таблица handler-ов, нейтральное описание `McpServer`, которое умеют оба Vendor-а.
- Watcher документов уже держит рекурсивный watch корня Project-а, но события вне HANDOFF и ADR отбрасывает по имени. Расширить его дешевле, чем заводить новый.
- Card работает только как прототип: файлы Project-а она не читает.
- Оценка — 14–17 Ticket-ов в четырёх частях: Harness, вид Session и ограничения, tool и файл Mind map, экран. Wave-ы Harness не зависят от остальных.
