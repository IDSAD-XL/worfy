# 18 — `eslint-plugin-jsx-a11y` в `pnpm lint`; axe в e2e главных экранов

Type: task
Status: open
Blocked by: 05, 06, 07, 08, 10, 12, 13, 14
Source: [spec.md](../spec.md), «Ticket-ы», строка 18; «Решения по реализации» (доступность под присмотром); «Решения по
test-ам» (axe); история 29; заметка темы `docs/product/ui-overhaul/notes/inventory-foundation.md`, раздел 7

## Что происходит

Tooling доступности нет: в `package.json` нет `eslint-plugin-jsx-a11y` и axe, в `eslint.config.js` подключены только
`@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `typescript-eslint` и своё правило
`noCyrillic`. Кнопка без имени или окно без роли сегодня проходят lint и test-ы.

## Что делаем

1. `eslint-plugin-jsx-a11y` точной версией в `devDependencies`; в `eslint.config.js` — те правила, которые код
   проходит после Ticket-ов 05–14. Правило, которое код не проходит, не включается; Ticket записывает в «Итог»,
   какие правила оставлены и почему.
2. axe (`@axe-core/playwright` или то, что выберет Ticket, по правилам зависимостей ADR Ticket-а 03): helper
   `test/e2e/axe.ts` и spec `test/e2e/a11y.spec.ts` — Canvas, Session, Settings, Command palette, Guide без нарушений
   уровней critical и serious.
3. Найденные нарушения в коде renderer-а исправляются в этом Ticket-е, если правка мелкая; крупное — отдельный Ticket
   с находкой в «Итог».

## Готово, когда

- [ ] `pnpm lint` с `eslint-plugin-jsx-a11y` — exit 0; mutant (кнопка-иконка без `aria-label`) роняет lint.
- [ ] E2e `test/e2e/a11y.spec.ts` зелёный на macOS и Windows runner-е; mutant (dialog без имени) роняет его.
- [ ] axe в `a11y.spec.ts` проверяет и два места, которые остаются на своей вёрстке, а не на kit (решение владельца 2026-11-12, Q3): окно запроса команды Terminal AI и карточку Mind map.
- [ ] В «Итог» — включённые правила и оставленные вне lint с причиной.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0; e2e test бюджета старта зелёный.

## Где в коде

- `package.json`
- `pnpm-lock.yaml`
- `eslint.config.js`
- `test/e2e/axe.ts` (новый)
- `test/e2e/a11y.spec.ts` (новый)

Правки в `src/renderer/` по находкам lint и axe — заранее неизвестные файлы; Ticket называет их в PR.
