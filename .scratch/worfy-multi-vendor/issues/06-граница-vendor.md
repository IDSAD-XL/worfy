# 06 — Граница Vendor-а: своя модель событий или адаптер под форму Claude

Type: grilling
Status: done 2026-11-02
Blocked by: 02, 03, 05
Source: [map.md](../map.md), Ticket 01

## Question

Какой интерфейс реализует каждый Vendor и в каких типах он говорит с остальным worfy? Варианты: (а) своя нейтральная модель событий и возможностей worfy, Claude Code и Codex переводятся в неё адаптерами; (б) Codex переводится в форму сообщений Agent SDK, остальной worfy не меняется. Что входит в границу помимо хода Session: проверка входа, Limits, транскрипты на диске, MCP-серверы worfy, Terminal AI, черновик профиля Project? Как граница сообщает, чего Vendor не умеет (capabilities)? Итог — ADR, который заодно отменяет `.scratch/worfy-mvp/spec.md:120`.

## Answer

Решено Orchestrator-ом 2026-11-02 по поручению владельца («да, можешь работать над этим эпиком полностью на автопилоте»), подтвердить при приёмке. Запись решения — [ADR-0094](../../../docs/adr/0094-vendor-seam.md); план — [spec.md](../spec.md).

**Вариант (а): своя нейтральная модель worfy.** Она уже есть: события Session `AgentEvent` (`src/shared/agent/events.ts:67`). Renderer не видит ни одного сообщения SDK: main переводит каждое функцией `sdkMessageToEvents` (`events.ts:645`). Значит, вариант (а) расширяет существующую модель, а не придумывает новую.

Почему не (б) — перевод Codex в форму сообщений Agent SDK:
- У Codex другая модель: item-ы, approval-ы, окна Limits. Форма SDK заставила бы подделывать семантику Claude: блоки `tool_use`, permission mode, окна `five_hour` / `seven_day`.
- Третий Vendor тогда тоже был бы заперт в форме Claude.
- Протокол app-server Codex — experimental (Ticket 02). Его изменения должны оставаться внутри одного адаптера.

**Граница — driver на каждого Vendor-а** в main, `src/main/vendors/<id>/`. Части:
- **capabilities** — что Vendor умеет: статическое описание плюс описание по версии. Например: Subagent-ы, hook-и, MCP в процессе, сообщение во время хода (steer), permission presets (список вариантов самого Vendor-а с подписями), уровни effort, slash-команды, окна Limits, resume. Интерфейс читает только эти флаги и нигде не проверяет `vendor === 'claude'`.
- **session** — `start(opts)` и `resume(id)` дают SessionHandle: `send(message)` (в очередь или steer во время хода, если capability есть), `interrupt()`, `close()`, `setModel()`, `setEffort()`, `setPermissionPreset()` и `events: AsyncIterable<AgentEvent>`. Запрос подтверждения — одно нейтральное событие `permission_request`, варианты ответа даёт Vendor. В него переводятся и `canUseTool` Claude, и approval-ы Codex на команду и на правку файлов.
- **account** — `check()` (вход, план) и `startLogin()`: открывает URL, который вернул Vendor. Токены остаются в домашней папке Vendor-а (`~/.claude`, `~/.codex`). ADR-0009 в силе: ключей worfy не держит.
- **limits** — `read()` даёт `LimitWindow[]` вида `{vendor, id, label, usedPercent, windowMinutes, resetsAt}`; обновления приходят и событиями. `five_hour` / `seven_day` Claude — два окна этого списка.
- **history** — `list(cwd)` и `read(id)` дают нейтральные записи транскрипта, ту модель, которую `src/shared/transcript` уже строит для renderer-а. Claude читает свои JSONL. Codex читает через `thread/list` / `thread/read` app-server, а не свои rollout-файлы.
- **commands** — список для slash-меню.
- **mcp** — как MCP-серверы worfy (`worfy-canvas`, `worfy-browser`) доходят до агента Vendor-а. Claude оставляет SDK-сервер в процессе. Codex получает их как streamable-HTTP MCP endpoint, который worfy main поднимает на localhost с token-ом на Session (второй выпуск).
- **oneShot(prompt, opts)** — разовый запрос без tool-ов: черновик профиля Project, Terminal AI, Limits probe, где нужен. Уточнено при review PR #1234: черновику профиля Project `opts` даёт read-only tool-ы и structured output, как сейчас (ADR-0094).

**Codex ведётся через `codex app-server`** — JSON-RPC по stdio.
- worfy поставляет закреплённую версию бинарника Codex (Apache-2.0, npm-сборки по платформам), как ADR-0008 поставляет native binary Claude.
- Типы протокола генерируются для этой версии (`codex app-server generate-ts`) и лежат в репозитории.
- Experimental-методов по возможности нет.
- Compatibility suite идёт по каждой версии Codex.
- Один процесс app-server на Session, как у Claude один процесс на Session. Общий процесс — оптимизация на потом, если вообще.

**Кто идёт через driver.** `SessionRegistry` и каждый прямой вызов SDK: first-run, черновик профиля Project, Limits probe (`limits-usage`), Terminal AI, MCP-серверы. `@anthropic-ai/claude-agent-sdk` импортирует только `src/main/vendors/claude/`. Это держит contract test, так же как `harness-node-only`.

**ADR** — ADR-0094 «Граница Vendor-а». Он записывает, что отменяет `.scratch/worfy-mvp/spec.md:120` («Другие провайдеры моделей (Codex, OpenRouter, Grok)» вне рамок).

**Риск, не блокирует.** Документация OpenAI не разрешает и не запрещает стороннему desktop-приложению вести Codex по подписке ChatGPT. Codex открыт, app-server существует для IDE-клиентов. Проверить заново перед публичным выпуском.
