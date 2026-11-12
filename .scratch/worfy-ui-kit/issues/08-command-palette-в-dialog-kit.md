# 08 — Command palette в Dialog kit; ranking свой

Type: task
Status: claimed 2026-11-12T17:28Z
Branch: worfy-ui-kit/08
Blocked by: 04
Source: [spec.md](../spec.md), «Ticket-ы», строка 08; «Решения по реализации» (Command palette); истории 12, 23;
заметка темы `docs/product/ui-overhaul/notes/inventory-overlays.md`, раздел 7.1

## Что происходит

`palette/CommandPalette.tsx` рисует палитру своим portal-ом и backdrop-ом. `aria-modal` нет, focus trap нет (Tab уходит
с поля), фокус при закрытии не возвращается (`close` только меняет state, :588). Ranking свой и общий с поиском по
Canvas (`rankItems`, `find/search-index.ts`), есть асинхронная группа «In transcripts», неактивные строки с причиной.

## Что делаем

1. Оболочка палитры — Dialog kit (Ticket 04): `aria-modal`, focus trap, возврат фокуса, слой из шкалы.
2. Своё остаётся: поле `role="combobox"`, ranking, группа «In transcripts», неактивные строки с причиной, клавиши
   поля. cmdk не берём.
3. Ctrl+K на Windows открывает только палитру; других сочетаний палитра не добавляет.

## Готово, когда

- [ ] Unit test: палитра — dialog с именем и `aria-modal`; Tab не уходит из палитры; после закрытия фокус там, где был
      до открытия; Esc закрывает палитру, отмечен как обработанный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/palette-dialog.test.tsx test/unit/layers.test.tsx` exit 0 · mac - · 1a69e2d0b2c38df488fe695a939b77a338ce0378
- [ ] Ranking прежний: существующие unit test-ы палитры и e2e `palette-groups.spec.ts`, `palette-find.spec.ts` зелёные
      без правок; на Windows runner-е тоже.
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0, `gate fast` exit 0 · mac - · 1a69e2d0b2c38df488fe695a939b77a338ce0378

## Где в коде

- `src/renderer/palette/CommandPalette.tsx`
- `test/unit/palette-groups.test.tsx`
- `test/unit/palette-transcripts.test.tsx`
- `test/e2e/palette-groups.spec.ts`
- `test/e2e/palette-find.spec.ts`

## Вне скоупа

- Ranking и состав команд (`palette/commands.ts`, `find/search-index.ts`).
