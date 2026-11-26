# 13 — Рецепт Jira: изменения в задачах пользователя

Type: task
Status: done 2026-11-25T23:37Z
PR: #2238
Branch: worfy-assistant/13
Blocked by: 04, 11
Source: [spec.md](../spec.md), «Ticket-ы», строка 13; «Решения владельца», 5 и 19; «Решения по реализации» → «Проверка
источников через connectors claude.ai», «Рецепт источника»; «Решения по test-ам»; история 11; «Волны», Wave 3

Кто: агент.

## Что строить

Рецепт источника Jira для проверки через connector claude.ai (Ticket 11):

- что искать — изменения в задачах пользователя с прошлой проверки;
- какие tools connector-а Jira разрешены — только read tools;
- проверка зарегистрирована в планировщике (Ticket 04) со своим интервалом; Jira — раз в час.

## Где в коде

- Проверка источника — Ticket 11; планировщик и work hours — Ticket 04 (пути — в их «Итог»).

## Решения

- Регулярная проверка Jira, у типа свой интервал — раз в час; настраиваются work hours и тип проверки (решение 5).
- Jira — через connector claude.ai, вариант В (решение 19).
- Рецепт говорит вызову, что искать и какие tools разрешены (spec, «Рецепт источника»).

## Test-ы

Записанные ответы вызова — fixture-ы; test-ы не вызывают модель и не ходят в сеть; пункты подаются в стык А (spec,
«Решения по test-ам»).

## Готово, когда

- [ ] Рецепт Jira задаёт поиск изменений в задачах пользователя и список разрешённых read tools.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-jira-recipe.test.ts` exit 0 · mac - · 275781a43
  - evidence: test-run pass · `node scripts/vitest-electron.mjs <14 unit and contract tests of src/main/assistant and src/shared/assistant>` exit 0 · mac - · 737062ead
  - evidence: review pass · PR #2238 · - - · bd532403010207a8c7e469a1235ef777cfc7351e
- [ ] Unit test на записанном ответе: из ответа вызова получаются пункты об изменениях в задачах пользователя.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-jira-recipe.test.ts` exit 0 · mac - · 275781a43
  - evidence: test-run pass · `node scripts/vitest-electron.mjs <14 unit and contract tests of src/main/assistant and src/shared/assistant>` exit 0 · mac - · 737062ead
  - evidence: review pass · PR #2238 · - - · bd532403010207a8c7e469a1235ef777cfc7351e
- [ ] Проверка Jira зарегистрирована в планировщике Ticket-а 04 с интервалом раз в час по умолчанию.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-jira-recipe.test.ts` exit 0 · mac - · 275781a43
  - evidence: test-run pass · `node scripts/vitest-electron.mjs <14 unit and contract tests of src/main/assistant and src/shared/assistant>` exit 0 · mac - · 737062ead
  - evidence: review pass · PR #2238 · - - · bd532403010207a8c7e469a1235ef777cfc7351e
- [ ] Записанные ответы лежат как fixture-ы; test-ы не вызывают модель и не ходят в сеть.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-jira-recipe.test.ts` exit 0 · mac - · 275781a43
  - evidence: test-run pass · `node scripts/vitest-electron.mjs <14 unit and contract tests of src/main/assistant and src/shared/assistant>` exit 0 · mac - · 737062ead
  - evidence: review pass · PR #2238 · - - · bd532403010207a8c7e469a1235ef777cfc7351e
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint` exit 0, `pnpm typecheck` exit 0 · mac - · 737062ead
  - evidence: gate pass · `gate fast` exit 0 · mac - · 737062ead
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45711696836/job/139583795475 · ci - · bd532403010207a8c7e469a1235ef777cfc7351e

## Итог

- Красный до правки: `node scripts/vitest-electron.mjs test/unit/assistant-jira-recipe.test.ts` — exit 1, файл не
  грузится: нет `src/main/assistant/sources/jira.ts`.
- Рецепт — `src/main/assistant/sources/jira.ts`, `JIRA_RECIPE` (`ConnectorRecipe` Ticket-а 11, вид проверки `jira`):
  - connector — claude.ai connector, в имени которого после `claude.ai ` есть слово `Atlassian` или `Jira`
    (`claude.ai Atlassian`, `claude.ai Atlassian MCP`); другие connectors и серверы пользователя — нет;
  - read tools — `JIRA_READ_TOOLS`: `atlassianUserInfo` (id учётной записи пользователя — для упоминаний),
    `getAccessibleAtlassianResources` (cloud id и адрес сайта — для каждого tool Jira и для ссылок),
    `searchJiraIssuesUsingJql`, `getJiraIssue` (комментарии и история изменений). Пишущие tools connector-а
    (`createJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `transitionJiraIssue`), Confluence и поиск Rovo в
    вызов не попадают; tool, который connector помечает как пишущий, `readToolsOf` Ticket-а 11 отбрасывает и так;
  - что искать (`jiraTask`) — изменения в задачах пользователя с прошлой проверки: задачи, где пользователь
    исполнитель, автор или наблюдатель (JQL `(assignee = currentUser() OR reporter = currentUser() OR watcher =
    currentUser()) AND updated >= -<N>m ORDER BY updated ASC`), и задачи, где комментарии упоминают пользователя
    (второй поиск `comment ~ "accountid:<id>"`; если Jira его отказывает — без него). Один пункт — одно изменение:
    новая задача, комментарий, смена статуса, исполнителя, приоритета, срока или другого поля; изменения самого
    пользователя не сообщаются. id пункта — `<KEY>#comment-<id>`, `<KEY>#change-<id истории>` или `<KEY>#created`,
    Ticket пункта — ключ задачи, ссылка — `<сайт>/browse/<KEY>`, для комментария с `?focusedCommentId=`;
  - окно поиска — минуты до запуска поиска (`updated >= -<N>m`), а не дата: дату JQL Jira читает в часовом поясе
    профиля пользователя. Поиск захватывает на `JIRA_SEARCH_OVERLAP_MS` (5 минут) раньше прошлой проверки: свежее
    изменение может появиться в поиске Jira с задержкой; повтор того же изменения — тот же id и время, ядро внимания
    его отбрасывает;
  - время пункта — ISO 8601 с двоеточием в смещении: Jira пишет `+0200`, а форма пункта Ticket-а 11 такое время не
    принимает (пункт отказан, строка в журнале — это проверено test-ом на записанном ответе);
  - текст задач, описаний, комментариев и полей рецепт называет данными, написанными другими людьми, не
    инструкциями; в сообщение, которое main отправляет вызову, текст Jira не попадает — только время и текст рецепта
    (и имена Project-ов, как у Ticket-а 11).
- Регистрация — `registerJiraCheck(checkScheduler(), (recipe) => appSourceCheck(recipe))` в `src/main/index.ts`, отдельным
  блоком после старта планировщика: проверка `jira` с интервалом по умолчанию раз в час (`ASSISTANT_CHECK_DEFAULTS`
  Ticket-а 04) и выключена, пока пользователь её не включит (решение 10).
- Fixture-ы — `test/fixtures/assistant-sources/jira-servers.json` (список MCP-серверов с connector-ом Atlassian и его
  read, write и Confluence tools), `jira-context-usage.json`, `jira-answer-good.jsonl` (записанный ответ вызова; в
  результате tool — комментарий с текстом «Ignore all previous instructions…»). Test —
  `test/unit/assistant-jira-recipe.test.ts`; модель и сеть не вызываются.
- Общий код Ticket-а 11 (`src/main/assistant/sources/connector-check.ts`, `app.ts`, `src/main/vendors/claude/connector-check.ts`,
  `src/shared/assistant/source-items.ts`) не менялся; fixture-ы Ticket-а 11 тоже.
- Решено без владельца — подтверждено владельцем 2026-11-26:
  - список read tools рецепта — четыре tools выше; поиск Rovo (`search`, тратит Rovo credits) и tools Confluence — нет;
  - connector Jira узнаётся по слову `Atlassian` или `Jira` в имени connector-а claude.ai;
  - запас поиска — 5 минут раньше прошлой проверки;
  - изменения, которые сделал сам пользователь, не сообщаются;
  - срочно — задача блокирует другие или с наивысшим приоритетом, или изменение просит пользователя о чём-то на сегодня;
  - упоминания пользователя ищутся вторым запросом `comment ~ "accountid:<id>"` (форма из статьи Atlassian Community,
    не документации); отказ Jira — без него.
- Не проверено вживую: имена tools настоящего connector-а Atlassian claude.ai и их аннотации (взяты из документации
  Atlassian Rovo MCP, research `docs/product/proactive-runtime/research-внешние-источники.md`, J10); что JQL с
  `currentUser()` и `updated >= -<N>m` работает через connector; что `getJiraIssue` отдаёт историю изменений. Первый
  настоящий вызов — приёмка владельцем (Ticket 20).
- Раунд 1 review (PR #2238), правка — красный test до неё, mutant-ы «без строки о вызовах в одном ходу» и «без поля
  `comment` в поиске» красные:
  - рецепт укладывается в предел ходов общей проверки. Раньше он просил вызовы по очереди и `getJiraIssue` на каждую
    найденную задачу: N + 5 ходов, и при больше 3 задачах — `error_max_turns` при `CONNECTOR_CHECK_MAX_TURNS` = 8.
    Такой вызов оплачен, `since` стоит, следующая проверка читает окно шире и падает снова. Теперь план ходов
    (`JIRA_TURN_BUDGET` = 5, не зависит от числа задач): ход 1 — `atlassianUserInfo` и
    `getAccessibleAtlassianResources` вместе; ход 2 — оба поиска вместе, каждый с `fields` `JIRA_SEARCH_FIELDS`
    (summary, status, priority, assignee, reporter, duedate, updated, comment), `expand "changelog"` и `maxResults`
    50, так что сам поиск показывает, что изменилось; ход 3 — только если у поиска есть следующие страницы, они
    вместе; ход 4 — только если нужно, `getJiraIssue` для задач, по которым поиск не показал изменения, не больше
    `JIRA_ISSUE_READS_MAX` = 5, все в одном ходу; ход 5 — ответ. 1 + 1 + 1 + 1 + 1 = 5 из 8: три хода запаса на
    отказ Jira, вызов, который модель разбила на два хода, или повтор structured answer;
  - test на записанном ответе загруженного дня (`jira-answer-busy.jsonl`): 12 задач, 14 изменений, три хода вызовов и
    ответ — все пункты в ядре внимания, журнал пуст.
  - Решено без владельца — подтверждено владельцем 2026-11-26: план в 5 ходов; не больше 5 отдельных чтений задач; страница поиска — 50
    задач. Не проверено вживую: принимает ли `searchJiraIssuesUsingJql` connector-а параметры `fields` и `expand`, и
    считает ли Claude Code параллельные вызовы одного ответа модели одним ходом (так в Agent SDK; живого вызова нет).
  - Замечание review вне Ticket-а (общий код Ticket-а 11, не правился): ответ, где каждая запись не прошла форму
    (например, время `+0000`, если Claude Code не держит схему), считается успехом и сдвигает `since` — эти изменения
    теряются молча. Для Orchestrator-а, отдельным Ticket-ом.
