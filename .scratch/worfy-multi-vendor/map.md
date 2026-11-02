# Multi-vendor — карта

Карта поиска пути (wayfinder): Ticket-ы этой папки — вопросы, ответ на каждый — решение, а не код. Карта закончена, когда решать больше нечего.

## Destination

Принятый владельцем `spec.md` Epic-а `worfy-multi-vendor` с ADR о границе Vendor-а и нарезанными Ticket-ами и Wave-ами, Wave 1 готова к раздаче. Spec описывает путь к полной поддержке второго Vendor-а — Codex (OpenAI, вход по подписке ChatGPT) — во всех частях worfy, с архитектурой, куда третий Vendor добавляется новой реализацией границы, а не правкой всего приложения. Первый выпуск — чат Session на Codex.

## Notes

- Термины — `CONTEXT.md`: **Vendor** (заведён этой картой), Session, Subagent, Orchestrator, Limits, Harness, Autopilot, Run.
- Решения владельца 2026-11-02 — в Ticket-е 01: Codex CLI по подписке; Vendor выбирается у Session, у Project — Vendor по умолчанию; первый выпуск — чат Session; смешанные Vendor-ы по ролям агентов архитектура допускает, первый выпуск — один Vendor на Session; граница проектируется по двум настоящим реализациям, третий Vendor — проверка на бумаге.
- Прежнее решение, которое эта карта отменяет: `.scratch/worfy-mvp/spec.md:120` выносил «других провайдеров моделей (Codex, OpenRouter, Grok)» за рамки. Отмена записывается в ADR границы Vendor-а.
- Ограничения, которые уже действуют: ADR-0002 (worfy — view над workflow, своего хранилища событий нет), ADR-0009 (worfy не принимает и не хранит API-ключей), ADR-0019/0040 (Harness — plugin Claude Code), ADR-0058 (Terminal AI — свой процесс Claude Code).
- Что уже есть, по разведке 2026-11-02 (main 7c55cb59):
  - граница агента — `QueryFactory` / `QueryHandle` (`src/main/agent/session/types.ts:39`, `:91`), но её методы и поток событий — типы Agent SDK (`src/shared/agent/events.ts`, `src/shared/transcript/parse.ts`); настоящая реализация `src/main/agent/app-registry.ts:126`, фейк `fake-query.ts` (`WORFY_AGENT=fake`);
  - мимо этой границы к SDK идут: проверка входа (`src/main/ipc/first-run.ts:61`), черновик профиля Project (`src/main/ipc/projects.ts:89`), проба Limits (`src/main/agent/limits-usage.ts:196`), Terminal AI (`src/main/terminal-ai/assist.ts:70`), MCP-серверы `worfy-canvas` и `worfy-browser` (`createSdkMcpServer`, in-process: `src/main/mcp/canvas-server.ts:318`, `browser-server.ts:426`);
  - на файлах Claude Code стоят: транскрипты `~/.claude/projects` (`src/main/claude-home/*`), Subagent-ы на Canvas (ADR-0030/0031/0085), Flight Recorder (`src/main/flight-recorder/transcripts.ts:7`);
  - Limits — окна `five_hour` / `seven_day` из `rate_limit_event` (`src/shared/agent/events.ts:364`), на них стоят Autopilot (`src/shared/autopilot/budget.ts`, `resume-at.ts`, `journal.ts`) и Resource Planner;
  - Harness ставится командами `claude plugin` (`src/main/harness/install.ts:10`);
  - 15 файлов `src` импортируют `@anthropic-ai/claude-agent-sdk`, значения — 4 из них.
- Skills: research для research-Ticket-ов, grilling + domain-modeling для grilling-Ticket-ов, prototype для prototype-Ticket-ов. Документы — по-русски, термины латиницей. Ответы research-Ticket-ов пишутся в раздел `## Answer` самого Ticket-а с источниками (как в карте Flight Recorder), отдельных веток `research/*` нет.

## Decisions so far

- [01 — Destination, Vendor, масштаб](issues/01-destination-vendor-масштаб.md): spec + ADR как финиш; Codex CLI по подписке; Vendor у Session; первый выпуск — чат; две реализации границы, третья на бумаге; API-ключей нет и не будет.

- [02 — Codex: как worfy ведёт Session](issues/02-codex-управление-сессией.md): через `codex app-server` (JSON-RPC по stdio) — единственный путь с approval-запросами, сообщением во время хода, interrupt, resume и входом по подписке; протокол experimental, без обещания совместимости — версия Codex закрепляется; разрешения — approval policy + sandbox, не по tool-ам.
- [03 — Codex: Limits подписки](issues/03-codex-limits.md): до двух окон (`primary` / `secondary`) с `used_percent`, `window_minutes`, `resets_at`, набор окон зависит от плана; событие `account/rateLimits/updated` и запрос `account/rateLimits/read` без вызова модели; конец лимита — ошибка хода `usageLimitExceeded` без ожидания; бюджету Wave хватает, прогнозу Resource Planner — частично.
- [04 — Codex: расширения, на которых стоит Harness](issues/04-codex-расширения-для-harness.md): Codex читает plugin-ы формата Claude (`.claude-plugin`, skills, `hooks/hooks.json`, `.mcp.json`); hooks есть, но без `TaskCompleted` / `TeammateIdle` (gate — на `Stop`), а доверие к hook-ам plugin-а привязано к hash всей папки — любое обновление Harness выключает его hook-и до подтверждения пользователем; MCP только stdio / HTTP, in-process нет; Subagent-ы не из plugin-а и без read-only.
- [05 — Codex: транскрипты и Session-ы вне worfy](issues/05-codex-транскрипты.md): JSONL на Session в `~/.codex/sessions/ГГГГ/ММ/ДД/`, Subagent-ы — отдельные файлы со ссылкой на родителя, Project — только по `cwd`; формат не документирован и меняется — читать через `thread/list` / `thread/read` app-server, а не файлы.
- [06 — Граница Vendor-а](issues/06-граница-vendor.md): своя нейтральная модель worfy (`AgentEvent` уже есть), driver на Vendor-а в `src/main/vendors/<id>/` из частей capabilities, session, account, limits, history, commands, mcp, oneShot; Codex — через `codex app-server` с закреплённым бинарником и сгенерированными типами; SDK Claude импортирует только `src/main/vendors/claude/` (contract test); ADR-0094 отменяет `.scratch/worfy-mvp/spec.md:120`. Решил Orchestrator по поручению владельца, подтвердить при приёмке.
- [07 — Что получает Session на Codex](issues/07-что-получает-codex.md): первый выпуск — чат (выбор Vendor-а, очередь и steer, interrupt, resume, пикеры, presets, approval-ы, slash-меню, Node Session, Limits, onboarding, поиск); второй — MCP worfy по HTTP, Subagent-ы, Harness, Autopilot, Flight Recorder, Binding; недоступное показано недоступным с причиной, эмуляции нет. Решил Orchestrator по поручению владельца, подтвердить при приёмке.
- [08 — Harness для Codex](issues/08-harness-для-codex.md): один источник `harness/`, установка через локальный marketplace Codex, TOML агентов при установке, gate на `Stop`, шаг подтверждения hook-ов после каждой установки и отказ preflight Autopilot без него; read-only reviewer — только после test-а. Решил Orchestrator по поручению владельца, подтвердить при приёмке.
- [09 — Limits, Autopilot и Resource Planner при двух Vendor-ах](issues/09-limits-и-autopilot-по-vendor.md): Limits — список окон по Vendor-у, раздел на Vendor-а в панели; budget и прогноз — по Vendor-у Orchestrator-а Run; `usageLimitExceeded` с исчерпанным окном — ожидание сброса, без него — остановка без ожидания; термин Limits в `CONTEXT.md` переопределён. Решил Orchestrator по поручению владельца, подтвердить при приёмке.

## Not yet specified

- Третий Vendor на бумаге (Gemini CLI, OpenCode) против границы ADR-0094 — Ticket 10.
- Остальное, что стояло здесь, разобрано решениями 06–09 и [spec.md](spec.md): MCP вне процесса (только для Codex, второй выпуск), фейк и compatibility suite Codex, onboarding, вид Vendor-а в интерфейсе, Vendor по умолчанию Project-а, Windows (Codex native), страницы `docs/features`.

## Out of scope

- API-ключи любого Vendor-а (OpenAI API, Anthropic API, OpenRouter): вход только по подписке. Слово владельца 2026-11-02: «под апи-ключи поддержки не планируется».
- Реализация третьего Vendor-а (Gemini CLI, OpenCode и другие): эта карта проверяет его только на бумаге; реализация — отдельное решение после выпуска Codex.
- Terminal AI на Codex, смешанные Vendor-ы по ролям агентов (связь с вариантом G `worfy-reliability`) и Link ко второй Machine с Codex: решение 07 — после этого Epic-а, отдельными решениями.
- Продолжить Run на другом Vendor-е, когда окно кончилось: нужны сначала смешанные Vendor-ы по ролям агентов (Orchestrator и Wave на разных Vendor-ах), а их нет и в этом Epic-е; отдельная идея на потом (решение 09).
