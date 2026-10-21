# 69 — Долг после review PR #685: grader и закрепление «вердикт первым»

Type: task
Status: open
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

Заполняется при закрытии.
