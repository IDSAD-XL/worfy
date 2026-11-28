# 183 — Пауза Project-а: ничего нового не стартует, идущие turn-ы доходят до конца

Type: task
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 (тема claude-projects-parity, Q5, пункт 5д: «все да») —
[просьба Product Session](../../../docs/product/claude-projects-parity/для-orchestrator-а-polish.md), раздел 4;
[заметка темы](../../../docs/product/claude-projects-parity/research-что-уже-есть-разговор-library-удобства.md),
раздел C, строка C11.

Кто: агент. Глубина review — `high`: пауза проходит через три механизма.

## Что происходит

- Мягкая остановка есть только у Autopilot: «Stop autopilot is graceful: the run sends no new Wave»
  (`docs/features/autopilot-faults.md:77`); Orchestrator получает сообщение «take no new Tickets, finish the ones in
  work» (`docs/features/autopilot-faults.md:84-85`).
- Паузы на весь Project нет. Сами по себе в Project-е стартуют три механизма:
  - продолжение Session после перезапуска worfy (`docs/features/sessions.md:35-37`);
  - Auto-continue (`docs/features/sessions.md:341-342`);
  - Wake the Orchestrator у Assistant-а (`docs/features/assistant.md:276-278`).

## Что строить

1. Одна кнопка паузы Project-а. После неё в Project-е ничего нового не стартует, а идущие turn-ы доходят до конца.
2. Паузу проводят все три механизма: продолжение Session после перезапуска worfy, Auto-continue и Wake the Orchestrator
   у Assistant-а.
3. Снятие паузы возвращает всё как было.

## Где в коде

- `src/main/agent/live-sessions.ts`, `src/main/agent/continuity.ts` — продолжение Session после перезапуска worfy.
- `src/main/agent/orchestrator-continue.ts` — Auto-continue.
- `src/main/assistant/actions/closed-list.ts` — Wake the Orchestrator.
- `docs/features/sessions.md`, `docs/features/assistant.md` — feature pages трёх механизмов.

## Готово, когда

- [ ] На паузе Project-а продолжение Session после перезапуска worfy, Auto-continue и Wake the Orchestrator у
  Assistant-а ничего не стартуют в этом Project-е. Test на каждый из трёх механизмов, красный до правки.
- [ ] Идущий turn на паузе доходит до конца, его не обрывают. Test.
- [ ] Снятие паузы возвращает всё как было: все три механизма снова стартуют работу. Test.
- [ ] Feature pages трёх механизмов называют паузу Project-а.
- [ ] (вручную) Сделай: в Stable worfy в Project-е с идущим turn-ом нажми паузу Project-а, дождись конца turn-а,
  перезапусти worfy, потом сними паузу → Должно быть: turn дошёл до конца; на паузе ничего нового не стартовало, в том
  числе после перезапуска; после снятия паузы всё работает, как раньше. Кнопка паузы видна и понятна.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
