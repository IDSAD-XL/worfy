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
  - evidence: commit pass · worfy-polish 84: round 2 result from the kept eval trace · - - · 302e08e3d
- [ ] Платный `node scripts/eval-harness.mjs --case reviewer-verdict` — case проходит 3 из 3 run-ов, grader
      `rejected-first` зелёный в каждом; команда, exit code, балл и цена — в «Итог».
- [ ] Платный `eval --changed origin/main` по остальным case-ам, которые покрывает `reviewer.md`, — на пороге или выше.
- [ ] `node harness/bin/start-context` — exit 0 (reviewer в пороге).
  - evidence: test-run pass · `node harness/bin/start-context` exit 0 (reviewer 12 188 tokens, 2 812 below the threshold) · mac - · bed7a8682
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


Раунд 1 ревью (вердикт REJECTED): платный `eval --changed origin/main --keep-temp` Orchestrator-а на head
`1f4556ab8` стоил 2.26 USD. Результаты: `reviewer-intended-breakage` 1.00, `reviewer-simplification` 1.00,
`reviewer-verdict` 0.89 (на `main` было 0.78). Grader `rejected-first` не прошёл в run-е 1 из 3.

Кто ломает первую строку — сам reviewer, не основная сессия eval-а. Это видно по сохранённому
transcript-у упавшего run-а (`trace.jsonl` run-а 1, копия Orchestrator-а `eval-traces-1757/run1-failed-trace.jsonl`):
- строка 46 — ответ агента `verify-01` (`tool_result` вызова Agent) начинается не с вердикта, а с абзаца
  о `qmd` («Profile shows `qmd.collections: []` … not something already settled by ADR/lesson»);
- строка 48 — основная сессия пишет этот ответ в `verdict.md` через Write без правок;
- в ответе вердикт `REJECTED: node --test exits 1, the report says 0; …` стоит второй строкой, а в конце,
  после строк «Ran: …» и «Could not verify: …», повторён ещё раз.

В run-ах 2026-11-09 первой строкой был `**REJECTED — …**` (так записано в описании тикета). Те run-ы
не сохранились: worktree-ы удалены после merge, а без `--keep-temp` `claude plugin eval` не оставляет
sandbox. Значит, и там разметку, скорее всего, добавлял reviewer: основная сессия копирует ответ без
правок. Правка `prompt.md` case-а не нужна.

Правка раунда 2, `harness/agents/reviewer.md`:
- в начале раздела «Answer format» сказано прямо: под линзой «implementer's report» вердикт стоит перед
  всеми строками ниже, то есть перед findings, строкой «что запускал» и строкой «что не удалось проверить»;
- в абзаце вердикта вторая строка `Wrong:` показывает порядок из transcript-а: сначала абзац о том, что
  запускал, что не проверил или что показал `qmd`, а вердикт в конце;
- в «Nothing comes before the verdict line» добавлено: никаких замечаний о `qmd` или ADR. Отдельное
  предложение говорит, что строки «что запускал» и «что не удалось проверить» идут после вердикта;
- «One verdict only» дополнено: вердикт не повторяют в конце ответа.

`agents-text.test.sh` закрепляет новые предложения и строку второго `Wrong:`. До правки `reviewer.md`
test был красным: 7 FAIL. После правки reviewer по `node harness/bin/start-context` весит 12 062 tokens,
на 2 938 ниже порога (exit 0).

Платный eval после раунда 2 запускает Orchestrator: пункты 2 и 3 «Готово, когда» открыты.

Раунд 2 ревью (вердикт REJECTED): платный `eval --changed origin/main --keep-temp` Orchestrator-а на head
`67df938ee` стоил 2.21 USD. `reviewer-intended-breakage` 1.00, `reviewer-simplification` 1.00,
`reviewer-verdict` 0.78: grader `rejected-first` не прошёл в 2 из 3 run-ов. Копии transcript-ов у Orchestrator-а —
`eval-traces-1757/r2-run1-failed-trace.jsonl` (строка 57, Write в `verdict.md`) и `r2-run3-failed-trace.jsonl`
(строка 46). Последнее сообщение reviewer-а начинается с комментария к результату последнего вызова tool-а:
«Confirms: ticket 01's own trail section … only lists …» и «This confirms a clear discrepancy.». Вердикт идёт
после него. В run-е 1 у вердикта ещё и метка: `VERIFIED/REJECTED: REJECTED: …`. Основная сессия копирует
сообщение без правок.

Правка раунда 3, `harness/agents/reviewer.md`, линза «implementer's report»:
- последнее сообщение — это ответ и ничего больше. Замечание о том, что показала последняя команда или
  последнее чтение файла, пишут в сообщении до последнего вызова tool-а или не пишут вовсе, но никогда
  перед вердиктом;
- третья строка `Wrong:` показывает это начало: `This confirms a clear discrepancy.` или `Confirms: …`
  на строке над вердиктом;
- в списке запрещённых меток перед вердиктом, кроме `Verdict:`, теперь `VERIFIED/REJECTED:`.

`agents-text.test.sh` закрепляет оба новых предложения, третью строку `Wrong:` и новую метку. До правки
`reviewer.md` test был красным: 5 FAIL. После правки reviewer по `node harness/bin/start-context` весит
12 188 tokens, на 2 812 ниже порога (exit 0).

Платный eval после раунда 3 запускает Orchestrator: пункты 2 и 3 «Готово, когда» открыты.
