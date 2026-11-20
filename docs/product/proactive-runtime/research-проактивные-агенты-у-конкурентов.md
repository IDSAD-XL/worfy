# Проактивные агенты у конкурентов: trigger-ы, одобрение и шум

Дата: 2026-11-20.

Research-заметка темы Product Session `proactive-runtime`. Тема — агент worfy над всеми Project-ами (подключёнными к
worfy репозиториями). Он следит за событиями: review в PR, CI, застрявшие Session-ы (разговоры с агентом Claude Code
или Codex), позже Slack, Jira, Gmail, Calendar. Он дёшево сортирует события (triage) и предлагает или готовит
следующий шаг на одобрение владельца. Контекст темы — `map.md` в этой папке.

## Что здесь и как читать

- **Вопрос.** Как продукты 2025–2026 годов делают агента проактивным. Что запускает работу (trigger). Что агент
  делает сам, а что только предлагает. Кто и как одобряет. Какой у агента охват. Что он помнит между задачами. Сколько
  это стоит и что признают сами вендоры. Отдельно — исследования и цифры вендоров: сколько проактивных подсказок
  принимают, сколько false positive люди терпят, сколько стоит прерывание.
- **Источники.** Документация, changelog-и и блоги вендоров; статьи arXiv, CHI, IUI, UIST, ICLR, ICSE. Всё прочитано
  2026-11-20. Метка в квадратных скобках, например [gh-levels], — ссылка на первоисточник; адреса собраны в конце
  файла.
- **Шум** здесь — предложения, комментарии и уведомления, которыми человек не воспользовался.
- **Что не повторяется.** Досье конкурентов от 2026-11-13 уже описывают automations Copilot, Cursor, Devin, Codex,
  Factory и Antigravity. Здесь на них ссылки вида `devin:264` — короткое имя файла и номер строки. Эти утверждения в
  этот раз заново не проверялись. Короткие имена:

| Короткое имя | Файл |
| --- | --- |
| `README` | [docs/research/2026-11-13-competitors/README.md][f-readme] |
| `copilot-cloud` | [docs/research/2026-11-13-competitors/github-copilot-cloud-agent-and-agent-hq-mission-.md][f-gcc] |
| `cursor` | [docs/research/2026-11-13-competitors/cursor-agents-window-cloud-agents-and-automation.md][f-cursor] |
| `devin` | [docs/research/2026-11-13-competitors/devin.md][f-devin] |
| `codex-app` | [docs/research/2026-11-13-competitors/codex-app-codex-in-the-chatgpt-desktop-app.md][f-codex] |
| `factory` | [docs/research/2026-11-13-competitors/factory-droids.md][f-factory] |
| `antigravity` | [docs/research/2026-11-13-competitors/google-antigravity.md][f-ag] |
| `cc-cloud` | [docs/research/2026-11-13-competitors/claude-code-cloud-sessions-and-projects.md][f-cc] |
| `humanlayer` | [docs/research/2026-11-13-competitors/humanlayer.md][f-hl] |

## Главное

- Проактивность в продуктах 2025–2026 годов почти везде собрана из трёх частей: trigger (расписание или событие),
  ограниченный набор действий и одобрение по классу действия.
- Ближе всех к «агенту над всеми Project-ами» подошли три продукта. OpenAI dots (2026-09-29) — постоянный агент с целью
  над всеми подключёнными инструментами пользователя [oa-rn]. Координатор Cursor подписан на Slack, PR, CI и расписание
  (`cursor:165`). Copilot Projects ведёт несколько repo под одной целью (`copilot-cloud:390–395`). Данных о том, какую
  долю их предложений принимают, ни один вендор не публиковал.
- Отдельную проактивную ленту OpenAI закрыла: ChatGPT Pulse вышел 2025-09-25 и закрыт 2026-06-17 в пользу Scheduled
  tasks [oa-rn]. Jules с его Suggested Tasks закрывается 2026-12-31 [jules-cl].
- Главная измеренная проблема — шум. У готовых LLM 52–65% предложений помощи приходятся на моменты, когда помощь не
  нужна [lu-iclr25]. Комментарии AI-review меняют код заметно реже, чем комментарии людей [sun-ai-cr], [lin-cr].
  Вендоры мерят и выбирают молчание: Copilot не пишет ничего в 29% review [gh-60m], OpenAI ставит precision выше
  recall [openai-align].
- Решает момент. Подсказку на границе работы (после commit) берут в работу в 52% случаев. Подсказку посреди задачи
  отклоняют в 62% случаев [kuo-iui26].
- Двухступенчатую сортировку — дешёвый первый проход, дорогой разбор только отмеченного — используют Devin (preflight
  check перед платной работой, `devin:273`) и Claude Code (классификатор разрешений auto mode, `cc-cloud:386–389`).
  Но Linear отказался от маленьких моделей в самой сортировке: им не хватало контекста [lin-ti-built].

## Сравнение

| Продукт | Trigger-ы | Делает сам / предлагает | Одобрение | Охват | Память между задачами | Источник |
| --- | --- | --- | --- | --- | --- | --- |
| **GitHub Copilot**: cloud agent (бывший coding agent), automations, Agent HQ (mission control с 2026-01-26 — вкладка Agents, `copilot-cloud:1883`), Projects | Работа из issue, вкладки Agents, API, `gh agent-task create`, Slack, Teams, Linear, Jira (`copilot-cloud:912`). Automations: расписание или cron, события и комментарии repo, REST API, успех или провал другой automation; 2026-10-28 добавлены 24 trigger-а событий (`copilot-cloud:303–310`) | Cloud agent сам открывает и ведёт PR; Agent Merge держит PR готовым, а сливает GitHub через auto-merge (`copilot-cloud:328–331`). Правку issue (метки, поля, тип, assignee, закрытие) automation применяет сама или оставляет предложением с уверенностью high, medium или low и с причиной; причина пишется и для применённых правок [gh-levels]. Предложения automation улучшить свой prompt — только с одобрением человека (`copilot-cloud:315`) | Уровень на repo: Full control — всё предложениями; Cautious (по умолчанию) — сама применяет только high; Balanced — рутинные правки; Full automation — всё, кроме помеченного неуверенным. Accept или Decline по одному или все сразу. «Approvals are a workflow convenience, not a security control» [gh-levels] | Repository. Projects (preview с 2026-10-28): несколько repo под одной целью, обзор Needs input / Open / Working / Done, automations проекта по cron (`copilot-cloud:390–395`) | Copilot Memory: факты repo и личные факты. Copilot Dreaming в фоне чистит записи и открывает PR с правками AGENTS.md и skills (`copilot-cloud:298`, `copilot-cloud:679`) | [gh-levels], `copilot-cloud` |
| **Google Jules** (закрывается: Session-ы до 2026-11-11, потом только чтение, закрытие 2026-12-31) | Suggested Tasks: периодический скан repo; включается тумблером Proactivity на каждый repo. Сначала только комментарии `#TODO`, с 2026-01-26 ещё и места для оптимизации производительности. Scheduled Tasks: daily, weekly, monthly. Упавший deploy Render у PR от Jules; упавший CI у PR от Jules (с 2026-02-19) | Suggested Tasks: сам ищет и пишет план с причиной, но работу не начинает. Scheduled Tasks: сам выполняет и открывает PR. Render и CI: сам читает log, чинит и обновляет PR — только свои PR | Suggested Tasks: кнопка Start или Dismiss; письмо о новых находках приходит «периодически». Planning Critic — второй агент — проверяет планы, которые идут без одобрения человека | Repo. Suggested Tasks — до 5 repo на аккаунт «at launch», только подписки Google AI Pro и Ultra | «Agentic Memories» о предпочтениях и проекте (2025-11-19). Отказы (Dismiss) Jules учитывает в следующих предложениях | [jules-cl], [jules-sugg], [jules-blog] |
| **Google Antigravity Automations** (преемник Jules) | Hourly, Daily, Weekly, cron (`antigravity:176–178`). В SDK — фоновые trigger-ы: таймеры, слежение за файлами, webhooks (`antigravity:363`) | Запуск без открытого разговора. Всё, что требует одобрения, в запуске без человека запрещено (`antigravity:807`) | Права записываются заранее: пробный запуск пишет точный список, человек его проверяет (`antigravity:807`). Новая automation создаётся в состоянии Paused (`antigravity:178`) | Agent Manager держит агентов по нескольким рабочим папкам (`antigravity:575`) | Нет: каждый запуск начинается без памяти о прошлых (`antigravity:494`) | `antigravity` |
| **Cursor**: Cloud Agents (бывшие Background Agents), Automations, Subscriptions, Bugbot | Automations: cron; события GitHub, GitLab, Bitbucket (PR открыт, push, merge, комментарий, CI завершён, review); Slack; webhook; Linear, Sentry, PagerDuty (`cursor:254–264`). Агент подписывается на PR, CI, Slack, Linear, таймер и просыпается на событие (`cursor:229–233`). Координатор с плашкой Listening (`cursor:165`) | Automation сама открывает PR (включено по умолчанию), комментирует или approve-ит PR, зовёт reviewer-ов, пишет в Slack (`cursor:265`). Bugbot сам комментирует PR; Autofix — cloud agent в новой или той же ветке, не больше 3 прямых push на PR (`cursor:276–280`) | Через PR и правила repo. Managed agent PR Routing & Approval сам одобряет PR с низким риском по `APPROVAL_POLICY.md` (`cursor:286`) | Ни одного, один или несколько repo на automation (`cursor:267`) | `MEMORIES.md` между запусками, вне рабочего дерева (`cursor:266`). Learned rules Bugbot из реакций, ответов и комментариев reviewer-ов (подробности ниже) [cursor-learn] | `cursor`, [cursor-learn] |
| **Devin**: automations, Auto-triage, Oncall | Slack (сообщение, упоминание группы, реакция), Teams, GitHub, GitLab, Linear, Jira, Pylon, PagerDuty, расписание iCalendar, webhook; trigger-ы объединяются через OR (`devin:266–272`) | Действия: начать сессию, написать в идущую, triage (постоянная сессия-наблюдатель «Triage Devin»), отправить email (`devin:274`). Перед платной работой — preflight check: LLM-фильтр или скрипт с состоянием между запусками (`devin:273`). Oncall склеивает повторяющиеся события в одну issue (`devin:283–287`). Сам ставит себе напоминание и просыпается позже (`devin:148`) | Confidence ratings: ниже «зелёного» — уточняющие вопросы и ожидание одобрения (`devin:861`). Код — через review PR | Организация; события из чатов, трекеров, GitHub и GitLab | Сессии по расписанию ведут свои заметки, каждый запуск продолжает прошлый (`devin:279`). Общую память организации automations не читают и не пишут (`devin:478`) | `devin` |
| **OpenAI Codex**: cloud tasks, Scheduled tasks, автоматический code review | Scheduled tasks в Codex app: интервалы или строка повторения iCalendar; Heartbeat — задача внутри одного чата. Trigger-ы по событиям (Gmail, Slack, PR на GitHub) — только в web и mobile (`codex-app:229–247`). Code review — сам, когда PR переходит из draft в ready [openai-upgrades]. Linear — правила triage (`codex-app:335`) | Результаты задач копятся в виде Scheduled; запуск с находкой (Finding) помечен непрочитанным (`codex-app:240`). Code review пишет в PR только находки высшей и второй важности, P0 и P1 (`codex-app:331`) | В задаче без присмотра — `approval_policy = "never"`: действие вне sandbox просто падает, человека не спрашивают (`codex-app:248`). Код — через PR | Standalone-задача может идти по нескольким проектам (`codex-app:235`). Team Tasks — от сервисного аккаунта команды (`codex-app:403`) | Heartbeat возвращается в тот же чат с его контекстом; standalone начинает новый чат (`codex-app:235–236`) | `codex-app`, [openai-align] |
| **ChatGPT**: Pulse (2025-09 – 2026-06), Scheduled tasks, dots | Pulse: раз в день, по памяти, истории чатов и отзывам. Scheduled tasks (с 2026-06-17): время или окно, не чаще раза в час; с 2026-08-25 webhooks — новое письмо Gmail, сообщение в канале Slack, изменения PR на GitHub. Dots (с 2026-09-29): постоянный агент, сам решает, когда продолжить; расписание — по желанию | Pulse: карточки на день. Задачи-мониторы уведомляют, только когда есть что сообщить. Dot: проактивное исследование только на чтение; следующие действия — по правилам ниже | Pulse: оценка вверх или вниз и Curate. Задачи: «Actions that require approval pause until you review them». Dot: на каждое действие — сделать без вопроса, сделать по заранее данному одобрению, спрашивать каждый раз или отдать человеку. Auto-review проверяет запланированное действие; Custom Rules его не отключают | Все подключённые приложения пользователя. Dot — «across your tools and projects»; заводит задачи в ChatGPT Work и Codex | Pulse требовал включённых saved memory и chat history. Dot: memory ChatGPT и свои заметки о предпочтениях, решениях и текущей работе; отдельные записи посмотреть или удалить нельзя | [oa-rn], [dots-learn], [dots-help] |
| **Linear Triage Intelligence** | Issue попадает в Triage; вручную — Find Suggestions | Предлагает дубликаты, связанные issues, team, project, assignee, labels; причина видна при наведении | Для каждого типа свойства команда выбирает show, hide или auto-apply; правило можно сузить до значений, например auto-apply только метки `bug`. Auto-apply — с 2025-09-18, до этого только предложения | Workspace; команда может брать предложения только из своей команды | Отдельной памяти нет; текст Additional Guidance на уровне workspace, команды, подкоманды | [lin-ti], [lin-ti-auto], [lin-ti-built] |
| **Linear Agent и Loops** (Loops с 2026-07-20) | Расписание (от hourly до yearly); события issues, projects, initiatives, cycles, releases и PR; triage loops; новое сообщение верхнего уровня в выбранных публичных каналах Slack; webhook; до 8 условий. Slack и GitHub — с 2026-10-22 [lin-loops-cl] | Действует сам: комментирует, правит документы, заводит issues, запускает coding-сессии, пишет в Slack. Шага «предложить» в описании нет | Одобрение — только для вызовов MCP tools (инструментов внешних серверов), его можно выключить переключателем «Automatically approve all tool calls». Для встроенных действий Linear одобрение не описано. Run history по каждому запуску | Team loops (до 100 на команду) и workspace loops (до 500). Запись — только в доступных loop командах; можно запретить менять что-либо, кроме объекта, который вызвал запуск | Блог: запуск может опираться на «previous runs»; документация об этом молчит | [lin-loops-blog], [lin-loops-docs], [lin-agent] |
| **LangChain**: ambient agents, Agent Inbox, LangSmith Fleet (бывший Agent Builder) | Поток событий вместо сообщения человека; в эталонном примере — входящая почта. Fleet: каналы Slack, Gmail, Microsoft Teams и расписание | Три способа позвать человека: notify — сообщить и ничего не делать; question — спросить, чтобы продолжить; review — показать действие до выполнения | Agent Inbox — отдельный UI, «some combination of an email inbox and a customer support ticketing system»; на запуске — один пользователь и сортировка по времени. Fleet: у каждого tool режим Auto или Ask; для агента из Slack — кнопки Approve и Deny в треде | Агент работает с подключениями своего пользователя | LangGraph long-term memory обновляется после ответов человека. Fleet пишет файлы в папку memories; запись по умолчанию требует одобрения | [lc-ambient], [lc-fleet] |
| **Sentry Seer** (Autofix) | Issue с 10 и больше событиями за последние 14 дней и «достаточной» оценкой fixability (модель Sentry оценивает, насколько просто исправить), если в проекте включена automation. Старые issues — только вручную | Сам идёт до точки остановки проекта: root cause → план → черновик PR. Может передать root cause и план в Claude Code, Cursor Cloud Agent или Copilot Cloud Agent | Точка остановки проекта ограничивает глубину при любой уверенности. План можно поправить до кнопки Code It Up. Merge — человек. Число итераций по CI ограничено | Проект Sentry связан с одним или несколькими repo; только GitHub.com и GitLab.com | Памяти между issues документация не описывает. Читает файлы правил Cursor, Windsurf, Cline и Claude Code | [seer-docs], [seer-blog-aug] |
| **Factory Droids**: Automations, Triage | Cron или расписание словами, сообщение в Slack, событие GitHub (через GitHub Actions), webhook (`factory:394`). Triage (Private Preview): приём из Linear, Slack, GitHub, поиск дублей, маршрутизация (`factory:434`) | Готовые шаблоны: Ticket to PR каждые 15 минут, PR Reviewer, Daily Status Digest, Error Triage, CI Failure Triage, Review Comment Fixer и другие (`factory:396`) | Automation работает от имени пользователя или service account (`factory:399`). Исправление CVE доходит до merge после одобрения пользователя (`factory:430`) | Automation привязана к workstream и машине; до 10 automations на управляемую машину (`factory:414–417`) | У automation по расписанию своя папка `memory/`, `reports/`, `skills/` и файл `HEARTBEAT.md` (`factory:404–407`) | `factory` |

## По продуктам: цена, ограничения, подробности

Только то, чего нет в таблице.

### GitHub Copilot

- **Цена.** Cloud agent и automations оплачиваются credits. Лимит automation на один запуск останавливает запуск (не
  меньше 30 credits). Дневной, недельный и месячный лимиты только блокируют новые запуски (`copilot-cloud:312–314`).
  Общие automations оплачивает владелец repo (`copilot-cloud:311`).
- **Шум в code review** [gh-60m], 2026-03-05. 60 млн review с запуска. В 71% review есть замечания, по которым можно
  действовать; в остальных 29% Copilot не пишет ничего. В среднем 5,1 комментария на review. Больше 12 000 организаций
  запускают review на каждом PR. Позиция GitHub: «Silence is better than noise». Агентная архитектура review дала
  +8,1% положительных отзывов; более сильная reasoning-модель — ещё +6% при задержке review на 16% больше.
- **Метрика с 2026-11-17** [gh-insights]. Repository insights показывает «Comments addressed» и «Addressed rate» —
  долю оценимых комментариев, по которым что-то сделали, с числителем, знаменателем и исключёнными. Ещё — PR без
  последующего запроса изменений от человека. Что считается «acted on», changelog не определяет.
- **Ограничения.** Уровни автономии касаются только правок issues от automations, а не открытия PR и не push
  [gh-levels]. Automations работают только в private и internal repo (`copilot-cloud:1423`). Недоверенные события по
  умолчанию пропускаются (`copilot-cloud:316`).

### Google Jules

- **Состояние.** 2026-10-29 Google объявила: Jules «will wind down on December 31, 2026». Session-ы можно было
  продолжать до 2026-11-11, дальше — только чтение. По словам Google, опыт Jules переходит в другие продукты, включая
  Antigravity. Настройки, память, задачи по расписанию и Session-ы можно выгрузить в локальную папку [jules-cl]. Уже
  отмечено в `docs/product/roadmap-worfy/research-рынок-приложений-для-параллельных-агентов.md:20`.
- **Цена.** Бесплатно — 15 задач за скользящие 24 часа и 3 одновременно; Pro — 100 и 15; Ultra — 300 и 60
  [jules-limits]. Suggested Tasks — только Google AI Pro и Ultra [jules-blog].
- **Как менялись проактивные функции** [jules-cl]. 2025-12-10 — Suggested Tasks (только `#TODO`), Scheduled Tasks и
  исправление упавших deploy Render. 2026-01-26 — подсказки по производительности, правка, пауза и продолжение задач по
  расписанию; до этого задачу можно было только удалить и создать заново [jules-sched]. Тогда же — Planning Critic.
  2026-02-19 — исправление упавшего CI в своих PR.
- **Цифра вендора.** Planning Critic проверяет планы, которые идут без одобрения человека. По данным Google, провалов
  задач стало на 9,5% меньше [jules-cl]; относительное это снижение или в процентных пунктах, не сказано.
- **Пример вендора без цифр.** Команда Stitch держала «pod» ежедневных задач по ролям: производительность,
  безопасность, доступность, покрытие тестами. По словам Google, Jules стал одним из крупнейших авторов в её repo
  [jules-blog].

### Cursor

- Automations, подписки и цифры Bugbot уже собраны: `cursor:229–233`, `cursor:254–284`.
- **Как Bugbot учится на отказах** [cursor-learn], 2026-04-08. Сигналы — реакции на комментарий (минус значит, что
  находка бесполезна), ответы разработчиков и комментарии reviewer-ов о пропущенном. Из сигналов получаются
  правила-кандидаты. Кандидат становится активным правилом, когда сигнала накопилось достаточно. Активное правило
  выключается, если стабильно получает отрицательный сигнал. Правила можно править и удалять в UI. Learning включён
  больше чем в 110 000 repo, правил больше 44 000.
- **Цифры Cursor о точности** [cursor-learn]. Resolution rate — доля найденных Bugbot ошибок, которые автор исправил к
  merge; проверяет LLM-судья. На запуске (2025-07) — 52%, и Cursor прямо называет остальное false positive. Сейчас —
  78,13% на 50 310 PR публичных repo. В той же таблице: Greptile 63,49%, CodeRabbit 48,96%, GitHub Copilot 46,69%,
  Codex 45,07%, Gemini Code Assist 30,93%. Это замер самого Cursor.
- **Цена.** Automation тратит как cloud agent, по максимальному окну контекста модели (`cursor:270`). Bugbot — оплата
  по использованию с мая 2026 (`cursor:282`).
- **Ограничения.** Событие «ничего не произошло» не может быть trigger-ом — ответ сотрудника на форуме (`cursor:264`).
  PR из fork-ов не поддерживаются (`cursor:264`). Если вход в MCP не удался, запуск идёт без tools этого сервера
  (`cursor:271`). Подписка живёт не дольше 180 дней; у агентов от имени service account подписок нет (`cursor:231`).

### Devin

- Основное — в досье: automations (`devin:264–292`), память (`devin:474–480`), confidence ratings (`devin:861`).
- **Цена.** Работа меряется в ACU — единицах работы Devin, за которые платят. Automations и review платятся из общих
  кредитов; когда кредиты кончились, automations встают (`devin:624`).
- **Ограничения.** По умолчанию 50 запусков automation в час (150 для Slack triage); запуски сверх очереди
  отбрасываются (`devin:275`). У preflight check нет автоматического повтора; тело webhook больше 200 KB обрезается
  (`devin:1462`). Ввод из Slack документация называет недоверенным (`devin:291`).
- **Сдвиг.** В мае 2026 Cognition сообщила: сессий, запущенных событиями, automations, расписаниями и другими Devin,
  впервые стало больше, чем запущенных человеком (`devin:53`).

### OpenAI Codex

- Scheduled tasks, trigger-ы и права задач без присмотра — в досье (`codex-app:229–250`); code review и Linear —
  `codex-app:331–336`.
- **Цифры code review** [openai-align], 2025-12-01. Автор отвечает изменением кода на 52,7% комментариев. Больше 80%
  реакций на комментарии положительные; размер выборки не назван. На PR, целиком написанных Codex cloud, reviewer
  комментирует 36% PR; изменение кода вызывают 46% этих комментариев против 53% на PR людей. В октябре 2025 — больше
  100 000 внешних PR в день. Выбор команды: «We optimize for signal-to-noise first»; ради доверия разработчиков
  приняли немного меньший recall.
- **Ограничения** (досье). Событие и расписание в одной задаче совместить нельзя; в desktop-приложении trigger-ов по
  событиям нет (`codex-app:246–247`). Документация говорит, что агент может сам завести задачу «присматривать за PR»,
  а пользователь сообщает, что встроенные инструкции модели это запрещают (`codex-app:242–245`).

### ChatGPT: Pulse, Scheduled tasks, dots

Это единственная линия продуктов в выборке, где проактивность над всем, что подключил пользователь, прошла полный
цикл: лента, её закрытие, задачи, постоянный агент. Даты — из release notes ChatGPT [oa-rn].

| Дата | Что вышло |
| --- | --- |
| 2025-09-25 | Pulse, preview для Pro на iOS и Android: раз в день сам присылает персональные обновления. Исходные данные — память, история чатов и прямые отзывы (оценка вверх или вниз, Curate). Нужны включённые saved memory и chat history. По пересказу прессы — по желанию ещё Gmail и Google Calendar [digit-pulse]. |
| 2025-10-29 | Pulse в web: результат исследования приходит на следующий день серией визуальных сводок. |
| 2025-12-17 | Tasks (prompt-ы по расписанию) внутри Pulse; Pulse — только Pro. |
| 2026-06-17 | «Pulse is being sunset as proactive updates move into scheduled tasks»; у Pro — ещё 14 дней. Scheduled tasks: запуск в заданное время или окно, не чаще раза в час; «unattended tasks may automatically pause after a period of inactivity». Задачи-мониторы проверяют web и подключённые приложения и уведомляют, только когда есть что сообщить. |
| 2026-08-25 | Задачи по webhook для Plus и Pro: новое письмо Gmail, сообщение в канале Slack, изменения PR на GitHub. «Actions that require approval pause until you review them». Free — до трёх активных задач, не чаще раза в день. |
| 2026-09-29 | Dots: «always-on agents in ChatGPT that can take on ongoing work». Pro и Business Premium, постепенно. |
| 2026-10-28 | Dot сам пишет SMS с проактивными обновлениями (beta, США). |
| 2026-11-19 | Проактивные предложения dot, например перенести тренировку, если мешает встреча. |

- **Почему закрыли Pulse.** Release note причину не называет. Пост OpenAI в X, в пересказе digit.in, предлагает
  получать ту же ежедневную сводку задачей «based on your interests, past chats, and connected apps» [digit-pulse].
- **Как устроен dot** [dots-learn], [dots-help].
  - «Always-on agent that keeps work moving across your tools and projects». Свой облачный компьютер и browser; dot
    работает, когда компьютер пользователя выключен. Может завести задачи в ChatGPT Work и Codex и продолжить
    локальную задачу Codex на подключённом компьютере.
  - Сам решает, когда остановиться и продолжить. Расписание с часовым поясом и датой окончания — по желанию.
  - Пользователь говорит, куда слать какие сообщения, например «routine progress in ChatGPT and decisions in Slack».
  - В Slack «Adding it to a channel alone doesn't start monitoring»: каналы и события надо назвать явно.
  - Проактивное исследование — только чтение: dot не пишет людям, не меняет данные через plugins, не управляет
    browser-ом и компьютером. Действия после исследования идут по обычным правилам.
  - Правила на действие. Без вопроса — часть действий по умолчанию. По заранее данному одобрению — например,
    повторяющееся сообщение. Спрашивать каждый раз — удаление данных, установка программ. Отдать человеку — смена
    пароля, перевод денег. Auto-review проверяет запланированное действие против инструкций, Custom Rules и требований
    безопасности, например адресата и текст письма. Custom Rules не отключают Auto-review и ограничения проактивного
    исследования.
  - Память: memory ChatGPT плюс свои заметки dot о предпочтениях, решениях и текущей работе. Отдельные записи памяти
    dot посмотреть, удалить или поправить нельзя.
- **Цена.** Для Pro и Business Premium разговоры с dot не тратят лимиты ChatGPT. Задачи, которые dot заводит в Work
  или Codex, тратят лимиты этих продуктов. В план входит запас на «deeper work», в первый месяц после запуска —
  увеличенный [dots-learn]. Окончательные условия release note 2026-09-29 обещал сообщить позже [oa-rn].
- **Ограничения.** «Dots can still make mistakes, so always review consequential work» [dots-help]. Цифр
  использования или принятия предложений OpenAI не публиковала.

### Linear

- **Triage Intelligence** [lin-ti], [lin-ti-built], [lin-ti-auto].
  - Первая версия (пост 2025-09-03) работала на небольших моделях GPT-4o mini и Gemini 2.0 Flash. Они «could only
    work with the information we provided up front». Linear перешёл на GPT-5 и Gemini 2.5 Pro, которые сами добирают
    контекст из данных Linear.
  - Порядок выпуска: 2025-08-14 — technology preview только с предложениями, их можно принять или отклонить
    [lin-ti-preview]. Слова Linear: «Automation will come gradually and with control» и «If you trust certain types of
    suggestions, you'll be able to opt in». Auto-apply вышел 2025-09-18 — по свойствам и по значениям. Применённое автоматически помечено в заголовке предложений, причину видно при наведении.
  - UI отделяет то, что предложила система, от того, что поставили люди.
  - Предложения по новой issue готовы через 1–4 минуты. На время работы UI показывает состояние «thinking» с
    таймером.
  - Цена: только Business и Enterprise. На остальных планах — «quick suggestions» по поиску, «much less thorough».
    Точности или доли принятых предложений Linear не публиковал.
- **Loops** [lin-loops-blog], [lin-loops-docs], [lin-credits].
  - Цена: Loops тратят AI credits; обычный запуск без coding-сессии стоит $0,07–0,20. Coding-сессия — это token-ы
    модели и время sandbox. Credits включаются по желанию (opt-in); купленные живут 12 месяцев; без credits новые
    запуски не начинаются [lin-credits].
  - Подавление повторов. Loop по условию срабатывает, когда объект начал соответствовать условию, и «Further updates do
    not trigger another run while the same conditions remain matched». Повтор webhook с тем же `Webhook-Id` не создаёт
    второй запуск. Ответ `202 Accepted` значит «получено», а не «выполнено» [lin-loops-docs].
  - Ограничения. Slack — только новые сообщения верхнего уровня в выбранных публичных каналах; личные сообщения,
    ответы в треде и правки не поддерживаются. Кнопки Run now нет для trigger-ов cycle и PR [lin-loops-docs].
- **Agent Interaction Guidelines** [lin-aig] — правила Linear для агентов на своей платформе. Агента нельзя спутать с
  человеком. Он сразу, но ненавязчиво показывает, что получил запрос. Он показывает состояние: думает, ждёт ввода,
  выполняет, закончил. По просьбе он «step back, immediately» и не возвращается без явного сигнала. «Final
  responsibility should always remain with a human». О действиях без вызова и об уведомлениях документ ничего не
  говорит.

### LangChain: ambient agents и Agent Inbox

- **Определение** [lc-ambient], 2025-01-14. «Ambient agents listen to an event stream and act on it accordingly». Их
  запускает не только сообщение человека; несколько агентов могут работать одновременно. При этом «we do not think that
  ambient agents are necessarily completely autonomous».
- **Зачем человек.** По LangChain — ради доверия и ради обучения. Без человека агент в фоне не должен ошибаться вообще;
  ответы человека обновляют long-term memory LangGraph.
- **Что стало с Agent Inbox.** Репозитории `langchain-ai/agent-inbox` и `langchain-ai/executive-ai-assistant`
  (эталонный email-ассистент) на 2026-11-20 в архиве. Последний push — 2026-09-18 и 2026-07-27 (GitHub API,
  `archived: true`). README причину не называет [lc-inbox-repo]. Одобрение теперь живёт в LangSmith Fleet: режим Auto
  или Ask на каждый tool, кнопки Approve и Deny в треде Slack. Запись в папку memories по умолчанию требует одобрения;
  для агентов по расписанию документация советует это выключить [lc-fleet].
- Похожий слой у HumanLayer — SDK 2024 года: агент просит одобрения или ввода в Slack, SMS или email
  (`humanlayer:83`).

### Sentry Seer

- **Цена.** 14 дней бесплатно, дальше $40 за активного contributor-а в месяц без ограничения использования
  [seer-blog-aug]. С 2026-12-08 — usage-based credits через Seer Wallet с дневным лимитом расхода и выключателем
  [seer-docs].
- **Как Sentry использует Seer сама** [seer-blog-aug], 2026-08-06.
  - Seer «will not create a PR for every issue automatically»: перед PR оценивает fixability и severity.
  - О новом PR от Seer приходит сообщение в Slack. Routine Claude по расписанию просит Seer назвать reviewer-а —
    человека, который больше всех работал с кодом из root cause по истории commit-ов. Потом routine пишет ему: смержить
    или закрыть PR и оставить одну строку отзыва.
  - Первые результаты после запуска в середине июля: action rate по PR — примерно +21%, ответ в течение 48 часов —
    +13%, закрытий без merge — +12,5% (дубли исправлений или более широкий fix у reviewer-а). Это сравнение «до и
    после» у одной команды, без контрольной группы.
  - Подбором пришли к правилам: не писать в выходные и сразу после назначения; никогда не задавать один и тот же
    вопрос дважды. Около 90% постов в ленте Slack — уведомления о новых PR.
- **Гостевой пост в блоге Sentry** [seer-57], 2026-07-23. Бэклог 57 → 1 ошибка. «You don't get spammed with PRs»,
  потому что дальше проходят только уверенные. «80-90% of bugs being fixed» — оценка автора, не замер.
- **Ограничения** [seer-docs]. Числовой порог fixability в документации не опубликован. Существующие issues после
  включения автоматически не берутся. Только GitHub.com и GitLab.com; self-hosted, Bitbucket и Azure DevOps не
  поддерживаются. Действие Fix with Seer в Slack — только в программе Early Adopter.

### Factory

- Automations, шаблоны и Triage — в досье (`factory:390–434`).
- **Ограничения и шум** (досье). Automation по расписанию встаёт на паузу после пяти неудачных запусков подряд
  (`factory:410`). О сбоях приходят письма, потом ежедневная сводка (`factory:412`). Вместо модели можно указать
  `cheapest` (`factory:402`). Шаблон «PR Babysitter», который следил за PR, удалён 2026-11-06; причина не названа
  (`factory:397`).

## Цифры исследований и вендоров

Каждое число — с условиями. Работы до 2024 года отмечены отдельно.

### Сколько проактивных подсказок принимают

| Работа | Условия | Что намерили |
| --- | --- | --- |
| Chen et al., «Need Help? Designing Proactive AI Assistants for Programming», CHI 2025 [chen-chi25] | 65 студентов в США. 20 минут с обычным чатом без доступа к коду и 20 минут с одним из трёх проактивных вариантов; задачи на Python | Тестов пройдено больше, чем с обычным чатом: на 12,1% (Suggest and Preview), 18,0% (Suggest), 11,6% (Persistent Suggest). Проактивный вариант предпочли обычному чату 80%, 90% и 47%. Persistent Suggest — ожидание 5 секунд вместо 20 и 5 подсказок вместо 3; участники называли его «distracting» и «annoying». Из 75 взаимодействий с подсказками 69 закончились принятием, 6 — отказом; отказывали в основном подсказкам об эффективности и модульности (5 из 6) |
| Pu et al., «Assistance or Disruption?», CHI 2025 [pu-chi25] | 18 студентов старших курсов. Каждый работал в трёх вариантах: только по запросу; проактивный агент; проактивный агент с индикатором присутствия и отдельными тредами. Задачи по 30 минут | 398 проактивных вмешательств: 53,3% привели к работе с ними, 12,1% помешали, 34,7% проигнорированы. Оценка помехи по шкале 1–7: 4,61 у проактивного агента, 3,78 с индикатором присутствия, 1,56 при работе только по запросу. Лучше всего работали вмешательства на границе подзадачи: после блока кода, запуска программы, вставки нескольких строк. Trigger по бездействию не сработал: бездействие часто означало высокую нагрузку. Около половины одобрительных сообщений после блока кода игнорировали |
| Kuo et al., «Developer Interaction Patterns with Proactive AI: A Five-Day Field Study», IUI 2026 [kuo-iui26] | 5 дней, 15 профессиональных разработчиков, проактивные подсказки о качестве кода в production IDE; 229 вмешательств на 5 732 точках взаимодействия | На границе работы, например после commit, — 52% engagement. Посреди задачи, например после отклонённой правки, — 62% отказов. Подсказку в удачный момент понимали быстрее, чем ответ на собственный запрос: 45,4 с против 101,4 с (p = 0,0016) |
| Ziegler et al., «Measuring GitHub Copilot's Impact on Productivity», CACM, 2024; данные 2022 года [ziegler] | 2 047 ответов опроса пользователей Copilot, сопоставленных с телеметрией IDE | Среднее acceptance rate показанных подсказок — 27%. Доля принятых показанных подсказок лучше всего предсказывает ощущаемую продуктивность — лучше, чем то, сколько принятого кода остаётся в коде позже |
| Pu, Zhang et al., ProMemAssist, UIST 2025 [promem] | Умные очки, 12 участников, задачи с высокой нагрузкой на память. Модель рабочей памяти взвешивает пользу помощи против цены прерывания | Помощь выборочнее, engagement выше, отрицательных реакций меньше, чем у LLM-baseline. Чисел в аннотации нет |

### False positive и молчание

| Работа | Условия | Что намерили |
| --- | --- | --- |
| Lu et al., «Proactive Agent: Shifting LLM Agents from Reactive Responses to Active Assistance», ICLR 2025, arXiv 2410.12361 (ProactiveBench) [lu-iclr25] | 233 тестовых события из сценариев кода, текста и быта; модель решает, предложить задачу или промолчать | У большинства готовых моделей recall 98–100%, но false alarm — доля предложений, сделанных, когда помощь не нужна, — высокий: GPT-4o 51,85%, Claude-3.5-Sonnet 54,63%, LLaMA-3.1-8B 61,84%, GPT-4o-mini 64,73%. После дообучения — 50,22% при F1 66,47%. Авторы: модели «fail to stay silent when the user does not require any assistance». Дообученная модель-судья совпала с разметкой людей в 91,67% случаев; GPT-4o в роли судьи — F1 67,04% и 0% верных ответов на случаях, когда агент предложил ненужную помощь |
| Sun et al., «Does AI Code Review Lead to Code Changes? A Case Study of GitHub Actions», arXiv 2508.18771, v2 2026-04 [sun-ai-cr] | 16 GitHub Actions для AI-review, больше 22 000 комментариев в 178 repo | Валидные комментарии людей ведут к изменению кода в 60% случаев, валидные комментарии AI — в 0,9–19,2% в зависимости от инструмента. Комментарии по запросу человека — 14,4% против 9,0% у автоматических; по всем инструментам вместе разница незначима, у двух инструментов по отдельности значима: 12,8% против 6,8% и 22,2% против 0,5%. Короткие комментарии и комментарии с кодом принимают чаще |
| Lin et al., «Is Agentic Code Review Helpful? Mining Developers' Feedback to CodeRabbit Reviews in the Wild», arXiv 2607.03316, 2026 [lin-cr] | 31 073 пары «review CodeRabbit — ответ разработчика», 10 191 PR, 239 repo на GitHub | 36,4% приняты, 7,3% вызвали обсуждение, 56,3% отклонены. Причина отказа — в основном невалидные предложения: false positive, повторы, замечания не по теме. Лёгкая модель предсказывает отказ с F1 до 76% |
| Zhong et al., «Human-AI Synergy in Agentic Code Review», arXiv 2603.15911, 2026 [zhong] | 278 790 разговоров review в 300 open-source проектах | Предложения AI-агентов попадают в код значимо реже, чем предложения людей. Больше половины непринятых — неверные или решены другим способом. Процентов в аннотации нет |

Вендоры — не независимый замер:

- GitHub: в 29% review Copilot не пишет ничего; цель — «not to maximize comment volume» [gh-60m].
- OpenAI: 52,7% комментариев Codex review ведут к изменению кода; precision важнее recall [openai-align].
- Cursor: resolution rate Bugbot 52% → 78,13% [cursor-learn]. Security Review — доля принятых находок 45–50% → 60–70%
  (`cursor:284`).
- Devin: сессии с «зелёной» уверенностью дают принятые PR вдвое чаще «красных» (`devin:861`).
- Google (2023) и промышленное исследование PR-Agent уже собраны в
  `docs/research/2026-11-07-human-review-из-истории-pr.md:211–215`. У PR-Agent 73,8% автоматических комментариев
  resolved, но время закрытия PR выросло с 5 ч 52 мин до 8 ч 20 мин.

### Цена прерываний и усталость от уведомлений

| Работа | Условия | Что намерили |
| --- | --- | --- |
| Microsoft Work Trend Index, «Breaking down the infinite workday», 2025-06-17 [wti25] | Обезличенная телеметрия Microsoft 365 до 2025-02-15, без education- и EU-клиентов; опрос 31 000 работников в 31 стране | Встреча, письмо или уведомление прерывает работника каждые 2 минуты; в методике — 275 раз в день. Обе цифры — по верхним 20% пользователей по числу входящих сигналов, и считаны они на разной основе: 8-часовой и 24-часовой день. 117 писем в день, 153 сообщения Teams в будний день. Встреч после 20:00 на 16% больше, чем год назад |
| Ma, Huang, Leach, «Breaking the Flow: A Study of Interruptions During Software Engineering Activities», ICSE 2024 [ma-icse24] | Контролируемый эксперимент: написание, понимание и review кода с прерываниями лично и на экране; браслет с физиологическими датчиками и самооценка | Прерывания на экране от «доминирующего» отправителя значимо удлиняют понимание кода. Прерывания лично люди оценивают как более стрессовые, а физиология показывает меньший стресс. Чисел из полного текста извлечь не удалось |
| «Stop Fiddling With Your Phone and Go Offline», CHI 2026 (Aalto) [aalto-chi26] | Около 300 взрослых в Германии, 7 месяцев логов телефона и компьютера и опросов | Перегрузку информацией предсказывают короткие частые возвращения к устройству, а не общее время: перегруженные и неперегруженные проводили за устройствами примерно одинаковое время. Чисел в пресс-релизе нет |
| Fitz et al., «Batching smartphone notifications can improve well-being», Computers in Human Behavior, 2019 — **вне окна 2024–2026**; единственный найденный рандомизированный эксперимент о пачках уведомлений [fitz19] | 237 участников: уведомления как обычно, пачкой три раза в день или совсем без уведомлений | Пачкой — внимательнее, лучше настроение, меньше стресс, меньше отвлечений от телефона. Совсем без уведомлений — выше тревога и страх что-то пропустить (FoMO) |

Ещё один замер — у Sentry (раздел Sentry Seer выше): маршрутизация к нужному reviewer-у и запрет сообщений в выходные и
сразу после назначения дали примерно +21% action rate [seer-blog-aug].

### Дешёвая сортировка до дорогой работы

- **Claude Code auto mode.** Две ступени: быстрый фильтр в один token, рассуждение — только по отмеченным действиям.
  0,4% false positive на 10 000 реальных действий; 17% пропущенных «слишком рьяных» действий на 52 реальных случаях
  (`cc-cloud:386–389`).
- **Devin.** Preflight check — LLM-фильтр или скрипт с состоянием между запусками; по умолчанию 10 элементов за запуск,
  максимум 50 (`devin:273`).
- **OpenAI.** Verifier, который тратит малую долю token-ов генератора, ловит «a large share» серьёзных проблем; чисел
  в тексте нет [openai-align].
- **Jules.** Planning Critic проверяет планы, которые идут без одобрения человека: провалов задач на 9,5% меньше
  [jules-cl].
- **Linear.** Маленькие модели в triage не справились: работали только с контекстом, данным заранее [lin-ti-built].
  Запуск Loop без coding-сессии стоит $0,07–0,20 [lin-credits].
- **Antigravity и Factory.** Automations Antigravity сначала работали только на Flash, выбор модели появился 2026-10-15
  (`antigravity:724`). В Factory вместо модели можно указать `cheapest` (`factory:402`).

## Что из этого следует для worfy

1. **Давать агенту worfy обязанности с явной областью, а не общую ленту находок.** OpenAI за девять месяцев свернула
   ежедневную ленту Pulse в Scheduled tasks, а потом выпустила dots — агента, которому дают цель, подключения и
   правила, что делать самому [oa-rn], [dots-learn]. Antigravity убрала inbox решений в Agent Manager к февралю 2026
   (`antigravity:623`), LangChain перевела `agent-inbox` в архив [lc-inbox-repo]; причину ни та, ни другая не
   назвали. Остались конструкции «trigger, область, правила действия»: Linear Loops, Copilot automations, Devin
   automations (`copilot-cloud:303–316`, `devin:264–275`). Для worfy: каждая обязанность агента — отдельная запись с
   областью (какие Project-ы, какие события, какие действия), которую владелец видит и выключает по одной.
2. **По умолчанию — предложение с причиной и уверенностью; самостоятельность включается по классу действия.** Linear
   выпустил Triage Intelligence 2025-08-14 только с предложениями (принять или отклонить), а auto-apply по свойству и
   значению добавил 2025-09-18 [lin-ti-preview], [lin-ti-auto]. GitHub по умолчанию сам применяет только правки
   высокой уверенности и пишет причину и для применённых [gh-levels]. У dot четыре режима на действие [dots-help].
   Seer ограничивает глубину точкой остановки проекта при любой уверенности [seer-docs]. Для worfy: прочитать и свести — сам; подготовить
   черновик в своей ветке или brief для Session — сам; push, комментарий в PR, merge, сообщение людям — только после
   «да» владельца. Режим «сам» для класса включается, когда видна доля принятых.
3. **Молчание — нормальный исход: мерить долю принятых с первого дня и ставить на паузу обязанность, которую
   игнорируют.** У готовых LLM 52–65% предложений помощи — лишние [lu-iclr25]. Частые подсказки уронили долю
   предпочитающих проактивный вариант с 90% до 47% [chen-chi25]. Комментарии AI-review меняют код в 0,9–19,2% случаев
   против 60% у людей [sun-ai-cr]. Вендоры глушат сами: Copilot молчит в 29% review [gh-60m], Codex пишет только P0 и
   P1 (`codex-app:331`), Bugbot выключает правило при устойчиво отрицательном сигнале [cursor-learn], задача ChatGPT
   без внимания пользователя может встать на паузу [oa-rn]. У Copilot именно acceptance rate лучше всего предсказывал
   ощущаемую пользу [ziegler]. Для worfy: счётчики «показано, принято, отклонено, проигнорировано» по обязанности и
   типу предложения (аналитики использования у worfy сейчас нет — `map.md`, раздел Notes), дневной лимит предложений,
   пауза обязанности после N проигнорированных предложений подряд.
4. **Дешёвая модель — первая ступень: решает «молчать или смотреть ближе», а предложение пишет модель сильнее.**
   Двухступенчатый классификатор разрешений Claude Code в auto mode дал 0,4% false positive на 10 000 действий
   (`cc-cloud:386–389`). Devin ставит LLM-фильтр или скрипт перед платной работой (`devin:273`). Но Linear ушёл с GPT-4o mini и Gemini 2.0 Flash:
   маленькие модели работали только с контекстом, данным заранее [lin-ti-built]. Для worfy, где бриф темы предлагает
   «Haiku-first»: первая ступень — правила в коде и дешёвая модель по короткой выжимке события; вторая — сильная модель
   с доступом к файлам Project-а. Пропуски первой ступени видны только на выборке, которую перепроверяет вторая.
5. **Отдавать на границе работы и пачкой; прерывать только ради решения, без которого стоит работа.** На границе работы
   подсказку берут в работу в 52% случаев, посреди задачи отклоняют в 62% [kuo-iui26]. Trigger по бездействию не
   сработал, граница подзадачи сработала [pu-chi25]. Sentry после маршрутизации к нужному человеку и запрета сообщений в
   выходные и сразу после назначения получила примерно +21% action rate [seer-blog-aug]. Dot по просьбе пользователя
   шлёт ход работы и решения в разные каналы [dots-learn]. Для worfy: предложения копятся в одном списке — это идея 21
   исследования конкурентов, единый список «Needs you» по всем Project-ам (`README:561`). Они выходят на границах:
   конец Session, конец Wave у Autopilot (Wave — пачка Ticket-ов, которую Autopilot запускает разом), утренняя сводка.
   Notification сразу — только если без ответа владельца стоит работа.
6. **«Ничего не произошло» — отдельный trigger, и считает его код worfy, без модели.** Застрявшая Session — это
   отсутствие события. У Cursor такое событие trigger-ом быть не может (`cursor:264`). Linear запускает loop по условию
   один раз и не повторяет, пока условие держится [lin-loops-docs]. Seer тратит модель только на issue с 10 и больше
   событиями за 14 дней [seer-docs]. Devin сам ставит себе напоминание (`devin:148`). Для worfy: пороги вида «Session
   молчит N минут» и «PR ждёт reviewer-а M часов» считает код на уже существующем чтении GitHub — как в идее 16
   исследования конкурентов, наблюдении за PR без вызова модели (`README:538`). Модель зовут, только когда порог
   сработал; одно условие даёт одно предложение, пока не изменится.

## Что проверить не удалось

- **OpenAI.** openai.com и help.openai.com отдают инструменту чтения 403. Release notes ChatGPT и статью о dots я читал
  через текстовый proxy (r.jina.ai). Справочная статья о Pulse на 2026-11-20 отдаёт 404, поэтому формулировку OpenAI о
  том, чему её научил Pulse, проверить по первоисточнику не удалось. Цифр использования или принятия для Pulse,
  Scheduled tasks и dots нет. Доля неверных комментариев GPT-5-Codex есть только на графиках поста о Codex от 2025-09;
  текстом её нет.
- **Linear.** Точности и доли принятых предложений Triage Intelligence нет. Нужен ли человек для встроенных действий
  Linear в Loops, документация не говорит. Помнит ли loop прошлые запуски: блог говорит «previous runs», документация
  молчит.
- **GitHub.** Кто может принимать предложения automations и истекают ли они, не описано. Долю false positive для
  Copilot code review GitHub не публикует; что считается «acted on» в Repository insights, не определено.
- **Cursor.** Сравнение resolution rate — замер самого Cursor с LLM-судьёй; точность судьи и окно времени не указаны.
- **Sentry.** Порог fixability в документации не опубликован. Число 0,40 встречается только в зеркале черновика
  документации, здесь оно не использовано. Доли принятых PR Seer нет; «80-90%» — оценка автора гостевого поста.
- **Jules.** Считаются ли Suggested Tasks и задачи по расписанию в дневной лимит. Какую долю предложений принимали.
  Причина закрытия сверх фразы о переносе опыта в Antigravity.
- **LangChain.** Почему `agent-inbox` и `executive-ai-assistant` ушли в архив. Цена LangSmith Fleet.
- **Исследования.** Полный текст ICSE 2024 о прерываниях (PDF) прочитать не удалось — только аннотация. У ProMemAssist
  и CHI 2026 (Aalto) — только аннотация и пресс-релиз. В Work Trend Index цифры «каждые 2 минуты» и «275 раз в день»
  считаны на разной основе. Kuo et al. не называют IDE.
- **Агент над многими Project-ами.** Данных о том, какую долю предложений такого агента принимают, нет ни у кого:
  dots вышли 2026-09-29, Copilot Projects — preview с 2026-10-28.
- **Досье 2026-11-13.** Утверждения о Copilot, Cursor, Devin, Codex, Factory, Antigravity, Claude Code и HumanLayer, на
  которые здесь ссылки «файл:строка», в этот раз заново не проверялись.

[f-readme]: ../../research/2026-11-13-competitors/README.md
[f-gcc]: ../../research/2026-11-13-competitors/github-copilot-cloud-agent-and-agent-hq-mission-.md
[f-cursor]: ../../research/2026-11-13-competitors/cursor-agents-window-cloud-agents-and-automation.md
[f-devin]: ../../research/2026-11-13-competitors/devin.md
[f-codex]: ../../research/2026-11-13-competitors/codex-app-codex-in-the-chatgpt-desktop-app.md
[f-factory]: ../../research/2026-11-13-competitors/factory-droids.md
[f-ag]: ../../research/2026-11-13-competitors/google-antigravity.md
[f-cc]: ../../research/2026-11-13-competitors/claude-code-cloud-sessions-and-projects.md
[f-hl]: ../../research/2026-11-13-competitors/humanlayer.md
[gh-levels]: https://docs.github.com/en/copilot/concepts/agent-capabilities/agent-powered-workflows-and-operations/about-automation-rationale-and-approvals
[gh-60m]: https://github.blog/ai-and-ml/github-copilot/60-million-copilot-code-reviews-and-counting/
[gh-insights]: https://github.blog/changelog/2026-11-17-track-copilot-code-review-outcomes-in-repository-insights
[jules-blog]: https://blog.google/technology/developers/jules-proactive-updates/
[jules-sugg]: https://jules.google/docs/suggested-tasks/
[jules-sched]: https://jules.google/docs/scheduled-tasks/
[jules-cl]: https://jules.google/docs/changelog/
[jules-limits]: https://jules.google/docs/usage-limits/
[cursor-learn]: https://cursor.com/blog/bugbot-learning
[openai-align]: https://alignment.openai.com/scaling-code-verification/
[openai-upgrades]: https://openai.com/index/introducing-upgrades-to-codex/
[oa-rn]: https://help.openai.com/en/articles/6825453-chatgpt-release-notes
[dots-learn]: https://learn.chatgpt.com/codex/dots
[dots-help]: https://help.openai.com/en/articles/20001529-dots-in-chatgpt
[digit-pulse]: https://www.digit.in/news/general/openai-is-retiring-chatgpt-pulse-and-replacing-it-with-scheduled-tasks-here-is-why.html
[lin-ti]: https://linear.app/docs/triage-intelligence
[lin-ti-preview]: https://linear.app/changelog/2025-08-14-product-intelligence-technology-preview
[lin-ti-auto]: https://linear.app/changelog/2025-09-19-auto-apply-triage-suggestions
[lin-ti-built]: https://linear.app/now/how-we-built-product-intelligence
[lin-agent]: https://linear.app/docs/linear-agent
[lin-loops-blog]: https://linear.app/now/introducing-loops
[lin-loops-docs]: https://linear.app/docs/loops
[lin-loops-cl]: https://linear.app/changelog/2026-10-22-slack-and-github-loops
[lin-credits]: https://linear.app/docs/ai-credits
[lin-aig]: https://linear.app/developers/aig
[lc-ambient]: https://www.langchain.com/blog/introducing-ambient-agents
[lc-fleet]: https://docs.langchain.com/langsmith/agent-builder-essentials
[lc-inbox-repo]: https://github.com/langchain-ai/agent-inbox
[seer-docs]: https://docs.sentry.io/product/ai-in-sentry/seer/autofix/
[seer-blog-aug]: https://blog.sentry.io/automated-debugging-workflow-sentry/
[seer-57]: https://blog.sentry.io/57-bugs-to-1/
[chen-chi25]: https://arxiv.org/abs/2410.04596
[pu-chi25]: https://arxiv.org/abs/2502.18658
[kuo-iui26]: https://arxiv.org/abs/2601.10253
[ziegler]: https://cacm.acm.org/research/measuring-github-copilots-impact-on-productivity/
[promem]: https://arxiv.org/abs/2507.21378
[lu-iclr25]: https://proceedings.iclr.cc/paper_files/paper/2025/hash/75c37811e830bf029584b1c6fac17726-Abstract-Conference.html
[sun-ai-cr]: https://arxiv.org/abs/2508.18771
[lin-cr]: https://arxiv.org/abs/2607.03316
[zhong]: https://arxiv.org/abs/2603.15911
[wti25]: https://www.microsoft.com/en-us/worklab/work-trend-index/breaking-down-infinite-workday
[ma-icse24]: https://conf.researchr.org/details/icse-2024/icse-2024-research-track/74/Breaking-the-Flow-A-Study-of-Interruptions-During-Software-Engineering-Activities
[aalto-chi26]: https://aalto.fi/en/news/fragmented-phone-use-not-total-screen-time-is-the-main-driver-of-information-overload-study-finds
[fitz19]: https://doi.org/10.1016/j.chb.2019.07.016
