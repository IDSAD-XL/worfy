# 01 — ADR Assistant-а: Session приложения, `worfy-app`, шесть границ, закрытый список, хранение пунктов, проверка источников

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 01; «Решения по реализации» → «ADR»; «Границы»; «Волны», Wave 1

Кто: агент.

## Что строить

Новый ADR об Assistant-е — агенте worfy, по одному на машину, над всеми Project-ами этой машины. Кода нет.

## Где в коде

- `docs/adr/` — новый ADR; номер резервирует implementer при claim.
- Только читать: [ADR-0105](../../../docs/adr/0105-pr-reply-only-on-the-users-click.md) (ответ в PR — только по
  щелчку пользователя), [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md) (процесс Terminal AI),
  [ADR-0066](../../../docs/adr/0066-read-only-access-for-a-linked-machine.md) (Linked machine только читает),
  [ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md) (allowlist MCP-серверов, «Prompt is too
  long» у Haiku), `.scratch/worfy-retry/spec.md` (решение 3 «Повтор только у Orchestrator-а»).

## Решения

- Что записать в ADR (spec, «ADR»):
  - Assistant — Session приложения;
  - MCP-сервер `worfy-app`;
  - шесть границ (spec, «Границы»);
  - закрытый список действий;
  - где хранятся пункты журнала;
  - проверка источников через connectors claude.ai одноразовым вызовом Haiku 5.5 только с read tools.
- ADR-0105 не меняется: у Assistant-а нет пути к отправке ответа в PR.
- ADR-0058 меняет Ticket worfy-polish 135, не этот.
- Решение 3 Epic-а worfy-retry («повтор только у Orchestrator-а») меняется для Session-ов на Canvas: их после сброса
  Limits продолжает Assistant по режиму обязанности (Ticket 08).

## Test-ы

Кода нет — test-ов нет.

## Готово, когда

- [ ] Новый ADR в `docs/adr/` записывает: Assistant — Session приложения; `worfy-app`; шесть границ; закрытый список
      действий; где хранятся пункты; проверку источников через connectors claude.ai одноразовым вызовом Haiku 5.5 только
      с read tools.
- [ ] ADR называет, что ADR-0105 не меняется, а решение 3 worfy-retry меняется для Session-ов на Canvas (Ticket 08).
- [ ] ADR-0105 в diff-е PR не правится.
- [ ] `ci-ok` зелёный на head PR.
