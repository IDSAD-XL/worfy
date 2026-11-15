# Из чего строить Code story: что остаётся от работы агента над Ticket-ом

Research по вопросу [01](issues/01-из-чего-строить-code-story.md) темы `code-stories`. Факты на 2026-11-15: main
`b9e66593c`; Harness — папка `harness/` того же commit-а (её файлы, на которые здесь ссылки, совпадают с установленной
копией Stable); Claude Code 2.1.322; модель implementer-а и Orchestrator-а — `claude-opus-5-5`. Все URL прочитаны
2026-11-15, их список — в конце. Замеры по transcript-ам — только числа и имена полей, без текста из них.

Слова: **implementer** — Subagent, который пишет код Ticket-а; **verifier** — Subagent `worfy:reviewer`, который
перепроверяет отчёт implementer-а и даёт вердикт; **Orchestrator** — Session, которая ведёт волну (Wave) Ticket-ов.

## Коротко

- **Session, которую продолжили (resume), свои прежние рассуждения видит, но прочитать их может только сама модель
  через API.** Пустой текст блоков thinking — замысел API, а не потеря: Claude Code просит `display: "updates"`, при
  нём рассуждение приходит пустым, а полный его текст лежит зашифрованным в поле `signature` того же блока. При resume
  Claude Code отправляет весь разговор заново, сервер расшифровывает `signature`, и Opus 5.5 держит thinking всех
  прошлых turn-ов в контексте. Ни человек, ни worfy этот текст не прочитают.
- Замер: в 6 transcript-ах implementer-ов все 532 блока thinking пустые, и у всех есть `signature` (медиана
  1,4–1,8 тыс. символов). Thinking — 22–38 % output token-ов implementer-а.
- Условие: `system`, `tools` и все прежние сообщения не меняются. Implementer, которого продолжили через 44 часа, не
  потерял ни одного блока. Но API выбрасывает блоки, когда prefix изменился, и пишет об этом в ответ: такие выбросы есть
  в 42 из 703 transcript-ов implementer-ов, на текущем Claude Code 2.1.322 — в 3 из 45, все три после compaction.
  Рассуждения пропадают и при смене модели, и вместе с transcript-ом. Transcript Subagent-а живёт, пока жив transcript
  родительской Session: здесь 35 дней после её последней записи.
- **Больше всего «почему» и дольше всех живёт текст PR на GitHub**: медиана 359 слов в 34 последних PR с кодом,
  разделы Root cause, Decisions taken alone, Left for a follow-up, Files outside the ticket's list. GitHub его не
  чистит. В git его нет: squash-commit на main несёт commit-ы ветки, а не текст PR. Второе место — раздел `## Итог`
  файла Ticket-а в git: он есть у 78 из 142 Ticket-ов, закрытых 8–15 ноября, медиана 423 слова.
- Отброшенные варианты почти нигде не записаны: поиск по словам нашёл их в 9 из 142 Ticket-ов, раздел о решениях без
  владельца — в 4 из 34 PR. Ближе всего к сомнениям и пробелам test-ов JSON-отчёт implementer-а (`not_verified` —
  медиана 3 записи, `removed` — 2), но в файл он не сохраняется и живёт только в transcript-ах.
- Вердикты verifier-а — комментарии PR на GitHub (не чистятся): до 30 строк с находками `path:line`. Комментариев к
  строкам diff-а агенты не оставляют. Журнал run-а Autopilot-а и decision log волны worfy не чистит, но в них решения
  уровня волны, а не кода.
- **Цена resume.** Контекст implementer-а к последнему вызову — 150–332 тыс. token-ов, если не было compaction.
  Implementer пишет prompt cache с TTL 1 час (так задано в его определении), другие Subagent-ы — 5 минут. После
  истечения TTL первый вызов заново пишет в cache весь контекст: замер — 287 865 token-ов после паузы 44 часа, около
  $2,30 по цене API. На тёплом cache вызов того же размера стоит около $0,06.
- **Codex** пишет rollout в `~/.codex/sessions/…/rollout-*.jsonl` и сам его не удаляет. Рассуждения там тоже только
  зашифрованные (`encrypted_content`), читаемая сводка по умолчанию выключена. `codex resume` отправляет их обратно;
  модели с `reasoning.context: all_turns` (GPT-5.6, GPT-6.1 Sol) их используют, `gpt-5.5` по умолчанию — нет.

## 1. Что остаётся от одного Ticket-а

### Где что лежит

| Артефакт | Где | Что в нём от «почему» | Сколько живёт | Источник |
|---|---|---|---|---|
| Файл Ticket-а: шапка и разделы до работы | `.scratch/<epic>/issues/NN-slug.md` в git (режим Full); в режиме Silent — папка Workflow вне репозитория | Зачем и что делать: «Что происходит», иногда «Root cause», «Что делаем», «Вне скоупа», файлы («Где в коде» или trail). Пишет планирующая Session до работы: это «почему» требования, не решений implementer-а | Пока жив репозиторий | `harness/bin/TICKETS.md:8-13`, `:19-33`; выборка ниже |
| Раздел done с Evidence | Тот же файл, раздел «Готово, когда»; строки Evidence пишет только `bin/ticket` | Что доказало пункт: вид (`test-run`, `gate`, `commit`, `review`, `ci-check` …), команда с exit code, commit. «Почему» нет | git | `harness/bin/TICKETS.md:118-142`; `harness/skills/ship-ticket/implementer-finish.md:5-23` |
| Раздел результата `## Итог` | Тот же файл | История сделанного, долги review (группы Consider и Noted), раунды review, иногда решения без владельца | git | `harness/skills/ship-ticket/step-11-close.md:105-113`; `harness/skills/epic-wave/SKILL.md:703-707`, `:1689-1693` |
| `## Answer`, `## Comments` | Тот же файл, у Ticket-ов карты (research, grilling) | Ответ на вопрос карты | git | `harness/bin/TICKETS.md:284-288`; на main такие разделы у 35 и 3 из 1013 файлов Ticket-ов |
| Commit-ы ветки | GitHub: ветка и `refs/pull/<N>/head`; на main — один squash-commit | Тело commit-а: что и коротко почему | `refs/pull/<N>/head` GitHub хранит (есть для #1841 и #1884); на main навсегда, но только как список commit-ов ветки | `harness/bin/land:568` (`gh pr merge --squash`); настройка репозитория `squash_merge_commit_message: COMMIT_MESSAGES` — «default to the branch's commit messages» ([GitHub REST](https://docs.github.com/en/rest/repos/repos#update-a-repository)) |
| Текст PR | Только GitHub | Больше всего «почему»: что сломано, root cause, решения без владельца, что оставлено на потом, файлы вне списка Ticket-а | GitHub не чистит | `docs/features/flight-recorder.md:203`; выборка ниже |
| Вердикт | Комментарий PR: `VERIFIED` или `REJECTED: …` со строками групп Consider, Noted, Dismissed; commit status `review` | Ответ verifier-а: находки `path:line` с уровнем, что запускал и с каким exit code, что не проверил и почему, mutation-ы | GitHub | `harness/skills/epic-wave/SKILL.md:650-661`, `:733-765`; `harness/agents/reviewer.md:198-210` |
| Файл ответа verifier-а | Scratchpad Session Orchestrator-а (временная папка). Orchestrator этой машины держит копии в своей папке скриптов вне репозитория (`~/Stuff/worfy-orch/verdict/`): 143 файла по PR #1739…#1884, медиана 12 строк, максимум 32 | То же, что в комментарии PR | Scratchpad — до очистки временной папки; у копий правил нет | `harness/skills/epic-wave/SKILL.md:650-651` |
| JSON-отчёт implementer-а | Последний ответ Subagent-а: в его transcript-е и в transcript-е Orchestrator-а. В файл не сохраняется: поиск поля `not_verified` по папкам Harness, данных worfy и скриптов Orchestrator-а нашёл 0 отчётов | `not_verified` — что не проверено и почему, первой строкой ложная предпосылка brief-а с доводами и ценой обоих путей; `removed` — что пропало из прежнего поведения; `out_of_scope`; `claims` с доказательствами | Как transcript (ниже) | `harness/agents/implementer.md:100-104`, `:149-162`; `harness/skills/ship-ticket/implementer-report.md:5-22` |
| Decision log волны | `~/.claude/worfy-harness/runs/<project>/<epic>-wave-<время>/decisions.tsv`, рядом `wave-brief.txt` | Решения волны без человека: план, Ticket без dispatch-а, находки в Dismissed, narrow round, порядок merge-ей; поля `decision`, `why`, `evidence` | Без срока; не в git | `harness/skills/epic-wave/SKILL.md:318-365`; `harness/bin/decision-log:1-10`; на этой машине 59 папок, 510 строк |
| Журнал run-а Autopilot-а | `<папка данных worfy>/autopilot/<run>.jsonl` | Текст, отправленный в волну, статусы Ticket-ов, ожидания, остановки. Решений по коду нет | worfy не чистит | `docs/features/autopilot.md:244-246`, `:396-401`; `docs/features/flight-recorder.md:200`; на этой машине 42 файла с 2026-10-06, 2,0 МБ |
| Комментарий `shortcut:` в коде | Строка кода, git | Что упрощённый код не умеет и когда его переделать — «почему» у самой строки | git | `harness/skills/ship-ticket/step-5-smallest-change.md:20-24`; `harness/agents/reviewer.md:316`; на main 120 таких строк в 90 файлах `src`, `test`, `scripts` |
| Transcript-ы Claude Code | `~/.claude/projects/<project>/<session>.jsonl`; Subagent-ы — `<session>/subagents/agent-<id>.jsonl` | Видимый текст, вызовы tool-ов и их результаты, system prompt, tools и параметры запросов; рассуждения — только зашифрованные (раздел 2) | `cleanupPeriodDays` (по умолчанию 30, здесь 35) дней после последней записи; transcript-ы Subagent-ов удаляются вместе с родительским | [claude-directory](https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically); [settings-reference](https://code.claude.com/docs/en/settings-reference#cleanupperioddays) |

Ещё один след — запись каждого gate run (`timings.json`), 31 день (`docs/features/flight-recorder.md:202`); «почему» в
ней нет. Сам Harness говорит о решениях волны без человека так: «only the transcript says why … and nobody reads a
transcript» (`harness/skills/epic-wave/SKILL.md:343-344`).

Срок transcript-ов на этой машине: самый старый transcript Session — от 2026-10-19, а transcript-ов Subagent-ов старше
35 дней — 342 (самые старые от 2026-10-05). Они живы потому, что их родительские Session-ы писались позже: удаление
идёт по родительскому transcript-у. Значит, transcript-ы всех Subagent-ов долгой Session Orchestrator-а (у одной их
1163) уйдут разом, когда она состарится.

### Выборка: пять Ticket-ов, влитых 14–15 ноября

| Ticket | PR | Файл Ticket-а | Пункты done / строки Evidence | `## Итог` | Текст PR | Squash-commit на main | Вердикты |
|---|---|---|---|---|---|---|---|
| worfy-polish 117 — readAt PR inbox ставится только после чтения деталей | #1884 | 73 строки, 717 слов: Что происходит, Root cause, Что делаем, Готово когда, Где в коде, Вне скоупа | 4 / 4 (test-run 2, gate 1, ci-check 1) | нет | 425 слов: What failed, Root cause, Fix, Tests | `1673088fe`, 199 слов, 3 commit-а ветки | VERIFIED |
| worfy-polish 116 — шестерёнка вместо солнца у кнопки Settings | #1883 | 32 строки, 216 слов: Что происходит, Что делаем, Готово когда, Trail | 3 / 3 (commit, review, ci-check) | нет | 132 слова: Change, Look change, Checks | `0eccedd86`, 58 слов, 1 commit | VERIFIED |
| worfy-mcp-live 10 — список MCP: один Restart, полные имена, тихий Allow | #1841 | 60 строк, 619 слов: Что происходит, Что делаем, Готово когда, Где в коде, Вне скоупа | 7 / 7 (test-run 4, commit 2, gate 1) | нет | 879 слов: What, Screenshots, Files outside the ticket's list, Decisions taken alone, Checks, Rebase onto main | `8628ba699`, 402 слова, 5 commit-ов | VERIFIED, VERIFIED после rebase |
| worfy-mcp-live 14 — inventory MCP запускается вне Project-а | #1877 | 40 строк, 297 слов: Что происходит, Что делаем, Готово когда, Где в коде | 3 / 3 (test-run 2, ci-check 1) | нет | 500 слов: What, Binary evidence, Tests, Outside the ticket's file list, Decided without the owner | `3bff47ade`, 445 слов, 5 commit-ов | REJECTED, REJECTED, VERIFIED |
| worfy-ui-kit 18 — jsx-a11y в lint и axe в e2e | #1879 | 130 строк, 1327 слов: те же разделы и `## Итог` | 5 / 7 (test-run 3, commit 2, gate 1, ci-check 1) | 77 строк, 868 слов, есть «Раунд 2 ревью» | 1667 слов, 12 разделов, среди них Decisions taken alone, Left for a follow-up, Review round 2, Per-line lint disables (у каждого отключения причина) | `6dc789213`, 640 слов, 10 commit-ов | REJECTED, VERIFIED |

У всех пяти PR 0 комментариев к строкам diff-а. Закрывающий docs PR (#1885, `b9e66593c`) меняет в этих Ticket-ах только
строку Status и добавляет строку Evidence `ci-check`; разделов `## Итог` он не пишет.

Шире выборки:

- **Ticket-ы, закрытые 8–15 ноября (142, `Status: done` на main):** раздел `## Итог` — у 78 (55 %), медиана 423 слова,
  максимум 1739. Поиск по словам в тексте Ticket-а (оценка, не разметка): раунды review или `REJECTED` — 43;
  «не покрыто / не проверено» — 10; отброшенные варианты («отказались», «отбросили», «альтернатива») — 9; долги
  Consider/Noted — 6.
- **34 последних PR с кодом (#1844…#1886, без docs PR):** текст PR — медиана 359 слов (108–1729). Заголовки разделов по
  числу PR: Tests 16, Fix 9, Finding 7, Scenario 5, Root cause 4, Checks 4, Decisions taken alone 4, What changes 4,
  Red-test proof 4, Files outside the ticket's list 3, Why 2, Left for a follow-up 1.
- **JSON-отчёты implementer-ов:** из 120 самых новых transcript-ов implementer-ов JSON-отчёт удалось разобрать в 82
  (остальные — rework-раунды или ответ не JSON). Медианы: `claims` 6, `commands` 9, `files_changed` 7, `not_verified` 3
  (не пустой у 81), `removed` 2 (у 74), `out_of_scope` 1 (у 57); длина — медиана 630 слов. Первая строка
  `not_verified` говорит о ложной предпосылке brief-а у 11 из 82 (поиск по словам).

### Вывод по вопросу 1

- Больше всего «почему» и дольше всего живёт **текст PR** (GitHub). Его нет в git, поэтому Code story, которая читает
  только репозиторий, его не увидит; читать нужно GitHub.
- **`## Итог`** в git — у половины Ticket-ов. **`shortcut:`** — единственное «почему», привязанное к строке кода
  (120 строк на main).
- **Сомнения и пробелы test-ов** есть в `not_verified` отчёта implementer-а и в строке «что не проверил» вердикта.
  Отчёт уходит вместе с transcript-ом; вердикт в комментарии PR остаётся.
- **Отброшенные варианты** записаны редко: в разделах PR о решениях без владельца и в первой строке `not_verified`,
  когда brief ошибся. Всё остальное есть только в зашифрованном thinking (раздел 2).

## 2. Почему блоки thinking пустые и что видит Session после resume

### Что Claude Code просит у API

Transcript хранит параметры каждого запроса: строки `api-request` (поле `params`) и `api-request-shape` (system prompt и
tools). Docs: transcript содержит «the system prompt, tool definitions, and parameters of the requests Claude Code sent
the model» ([claude-directory](https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically)). Во всех 961
запросах шести замеренных implementer-ов одно и то же:

- `thinking: {type: "adaptive", display: "updates"}`, `output_config.effort: "high"`, `max_tokens: 128000`;
- `context_management.edits: [{type: "clear_thinking_20251015", keep: "all"}]`;
- точки prompt cache с `ttl: "1h"`;
- среди beta-заголовков `thinking-display-updates-2026-08-18`, `thinking-binding-controls-2026-08-01`,
  `extended-cache-ttl-2025-04-11`.

### Почему текст пустой

- На Opus 5.5 `display` по умолчанию `"omitted"`: блоки thinking приходят с пустым полем `thinking`, а «the
  `signature` field still carries the encrypted full thinking for multi-turn continuity». `"updates"` (beta) — то же,
  но короткие progress update между вызовами tool-ов приходят текстом
  ([thinking#display](https://platform.claude.com/docs/en/build-with-claude/thinking)). Сырой ход мысли не возвращает
  никакая настройка; `"summarized"` даёт только сводку («No `display` setting returns the raw chain of thought»).
  `display` меняет видимость, а не работу модели: thinking считается и оплачивается одинаково.
- `signature`: «Full thinking content is encrypted and returned in the `signature` field»; поле одинаковое при любом
  `display`; при возврате блоков «the server decrypts the `signature` to reconstruct the original thinking for prompt
  construction»; поле непрозрачное, разбирать его нельзя
  ([thinking#thinking-encryption](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-encryption)).
- `redacted_thinking` — другой вид блока: часть рассуждения скрыта по соображениям безопасности, в поле `data`
  ([thinking#redacted-thinking-blocks](https://platform.claude.com/docs/en/build-with-claude/thinking)). В замеренных
  transcript-ах таких блоков 0.
- В Claude Code есть настройка `showThinkingSummaries`, по умолчанию `false`: при `true` в интерактивных Session-ах
  приходят сводки thinking ([settings-reference](https://code.claude.com/docs/en/settings-reference#showthinkingsummaries)).
  «You are charged for all thinking tokens generated, even when collapsed or redacted»
  ([model-config](https://code.claude.com/docs/en/model-config)).

Замер:

- implementer-ы: 532 блока thinking в 6 transcript-ах, с текстом 0, с `signature` все; длина `signature` — медиана
  1 416–1 816 символов по transcript-ам, максимум 16 984; thinking — 22–38 % output token-ов (поле
  `usage.output_tokens_details.thinking_tokens`);
- Orchestrator: в самом большом transcript-е текст есть у 361 блока из 5 212 (7 %), `signature` — у всех 5 212. Длина
  непустых — медиана 30 слов, максимум 73: это progress update, не рассуждение. Данные map.md (2879 пустых из 3171)
  делятся так: Claude Code 2.1.289 — 2434 пустых и 268 с текстом, 2.1.322 — 445 и 24.

### Видит ли Session свои рассуждения после resume

Да, при условиях ниже. Источники по шагам:

1. **Claude Code отправляет весь разговор заново** и по умолчанию оставляет прежний system prompt, даже после своего
   обновления; определения tool-ов MCP-серверов идут так, как записаны в transcript
   ([prompt-caching#resuming-a-session](https://code.claude.com/docs/en/prompt-caching#resuming-a-session)).
   Справочник skill-а `claude-api` из Claude Code 2.1.322: «Claude Code, claude.ai, Managed Agents, and the Agent SDK
   keep the prefix intact» (`shared/model-migration.md:1641`, `:1973`).
2. **Opus 5.5 держит thinking всех прошлых turn-ов** в контексте
   ([thinking#thinking-block-preservation-by-model](https://platform.claude.com/docs/en/build-with-claude/thinking);
   таблица по умолчанию в [context-editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).
   Claude Code ещё и явно просит `keep: "all"` — «to keep all thinking blocks».
3. **Preserved thinking**: «Claude can build on its reasoning from earlier turns when your code sends the thinking
   blocks back … usable blocks stay in context and are billed as input»
   ([preserved-thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)).
4. **Subagent:** «Resumed subagents retain their full conversation history, including all previous tool calls,
   results, and reasoning». Продолжают его через `SendMessage`
   ([sub-agents#resume-subagents](https://code.claude.com/docs/en/sub-agents#resume-subagents)). Agent SDK: `resume` по
   session ID даёт «full context from before»
   ([agent-sdk/sessions](https://code.claude.com/docs/en/agent-sdk/sessions)).

Замер одного resume. Implementer Ticket-а worfy-ui-kit 12 (пять контекстных меню на ContextMenu кита) продолжили через
44 часа. Контекст до паузы — 287 692 token-а, после — 298 798: история ушла целиком, плюс новое сообщение. System
prompt (13 841 символ) и набор tool-ов не изменились: последняя новая запись `api-request-shape` сделана за 44 часа до
resume. Поле ответа `input_transformations` (API кладёт туда каждый выброшенный блок thinking) после resume пустое:
модель получила все прежние блоки.

### Замер: когда API всё же выбросил thinking

Claude Code шлёт beta-заголовок `thinking-binding-controls-2026-08-01`, поэтому в каждом ответе есть
`input_transformations`, и transcript его хранит (`message.input_transformations`, 246 333 ответа). Непустой он у
17 580 ответов; все 49 997 записей — `type: "thinking_dropped"`, `reason: "prefix_binding_mismatch"`: блок не прошёл
prefix check и до модели не дошёл.

- **Implementer-ы:** затронуто 42 из 703 transcript-ов. Claude Code 2.1.289 — 39 из 658: 19 после compaction, 19 без
  compaction в одном run-е по одному brief-у, 1 после продолжения. Claude Code 2.1.322 — 3 из 45, все три после
  compaction; из 38 transcript-ов без compaction не затронут ни один. Перед первым выбросом шли: compaction — 21 раз,
  пауза 5–60 минут — 17 (2 из них сразу после compaction), пауза больше часа — 2, ничего из этого — 4.
- **Сколько терялось:** к последнему вызову затронутого implementer-а на 2.1.289 не доходило до модели медиана 10 % его
  блоков thinking, максимум 80 %; на 2.1.322 — около 1 %.
- **Orchestrator:** выбросы есть в 4 из 29 transcript-ов Session-ов; на 2.1.289 — у 36–51 % их ответов. В Session,
  которая шла и на 2.1.322, — у 555 из 1 664 ответов этой версии (33 %); эта Session сжималась 28 раз.

Вывод замера: на Claude Code 2.1.322 обещание «keep the prefix intact» держится для обычного run-а и для resume без
compaction, а после compaction часть прежнего thinking модель больше не видит. На 2.1.289 блоки выбрасывались и без
compaction; причину transcript не называет.

Когда рассуждения пропадают или портятся:

- **Prefix check.** Каждый блок привязан к своему prefix — `system`, `tools` и всем сообщениям до него; отпечаток
  prefix лежит в `signature`. Сверяется только содержимое, «not … sessions, IDs, or users»: та же история в новом
  запросе или fork-е проверку проходит. На Opus 5.5 без `prefix_mismatch_behavior` несовпадение даёт либо 400, либо
  устаревшие блоки доходят до модели, и «Claude works from reasoning about content that has since changed»
  ([prefix-checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks)). Prefix
  меняют дата в system prompt, переписанный system prompt, новый или удалённый tool (в том числе при подключении
  MCP-сервера), правка или удаление прежнего сообщения. Для аккаунтов, созданных с 2026-08-31, проверка включена по
  умолчанию (`shared/model-migration.md:1973` того же skill-а). Если из истории удаляют секреты или личные данные, нужно
  удалить и все блоки thinking после них ([preserved-thinking#secrets-and-untrusted-text](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)).
- **Compaction** заменяет историю сводкой
  ([prompt-caching#compacting-the-conversation](https://code.claude.com/docs/en/prompt-caching)). 40 из 703
  transcript-ов implementer-ов сжимались хотя бы раз; у worfy-ui-kit 18 контекст упал с 366 до 78 тыс. token-ов. После
  этого модель видит сводку, а не прежние turn-ы с их thinking. Idle compaction работает только в терминале, VS Code и
  desktop-приложении, при TTL 1 час и контексте от 200 тыс.
  ([settings-reference#idlecompaction](https://code.claude.com/docs/en/settings-reference#idlecompaction)).
- **Другая модель.** Блоки Opus 5.5 читают только Opus 5.5 и Fable/Mythos 5.1 и 5.2; при переходе на другую модель API
  молча их выбрасывает ([preserved-thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking),
  таблица «Which model switches keep the reasoning»).
- **Другой аккаунт.** Только в своём аккаунте работают блоки Sonnet 5.5, Haiku 5.5, Fable 5.2 и Mythos 5.2; Opus 5.5
  в этом списке нет. Но API может выбросить блок аккаунта, который «no longer in good standing» (там же, «Accounts and
  cloud platforms»).
- **Transcript удалён** — нет ни истории, ни `signature`.
- **Просьба пересказать рассуждение.** Отказ `reasoning_extraction` обычно вызывают просьбы вывести рассуждение
  дословно или в фиксированном формате: поле `reasoning`, `thinking` или `trace` в JSON или во входе tool-а, «the
  model's private notes, or a running log of its reasoning». Можно просить «a short explanation, the evidence behind a
  result, or a summary of the actions it took». Отказ этой категории до вывода оплачивается
  ([refusals-and-fallback#keep-reasoning-in-thinking-blocks](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)).

### Вывод по вопросу 2

Продолженная Session той же модели с неизменным prefix получает свои прежние рассуждения целиком: сервер
восстанавливает их из `signature`. Прочитать их снаружи нельзя — ни worfy, ни человеку, ни новой Session. Ответ на
вопрос «почему X» — это новый текст модели, который опирается на рассуждение, но не цитата из него. Насколько точно
такой ответ передаёт отброшенные варианты, никто не измерял.

## 3. Codex

Факты кода — тег `rust-v0.169.0` репозитория openai/codex, commit `d32063f96c2d` (выпуск 2026-11-13); пути
`codex-rs/…#L…` ниже — на этот commit. Их собрал отдельный агент; ключевые строки (параметры запроса, фильтр истории,
compaction, каталог моделей, флаг сжатия, `history.jsonl`) я перечитал сам.

**Где лежит.** `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<время>-<id потока>.jsonl`, по умолчанию `CODEX_HOME` —
`~/.codex` (`codex-rs/rollout/src/recorder.rs#L1684-L1705`, `codex-rs/utils/home-dir/src/lib.rs#L5-L60`). Строка —
`{timestamp, type, payload}`, виды: `session_meta`, `response_item`, `event_msg`, `turn_context`, `compacted`,
`token_usage_record`, `world_state` и другие (`codex-rs/history/src/rollout_payload.rs#L35-L80`). Архив потоков —
`$CODEX_HOME/archived_sessions/`. `history.jsonl` хранит только prompt-ы, набранные в терминале, без ответов модели
(`codex-rs/message-history/src/lib.rs#L1-L15`). worfy rollout-ы не читает: историю Session-а Codex он берёт у app-server
через `thread/list` и `thread/read` (`docs/adr/0094-vendor-seam.md:51`, `:123-124`), а сводку рассуждения показывает
событием `thinking` (`docs/features/vendors.md:186`).

**Хранятся ли рассуждения.** Да: `response_item` вида `reasoning` с полями `summary[]`, `encrypted_content` и
необязательным `content[]` (`codex-rs/protocol/src/models.rs#L1139-L1151`). Каждый запрос Codex шлёт с
`include: ["reasoning.encrypted_content"]` и `store: false` (`codex-rs/core/src/client.rs#L1258`, `#L1302`). Сводку он
просит, только если `model_reasoning_summary` не `none` (`client.rs#L1149-L1152`); у всех 12 моделей встроенного
каталога `default_reasoning_summary: "none"` (`codex-rs/models-manager/models.json`). Сырого рассуждения OpenAI не
отдаёт: «we don't expose the raw reasoning tokens» ([reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)).
Значит, по умолчанию в rollout-е рассуждение есть только зашифрованным, как `signature` у Claude. Код адаптера Codex в
worfy (`src/main/vendors/codex/`) сводку не включает.

Замер на этой машине: 14 rollout-ов за 3–10 ноября, модель `gpt-6.1-sol`, `summary: none` во всех 12 turn-ах;
2 элемента `reasoning`, у обоих есть `encrypted_content` (около 2 тыс. символов) и пустой `summary`.

**Что делает resume.** `codex resume` и `codex exec resume` собирают историю из последней записи `compacted` и всех
`response_item` после неё (`codex-rs/core/src/session/rollout_reconstruction.rs#L190-L200`, `#L519-L546`). Элементы
`reasoning` фильтр истории пропускает (`codex-rs/core/src/context_manager/history.rs#L1262-L1281`), и запрос несёт всю
историю (`codex-rs/core/src/session/turn.rs#L1938-L1960`); первый запрос после resume всегда полный
(`client.rs#L2340-L2347`). Использует ли модель прежние рассуждения, решает параметр `reasoning.context`:
`current_turn` «does not render reasoning from earlier turns into the next sample», `all_turns` — рендерит. Семейство
GPT-5.6 по умолчанию работает с `all_turns`, GPT-6.1 Sol его поддерживает, более ранние модели по умолчанию —
`current_turn`; рассуждение переносится только внутри одного семейства моделей (reasoning guide). Codex шлёт
`all_turns` явно только моделям с флагом `use_responses_lite` (`client.rs#L1153-L1157`); в каталоге флаг есть у всех,
кроме `gpt-5.5`. Локальная compaction оставляет начальный контекст, сообщения пользователя и сводку, без прежних
рассуждений (`codex-rs/core/src/compact.rs#L716-L727`). В GitHub issues (не первичный источник) поток после resume
падает, если сервер не может расшифровать рассуждение, в том числе с текстом «organization_id did not match» (#25290,
#13724, #36704).

**Сколько живёт.** Автоудаления rollout-ов нет: поток удаляет явная команда или человек
(`codex-rs/thread-store/src/local/delete_thread.rs#L1-L8`); код обслуживания только сжимает и мигрирует файлы
(`codex-rs/rollout/src/maintenance.rs#L1-L16`). Сжатие в `.jsonl.zst` через 7 дней стоит за флагом
`local_thread_store_compression`, по умолчанию выключенным (`codex-rs/features/src/lib.rs#L1461-L1466`,
`codex-rs/rollout/src/compression.rs#L26`); на этой машине все 14 файлов — `.jsonl`, хотя часть старше 7 дней. У
`history.jsonl` по умолчанию нет предела размера (`codex-rs/config/src/types.rs#L222-L243`). На сервере с
`store: false` ответ не хранится как состояние; по WebSocket прежний ответ держится только в памяти соединения, до 60
минут ([WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode)).

**Вывод по Codex.** Как и у Claude Code, на диске — видимые сообщения, вызовы tool-ов и результаты, а рассуждения
только зашифрованные: прочесть их может лишь сервер OpenAI. В отличие от Claude Code, rollout живёт без срока. Resume
отправляет зашифрованные рассуждения обратно, и модели с `all_turns` их используют, а `gpt-5.5` по умолчанию — нет.
Читаемые сводки появятся, только если до работы включить `model_reasoning_summary` (например `auto`).

## 4. Цена resume большой Session

### Размер контекста implementer-ов

Контекст вызова — `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` из `message.usage` (вызов —
одно сообщение API с одним `message.id`). Цена — по [pricing](https://platform.claude.com/docs/en/about-claude/pricing)
для Opus 5.5: запись в cache с TTL 1 час $8 за млн token-ов, чтение из cache $0,20 (0,05 от базовой цены $4).

| Transcript implementer-а | Вызовов API | Длительность | Контекст последнего вызова | Наибольший контекст | Output, из них thinking | Холодный resume: 1-й вызов | Тёплый: за вызов |
|---|---|---|---|---|---|---|---|
| Самый новый (тот, что в map.md) | 66 | 44 мин | 159 490 | 159 490 | 33 076, 38 % | $1,28 | $0,03 |
| worfy-ui-kit 18 (jsx-a11y и axe) | 286 | 276 мин | 78 184 (после compaction) | 366 221 | 161 538, 32 % | $0,63 | $0,02 |
| worfy-mcp-live 14 (inventory MCP вне Project-а) | 197 | 228 мин | 331 502 | 331 502 | 127 468, 29 % | $2,65 | $0,07 |
| worfy-polish 115 (фокус ContextMenu кита) | 84 | 48 мин | 150 587 | 150 587 | 44 673, 31 % | $1,20 | $0,03 |
| worfy-mcp-live 13 (процесс Session живёт, пока идут её фоновые задачи) | 124 | 114 мин | 207 706 | 207 706 | 59 115, 22 % | $1,66 | $0,04 |
| worfy-ui-kit 12 (пять контекстных меню) | 194 | 49 ч, из них пауза 44 ч | 328 013 | 328 013 | 122 541, 35 % | $2,62 | $0,07 |

«Холодный» — cache истёк, весь контекст пишется заново по цене записи с TTL 1 час. «Тёплый» — тот же контекст читается
из cache. На подписке это не доллары, а доля лимитов; цена API здесь — мерка размера.

### Сколько живёт prompt cache

- API: по умолчанию 5 минут, каждое чтение продлевает срок бесплатно; за доплату — 1 час. Запись с TTL 5 минут — 1,25
  от базовой цены, с TTL 1 час — 2, чтение — 0,1 (у Opus 5.5 и Sonnet 5.5 — 0,05)
  ([prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- Claude Code сам выбирает TTL: на подписке в пределах плана основной разговор (в том числе ход Agent SDK) — 1 час,
  Subagent-ы — 5 минут; Subagent может задать свой TTL полем `experimental.cacheTtl`
  ([prompt-caching#which-ttl-each-request-gets](https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets);
  [sub-agents](https://code.claude.com/docs/en/sub-agents), таблица полей frontmatter). Продолженный Subagent «can keep
  reading the prompt cache the original run warmed» (sub-agents#resume-subagents).
- В Harness у implementer-а `experimental: cacheTtl: 1h` (`harness/agents/implementer.md:6-7`). Замер совпадает: у
  implementer-ов все записи в cache — с TTL 1 час; у `worfy:reviewer` и `general-purpose` — только 5 минут; у
  Orchestrator-а 98 % записей — 1 час.
- Skill `epic-wave` при этом исходит из 5 минут: для rework-раунда он запускает нового implementer-а, а не
  `SendMessage` старому, потому что тот «has usually been idle past its prompt cache (5 min), and its first message
  re-reads its whole context, often 100k tokens and more» (`harness/skills/epic-wave/SKILL.md:774-780`). С TTL 1 час
  окно для дешёвого продолжения — час.

### Замер холодного resume

Implementer worfy-ui-kit 12 после паузы 44 часа: первый вызов записал в cache 287 865 token-ов (TTL 1 час) и прочитал
из него 10 931 (общая часть с другими Session-ами: system prompt и tools). Это около $2,30 за один вызов. После пауз по
30 минут в том же transcript-е первый вызов читал из cache 280–310 тыс. token-ов и записывал 300–400.

Вопрос к строке через resume implementer-а без compaction стоит так: первый вызов — около $1,20–2,65 на холодном
cache или $0,03–0,07 на тёплом (час после последнего вызова), плюс каждый следующий вызов того же ответа (чтение
файлов, поиск) — ещё $0,03–0,07 и output. Для сравнения, оценка: новая Session с контекстом в 30 тыс. token-ов (story, diff,
запись «почему») — около $0,15–0,24 за первый вызов и около $0,01 за следующие.

## Что неизвестно

- **Точность ответа из продолженной Session.** Никто не проверял, насколько ответ implementer-а после resume на вопрос
  «почему X, а не Y» совпадает с его настоящим ходом работы. Проверить по самому thinking нельзя: его не прочесть.
- **Причина выбросов без compaction.** На Claude Code 2.1.289 thinking выбрасывался в 19 run-ах implementer-ов без
  compaction и без продолжения; transcript говорит только `prefix_binding_mismatch` и путь блока, но не что изменилось.
  Меняет ли worfy при продолжении Session-а system prompt, его дополнения или набор MCP-серверов, не проверено.
- **Сводки thinking в Session-ах SDK.** Работает ли `showThinkingSummaries` (или `display: "summarized"`) для Session-ов
  worfy, сколько это добавит к output и что из сводки останется после compaction, не проверено.
- **Отказ `reasoning_extraction`.** Не проверено, даёт ли его вопрос к продолженному implementer-у «какие варианты ты
  отбросил и почему» или запись хода работы в файл по ходу Ticket-а.
- **«Аккаунт» подписки.** Для Claude API аккаунт — это organization; что считается аккаунтом при входе по подписке и
  когда аккаунт «no longer in good standing», docs не говорят.
- **Idle compaction в Agent SDK.** Docs называют только терминал, VS Code и desktop; Session-ы SDK не названы.
- **Codex: сервер.** Сколько OpenAI хранит трафик Codex при входе через ChatGPT (он идёт не на api.openai.com), docs не
  говорят. Что зашифрованное рассуждение привязано к organization, видно только из текста ошибки в GitHub issue #13724.
  Совпадают ли значения по умолчанию каталога моделей, который Codex получает с сервера, со встроенным, и что хранит
  серверная compaction, не проверено.

## Источники

Прочитаны 2026-11-15.

- Claude API: [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) (разделы display, Thinking
  encryption, Thinking block preservation by model, Redacted thinking blocks);
  [Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking);
  [Prefix checks](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks);
  [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing);
  [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching);
  [Pricing](https://platform.claude.com/docs/en/about-claude/pricing);
  [Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).
- Claude Code: [Sub-agents](https://code.claude.com/docs/en/sub-agents);
  [Prompt caching](https://code.claude.com/docs/en/prompt-caching);
  [Sessions](https://code.claude.com/docs/en/sessions);
  [Settings reference](https://code.claude.com/docs/en/settings-reference);
  [Model configuration](https://code.claude.com/docs/en/model-config);
  [The .claude directory](https://code.claude.com/docs/en/claude-directory);
  [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions).
- Skill `claude-api` из Claude Code 2.1.322, `shared/model-migration.md` (разделы Migrating to Claude Opus 5.5 и
  Migrating to Claude Fable 5.1 from Claude Fable 5).
- GitHub: [REST API, Update a repository](https://docs.github.com/en/rest/repos/repos#update-a-repository)
  (`squash_merge_commit_message`); настройки репозитория и PR #1841, #1877, #1879, #1883, #1884 — через `gh`.
- OpenAI: репозиторий [openai/codex](https://github.com/openai/codex/tree/d32063f96c2dff1dc96af839b3952abb6acfeda4),
  тег `rust-v0.169.0`; [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning);
  [WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode); GitHub issues
  [#25290](https://github.com/openai/codex/issues/25290), [#13724](https://github.com/openai/codex/issues/13724),
  [#36704](https://github.com/openai/codex/issues/36704) — как свидетельства, не первичный источник.
- Замеры на этой машине: transcript-ы Claude Code проекта (поля `message.usage`, `message.content[].type`,
  `signature`, строки `api-request`, `api-request-shape`, `compact_boundary`), журналы Autopilot-а, папки run-ов
  Harness-а, файлы вердиктов Orchestrator-а; Ticket-ы и commit-ы — `git` на `origin/main` `b9e66593c`.
