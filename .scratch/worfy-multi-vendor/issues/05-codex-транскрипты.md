# 05 — Codex: транскрипты и Session-ы вне worfy

Type: research
Status: open
Blocked by:
Source: [map.md](../map.md), Ticket 01

## Question

Где и в каком формате Codex хранит историю Session (`~/.codex/sessions/…`, rollout-файлы JSONL или иное), чем она отличается от транскриптов Claude Code, на которых стоят Node Session на Canvas, Subagent-ы (ADR-0030/0031/0085), поиск и Flight Recorder (`src/shared/transcript/parse.ts`, `src/main/claude-home/*`)? Можно ли по ней найти Session, запущенную в терминале, а не в worfy, связать её с папкой Project, продолжить её, увидеть дочерних агентов, если они есть? Стабилен ли формат между версиями?
