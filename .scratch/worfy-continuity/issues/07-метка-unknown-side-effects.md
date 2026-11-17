# 07 — Unknown side effects: метка Ticket-а, toast с «Checked, include», строка Journal-а

Type: task
Status: open
Blocked by: 05, 06, 16
Source: [spec.md](../spec.md), «Ticket-ы», 7; «Решения по реализации» → «Unknown side effects: метка и «Checked, include»»;
[critic 2026-11-14](../../../docs/product/critic/worfy-continuity-2026-11-14.md), возражение 1; «Вопросы владельцу», Q2 и Q4
(оба — (а), решено без владельца, подтвердить); «Решено без владельца», 2 и 3

Кто: агент.

Не платформенный Ticket (renderer, main process, Journal). Глубина ревью — `medium`; снимок экрана метки и toast-а.

## Что происходит

- После Ticket-ов 05, 06 и 16 worfy уже не продолжает сам Session или Ticket с внешним вызовом без результата: Session
  получает строку `notice` и chip, Ticket остаётся в `work` и ждёт человека. Но человек не видит, какой Ticket и почему,
  и не может вернуть его одной кнопкой.
- Координатор выхода Ticket-а 04 ждёт только вызовов верхнего уровня: `externalActions` пропускает вызовы Subagent-ов
  (`src/shared/agent/continue-plan.ts:336`).
- Правило то же, что отказ `in-flight` у Auto-continue (`docs/features/autopilot-faults.md:55`).

## Что делаем

1. Ticket, который Ticket 06 не взял в продолженную Wave, получает метку «unknown side effects» в рамке Epic-а с
   tooltip-ом о вызове («gh pr merge 1234 may or may not have run»).
2. Toast «Unknown side effects: `gh pr merge 1234` may or may not have run» с кнопкой «Checked, include».
3. В Journal Run-а — строка `unknown-side-effects {ticket, actions}` (событие в `src/shared/autopilot/journal.ts`);
   checkpoint Ticket-а 02 её читает.
4. «Checked, include» возвращает Ticket в `resumable`: его берёт следующая Wave или следующий Run. Метка уходит.
5. Координатор выхода (`src/main/quit-grace.ts`, Ticket 04) ждёт и вызовов Subagent-ов без результата — функцией
   Ticket-а 16 над их транскриптами; окно «Quitting worfy» называет и их.
6. Английская страница `docs/features/autopilot-faults.md`: метка, toast, «Checked, include», строка Journal-а; перевод
   и термин CONTEXT.md — Ticket 14.

## Готово, когда

- [ ] Contract test (`faultRun()`): fake implementer держит `git push` без результата, выход, старт → Ticket не в Wave,
      в Journal-е `unknown-side-effects` с Ticket-ом и командой.
- [ ] Contract test: «Checked, include» → Ticket в `resumable`, следующая Wave берёт его как продолженный.
- [ ] Contract test: Subagent держит `gh pr merge` без результата → выход ждёт его, не дольше 60 с по часам test-а.
- [ ] Unit test checkpoint-а: `unknown-side-effects` в Journal-е — Ticket не `resumable`, пока нет «Checked, include».
- [ ] e2e test: метка на Ticket-е в рамке Epic-а, tooltip с командой, toast и «Checked, include» (рядом с
      `test/e2e/autopilot-faults.spec.ts`).
- [ ] Английская страница `autopilot-faults.md` описывает метку и «Checked, include».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Contract рядом с `test/contract/autopilot-faults-setup.ts`; `test/unit/autopilot-checkpoint.test.ts` (Ticket 02); e2e
  рядом с `test/e2e/autopilot-faults.spec.ts`. Каждый test сначала красный.

## Где в коде

- `src/shared/autopilot/journal.ts`
- `src/shared/autopilot/checkpoint.ts`
- `src/main/autopilot/run.ts`
- `src/main/quit-grace.ts`
- `src/renderer/canvas/nodes/EpicFrameNode.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/actions/AutopilotAction.tsx` (toast)
- `docs/features/autopilot-faults.md`

Только читать: `src/shared/agent/unknown-side-effects.ts` (Ticket 16), `src/shared/binding/resolve.ts`.

## Вне скоупа

- Автоматическая сверка git и GitHub, чтобы включить Ticket без человека (Q4, вариант (б)) — после замеров, как часто
  метка встаёт.
