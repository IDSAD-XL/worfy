# 01 — ADR Assistant-а: Session приложения, `worfy-app`, шесть границ, закрытый список, хранение пунктов, проверка источников

Type: task
Status: done 2026-11-25T08:57Z
PR: #2195
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
  - evidence: commit pass · docs: ADR 0114 — Assistant as an app Session with worfy-app and six bounds · - - · d000cc4f11c7ea2fb7dbbc6964a67be3f903c1e8
  - evidence: review pass · PR #2195 · - - · 11277da1cff7e58f989e493fea44960427459577
- [ ] ADR называет, что ADR-0105 не меняется, а решение 3 worfy-retry меняется для Session-ов на Canvas (Ticket 08).
  - evidence: commit pass · docs: ADR 0114 — Assistant as an app Session with worfy-app and six bounds · - - · d000cc4f11c7ea2fb7dbbc6964a67be3f903c1e8
  - evidence: review pass · PR #2195 · - - · 11277da1cff7e58f989e493fea44960427459577
- [ ] ADR-0105 в diff-е PR не правится.
  - evidence: test-run pass · `git diff --name-only origin/main...HEAD` exit 0, no 0105 file in the list · mac - · d000cc4f11c7ea2fb7dbbc6964a67be3f903c1e8
  - evidence: review pass · PR #2195 · - - · 11277da1cff7e58f989e493fea44960427459577
- [ ] `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45579958466/job/139089488588 · ci - · 11277da1cff7e58f989e493fea44960427459577
