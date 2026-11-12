# 11 — Spike: connector-ы claude.ai не стартуют в Session worfy даже после Restart

Type: spike
Status: done 2026-11-12T22:29Z
PR: #1844
Blocked by: none
Source: владелец 2026-11-12 Q4 («spike, только если Restart не помогает») и Q11 («не помог») — живая проверка на
Stable 802d79536: четыре connector-а claude.ai разрешены в Project, после «Restart Session with the same conversation»
все четыре по-прежнему «not started»

Кто: агент — чтение SDK и бинарника Claude Code, сценарий в sandbox без входа и без вызова модели. Владелец — одна
живая проверка по шагам заметки, если сценарий без входа ответа не даёт.

## Что происходит

- Connector-ы claude.ai (источник `claudeai`) видны в инвентаре Project-а и разрешены в Profile (`mcp.allowed`,
  ADR-0021), но Session worfy их не запускает: строка «not started» остаётся и после Restart с тем же разговором.
- Остальные серверы (plugin, user config, собственные серверы worfy) после Allow и Restart запускаются.
- Заметка spike 01 (`.scratch/worfy-mcp-live/spike-mcp-live.md`, «Живая проверка connector-а claude.ai») этот путь не
  проверяла: в sandbox без входа connector-ов не видно.

## Вопросы spike-а

1. Запускает ли Claude Code connector-ы claude.ai в Session, которую поднимает SDK (`query()`), а не интерактивный
   CLI? Какое условие для этого нужно: флаг или настройка SDK, переменная окружения, вид входа (подписка claude.ai
   против других), `strictMcpConfig`, managed settings `allowManagedMcpServersOnly`?
2. Не отрезает ли их сам worfy: как allowlist Profile-а превращается в `allowedMcpServers`/`deniedMcpServers` и
   совпадает ли имя, которое worfy пишет (`claude.ai Atlassian`), с тем, по которому Claude Code их сверяет?
3. Что нужно изменить в worfy, чтобы разрешённый connector стартовал после Restart, — или, если это невозможно в SDK
   Session, что показать в строке вместо «not started» (честная причина и ссылка), и стоит ли Restart вообще
   предлагать для таких строк.

## Готово, когда

- [ ] Заметка `.scratch/worfy-mcp-live/spike-claudeai-connectors.md`: ответ на каждый вопрос, как проверено (чтение
      SDK и бинарника, сценарий в sandbox), выбранный путь и запасной путь.
  - evidence: test-run pass · `node scripts/spikes/harness-plugin/connector-name.mjs` exit 0 · mac - · 38da81449f86c0ce916db6bc5a44e6cecfc6bab6
  - evidence: test-run pass · `node scripts/spikes/harness-plugin/connector-name.mjs` exit 0 · mac - · 8982db2ff4a3f8b925524f1b7233214e20c07932
- [ ] Если ответ требует живой проверки — шаги для владельца в заметке (10 минут, без настоящих изменений профиля) и
      место для итога.
  - evidence: commit pass · Spike: claude.ai connectors not started in a worfy Session (worfy-mcp-live 11) · - - · 38da81449f86c0ce916db6bc5a44e6cecfc6bab6
- [ ] Предложение следующего Ticket-а (исправление или честная строка) — в заметке; Ticket заводит Orchestrator.
  - evidence: commit pass · Spike: claude.ai connectors not started in a worfy Session (worfy-mcp-live 11) · - - · 38da81449f86c0ce916db6bc5a44e6cecfc6bab6
- [ ] Настоящие настройки не изменились: `~/.claude.json`, `~/.claude/settings.json` и Profile-ы — fingerprint до и
      после совпадает. Тесты и сценарии — только с временным HOME.
- [ ] lint и gate fast — exit 0.
  - evidence: ci-check pass · CI green on PR #1844 (ci-ok, e2e jobs included) · mac - · b8067cf750fb81d5cdc321d53c4d568b95677b6d

## Где в коде

- `src/main/vendors/claude/options.ts` — `allowed()`, `allowedMcpServers`/`deniedMcpServers`, серверы worfy и Harness.
- `src/main/vendors/claude/mcp.ts` — инвентарь, строки статуса, «not started».
- `src/shared/agent/mcp-status.ts` — источник `claudeai`.
- `scripts/spikes/harness-plugin/probe.ts` — сценарий `mcp-live` из spike 01.

## Вне скоупа

- Вид списка серверов — Ticket 10.
