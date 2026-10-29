# 69 — Долг после review PR #685: grader и закрепление «вердикт первым»

Type: task
Status: claimed 2026-10-29T17:15Z
Branch: worfy-harness/69
Blocked by: —
Source: ревью PR [#685](https://github.com/IDSAD-XL/worfy/pull/685) (follow-up Ticket-а 50), 2026-10-21. Все находки — low.

## Готово, когда

- [ ] `harness/evals/reviewer-verdict/graders/rejected-first.md:4` — шаблон `^REJECTED` не проверяет двоеточие и
      «один вердикт»: `REJECTED — …; VERIFIED: …` проходит. Правка: `^REJECTED:(?!.*VERIFIED)` или второй grader.
- [ ] `harness/agents/reviewer.md:198-199` — оговорка «Answer format» (под линзой отчёта implementer-а вердикт идёт
      первым) не закреплена в `agents-text.test.sh`; добавить строку `rv`.
- [ ] Test-ы `harness/` по затронутым файлам — exit 0.

## Риски

- Правка grader-а меняет оценку кейса `reviewer-verdict`; повтор платного прогона — только с разрешения владельца.

## Итог

- Grader `harness/evals/reviewer-verdict/graders/rejected-first.md`: шаблон `^REJECTED` заменён на
  `^REJECTED:(?!.*VERIFIED)`. Ответ без двоеточия (`REJECTED — …`, `REJECTED …`) и ответ с двумя вердиктами в
  первой строке (`REJECTED: …; VERIFIED: …`) теперь не проходят. Флага `s` нет, поэтому `.` не переходит через
  конец строки: слово VERIFIED в следующих строках ответа grader не роняет. Остальные grader-ы кейса — `llm` и
  `tool_used`, той же дыры в них нет.
- Contract test `test/contract/harness-evals.test.ts` («reviewer-verdict: the rejected-first grader …») читает
  шаблон из grader-а и гоняет его по ответам-fixture так же, как `scripts/eval-outcome-check.mjs` (ответ после
  `trim()`): три хороших ответа проходят, шесть плохих — нет. Mutation testing: `^REJECTED`,
  `^REJECTED(?!.*VERIFIED)` и `^REJECTED:` краснят строки плохих ответов; `^REJECTED:(?![\s\S]*VERIFIED)` краснит
  строку хорошего многострочного ответа.
- `harness/bin/tests/agents-text.test.sh`: строка `rv` закрепляет оговорку «Answer format» в
  `harness/agents/reviewer.md:198-199`; без неё в агенте test красный (`AT_EXIT=1`).
- Платный eval не запускался, `pnpm eval:harness` не нужен.
