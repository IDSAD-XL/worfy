# worfy показывает и запускает workflow, но не владеет его состоянием

Дата: 2026-10-05. Статус: принят.

Источник правды о работе остаётся там, где он есть без worfy: файлы Ticket-ов в `.scratch/<эпик>/issues/`, `HANDOFF.md`, ADR, скрипты `ticket` и `epic-status`, транскрипты Session-ов Claude Code, Gate и hooks из `~/.claude`. worfy читает их, следит за изменениями и меняет состояние только теми же инструментами (`ticket claim/done`, skills `/ship-ticket`, `/epic-wave`). Агенты, которых запускает worfy, работают с настоящей конфигурацией пользователя (`settingSources: user + project + local`): глобальный `CLAUDE.md`, hooks, skills, Subagent-ы и MCP-сервера действуют так же, как в терминале. Собственное состояние worfy — только Layout Canvas и Card-ы.

## Considered Options

- worfy хранит Epic-и и Ticket-ы в своей базе. Отвергнуто: workflow перестал бы работать из терминала, Claude desktop и облака, и появились бы два файла состояния, один из которых врёт.
- Агенты в worfy с изолированной конфигурацией, как в Morphy (только настройки Project). Отвергнуто: тогда worfy показывал бы не тот workflow, которым пользователь реально работает.
