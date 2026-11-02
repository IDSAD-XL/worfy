# 0094 — Граница Vendor-а: свой driver на Vendor, нейтральная модель worfy, Codex через app-server
Дата: 2026-11-02. Статус: принят. Epic `worfy-multi-vendor`; карта — `.scratch/worfy-multi-vendor/map.md`, решения
06–09 в её Ticket-ах; spec — `.scratch/worfy-multi-vendor/spec.md`. Решил Orchestrator по поручению владельца
(«да, можешь работать над этим эпиком полностью на автопилоте»); владелец подтверждает при приёмке.

**Контекст.** worfy ведёт Session-ы только Claude Code. Граница агента — `QueryFactory` / `QueryHandle`
(`src/main/agent/session/types.ts:39`, `:91`), но её методы — методы `Query` Agent SDK (`accountInfo`,
`setPermissionMode`, `applyFlagSettings`, `supportedCommands`), а поток — сообщения SDK. Мимо неё к SDK идут проба
Limits (`src/main/agent/limits-usage.ts:281`), черновик профиля Project (`src/main/ipc/projects.ts:90`), Terminal AI
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
   (`src/shared/transcript`), `LimitWindow`, capabilities. Каждый Vendor переводится в них своим адаптером.
2. **Driver на каждого Vendor-а** в `src/main/vendors/<id>/`. Части:
   - **capabilities** — статическое описание плюс описание по версии: Subagent-ы, hook-и, MCP в процессе, steer во
     время хода, permission presets (список вариантов самого Vendor-а с подписями), уровни effort, slash-команды,
     окна Limits, resume. Интерфейс читает только эти флаги, проверок `vendor === 'claude'` нет.
   - **session** — `start(opts)` и `resume(id)` дают SessionHandle: `send(message)` (в очередь или steer, если
     capability есть), `interrupt()`, `close()`, `setModel()`, `setEffort()`, `setPermissionPreset()`,
     `events: AsyncIterable<AgentEvent>`. Запрос подтверждения — одно событие `permission_request`, варианты ответа
     даёт Vendor; в него переводятся `canUseTool` Claude и approval-ы Codex на команду и правку файлов.
   - **account** — `check()` (вход, план) и `startLogin()`, который открывает URL Vendor-а. Токены — в домашней
     папке Vendor-а (`~/.claude`, `~/.codex`); ADR-0009 в силе.
   - **limits** — `read()` даёт `LimitWindow[]` `{vendor, id, label, usedPercent, windowMinutes, resetsAt}`, плюс
     обновления событиями. `five_hour` и `seven_day` Claude — два окна списка.
   - **history** — `list(cwd)` и `read(id)` дают записи транскрипта worfy. Claude читает свои JSONL; Codex —
     `thread/list` / `thread/read` app-server, а не rollout-файлы.
   - **commands** — список slash-меню.
   - **mcp** — как MCP-серверы worfy доходят до агента. Claude — SDK-сервер в процессе, как сейчас. Codex —
     streamable-HTTP MCP endpoint worfy main на localhost с token-ом на Session (второй выпуск).
   - **oneShot(prompt, opts)** — разовый запрос без tool-ов: черновик профиля Project, Terminal AI, проба Limits.
3. **Codex — через `codex app-server`.** worfy поставляет закреплённую версию бинарника Codex (Apache-2.0,
   npm-сборки по платформам), как ADR-0008 поставляет native binary Claude. Типы протокола генерируются для этой
   версии (`codex app-server generate-ts`) и лежат в репозитории. Experimental-методов по возможности нет.
   Compatibility suite — по каждой версии Codex. Один процесс app-server на Session.
4. **Только `src/main/vendors/claude/` импортирует `@anthropic-ai/claude-agent-sdk`.** `SessionRegistry`, first-run,
   черновик профиля, проба Limits, Terminal AI и MCP-серверы идут через driver. Contract test держит правило, как
   `test/contract/harness-node-only.test.ts` держит своё.
5. **Harness на Codex — тот же `harness/`** (решение 08): установка через локальный marketplace Codex, TOML агентов
   при установке, gate на `Stop`. Правила Harness, которые Codex не исполняет, — в «Последствиях».

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
- **Harness на Codex — not enforced on Codex:**
  - gate на `TaskCompleted` и `TeammateIdle` — таких событий у Codex нет; gate идёт на `Stop` и не отказывает в
    действии, а продолжает ход;
  - read-only reviewer и scout — пока test не доказал отказ `PreToolUse` по `agent_type`, reviewer Codex только
    советует, условие merge — verdict gate;
  - зависимость plugin-а от `mattpocock-skills` — у Codex нет зависимостей plugin-ов;
  - `SessionEnd` дольше 3 s — у Codex потолок 3 s;
  - hook-и после обновления Harness — выключены, пока пользователь не подтвердит их в `/hooks` (ниже, риск 3).

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
- **`dynamicTools` app-server для MCP worfy в процессе.** Отклонено на первый выпуск: метод experimental. Второй
  выпуск — streamable HTTP endpoint на localhost.
- **Отдельный Harness для Codex.** Отклонено (решение 08): Codex читает формат Claude, два Harness разошлись бы.
