# 06 — Verifier проверяет утверждения story; documents PR дописывает шаг «Что нашёл review и что осталось»

Type: feature
Status: done 2026-11-16T17:07Z
PR: #1919
Blocked by: 05
Source: [spec.md](../spec.md), «Ticket-ы», строка 06; «Решения владельца» 12, 25 (строки 106–108, 129–131); «Решения по
реализации» → Harness: «Verifier», «Шаг „Что нашёл review и что осталось“» (строки 217–221); «Риски»: «Автор описывает
свой код слишком гладко», «Строки уезжают после rebase» (строки 337–350); истории 32, 34

Кто: агент.

## Что происходит

- Агент `reviewer` под линзой «implementer's report» уже проверяет claims отчёта и Evidence-строки
  (`harness/agents/reviewer.md:219` и дальше). Story PR (Ticket 05) лежит в diff-е PR, но пункта о ней в линзе нет.
- После merge-ей `land` создаёт один documents PR на run и пишет туда Evidence-строки из `prs[].evidence` state-файла
  (`harness/bin/land:50-61`, поля state-файла — строки 63–90). Шага review в story PR нет.
- В прототипе строки вердикта указывали на ветку до rebase, и одно утверждение review стало неверным (spec,
  строки 348–350).

## Что делаем

1. В линзе «implementer's report» (`harness/agents/reviewer.md`) — пункт story:
   - каждое утверждение story совпадает с кодом;
   - фрагменты — на последнем head;
   - «не записано» не заменено придуманной причиной.

   Неверное утверждение story — находка того же веса, что ошибка в коде. В режиме Silent story ищется в папке
   Workflow, как Evidence-строки.
2. Новое поле state-файла `land` у PR — путь сохранённого вердикта (вывод `harness/bin/verdict`). После merge в
   documents PR `land` дописывает в `stories/NN-*.md` шаг «Что нашёл review и что осталось»:
   - находки и что с ними сделано — по тексту вердикта;
   - что осталось непроверенным;
   - без вызова модели.

   PR без story и PR без поля `land` пропускает молча.
3. Фрагменты этого шага ссылаются на строки последнего head, которые проверил review, а не на ветку до rebase. Шаг
   проходит `story-check` в documents PR. Дописывание не меняет commit привязки story (правило Ticket-а 01).
4. Режим Silent (`tickets_root` null): documents PR нет. Шаг пишет Orchestrator прямо в папку Workflow; skill
   `epic-wave` говорит, когда.
5. Описать новое поле в комментарии state-файла `land` и в разделе «Merge with land» skill-а `epic-wave`.

## Готово, когда

- [ ] `harness/agents/reviewer.md`: в линзе «implementer's report» пункт story с весом находки, как у ошибки в коде;
      `agents-text.test.sh` зелёный.
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · fd86c84a68ac00f93f91b0a2486f8047f3270fe9
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · ae2927eeb144bfef64f3df4dfb5304edc721fb22
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · f657ec777767fd3ec4f21caf510738253e731393
- [ ] Shell-test `land`: PR с полем вердикта и story → в documents PR у `stories/NN-*.md` новый последний шаг «Что нашёл
      review и что осталось» с текстом из вердикта; `story-check` по этому файлу зелёный.
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · fd86c84a68ac00f93f91b0a2486f8047f3270fe9
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · ae2927eeb144bfef64f3df4dfb5304edc721fb22
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · f657ec777767fd3ec4f21caf510738253e731393
- [ ] Shell-test `land`: PR без story или без поля вердикта — documents PR такой же, как до Ticket-а, байт в байт.
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · fd86c84a68ac00f93f91b0a2486f8047f3270fe9
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · ae2927eeb144bfef64f3df4dfb5304edc721fb22
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · f657ec777767fd3ec4f21caf510738253e731393
- [ ] Shell-test `land`: личные данные в вердикте не уходят в documents PR — строка вердикта с ними не цитируется, на
      её месте пометка с номером строки и правилом, log называет правило без значения, documents PR не блокируется
      (так велел review round 2 PR #1919; до него было: `evidence-check` красный, ничего не закоммичено).
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · fd86c84a68ac00f93f91b0a2486f8047f3270fe9
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · ae2927eeb144bfef64f3df4dfb5304edc721fb22
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · f657ec777767fd3ec4f21caf510738253e731393
- [ ] Shell-test: после дописывания `story-check` сверяет story с тем же commit-ом, что и до него.
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · fd86c84a68ac00f93f91b0a2486f8047f3270fe9
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · ae2927eeb144bfef64f3df4dfb5304edc721fb22
  - evidence: test-run pass · `bash harness/bin/tests/land-story.test.sh` exit 0 · mac - · f657ec777767fd3ec4f21caf510738253e731393
- [ ] Skill `epic-wave`: шаг Silent-режима и новое поле state-файла описаны; skill-text test-ы зелёные.
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · fd86c84a68ac00f93f91b0a2486f8047f3270fe9
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · ae2927eeb144bfef64f3df4dfb5304edc721fb22
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · f657ec777767fd3ec4f21caf510738253e731393
- [ ] Все `harness/bin/tests/*.test.sh` зелёные; gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · fd86c84a68ac00f93f91b0a2486f8047f3270fe9
  - evidence: gate pass · `gate fast` exit 0 · mac - · ae2927eeb144bfef64f3df4dfb5304edc721fb22
  - evidence: gate pass · `gate fast` exit 0 · mac - · f657ec777767fd3ec4f21caf510738253e731393

## Тесты

- `harness/bin/tests/land.test.sh` — новые случаи из пунктов выше, каждый сначала красный.

## Где в коде

- `harness/agents/reviewer.md`
- `harness/bin/land`
- `harness/bin/tests/land.test.sh`
- `harness/skills/epic-wave/SKILL.md` (раздел «Merge with land», шаг Silent-режима)

Только читать: `harness/bin/verdict`, `harness/lib/verdict.cjs`, `harness/bin/story-check`, `harness/bin/evidence-check`.

## Вне скоупа

- Story Epic-а и поле state-файла для лишних файлов documents PR — Ticket 07: он меняет `land` после этого Ticket-а.
