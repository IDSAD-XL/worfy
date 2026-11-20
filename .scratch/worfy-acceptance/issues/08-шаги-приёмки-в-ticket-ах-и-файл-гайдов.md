# 08 — Шаги приёмки в Ticket-ах: правило Harness для ручных пунктов, перенос гайдов, файл гайдов до приёмки владельцем

Type: task
Status: open
Blocked by: 04, 05
Source: [spec.md](../spec.md), «Ticket-ы», 8; «Решения по реализации» → «Шаги приёмки — ручные пункты Ticket-а»; «Вопросы
владельцу», Q5 (решено владельцем 2026-11-20)

Кто: агент (Orchestrator).

Платформенный Ticket: правка текстов skill-ов Harness-а — платформенный PR (ADR-0056), вердикт Windows — job-ы Windows в
CI. Глубина ревью — `medium`.

## Что происходит

- Шаги приёмок Orchestrator ведёт руками в `.scratch/owner-acceptance-guides.md` («Сделай → Должно быть», «Перед
  началом Orchestrator сделает»); пункты — в Ticket-ах. Они расходятся (spec, «Проблема»).
- Этот формат владелец сам попросил 2026-11-06. Решение 2026-11-20 (Q5): шаги переезжают в Ticket-ы, а файл удаляется
  только после того, как владелец принял вид в Ticket-е 10; до этого Orchestrator держит файл актуальным.
- Шаблон Ticket-а — `harness/skills/to-tickets/SKILL.md`; ручные проверки — `harness/skills/ship-ticket/step-6-manual-gui-checks.md`.

## Что делаем

1. Правило Harness: ручной пункт пишется для владельца, один шаг — «Сделай: … → Должно быть: …», с `needs:`; подготовка
   Orchestrator-а — неручные пункты того же Ticket-а. Текст — в `harness/skills/to-tickets/SKILL.md` и
   `harness/skills/ship-ticket/step-6-manual-gui-checks.md` (английский, ADR-0074).
2. Шаги открытых приёмок из файла гайдов — ручными пунктами в их Ticket-ы приёмки (`.scratch/<epic>/issues/NN-*.md`),
   по одному пункту на шаг.
3. Файл гайдов не удаляется: в нём остаётся ссылка «шаги — в Ticket-ах, вид Acceptance», он актуален до Ticket-а 10.
4. `HANDOFF.md` в разделе «Ждёт владельца» ведёт на вид (правку делает Orchestrator, как обычно для `HANDOFF.md`).
5. `docs/features/workflow.md`: как пишется ручной пункт приёмки.

## Готово, когда

- [ ] `harness/bin/tests/agents-text.test.sh`: текст to-tickets и step-6 требует «Сделай → Должно быть» и `needs:` для
      ручного пункта; mutant (фраза убрана) — красный; весь файл — exit 0.
- [ ] Шаги каждой открытой приёмки — ручные пункты своих Ticket-ов; `evidence-check --changed` — exit 0 на PR.
- [ ] Файл гайдов на месте и ссылается на вид; `node scripts/check-handoff.mjs` — exit 0.
- [ ] `docs/features/workflow.md` описывает ручной пункт приёмки; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные (платформенный PR).

## Где в коде

- `harness/skills/to-tickets/SKILL.md`, `harness/skills/ship-ticket/step-6-manual-gui-checks.md`
- `harness/bin/tests/agents-text.test.sh`
- `.scratch/<epic>/issues/NN-*.md` открытых приёмок, `.scratch/owner-acceptance-guides.md`, `HANDOFF.md`
- `docs/features/workflow.md`

Только читать: `harness/skills/owner-check/SKILL.md` (Ticket 04).

## Вне скоупа

- Удаление файла гайдов — после приёмки владельцем (Ticket 10).
