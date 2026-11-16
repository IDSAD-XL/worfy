# 07 — Story Epic-а: последний PR Epic-а с кодом узнаётся до `land`, `story.md` едет в documents PR

Type: feature
Status: done 2026-11-16T19:30Z
PR: #1922
Blocked by: 02, 05, 06
Source: [spec.md](../spec.md), «Ticket-ы», строка 07; «Волны», Wave 5; «Решения владельца» 2, 7, 8, 13, 17, 19, 22
(строки 92–93, 98–100, 109–112, 117–120, 125–126); «Решения по реализации» → Harness: «Story Epic-а» (строки 222–233);
«Риски»: «Публичный репозиторий» (строки 357–358); возражение 1
[критика](../../../docs/product/critic/worfy-code-stories-2026-11-15.md); истории 1, 11, 33

Кто: агент.

## Что происходит

- Явного признака «влит последний PR Epic-а с кодом» нет. `epic-status` его не даст. `land` за один run вливает PR,
  сам создаёт documents PR и сам его вливает. `Status: done` и `PR:` последнего Ticket-а появляются только внутри этого
  documents PR (`harness/bin/land:50-61`). У открытого Ticket-а строки `PR:` нет, поэтому по ней нельзя отличить
  недоделанный Ticket с кодом от приёмки владельца (возражение 1 критика).
- Единственный дополнительный вход documents PR сейчас — `prs[].evidence` (поля state-файла: `harness/bin/land:63-90`).
  Поля для лишнего файла нет. Ticket 06 уже добавил поле вердикта и шаг review — этот Ticket меняет `land` после него.
- `land` прогоняет `evidence-check` в documents PR до commit-а (`harness/bin/land:56-58`). Так `story.md` проходит
  privacy check публичного репозитория.

## Что делаем

1. Правило «Ticket с кодом» по шапке Ticket-а. Приёмка владельца не в счёт (например, `Кто: владелец`). Правило
   записать в `harness/bin/TICKETS.md`.
2. Триггер берётся из state-файла `land`. Orchestrator до вызова `land` видит: в state-файле лежит последний PR
   Epic-а с кодом. Остальные Ticket-ы Epic-а с кодом уже `done`, а этот `VERIFIED` (одобрен review). Шаг описать в
   skill `epic-wave`.
3. Тогда Orchestrator запускает агента:
   - агент виден на Canvas как обычный Subagent Orchestrator-а (решение 19);
   - вход — story PR Epic-а, spec, вердикты;
   - выход — `story.md` по формату `TICKETS.md`: 5–10 главных шагов (решение 8), главы-PR, шаг «Стыки между
     Ticket-ами» со списком передач — от какого Ticket-а, какому, что передано, сделано ли — и 2–3 вопроса «Проверить
     себя»;
   - перед передачей в `land` — зелёный `story-check`;
   - если у части PR Epic-а нет story (PR до Wave 3 этого Epic-а), агент читает их diff и помечает это в «Начале».
4. Новое поле state-файла — лишние файлы documents PR (путь в tickets root и путь готового файла).
   - `land` кладёт их в тот же documents PR до `evidence-check`. Красный check — documents PR ждёт, как с
     Evidence-строками.
   - Описать поле в комментарии state-файла.
5. Режим Silent (`tickets_root` null): documents PR нет, `story.md` ложится в папку Workflow.
6. Toast «Story Epic-а готова» в worfy — Ticket 10. Здесь только файл.

## Готово, когда

- [ ] `TICKETS.md` описывает правило «Ticket с кодом» по шапке; shell-test на Epic-е с приёмкой владельца: последний PR
      с кодом найден, хотя Ticket приёмки открыт.
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27
- [ ] Shell-test `land`: state-файл с полем лишнего файла → documents PR несёт `<epic>/story.md` рядом с
      `Status: done` последнего Ticket-а; оба в одном documents PR.
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27
- [ ] Shell-test `land`: `story.md` с личными данными — `evidence-check` красный, documents PR ждёт, ничего не
      закоммичено и не отправлено.
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27
- [ ] Shell-test `land`: state-файл без нового поля — documents PR такой же, как до Ticket-а, байт в байт.
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27
- [ ] Shell-test `land`: прерванный run, запущенный снова на том же state-файле, не кладёт `story.md` второй раз.
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27
- [ ] Shell-test Silent: `tickets_root` null — `story.md` в папке Workflow, documents PR нет.
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: test-run pass · `bash harness/bin/tests/land-epic-story.test.sh` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27
- [ ] Skill `epic-wave` описывает триггер, вход и выход агента story Epic-а и новое поле; skill-text test-ы зелёные.
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27
- [ ] Все `harness/bin/tests/*.test.sh` зелёные; gate fast — exit 0.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: gate pass · `gate fast` exit 0 · mac - · 2885fcfca26eb3287f6da98442f7321f8138cd59
  - evidence: gate pass · `gate fast` exit 0 · mac - · fc6e313b71c6b359fbe0632ea59ce8be91a65b27

## Тесты

- `harness/bin/tests/land.test.sh` и shell-test правила «Ticket с кодом» — случаи из пунктов выше, каждый сначала
  красный. Качество самой story Epic-а test не ловит: его проверяет приёмка (Ticket 17).

## Где в коде

- `harness/bin/land`
- `harness/bin/tests/land.test.sh`
- `harness/bin/TICKETS.md`
- `harness/skills/epic-wave/SKILL.md` (триггер, агент story Epic-а, новое поле state-файла)
- `harness/bin/epic-status`, `harness/bin/tests/epic-status.test.sh` (только если правило «Ticket с кодом» читается
  там)

Только читать: `harness/bin/story-check`, `harness/bin/evidence-check`, `harness/bin/tests/silent-mode.test.sh`.

## Вне скоупа

- Story Epic-а по кнопке до конца Epic-а — Ticket 11. Toast — Ticket 10.
