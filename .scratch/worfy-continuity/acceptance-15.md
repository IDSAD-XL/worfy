# Приёмка Epic-а worfy-continuity (Ticket 15, шаг 1): доказательства

Проверено 2026-11-19 на `origin/main` 03ddd3355, только чтение. Источники: `.scratch/worfy-continuity/spec.md` («Готово,
когда», «Вопросы владельцу», «Решено без владельца»), Ticket-ы 01–16 (поле `PR:`, «Итог» у 01, 12, 13, 14),
`gh pr view`, `gh api …/check-runs`, verdict-ы в `~/Stuff/worfy-orch/verdict/`, land state-ы
`land-275.json`–`land-290.json`, eval log-и в `~/Stuff/worfy-orch/scratch/cont-w2/`.

## CI и verdict по PR

`ci-ok` взят двумя путями: на head PR-а (`gh pr view <N> --json statusCheckRollup`) и на merge commit в `main`
(`gh api …/commits/<sha>/check-runs`). Последний verdict — тот, чей файл `.posted.<sha>` равен head PR-а. У #1970–#1972
файлов verdict-а нет: verdict VERIFIED стоит комментарием в PR, написан до merge на его head. У #1999 у r2 нет файла
`.posted`, но delta r2 кончается на head 7706e9007.

| Ticket | PR | head PR | ci-ok на head | merge commit в main | ci-ok на main | последний verdict |
|---|---|---|---|---|---|---|
| 01 spike compaction и оборванный вызов | #1972 | 03a780a26 | SUCCESS | bdd70bfed | **failure** (см. ниже) | комментарий в PR, VERIFIED |
| 02 Journal как checkpoint Run-а | #1971 | edd6555b1 | SUCCESS | 6f75f6d38 | success | комментарий в PR, VERIFIED |
| 03 запись `live-sessions.json` | #1970 | 84eb55f96 | SUCCESS | e63d83449 | success | комментарий в PR, VERIFIED |
| 04 grace при выходе, «Quitting worfy» | #1979 | 27cf00d1d | SUCCESS | b8ff57f2d | success | 1979-r2 VERIFIED, с долгом (ниже) |
| 05 продолжение Session | #1987 | 82094242e | SUCCESS | 370fb779f | success | 1987-r2 VERIFIED |
| 06 продолжение Run-а | #1988 | b0f3f8d1b | SUCCESS | 9a0592e58 | success | 1988-r1 VERIFIED |
| 07 метка unknown side effects | #1994 | 8d92616cd | SUCCESS | 2709b5dac | success | 1994-r2 VERIFIED |
| 08 "Restart now" во время работы | #1993 | 140689882 | SUCCESS | bf58f18fb | success | 1993-r2 VERIFIED |
| 09 Wait `restart` в Run history | #1981 | 743c81036 | SUCCESS | 55d9eadda | success | 1981-r1 VERIFIED |
| 10 инструкции summary | #1976 | 7e817a6dc | SUCCESS | ed0ea130f | success | 1976-r1 VERIFIED |
| 11 hook ветки `compact` | #1982 | 0c2b36f62 | SUCCESS | 7f5962fbc | success | 1982-r1 VERIFIED |
| 12 `WORFY_EPIC`, строка «Context compacted» | #1991 | 99d23491a | SUCCESS | 8e47054df | success | 1991-r2 VERIFIED |
| 13 eval `compaction-state` | #1996 | bc6da0105 | SUCCESS | b910f55a8 | success (попытка 2) | 1996-r3 VERIFIED |
| 14 документы, ADR-0108, CONTEXT.md | #1999 | 7706e9007 | SUCCESS | c3295fc3b | success (только документы) | 1999-r2 VERIFIED |
| 16 распознавание unknown side effects | #1977 | 92292b416 | SUCCESS | 4f13b8153 | success | 1977-r1 VERIFIED, с долгом (ниже) |

На head каждого PR, кроме #1970–#1972, ещё зелёные status context-ы `check/windows` и `review`; у #1970–#1972 —
только `review`.

Красный `ci-ok` на bdd70bfed (merge Ticket-а 01, run https://github.com/IDSAD-XL/worfy/actions/runs/44211591317,
попытка 1): упал один test в `windows (2/3) / full-suite` — `test/contract/autopilot-faults-github.test.ts:156` «gh
hangs the whole Run: …», «timed out waiting for the last read of the PRs» (1 failed, 6958 passed). PR #1972 менял только
`scripts/spikes/compaction/` и Ticket. Этот test он не трогал, и на следующих merge test зелёный. Повторного запуска на
bdd70bfed не было.

Долги из verdict-ов:
- #1979: при выключении системы halt пропускается, и `tasks-killed` на этом пути пишет только `Autopilot.recordQuit`.
  Test-а на это нет (low).
- #1977: функция считает каждый вызов без результата среди переданных событий, а не только из оборванного turn-а.
  Закрыт в Ticket-е 05 test-ом `test/contract/continuity.test.ts:274` «a call without a result of an earlier turn does
  not count: only the turn the restart cut off is checked».

### CI macOS и Windows на SHA последнего merge (пункт 7 spec-а)

- **Последний merge Epic-а — c3295fc3b (#1999, только документы).** Run
  https://github.com/IDSAD-XL/worfy/actions/runs/44309288010: `changes`, `lint-typecheck`, `ci-ok` — success. Все
  остальные job-ы skipped: `linux-tests`, `macos-tests`, `macos-e2e`, `macos-package`, `windows`, `windows-e2e`.
  Причина — разбор CI на PR только с документами. Буквально по пункту 7 зелёных job-ов macOS и Windows на этом SHA нет:
  они не запускались.
- **Последний merge с кодом — b910f55a8 (#1996).** Run https://github.com/IDSAD-XL/worfy/actions/runs/44308332739,
  **попытка 2**. Все job-ы success:
  - macOS: `macos-tests`, `macos-e2e (1/2)`, `macos-e2e (2/2)`, `macos-package`;
  - Windows: `windows (1/3)`, `(2/3)`, `(3/3)`, `(harness-scripts 1/2)`, `(harness-scripts 2/2)` / full-suite и
    `windows-e2e (1/4)`…`(4/4)`;
  - `linux-tests (1/4)`…`(4/4)`, `ci-ok`.
- **Попытка 1 того же run-а была красной.** Упали два job-а:
  - `macos-e2e (1/2)`: test `test/e2e/terminal-ai-request.spec.ts:94` — не из этого Epic-а;
  - `macos-tests`: `bin/tests/land.test.sh` «exits 0 with an empty HOME», timeout 720 с (retry x1).
  В том же job-е попытки 1 `harness/hooks/tests/session-hooks.test.sh` упал на try 1 of 2 на проверке «after-compact:
  without WORFY_EPIC, the first Epic in play (a claimed ticket)» и прошёл на try 2. Это shell test пункта 8. Ticket-а на
  эту flaky-проверку на `main` нет.
- **Что e2e Epic-а действительно шли на b910f55a8** (по log-ам job-ов попытки 2):
  - `macos-e2e (2/2)`: 275 passed, 2 flaky (не из Epic-а: `edit-profile.spec.ts:98`, `layers-popover.spec.ts:250`),
    2 skipped. В нём `autopilot-faults.spec.ts:86`, `:159`, `:219`, `:271`, `autopilot-quit.spec.ts:35`,
    `session-restart.spec.ts:138`, `:160` — все ✓.
  - Windows: `windows-e2e (1/4)` — 135 passed, в нём `autopilot-faults.spec.ts:86`, `:159`, `:219`, `:271` и
    `autopilot-quit.spec.ts:35`. `windows-e2e (4/4)` — 122 passed, в нём `session-restart.spec.ts:138`, `:160`.
- **Текущий код main — 74c26b5ea** (#2021, после Epic-а). Run https://github.com/IDSAD-XL/worfy/actions/runs/44418958834,
  попытка 1: все job-ы macOS и Windows success. На 03ddd3355 (только документы) они skipped.

## Пункт → доказательство

Пунктов «Готово, когда» без (manual) — 10. Доказательства есть у 9. У одного нет: пункт 8, половина eval — «лучше»
не показано. Пункты 1 и 2 сформулированы «на Mac Stable»: автоматическая половина у них есть, ручная остаётся за
шагом 3 Ticket-а 15.

| # | Пункт spec-а | PR | Test-ы на `origin/main` (file:line, название) | Eval / прочее |
|---|---|---|---|---|
| 1 | "Restart now" посреди Run-а на Mac Stable: тот же Run продолжается, `run-suspended` → `run-continued`, команда оборванной Wave снова не ушла, Run history — один Run с Wait-ом `restart` | #1993 (08), #1979 (04), #1988 (06), #1981 (09), #1971 (02) | `test/contract/update-restart.test.ts:191` «during a turn is no refusal: the press is the consent to the grace, and worfy quits through the coordinator with the cause update»; `test/unit/update-quit.test.ts:31` «goes through the quit coordinator with the cause update, not app.quit()»; `test/contract/update-restart-continuity.test.ts:55` «a Run in the Wait for the Limits does not hold "Restart when idle": worfy restarts, restart.json says update, and the Run goes on after update»; `test/contract/autopilot-faults-restart.test.ts:114` «a quit in the middle of a Wave: the start continues the same Run — run-continued, one new Wave with the cut-off Tickets as resumed — and the cut-off Wave is not sent again»; `test/unit/flight-recorder-journal.test.ts:564` «makes run-suspended {cause: update} … run-continued one Run with a Wait `restart` inside…»; `test/unit/flight-recorder-span-names.test.tsx:34` «is «restart (<after>)» for each cause run-continued gives»; `test/contract/work-track-service.test.ts:205` «gives the Wait `restart` of a continued Run as a fact of that Run…» (Wait `restart (update)`, 3 мин); e2e `test/e2e/update-toasts.spec.ts:125` (во время работы — "Restart when idle" и "Restart now") | Ручная половина — Mac Stable, шаг 3 Ticket-а 15 |
| 2 | Выход посреди Wave с идущим `git push`: ждёт не дольше 60 с, окно называет команду, Quit now выходит сразу | #1979 (04); ожидание вызовов Subagent-ов — #1994 (07) | `src/main/quit-grace.ts:44` `GRACE_MS = 60_000`; `test/contract/autopilot-faults-quit.test.ts:104` «with git push without a result: the quit waits for it no longer than GRACE_MS by the test clock, and the window names it»; `:125` «a Subagent holds gh pr merge without a result…»; `:159` «the result of git push comes before the grace ends: the quit goes on right after it»; `:173` «Quit now: the quit goes on at once»; `test/unit/quitting-dialog.test.tsx:62` «names the calls main waits for, … and the time left; Quit now asks main to quit at once»; e2e `test/e2e/autopilot-quit.spec.ts:35` «quitting while the Wave runs git push: «Quitting worfy» names the command with the time left, Quit now quits at once, and the Run is suspended» | Ручная половина — Mac Stable |
| 3 | SIGKILL посреди Wave и старт меньше чем через час: Run продолжается сам; e2e закрепляет это вместо старого ожидания | #1988 (06) | e2e `test/e2e/autopilot-faults.spec.ts:86` «the app killed with SIGKILL in the middle of a Wave and started again: the same Run goes on in its own journal, with run-continued after crash and one new Wave command — 01 continued and 02» (заканчивается `checkRecovery`). Старой строки «nothing goes to the Orchestrator at the start» в файле нет. `test/contract/autopilot-faults-restart.test.ts:143` «a crash without run-suspended: …run-continued after crash»; `test/unit/autopilot-restart.test.ts:15` «continues a Run cut off within the hour, with fewer than two continuations in it» | e2e зелёный на macOS и Windows (b910f55a8) |
| 4 | Session Node в turn-е при выходе: после старта одно сообщение-продолжение, очередь на месте; старше часа — chip «Interrupted by restart» и Continue | #1987 (05), #1970 (03) | `test/contract/continuity.test.ts:214` «quit in a turn with a message queued: after the start one continuation message goes, the queue waits behind it…»; `:258` «a held queue comes back held…»; `:318` «cut off more than an hour before the start: the chip, and nothing starts»; `:285` «a git push without a result: no continuation, the chip «Interrupted by restart»…»; `:463` (Codex) «goes on through thread/resume and one message»; `test/unit/continue-plan.test.ts:887` describe «restartText (worfy-continuity ticket 05)»; e2e `test/e2e/session-restart.spec.ts:138` «a Session Node killed with worfy in a turn goes on after the start with one continuation message»; `:160` «started more than an hour after the kill: «Interrupted by restart», and Continue sends the continuation» | e2e не проверяет очередь: очередь — только contract |
| 5 | Ticket с внешней командой без результата не идёт в продолженную Wave; метка и toast; «Checked, include» возвращает | #1977 (16), #1988 (06), #1994 (07) | `test/contract/autopilot-faults-restart.test.ts:258` «an implementer held gh pr merge without a result: after the start its Ticket is not in the Wave and stays claimed»; `:293` «…the journal says unknown-side-effects with the Ticket and the command, and the state marks it»; `:320` «Checked, include while the continued Run goes on: the next Wave takes the Ticket along as resumed»; `:354` (Discard и метка); `test/unit/ticket-card.test.tsx:308` «a card in work that the Autopilot state marks draws «unknown side effects» with the calls in its tooltip…»; `test/unit/autopilot-unknown-side-effects.test.tsx:103` «one action toast per mark…», `:111` «"Checked, include" asks main for the Ticket…»; `test/unit/autopilot-invariants.test.ts:214` (I10); e2e `test/e2e/autopilot-faults.spec.ts:159` «the app killed while the implementer of 01 merges its PR: the continued Run leaves 01 out with the mark «unknown side effects», its tooltip and toast name the call, and «Checked, include» takes it back» | — |
| 6 | Третий перезапуск за час сам не продолжает: `cut off by restart` с Resume и Discard | #1988 (06) | `test/unit/autopilot-restart.test.ts:25` «leaves the third continuation within the hour to a person; older ones do not count»; `test/contract/autopilot-faults-restart.test.ts:203` «the third start within the hour: no continuation, the line says cut off by restart, and Resume continues the Run»; `:233` (Discard → `run-stopped discarded`); `test/unit/autopilot-cut-off-line.test.tsx:116` «says when the restart cut it off, with Resume and Discard beside it, one toast, and Autopilot inactive»; `:127`; e2e `test/e2e/autopilot-faults.spec.ts:219` «a Run the restart cut off for the third time within the hour: …Resume and Discard, nothing goes to the Orchestrator, and Resume continues it» | Текст строки — `src/shared/ipc/autopilot.ts:380` |
| 7 | Recovery invariants обновлены (И4, И6), зелёные во всех Fault scenario-ах; job-ы CI macOS и Windows зелёные на SHA последнего merge | #1971, #1979, #1988, #1994 | `test/autopilot-invariants.ts:10`–`:16` (I4: quit/Update/shutdown → `run-suspended`, никогда `app-quit`; `run-continued`), `:21`–`:23` (I6: тот же Run в своём Journal-е), `:30` (I10, новое). `test/unit/autopilot-invariants.test.ts:85` «has a broken fixture for every rule I1–I8 and I10»; `:167` (I4 и quit), `:180` (I4 и `run-continued`), `:199` (I8), `:209` (I6 и Discard). `checkRecovery` вызывают 9 contract-файлов `test/contract/autopilot-faults-*.test.ts` и `autopilot-checkpoint.test.ts`, плюс e2e `autopilot-faults.spec.ts` и `autopilot-quit.spec.ts` | CI — раздел выше: b910f55a8 зелёный со 2-й попытки; c3295fc3b — macOS/Windows skipped; 74c26b5ea зелёный с 1-й попытки |
| 8 | Compaction: shell test-ы hook-а зелёные; eval `compaction-state` показывает, что с hook-ом probes о Ticket-е, пунктах «Готово, когда» и следующем шаге отвечены лучше | #1976 (10), #1982 (11), #1991 (12), #1996 (13) | `harness/hooks/tests/session-hooks.test.sh:288` (раздел after-compact): `:332` «the Orchestrator (main checkout) gets wave-brief of WORFY_EPIC», `:336` «without WORFY_EPIC, the first Epic in play», `:357` «an implementer … gets its ticket file and git status --short», `:375` «outside a registered project — silent»; `harness/hooks/tests/rules-hooks.test.sh:775` «PreCompact/compaction: the part as plain text on stdout…», `:782` (в пределе), `:795` «compaction.md: the seven summary sections, in order», `:811` «common.md: the line for after a compaction». В CI их запускает `test/harness-scripts-suite.ts:1` (job-ы `macos-tests`, `windows (harness-scripts …)`, linux) | **Shell test-ы:** зелёные на b910f55a8 и 74c26b5ea; flaky на try 1 — раздел CI. **Eval** (раунд 3, head 98a0cc68d; итоговые строки сверены с `eval-1996.log:61`, `:121`): с hook-ом overallScore 0,64, без hook-а 0,73, casesPassed 0 из 1 у обоих, exit 1 у обоих, 1,66 + 1,38 USD. По probe-ам — из «Итог» Ticket-а 13: Ticket 1/3 против 1/3, пункты «Готово, когда» 1/3 против 0/3, следующий шаг 1/3 против 3/3. **«Лучше» не показано: нет доказательства** для этой половины (подробнее ниже) |
| 9 | Session view показывает строку «Context compacted» | #1991 (12) | `test/unit/claude-compact-line.test.ts:10` «names the trigger and the tokens before and after», `:16` (без второго числа), `:25` (числа как в context meter); `test/contract/agent-compacted-line.test.ts:35` «shows a line with the trigger and the tokens, and without the second number when Claude Code does not tell it»; Codex — `test/contract/codex-session.test.ts:976` «/compact runs thread/compact/start…», ожидание notice «Context compacted» на `:993`; текст — `src/shared/vendors/claude/events.ts:196` | e2e нет. Снимок экрана не сделан («Итог» 12) |
| 10 | Страницы Feature en и ru, Amendment к ADR-0050, новый ADR и термины CONTEXT.md влиты | #1999 (14); английские страницы — в PR своих Ticket-ов | Test-а на смысл текста нет. В CI идёт `scripts/check-feature-docs.mjs` (часть `pnpm lint`, `package.json:17`) | `docs/adr/0108-work-continues-after-a-restart-of-worfy.md:1`; ADR-0050 — `## Amendments` `:89`, запись `:100`; ADR-0010 — Amendment `:36`. CONTEXT.md: `:128` (Wait, причина `restart`), `:139` **Unknown side effects**, `:282` **Interrupted by restart**, `:402` **Recovery invariant** (И1–И10). Переводы `docs/features/ru/`: autopilot, autopilot-faults, flight-recorder, sessions, storage-and-diagnostics, updates, work-track — с меткой commit `b82c4d25`; у `ru/harness.md:3` метка `same-pr` вместо commit |

## Что покрыто чем: честно

- **Пункт 1.**
  - Автоматически проверено по частям, контрактами. "Restart now" во время turn-а идёт через координатор выхода с
    причиной `update`. Run в Wait Limits переживает Update: `run-continued after update`. Продолжение того же Run-а без
    повтора Wave проверено на выходе, не на Update. Wait `restart (update)` в Run history и Work track — unit и contract.
  - e2e есть только на кнопки toast-а Update (`update-toasts.spec.ts:125`).
  - Ни один e2e не жмёт "Restart now" посреди Run-а и не проходит настоящий перезапуск через swap-helper Update-а. Экран
    Run history после перезапуска e2e тоже не открывает. Это только руками, на Mac Stable.
- **Пункт 2.**
  - 60 с проверены по часам test-а (contract).
  - e2e на macOS и Windows проверяет окно, название команды, время и Quit now, но не полное ожидание 60 с.
  - Настоящий `git push` на Stable — только руками.
- **Пункты 3, 5, 6** покрыты e2e на macOS и Windows, плюс contract и unit. Ручная часть — из Ticket-а 15.
- **Пункт 4.**
  - Продолжение одним сообщением, chip и Continue — e2e на macOS и Windows.
  - Очередь «на месте» и held-очередь — только contract (`continuity.test.ts:214`, `:258`).
- **Пункт 7.**
  - Invariants обновлены (I4, I6) и добавлен I10. Unit test-ы правил и `checkRecovery` в каждом Fault scenario — зелёные
    в CI.
  - Буква пункта: «на SHA последнего merge». На c3295fc3b job-ы macOS и Windows не запускались, только документы.
    Зелёные они на b910f55a8 — последнем merge с кодом, со 2-й попытки run-а — и на нынешнем 74c26b5ea с 1-й попытки.
  - Кто запустил 2-ю попытку на b910f55a8, по файлам не видно. Упавшие в 1-й попытке test-ы — не из Epic-а.
- **Пункт 8.**
  - Shell test-ы зелёные. Проверка `session-hooks.test.sh` «first Epic in play» один раз упала на macOS и прошла на
    повторе файла. Это кандидат во flaky test, Ticket-а нет.
  - **Eval не показал «лучше».** С hook-ом overallScore ниже (0,64 против 0,73). Probe о Ticket-е — поровну (1/3 и
    1/3). Probe о пунктах «Готово, когда» — лучше (1/3 против 0/3). Probe о следующем шаге — хуже (1/3 против 3/3).
  - «Итог» Ticket-а 13 объясняет это так: run 2 с hook-ом не ответил («Autocompact is thrashing»), вероятно из-за
    порога кейса 5 %. Проверить это нельзя: trace удалён.
  - Решение без владельца 1 считает половину compaction сделанной, «когда eval 13 записал числа». Пункт spec-а требует
    «лучше». Это расхождение решает владелец.
  - Числа по probe-ам раунда 3 сверить с файлами нельзя. `aggregate-result.json` раунда 3 лежали в worktree 13 и во
    временной папке, обе удалены. В `cont-w2/eval-1996-results/` лежит раунд 1 (0,96 / 0,41, grader-ы до правки).
    Итоговые строки раунда 3 в `eval-1996.log` совпадают с «Итог».
- **Пункт 9.**
  - Unit и contract, e2e нет.
  - После повторного открытия Session из транскрипта строки нет («Итог» 12).
  - Снимок экрана не сделан: e2e на Mac агентам запрещены. Строку увидит владелец на Mac Stable.
- **Пункт 10.**
  - Только наличие текста и `check-feature-docs` в lint.
  - Метка `ru/harness.md` — `same-pr`. Раздел On Codex там отстаёт; «Итог» 14 вынес его из рамок.

## Решения без владельца

Источники: spec («Вопросы владельцу» Q1–Q5 и «Решено без владельца» 1–5) и «Итог» Ticket-ов 01, 12, 13, 14. Все
решения spec-а приняты 2026-11-17 по указанию «сразу запускай», с пометкой «подтвердить».

1. Q1 (а): "Restart now" и во время работы, рядом с "Restart when idle". Меняет решение 7 worfy-update. Ticket-ы 04, 08.
2. Q2 (а): выход ждёт до 60 с внешних команд, с окном «Quitting worfy» и Quit now. Ticket-ы 04, 07.
3. Q3 (а): оборванное меньше часа назад продолжается само, не больше 2 раз за час; старше — по кнопке. Ticket-ы 05, 06.
4. Q4 (а): Ticket с unknown side effects всегда ждёт человека («Checked, include»), без сверки git и GitHub. Ticket-ы
   16, 05, 06, 07.
5. Q5 (а): daemon (шаг 2) — после замеров этого Epic-а, вне Epic-а.
6. Один Epic, а не два (возражение 3 critic-а). Половина compaction считается сделанной, когда влиты 10–12 и eval 13
   записал числа; Windows для неё не нужен.
7. Ticket 16 (отдельное распознавание) вместо переноса отказа в 05 и 06, по возражению 1 critic-а.
8. Ожидание вызовов Subagent-ов при выходе — в Ticket-е 07, а не в 04.
9. Spike 01 ведёт агент на самой дешёвой модели (haiku). Цена ≈ 1,45 USD, из них 1,41 USD — первый неудачный прогон.
10. Английскую страницу Feature правит Ticket своего поведения. Ticket 14 держит ru, Amendment к ADR-0050, новый ADR и
    CONTEXT.md.
11. Spike 01 решил: заглушку `tool_result` worfy не пишет, вызов с результатом «Tool call interrupted…» считается
    вызовом без результата. Инструкции summary идут через hook `PreCompact`. Ответы spike-а о Codex — по документации,
    без запуска.
12. Ticket 12: `WORFY_EPIC` задаёт Orchestrators при старте unattended Session, а не `launch.ts`. Ручной «Run wave» в
    уже запущенный Orchestrator Epic-а не получает: hook берёт Epic ветки или первый из Epics in play.
13. Ticket 12, известное ограничение, не исправлено: первая Wave следующего Epic-а очереди может уйти в ту же Session с
    `WORFY_EPIC` прежнего Epic-а. После compaction hook тогда даёт wave-brief не того Epic-а.
14. Ticket 12: дописка к system prompt называет только Epic, без Ticket-ов Wave. У Codex `compact_prompt` — полная
    замена prompt-а, и для thread-ов worfy она перекрывает `compact_prompt` из config.toml пользователя.
15. Ticket 12: строки «Context compacted» нет после повторного открытия Session из транскрипта; снимок строки отложен на
    приёмку.
16. Ticket 13: auto-compaction вместо `/compact` и вес grader-а `compacted` 3. Тег `alone`: кейс запускается только
    отдельным `--case compaction-state`.
17. Ticket 13: hook не показал «лучше» (0,64 против 0,73). Изменение hook-а не заведено. «Вне скоупа» Ticket-а 13
    предлагает новый Ticket, если числа плохие; этот Ticket не заведён.
18. Ticket 14: ADR-0010 получил Amendment вместо строки в ADR-0108. Восемь страниц ru сверены целиком, а не только по
    diff-у. Английская страница не говорит, что строка Resume/Discard стоит только в рамке своего Epic-а; это записано в
    ADR-0108.
19. Файлы вне списка Ticket-ов 12 и 13 согласованы с Orchestrator-ом. Списки — в «Итог» этих Ticket-ов.

## Ручные проверки

Шаг 2 Ticket-а 15 идёт до них: Orchestrator обновляет Stable до `main` с Ticket-ами 01–14 и 16, с согласия владельца.
Нужен тестовый Project с Epic-ом минимум из двух Wave-ов, Autopilot на Claude Code.

Где смотреть:
- **Journal Run-а** — `~/Library/Application Support/worfy/autopilot/<run>.jsonl` на Mac,
  `%APPDATA%\worfy\autopilot\<run>.jsonl` на Windows.
- **Run history** — «⋯» у строки Autopilot → "Run history", или Command palette → "Open Run history".
- **Строка Autopilot** — в рамке Epic-а на Canvas.

### Mac Stable — 1. "Restart now" посреди Run-а

1. Запустить Autopilot на Epic-е и дождаться строки `Wave 1 · running`.
2. Получить готовую сборку Update. Чип версии → "Update worfy" → дождаться "Restart now". Во время работы рядом стоит
   "Restart when idle"; жать **"Restart now"**.
3. Если у агентов идёт внешняя команда, появится «Quitting worfy». Иначе worfy выходит сразу и перезапускается.
4. Должно получиться:
   - после старта та же рамка Epic-а показывает `Wave N · running`, без кнопок Resume и Discard;
   - Journal — тот же файл `<run>.jsonl`, нового нет. В нём есть `run-suspended` с `"cause":"update"`, затем
     `run-continued` с `"after":"update"`;
   - `wave-started` оборванной Wave не повторился. Следующая Wave несёт её Ticket-ы в работе как продолженные;
   - Run history: один Run, на его дорожке Wait `restart (update)` длиной во время перезапуска.
5. Session Node, который был в turn-е, получает в Session view строку `worfy: restarted at HH:MM (update), sent
   "continue"`. Session Orchestrator-а, которой владеет Run, этой строки не получает: её продолжает Run
   (`test/contract/continuity.test.ts:410` «a Session a Run owns is left to the Run»).

### Mac Stable — 2. Выход посреди Wave с `git push`

1. Дождаться, пока implementer или Orchestrator выполняет `git push`. Медленный remote или большой push дают время.
2. Выйти из worfy: ⌘Q или меню worfy → Quit.
3. Должно получиться:
   - окно **Quitting worfy** с текстом «worfy waits for this command of the agents to finish, so that none is cut off
     halfway:», в списке — команда `git push …`;
   - строка «worfy quits in M:SS at the latest. Autopilot runs continue after the next start.» со счётом от 1:00;
   - если push закончился раньше — окно уходит само и worfy выходит. Иначе выход наступает не позже 60 с.
4. Повторить и нажать **Quit now**. Окно сразу показывает «Stopping the agents…», и worfy выходит.
5. В Journal-е Run-а последняя строка — `run-suspended` с `"cause":"quit"`, `run-stopped` с `app-quit` нет.

### Mac Stable — 3. Kill worfy посреди Wave

1. Посреди Wave, лучше во время `gh pr merge` или `git push` у implementer-а, убить worfy: `kill -9 <pid>` по точному pid.
2. Запустить worfy меньше чем через час.
3. Должно получиться:
   - Run продолжился сам: `Wave N · running`; в Journal-е `run-continued` с `"after":"crash"`;
   - если у implementer-а был вызов без результата, его Ticket в новой Wave не участвует. На карточке Ticket-а —
     «unknown side effects», tooltip «`<команда>` may or may not have run. Check it, then choose Checked, include»;
   - toast «Unknown side effects: `<команда>` may or may not have run (Ticket NN of <epic>)» с кнопкой
     **Checked, include**. В Journal-е — `unknown-side-effects`.
4. Проверить руками, дошла ли команда: ветка на remote, PR влит или нет. Затем нажать **Checked, include**. Метка
   уходит, в Journal-е — `side-effects-checked`, следующая Wave берёт Ticket как продолженный.

Без вызова у implementer-а метки не будет; тогда этот пункт проверяется только на продолжении.

Дополнительно, по пункту 9 spec-а: в любой длинной Session дать `/compact` или дождаться auto-compaction. В Session view
должна встать строка `Context compacted (manual|auto) · NNNK → NNK`. Снимок этой строки отложен Ticket-ом 12 на
приёмку.

### Windows — 4. Выход посреди Wave и старт

1. На Windows Stable запустить Autopilot, дождаться `Wave 1 · running`.
2. Выйти: File → Exit (роль `quit`) или закрыть окно — без окон worfy на Windows выходит
   (`src/main/index.ts:283`). Если идёт внешняя команда, появится «Quitting worfy», как на Mac.
3. Запустить worfy снова меньше чем через час.
4. Должно получиться: тот же Run продолжается сам (`Wave N · running`). В
   `%APPDATA%\worfy\autopilot\<run>.jsonl` — `run-suspended` (`quit`), затем `run-continued` (`quit`). Нового Journal-а
   нет. Run history — один Run с Wait-ом `restart (quit)`.

### Что ещё видно руками, если случится

- Третий перезапуск за час, или старт позже чем через час: строка `cut off by restart · HH:MM` с **Resume** и
  **Discard**, и toast «The restart of worfy at HH:MM cut off the Autopilot Run of <epic>: Resume or Discard it by its
  status line».
- Session Node, оборванный больше часа назад: chip **Interrupted by restart**, tooltip «Not continued: it was cut off
  more than an hour before worfy started again», кнопка Continue.

- [x] Владелец принимает Epic и подтверждает или отменяет решения 1–19 выше, отдельно — расхождение пункта 8 (eval
      не показал «лучше»).

## Ответ владельца 2026-11-19

Из карточки приёмки, 2026-11-19: «Принимаю».

- Mac Stable, тестовый Epic `demo-continuity` на Autopilot:
  - "Restart now" посреди Run-а — тот же Run продолжается, в Run history один Run с Wait-ом `restart`;
  - ⌘Q во время `git push` — окно «Quitting worfy», ожидание, Quit now;
  - `kill -9` посреди Wave — Run продолжается сам, метка «unknown side effects» и «Checked, include»;
  - строка «Context compacted» после `/compact`.
- Windows: выход посреди Wave и старт — Run продолжается.
- Решения без владельца 1–19 — подтверждены.
- Пункт 8 (eval не показал «лучше»: overallScore 0,64 с hook-ом против 0,73 без него) — принят как есть. Переделка
  hook-а — Ticket worfy-polish 128.
- Пункт 7 (на последнем merge Epic-а, только документы, job-ы macOS и Windows skipped; на последнем merge с кодом
  b910f55a8 всё зелёное со 2-й попытки, 1-я упала на двух test-ах не из Epic-а; нынешний `main` зелёный с 1-й) —
  засчитан.
