# 84 — Eval case reviewer-verdict красный: reviewer пишет вердикт жирным и через тире

Type: bug
Status: claimed 2026-11-09T22:52Z
Blocked by: —
Source: платный eval Orchestrator-а 2026-11-09 на origin/main (claude 2.1.289, модель claude-sonnet-5): case
`reviewer-verdict` — 0.78, grader `rejected-first` не прошёл в 2 из 3 run-ов. Строки перечитаны по main `c69ffd43b`.

## Что происходит

Eval case `harness/evals/reviewer-verdict` запускает одного агента `worfy:reviewer` с линзой «implementer's report» на
отчёт implementer-а, где тесты падают, хотя отчёт пишет exit code 0. Ответ reviewer-а сохраняется как есть в
`verdict.md`. Grader `rejected-first` проверяет первую строку regex-ом `^REJECTED:(?!.*VERIFIED)`.

В 2 из 3 run-ов первая строка — `**REJECTED — …**`: жирный шрифт вокруг вердикта и тире вместо двоеточия. Суть
вердикта верная (REJECTED), но формат не тот, и skill-ы, которые читают вердикт по первым символам ответа, его не
узнают. Текст `harness/agents/reviewer.md` уже запрещает разметку вокруг вердикта (:247–250), но правило стоит в
конце длинного абзаца, и модель его не держит.

## Что делаем

- Сначала по transcript-ам run-ов (`harness/evals/results/<время>-<call>/`) убедиться, что разметку добавляет сам
  reviewer, а не основная сессия eval-а, когда сохраняет ответ в `verdict.md`. Если разметку добавляет основная сессия —
  правка в `prompt.md` case-а, а не в `reviewer.md`; вывод — в «Итог».
- Переписать формат ответа в `harness/agents/reviewer.md`: первая строка — ровно `VERIFIED` или `REJECTED: <…>`,
  буквально, с двоеточием, без `**`, без тире вместо двоеточия. Правило вынести в начало раздела ответа отдельной
  короткой строкой и дать один пример правильной и одной неправильной первой строки (`**REJECTED — …**`).
- Grader не ослаблять: `^REJECTED:` — договор с skill-ами, которые разбирают вердикт.
- Это текст Harness-а: платный eval по правилам `rules-merge.md` (сначала `--dry-run`, предодобрено до 100 USD).

## Готово, когда

- [ ] «Итог»: кто добавляет разметку (reviewer или основная сессия), со ссылкой на transcript run-а.
- [ ] Платный `node scripts/eval-harness.mjs --case reviewer-verdict` — case проходит 3 из 3 run-ов, grader
      `rejected-first` зелёный в каждом; команда, exit code, балл и цена — в «Итог».
- [ ] Платный `eval --changed origin/main` по остальным case-ам, которые покрывает `reviewer.md`, — на пороге или выше.
- [ ] `node harness/bin/start-context` — exit 0 (reviewer в пороге).
  - evidence: test-run pass · `node harness/bin/start-context` exit 0 (reviewer 11 923 tokens, 3 077 below the threshold) · mac - · 792242aae
- [ ] `ci-ok` на PR зелёный.

## Где в коде

- `harness/evals/reviewer-verdict/graders/rejected-first.md:4` — `pattern: '^REJECTED:(?!.*VERIFIED)'`, цель —
  `verdict.md` (:3).
- `harness/evals/reviewer-verdict/prompt.md:10` — задание основной сессии: запустить `worfy:reviewer` и сохранить его
  ответ «как есть» в `verdict.md`; :4 — `runs: 3`.
- `harness/agents/reviewer.md:239–252` — абзац «The verdict is the first line of the answer»; запрет разметки —
  :247–250.

## Вне скоупа

- Другие линзы reviewer-а и их формат ответа.
- Разбор вердикта в skill-ах `ship-ticket` и `epic-wave`.

## Итог

Правка — текст агента, grader не тронут: `^REJECTED:(?!.*VERIFIED)` остаётся договором с skill-ами,
которые разбирают вердикт.

- `harness/agents/reviewer.md`, линза «implementer's report»: правило первой строки теперь открывает
  отдельный абзац короткой строкой — вердикт простым текстом, `VERIFIED` или `REJECTED:` и список
  неподтверждённых утверждений; за ним строка `Right:` с правильной первой строкой и строка `Wrong:` с
  неправильной (`**REJECTED — …**`: жирный шрифт и тире вместо двоеточия). Жирный заголовок
  «**The verdict is the first line of the answer:**» убран: жирный шрифт рядом с вердиктом был образцом,
  которому модель могла следовать. Фраза о первых символах ответа называет запреты явно: метка, жирный
  шрифт, курсив, знак заголовка, тире вместо двоеточия.
- `harness/bin/tests/agents-text.test.sh`, раздел 13: новые предложения в списке «весь раздел по
  предложениям» и проверка, что правило стоит отдельным абзацем, а строки `Right:` и `Wrong:` — отдельными
  строками.
- `case`-ы, которые выбирает `node scripts/eval-harness.mjs --changed origin/main --dry-run` (exit 0):
  `reviewer-intended-breakage`, `reviewer-simplification`, `reviewer-verdict`.

Кто добавлял разметку — не проверено: run-ы 2026-11-09 (`2026-11-09T21-30-21-240Z-main-reviewer-verdict`
в worktree тикета multi-repo 07 и повтор `2026-11-09T22-28-26-601Z` на копии `main`) на диске не
сохранились — worktree-ы удалены после merge, а `claude plugin eval` без `--keep-temp` не оставляет
sandbox run-а (workspace и `trace.jsonl`). Журналы Orchestrator-а показывают только итог grader-а
(«pattern not found in file verdict.md» в run-ах 2 и 3). Поэтому правка — по основному пути тикета, в
`reviewer.md`; `prompt.md` case-а не тронут. Платный run Orchestrator-а с `--keep-temp`
(`node scripts/eval-harness.mjs --case reviewer-verdict --keep-temp`) оставит `trace.jsonl`: в нём видно,
какой первой строкой ответил агент `verify-01` и что основная сессия записала в `verdict.md`.

Платный eval не запускался (его запускает Orchestrator): пункты 2 и 3 «Готово, когда» открыты.
