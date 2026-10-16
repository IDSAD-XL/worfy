# 05 — Stepper на Card Ticket-а вместо слова статуса; бейдж вердикта — из отметки `review`

Type: task
Status: open
Blocked by: 03
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 2, 5 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md).

## Что происходит

- **Card Ticket-а показывает слово статуса:** чип `claimed`, `open`, `no status`, `blocked`, `done`
  (`src/renderer/canvas/nodes/TicketNode.tsx:31-45`), то же слово — в `aria-label` (`:112`, `:131`).
- **Бейджи PR, CI и вердикта** — `src/renderer/canvas/badges/ChecksBadges.tsx:60`, `:69`. Вердикт —
  поле `verdict` снимка `checks` (`src/shared/ipc/checks.ts:87-90`), его находит `verdictOf` в тексте
  комментариев PR (`src/main/github/prs.ts:164-176`, вызов в `parsePrList`).
- После Ticket-а 03 Stage каждого Ticket-а и отметки на head SHA приходят через
  `src/renderer/pipeline/usePipeline.ts`.

## Что делаем

1. **`src/renderer/pipeline/Stepper.tsx`** — ряд точек по Stage Pipeline Project-а: пройденные,
   текущий (с подписью Stage и «кого ждёт»), будущие; пропущенный Check (`skipped`) — отдельным
   видом; `blocked` — пометка на текущем шаге с причиной в подсказке; `rework` — на Implementing.
   Узкая Card показывает только текущий Stage и «N/M».
2. **`TicketNode.tsx`:** stepper вместо чипа статуса; `aria-label` — `Ticket NN, <Stage>`; бейджи PR,
   CI и вердикта остаются под ним как подробности.
3. **Вердикт из отметки.** Поле `verdict` снимка `checks` берётся из отметки `review` на head SHA
   (`success` → `VERIFIED`, `failure` → `REJECTED`, `pending` и устаревшая — нет вердикта).
   `verdictOf` из `src/main/github/prs.ts` удаляется. Журнал узкого круга Autopilot
   (`narrowRoundsOf`, `src/main/autopilot/run.ts:67-68`) — вне этого Ticket-а: он не Stage.
4. Слово статуса в `epic-layout.ts` (прогресс Epic-а в боковой панели) не меняется: прогресс — по
   статусам, не по Stage.

Не входит: выделение застрявших (06).

## Готово, когда

- [ ] `pnpm test test/unit/ticket-stepper.test.tsx` — exit 0: Pipeline worfy и Atakama; текущий Stage
      и «кого ждёт» в подписи; `skipped`, `blocked`, `rework`; узкая Card.
- [ ] `pnpm test test/unit/checks-badges.test.tsx test/contract/github-prs.test.ts` — exit 0: вердикт —
      из отметки; комментарий `VERIFIED` без отметки вердикта не даёт.
- [ ] `pnpm test:e2e test/e2e/checks-badges.spec.ts` — exit 0 (сценарий вердикта переведён на отметку
      в stub-е `gh`).
- [ ] `grep -rn "verdictOf" src/main/github` — пусто (exit 1).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную) Stable copy после мержа: Card Ticket-а на CI и на Agent review — снимок в
      `../evidence/05-stepper.png`.

## Тесты

Сначала падающий `test/unit/ticket-stepper.test.tsx` на фикстуре снимка `pipeline.get`. Сценарий
e2e меняет только stub `gh` (commit status вместо комментария); `test/e2e/helpers.ts` не правится.

## Где в коде

- `src/renderer/pipeline/Stepper.tsx` (новый)
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/badges/ChecksBadges.tsx`
- `src/shared/ipc/checks.ts`
- `src/main/github/prs.ts`
- `test/unit/ticket-stepper.test.tsx` (новый)
- `test/unit/checks-badges.test.tsx`
- `test/contract/github-prs.test.ts`
- `test/e2e/checks-badges.spec.ts`

## Итог

Заполняется при закрытии.
