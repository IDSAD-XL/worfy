# 06 — Входы «New Product Session»: sidebar и Command palette

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 1 (свой вход), п. 10 (только Claude); research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), раздел 1.4

Не платформенный Ticket. Глубина ревью — `low`.

## Что происходит

- «New session» в Command palette — команда `new:session` (`src/renderer/palette/commands.ts:171-180`), зовёт
  `sessions.new` и фокусирует Node на Canvas.
- В sidebar — `newSession(vendor)` секции Sessions (`src/renderer/shell/sidebar/SessionsSection.tsx:92-101`) с выбором
  Vendor-а.
- Session Node на Canvas — `SessionNode` (`src/renderer/canvas/nodes/SessionNode.tsx:70`, `kind = 'session'`);
  двойной click открывает полный экран.
- На read-only экране (Linked machine) «New session» неактивен с причиной (`SessionsSection.tsx:89-90`).

## Что делаем

1. Команда `new:product-session` «New Product Session» рядом с `new:session`: `sessions.new` с `kind: 'product'`,
   затем сразу открыть экран Session (а не только фокус на Canvas — экран Product Session и есть рабочее место).
2. Пункт «New Product Session» в секции Sessions sidebar, без выбора Vendor-а (только Claude Code).
3. Session Node вида `product` на Canvas — с меткой «Product Session» вместо «Session».
4. Read-only экран — оба входа неактивны с той же причиной, что «New session».

## Готово, когда

- [ ] Unit test: команда есть в Command palette, вызывает `sessions.new` с `kind: 'product'` и открывает экран Session.
- [ ] Unit test: пункт sidebar делает то же; выбора Vendor-а нет.
- [ ] Unit test: Node с `kind: 'product'` показывает метку «Product Session».
- [ ] E2e на fake agent: «New Product Session» из Command palette — экран Session открыт, Node на Canvas с меткой.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Unit `test/unit/palette-commands.test.tsx`, `test/unit/sidebar-section.test.tsx`.
- E2e `test/e2e/new-product-session.spec.ts` (новый), по образцу `test/e2e/new-session.spec.ts`.
- Сначала падающий: на `main` команды `new:product-session` нет.

## Где в коде

- `src/renderer/palette/commands.ts`
- `src/renderer/shell/sidebar/SessionsSection.tsx`
- `src/renderer/canvas/nodes/SessionNode.tsx`
- `test/unit/palette-commands.test.tsx`
- `test/unit/sidebar-section.test.tsx`
- `test/e2e/new-product-session.spec.ts`

Только читать: `src/renderer/session/navigation.ts` (`openSession`), `src/renderer/session/NewSessionVendor.tsx`,
`test/e2e/new-session.spec.ts`.
