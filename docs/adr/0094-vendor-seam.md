# 0094 — Граница Vendor-а: свой driver на Vendor, нейтральная модель worfy, Codex через app-server
Дата: 2026-11-02. Статус: принят. Epic `worfy-multi-vendor`; карта — `.scratch/worfy-multi-vendor/map.md`, решения
06–10 в её Ticket-ах; spec — `.scratch/worfy-multi-vendor/spec.md`. Решения 06–09 принял Orchestrator по поручению
владельца («да, можешь работать над этим эпиком полностью на автопилоте»); владелец 2026-11-02 ответил на вопросы
Q1–Q11 к spec (раздел «Решения владельца» spec-а) — его ответы вошли сюда; остальное он подтверждает при приёмке.
Ticket 10 (третий Vendor на бумаге: Gemini CLI, OpenCode) потребовал правок account, limits и capabilities — они
вошли в п. 2.

**Контекст.** worfy ведёт Session-ы только Claude Code. Граница агента — `QueryFactory` / `QueryHandle`
(`src/main/agent/session/types.ts:39`, `:91`), но её методы — методы `Query` Agent SDK (`accountInfo`,
`setPermissionMode`, `applyFlagSettings`, `supportedCommands`), а поток — сообщения SDK. Мимо неё к SDK идут Limits probe
(`src/main/agent/limits-usage.ts:281`), черновик профиля Project (`src/main/ipc/projects.ts:90`), Terminal AI
(`src/main/terminal-ai/assist.ts:105`) и MCP-серверы `worfy-canvas` и `worfy-browser` (`createSdkMcpServer`,
`src/main/mcp/canvas-server.ts:318`, `src/main/mcp/browser-server.ts:426`). SDK импортируют 15 файлов `src`. Limits —
окна `five_hour` / `seven_day` (`src/shared/agent/limits.ts:24`), на них стоят budget Autopilot и прогноз Resource
Planner. Harness — plugin Claude Code (ADR-0019, ADR-0040).

Владелец 2026-11-02 попросил второго Vendor-а — Codex (OpenAI, вход по подписке ChatGPT) — и архитектуру, куда
третий добавляется новой реализацией границы, а не правкой всего приложения (Ticket 01 карты). У Codex свой протокол
(app-server, JSON-RPC по stdio), свой набор окон Limits по плану, своё хранение истории и свой механизм доверия к
hook-ам (Ticket-ы 02–05).

При этом своя модель событий у worfy уже есть: `AgentEvent` (`src/shared/agent/events.ts:67`). Renderer не видит
ни одного сообщения SDK — main переводит их функцией `sdkMessageToEvents` (`events.ts:645`).

**Решение.**

1. **Нейтральная модель worfy.** Остальной worfy говорит только в типах worfy: `AgentEvent`, записи транскрипта
   (`src/shared/transcript`), `LimitWindow`, capabilities. Каждый Vendor переводится в них своим адаптером. Перевод
   сообщений Agent SDK живёт в `src/shared/vendors/claude/events.ts`: чистый модуль без импорта SDK, в shared —
   потому что разбор транскриптов Claude (`src/shared/transcript/parse.ts`) зовёт его helper-ы.
2. **Driver на каждого Vendor-а** в `src/main/vendors/<id>/`. Части:
   - **capabilities** — статическое описание плюс описание по версии: Subagent-ы, hook-и, MCP в процессе, steer во
     время хода, resume, список Session-ов (`historyList`), стабильная смена Model, `oneShot` без tool-ов, полнота
     slash-команд, источник Limits (`windows`, `errorOnly`, `none`), permission presets (список вариантов самого
     Vendor-а с подписями), уровни effort. Интерфейс читает только эти флаги, проверок `vendor === 'claude'` нет.
   - **session** — `start(opts)` и `resume(id)` дают SessionHandle: `send(message)` (в очередь или steer, если
     capability есть), `interrupt()`, `close()`, `setModel()`, `setEffort()`, `setPermissionPreset()`,
     `events: AsyncIterable<AgentEvent>`. Запрос подтверждения — одно событие `permission_request`, варианты ответа
     даёт Vendor; в него переводятся `canUseTool` Claude и approval-ы Codex на команду и правку файлов.
   - **account** — `check()` даёт список подключений `{provider, signedIn, email, plan}` (у Claude и Codex — одно;
     у Vendor-а вроде OpenCode — несколько). `startLogin()` даёт один из трёх результатов: `{url}` — worfy открывает
     URL (Codex); `{vendorOpensBrowser}` — Vendor открывает браузер сам; `{terminal}` — вход только в TUI Vendor-а.
     Токены — в домашней папке Vendor-а (`~/.claude`, `~/.codex`); ADR-0009 в силе.
   - **limits** — `read()` даёт `LimitWindow[]` `{vendor, provider?, id, label, usedPercent, windowMinutes,
     resetsAt, state}`; `usedPercent`, `windowMinutes` и `resetsAt` могут быть `null` (не известно); `state` — `ok`,
     `warning`, `reached` или `null`. Обновления — событием `limits`; отказ по лимиту — нейтральным событием
     `limit_reached` с причиной `window` (есть окно и сброс — можно ждать) или `quota` (ждать нечего). `five_hour` и
     `seven_day` Claude — два окна списка, `allowed_warning` — `warning`.
   - **history** — `list(cwd)` и `read(id)` дают записи транскрипта worfy. Claude читает свои JSONL; Codex —
     `thread/list` / `thread/read` app-server, а не rollout-файлы.
   - **commands** — список slash-меню.
   - **mcp** — как MCP-серверы worfy доходят до агента. Claude — SDK-сервер в процессе, как сейчас. Codex —
     streamable-HTTP MCP endpoint worfy main на `127.0.0.1` с token-ом на Session — в первом выпуске (владелец, Q1).
   - **oneShot(prompt, opts)** — разовый запрос: Terminal AI и Limits probe — без tool-ов; черновик профиля Project
     — с read-only tool-ами и structured output через `opts`, как сейчас.
3. **Codex — через `codex app-server`.** worfy поставляет закреплённую версию бинарника Codex (Apache-2.0,
   npm-сборки по платформам), как ADR-0008 поставляет native binary Claude. Типы протокола генерируются для этой
   версии (`codex app-server generate-ts`) и лежат в репозитории. Experimental-методов по возможности нет.
   Compatibility suite — по каждой версии Codex. Один процесс app-server на Session.
4. **Только `src/main/vendors/claude/` импортирует `@anthropic-ai/claude-agent-sdk`.** `SessionRegistry`, first-run,
   черновик профиля, Limits probe, Terminal AI и MCP-серверы идут через driver. Contract test держит правило, как
   `test/contract/harness-node-only.test.ts` держит своё.
5. **Harness на Codex — тот же `harness/`** (решение 08): установка через локальный marketplace Codex, TOML агентов
   `worfy-implementer`, `worfy-reviewer`, `worfy-scout` при установке — только в `~/.codex/agents/` пользователя (в
   папку Project-а worfy не пишет, ADR-0005), зависимость `mattpocock-skills` — отдельным plugin-ом.
6. **Гарантии workflow на Codex — те же, что на Claude** (владелец, Q5: «нужен полный функционал неизменный от
   выбора вендора что бы сохранить поведение ворфи»). Ничего не остаётся «только советом»:

   | Гарантия | Claude | Codex |
   |---|---|---|
   | gate до конца работы | `TaskCompleted`, `TeammateIdle`, `Stop` | `Stop` и `SubagentStop` блокируют конец хода, пока gate красный; `TeammateIdle` охранять нечего — agent teams у Codex нет |
   | read-only reviewer и scout | список `tools` агента без `Edit` / `Write`; `Bash` есть | `PreToolUse` отказывает в `apply_patch` по `agent_type`, shell разрешён; если закреплённая версия не даёт `agent_type` — отдельный thread Codex с sandbox `read-only` |
   | guard Bash и записи | `PreToolUse` `guard.mjs` | тот же `guard.mjs` с matcher-ами Codex; ввод в открытую exec Session (его hook не видит) для агентов Harness запрещён |
   | verdict-ы review | скрипты `bin/` и `gh` | те же; `GH_TOKEN` — env процесса app-server, если `SessionStart` не может его выставить |
   | правила в начале Session и Subagent-а | `SessionStart`, `SubagentStart` | те же события |
   | учёт Session | `SessionEnd` | `SessionEnd` не дольше 3 s: долгие шаги — в следующий `SessionStart` |

   Паритет — ровно те гарантии, что у Claude сейчас, не строже. Каждую доказывает parity suite: сценарий на фейке
   app-server, который исполняет hook-и по правилам Codex, сверяется с таблицей гарантий; каждая строка называет
   test, который доказывает ту же гарантию у Claude. Фейк Claude hook-и не исполняет. Run Autopilot на Codex без этого suite не начинается.
   «Недоступно с причиной» остаётся только для функций интерфейса, которых у Codex действительно нет (владелец, Q2).
7. **ACP** (Agent Client Protocol) — не замена границы: он годится как общая реализация частей session,
   `permission_request`, commands и mcp для третьего Vendor-а и дальше (Ticket 10), но не даёт Limits подписки,
   плана аккаунта и MCP в процессе. Claude и Codex — свои driver-ы.

**Что отменяет.** `.scratch/worfy-mvp/spec.md:120` выносил «Другие провайдеры моделей (Codex, OpenRouter, Grok)» за
рамки. Codex теперь в рамках; OpenRouter и любой вход по API-ключу — по-прежнему нет (Ticket 01, п. 8). Grok и другие
— третий Vendor, отдельное решение после Codex.

**Последствия.**

- Слой Session (`src/main/agent/session.ts`) перестаёт читать сообщения SDK: он получает `AgentEvent` от
  SessionHandle. Перевод SDK → `AgentEvent` и `canUseTool` → `permission_request` живут в driver Claude.
- Limits — список окон с Vendor-ом. Budget Autopilot и прогноз Resource Planner берут окна Vendor-а Orchestrator-а
  Run (решение 09).
- В приложении два бинарника агентов; размер сборки растёт на бинарник Codex платформы.
- Codex добавляет Vendor-а, которого нельзя проверить в CI живьём: test-ы идут на фейке app-server
  (`WORFY_CODEX=fake`), живой Codex — только при приёмке владельцем.
- Гарантии Harness на Codex держатся другими механизмами (п. 6), и эти механизмы зависят от поведения hook-ов
  Codex. Фейк app-server повторяет его по исходникам закреплённой версии; живой Codex проверяет приёмка владельца.
- Hook-и после обновления Harness выключены в Codex, пока пользователь не подтвердит их в `/hooks` (риск 3); Run
  Autopilot на Codex в это время не начинается.

**Риски.**

1. **Условия OpenAI неизвестны.** Документация не разрешает и не запрещает стороннему desktop-приложению вести Codex
   по подписке ChatGPT. Codex открыт, app-server существует для IDE-клиентов. Проверить заново перед публичным
   выпуском.
2. **app-server — experimental**, без обещания совместимости между версиями; выпуски — 1–2 раза в неделю. Ответ:
   закреплённая версия, сгенерированные типы, compatibility suite на каждую версию, без experimental-методов.
3. **Доверие к hook-ам — hash всей папки plugin-а.** Любое обновление Harness выключает его hook-и в Codex до
   подтверждения пользователем. Ответ: шаг «Approve the Harness hooks in Codex» после каждой установки и обновления;
   preflight Autopilot не начинает Run на Codex без него и называет причину.

## Considered Options

- **Перевести Codex в форму сообщений Agent SDK, остальной worfy не трогать.** Отклонено: у Codex другая модель
  item-ов, approval-ов и окон; пришлось бы подделывать `tool_use`, permission mode и `five_hour` / `seven_day`;
  третий Vendor тоже оказался бы в форме Claude; изменения experimental-протокола расползлись бы по приложению.
- **TypeScript SDK `@openai/codex-sdk` или `codex exec --json`.** Отклонено (Ticket 02): процесс на каждый ход, нет
  callback-а подтверждения, steer, account и Limits.
- **Читать rollout-файлы Codex напрямую, как JSONL Claude.** Отклонено (Ticket 05): формат не документирован, файлы
  сжимаются в `.jsonl.zst`, есть paginated-режим; поддерживаемый контракт — `thread/list` / `thread/read`.
- **Один процесс app-server на все Session-ы.** Отложено: изоляция падений и память не проверены; процесс на
  Session повторяет модель Claude. Общий процесс — оптимизация на потом.
- **`dynamicTools` app-server для MCP worfy в процессе.** Отклонено: метод experimental. Вместо него —
  streamable HTTP endpoint на localhost.
- **Reviewer Codex «только советует», пока read-only не доказан.** Отклонено владельцем (Q5): гарантии workflow не
  зависят от Vendor-а.
- **TOML агентов в `.codex/agents/` Project-а.** Отклонено: worfy не пишет своё состояние в репозиторий (ADR-0005).
- **ACP вместо своей границы.** Отклонено (Ticket 10): ACP не даёт Limits подписки и плана аккаунта.
- **Отдельный Harness для Codex.** Отклонено (решение 08): Codex читает формат Claude, два Harness разошлись бы.

## Amendments

- 2026-11-06 — риск 1 проверен заново (Ticket `worfy-multi-vendor` 43, PR #1492). Условия OpenAI не молчат: документация
  app-server (<https://learn.chatgpt.com/docs/app-server>, раздел «Auth endpoints», по снимкам Wayback Machine
  текст на странице с конца сентября 2026) разрешает локальному или open-source приложению вести Codex по входу ChatGPT через app-server
  («If you've built a local or open-source application using Codex app-server authentication, you can continue
  using it») и запрещает это коммерческому или серверному сервису («App-server authentication has never been
  permitted for commercial or hosted services»); OpenAI советует перейти на Sign in with ChatGPT. Решение
  владельца 2026-11-06: worfy ведёт Codex по подписке, пока остаётся бесплатным локальным приложением; платная или
  серверная версия — только после одобрения OpenAI (форма для партнёров). Переход на Sign in with ChatGPT не
  обязателен; к нему возвращаемся перед публичным выпуском, Ticket-а нет.
- 2026-11-08 — пункт 5, «зависимость `mattpocock-skills` — отдельным plugin-ом»: зависимости больше нет, Codex получает
  эти skills внутри того же plugin-а `worfy` (Epic `worfy-skills`, решение владельца 2026-11-07). Подробно — поправка
  [ADR-0059](0059-installer-installs-plugin-dependencies.md#amendments).
