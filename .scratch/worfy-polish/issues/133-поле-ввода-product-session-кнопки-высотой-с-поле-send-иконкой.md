# 133 — Поле ввода Product Session: кнопки высотой с поле, без Interrupt, Send иконкой

Type: task
Status: claimed 2026-11-20T02:06Z
Blocked by: none
Source: просьба владельца 2026-11-20 в чате Orchestrator-а: «В продуктовой сессии отрефактори инпут, чтобы кнопки были
одной высоты с инпутом и чтобы не было отдельных send/interrupt, только send, потому что interrupt есть сверху в
интерфейсе, и send замени иконкой».

Кто: агент. Не платформенный. Глубина review — `low`.

## Что происходит

- Поле ввода Product Session — ветка `product` общего компонента `MessageInput`
  (`src/renderer/session/MessageInput.tsx`, worfy-product-session ticket 22): одна строка — кнопка «+» attach, поле,
  Interrupt во время хода и текстовая кнопка «Send». Поле обычной Session — тот же компонент, другая ветка разметки.
- Поле однострочное — 38 px (поле 36 px и рамка; `session.css`, `.w-composer--product .w-composer__field`). Кнопки
  ниже: «+» — 24 px, «Send» и Interrupt — высота кнопок Session (28 px). Они прижаты к низу поля отступом
  `margin-bottom`, а не высотой.
- Во время хода в строке две кнопки, Interrupt и «Send». В шапке Product Session уже есть свой Interrupt
  (`SessionView.tsx`, `session-interrupt`): тот же вызов `agent.interrupt`, активен, пока Session занята.
- «Send» — текстовая кнопка, без подсказки с клавишей.

## Что делаем

1. В строке Product Session нет Interrupt. Ход останавливают Interrupt шапки и Esc в поле (как сейчас).
2. Send — кнопка-иконка «↑» (`SendIcon` поля обычной Session) на Button kit (`variant="icon"`) с tooltip kit:
   имя `Send`, подсказка «Send (⏎)» с клавишей из реестра (`SHORTCUTS.send`); во время хода подсказка говорит, что
   сообщение встанет в очередь. Пустое поле — `aria-disabled`, подсказка видна (правило Tooltip kit).
3. Кнопки строки — «+», Modes и Send — высотой с однострочное поле (38 px) и прижаты к низу: поле растёт, кнопки
   остаются у его нижнего края.
4. Return отправляет, во время хода ставит в очередь (правило не меняется); Esc в поле прерывает ход.
5. Поле обычной Session не меняется.

## Готово, когда

- [ ] Unit test (`test/unit/session-view.test.tsx`): в поле Product Session во время хода нет `input-interrupt`, в
      шапке есть `session-interrupt`; Esc в поле прерывает ход; Send — кнопка с именем `Send` без текста, с
      подсказкой клавиши; Return отправляет, во время хода — в очередь. Красный до правки.
- [ ] Поле обычной Session: Interrupt и «Queue message» / «Send message» как раньше (существующие test-ы зелёные).
- [ ] e2e (`test/e2e/product-session.spec.ts`): «+», Send и поле одной высоты, низ кнопок совпадает с низом поля, и
      так же после трёх строк текста.
- [ ] Снимки Playwright строки ввода в светлой и тёмной теме, без хода и во время хода — в scratchpad, названы в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/session/MessageInput.tsx` (ветка `product`, `sendButton`, `interruptButton`)
- `src/renderer/session/session.css` (правила `.w-composer--product`)
- `test/unit/session-view.test.tsx`, `test/e2e/product-session.spec.ts`
- `docs/features/product-session.md`, если страница описывает строку ввода

Только читать: `src/renderer/session/SessionView.tsx` (`Interrupt` шапки), `src/renderer/theme/Button.tsx`,
`src/renderer/theme/kit/Tooltip.tsx`, `src/shared/shortcuts.ts`.

## Вне скоупа

- Поле обычной Session и Orchestrator-а.
- Кнопки `QuietTurn` и `ContinueCountdown` (строки статуса тихого хода и отсчёта Auto-continue): появляются только в
  своём состоянии.
- Общий набор иконок в worfy-ui-kit: его нет, иконки — inline SVG своих компонентов.
