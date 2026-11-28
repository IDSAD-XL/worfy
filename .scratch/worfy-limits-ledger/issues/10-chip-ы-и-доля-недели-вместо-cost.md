# 10: Chip-ы доли и доля недели вместо Cost

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Ticket-ы», 10; «Решение», «Где это видно», 3; «Экран» (карточка Ticket-а); «Решения по
реализации» («Chip», «Cost → доля недели», «Assistant»); «Риски» («Высота карточки Ticket-а», «Две оценки доли
Assistant-а»); «Вопросы владельцу», Q2, Q5, Q8; «Волны», Wave 4; [critic 2026-11-28](../../../docs/product/critic/worfy-limits-ledger-2026-11-28.md),
возражение 3 — замена Cost на долю недели входит в этот Ticket (решение владельца 2026-11-28)

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Поле Cost шапки Session view показывает доллары только у Orchestrator-а, у остальных — прочерк
  (`src/renderer/session/SessionView.tsx:416`, `docs/features/sessions.md:283-286`). Node Orchestrator-а — сумма с
  tooltip «Cost of this Session» (`src/renderer/canvas/nodes/OrchestratorNode.tsx:158-159`, `costNumber`,
  `src/renderer/session/format.ts:37`). Это цена по прайсу API, а не доля подписки.
- Карточка Ticket-а и Node Session доли не показывают. Высота карточки считается из данных: место под chip из
  snapshot-а main получает только карточка, которую snapshot называет (`REVIEW_LINE`, `reviewChips`,
  `src/renderer/canvas/ticket-card.ts:66-71`, `:374`; `src/renderer/canvas/nodes/TicketNode.tsx:43-45`).
- Раздел Assistant-а и Settings → Assistant показывают «≈N% · estimate» по своему методу `cost-share`
  (`src/renderer/assistant/AssistantPanel.tsx`, `src/renderer/settings/AssistantSection.tsx`;
  `src/shared/assistant/budget.ts:204-220`).

## Что строить

- `src/renderer/canvas/badges/LimitsShare.tsx` в slot-ах badges (`src/renderer/canvas/badges/index.ts:19-21`, subject
  ticket, session или epic): chip `≈3% · 91% cached`; tooltip — первый проход и доработка, роли, модели, потери cache.
  Без оценки — token-ы. По Q5 (а): chip всегда, когда есть данные.
- `ticket-card.ts`: строка под chip только у карточки, которую называет snapshot учёта, как у chip-ов ревью.
- Cost → доля недели: поле Cost шапки Session view и сумма на Node Orchestrator-а показывают оценку доли недели этой
  Session с «≈»; без оценки — token-ы; у других Session — их доля, а не прочерк. Доллары — по Q2 (рекомендация (а):
  в tooltip-е с пометкой «API-equivalent»). Подпись поля и tooltip Node называют долю, а не цену.
- `CostCounter` (`src/main/agent/orchestrator.ts:104-112`) и цена хода для журнала Assistant-а
  (`src/main/agent/turn-cost.ts`) не меняются.
- По Q8: при ответе (а) раздел Assistant-а и Settings → Assistant берут долю строки Assistant из учёта, когда у него
  есть оценка, а `cost-share` остаётся запасным; при (б) — без изменений, Ticket 13 объясняет разницу.
- Тексты UI — английские (ADR-0074).

## Где в коде

- `src/renderer/canvas/badges/LimitsShare.tsx` (новый), `src/renderer/canvas/badges/index.ts`
- `src/renderer/canvas/ticket-card.ts`, `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/nodes/OrchestratorNode.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`
- `src/renderer/session/SessionView.tsx` — поле Cost; `src/renderer/session/format.ts`
- По Q8 (а): `src/renderer/assistant/AssistantPanel.tsx`, `src/renderer/settings/AssistantSection.tsx`,
  `src/main/assistant/window/app.ts`, `src/main/assistant/settings/app.ts`
- `test/unit/ticket-card.test.tsx`; unit test-ы Node и шапки Session рядом с существующими; e2e — chip и доля на Node
  Orchestrator-а (`test/e2e/flight-recorder.spec.ts` или новый spec со строкой в `scripts/e2e-specs.table.json`)

## Test-ы

- Unit test-ы: chip на карточке Ticket-а с данными и без; высота карточки с chip-ом и без
  (`test/unit/ticket-card.test.tsx`); поле Cost и Node Orchestrator-а показывают долю, доллары — по Q2; без оценки —
  token-ы; по Q8 (а) — раздел Assistant-а берёт долю учёта, без оценки — `cost-share`.
- e2e: fake Session с fixture-транскриптом и `limits.json` — chip на карточке и доля на Node Orchestrator-а.
- Сначала падающий test: красный на нынешнем коде, это пишется в «Итог».
- Без моделей и без сети.

## Готово, когда

- [ ] Chip `≈ · cached` есть на карточке Ticket-а и на Node Session и Orchestrator-а; высота карточки верна (unit test).
- [ ] Cost в шапке Session view и на Node Orchestrator-а показывает долю недели; доллары — по Q2.
- [ ] Доля Assistant-а — по Q8.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
