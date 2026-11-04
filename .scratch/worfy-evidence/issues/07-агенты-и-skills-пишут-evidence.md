# 07 — Агенты и skills пишут Evidence

Type: task
Status: open
Blocked by: 01, 02, 04
Source: [spec.md](../spec.md), «Модель» («Кто пишет какие строки»), «Где privacy check бежит», п. 4, «Риски», п. 3, 5, «Вопросы владельцу», Q2, Q6

Согласовать с Orchestrator-ом worfy-multi-vendor до старта, если Codex parity suite (PR #1313, `test/contract/codex-parity.test.ts`)
закрепляет текст `harness/agents/*.md` или skills: в base `af731d59a` этого test-а ещё нет.

## Что происходит

- После 01, 02 и 04 есть `ticket evidence`, `evidence-check`, проверка в `land` до push и поле `prs[].evidence`. Шаг в `pnpm lint`
  (03) включается после этого Ticket-а: к тому времени agents и skills должны уже писать отметки `scrub:` у новых снимков.
- Но строки никто не пишет: implementer отдаёт `claims` с полем `evidence` только в отчёте (`harness/agents/implementer.md:156`),
  ревьюер — verdict первой строкой (`harness/agents/reviewer.md:230-231`), Orchestrator закрывает Ticket через `land`
  (`harness/skills/ship-ticket/step-9-merge.md`, `harness/skills/epic-wave/SKILL.md`).
- Docs PR, который Session пушит руками (как #1306), privacy check проходит только в CI — после push.

## Что делаем

Текст Harness — английский (ADR-0074), заголовок раздела — из `tickets.done_section`.

1. **Implementer** (`implementer.md`, `ship-ticket/implementer-report.md`, `implementer-finish.md`): после своих проверок — по строке
   `ticket evidence` на каждый пункт, который он доказал (`test-run`, `gate`, `commit`), с exit code в `ref`; в отчёте у claim — номер
   пункта (`item`). Ручные пункты он не отмечает. Нечем доказать — пункт остаётся без строки и попадает в `not_verified`.
2. **Ревьюер** (`reviewer.md`, линза «implementer's report»): сверяет строки Evidence — `ref` существует, SHA есть в ветке,
   `needs` совпадает; несовпадение — неподтверждённый claim. Сам строк не пишет. Full mode — строки в diff PR; Silent mode — в файле
   Ticket-а в Workflow folder (путь печатает `ticket root`), в diff их нет.
3. **Orchestrator** (`step-9-merge.md`, `epic-wave/SKILL.md`, Ответ Q6): Full mode — в state-файле `land` заполняет `prs[].evidence`:
   `review` (`pass` при `VERIFIED`, `fail` при `REJECTED`, `ref` — `PR #N`) и `ci-check` (`ref` — адрес run-а `ci-ok`) для пунктов,
   которые они доказывают. Silent mode (`tickets_root: null`, documents PR нет) — пишет те же строки сам: `ticket evidence …` в
   Workflow folder после verdict-а и CI, до `ticket done`.
4. **Owner-check** (`step-6-manual-gui-checks.md`): слово владельца — строка `owner-check` с `--copy` той копии, где владелец
   смотрел; снимок — `screenshot … --scrub <дата>` после проверки пикселей.
5. **Docs PR руками** (`step-11-close.md`, `epic-wave/SKILL.md`, Ответ Q2): перед push — `evidence-check --changed`, exit 0;
   находки — исправить, не push-ить.

## Готово, когда

- [ ] Shell test `agents-text`: в тексте implementer-а и skills есть `ticket evidence`, `evidence-check --changed` и поле `prs[].evidence`;
      нет зашитого `Готово, когда`; `plugin-neutral.test.sh` зелёный (текст английский).
- [ ] Shell test `skill-blocks` (или его соседи): ссылки на шаги skills ведут на существующие файлы.
- [ ] Shell test `agents-text`: текст Orchestrator-а называет путь Silent mode (`ticket evidence` в Workflow folder), текст ревьюера —
      где читать строки в Silent mode.
- [ ] (вручную) Одна Wave другого Epic-а после merge: у Ticket-ов есть строки `test-run` от implementer-а и `review`/`ci-check` из `land`;
      новые снимки — со `scrub:`.
- [ ] `bash harness/bin/tests/agents-text.test.sh`, `plugin-neutral.test.sh`, `skill-blocks.test.sh` — exit 0; CI PR зелёный.

## Тесты

- Shell `harness/bin/tests/agents-text.test.sh` — новые случаи.
- Сначала падающий: случай «implementer.md называет `ticket evidence`».
- Прогнать все `harness/bin/tests/skill-*.test.sh`, `agents-text.test.sh`, `plugin-neutral.test.sh`, `epic-wave-ship-ticket.test.sh`.

## Где в коде

- `harness/agents/implementer.md`
- `harness/agents/reviewer.md`
- `harness/skills/ship-ticket/implementer-report.md`
- `harness/skills/ship-ticket/implementer-finish.md`
- `harness/skills/ship-ticket/step-6-manual-gui-checks.md`
- `harness/skills/ship-ticket/step-9-merge.md`
- `harness/skills/ship-ticket/step-11-close.md`
- `harness/skills/epic-wave/SKILL.md`
- `harness/bin/tests/agents-text.test.sh`
