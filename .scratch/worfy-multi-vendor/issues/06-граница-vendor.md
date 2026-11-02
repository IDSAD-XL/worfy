# 06 — Граница Vendor-а: своя модель событий или адаптер под форму Claude

Type: grilling
Status: open
Blocked by: 02, 03, 05
Source: [map.md](../map.md), Ticket 01

## Question

Какой интерфейс реализует каждый Vendor и в каких типах он говорит с остальным worfy? Варианты: (а) своя нейтральная модель событий и возможностей worfy, Claude Code и Codex переводятся в неё адаптерами; (б) Codex переводится в форму сообщений Agent SDK, остальной worfy не меняется. Что входит в границу помимо хода Session: проверка входа, Limits, транскрипты на диске, MCP-серверы worfy, Terminal AI, черновик профиля Project? Как граница сообщает, чего Vendor не умеет (capabilities)? Итог — ADR, который заодно отменяет `.scratch/worfy-mvp/spec.md:120`.
