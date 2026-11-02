# 03 — Codex: Limits подписки

Type: research
Status: open
Blocked by:
Source: [map.md](../map.md), Ticket 01

## Question

Какие окна лимита подписки ChatGPT действуют для Codex (длительности, сброс, планы Plus / Pro / Business), и откуда worfy может их узнать: событие в потоке Session (аналог `rate_limit_event` с `five_hour` / `seven_day`, `src/shared/agent/events.ts:364`), запрос без траты лимита (аналог пробы `src/main/agent/limits-usage.ts`), файл, команда `/status`? Что Codex делает, когда лимит кончился (ошибка, ожидание, время сброса — аналог `src/shared/autopilot/resume-at.ts`)? Хватит ли этих данных Autopilot-у (бюджет Wave) и Resource Planner-у (прогноз доли окна)?
