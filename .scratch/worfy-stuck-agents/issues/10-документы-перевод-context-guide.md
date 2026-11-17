# 10 — Документы: переводы страниц Feature, термины CONTEXT.md, тексты Guide

Type: task
Status: open
Blocked by: 02, 04, 05, 06, 07, 09
Source: [spec.md](../spec.md), «Ticket-ы», 10; «Готово, когда», пункт о документах;
[critic](../../../docs/product/critic/worfy-stuck-agents-2026-11-14.md), возражение 3; «Решено без владельца», 1 и 11

Кто: агент.

Не платформенный Ticket (документы и тексты Guide). Глубина ревью — `low`.

## Что происходит

- Английские страницы Feature правят Ticket-ы своего поведения (правило `ship-ticket` и ADR-0088): `gate-and-github.md`
  (02), `sessions.md` (04, 06), `autopilot.md` и `autopilot-faults.md` (05, 09), `skills-agents-and-hooks.md` (07).
  Перевод в PR с поведением не считается (`profile --rules`, раздел «Язык»), поэтому `docs/features/ru/` отстаёт.
- В CONTEXT.md нет слов для продолжения застрявшего Ticket-а, отложенного Ticket-а и хода без признаков жизни. Рядом
  стоят Auto-continue (повтор после ошибки API и Limits — другое) и Silent mode (режим Project-а — другое).
- Guide называет `wave-unfinished` и `background-stalled` как конец Run-а:
  `src/renderer/guide/topics/autopilot/en.json:104`, `ru.json:104`.

## Что делаем

1. `docs/features/ru/`: `gate-and-github.md`, `sessions.md`, `autopilot.md`, `autopilot-faults.md`,
   `skills-agents-and-hooks.md` — переводы изменений английских страниц из PR-ов Ticket-ов 02–09.
2. CONTEXT.md, раздел Autopilot — три термина с _Avoid_:
   - **Ticket continuation** — Wave или сообщение, которым Run продолжает Ticket, оставшийся в работе; не больше двух на
     Ticket за Run; _Avoid_: Auto-continue (это повтор хода после ошибки API), retry;
   - **Set-aside Ticket** — Ticket, который Orchestrator по просьбе Run-а перевёл в `blocked` с `Waits: owner` после
     потолка продолжений;
   - **Quiet turn** — ход Session без признаков жизни дольше порога; _Avoid_: silent (Silent mode — режим Project-а),
     hung (так зовётся только причина остановки `turn-hung`).
   Строка в Relationships: Run продолжает Ticket не больше двух раз, потом откладывает.
3. Guide: строка 104 `en.json` и `ru.json` — лестница вместо немедленной остановки для `wave-unfinished`; `main-red` и
   `turn-hung`; `background-stalled` — остановка, как раньше.

## Готово, когда

- [ ] Пять страниц `docs/features/ru/` описывают то же, что их английские пары после Ticket-ов 02–09;
      `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] CONTEXT.md: термины Ticket continuation, Set-aside Ticket и Quiet turn с _Avoid_, строка в Relationships.
- [ ] Unit test Guide (существующий test текстов Guide, если он сверяет ключи en и ru): тексты `en.json` и `ru.json`
      называют лестницу, `main-red` и `turn-hung`; ключи совпадают.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `docs/features/ru/gate-and-github.md`
- `docs/features/ru/sessions.md`
- `docs/features/ru/autopilot.md`
- `docs/features/ru/autopilot-faults.md`
- `docs/features/ru/skills-agents-and-hooks.md`
- `CONTEXT.md`
- `src/renderer/guide/topics/autopilot/en.json`
- `src/renderer/guide/topics/autopilot/ru.json`

Только читать: английские страницы `docs/features/` и `docs/adr/0024-…` с Amendment-ом Ticket-а 05.

## Вне скоупа

- Английские страницы и Amendment-ы ADR — в Ticket-ах своего поведения.
