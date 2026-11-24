# 09 — Документация Acceptance: страница Feature en и ru, правки соседних страниц, термин в CONTEXT.md, инвентарь ADR-0005

Type: task
Status: claimed 2026-11-24T06:29Z
Blocked by: 06, 07, 08
Source: [spec.md](../spec.md), «Ticket-ы», 9; «Решения по реализации» → «ADR не нужен новый», «Термин в CONTEXT.md»

Кто: агент.

Не платформенный Ticket (документы). Глубина ревью — `low`.

## Что происходит

- После Ticket-ов 01–08 английская страница `docs/features/acceptance.md` описывает правило, Stable copy и вид; страницы
  `projects.md`, `evidence.md`, `app-shell.md`, `notifications.md`, `link.md`, `workflow.md` получили свои абзацы.
  Переводов нет.
- Термина Acceptance в `CONTEXT.md` нет; хранилище «Sent» не записано в инвентарь состояния worfy
  (`docs/adr/0005-worfy-own-state-inventory.md`).

## Что делаем

1. `docs/features/acceptance.md`: проверить по коду на `main`, свести разделы в один текст.
2. `docs/features/ru/acceptance.md` и переводы правленых страниц в `docs/features/ru/`.
3. `CONTEXT.md`: **Acceptance** — вид ручных пунктов Ticket-ов всех Project-ов Machine, которые ждут проверки владельца,
   с их Evidence и Stable copy; решение Pass или Fail уходит Orchestrator-у. _Avoid_: приёмка (как имя вида), review
   queue, inbox.
4. Поправка инвентаря ADR-0005: хранилище «Sent» в папке данных Project-а.

## Готово, когда

- [ ] `docs/features/acceptance.md` и `docs/features/ru/acceptance.md` есть; переводы правленых страниц совпадают с
      английскими; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0, `node scripts/feature-docs-lag.mjs` lists none of the 7 pages · mac - · 6ae595c792d3b22622616e74b303d9149b4fda72
- [ ] Термин Acceptance в `CONTEXT.md`; поправка в `docs/adr/0005-worfy-own-state-inventory.md`.
  - evidence: commit pass · worfy-acceptance/09: Acceptance docs in English and Russian, the term in CONTEXT.md, the Sent store in ADR-0005 · - - · 6ae595c792d3b22622616e74b303d9149b4fda72
- [ ] `pnpm lint` (с `evidence-check`) — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `docs/features/acceptance.md`, `docs/features/ru/acceptance.md` (новый)
- `docs/features/ru/projects.md`, `docs/features/ru/evidence.md`, `docs/features/ru/app-shell.md`,
  `docs/features/ru/notifications.md`, `docs/features/ru/link.md`, `docs/features/ru/workflow.md`
- `CONTEXT.md`, `docs/adr/0005-worfy-own-state-inventory.md`

## Вне скоупа

- Новый ADR: worfy только читает Ticket-ы и отправляет текст по клику владельца (ADR-0002).
