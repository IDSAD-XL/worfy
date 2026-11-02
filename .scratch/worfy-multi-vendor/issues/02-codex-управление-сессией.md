# 02 — Codex: как worfy ведёт Session

Type: research
Status: open
Blocked by:
Source: [map.md](../map.md), Ticket 01

## Question

Через что worfy может вести Session Codex так, как сейчас ведёт Claude Code через Agent SDK (`QueryHandle`, `src/main/agent/session/types.ts:39`): TypeScript SDK Codex, `codex app-server` (JSON-RPC IDE-расширения), `codex exec --json` или что-то ещё? Для выбранного пути: поток событий (сообщения, tool calls, вывод команд, ошибки, конец хода) и его стабильность между версиями; отправка сообщения во время хода и очередь; interrupt; продолжение прежней Session (resume); смена Model и effort на ходу; режимы разрешений и запрос подтверждения у пользователя (аналог `canUseTool`); slash-команды и их список; проверка входа и данные аккаунта (аналог `accountInfo`, ADR-0009); вход по подписке ChatGPT без API-ключа; macOS и Windows; лицензия и как поставляется бинарник (аналог ADR-0008).
