# 10 — Harness: инструкции summary по ролям в `compaction.md` и запасная строка в `common.md`

Type: task
Status: done 2026-11-18T02:44Z
PR: #1976
Branch: worfy-continuity/10
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 10; «Решения по реализации» → «Compaction», пункт «Инструкции summary (10)»;
«Решения по test-ам», Harness; «Как это сделано у конкурентов» (Division Swarm, Factory Droids); «Риски», 11

Кто: агент.

Платформенный PR (ADR-0056, пункт 2): правит правила Harness, которые вставляет hook. Глубина ревью — `medium`.

## Что происходит

- Правила роли вставляет `harness/hooks/inject-rules.mjs`; Claude Code режет один кусок `additionalContext` после
  10 000 знаков (`:29–30`). `harness/hooks/rules/orchestrator.md` уже занимает 9644 байта: места для инструкций summary
  в нём нет.
- Модель, которая пишет summary при compaction, не знает, что сохранить: цель, Ticket, пункты «Готово, когда» и решения
  теряются.
- Каким путём модель получает инструкции (раздел в правилах, `custom_instructions` у `PreCompact`, `/compact <text>`,
  дописка к system prompt), отвечает spike 01 (вопрос 2).

## Что делаем

1. Новый кусок правил `harness/hooks/rules/compaction.md`, по-английски (ADR-0074). Разделы summary: Intent, Essential
   facts, Completed work, Files touched, Errors, Pending work, Next action.
2. По ролям: Orchestrator — Epic, номер Wave, PR в работе, решения без владельца (журнал решений `decisions.tsv`, skill
   epic-wave); implementer — Ticket, каждый пункт «Готово, когда» с отметкой, worktree и ветка.
3. Путь доставки — тот, который выбрал «Итог» spike-а 01; если это не вставка правил hook-ом, Ticket подключает его
   там, где spike показал (без кода worfy: worfy-часть — Ticket 12).
4. Запасная строка в `harness/hooks/rules/common.md`: после compaction перечитать свой Ticket и `git status`, прежде
   чем идти дальше.
5. Английская страница `docs/features/skills-agents-and-hooks.md`: кусок правил `compaction.md`; перевод — Ticket 14.

## Готово, когда

- [ ] `harness/hooks/tests/rules-hooks.test.sh`: `compaction.md` вставляется и укладывается в предел 10 000 знаков
      вместе с правилами роли.
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · b7e5f01bf97d5f4b5909c5e93554704ce089a6b1
  - evidence: review pass · PR #1976 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Shell test: запасная строка `common.md` есть в выводе hook-а у каждой роли.
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · b7e5f01bf97d5f4b5909c5e93554704ce089a6b1
  - evidence: review pass · PR #1976 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Английская страница `skills-agents-and-hooks.md` называет `compaction.md`.
  - evidence: commit pass · worfy-continuity/10: summary instructions for compaction through PreCompact · - - · b7e5f01bf97d5f4b5909c5e93554704ce089a6b1
  - evidence: review pass · PR #1976 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): job Windows в составе `ci-ok` зелёный на head PR до merge.
  - evidence: review pass · PR #1976 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44221265677/job/134527446960 · ci - · 7e817a6dc8709c9572b2cb144263863c87f84bd4

## Тесты

- `harness/hooks/tests/rules-hooks.test.sh`. Каждый test сначала красный.

## Где в коде

- `harness/hooks/rules/compaction.md` (новый)
- `harness/hooks/rules/common.md`
- `harness/hooks/inject-rules.mjs`
- `harness/hooks/tests/rules-hooks.test.sh`
- `docs/features/skills-agents-and-hooks.md`

Только читать: «Итог» Ticket-а 01, `harness/hooks/rules/orchestrator.md`.

## Вне скоупа

- Возврат состояния после compaction — Ticket 11; `WORFY_EPIC` и `compact_prompt` Codex — Ticket 12.
