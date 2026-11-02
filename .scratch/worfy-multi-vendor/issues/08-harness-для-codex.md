# 08 — Harness для Codex: один источник или два

Type: grilling
Status: open
Blocked by: 04, 06
Source: [map.md](../map.md), Ticket 01

## Question

Как Harness (skills, hooks, agents, правила, `bin`, gate) доходит до Session на Codex: один источник в `harness/` и сборка под каждого Vendor-а, отдельный Harness для Codex или только общее ядро (`bin`, gate, правила в `AGENTS.md`) без hooks и Subagent-ов? Какие обещания Harness (gate на Stop, запрет записи в `~/.claude`, review-агенты) без hooks Codex перестают выполняться и чем это закрывается? Как Install Harness ставит его в Codex и как проверяется версия (аналог `claude plugin list`)?
