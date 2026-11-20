# 137 — Шапка Product Session: выбор Session не сжимается в пустую рамку

Type: task
Status: claimed 2026-11-20T04:55Z
PR: #2076
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

- [ ] Unit test (jsdom): у выбора Session класс правила минимальной ширины шапки Product Session и подсказка kit с
      полным именем Session (не `title`); доля советов — в обёртке, которая уступает первой и прячет разделитель вместе
      с собой; слово чипа состояния — в своём элементе, текст `session-state` прежний, у чипа tooltip kit со словом, а
      при ошибке Session — с ошибкой. Красный до правки. Саму ширину jsdom не видит: её проверяет e2e (пункт 2).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/session-view.test.tsx test/unit/session-state-chip.test.tsx test/unit/product-session-panel.test.tsx test/unit/session-picker.test.tsx` exit 0 · mac - · 1bc58aa08286eae2f505fa475f4df3e5173415c9
- [ ] e2e (`test/e2e/product-session.spec.ts`) при узком окне: ширина выбора Session ≥ 140 px (с точностью до полпикселя), имя в нём видно; доля
      советов обрезана или скрыта раньше, чем выбор Session сжимается; чип — только иконка, текст `busy` у него есть.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac dev · 1bc58aa08286eae2f505fa475f4df3e5173415c9
- [ ] Снимки Playwright шапки, широкой и узкой, в светлой и тёмной теме — в scratchpad, названы в «Итог».
- [ ] `docs/features/product-session.md` — если страница описывает шапку.
  - evidence: commit pass · worfy-polish/137: Product Session header — the picker keeps its name, the advice share gives way first · - - · 52bcdad43
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

- Выбор Session в шапке Product Session не уже 140 px (`.w-session--product .w-session__picker`, `session.css`); в
  шапке обычной Session пола нет — там модель сжимается вместе с выбором, и пол оставлял ей 0 px (CI #2076, e2e
  `codex-session.spec.ts:164`). Имя показанной Session — в tooltip kit через
  новое свойство `hint` Select kit (`hintProps` на кнопке), родного `title` больше нет. Длинное имя обрезает многоточием
  Select kit, как раньше.
- Доля советов и её разделитель — одна обёртка `product-session-advice` с весом сжатия 1000: при нехватке места она
  первой обрезается многоточием, выбор Session и заголовок целы. Шапка Product Session — container `w-session-header`:
  уже 800 px доля скрыта целиком, и только тогда сжимается заголовок; уже 640 px чип состояния — одна иконка (слово
  скрыто с экрана, не из DOM, и в tooltip kit); уже 600 px скрыт Vendor. Interrupt остаётся в шапке до окна 800 px —
  самого узкого, какое допускает приложение.
- Кто что сторожит. Unit test «a narrow Product Session header…» (`test/unit/session-view.test.tsx`) был красным до
  правки (у выбора не было подсказки kit и обёртки доли) и проверяет разметку: класс `w-session__picker`, подсказку с
  именем, обёртку доли с разделителем, слово чипа. Пол 140 px — правило CSS, jsdom его не видит: его сторожит e2e
  `test/e2e/product-session.spec.ts` («a narrow Product Session header…»), который сужает окно с 1440 до 800 px шагом
  40 и на каждом шаге проверяет выбор (≥ 139,5 px, имя видно), заголовок, долю и Interrupt. Мутант `min-width: 0` в
  `session.css` делает этот e2e красным (131,8 px при окне 1440). Ошибку Session в tooltip чипа сторожат
  `test/unit/session-state-chip.test.tsx` и `test/unit/session-back.test.tsx`: мутант «всегда слово» делает оба
  красными.
- Снимки Playwright шапки (scratchpad, в репозиторий не кладутся): `137-header-wide-light.png`,
  `137-header-wide-dark.png`, `137-header-share-clipped-light.png`, `137-header-share-clipped-dark.png`,
  `137-header-narrow-light.png`, `137-header-narrow-dark.png`.
- `docs/features/product-session.md`: абзац о шапке и строки в таблицах кода и test-ов.
- Решено без владельца, подтвердить:
  - подсказка выбора Session — только полное имя; прежний текст «Show another Session of this Project» убран;
  - заголовок («Product Session · тема») сжимается после доли советов вместе с выбором Session, а не раньше него;
  - в самой узкой шапке (уже 600 px) скрыт Vendor: без этого при полу выбора 140 px Interrupt выходил за край шапки
    окна 800 px, а заголовок чата под шапкой называет Vendor тоже;
  - пороги 800/640/600 px подобраны по шапке с фикстурой; у длинной темы заголовок обрежется раньше;
  - подсказка kit у чипа состояния есть и в широкой шапке; ошибку Session она показывает вместо родного `title`.
