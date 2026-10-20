# 19 — Долг после review PR #543 (Toolbar: Limits без «as of», Harness в две строки)

Type: task
Status: open
Blocked by: —
Source: review PR #543 (worfy-ui 18), раунд 2, находки уровня low, 2026-10-19. Строки — по голове PR,
влитой в main как `44e22e74`.

## Что происходит

Review второго раунда PR #543 не нашёл находок high и medium. Четыре находки low остались:

- **Лишний `.catch` в limits-usage.** `src/main/agent/limits-usage.ts:172-173`: `asked.catch(…)` не
  нужен — отказ `asked` уже ловит `Promise.race`. Комментарий над ним описывает поведение неверно.
- **Нет test-а: у значения устаревшей полосы нет title.** `src/renderer/LimitBar.tsx:51` — после #543
  строка «as of» убрана, и у span-а значения не должно быть подсказки; test этого не проверяет.
- **Нет test-а на форму иконки Update.** `src/renderer/HarnessStatus.tsx:137` — кнопки Update Harness и
  Move old стали иконками с tooltip; test проверяет tooltip, но не то, что это иконка.
- **Нет test-а на класс `--compact` 20×20.** `src/renderer/HarnessStatus.tsx:68`.

## Что делаем

1. Убрать `asked.catch` и неверный комментарий в `limits-usage.ts`; test на отказ `asked` остаётся
   зелёным.
2. Добавить три unit test-а: нет `title` у значения устаревшей полосы; кнопка Update — иконка (svg, без
   текста) с tooltip; у иконок есть класс `--compact`.

## Готово, когда

- [ ] `limits-usage.ts` без `asked.catch`; test-ы limits-usage зелёные.
- [ ] Три новых test-а; каждый краснеет на mutant-е, который возвращает старое поведение.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/main/agent/limits-usage.ts` (`:172-173`)
- `src/renderer/LimitBar.tsx` (`:51`)
- `src/renderer/HarnessStatus.tsx` (`:68`, `:137`)

## Вне скоупа

- Регистрация процесса limits-usage в `~/.claude/sessions` — решение владельца в worfy-terminal-ai 16, п. 2.

## Итог
