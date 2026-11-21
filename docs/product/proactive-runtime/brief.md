# Product discovery: Proactive Runtime (Haiku-first)

Дата: 2026-11-20. Статус: **идея владельца для Product Session; не принятая Feature, не Spec и не разрешение на реализацию**.

## 1. Вопрос для Product Session

Стоит ли Worfy стать **проактивным**: замечать значимые изменения и незавершённые обязательства пользователя, самостоятельно понимать, когда нужна работа агента, и предложить продолжение существующего workflow — не заставляя владельца вручную искать каждую новую задачу?

Первоначальная идея: маленькая локальная LLM постоянно наблюдает за событиями; существенные случаи передаёт Haiku, затем по сложности Sonnet/Opus через существующий Worfy SDK и MCP. После обсуждения цены Haiku 5.5 появилась более простая гипотеза: **не запускать локальную LLM в MVP вообще**. Event collector получает сигналы, Haiku вызывается по событию, а полноценные Session и Autopilot остаются существующими механизмами Worfy.

Это **гипотеза**, которую Product Session должна оспорить, а не готовое архитектурное решение.

## 2. Задача пользователя, которую хочется решить

Сегодня Worfy хорошо продолжает работу, когда владелец запускает Session, отвечает на запрос, открывает PR Inbox или инициирует Autopilot. Но важный контекст может возникнуть **после** завершения работы: ревьюер пишет замечание в PR, меняется статус задачи, появляется блокер или владелец забывает о данном обещании.

Вопрос: умеет ли Worfy не только показать событие, но и связать его с уже известными Project, Ticket, Session, Epic, PR, прежним решением и следующей нужной работой — с понятным объяснением «почему это важно»?

**Проверить существующий продукт перед проектированием:**
- PR Inbox уже группирует PR по тому, чей следующий ход, показывает review threads и уведомляет о новых запросах на review/ответах. Не копировать эту механику: [PR Inbox](../../features/pr-inbox.md), [Notifications](../../features/notifications.md), [ADR-0105](../../adr/0105-pr-reply-only-on-the-users-click.md).
- Autopilot уже выполняет Waves, а не нуждается во втором агентном движке: [Autopilot](../../features/autopilot.md), [Sessions](../../features/sessions.md).
- Multi-vendor Claude Code / Codex уже существует: [Vendors](../../features/vendors.md).
- Product Session советует, но **не** запускает Autopilot и не изменяет код: [Product Session](../../features/product-session.md).
- Аналитики использования у Worfy нет. Не утверждать, что пользователи регулярно пропускают события, без проверки.

## 3. Сценарии (кандидаты, не обещания MVP)

### A. GitHub review follow-up — первый кандидат на MVP
Агент создал PR. Через несколько часов ревьюер оставляет замечание. Worfy уже умеет получить сигнал через PR Inbox. Новый слой определяет, относится ли комментарий к работе Worfy, нужен ли ответ, исправление или проверка. Вместо запуска разработки без спроса владелец получает **обоснованное предложение**: «PR #N: ревьюер нашёл потенциальный баг, связанный с Ticket X; подготовить Fix Session?». Действие только после разрешённого пользователем шага.

**Почему это не просто PR Inbox:** Inbox показывает, чей ход и что изменилось; проактивный слой связывает событие с контекстом, оценивает нужное действие и предлагает осмысленный следующий шаг.

### B. Stalled work / unfinished commitments
Session или Ticket долго ожидает внешнего ответа, новый сигнал снимает блокировку; Worfy предлагает возобновить соответствующий workflow. Не спамит, если пользователь уже работает над проблемой или её закрыли.

### C. Cross-source obligations — позже, только после оценки ценности
Slack: обещали ответить, но прошло время; Jira: приоритет/assignee изменился; Gmail: пришёл связанный с задачей ответ; Calendar: встреча создаёт подготовительную задачу. **Интеграции и разрешения этих источников не предполагаются существующими.** Здесь больше приватности, контекстных ошибок, OAuth/permissions и ожиданий пользователей, чем в GitHub-only случае.

### D. Autonomous execution — отдельная ступень, не MVP
После явного opt-in и ограничений по действиям Worfy мог бы автоматически начать read-only investigation или безопасную подготовку патча. Не смешивать с правом писать комментарии, отправлять сообщения, делать push/merge или менять внешний мир.

## 4. Конкурирующие продуктовые варианты

| Вариант | Как работает | Почему выбрать | Почему отвергнуть |
|---|---|---|---|
| 0. Deterministic-only | Правила PR Inbox, уведомления, без LLM | Дёшево, просто, предсказуемо | Плохо понимает неявные зависимости |
| A. Event-driven Haiku-first | Сигнал -> фильтр/дедупликация -> Haiku -> proposal | Малые затраты, нет локальных весов | Внешняя зависимость, приватность и юридический/биллинговый вопрос |
| B. Local LLM -> Haiku | Локальная классификация, облачная проверка только иногда | Offline, контроль данных, уменьшение отправки событий | Память, инференс, сложность установки на Mac/Windows |
| C. Regular stronger Session | Сразу Sonnet/Opus | Меньше ступеней, возможно выше качество | Дороже/медленнее, новый поток событий засоряет workflow |

Предварительный фаворит для проверки — **A, GitHub-only, read-only, shadow-first**. Не утверждать это как принятое решение: Product Session должна сначала сравнить вариант 0 и существующий PR Inbox.

## 5. Эскиз потока (не архитектурное обязательство)

~~~text
Existing GitHub PR Inbox / Worfy internal events
  -> source adapters (id, project, event, timestamp, provenance)
  -> deterministic dedupe / suppression / cheap rules
  -> one-shot Haiku relevance classification (isolated, untrusted content)
  -> IGNORE | SURFACE | INVESTIGATE | PROPOSE_RUN
  -> optional read-only context retrieval
  -> proposal in Worfy UI with "why", source and proposed action
  -> owner approval (or explicitly permitted autonomous policy later)
  -> existing Session / vendor runtime / MCP / Harness / Autopilot
  -> result + audit trail, without repeated triggers
~~~

Первые два шага могут обходиться без LLM. Процесс не обязан непрерывно генерировать токены: он просыпается на события, а также может делать редкие проверки при отсутствии webhook. Механизм должен работать в Electron main на Machine, владеющей Project; роль Linked machine — отображение, а не дублирование действий.

Для первого этапа лучше отделить **обнаружение**, **интерпретацию**, **предложение действия** и **право выполнить действие**.

Псевдоконтракт классификатора (для исследования, не утверждённая API-схема):

~~~json
{
  "decision": "PROPOSE_RUN",
  "reason": "A reviewer identified an unaddressed bug in the PR connected to this Ticket.",
  "evidence": ["repo#123 review-thread-456", "Ticket epic/07"],
  "related_project": "project-id",
  "next_action": "Offer a fix Session",
  "needs_more_context": false
}
~~~

Уверенность модели, если она возвращается, — только диагностический сигнал, **не** разрешение на действие. При неизвестном состоянии лучше безопасный отказ / запрос контекста, а не выдуманная связь.

## 6. Факты и потенциальные конфликты в текущем Worfy

1. **Haiku не доступна как модель обычной Session** из-за ограничений контекста при большом наборе MCP-tools: [settings.ts](../../../src/shared/agent/settings.ts) и [ADR-0058](../../adr/0058-terminal-ai-assist-process.md). Не обходить запрет через пользовательскую Session.
2. **Одноразовые изолированные Haiku-запросы уже реализованы** для Terminal AI и narrator Product Session, без MCP/tools, project settings и постоянных транскриптов: [narrator.ts](../../../src/main/vendors/claude/narrator.ts), [ADR-0058](../../adr/0058-terminal-ai-assist-process.md). Исследовать переиспользование этого pattern, а не создавать отдельный framework.
3. На момент чтения кода narrator закрепляет конкретную версию Haiku (HAIKU_WITHOUT_THINKING), **не** Haiku 5.5; переход модели — отдельный compatibility/quality spike.
4. Текущие Session/Terminal AI работают через Claude Agent SDK и Claude Code login на подписке, **без API-key**. Публичная цена Claude API не означает, что Worfy сейчас списывает именно эти доллары. Использование подписки в стороннем продукте имеет ограничения, уже описанные в [ADR-0058](../../adr/0058-terminal-ai-assist-process.md) и [roadmap](../roadmap-worfy/map.md). Не добавлять незаметно API-key/billing и не закладывать обход правил Anthropic.
5. **PR reply — только явный щелчок Send пользователя**, [ADR-0105](../../adr/0105-pr-reply-only-on-the-users-click.md). Любая автономность, позволяющая писать на GitHub, требует отдельного решения и защиты на уровне кода.
6. У Worfy уже есть Notifications, Auto-approval и Flight Recorder. Новый слой не должен заводить дублирующие механизмы аудита и разрешений. Проверить применимость существующих контрактов.
7. Уже существуют Full и Silent Project mode, несколько репозиториев на Project, Mac/Windows и Linked machines. Приёмка должна учитывать, кто владеет событием, состоянием и Session.

## 7. Экономика Haiku и неизвестные

Официальная цена **Claude Haiku 5.5 API** на 2026-11-20 для запросов до 100K input tokens: **$0.10 / 1M input и $0.50 / 1M output**. Для более длинных промптов тариф выше. Источник: https://platform.claude.com/docs/en/about-claude/pricing

Простая модель для обсуждения, не обещание фактической стоимости:
- 1,000 событий/сутки × (1,000 входных + 100 выходных токенов) × 30 дней = примерно **$4.50 / месяц** при API-тарифе и одном запросе на событие.
- 1,000 событий/сутки × (5,000 входных + 300 выходных токенов) × 30 дней = примерно **$19.50 / месяц**.
- Реальная сумма зависит от числа tool turns, retry, reasoning, кэша, класса промпта и того, какие события отсеиваются без LLM. Нужны нагрузочные измерения.
- У Claude Code-подписки ограничения не равны API-биллингу. **Разделить эксперимент по качеству и выбор способа лицензированного доступа к модели.**

Дискавери обязана сравнить **стоимость локального рантайма в сложности/ресурсах** с облачным вариантом, а не только $/MTok.

## 8. Guardrails и опасные режимы

- **Opt-in по умолчанию для пилота**: не читать новые источники, не запускать Session и не делать сеть от имени человека без явно заданных разрешений.
- **Shadow mode**: сначала только фиксировать «что бы предложили», без уведомлений и действий. Затем показать предложения пользователю с причинами.
- **External text — untrusted**: PR комментарий, письмо или сообщение могут содержать prompt injection; никогда не считать их инструкциями менять policy, выполнять команды или выгружать secrets.
- **Read-only first**. Никаких автоматических GitHub replies, push, merge, удаления, отправки писем/сообщений. Существующие границы прав остаются действовать и при PROPOSE_RUN.
- **Privacy and retention**: минимальный контекст, редактирование PII/секретов, понятные локальные журналы, возможность выключить источник; для Slack/Gmail — отдельное исследование и согласие.
- **Deduplication and loops**: источник + event ID + revision/sha; одна и та же реакция Worfy не должна повторно запускать саму себя. Не запускать второй agent run, пока первый выполняет ту же работу.
- **Offline/restart/multi-machine**: предсказуемый replay событий, подавление старых событий на первом запуске, один владелец выполнения на Project.
- **Budget/quota**: лимиты вызовов в сутки, backoff/rate limits, отказ при ошибке или превышении бюджета, возможность видеть cost/usage. Не скрывать повторные попытки.

## 9. Предлагаемый порядок проверки

### Experiment 0 — найти реальную потребность
Показать существующие сценарии PR Inbox. В течение нескольких дней собрать **с согласия владельца** реальные примеры, в которых событие было важно, но не привело к своевременному действию. Описать конкретный выигрыш над текущими уведомлениями. Если его нет — остановиться.

### Experiment 1 — offline evaluation, без запуска работы
Набор 100–300 разметенных событий GitHub и внутренних workflow-сигналов, позже 500–1,000. Разметка: нужен ли шаг, кто должен действовать, насколько важно, какой Project/Ticket связан; отличать реальные метки от предположений. Сравнить deterministic baseline, Haiku 5.5 (one-shot) и более сильную модель только на неоднозначных примерах. Измерять precision, recall (особенно критических случаев), ложные уведомления в день, latency, стоимость на 1,000 событий и число ненужных agent starts.

### Experiment 2 — shadow integration
Подписаться только на существующие GitHub PR Inbox / Worfy internal signals. Дедупликация, классификация и локальный журнал предложений без уведомлений/исполнения; открыть результаты Product owner.

### Experiment 3 — proposal-only MVP
Одна объяснимая рекомендация в UI с источниками, ссылкой на PR/Ticket/Session и контролами **Dismiss / Snooze / Open / Prepare**. Никаких сайд-эффектов без явного действия. Проверить ценность в реальной работе.

### Дальше — отдельное решение
Только после eval и реального использования: multi-source integrations, proactive investigation, автоматический запуск read-only Session, и затем более сильная автономность с отдельными разрешениями.

**Критерии остановки:** нет новой ценности над PR Inbox; слишком много ложных или пропущенных событий; непрозрачная стоимость/лицензирование; невозможность защитить boundary; слишком большой overhead относительно измеренной пользы.

## 10. Вопросы, которые Product Session должна разрешить

1. Какую **конкретную** новую работу это выполняет сверх PR Inbox, Notifications, Autopilot, Work track, PR follow-up? Есть ли частый сценарий с доказанным ущербом?
2. Для кого: только Product owner, работающий соло, или ещё reviewer/команда? Меняется ли продуктовая позиция Worfy?
3. GitHub-only как MVP — достаточно ли ценности? Какой первый event и какой один следующий шаг?
4. Имеет ли смысл Haiku-first против deterministic-only? Каким экспериментом это дешевле всего опровергнуть?
5. Использовать текущий Claude Agent SDK one-shot, отдельный прямой API или другой законный путь? Как меняются лицензирование, auth, квоты и цена для других пользователей?
6. Какие части Worfy уже можно безопасно переиспользовать? Где риск нового «второго Orchestrator»?
7. Где в UI показать рекомендации, не разрушая Canvas и не дублируя PR Inbox? Нужен ли отдельный view вообще?
8. Какие разрешения требуются для passive read, investigation, создания Session и внешних изменений?
9. Какой минимальный контекст нужен модели, чтобы не ошибаться, и какую часть можно определить без LLM?
10. Где хранить cursor, дедупликацию, отложенные предложения и audit между restart, Linked machine и Full/Silent mode?
11. Как отсечь шум, source prompt injection, циклы, false positives и «вечные напоминания»?
12. Сколько сценариев и метрик достаточно, чтобы принять **build / research / defer / reject**? Какие альтернативы дешевле?

**Просьба к Product Session:** задавать вопросы владельцу по одному; сначала сверить гипотезы с фактическим main/ADRs, провести честный конкурентный и технический анализ, использовать Critic, показать контраргументы и альтернативы. Итог — решение owner-а, обновлённая Mind map и при одобрении *черновик* Epic. **Не создавать Ticket-ы, не менять runtime и не запускать Autopilot без отдельного подтверждения владельца.**

## 11. Ссылки для проверки Product Session

- [Product Session](../../features/product-session.md)
- [PR Inbox](../../features/pr-inbox.md), [Notifications](../../features/notifications.md)
- [Autopilot](../../features/autopilot.md), [Sessions](../../features/sessions.md)
- [Vendors](../../features/vendors.md), [MCP servers](../../features/mcp-servers.md)
- [ADR-0058: isolated Claude Code assist process](../../adr/0058-terminal-ai-assist-process.md)
- [ADR-0105: explicit PR reply](../../adr/0105-pr-reply-only-on-the-users-click.md)
- [ADR-0094: vendor seam](../../adr/0094-vendor-seam.md)
- [ADR-0108: work continues after restart](../../adr/0108-work-continues-after-a-restart-of-worfy.md)
- [Existing Haiku narrator](../../../src/main/vendors/claude/narrator.ts)
- [Haiku model restrictions](../../../src/shared/agent/settings.ts)
- [Claude Haiku 5.5](https://www.anthropic.com/claude/haiku)
- [Anthropic official pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
