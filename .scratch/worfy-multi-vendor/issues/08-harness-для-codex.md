# 08 — Harness для Codex: один источник или два

Type: grilling
Status: done 2026-11-02
Blocked by: 04, 06
Source: [map.md](../map.md), Ticket 01

## Question

Как Harness (skills, hooks, agents, правила, `bin`, gate) доходит до Session на Codex: один источник в `harness/` и сборка под каждого Vendor-а, отдельный Harness для Codex или только общее ядро (`bin`, gate, правила в `AGENTS.md`) без hooks и Subagent-ов? Какие обещания Harness (gate на Stop, запрет записи в `~/.claude`, review-агенты) без hooks Codex перестают выполняться и чем это закрывается? Как Install Harness ставит его в Codex и как проверяется версия (аналог `claude plugin list`)?

## Answer

Решено Orchestrator-ом 2026-11-02 по поручению владельца («да, можешь работать над этим эпиком полностью на автопилоте»), подтвердить при приёмке. Что Harness не обеспечивает на Codex — в [ADR-0094](../../../docs/adr/0094-vendor-seam.md); Ticket-ы — в [spec.md](../spec.md), второй выпуск.

**Один источник — `harness/`.** Codex читает plugin-ы формата Claude: `.claude-plugin/plugin.json`, skills, `hooks/hooks.json`, `.mcp.json`; `CLAUDE_PLUGIN_ROOT` выставлен (Ticket 04).
- Install Harness ставит ту же папку в Codex через его локальный marketplace, как ADR-0040 для Claude Code.
- Определения Subagent-ов генерируются при установке в TOML агентов Codex. Они ложатся в `.codex/agents/` Project-а, когда Project это разрешает, иначе в `~/.codex/agents/`. Пишет их installer, так же как он пишет plugin Claude; агенты туда не пишут.
- Gate на Codex переезжает на `Stop`: `TaskCompleted` у Codex нет.
- Доверие к hook-ам в Codex — hash всей папки plugin-а. Любое обновление Harness выключает его hook-и, пока пользователь не подтвердит их снова в `/hooks`. Поэтому worfy:
  - после каждой установки или обновления показывает шаг «Approve the Harness hooks in Codex»;
  - preflight Autopilot отказывается начинать Run на Codex, пока hook-и Harness не подтверждены, с понятной причиной и никогда молча.
- Read-only для reviewer и scout: второй выпуск пробует hook `PreToolUse`, который отказывает в правках по `agent_type`. Пока test этого не доказал, reviewer на Codex — только совет, а условием merge остаётся verdict gate.
- Проверка версии — аналог `claude plugin list` у Codex.
- Правила Harness, которым нужен hook, которого у Codex нет (`TeammateIdle`), перечислены в ADR как «not enforced on Codex».

Почему один источник: Codex уже грузит формат Claude, два Harness разошлись бы через неделю. Почему preflight, а не тихий запуск: без подтверждённых hook-ов на Codex нет ни gate на `Stop`, ни guard на `PreToolUse`, и ночной Run шёл бы без проверок, которые обещает Harness.
