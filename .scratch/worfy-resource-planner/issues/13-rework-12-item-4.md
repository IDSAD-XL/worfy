# 13: Rework of worfy-resource-planner 12, item 4

Type: task
Status: open
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-resource-planner 12, item 4 — 12-приёмка-с-владельцем.md

**What to build:** the owner checked item 4 of worfy-resource-planner 12 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Without a five_hour window the toolbar Limits meter still shows a "5h - no data" bar (src/shared/agent/limits.ts:358 draws both windows). Tooltip, Start dialog, Run history silent; the Run never waited.

## Что происходит

Без окна `five_hour` индикатор Limits в header всё равно рисует полосу «5h · no data». Tooltip Autopilot, окно Start и Run history о нём молчат, Run его не ждёт — лишняя только полоса.

## Где в коде

`src/shared/agent/limits.ts:358` рисует оба окна всегда; индикатор — `src/renderer/shell/toolbar/LimitsMeter.tsx`.

## Готово, когда

- [ ] (вручную) без окна `five_hour` в Limits ничего о нём не говорится и ничего его не ждёт.
