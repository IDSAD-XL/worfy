# 04 — Codex: расширения, на которых стоит Harness

Type: research
Status: open
Blocked by:
Source: [map.md](../map.md), Ticket 01

## Question

Чем Codex расширяется и что из этого покрывает Harness, который сейчас — plugin Claude Code (`harness/`: `hooks/hooks.json`, skills, agents, `bin`; ставится `claude plugin`, ADR-0019/0040): файлы инструкций (`AGENTS.md`, глобальный и проектный), skills, пользовательские команды и prompts, hooks или `notify` (какие события, может ли hook отказать в действии, как Stop/TaskCompleted gate), Subagent-ы или параллельные агенты, MCP (stdio, HTTP; можно ли подать MCP-сервер из процесса worfy, как `createSdkMcpServer`), профили и конфиг (`~/.codex/config.toml`), plugin или marketplace для доставки. Для каждой части Harness — есть ли у Codex аналог, частичный аналог или нет.
