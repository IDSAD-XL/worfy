# 137 — Шапка Product Session: выбор Session не сжимается в пустую рамку

Type: task
Status: claimed 2026-11-20T04:55Z
PR: -
Blocked by: none
Source: замечание владельца 2026-11-20 по снимку экрана: в узкой шапке Product Session выбор Session сжимается в
пустую рамку — имени Session не видно.

Кто: агент. Не платформенный. Глубина review — `low`.

## Что происходит

- Шапка Product Session (`SessionView.tsx`, `header.w-session__header`) — в одну строку: фиолетовая метка «Product
  Session», заголовок, чип состояния (`session-state`, например «busy»), выбор Session (`SessionPicker.tsx`, Select kit,
  `session-picker`), доля принятых советов «Advice accepted N of M · P%» (`AcceptedAdvice` в `ProductSessionPanel.tsx`,
  `product-session-accepted`) с разделителем перед ней, Interrupt.
- Выбор Session — `flex: 0 1 auto`, `maxWidth: 240`, без минимальной ширины. Доля советов и чип — `flex: none`,
  заголовок почти не сжимается (`flex-shrink: 0.0001`). Когда шапке не хватает места, сжимается только выбор Session —
  до пустой рамки со стрелкой.
- Подсказка выбора — родной `title` «Show another Session of this Project»; полного имени Session в ней нет.

## Что делаем

1. Выбор Session не уже ~140 px: имя Session в нём обрезается многоточием, полное имя — в tooltip kit (не родной
   `title`).
2. Когда места не хватает, первой уступает доля советов: сначала обрезается многоточием, потом скрывается целиком
   вместе со своим разделителем — и только после неё сжимается выбор Session.
3. В узкой шапке чип состояния — только иконка; слово («busy», «idle»…) остаётся у чипа для screen reader и в tooltip
   kit.
4. Только компоненты и токены kit, новых цветов нет. Шапка обычной Session не теряет своих правил (модель уступает
   первой, кнопки справа не обрезаются).

## Готово, когда

- [ ] Unit test (jsdom): у выбора Session минимальная ширина 140 px и подсказка kit с полным именем Session (не `title`);
      доля советов — в обёртке, которая уступает первой и прячет разделитель вместе с собой; слово чипа состояния — в
      своём элементе, текст `session-state` прежний, у чипа tooltip kit со словом. Красный до правки.
- [ ] e2e (`test/e2e/product-session.spec.ts`) при узком окне: ширина выбора Session ≥ 130 px, имя в нём видно; доля
      советов обрезана или скрыта раньше, чем выбор Session сжимается; чип — только иконка, текст `busy` у него есть.
- [ ] Снимки Playwright шапки, широкой и узкой, в светлой и тёмной теме — в scratchpad, названы в «Итог».
- [ ] `docs/features/product-session.md` — если страница описывает шапку.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/session/SessionView.tsx` (шапка, `session-state`)
- `src/renderer/session/SessionPicker.tsx` (`PICKER_STYLE`, подсказка)
- `src/renderer/session/SessionStateChip.tsx` (слово чипа)
- `src/renderer/session/ProductSessionPanel.tsx` (`AcceptedAdvice`)
- `src/renderer/session/session.css` (правила шапки)
- `src/renderer/theme/Select.tsx` (подсказка kit на кнопке Select, если её нельзя дать снаружи)
- `test/unit/session-view.test.tsx`, `test/unit/product-session-panel.test.tsx`, `test/unit/session-picker.test.tsx`,
  `test/e2e/product-session.spec.ts`
- `docs/features/product-session.md`, если страница описывает шапку

Только читать: `src/renderer/theme/kit/Tooltip.tsx`, `src/renderer/theme/kit/hint.ts`, `src/renderer/theme/Chip.tsx`.

## Вне скоупа

- Порядок остальных элементов шапки и её высота.
- Список выбора Session (его ширина и обрезка строк — worfy-polish 51).
- Перевод `docs/features/ru/product-session.md` (ADR-0088: правится только английская страница).

## Итог

(заполняется при закрытии)
