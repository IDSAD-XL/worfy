# 13: Rework of worfy-resource-planner 12, item 4

Type: task
Status: claimed 2026-11-24T23:32Z
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-resource-planner 12, item 4 — 12-приёмка-с-владельцем.md

**What to build:** the owner checked item 4 of worfy-resource-planner 12 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Without a five_hour window the toolbar Limits meter still shows a "5h - no data" bar (src/shared/agent/limits.ts:358 draws both windows). Tooltip, Start dialog, Run history silent; the Run never waited.

## Что происходит

Без окна `five_hour` индикатор Limits в header всё равно рисует полосу «5h · no data». Tooltip Autopilot, окно Start и Run history о нём молчат, Run его не ждёт — лишняя только полоса.

## Где в коде

`src/shared/agent/limits.ts:358` рисует оба окна всегда; индикатор — `src/renderer/shell/toolbar/LimitsMeter.tsx`.

## Готово, когда

- [x] Источники Limits различают «окна нет» и «данных ещё нет»: только ответ usage request перечисляет окна плана; окно,
      которого в нём нет или оно `null`, — окна нет (`absentAt`, в `limits.json` — `absent`). SDK `rate_limit_event` и
      status line опускают и окно без данных, поэтому по ним окно остаётся «no data». Unit
      `test/unit/limits.test.ts`, «a plan without the five_hour window»: красный на origin/main 61111661c, зелёный здесь.
- [x] Полоса рисуется только для окон плана: без `five_hour` — одна полоса 7-day; с окном, но без данных — полоса
      «no data» остаётся. Unit `test/unit/limits.test.ts`, `test/unit/limits-meter.test.tsx`.
- [x] Более новое «окна нет» убирает известное раньше окно, более старое — нет; данные новее возвращают окно, старее —
      отбрасываются; повтор того же ответа не переписывает `limits.json`. Unit `test/unit/limits.test.ts`.
- [x] `absent` переживает перезапуск и доходит до окна через `limits.open`. Contract `test/contract/limits.test.ts`.
- [x] Собранное приложение с `limits.json` без `five_hour` рисует только 7-day, без «no data»; снимки в обеих темах —
      `../evidence/13/limits-no-five-hour-light.png`, `../evidence/13/limits-no-five-hour-dark.png`. E2e
      `test/e2e/limits.spec.ts`.
- [x] Страница `docs/features/transcripts-and-usage.md` (раздел Limits) описывает окно, которого нет в плане.
- [ ] (вручную) без окна `five_hour` в Limits ничего о нём не говорится и ничего его не ждёт.
  - evidence: screenshot pass · `../evidence/13/limits-no-five-hour-light.png` · mac dev · d62dc93f4ab8824d4fe49d834a70b54d34535f54 · scrub: 2026-11-25
  - evidence: screenshot pass · `../evidence/13/limits-no-five-hour-dark.png` · mac dev · d62dc93f4ab8824d4fe49d834a70b54d34535f54 · scrub: 2026-11-25
