# 133 — Поле ввода Product Session: кнопки высотой с поле, без Interrupt, Send иконкой

Type: task
Status: done 2026-11-20T04:46Z
PR: #2060
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
3. Кнопки строки — «+» и Send — высотой с однострочное поле (38 px) и прижаты к низу: поле растёт, кнопки
   остаются у его нижнего края.
4. Return отправляет, во время хода ставит в очередь (правило не меняется); Esc в поле прерывает ход.
5. Поле обычной Session не меняется.

## Готово, когда

- [ ] Unit test (`test/unit/session-view.test.tsx`): в поле Product Session во время хода нет `input-interrupt`, в
      шапке есть `session-interrupt`; Esc в поле прерывает ход; Send — кнопка с именем `Send` без текста, с
      подсказкой клавиши; Return отправляет, во время хода — в очередь. Красный до правки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/session-view.test.tsx` exit 0 · mac - · 15ef693b7
- [ ] Поле обычной Session: Interrupt и «Queue message» / «Send message» как раньше (существующие test-ы зелёные).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/session-view.test.tsx` exit 0 · mac - · 15ef693b7
- [ ] e2e (`test/e2e/product-session.spec.ts`): «+», Send и поле одной высоты, низ кнопок совпадает с низом поля, и
      так же после трёх строк текста.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac dev · 15ef693b7
- [ ] Снимки Playwright строки ввода в светлой и тёмной теме, без хода и во время хода — в scratchpad, названы в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44667859730/job/136084734438 · ci - · 71666a3cd708cfd60cd8eaf0d41318d8f69645f6

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

## Итог

- Строка ввода Product Session: «+» и Send — по 38 px, как однострочное поле, низ кнопок совпадает с низом поля и
  после трёх строк текста (e2e `test/e2e/product-session.spec.ts`, test «a Product Session’s input line…»).
- Interrupt в строке нет; ход останавливают Interrupt шапки (`session-interrupt`, тот же `agent.interrupt`) и Esc в
  поле. Send — Button kit `variant="icon"` со стрелкой `SendIcon`, имя `Send`, `aria-keyshortcuts="Enter"`, tooltip kit
  «Send (⏎)», во время хода «Send (⏎) — queued until the turn ends». Пустое поле — `aria-disabled`, не `disabled`:
  tooltip виден и у неактивной кнопки (правило Tooltip kit).
- Поле обычной Session и Orchestrator-а не менялось: та же круглая «↑», Interrupt и «Queue message» / «Send message».
  Компонент общий (`MessageInput`), правка — только в ветке `product`.
- Unit test-ы (`test/unit/session-view.test.tsx`, три новых случая) были красными до правки: в поле был
  `input-interrupt`, имя Send — «Send message».
- Снимки Playwright строки ввода (scratchpad, в репозиторий не кладутся): `133-input-idle-light.png`,
  `133-input-idle-dark.png`, `133-input-busy-light.png`, `133-input-busy-dark.png`.
- Решено без владельца, подтверждено владельцем 2026-11-20: набора иконок в worfy-ui-kit нет — Send берёт ту же стрелку `SendIcon`, что круглая
  кнопка обычной Session, на кнопке Button kit; Send нейтральный (рамка, `--surface-raised`), не лаймовый, как прежняя
  текстовая «Send» прототипа; имя кнопки во время хода тоже `Send` (у обычной Session — «Queue message»), очередь
  называет tooltip.
