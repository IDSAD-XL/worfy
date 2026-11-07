# 07 — Экран Product Session: разделитель 60 / 40, полоса агентов, без Binding

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 6; «Что видит владелец»; «Решено без владельца», п. 2, 3; «Вопросы владельцу», Q10; карта [worfy-product](../../worfy-product/map.md), решения 05 (Q4), 06; прототип — Card «Прототип: Product Session + Mind map» (`card-2dffdc46`)

Не платформенный Ticket. Глубина ревью — `medium`.

## Что происходит

- Экран Session — `SessionPanel` (`src/renderer/session/SessionView.tsx:140`): header, затем `w-session__body`
  (`:320`) с `w-session__main` (Transcript и MessageInput, `:321-337`) и `SessionRail` (`:339`).
- `SessionRail` — правая колонка 300px без сворачивания (`.w-session__rail`, `src/renderer/session/session.css:308-310`).
  Блоки — Vendor, Binding, Subagents (`src/renderer/session/rail/`), приходят prop-ом `blocks`.
- Общего разделителя нет; drag есть только в Focus mode (`src/renderer/focus/FocusMode.tsx:462-480`, разметка
  `role="separator"` — `:581-596`, `MIN_SHARE = 0.1` — `src/renderer/focus/split-tree.ts:47`), и его деление не
  сохраняется.
- App settings — `appSettingsSchema` (`src/shared/settings/app-settings.ts:262`), один файл на Machine.
- Выбор модели — в строке ввода (`src/renderer/session/composer/Pickers.tsx`).

## Что делаем

1. `ProductSessionPanel` — ветка тела для Session вида `product` вместо `w-session__body`: слева место под Mind map
   (пустое состояние «Mind map появится, когда советник добавит первый узел»; отрисовка — Ticket 08), разделитель,
   справа чат (те же Transcript и MessageInput), у правого края — полоса агентов.
2. `SplitDivider` — свой компонент: drag мышью и клавиатурой (`role="separator"`, стрелки), минимум каждой стороны —
   `MIN_SHARE`; двойной click — 60 / 40. Доля — поле app settings `productSession.split` (по умолчанию 0.6),
   пишется по окончании drag.
3. Полоса агентов: колонка иконок с числом Subagent-ов; click раскрывает список поверх (блок Subagents); блок Binding не
   показывается.
4. Header: метка «Product Session» вместо «Session»; место под долю принятых советов (Ticket 14).
5. Выбор модели в строке ввода Product Session закрыт, tooltip «Product Session always runs on the strongest model» (Q10).

## Готово, когда

- [ ] Unit test: Session вида `product` рисует `ProductSessionPanel`; обычная — прежний `w-session__body`.
- [ ] Unit test: разделитель по умолчанию 60 / 40; drag на 70 / 30 пишет 0.7 в app settings; двойной click — 0.6;
      стрелки клавиатуры двигают.
- [ ] Unit test: полоса агентов показывает число Subagent-ов и раскрывается; блока Binding нет.
- [ ] Contract test app settings: поле `productSession.split` читается, неверное значение — 0.6.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Unit `test/unit/session-view.test.tsx`, `test/unit/product-session-panel.test.tsx` (новый).
- Contract `test/contract/app-settings.test.ts`.
- Сначала падающий: на `main` Session с `kind: 'product'` рисует обычное тело с Binding.

## Где в коде

- `src/renderer/session/SessionView.tsx`
- `src/renderer/session/ProductSessionPanel.tsx` (новый)
- `src/renderer/session/SplitDivider.tsx` (новый)
- `src/renderer/session/session.css`
- `src/renderer/session/composer/Pickers.tsx`
- `src/shared/settings/app-settings.ts`
- `test/unit/session-view.test.tsx`
- `test/unit/product-session-panel.test.tsx`
- `test/contract/app-settings.test.ts`

Только читать: `src/renderer/focus/FocusMode.tsx`, `src/renderer/focus/split-tree.ts`, `src/renderer/session/rail/`,
`docs/features/sessions.md`.
