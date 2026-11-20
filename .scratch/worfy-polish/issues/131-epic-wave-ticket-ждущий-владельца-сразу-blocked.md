# 131 — epic-wave: Ticket, который Orchestrator остановил ради решения владельца, сразу `blocked --waits owner`

Type: bug
Status: done 2026-11-20T12:18Z
PR: #2086
Blocked by: none
Source: решение владельца 2026-11-20 («со всем согласен»). Случай 2026-11-20: worfy-changes-view 03 ждал владельца
по issue #1513 (метка `pc-main-red`) и оставался `claimed`; Autopilot послал 2 continuation-а и потом поставил его
`blocked` с причиной «stuck: claimed after 2 continuations».

Кто: агент. Глубина review — `medium`. Это правка текста skill-а Harness-а — платформенный PR (ADR-0056): вердикт
Windows — job-ы Windows в CI.

## Что происходит

- Autopilot (автоматический запуск Wave-ов в worfy) считает застрявшими Ticket-ы Wave-а в состоянии `work`, то есть
  `claimed` (`src/shared/autopilot/cycle.ts:344`), и шлёт Orchestrator-у continuation — сообщение «продолжай». После
  предела continuation-ов он просит отложить Ticket. Ticket в `blocked` застрявшим не считается.
- Skill epic-wave не говорит, что делать с Ticket-ом, который Orchestrator сам остановил до решения владельца. Раздел
  2 («Questions for the owner do not stop the wave») описывает только развилку, которую Orchestrator решает сам по
  рекомендации. Ticket, которому нужен ответ владельца, остаётся `claimed`, и Autopilot тратит на него continuation-ы.
- `ticket block <epic> <NN> "<reason>" --waits owner` пишет `Status: blocked`, `Blocked reason:` и `Waits: owner`
  (`bin/TICKETS.md`); Autopilot показывает такой Ticket как ждущий владельца.

## Что делаем

1. В `harness/skills/epic-wave/SKILL.md` (раздел 2 или место, где Wave оставляет Ticket ждать человека): Ticket,
   который Orchestrator остановил ради решения владельца, сразу получает
   `ticket block <epic> <NN> "<reason>" --waits owner`, а не остаётся `claimed`. Причина называет вопрос и то, чего
   он ждёт (например, issue). Строка в списке state file «что ждёт владельца» и строка `blocked` в отчёте Wave-а —
   как у других блокировок.
2. Отделить от случаев, где Ticket законно остаётся `claimed`: `human-review` и `awaiting-merge` (PR открыт, ждёт
   людей, раздел про Pipeline) — их правило не меняется.
3. Ответ владельца получен — `ticket claim` снова, и Ticket идёт дальше.
4. Text contract test skill-а — `harness/bin/tests/epic-wave-ship-ticket.test.sh` (проверки `has`/`lacks` по
   тексту SKILL.md): добавить проверку, что текст требует `ticket block … --waits owner` для Ticket-а, остановленного
   ради решения владельца. Mutant — убрать фразу из SKILL.md — красный.
5. Eval: у skill-а есть eval-ы `harness/evals/epic-wave-tickets` и `harness/evals/epic-wave-old-form`, но в них нет
   Bash и нет случая с вопросом владельцу. Новый случай (Ticket, которому нужен ответ владельца; grader: Ticket
   `blocked` с `Waits: owner`, не `claimed`) — добавить, если scaffold может его поставить без настоящего GitHub;
   иначе причина в «Итог». Платный eval — по правилу eval-ов: сначала `--dry-run`, потолок на вызов.

## Готово, когда

- [ ] SKILL.md epic-wave требует `ticket block … --waits owner` сразу для Ticket-а, остановленного ради решения
      владельца; правило `human-review` / `awaiting-merge` не изменилось.
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0 (634 passed: the owner-stop paragraph of section 2 and the unchanged section 0 sentence on human-review and awaiting-merge) · mac - · 6587ed776acbdecf9af41c4057a61365456891c9
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0 (640 passed: the block runs in the ticket worktree, committed on its branch; section 0 sentence on human-review and awaiting-merge unchanged) · mac - · ecdf2cd3d2d7d5397adb758c24d4d1045b6ce6b7
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0 (650 passed: block after the implementer turn, ticket file only, main branch re-claim, Silent mode; human-review and awaiting-merge unchanged) · mac - · 11f2c3f6cd8ade57c37f25dd8d89fd75c83ff713
- [ ] Проверка в `epic-wave-ship-ticket.test.sh` зелёная, mutant (фраза убрана) — красный; весь файл — exit 0.
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0; exit 1 before the text change (10 failed); exit 1 on the mutant without the ticket block command (1 failed) · mac - · 6587ed776acbdecf9af41c4057a61365456891c9
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0; review round 1 checks exit 1 before the text change (6 failed); exit 1 on the mutant with the block from its own tree (1 failed) · mac - · ecdf2cd3d2d7d5397adb758c24d4d1045b6ce6b7
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0; review round 2 checks exit 1 before the text change (16 failed); exit 1 on each of two mutants (1 failed) · mac - · 11f2c3f6cd8ade57c37f25dd8d89fd75c83ff713
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0 (650 passed) and `bash harness/bin/tests/plugin-neutral.test.sh` exit 0 after the test comments were made project-neutral · mac - · 7cb7d77c5a3914a6345628707a223cf7f001f880
- [ ] Eval-случай добавлен и прогнан (exit code и счёт в «Итог»), или в «Итог» записано, почему его нет.
  - evidence: commit pass · worfy-polish/131: result section and evidence · - - · 3390cc7ab5f080b178ab52475daa279f3c8e1523
- [ ] Job-ы Windows CI на PR зелёные (платформенный PR).
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44731177907/job/136282089715 · ci - · 6a3fac24abdb9db83e9b5cee34d63049ec31548c

## Где в коде

- `harness/skills/epic-wave/SKILL.md`: раздел 2 «Dispatch», абзац «Questions for the owner do not stop the wave»;
  Pipeline-стадии `human-review` / `awaiting-merge`.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`.
- `harness/evals/epic-wave-tickets/` — образец eval-случая.
- `src/shared/autopilot/cycle.ts` — только читать: какие Ticket-ы Autopilot считает застрявшими.

## Итог

- Правило — `harness/skills/epic-wave/SKILL.md`, раздел 2, новый абзац сразу после «Questions for the owner do not stop
  the wave»: «A ticket stopped for the owner's answer is `blocked` at once». Когда ни один вариант не Orchestrator-у
  выбирать (деньги, удалённые данные, необратимый шаг, незаписанное направление) или Ticket держит то, что снимает только
  владелец (например, открытый issue), Orchestrator сразу запускает
  `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" block <epic> <NN> "<reason>" --waits owner`; причина называет вопрос и то, чего он
  ждёт. Строка в списке state file «что ждёт владельца», строка `blocked` в отчёте Wave-а и тот же `ticket block` в
  documents PR — как у других блокировок. Ответ владельца получен — `ticket claim <epic> <NN>` снова.
- Где запускать (review, раунд 1): в worktree самого Ticket-а, с commit-ом на его ветке, там же, где claim. worfy читает
  main ветку (`origin/main` при `pr-green-ci`, `src/main/workflow/main-ref.ts`) и поверх неё — commit-нутое дерево
  локальной ветки каждого worktree, чья ветка называет Ticket: `git worktree list --porcelain`
  (`src/main/workflow/reader.ts`, `ticketWorktrees`), затем `epic-status --json --ref <branch>` (там же, строка 185), а
  `branchOverrides` даёт статусу ветки перекрыть `open`/`work` из main. Читается локальная ветка, push не нужен;
  незакоммиченная правка и правка в дереве Orchestrator-а не видны, пока documents PR не влит. Ticket без worktree
  получает блок на main ветке тем же путём, что documents PR. Повторный claim после ответа — так же, в worktree Ticket-а с
  commit-ом. Первая редакция («из своего дерева») ссылалась на `setAsideText` Autopilot-а; эта ссылка снята.
- Ticket, чей PR ждёт людей Pipeline-а (`human-review`, `awaiting-merge`), по-прежнему остаётся `claimed`: абзац прямо
  отсылает к разделу 0, текст раздела 0 не менялся (его фразу держит отдельная проверка).
- Сначала красная проверка: `harness/bin/tests/epic-wave-ship-ticket.test.sh` до правки текста — exit 1, 10 проверок
  красные; после — exit 0, 634 проверки. Mutant (из SKILL.md убрана команда `ticket block … --waits owner`) — exit 1,
  красная ровно проверка этой команды. Раунд 1: новые проверки места (worktree Ticket-а, commit на его ветке, повторный
  claim, Ticket без worktree, нет «from its own tree») до правки — exit 1, 6 красных; после — exit 0, 640. Mutant (фраза
  «in the ticket's own worktree and commits it on the ticket's branch» заменена на «from its own tree») — exit 1, 1
  красная.
- Eval-случая нет — решено без владельца, подтвердить. Ticket разрешает пропуск, только если scaffold не может поставить
  случай без настоящего GitHub. Это условие не выполнено: scaffold может (вариант `demo-project.sh` с вопросом владельцу
  в Ticket-е 02, grader `regex` по файлу Ticket-а: `Status: blocked` и `Waits: owner`), и Bash у случаев с меткой `main`
  есть (`scripts/eval-harness.mjs` даёт им Bash, Write и Edit; посылка Ticket-а «нет Bash» неверна). Настоящая причина
  пропуска другая: новый случай на `skills/epic-wave/SKILL.md` меняет набор, который `--changed` выбирает для этого
  файла, а ровно три случая закрепляют contract test-ы runner-а — `test/contract/harness-evals-run.test.ts` (выбор
  `casesFor`, вызовы по одному на случай, бюджет 30 USD по вызовам `[30, 17.5, 5]`, набор `THREE`) и список `CASES` в
  `test/contract/harness-evals-shared.ts`. Добавить случай — значит переписать эти test-ы вне следа Ticket-а; предлагаю
  отдельный Ticket. Платный eval не запускался, расход 0 USD.
- Feature pages не правились: `docs/features/autopilot.md` и `autopilot-faults.md` описывают поведение worfy (продолжения
  и set-aside), оно не изменилось.

### Раунд ревью 2

- Правило разделено на два абзаца `SKILL.md:376-410`: сам блок («A ticket stopped for the owner's answer…») и
  «Where the owner-stop status is written».
- Блок — только после того, как ход implementer-а закончился (пришёл отчёт или агент остановлен): иначе commit в его
  worktree может захватить его недописанные файлы или столкнуться на `index.lock`. Commit берёт только файл Ticket-а:
  `git -C <worktree> commit -m "<message>" -- <ticket file>`.
- Ответ владельца: `ticket claim` в worktree Ticket-а с commit-ом. Ветка никогда не отменяет `blocked`/`done` из main
  (`src/main/workflow/reader.ts`, `branchOverrides`; ADR-0033), поэтому когда main уже говорит `blocked` (documents PR
  влил блок, или у Ticket-а не было worktree), ответ идёт и в main тем же путём documents: `ticket claim`, если Ticket
  продолжается в своём worktree, `ticket open`, если worktree нет, — Wave берёт только `open` Ticket-ы.
- Открытый PR: commit статуса сдвигает head PR-а при следующем push, но только внутри корня тикетов. Сверено с
  `harness/bin/land` (шапка, условия merge): такой head `land` принимает (diff PR-а вне корня тикетов тот же) и
  переносит отметку `review` с проверенного head-а; CI идёт заново, а отметки `check/<name>` не переносятся никогда —
  Orchestrator ставит их на новом head-е заново.
- Silent mode: `ticket block` и `ticket claim` из любой папки достаточно, статус сразу в Workflow folder, без commit-а.
- `setAsideText` (`src/shared/autopilot/continuation.ts:40-46`) тоже не говорит, где запускать `ticket block`, — та же
  ошибка. В одну строку с её unit test-ом правка не помещается: текст сообщения дословно закреплён ещё в
  `test/contract/autopilot-faults-codex.test.ts:150`, `test/contract/autopilot-faults-ladder.test.ts:47,192` и в
  `docs/features/autopilot-faults.md:254` (и переводе). Не правил; предлагаю отдельный Ticket.
- Проверки: новые проверки `epic-wave-ship-ticket.test.sh` до правки текста — exit 1 (16 красных), после — exit 0 (650).
  Mutant «When the main branch already says `blocked`» убран — exit 1 (1 красная); mutant `commit -am` вместо
  `-- <ticket file>` — exit 1 (1 красная).
