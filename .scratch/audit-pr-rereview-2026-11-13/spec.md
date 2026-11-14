# Повторный review смёрженных PR: подтверждённые finding-и

Дата: 2026-11-13.

PR, смёрженные в main начиная с 2026-11-07, прошли повторный review. Каждое finding ниже подтвердил независимый скептик: второй reviewer, который пытался его опровергнуть. Каждое finding проверено на текущем main и всё ещё есть в коде. Если одну проблему нашли через разные PR, она записана один раз со всеми номерами PR.

Всего 220 finding-ов: 8 high и 212 medium.

## Как читать запись

- Severity: `high` или `medium`. Внутри каждой области `high` идут первыми.
- Kind: `bug` — ошибка в поведении, в том числе ошибка в самом test-е. `test-gap` — поведение не закреплено test-ом: если его сломать, tests всё равно проходят. Mutant — намеренно испорченная копия кода для такой проверки; «mutant выживает» значит, что tests её не заметили. `docs-mismatch` — документ расходится с кодом. `boundary` — ошибка на границе двух частей системы: скрипта и папки, двух машин.
- Место — `file:line` на текущем main.
- PR — номер смёрженного PR, review которого нашёл проблему.

## Термины worfy

- Autopilot — режим, в котором worfy сам запускает Wave за Wave-ой без человека.
- Epic — набор Ticket-ов одной темы. Wave — группа Ticket-ов одного Epic, которые можно делать параллельно.
- Orchestrator — Session, которая ведёт Wave.
- Product Session — вид Session для продуктовой работы: советник предлагает идеи и пишет черновики Epic-ов, код не меняет. Mind map — карта идей темы в этой Session.
- Canvas — рабочее поле worfy. Session на нём видна как Node, то есть карточка.
- Harness — plugin worfy с правилами, hooks, skills и скриптами в папке `harness/`.
- Profile — описание project для Harness: команды, папки, режим работы.
- Silent mode — режим Project, в котором файлы workflow лежат вне его repository, в отдельной Workflow folder. Full mode — файлы workflow лежат в repository.
- Linked machine — другой компьютер, связанный с этим через Link по коду из 6 цифр.
- PR inbox — вид «Pull requests» Project-а: PR пользователя и запросы review, сгруппированные по тому, чей ход.

## Сводка по областям

| Область | high | medium |
|---|---|---|
| Human review | 2 | 25 |
| MCP servers | 2 | 14 |
| Autopilot и Orchestrator | 1 | 12 |
| Product Session и Mind map | 1 | 36 |
| Harness | 1 | 31 |
| Vendors | 1 | 1 |
| UI kit и shell | 0 | 29 |
| GitHub и PR inbox | 0 | 27 |
| Sessions и chat | 0 | 10 |
| CI и тесты | 0 | 9 |
| Workflow и Pipeline | 0 | 8 |
| Flight Recorder и Work track | 0 | 7 |
| Link | 0 | 3 |
| **Итого** | **8** | **212** |

## Human review

Область: skill `human-review-setup`, который строит для project skill review в голосе его команды; скрипт `review-history`, который скачивает историю review; lint черновиков review.

#### 1. Сгенерированный skill review не запрещает запускать код PR
- `high` · `bug` · `harness/skills/human-review-setup/template/SKILL.template.md:72` · PR #1649
- Сценарий: skill review, который генерирует `human-review-setup`, нигде не говорит «только читать». Model может собрать и запустить код автора PR. Этот код выполняется с GH_TOKEN пользователя в окружении.
- Исправление: добавить в шаблон правило read-only, как в `check.md:91-97`.

#### 2. Принятый refresh затирает примеры голоса команды
- `high` · `bug` · `harness/skills/human-review-setup/refresh.md:100` · PR #1662
- Сценарий: пользователь принимает обновление (refresh). Файл `voice-examples.md` заменяется примерами только из нового среза истории. В нём может остаться 2 reviewer-а и пустые tier-ы, а прежние примеры пропадают.
- Исправление: сливать новые примеры с установленными и показывать diff перед принятием.

#### 3. Личный deny list срабатывает на имя самого project
- `medium` · `bug` · `harness/bin/review-draft-lint:72` (и evidence-check в `harness/skills/human-review-setup/analyse.md:194`) · PR #1604, #1631
- Сценарий: личный deny list из `privacy.json` (слова, которые нельзя публиковать) применяется к любому project. Собственное имя project в комментариях и ссылках становится finding. Цикл «исправь и проверь снова» не может закончиться.
- Исправление: не применять личный список к собственному project.

#### 4. Hold-out берёт PR, где команда только одобрила
- `medium` · `bug` · `harness/skills/human-review-setup/SKILL.md:125` · PR #1631, #1701
- Сценарий: hold-out — PR, отложенные для сверки черновика с настоящими комментариями. Выбирается PR, где единственный текст команды длиной 20+ символов — простое одобрение. Check выбрасывает такой PR из N, и итог выглядит как «matched 0 of 0».
- Исправление: применять `isPlainApproval` при выборе или заменять такие PR другими.

#### 5. Проверка login находит владельца repository в каждой ссылке
- `medium` · `bug` · `harness/skills/human-review-setup/analyse.md:193` · PR #1631
- Сценарий: проверка на login-ы людей находит login владельца repository в каждой ссылке на GitHub, потому что он часть URL. Каждая ссылка даёт лишнее finding.
- Исправление: исключать URL и имя repository из проверки.

#### 6. Ответ в thread считается отдельным review
- `medium` · `bug` · `harness/bin/review-history:759` · PR #1610
- Сценарий: каждый одиночный ответ в thread записывается как review со статусом COMMENTED. Статистика review получает лишние записи.
- Исправление: считать ответы частью thread, а не отдельным review.

#### 7. Одобрения не на английском считаются содержательными
- `medium` · `bug` · `harness/bin/review-history:443` · PR #1610
- Сценарий: простое одобрение на другом языке не распознаётся как простое одобрение. Оно попадает в анализ как содержательный комментарий.
- Исправление: распознавать простые одобрения не только на английском.

#### 8. Secondary rate limit ждёт до часа
- `medium` · `bug` · `harness/bin/review-history:306` · PR #1610
- Сценарий: GitHub отвечает secondary rate limit без заголовка `retry-after`. Скрипт ждёт reset основного окна, это до ~1 часа простоя.
- Исправление: ждать reset только при `remaining=0`, иначе 60 s.

#### 9. «Delete» недоступна в состоянии «Not built»
- `medium` · `bug` · `src/renderer/shell/ProjectSettings.tsx:509` · PR #1632
- Сценарий: review для project ещё не собран, кнопка «Delete» выключена. При этом в `raw/` уже лежат скачанные комментарии коллег, и удалить их из UI нельзя.
- Исправление: разрешать Delete, когда в `raw/` есть данные.

#### 10. Шаг 1 skill-а запускает gh и git не в repository
- `medium` · `bug` · `harness/skills/human-review-setup/template/SKILL.template.md:23` · PR #1649
- Сценарий: у project из нескольких repository корень сам не repository. Шаг 1 сгенерированного skill-а запускает там `gh` и `git`, и они падают.
- Исправление: переходить в папку repository этого PR до вызова gh и git.

#### 11. Нет пути восстановления, когда GitHub отклоняет review
- `medium` · `bug` · `harness/skills/human-review-setup/template/SKILL.template.md:157` · PR #1649
- Сценарий: GitHub отклоняет весь review целиком, например из-за комментария на строке вне diff или APPROVE своего же PR. Skill не говорит, что делать дальше, и review не публикуется.
- Исправление: описать шаг восстановления: убрать или перенести такие комментарии, сменить событие и повторить.

#### 12. Правило одной трети считает только выбранные примеры
- `medium` · `bug` · `harness/skills/human-review-setup/write.md:81` · PR #1649
- Сценарий: правило одной трети проверяет только уже выбранные примеры. Если удалить пример reviewer-а из меньшинства, проверка всё равно проходит.
- Исправление: проверять правило по полному набору кандидатов.

#### 13. Brief Subagent-а черновика не называет папку checkout
- `medium` · `bug` · `harness/skills/human-review-setup/check.md:86` · PR #1653
- Сценарий: в project из нескольких repository Subagent, который пишет черновик review, не знает, в какой папке лежит checkout PR. Он может читать не тот repository.
- Исправление: передавать в brief путь checkout.

#### 14. Комментарии обрезаются по последнему review, а не по следующему commit
- `medium` · `bug` · `harness/skills/human-review-setup/check.md:130` · PR #1653
- Сценарий: check сравнивает черновик с разговором команды о том же commit. Граница разговора берётся по последнему review на этом `commit_id`, а не по следующему commit. Сравнение идёт с неверным набором комментариев.
- Исправление: обрезать разговор по времени следующего commit.

#### 15. Brief передаёт сегодняшние title и body PR
- `medium` · `bug` · `harness/skills/human-review-setup/check.md:86` · PR #1653
- Сценарий: Subagent черновика получает title и body PR в их нынешнем виде. Если автор правил их после review, туда могли попасть ответы на замечания команды. Черновик видит эти ответы, и совпадение с командой завышается.
- Исправление: брать title и body на момент review или не передавать их.

#### 16. Дату начала refresh сдвигает отклонённая сборка
- `medium` · `bug` · `harness/skills/human-review-setup/refresh.md:23` · PR #1662
- Сценарий: refresh берёт дату начала из `fetched_at`. Отклонённая полная сборка переписывает это поле. Отрезок комментариев между прежней сборкой и отклонённой больше никогда не анализируется.
- Исправление: хранить `analysed_through` и обновлять его только при принятии.

#### 17. Слияние stats считает PR дважды
- `medium` · `bug` · `harness/skills/human-review-setup/refresh.md:91` · PR #1662
- Сценарий: при слиянии статистики PR, которые пересекают дату границы, считаются дважды. Labels reviewer-ов назначаются заново и могут не совпасть с прежними.
- Исправление: убирать дубли по номеру PR и сохранять прежние labels.

#### 18. Product Session получает skill /human-review
- `medium` · `bug` · `src/main/vendors/claude/query.ts:337` · PR #1657
- Сценарий: skill `/human-review` подключается и в Product Session. Её правила запрещают шаги этого skill-а: `git fetch`, `worktree add`, запись через `node -e`. Вызов падает на первых шагах.
- Исправление: не подключать skill в Product Session.

#### 19. Orchestrator, возвращённый человеку, не получает /human-review
- `medium` · `bug` · `src/main/vendors/claude/query.ts:337` · PR #1657
- Сценарий: Orchestrator возвращают человеку посреди run (`becomeAttended` в том же process). Skill `/human-review` в этой Session так и не появляется.
- Исправление: пересчитывать набор skills при `becomeAttended`.

#### 20. `--changed` не выбирает eval-ы human-review-setup
- `medium` · `boundary` · `scripts/eval-harness-coverage.mjs:123` · PR #1679
- Сценарий: папка fixture этих eval-ов лежит вне `evals/lib`. Флаг `--changed` (выбор eval-ов по изменённым файлам) не находит ни одного case, и правки skill-а уходят без eval.
- Исправление: учитывать папку fixture при выборе case-ов.

#### 21. Дочитывание страниц threads и comments не проверено
- `medium` · `test-gap` · `harness/bin/review-history:416` · PR #1610
- Сценарий: чтение threads и comments после первой страницы не закреплено test-ом. Если его сломать, PR с длинным обсуждением читаются не полностью, а tests проходят.
- Исправление: test с ответом из двух страниц.

#### 22. Timeout probe в review-offer не проверен
- `medium` · `test-gap` · `src/main/projects/review-offer.ts:217` · PR #1632
- Сценарий: timeout в 2 минуты у `probe` (проверки, можно ли предложить human review) не закреплён test-ом. Если его убрать, зависшая проверка висит без конца, а tests проходят.
- Исправление: test с fake timers.

#### 23. Перестановка правил base не ловится test-ом
- `medium` · `test-gap` · `test/contract/harness-human-review-setup.test.ts:749` · PR #1653
- Сценарий: правила выбора base для merged и не-merged PR можно поменять местами, и contract test этого не замечает.
- Исправление: отдельные случаи для merged и открытого PR.

#### 24. Связка installReviewOffers не проверена
- `medium` · `test-gap` · `src/renderer/main.tsx:128` · PR #1662
- Сценарий: вызов `installReviewOffers(followActiveProject)` не закреплён test-ом. Если его убрать, предложения review перестают следовать за активным project, а tests проходят.
- Исправление: test запуска renderer, который проверяет эту подписку.

#### 25. Grader analysis-subagents засчитывает Subagent-ов check.md
- `medium` · `test-gap` · `harness/evals/human-review-setup-full/graders/analysis-subagents.md:3` · PR #1679
- Сценарий: grader должен проверять Subagent-ов шага анализа, но засчитывает и Subagent-ов шага check. Eval проходит, даже если анализ шёл без Subagent-ов.
- Исправление: проверять Subagent-ов именно шага анализа.

#### 26. Чтение raw/ через Bash или Grep не оценивается
- `medium` · `test-gap` · `harness/evals/human-review-setup-short-history/graders/no-raw-read.md:3` · PR #1679
- Сценарий: grader ловит чтение `raw/` только через Read. Чтение через Bash или Grep проходит незамеченным.
- Исправление: проверять и вызовы Bash и Grep.

#### 27. Пауза перед retry дочитывания не проверена
- `medium` · `test-gap` · `harness/bin/review-history:371` · PR #1736
- Сценарий: пауза перед повтором дочитывания не закреплена test-ом. Если её убрать, повторы идут подряд и упираются в rate limit, а tests проходят.
- Исправление: test, который проверяет задержку между попытками.

## MCP servers

Область: MCP chip в Session (список MCP-серверов agent и действия Turn off, Turn on, Restart, Allow, Sign in) для Claude Code и Codex.

#### 28. Turn off, Restart и Allow убивают живые background tasks
- `high` · `bug` · `src/main/agent/session.ts:824` · PR #1816
- Сценарий: действия Turn off, Turn on, Restart и Allow перезапускают process agent. Живые background tasks (долгие команды, которые agent запустил в фоне) убиваются без отказа и без предупреждения.
- Исправление: отказывать, пока есть живые задачи, как требует ADR-0029 (запрет перезапуска Session с живыми background tasks).

#### 29. Inventory-query создаёт Session Nodes на Canvas
- `high` · `bug` · `src/main/vendors/claude/query.ts:424` · PR #1822
- Сценарий: служебный запрос, который читает список MCP-серверов (inventory-query), регистрируется в `~/.claude/sessions` как обычная Session. На Canvas копятся read-only Session Nodes.
- Исправление: запускать этот запрос вне папки Project, как запросы limits и narrator.

#### 30. Сообщение во время restart теряется
- `medium` · `bug` · `src/main/agent/session.ts:820` · PR #1816
- Сценарий: пользователь отправляет сообщение, пока Session ждёт restart после действия MCP. Сообщение уходит в старый process и пропадает.
- Исправление: держать сообщение до запуска нового process.

#### 31. Без Profile все серверы «Not allowed»
- `medium` · `bug` · `src/main/vendors/claude/query.ts:346` · PR #1822
- Сценарий: в папке без Profile chip показывает все серверы пользователя как «Not allowed». Allow для них всегда падает.
- Исправление: в папке без Profile не показывать статус allowlist и кнопку Allow.

#### 32. Второй Allow отвечает «agent is not running»
- `medium` · `bug` · `src/main/agent/session.ts:753` · PR #1826
- Сценарий: пользователь нажимает Allow у двух серверов подряд. Чтение второго попадает на restart после первого, и пользователь видит «agent is not running», хотя agent просто перезапускается.
- Исправление: ждать конца restart перед чтением.

#### 33. Chip показывает строки после выхода process
- `medium` · `bug` · `src/renderer/session/store.ts:392` · PR #1815
- Сценарий: process agent завершился, а chip продолжает показывать прежние строки серверов.
- Исправление: очищать список при выходе process.

#### 34. Esc перестаёт закрывать popover chip-а
- `medium` · `bug` · `src/renderer/session/McpChip.tsx:401` · PR #1815
- Сценарий: focus ушёл из popover. После этого Esc больше не закрывает его.
- Исправление: слушать Esc на уровне слоя popover, а не на элементе с focus.

#### 35. Одно неудачное чтение навсегда скрывает chip MCP у Codex
- `medium` · `bug` · `src/main/vendors/codex/session.ts:812` · PR #1817
- Сценарий: первое чтение списка серверов у Codex упало. Chip MCP больше не появляется в этой Session.
- Исправление: повторять чтение и показывать chip после успеха.

#### 36. Sign in с Linked machine открывает browser не там
- `medium` · `boundary` · `src/main/vendors/claude/mcp.ts:203` · PR #1822
- Сценарий: пользователь на Linked machine нажимает Sign in у MCP-сервера. Browser для входа открывается на машине Project, а не у пользователя.
- Исправление: открывать URL входа на той машине, где нажата кнопка.

#### 37. Docs не говорят, что Reconnect у Codex перечитывает config
- `medium` · `docs-mismatch` · `docs/features/mcp-servers.md:118` · PR #1817
- Сценарий: Reconnect у Codex перечитывает config. Сервер, добавленный в config, появляется посреди Wave. Страница этого не описывает.
- Исправление: описать это на странице или не перечитывать config при Reconnect.

#### 38. Русская страница MCP устарела
- `medium` · `docs-mismatch` · `docs/features/ru/mcp-servers.md:56` · PR #1826, #1827
- Сценарий: русская страница говорит, что Restart нет ни у одной строки. Она не знает статуса «not started» и показа ошибки в строке.
- Исправление: обновить русскую страницу по коду и английской версии.

#### 39. Ввод имени connector обещан, но не работает
- `medium` · `docs-mismatch` · `docs/features/mcp-servers.md:112` · PR #1844
- Сценарий: docs и hint в popover предлагают ввести имя connector-а claude.ai. Claude Code отбрасывает такое имя по regex, и ввод ничего не делает.
- Исправление: убрать обещание из hint и docs.

#### 40. `turning=true` на init не проверен
- `medium` · `test-gap` · `src/main/vendors/claude/session.ts:532` · PR #1816
- Сценарий: установка `turning=true` при событии init не закреплена test-ом. Если её убрать, tests проходят.
- Исправление: test на событие init после restart.

#### 41. Правило заметки «takes effect from the next Wave» не проверено
- `medium` · `test-gap` · `src/renderer/session/McpChip.tsx:446` · PR #1815
- Сценарий: когда chip показывает заметку «takes effect from the next Wave», не закреплено test-ом. Заметку можно потерять или показать не там, и tests этого не заметят.
- Исправление: unit test для Session Orchestrator-а и обычной Session.

#### 42. Guard от устаревшего списка у Codex не проверен
- `medium` · `test-gap` · `src/main/vendors/codex/session.ts:879` · PR #1817
- Сценарий: проверка, которая отбрасывает устаревший ответ со списком серверов, не закреплена test-ом. Без неё старый ответ затирает новый, а tests проходят.
- Исправление: test с двумя ответами в обратном порядке.

#### 43. Строка journal от mcpAction не проверена
- `medium` · `test-gap` · `src/main/ipc/agent.ts:363` · PR #1811
- Сценарий: запись в journal о действии с MCP-сервером не закреплена test-ом. Её удаление tests не ловят.
- Исправление: contract test на эту запись.

## Autopilot и Orchestrator

Область: Autopilot, очередь Epic-ов, Auto-continue (продолжение после лимита или ошибки API), ожидание лимитов.

#### 44. Force stop отдаёт ждущую Wave в Session человека
- `high` · `bug` · `src/main/agent/session.ts:449` · PR #1601
- Сценарий: после Force stop `handOverQueue` передаёт в Session, которую ведёт человек, всё из `run.waiting`: Wave, которая ещё не ушла, текст Stop и сообщение из crash-wait. Hold не ставится, и всё это отправляется само. Wave выполняется в Session человека. Это нарушает ADR-0050 (после остановки run сообщения уходят только по «Send queued») и `docs/features/autopilot-faults.md:96`.
- Исправление: после остановки отбрасывать или держать `run.waiting`; `dropQueuedWave` должен видеть `run.waiting`.

#### 45. Перетаскивание вниз ставит строку ниже линии
- `medium` · `bug` · `src/renderer/autopilot/QueueList.tsx:85` · PR #1542
- Сценарий: в очереди Epic-ов строку тянут вниз. Она встаёт на одно место ниже нарисованной линии из-за ошибки `splice` в `moveRow`. Epic-и идут не в том порядке. Tests тянут строки только вверх.
- Исправление: при `from < to` вставлять в `index - 1`; добавить test перетаскивания вниз.

#### 46. Правило I4 считает корректный run нарушением
- `medium` · `bug` · `test/autopilot-invariants.ts:220` · PR #1547
- Сценарий: проверка journal (правило I4) требует события `resumed` после каждого `turn-retry`. Код законно пишет `turn-retry` → `turn-retry`, `retry-refused` и `run-stopped` без `resumed`. Корректный run помечается нарушением. Unit test в строках 254–258 закрепляет эту ошибку.
- Исправление: принимать эти события после `turn-retry`.

#### 47. Повторное чтение лимитов Codex ждёт до weekly reset
- `medium` · `bug` · `src/main/autopilot/limits-wait.ts:269` · PR #1562
- Сценарий: после ожидания ручного turn лимиты Codex читаются снова. `rateLimitReachedType` помечает все окна как исчерпанные. Autopilot ждёт weekly reset (до 3 дней) вместо 5-часового окна.
- Исправление: судить по `usedPercent` каждого окна, как делает `codexLimitReached`.

#### 48. Известный reset показан как «no reset time reported»
- `medium` · `bug` · `src/shared/ipc/auto-continue.ts:121` · PR #1563
- Сценарий: окно лимита пришло как null, хотя время reset известно. Auto-continue показывает «no reset time reported · next try». В `ContinueWait` нет вида плана, и текст выбирается неверно.
- Исправление: передавать в wait вид плана.

#### 49. Test читает state раньше, чем он записан
- `medium` · `bug` · `test/contract/autopilot-retry.test.ts:620` (также `test/contract/codex-orchestrator.test.ts:868`) · PR #1617
- Сценарий: test ждёт строку waiting-until и сразу читает state. State выставляется только после завершения append. Это race: test иногда падает (flaky test).
- Исправление: ждать нужного state, а не строки.

#### 50. Поле `epic` в journal не всегда Epic run-а
- `medium` · `docs-mismatch` · `docs/features/autopilot.md:398` (и `docs/features/ru/autopilot.md:404`) · PR #1566
- Сценарий: документ утверждает, что поле `epic` каждой строки journal — Epic run-а. События `epic-finished` с причиной removed или elsewhere несут другой Epic. Читатель journal ошибётся.
- Исправление: описать это исключение.

#### 51. CONTEXT.md называет «окном запуска» две разные вещи
- `medium` · `docs-mismatch` · `CONTEXT.md:108` · PR #1566
- Сценарий: запись Run называет «окном запуска» окно Start Autopilot. Glossary определяет «окно запуска» как часы Start window, то есть время, когда run разрешено начинать.
- Исправление: писать «окно Start Autopilot».

#### 52. Предел в 5 retry ручного продолжения не проверен
- `medium` · `test-gap` · `src/main/agent/orchestrator-continue.ts:254` · PR #1548
- Сценарий: предел в 5 retry и растущие паузы не закреплены test-ом. Mutant, который заменяет `cancel()` на `passed()`, выживает: Autopilot бесконечно показывает «retry 1 of 5».
- Исправление: test с подряд идущими ответами 529 до «gave up after 5 retries».

#### 53. Запись вызовов при возврате Session человеку не проверена
- `medium` · `test-gap` · `src/main/agent/orchestrator-continue.ts:247` · PR #1548
- Сценарий: запись вызовов, пока Session принадлежит run, не закреплена test-ом, mutant выживает. Если Session вернули человеку посреди turn, Autopilot может отправить «continue» после незавершённого `git push`.
- Исправление: test возврата Session посреди turn.

#### 54. Ветки take-back и правки между Wave не проверены
- `medium` · `test-gap` · `src/renderer/canvas/actions/AutopilotAction.tsx:466` · PR #1549
- Сценарий: ответы `editQueue` на отмену добавления (`noteEdit 'unadd'`) и на правку между Wave не закреплены test-ами. Chip «Joins after this Wave» может зависнуть, и tests этого не заметят.
- Исправление: unit tests на эти ответы `editQueue`.

#### 55. Остановка waits-owner в середине очереди не проверена
- `medium` · `test-gap` · `src/main/autopilot/run.ts:1549` · PR #1577
- Сценарий: Epic в середине очереди ждёт владельца, а все следующие Epic-и идут в другом месте. Этот случай не закреплён test-ом. Mutant выживает, и run останавливается с причиной blocked-tickets вместо waits-owner.
- Исправление: contract test на этот случай.

#### 56. Флаг `paused` для waiting-сообщений не проверен
- `medium` · `test-gap` · `src/main/agent/session.ts:452` · PR #1601
- Сценарий: передача `paused: queued.paused` для сообщений из `run.waiting` не закреплена test-ом. Mutant с `paused: false` выживает: очередь, которую держат (held), уходит сама.
- Исправление: test с held queue и waiting-сообщением.

## Product Session и Mind map

Область: Product Session, её chat и панели, Mind map, чтение файлов тем в `docs/product/`.

#### 57. «Fit» не срабатывает после пересборки nodes
- `high` · `bug` · `src/renderer/product/MindMap.tsx:663` · PR #1648
- Сценарий: кнопка «Fit» и автоматический refit после раскладки ELK (библиотека раскладки графа) не срабатывают, когда объекты node пересобраны и их размеры (`measured`) потеряны. Позже добавленный node притягивает камеру к себе, и карта уезжает.
- Исправление: вызывать `setViewport` по вычисленным границам, как это делает Prettify.

#### 58. Symlink в папке темы ведёт к утечке NTLM на Windows
- `medium` · `bug` · `src/main/product/topic.ts:147` (и `src/main/docs/watch.ts:211`) · PR #1607, #1625
- Сценарий: на Windows в папке темы лежит symlink на `map.md`, `issues/` или `mind-map.json`, который указывает на чужой сетевой host. worfy читает файл, и Windows сама отправляет NTLM-данные входа пользователя на этот host. Клик пользователя не нужен. `mind_map_read` ничего не проверяет.
- Исправление: проверять каждый файл через `walkLinks`.

#### 59. product.share читает папку до проверки ссылки
- `medium` · `bug` · `src/main/ipc/product.ts:60` · PR #1672
- Сценарий: `product.share` делает `readdir` для `docs/product` до проверки, не ведёт ли путь на удалённый host. File-symlink-и в `critic/` разыменовываются. На Windows это тоже может отправить NTLM-данные на чужой host.
- Исправление: проверять ссылку до `readdir` и для каждого файла.

#### 60. New Product Session на Linked machine со старой сборкой
- `medium` · `bug` · `src/renderer/palette/commands.ts:199` · PR #1623
- Сценарий: на Linked machine стоит сборка worfy старше PR #1603. Команда New Product Session создаёт там обычную Session без ограничений Product Session и открывает её как Product.
- Исправление: проверять `result.kind`; если это не Product, отказывать и закрывать Session.

#### 61. Потерянный pointerup оставляет drag split-а активным
- `medium` · `bug` · `src/renderer/session/SplitDivider.tsx:81` · PR #1624
- Сценарий: событие `pointerup` потерялось, и drag не завершается. Следующее нажатие двигает split и сохраняет его положение.
- Исправление: отменять drag по `pointerdown`, как в FocusMode, и сбрасывать `moving`.

#### 62. «Show in the chat» без нужного сообщения
- `medium` · `bug` · `src/renderer/product/MindMap.tsx:986` · PR #1659
- Сценарий: карточка node предлагает «Show in the chat», когда в открытом chat нет нужного сообщения. Клик ничего не делает.
- Исправление: предлагать действие только при наличии сообщения.

#### 63. Chip темы, которой нет на карте, не работает
- `medium` · `bug` · `src/renderer/product/MindMap.tsx:1105` · PR #1659
- Сценарий: клик по chip темы, которой нет на текущей карте, ничего не делает.
- Исправление: переключать карту на эту тему.

#### 64. После Resume неудачный turn не показывает ошибку
- `medium` · `bug` · `src/renderer/session/product-session.ts:33` · PR #1695
- Сценарий: после Resume или reload окна неудачный turn выглядит как обычный. В файле Session лежит synthetic-текст без result, и ошибка не показывается.
- Исправление: показывать synthetic error.

#### 65. После Resume пропадают ответы на AskUserQuestion
- `medium` · `bug` · `src/renderer/session/product-session.ts:36` · PR #1695
- Сценарий: после Resume или reload пропадают отвеченный AskUserQuestion (вопрос agent с вариантами ответа) и выбор владельца.
- Исправление: рисовать строку tools из файла Session.

#### 66. Скрытый Subagent нельзя вернуть из вида Product
- `medium` · `bug` · `src/renderer/session/ProductSessionPanel.tsx:65` · PR #1702
- Сценарий: в виде Product нет пункта Show hidden. Subagent, которого однажды скрыли, вернуть нельзя.
- Исправление: добавить Show hidden в список agents.

#### 67. Сдвиг на 1 px выключает refit
- `medium` · `bug` · `src/renderer/product/MindMap.tsx:1315` · PR #1714
- Сценарий: при обычном клике по карте мышь сдвигается на 1 px. Ставится `movedByHand`, и refit при изменении размера окна молча выключается.
- Исправление: ставить флаг в `onMoveEnd` и только после порога сдвига.

#### 68. Смена темы оставляет ring на сообщении
- `medium` · `bug` · `src/renderer/product/MindMap.tsx:1009` · PR #1719
- Сценарий: при открытой карточке node пользователь меняет тему. Карта размонтируется, а ring (обводка) на связанном сообщении в chat остаётся.
- Исправление: снимать ring в cleanup при unmount.

#### 69. Панель Idea generator всегда пуста
- `medium` · `bug` · `src/renderer/session/ProductRailPanels.tsx:136` · PR #1726
- Сценарий: панель ищет ответ Subagent-а product-ideas. Но product-ideas — skill, а не Subagent, поэтому панель никогда ничего не показывает.
- Исправление: брать ответ после вызова Skill или запускать skill как fork.

#### 70. Метка «not sent» невидима
- `medium` · `bug` · `src/renderer/session/session.css:834` · PR #1729
- Сценарий: метка «not sent» окрашена token-ом `--danger-text`, а он совпадает с цветом фона. Пользователь не видит, что сообщение не ушло.
- Исправление: взять красный token для текста.

#### 71. Close и Resume возвращают старую очередь
- `medium` · `bug` · `src/renderer/session/SessionView.tsx:320` · PR #1729
- Сценарий: пользователь закрывает Session и открывает её снова через Resume. Старая очередь возвращается как живые пузыри «queued · held».
- Исправление: очищать queue закрытой Session.

#### 72. Строка статуса переполняет узкий chat
- `medium` · `bug` · `src/renderer/session/session.css:870` · PR #1735
- Сценарий: в узком chat строка статуса не помещается, и появляется горизонтальный scroll.
- Исправление: `max-width: 100%` у meta.

#### 73. «Writing <file>» лишь мелькает
- `medium` · `bug` · `src/renderer/session/advisor-status.ts:162` · PR #1735
- Сценарий: шаг tool становится известен только после того, как вызов записан целиком. Статус «Writing <file>» появляется на миг, когда запись уже кончилась.
- Исправление: брать события начала блока или выбрать другую подпись.

#### 74. Move nodes и Prettify не объясняют, почему выключены
- `medium` · `bug` · `src/renderer/product/MindMap.tsx:1241` · PR #1740
- Сценарий: кнопки Move nodes и Prettify выключаются через `disabled`, а причина записана в `title`. Пользователь клавиатуры на выключенную кнопку не попадает и причину не узнаёт.
- Исправление: `aria-disabled` и kit Tooltip.

#### 75. «Message» и «Changed by» описаны не так, как работает restamp
- `medium` · `docs-mismatch` · `docs/features/product-session.md:310` · PR #1714
- Сценарий: страница описывает поля «Message» и «Changed by» иначе, чем их заполняет `mind_map_update` при restamp (перезаписи отметки статуса). Пользователь видит у node не то сообщение, что ждёт по docs.
- Исправление: хранить сообщение каждого статуса или переименовать поля.

#### 76. Сообщения «not sent» пропадают после reload
- `medium` · `docs-mismatch` · `docs/features/product-session.md:114` · PR #1729
- Сценарий: сообщения со статусом «not sent» исчезают после reload окна, а страница об этом молчит. Пользователь рассчитывает отправить их снова и теряет текст.
- Исправление: сохранять такие сообщения или описать это в docs.

#### 77. «Always allow in <folder>» может разрешить корень repository или home
- `medium` · `docs-mismatch` · `docs/features/product-session.md:132` · PR #1749
- Сценарий: docs говорят, что так нельзя разрешить корень repository или домашнюю папку. На деле кнопка может добавить и их, и Product Session получает право записи туда.
- Исправление: запретить такие папки в коде или поправить docs.

#### 78. Отказ читать тему по удалённой ссылке не проверен
- `medium` · `test-gap` · `src/main/docs/watch.ts:207` · PR #1625
- Сценарий: отказ `readProductTopic` на ссылке к удалённому host не закреплён test-ом. Если проверку удалить, проходит даже Windows CI.
- Исправление: test по образцу `docs-remote-links`.

#### 79. Нечитаемый mind-map.json не проверен
- `medium` · `test-gap` · `src/main/product/topic.ts:158` · PR #1607
- Сценарий: ошибка чтения повреждённого `mind-map.json` не закреплена test-ом. Если её удалить, writer перезапишет карту одним node, а tests пройдут. Фильтр `STATUS_WORDS` в строке 109 тоже не проверен.
- Исправление: tests на повреждённый файл и на фильтр.

#### 80. Отказ readReviews нельзя проверить
- `medium` · `test-gap` · `src/main/ipc/product.ts:41` · PR #1672
- Сценарий: отказ `readReviews` на удалённой ссылке не проверен. Написать test сейчас нельзя: у функции нет опций `paths` и `links`.
- Исправление: добавить эти опции и написать test.

#### 81. Одновременные signals сохранения не проверены
- `medium` · `test-gap` · `test/contract/product-save-signal.test.ts:139` · PR #1647
- Сценарий: два signal-а сохранения проверяются только после `sent`. Если удалить цепочку по Project, tests проходят, а на деле откроются два docs PR.
- Исправление: test с одновременными signals.

#### 82. Центрирование по клику chip не проверено
- `medium` · `test-gap` · `src/renderer/product/MindMap.tsx:1116` · PR #1659
- Сценарий: вызов `setCenter` по клику chip не закреплён test-ом.
- Исправление: unit test на клик chip.

#### 83. Chips решения не проверены
- `medium` · `test-gap` · `src/renderer/product/node-chips.ts:45` · PR #1713
- Сценарий: chip решения без overturn и mark ✕ не закреплены test-ами. Выживают 2–3 mutant.
- Исправление: tests на оба случая.

#### 84. Карточка, которая следует за node, не проверена
- `medium` · `test-gap` · `src/renderer/product/MindMap.tsx:806` · PR #1714
- Сценарий: то, что карточка node следует за ним при движении камеры, не закреплено test-ом.
- Исправление: test со сдвигом камеры.

#### 85. Сброс movedByHand и кнопка «−» не проверены
- `medium` · `test-gap` · `src/renderer/product/MindMap.tsx:1130` · PR #1714
- Сценарий: сброс `movedByHand` при смене темы или вида и кнопка «−» не закреплены test-ами.
- Исправление: tests на смену темы, смену вида и «−».

#### 86. Автор цитаты «#N You» не проверен
- `medium` · `test-gap` · `src/renderer/session/Transcript.tsx:763` · PR #1716
- Сценарий: подпись автора цитаты «#N You», которая приходит через chat, не закреплена test-ом.
- Исправление: test цитаты своего сообщения.

#### 87. Снятие ring при уходе node из темы не проверено
- `medium` · `test-gap` · `src/renderer/product/MindMap.tsx:1007` · PR #1719
- Сценарий: снятие ring с сообщения, когда node уходит из темы, не закреплено test-ом.
- Исправление: test с удалением node из темы.

#### 88. Концы и направление стрелок Graph не проверены
- `medium` · `test-gap` · `src/renderer/product/MindMap.tsx:460` · PR #1724
- Сценарий: у какого node начинается и кончается стрелка в виде Graph, не закреплено test-ом.
- Исправление: test на концы стрелок.

#### 89. Связка chatQueue не проверена
- `medium` · `test-gap` · `src/renderer/session/SessionView.tsx:320` · PR #1729
- Сценарий: вызов `chatQueue(queue, state)` не закреплён test-ом. Если его сломать, tests проходят.
- Исправление: test вида Session с очередью.

#### 90. Перезапуск времени шага не проверен
- `medium` · `test-gap` · `src/renderer/session/AdvisorStatus.tsx:47` · PR #1735
- Сценарий: часы шага в строке статуса должны начинаться заново на новом шаге. Это не закреплено test-ом.
- Исправление: test со сменой шага.

#### 91. Сброс `cleared` после Prettify не проверен
- `medium` · `test-gap` · `src/renderer/product/MindMap.tsx:951` · PR #1740
- Сценарий: сброс `cleared` после успешного Prettify не закреплён test-ом. `setDragged` тоже не проверен.
- Исправление: test успешного Prettify.

#### 92. Abort запроса к Haiku не проверен
- `medium` · `test-gap` · `src/main/agent/narrator.ts:249` · PR #1743
- Сценарий: отмена запроса к Haiku в конце turn не закреплена test-ом. Без неё зависший запрос глушит live summary (короткую сводку о ходе работы).
- Исправление: test с запросом, который не отвечает.

#### 93. Связка productWrites не проверена
- `medium` · `test-gap` · `src/main/vendors/claude/query.ts:376` · PR #1749
- Сценарий: передача `productWrites` в `sdkQueryFactory` не закреплена test-ом. Если её удалить, tests проходят, а все записи Product Session вне её папки отклоняются.
- Исправление: test, который проверяет переданную опцию.

## Harness

Область: скрипты `harness/bin/`, hooks, skills, agents и eval-ы Harness, а также установка Harness из worfy.

#### 94. Записи через gh api проверяются по project текущей папки
- `high` · `bug` · `harness/hooks/guard.mjs:673` · PR #1754
- Сценарий: guard (hook, который проверяет команды перед запуском) определяет project для записи через `gh api` по папке, где запущена команда. Из корня Project с несколькими repository или из папки вне registry запись уходит в PR без проверки.
- Исправление: определять repository по пути endpoint (`repos/<owner>/<repo>/…`).

#### 95. Файл для `--input` проверяется со старым содержимым
- `medium` · `bug` · `harness/hooks/guard.mjs:661` · PR #1754
- Сценарий: команда сначала переписывает файл, а потом отправляет его через `--input` или `-F @file`. Guard читает файл до запуска команды и проверяет старое содержимое.
- Исправление: отказывать, если файл пишется в той же команде.

#### 96. Update Harness молча удаляет plugin mattpocock-skills
- `medium` · `bug` · `src/main/harness/install.ts:423` (и `docs/features/harness.md:239`) · PR #1611, #1638
- Сценарий: диалог Update Harness обещает, что больше ничего не меняется, а затем выполняется uninstall plugin-а mattpocock-skills. Правило 10-минутного окна может удалить plugin, который пользователь поставил сам. Docs говорят «никогда».
- Исправление: называть команду в диалоге и добавить оговорку в docs.

#### 97. frontier показывает чужой claimed ticket
- `medium` · `bug` · `harness/bin/TICKETS.md:278` · PR #1589
- Сценарий: документированная команда frontier показывает ticket, который уже claimed или blocked. `ticket claim` перезаписывает чужой claim. Две session берут один ticket.
- Исправление: убрать claimed и blocked из frontier; `claim` должен отказывать при чужом claim.

#### 98. В шаблоне to-tickets нет `## Done when`
- `medium` · `bug` · `harness/skills/to-tickets/SKILL.md:79` · PR #1589
- Сценарий: шаблон ticket-а без раздела `## Done when`. Evidence (подтверждения выполнения) никогда не привязывается к ticket-ам, созданным этим skill-ом.
- Исправление: добавить раздел в шаблон.

#### 99. Skills создают GLOSSARY.md в корне
- `medium` · `bug` · `harness/skills/domain-modeling/SKILL.md:40` · PR #1589
- Сценарий: skill создаёт `GLOSSARY.md` в корне repository, хотя profile называет файл glossary в поле `docs.context`.
- Исправление: брать путь из `docs.context`.

#### 100. worktree-lock на недоступном сетевом share превышает лимит hook
- `medium` · `bug` · `harness/bin/worktree-lock:63` · PR #1630
- Сценарий: `statSync` для недоступного сетевого share отвечает долго. Claim держится дольше 10-секундного лимита hook, и это повторяется каждый день.
- Исправление: пропускать сетевые пути или проверять их с timeout.

#### 101. Grader numbered-round требует буквального `**Q1**`
- `medium` · `bug` · `harness/evals/skill-grilling-trigger/graders/numbered-round.md:3` · PR #1642
- Сценарий: grader засчитывает раунд вопросов, только если в последнем сообщении есть буквальный `**Q1**`. Верный ответ с другой разметкой номеров проваливает eval.
- Исправление: принимать нумерованные вопросы в любой разметке.

#### 102. Critic в Silent mode пишет review не туда
- `medium` · `bug` · `harness/agents/critic.md:24` · PR #1654
- Сценарий: в Silent mode `profile -C` по папке плана падает. Critic (agent, который проверяет spec перед принятием) не находит profile и пишет review не в ту папку.
- Исправление: вызывать profile по папке repository.

#### 103. product-ideas не видит specs в Product Session
- `medium` · `bug` · `harness/skills/product-ideas/SKILL.md:17` · PR #1658
- Сценарий: guard Product Session отклоняет `bin/ticket root`. Запасной путь в Silent mode не видит specs. Skill предлагает идеи, не зная текущего плана работ.
- Исправление: разрешить `bin/ticket root` в Product Session или дать путь к specs иначе.

#### 104. Шаблон branch `<epic>/<NN>-<slug>` не распознаётся
- `medium` · `bug` · `harness/hooks/stage-lines.mjs:121` · PR #1663
- Сценарий: hook stage-lines не распознаёт branch вида `<epic>/<NN>-<slug>`. Для таких branch строка статуса Epic не появляется.
- Исправление: добавить этот шаблон.

#### 105. Ответы владельца записываются в форме, которую не читает share.ts
- `medium` · `bug` · `harness/agents/critic.md:160` · PR #1675
- Сценарий: critic записывает ответы владельца как «принято …». `share.ts` такую форму не распознаёт, и принятые ответы не учитываются.
- Исправление: писать в форме, которую читает `share.ts`, или научить его этой форме.

#### 106. Rerun push run-а виновника переносит вину
- `medium` · `bug` · `harness/bin/land:430` · PR #1733
- Сценарий: main красный. Кто-то делает rerun push run-а того commit-а, который сломал main. Land начинает считать виновным более поздний красный run.
- Исправление: определять виновника по commit, а не по времени run.

#### 107. Красный push run commit-а только с docs игнорируется
- `medium` · `bug` · `harness/bin/land:439` · PR #1733
- Сценарий: main сломался на commit, где менялись только docs. Land не видит этот красный run и называет виновным следующий PR с кодом.
- Исправление: учитывать красный run любого commit.

#### 108. Исправление только в docs не снимает красный main
- `medium` · `bug` · `harness/bin/land:439` · PR #1733
- Сценарий: красный main починили commit-ом, где меняются только docs. Land не учитывает его run, и main так и считается красным.
- Исправление: учитывать зелёный run любого commit.

#### 109. Голый `PR: #N` совпадает с PR в каждом repository
- `medium` · `bug` · `harness/bin/wave-brief:248` · PR #1745
- Сценарий: в ticket записано `PR: #N` без строки `Repo:`. wave-brief считает его PR с этим номером в каждом repository Project.
- Исправление: без `Repo:` брать основной repository.

#### 110. `done --pr web3#17` пишет `PR: #317`
- `medium` · `bug` · `harness/bin/ticket:633` · PR #1746
- Сценарий: `ticket done --pr web3#17` берёт цифры и из имени repository и пишет в ticket `PR: #317`.
- Исправление: разбирать `<repo>#<N>` целиком.

#### 111. `profile-set --field` внутри read-only поля ломает profile
- `medium` · `bug` · `harness/bin/profile-set:205` · PR #1759
- Сценарий: `--field` с путём внутри read-only поля не отклоняется. Скрипт записывает сломанный profile.
- Исправление: отклонять такие пути до записи.

#### 112. Правило строки base видно только с шага 2
- `medium` · `bug` · `harness/skills/ship-ticket/step-2-preflight.md:8` · PR #1766
- Сценарий: правило о строке base записано только в файле шага 2. Session, которая продолжает ticket с шага 7, этот файл не читает и правило не видит.
- Исправление: перенести правило в общий файл skill-а.

#### 113. Проверка открытых PR идёт под глобальным аккаунтом gh
- `medium` · `bug` · `harness/lib/workflow-move.cjs:207` · PR #1770
- Сценарий: перенос файлов workflow между Full и Silent mode проверяет открытые PR под глобальным аккаунтом gh. ADR-0020 (каждый Project ходит в GitHub через GH_TOKEN своего аккаунта) требует иного. Для repository другого аккаунта проверка ошибается.
- Исправление: передавать GH_TOKEN аккаунта Project.

#### 114. Папка Product Session не переносится
- `medium` · `bug` · `harness/lib/workflow-move.cjs:101` · PR #1770
- Сценарий: при переносе файлов workflow между Full и Silent mode папка Product Session остаётся на старом месте.
- Исправление: добавить её в список переносимых папок.

#### 115. Profile схемы 1 остаётся в Full mode после переноса
- `medium` · `bug` · `harness/bin/profile-set:597` · PR #1770
- Сценарий: для profile старой схемы 1 перенос переносит файлы, но режим остаётся Full. Обратный перенос после этого отклоняется.
- Исправление: обновлять схему profile при переносе.

#### 116. Test heartbeat считает до перезаписи holder.json
- `medium` · `bug` · `harness/bin/tests/wave-gate-heartbeat.test.sh:227` · PR #1629
- Сценарий: test считает записи до того, как `holder.json` перезаписан. Это race: test иногда падает (flaky test).
- Исправление: считать после записи.

#### 117. Префикс `[R] ` ломает ссылки в Evidence matrix
- `medium` · `boundary` · `harness/bin/ticket:955` · PR #1746
- Сценарий: префикс `[R] ` перед именем ломает ссылки и previews в Evidence matrix (таблице подтверждений по ticket-ам).
- Исправление: ставить префикс вне текста ссылки.

#### 118. Русская страница skills описывает удалённые hooks
- `medium` · `docs-mismatch` · `docs/features/ru/skills-agents-and-hooks.md:185` · PR #1598
- Сценарий: страница описывает удалённый `session-end.mjs`, напоминание о `/retro` и старый retro.
- Исправление: обновить страницу по английской версии.

#### 119. Пауза land при красном main не описана
- `medium` · `docs-mismatch` · `docs/features/gate-and-github.md:188` · PR #1733
- Сценарий: land ставит работу на паузу, пока main красный. Страница этого не описывает.
- Исправление: описать паузу и условие её снятия.

#### 120. Правила hostNeedles изменились, а docs нет
- `medium` · `docs-mismatch` · `docs/features/gate-and-github.md:365` (и `docs/features/evidence.md:174`) · PR #1797
- Сценарий: правила поиска имени host (`hostNeedles`) изменились. Обе страницы обещают старое поведение.
- Исправление: обновить обе страницы.

#### 121. Неявный POST только с `--input` не проверен
- `medium` · `test-gap` · `harness/hooks/guard.mjs:643` · PR #1754
- Сценарий: `gh api` с `--input` и без `-X POST` — тоже запись. Этот случай не закреплён test-ом.
- Исправление: test на такую команду.

#### 122. Флаги со значением перед путём не проверены
- `medium` · `test-gap` · `harness/hooks/guard.mjs:603` · PR #1754
- Сценарий: `gh api` с флагами со значением (`-H`, `--hostname`, `--field`) перед путём не закреплён test-ом. Разбор пути может сломаться незаметно.
- Исправление: tests на эти флаги.

#### 123. Перечитывание под mutex не проверено
- `medium` · `test-gap` · `harness/bin/tests/worktree-lock-prune.test.sh:142` · PR #1630
- Сценарий: перечитывание lock-файла под mutex и снятие mutex, когда файл оставлен, не закреплены test-ом.
- Исправление: test, где файл меняется между двумя чтениями.

#### 124. Grader no-old-header пропускает старые header
- `medium` · `test-gap` · `harness/evals/skill-to-tickets-format/graders/no-old-header.md:4` · PR #1642
- Сценарий: grader должен ловить старую форму header ticket-а, но пропускает многие её варианты.
- Исправление: перечислить в grader все старые формы.

#### 125. Фильтр done и ранний return в stage-lines не проверены
- `medium` · `test-gap` · `harness/hooks/tests/rules-hooks.test.sh:843` · PR #1663
- Сценарий: фильтр закрытых (done) ticket-ов и ранний return hook-а не закреплены test-ами.
- Исправление: tests на оба случая.

## Vendors

Область: интеграция с Claude Code SDK и Codex.

#### 126. Alias haiku теперь Haiku 5.5 с adaptive thinking
- `high` · `bug` · `src/main/vendors/claude/terminal-ai.ts:69` (и `src/main/agent/narrator.ts:53`) · PR #1787
- Сценарий: после обновления SDK alias `haiku` указывает на Haiku 5.5, а выключенный thinking превращается в adaptive. Suggestions Terminal AI отменяются, как только model начинает думать. У narrator (live summary) thinking съедает лимит в 256 tokens, и на сам текст tokens не остаётся.
- Исправление: закрепить `claude-haiku-4-5` или поддержать adaptive thinking.

#### 127. Docs обещают gate на каждом turn Codex
- `medium` · `docs-mismatch` · `docs/features/vendors.md:56` · PR #1800
- Сценарий: страница говорит, что Stop hook запускает gate на каждом turn Codex. В main checkout этот шаг пропускается.
- Исправление: добавить оговорку про main checkout.

## UI kit и shell

Область: общие компоненты kit (Dialog, Popover, Tooltip), окно First run, sidebar, Settings, экраны Projects.

#### 128. Метка «Running…» стартует до ответа в Confirm
- `medium` · `bug` · `src/renderer/shell/FirstRunChecks.tsx:498` · PR #1739
- Сценарий: в окне First run метка «Running…» и часы стартуют до ответа в диалоге Confirm, даже если пользователь потом нажмёт Cancel.
- Исправление: запускать метку и часы после подтверждения.

#### 129. «Remove project…» на Demo project оставляет demo застрявшим
- `medium` · `bug` · `src/renderer/shell/sidebar/ProjectsSection.tsx:601` · PR #1741
- Сценарий: пользователь удаляет Demo project через «Remove project…». Demo остаётся в застрявшем состоянии.
- Исправление: для Demo project выходить из demo целиком или не показывать этот пункт.

#### 130. Вложенный repository со своим Profile считается частью удаляемого
- `medium` · `bug` · `src/main/projects/remove.ts:138` · PR #1741
- Сценарий: внутри удаляемого Project лежит repository со своим Profile. Его Session тоже закрываются, и notice называет неверный набор.
- Исправление: исключать вложенные Project со своим Profile.

#### 131. Вариант «default» в Edit Profile всегда отклоняется
- `medium` · `bug` · `src/renderer/projects/EditProfile.tsx:426` · PR #1759
- Сценарий: для полей Team, Documents и Attribution вариант «default» при сохранении всегда отклоняется.
- Исправление: принимать «default» как отсутствие значения.

#### 132. Колонка Harness вылезает за toolbar при масштабе 120–150%
- `medium` · `bug` · `src/renderer/shell/shell.css:442` · PR #1779
- Сценарий: при масштабе 120–150% трёхстрочная колонка Harness выходит за границы toolbar.
- Исправление: разрешить колонке сжиматься или убрать третью строку при нехватке места.

#### 133. Точка на rail горит для каждого Ticket в работе
- `medium` · `bug` · `src/renderer/shell/sidebar/PipelineSection.tsx:52` · PR #1786
- Сценарий: точка на rail должна звать человека, но горит для каждого Ticket в работе.
- Исправление: показывать точку по `waitsForPerson`.

#### 134. Однострочные строки обрезают даже короткую branch
- `medium` · `bug` · `src/renderer/shell/sidebar/ProjectsSection.tsx:79` · PR #1807
- Сценарий: в однострочной строке Project имя branch обрезается, даже когда оно короткое и место есть.
- Исправление: `flex: 1` у branch.

#### 135. Кнопка «Always allow in <folder>» не переносится
- `medium` · `bug` · `src/renderer/session/session.css:2157` (и `test/e2e/product-write-outside.spec.ts:73`) · PR #1813
- Сценарий: у кнопки стоит `nowrap`, и длинный путь выходит за карточку. E2e test этого не видит.
- Исправление: разрешить перенос и проверять ширину в e2e test.

#### 136. Enter в popup внутри Node меняет выделение на Canvas
- `medium` · `bug` · `src/renderer/theme/kit/layer.ts:31` · PR #1820
- Сценарий: у слоя popup kit нет класса `nokey`. Enter в popup внутри Node обрабатывает ещё и Canvas, и выделение меняется.
- Исправление: добавить класс `nokey`.

#### 137. Рядом с kit tooltip виден native title предка
- `medium` · `bug` · `src/renderer/projects/read-only.ts:32` · PR #1828
- Сценарий: рядом с kit tooltip показывается native title элемента-предка. На экране два tooltip.
- Исправление: снимать `title` с предка, пока виден kit tooltip.

#### 138. Shift+Tab уходит из формы переноса
- `medium` · `bug` · `src/renderer/shell/FirstRunChecks.tsx:313` · PR #1829
- Сценарий: в форме переноса с roving tabindex (Tab переходит между группами, стрелки — внутри группы) Shift+Tab выводит focus из формы.
- Исправление: обрабатывать Shift+Tab внутри формы.

#### 139. Клик по кнопке toast закрывает popovers
- `medium` · `bug` · `src/renderer/theme/kit/Popover.tsx:176` · PR #1830
- Сценарий: пользователь нажимает кнопку в toast. Focus уходит в toast, и открытый popover закрывается.
- Исправление: не считать focus в toast уходом из popover.

#### 140. Список Select в форме переноса рисуется под формой
- `medium` · `bug` · `src/renderer/theme/kit/Dialog.tsx:165` · PR #1831
- Сценарий: список Select в форме переноса рисуется внутри Settings, под формой, и его не видно.
- Исправление: рисовать список в слое над формой.

#### 141. Focus теряется при смене kit-окон
- `medium` · `bug` · `src/renderer/theme/kit/Dialog.tsx:91` · PR #1831
- Сценарий: одно kit-окно сменяет другое, и focus теряется.
- Исправление: передавать focus в новое окно при смене.

#### 142. Command palette забирает focus у Getting started
- `medium` · `bug` · `src/renderer/palette/CommandPalette.tsx:490` · PR #1835
- Сценарий: Command palette при закрытии возвращает focus на прежний элемент. Так она забирает его у заголовка Getting started, который только что открылся.
- Исправление: не возвращать focus, если команда открыла новое окно.

#### 143. После «Run all accepted» focus оказывается на body
- `medium` · `bug` · `src/renderer/canvas/actions/action-menu.ts:46` · PR #1836
- Сценарий: после действия «Run all accepted» focus уходит на body, и клавиатура теряет место.
- Исправление: возвращать focus на кнопку меню или на Node.

#### 144. Окна из menu забирают клавиатуру у слоя toast
- `medium` · `bug` · `src/renderer/theme/kit/Dialog.tsx:187` · PR #1839
- Сценарий: Settings, Shortcuts или Guide открыты из menu поверх окна слоя toast. Они нарисованы ниже, но забирают клавиатуру.
- Исправление: отдавать клавиатуру верхнему по порядку окну.

#### 145. Tooltips частей карточки Projects не видны клавиатуре
- `medium` · `bug` · `src/renderer/shell/sidebar/ProjectsSection.tsx:368` · PR #1843
- Сценарий: tooltip-ы частей карточки висят на `span` без focus внутри `button`. Пользователь клавиатуры их не видит, экранный диктор не читает.
- Исправление: перенести описание в доступное имя кнопки или сделать части фокусируемыми.

#### 146. Общее действие не помечает вторую строку как «Running…»
- `medium` · `docs-mismatch` · `src/renderer/shell/FirstRunChecks.tsx:529` · PR #1739
- Сценарий: описание в этом месте обещает, что общее действие двух строк помечает обе как «Running…». Вторая строка больше не помечается.
- Исправление: помечать обе строки или поправить описание.

#### 147. Tooltip по focus обещан для всех write-действий
- `medium` · `docs-mismatch` · `docs/features/link.md:302` · PR #1828
- Сценарий: страница Link обещает tooltip по focus для всех write-действий в режиме read-only. Не все действия его показывают.
- Исправление: добавить tooltip всем действиям или поправить страницу.

#### 148. Закрытие Session при Remove project не проверено
- `medium` · `test-gap` · `src/main/ipc/projects.ts:271` · PR #1741
- Сценарий: закрытие Session удаляемого Project не закреплено test-ом.
- Исправление: contract test на Remove project с открытой Session.

#### 149. Subgrid полосы Limits не защищён
- `medium` · `test-gap` · `src/renderer/shell/shell.css:622` · PR #1779
- Сценарий: раскладка полосы Limits через subgrid не закреплена test-ом.
- Исправление: e2e test на выравнивание полосы.

#### 150. Badges PR и Pipeline и scope переключателя не проверены
- `medium` · `test-gap` · `src/renderer/shell/sidebar/PullRequestsSection.tsx:99` · PR #1786
- Сценарий: badges разделов PR и Pipeline и область действия переключателя не закреплены test-ами.
- Исправление: unit tests на badges и переключатель.

#### 151. processGoneNow не проверен
- `medium` · `test-gap` · `src/main/claude-home/registry.ts:315` · PR #1790
- Сценарий: проверка `processGoneNow` (process Session уже завершился) не закреплена test-ом.
- Исправление: test с завершённым process.

#### 152. NFC в assignSessions не проверен
- `medium` · `test-gap` · `src/main/claude-home/pulse.ts:74` · PR #1790
- Сценарий: приведение путей к форме Unicode NFC не закреплено test-ом. Это важно для путей с не-латинскими буквами на macOS.
- Исправление: test с путём в форме NFD.

#### 153. Полоса над sidebar при масштабе не 100% не проверена
- `medium` · `test-gap` · `src/renderer/shell/shell.css:32` · PR #1805
- Сценарий: вид полосы над sidebar при масштабе окна не 100% не закреплён test-ом.
- Исправление: e2e test при масштабе 125%.

#### 154. Esc в Connect Project не проверен
- `medium` · `test-gap` · `src/renderer/projects/ConnectProject.tsx:666` · PR #1837
- Сценарий: остановка draft по Esc и отказ закрыть окно во время записи не закреплены test-ами.
- Исправление: tests на оба случая.

#### 155. Запрет закрытия во время переноса не проверен
- `medium` · `test-gap` · `src/renderer/projects/EditProfile.tsx:465` · PR #1837
- Сценарий: окно Edit Profile нельзя закрыть во время переноса. Это не закреплено test-ом.
- Исправление: test с Esc во время переноса.

#### 156. Видимые цифры AnimatedNumber не проверяются
- `medium` · `test-gap` · `src/renderer/theme/AnimatedNumber.tsx:99` · PR #1838
- Сценарий: tests читают скрытый текст для экранного диктора, а не цифры на экране. Сломанный показ цифр проходит tests.
- Исправление: проверять видимые цифры.

## GitHub и PR inbox

Область: аккаунты GitHub, PR inbox, черновики ответов на review (pr-reply), уведомления и badges на карточках.

#### 157. На GHES доступ на запись проверяется под активным аккаунтом
- `medium` · `bug` · `src/main/github/accounts.ts:134` · PR #1637
- Сценарий: на GitHub Enterprise Server `gh` не смотрит на GH_TOKEN. Доступ на запись каждого аккаунта проверяется под активным аккаунтом gh, и результат неверен.
- Исправление: передавать `GH_ENTERPRISE_TOKEN`.

#### 158. `gh auth token -u` вызывается без `--hostname`
- `medium` · `bug` · `src/main/github/prs.ts:179` · PR #1637
- Сценарий: token аккаунта Enterprise ищется на github.com. Tracker для такого аккаунта всегда недоступен.
- Исправление: передавать `--hostname`.

#### 159. Давно не менявшийся PR больше не перечитывается
- `medium` · `bug` · `src/main/github/inbox.ts:206` · PR #1755
- Сценарий: PR долго не менялся, и PR inbox перестаёт его перечитывать. Новый конфликт или rerun CI оставляют его в неверной группе.
- Исправление: перечитывать такие PR реже, но не прекращать.

#### 160. snapshot() падает во время первого чтения
- `medium` · `bug` · `src/main/github/inbox.ts:397` · PR #1755
- Сценарий: пока идёт первое чтение, `snapshot()` бросает RangeError (`Date(-Infinity)`). Digest (сводка по PR) падает.
- Исправление: не строить дату, пока нет ни одного чтения.

#### 161. Rewrite возвращает отправленные ответы как новые drafts
- `medium` · `bug` · `harness/bin/pr-reply-draft:158` (и `src/main/github/pr-reply-send.ts:335`) · PR #1762, #1771
- Сценарий: rewrite черновиков возвращает уже отправленные или отброшенные ответы как новые drafts. Send или Send all публикует в PR дубль.
- Исправление: учитывать sent и discarded в `keptThreads`; Send сверяет с уже отправленными.

#### 162. На PR коллеги все нерешённые threads ждут пользователя
- `medium` · `bug` · `harness/skills/pr-reply/SKILL.md:65` · PR #1762
- Сценарий: на чужом PR skill считает, что пользователь должен ответить во всех нерешённых threads, даже где ход не за ним.
- Исправление: применять правило `owesAnswer`.

#### 163. Ложный alert «not in the inbox» после merge
- `medium` · `bug` · `src/renderer/pr-inbox/PrInboxView.tsx:702` · PR #1764
- Сценарий: открытый в PR inbox PR смёржен. Вид показывает alert «not in the inbox», хотя ошибки нет.
- Исправление: для смёрженного PR показывать его новое состояние.

#### 164. Badge «N sessions» обрезает ряд действий карточки
- `medium` · `bug` · `src/renderer/canvas/badges/review-threads.css:13` · PR #1768
- Сценарий: badge «N sessions» уходит на третью строку, которую раскладка не учитывает. Ряд действий карточки обрезается.
- Исправление: учесть третью строку в раскладке или не переносить badge.

#### 165. Первое чтение с упавшими details становится baseline
- `medium` · `bug` · `src/main/notify.ts:676` · PR #1769
- Сценарий: при первом чтении запрос details упал, и неполные данные стали baseline. Потом приходит пачка уведомлений о старых событиях.
- Исправление: не принимать неполное чтение за baseline.

#### 166. После сна digest строится по вчерашним данным
- `medium` · `bug` · `src/main/github/inbox-digest.ts:100` · PR #1769
- Сценарий: компьютер проснулся после сна, и digest строится по вчерашним snapshots, а не по свежему чтению.
- Исправление: перед digest ждать свежего чтения.

#### 167. Rewrite не различает два ответа в одном месте
- `medium` · `bug` · `src/renderer/pr-inbox/DraftThread.tsx:48` · PR #1771
- Сценарий: запрос на rewrite называет ответ только по месту в файле. Два ответа в одном месте неразличимы, и может переписаться не тот.
- Исправление: передавать id thread.

#### 168. Скрытый вид каждые 5 s читает drafts и запускает bin/profile
- `medium` · `bug` · `src/renderer/pr-inbox/PrInboxView.tsx:617` · PR #1782
- Сценарий: PR inbox скрыт, но раз в 5 s читает drafts и запускает `bin/profile`. Это лишняя нагрузка всё время, пока открыто окно.
- Исправление: останавливать опрос, пока вид скрыт.

#### 169. «Answer N open threads» считает все нерешённые threads
- `medium` · `bug` · `src/renderer/pr-inbox/usePrInbox.ts:330` · PR #1782
- Сценарий: число в кнопке включает threads, где ход не за пользователем.
- Исправление: считать `waitingThreads`.

#### 170. Выбор PR делается при старте окна, а не при открытии вида
- `medium` · `bug` · `src/renderer/pr-inbox/PrInboxView.tsx:699` · PR #1782
- Сценарий: PR inbox выбирает PR, пока вид ещё скрыт, при старте окна. Когда пользователь открывает вид, выбор уже устарел.
- Исправление: выбирать PR при открытии вида.

#### 171. Markdown комментариев разбирается на каждый опрос и каждое нажатие
- `medium` · `bug` · `src/renderer/pr-inbox/CommentBody.tsx:10` · PR #1792
- Сценарий: текст комментариев разбирается заново раз в 5 s и на каждое нажатие клавиши. Это ~195 ms каждый раз, и ввод тормозит.
- Исправление: `React.memo`.

#### 172. Verdict по каждому repository не доходит до badges
- `medium` · `docs-mismatch` · `docs/features/projects.md:178` · PR #1763
- Сценарий: страница обещает verdict для каждого repository. Marks Project-а в Silent mode до badges не доходят.
- Исправление: передавать эти marks в badges или поправить страницу.

#### 173. Настоящие тексты GraphQL timeout не проверены
- `medium` · `test-gap` · `src/main/github/inbox.ts:195` · PR #1755
- Сценарий: распознавание timeout проверено на придуманных текстах ошибки, а не на тех, что присылает GitHub.
- Исправление: fixtures с настоящими ответами GitHub.

#### 174. GH_TOKEN по аккаунту в уведомлениях не проверен
- `medium` · `test-gap` · `src/main/github/inbox-notifications.ts:220` · PR #1761
- Сценарий: выбор GH_TOKEN нужного аккаунта при чтении уведомлений не закреплён test-ом.
- Исправление: test с двумя аккаунтами.

#### 175. Сохранение cursor без pulls не проверено
- `medium` · `test-gap` · `src/main/projects/pr-inbox-state.ts:66` · PR #1761
- Сценарий: то, что сохранение cursor не трогает сохранённые pulls, не закреплено test-ом.
- Исправление: test сохранения cursor поверх pulls.

#### 176. Освобождение нескольких папок при unmount не проверено
- `medium` · `test-gap` · `src/renderer/canvas/badges/use-checks.ts:208` · PR #1763
- Сценарий: при unmount карточки с несколькими repository подписки на все папки должны сниматься. Это не закреплено test-ом.
- Исправление: test unmount с двумя папками.

#### 177. Слияние changesRequested и цель клика не проверены
- `medium` · `test-gap` · `src/renderer/canvas/badges/review-threads.ts:64` · PR #1768
- Сценарий: при нескольких PR слияние `changesRequested` и то, какой PR открывает клик, не закреплены test-ами.
- Исправление: test с двумя PR.

#### 178. Клик по уведомлению о PR не проверен
- `medium` · `test-gap` · `src/renderer/canvas/overlays/NotificationTarget.tsx:86` · PR #1769
- Сценарий: переход по клику на уведомление о PR не закреплён test-ом.
- Исправление: unit test на клик.

#### 179. Связка переключателей Settings не проверена
- `medium` · `test-gap` · `src/main/index.ts:191` · PR #1769
- Сценарий: передача переключателей уведомлений из Settings в main process не закреплена test-ом.
- Исправление: test на включение и выключение.

#### 180. Lint с правилами Project не проверен
- `medium` · `test-gap` · `src/main/ipc/pr-inbox.ts:120` · PR #1771
- Сценарий: вызов lint с `-C` и `--rules` Project-а не закреплён test-ом.
- Исправление: contract test на аргументы lint.

#### 181. Сбой записи in-flight mark не проверен
- `medium` · `test-gap` · `src/main/github/pr-reply-send.ts:352` · PR #1771
- Сценарий: поведение Send, когда отметка «отправка идёт» (in-flight mark) не записалась, не закреплено test-ом.
- Исправление: test со сбоем записи.

#### 182. `default(null)` для старых peer не проверен
- `medium` · `test-gap` · `src/shared/ipc/pr-inbox.ts:76` · PR #1782
- Сценарий: значение по умолчанию для peer со старой сборкой не закреплено test-ом.
- Исправление: test разбора сообщения без нового поля.

#### 183. CSS overflow и white-space у chip не защищены
- `medium` · `test-gap` · `test/unit/pr-inbox-view.test.tsx:337` · PR #1789
- Сценарий: test не проверяет `overflow` и `white-space` у chip. Длинный текст может сломать строку незаметно.
- Исправление: e2e test с длинным текстом chip.

## Sessions и chat

Область: вид Session, поле ввода, очередь сообщений, цитаты, Nodes на Canvas.

#### 184. Запрос background task не виден в новом окне
- `medium` · `bug` · `src/renderer/session/open-requests.ts:60` · PR #1731
- Сценарий: background task Session ждёт ответа пользователя, а сама Session простаивает. Окно, открытое или перезагруженное после этого, не спрашивает `agent.requests`, и карточки запроса нет. Через 60 минут запрос истекает.
- Исправление: спрашивать `agent.requests` при любом state Session.

#### 185. Focus mode расщепляет draft
- `medium` · `bug` · `src/renderer/session/drafts.ts:130` · PR #1780
- Сценарий: Focus mode монтирует один draft дважды, и копии расходятся. Отправленный текст остаётся в поле на Canvas, а набранный в Focus mode теряется.
- Исправление: общий store (`useSyncExternalStore`).

#### 186. Find не подсвечивает совпадения в цитате
- `medium` · `bug` · `src/renderer/session/QuotedPrompt.tsx:91` · PR #1791
- Сценарий: Find ищет по сырому тексту prompt, а пузырь показывает разобранный. Найденные совпадения не подсвечиваются.
- Исправление: искать по тому же тексту, который виден.

#### 187. «Show all» не появляется после замены цитаты
- `medium` · `bug` · `src/renderer/session/QuotedPrompt.tsx:39` · PR #1791
- Сценарий: когда turn закончился, полная цитата заменяет обрезанную. Высота не перемеряется, и кнопка «Show all» не появляется.
- Исправление: перемерять после замены.

#### 188. «New Orchestrator Session» переносится и обрезается
- `medium` · `bug` · `src/renderer/canvas/nodes/OrchestratorNode.tsx:146` · PR #1799
- Сценарий: надпись переносится на 2–3 строки и обрезается в header Node.
- Исправление: короче надпись или одна строка с многоточием и tooltip.

#### 189. Список Queued сам открывается и забирает focus
- `medium` · `bug` · `src/renderer/session/composer/Queue.tsx:29` · PR #1833
- Сценарий: очередь опустела, пока список Queued был открыт. Когда в очереди снова появляется сообщение, список сам открывается и забирает focus у поля ввода.
- Исправление: сбрасывать `open`, когда очередь пуста.

#### 190. Hover card остаётся под первой цитатой
- `medium` · `bug` · `src/renderer/session/QuoteCommentParts.tsx:461` · PR #1833
- Сценарий: пользователь наводит мышь на вторую цитату, а hover card остаётся под первой. Anchor — один и тот же объект, и позиция не обновляется.
- Исправление: менять anchor при смене цитаты.

#### 191. Esc и прерывает turn, и закрывает карточку
- `medium` · `docs-mismatch` · `docs/features/sessions.md:184` · PR #1833
- Сценарий: в поле ввода занятой Session Esc прерывает turn. Тот же Esc ещё и закрывает открытую карточку, хотя страница описывает одно действие.
- Исправление: проверять `defaultPrevented`.

#### 192. Docs говорят про markdown, а Canvas рисует `<pre>`
- `medium` · `docs-mismatch` · `docs/features/projects.md:563` · PR #1788
- Сценарий: страница говорит, что Canvas рисует ответы через markdown. На деле там простой `<pre>`.
- Исправление: рисовать markdown или поправить страницу.

#### 193. Связка отправленных rounds не проверена
- `medium` · `test-gap` · `src/renderer/session/SessionView.tsx:249` · PR #1791
- Сценарий: передача отправленных rounds в вид Session не закреплена test-ом.
- Исправление: test вида Session с отправленным round.

## CI и тесты

Область: CI workflows, вспомогательные функции tests, проверка личных данных `check-personal`.

#### 194. Quarantine e2e quiet-windows сняли без исправления
- `medium` · `bug` · `test/e2e/quiet-windows.spec.ts:95` · PR #1606
- Сценарий: quarantine (временное отключение нестабильного test-а) сняли без исправления, и зависание вернулось. Его уже отслеживает ticket polish 112 (зависание этого e2e test-а), quarantine стоит до 2026-11-26. С 2026-11-27 `quarantine.test.ts` станет красным. Новый ticket не нужен.
- Исправление: закончить polish 112 до 2026-11-26.

#### 195. check-personal печатает имена папок без маски
- `medium` · `bug` · `scripts/check-personal.mjs:297` · PR #1685
- Сценарий: строка «by top folder» печатает имена папок без маски в публичный log CI. Если в имени папки есть личные данные, они видны всем.
- Исправление: маскировать имена папок в этой строке.

#### 196. Кириллические deny-записи ловят только именительный падеж
- `medium` · `bug` · `scripts/check-personal.hashes.json:12` · PR #1721
- Сценарий: записи deny list на кириллице совпадают только с формой в именительном падеже. То же слово в другом падеже проходит проверку.
- Исправление: добавить падежные формы или сравнивать по основе слова.

#### 197. Fake timers и waitFor по умолчанию маскируют ошибку
- `medium` · `test-gap` · `test/scaled-waits.ts:42` · PR #1633
- Сценарий: под fake timers `waitFor` с timeout по умолчанию 3 s сдвигает часы на 3 s. Mutant с удвоенным периодом выживает.
- Исправление: задавать в таких tests короткий явный timeout.

#### 198. download-electron: env и cacheRoot не проверены
- `medium` · `test-gap` · `scripts/download-electron.mjs:49` · PR #1668
- Сценарий: передача env в `install.js` и папка `cacheRoot` не закреплены test-ом.
- Исправление: contract test на запуск `install.js`.

#### 199. TEMP на D: убрал проверку коротких имён 8.3
- `medium` · `test-gap` · `.github/workflows/windows-tests.yml:287` · PR #1703
- Сценарий: на Windows runner TEMP перенесли на диск D:. Путь TEMP больше не содержит коротких имён 8.3 (вида `RUNNER~1`), и код для таких путей в CI не проверяется.
- Исправление: отдельный test с коротким путём 8.3.

#### 200. Проверка drop в read-only проходит всегда
- `medium` · `test-gap` · `test/unit/chat-attachments.test.tsx:325` · PR #1760
- Сценарий: test, что drop файла в read-only chat отклоняется, ничего не проверяет и проходит при любом коде.
- Исправление: проверять, что файл не добавлен.

#### 201. timeout и sudo у apt не проверены
- `medium` · `test-gap` · `test/contract/ci-install-zsh.test.ts:137` · PR #1798
- Сценарий: timeout и `sudo` в вызове apt не закреплены test-ом.
- Исправление: проверять аргументы вызова apt.

#### 202. Ветка Homebrew ни разу не выполнялась в CI
- `medium` · `test-gap` · `scripts/ci-install-zsh.sh:113` · PR #1801
- Сценарий: ветка установки zsh через Homebrew ни разу не выполнялась в CI. Evidence PR прочитан неверно: там работала другая ветка.
- Исправление: CI job, который проходит именно через ветку Homebrew.

## Workflow и Pipeline

Область: чтение Ticket-ов и branch (workflow reader), вид Pipeline со Stage-ами, проверка release.

#### 203. Неудачный `git worktree list` делает claimed Ticket готовым
- `medium` · `bug` · `src/main/workflow/reader.ts:440` · PR #1613
- Сценарий: `git worktree list` упал, и cache пуст. Claimed Ticket читается как open и Ready, без notice и без retry. Autopilot может снова отправить его в Run wave.
- Исправление: считать это ошибкой, держать последнее хорошее значение и повторять.

#### 204. Возобновлённый run теряет прерванный Ticket
- `medium` · `bug` · `src/shared/actions/render-template.ts:98` · PR #1613
- Сценарий: при возобновлении run чтение branch прерванного Ticket-а упало. Ticket (`unreadBranch`) не попадает ни в resumed, ни в ready и остаётся claimed без implementer.
- Исправление: брать такие Ticket из `run.resume`.

#### 205. Проверка конца Wave не видит unreadBranch
- `medium` · `bug` · `src/shared/autopilot/cycle.ts:269` · PR #1613
- Сценарий: одно неудачное чтение branch, и проверка settle (закончены ли все Ticket-ы Wave) завершает Wave досрочно.
- Исправление: считать `unreadBranch` «в работе».

#### 206. Время на Stage прыгает назад у Ticket на нескольких repository
- `medium` · `bug` · `src/shared/workflow/pipeline.ts:311` · PR #1752
- Сценарий: Ticket идёт в нескольких repository. Время входа в Stage берётся только у отстающих repository. `enteredAt` прыгает назад, и появляется неверная пометка «stuck».
- Исправление: брать последний факт прохождения предыдущего Stage по всем repository.

#### 207. npm 11 отвечает E404 с exit code 1
- `medium` · `bug` · `src/main/workflow/release.ts:177` · PR #1758
- Сценарий: для ещё не опубликованной версии npm 11 отвечает E404 с exit code 1. Pipeline показывает «not checked». Причина каждый раз новая (в ней путь log-файла), и событие `pipeline.changed` уходит каждые 5 минут.
- Исправление: считать E404 ожиданием публикации; stub под поведение npm 11.

#### 208. Tag с «@» отклоняется навсегда
- `medium` · `bug` · `src/main/workflow/release.ts:57` · PR #1758
- Сценарий: tag в формате changesets (с «@») навсегда отклоняется, хотя `ticket release` его принимает.
- Исправление: принимать то, что пропускает `git check-ref-format`.

#### 209. Цепочка из трёх repository скрывает красный CI
- `medium` · `bug` · `src/shared/workflow/pipeline.ts:303` · PR #1758
- Сценарий: Ticket идёт через три repository. Первая библиотека ждёт release repository, который зависит от неё, и её красный CI не виден.
- Исправление: ждать release должны только repository после строки Release в порядке строки `Repo:`.

#### 210. Потолок back-off не проверен
- `medium` · `test-gap` · `src/main/workflow/reader.ts:568` · PR #1613
- Сценарий: потолок back-off (5 минут после 4-й неудачи) не закреплён test-ом. Замена `Math.min` на `Math.max` в `src/main/workflow/watch.ts:464` тоже выживает.
- Исправление: tests с fake timers на 5+ неудач и две branch.

## Flight Recorder и Work track

Область: Flight Recorder (запись хода работы Session и run), вид Work track (дорожки Session по времени), скрипт `critical-path`.

#### 211. byWorktree отдаёт папку более позднему Epic
- `medium` · `bug` · `src/shared/flight-recorder/spans.ts:598` (то же в `src/main/flight-recorder/transcripts.ts:365`) · PR #1544
- Сценарий: два Epic-а в разное время работали в одной папке `.claude/worktrees/NN`. Сопоставление по папке отдаёт её более позднему Epic, и gate run первого Epic молча выпадает.
- Исправление: учитывать время или Epic при сопоставлении.

#### 212. Marks в строках CI и статусов не раздвигаются
- `medium` · `bug` · `src/renderer/work-track/Lanes.tsx:287` · PR #1556
- Сценарий: 17 одновременных смен статуса видны как одна точка. Красный CI run, закрытый другими marks, не виден.
- Исправление: группировать marks со счётчиком.

#### 213. critical-path считает CI→Gate равным 0 s
- `medium` · `bug` · `scripts/critical-path.mjs:374` · PR #1734
- Сценарий: у PR нет CI runs, и StatusContext `review` считается и концом CI, и Gate. Интервал CI→Gate выходит 0 s.
- Исправление: фильтр `isCheckRun` в `ciMark`.

#### 214. E2e test кликает по закрытой mark
- `medium` · `bug` · `test/e2e/work-track.spec.ts:391` · PR #1556
- Сценарий: test кликает по первой CI mark вчерашнего дня. Примерно в 2,6% дат её закрывает другая mark, и test красный весь такой день.
- Исправление: выбирать mark, которую ничто не закрывает.

#### 215. Docs обещают заштрихованную lane, которой нет
- `medium` · `docs-mismatch` · `docs/features/work-track.md:125` · PR #1553
- Сценарий: страница обещает заштрихованную lane для Session с удалённым transcript. Reader Claude Code такую lane не создаёт.
- Исправление: показывать пропуск для Session Wave или поправить страницу.

#### 216. Run по очереди Epic-ов отображается неверно
- `medium` · `docs-mismatch` · `docs/features/work-track.md:195` · PR #1553
- Сценарий: run идёт по очереди Epic-ов. Каждая Wave получает первый Epic очереди, marker рисуется дважды, и run перестаёт считаться live (`service.ts:194` берёт `journal.epic`). Страница описывает другое поведение.
- Исправление: давать Wave её собственный Epic и учитывать все Epic очереди.

#### 217. Цвета green, grey и orange не проверены
- `medium` · `test-gap` · `test/unit/work-track-view.test.tsx:253` · PR #1556
- Сценарий: цвета marks для успешного, остановленного и заблокированного run не закреплены test-ом.
- Исправление: fixtures ok, stopped и blocked.

## Link

Область: Link — связь двух машин и её настройки.

#### 218. Settings более новой версии выключают Tailscale
- `medium` · `bug` · `src/main/link/settings.ts:117` · PR #1595
- Сценарий: пользователь откатился на старую сборку, а файл link settings записан более новой. Старая сборка выключает Tailscale и не даёт включить его, пока стоит откат.
- Исправление: в режиме newer брать значение `tailscale` из файла.

#### 219. Test с подменённым peer ходит на настоящий localhost
- `medium` · `bug` · `test/contract/link-reconnect.test.ts:540` · PR #1784
- Сценарий: test подменяет peer, но всё ещё обращается к настоящему localhost. Возможна race с `::1`, и test иногда падает (flaky test).
- Исправление: stub для `resolveOnLoopback`.

#### 220. Граница `.gt(2)` не проверена
- `medium` · `test-gap` · `src/main/link/settings.ts:51` · PR #1595
- Сценарий: граница версии схемы `.gt(2)` (с какой версии файл считается более новым) не закреплена test-ом.
- Исправление: tests на версии 2 и 3.

## Отклонённые finding-и

Скептик отклонил 28 finding-ов.
