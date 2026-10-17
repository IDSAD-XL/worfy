# 09 — Тексты batch CI не говорят, что делать с `mergeable == UNKNOWN`

Type: task
Status: open
Blocked by: —
Source: ревью PR #433 ([08](08-batch-ci-на-main.md), «Итог»), находка `low`, 2026-10-17;
[ADR-0068](../../../docs/adr/0068-batch-ci-on-main-once-per-wave.md).

## Что происходит

- С `workflow.ci: "batch"` у PR нет CI run: вместо `gh pr checks` и `mergeStateStatus` агент смотрит
  `gh pr view <N> --json mergeable`.
- GitHub вычисляет `mergeable` не сразу: сразу после push или merge соседнего PR поле бывает
  `UNKNOWN`.
- `harness/skills/ship-ticket/SKILL.md:507` это называет: `UNKNOWN` — GitHub ещё считает, спросить
  ещё раз через минуту.
- Три других текста называют только `MERGEABLE` и `CONFLICTING`:
  `harness/agents/implementer.md:189-191`, `harness/skills/epic-wave/SKILL.md:288-291` (verifier),
  `harness/skills/overnight-fix-loop/SKILL.md:271-276`. Агент, получивший `UNKNOWN`, не знает,
  финиш это, отказ или ожидание.

## Что делаем

- В трёх текстах выше добавить исход `UNKNOWN` теми же словами, что в `ship-ticket/SKILL.md:507`:
  GitHub ещё считает, спросить ещё раз через минуту. В блоке `overnight-fix-loop` — и в комментарии
  команды `gh pr view <N> --json mergeable -q .mergeable`.

## Готово, когда

- Все четыре текста называют три исхода `mergeable`: `MERGEABLE`, `CONFLICTING`, `UNKNOWN`.
- Если для текстов skill-ов есть test-ы (`harness/bin/tests/skill-blocks.test.sh`,
  `epic-wave-ship-ticket.test.sh`), они проходят с кодом 0; новый исход закреплён проверкой, если
  такие проверки там есть для `MERGEABLE` и `CONFLICTING`.

## Где в коде

- `harness/agents/implementer.md` — шаг 6, абзац про `workflow.ci: "batch"`.
- `harness/skills/epic-wave/SKILL.md` — verifier, абзац «With `F workflow.ci` `batch`…».
- `harness/skills/overnight-fix-loop/SKILL.md` — раздел 1h, абзац и block про `batch`.
- `harness/skills/ship-ticket/SKILL.md:505-508` — образец, не меняется.

## Вне скоупа

- Ожидание `UNKNOWN` в коде `bin/wave-gate`: `check` и `merge` на `mergeable` не смотрят
  ([08](08-batch-ci-на-main.md), «Итог»).
