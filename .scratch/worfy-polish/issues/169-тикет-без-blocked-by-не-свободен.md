# 169 — Ticket без строки «Blocked by:» не считается свободным в Wave worfy

Type: bug
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 (раунд по разборам critic-ов, Q3): worfy-plan-lint отложен, его единственный
живой дефект — отдельным Ticket-ом; разбор `docs/product/critic/worfy-plan-lint-2026-11-28.md`, возражение 3.

Кто: агент. Глубина review — `medium`.

## Что происходит

- `src/shared/workflow/waves.ts:130`: `if (!ticket.blockedParsed && ticket.blockedRaw !== null) return { kind: 'unparsed', … }`.
  Ticket, у которого строки `Blocked by:` нет совсем (`blockedRaw === null`), проходит мимо этой проверки и получает
  уровень «без блокеров» — worfy ставит его в ближайшую Wave.
- Кнопка запуска отказывает уже по одному `!ticket.blockedParsed` (`src/shared/actions/render-template.ts:163`), а
  Harness (`epic-status`, `wave-brief`) такой Ticket в «ready» не ставит. Значит, Wave worfy и Wave Harness-а
  расходятся на одном и том же Ticket-е.
- Сегодня без строки `Blocked by:` — worfy-product-session 28, 30 и 31 (critic, 2026-11-28).

## Что строить

1. Ticket без строки `Blocked by:` — дефект Ticket-а того же рода, что нераспознанная строка: свой `kind` (или
   `unparsed` с понятным текстом), не уровень «без блокеров». Текст, который видит человек, называет, чего не хватает.
2. Unit test в `test/unit/waves.test.ts`: красный на текущем коде.
3. Строки `Blocked by:` в worfy-product-session 28, 30 и 31 — по их зависимостям в `spec.md` этого Epic-а (таблица
   Wave-ов и раздел Ticket-ов); если зависимость не найдена — `None — can start immediately` и одна строка в «Итог»,
   откуда это взято.
4. Если `docs/features/` описывает, как worfy читает «Blocked by», — поправить en и ru.

## Где в коде

- `src/shared/workflow/waves.ts:128-136` (`ownProblem`), там же — `Level`.
- `src/shared/actions/render-template.ts:163` — для сверки, не менять без нужды.
- `test/unit/waves.test.ts`.
- `.scratch/worfy-product-session/issues/28-*.md`, `30-*.md`, `31-*.md`, `.scratch/worfy-product-session/spec.md`.

## Готово, когда

- [ ] Ticket без строки `Blocked by:` worfy не ставит в Wave как свободный и показывает, чего не хватает; unit test
      красный до правки.
- [ ] У worfy-product-session 28, 30 и 31 есть строка `Blocked by:`, взятая из spec-а Epic-а.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
