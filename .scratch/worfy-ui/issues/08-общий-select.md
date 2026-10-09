# 08 — Общий Select: стилизованный список вместо native `<select>`

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-09: 4 (один общий стилизованный компонент Select/Menu — стрелки, Enter, Esc, набор букв, ARIA — заменяет каждый native `<select>` в renderer; макет — `docs/design/F-session-dark.dc.html:177-179`) ([spec.md](../spec.md), «Как устроено», «Select»)

## Что происходит

- Native `<select>` в renderer — пять (grep `<select` по `src/renderer`):
  - `src/renderer/projects/ConnectProject.tsx:634` — поля Profile-а при подключении Project-а
    (внутри `Field`: `id`, `aria-invalid`, `aria-describedby`);
  - `src/renderer/harness/MigrationForm.tsx:212` — поля Profile-а при переносе старого Harness,
    `data-testid="profile-<key>"`;
  - три в composer-е: `src/renderer/session/composer/Pickers.tsx:69`, `:85`, `:104` — их меняет
    Ticket 09.
- Общего стилизованного Select, Menu или Popover нет. Есть свои меню, у каждого своя вёрстка: меню
  Canvas (`src/renderer/canvas/overlays/CanvasMenu.tsx:94`, разделитель `:117`), меню Autopilot
  (`ActionMenu`, `src/renderer/canvas/actions/action-menu.ts:49` — портал, ↑/↓ и Esc), контекстные
  меню Projects и Machines, меню Binding (`src/renderer/canvas/overlays/BindingDrop.tsx`),
  Slash-меню (`src/renderer/session/SlashMenu.tsx`).
- Вид меню в F-SPEC — меню Autopilot (`docs/design/F-SPEC.md:51`): поверхность, рамка 1 px, радиус
  10 px, тень Node-а, отступ 4 px, ширина от 180 px, строки общего вида (13 px).
- Макет composer-а рисует Model и Effort кнопками с подписью-префиксом и шевроном, а не системным
  списком (`docs/design/F-session-dark.dc.html:177-178`).
- Режим фокуса закрывается по Esc, если Node не забрал его раньше: popup внутри Node-а зовёт
  `preventDefault` (`src/renderer/focus/FocusMode.tsx:232-238`).
- Test-ы, которые выбирают в native `<select>`: `test/unit/harness-migration-form.test.tsx:149-151`
  (`fireEvent.change`) и `:158` (`disabled` у `HTMLSelectElement`); test-ы composer-а — Ticket 09.

## Что делаем

1. **Компонент** — `src/renderer/theme/Select.tsx` (новый) и `src/renderer/theme/select.css` (новый),
   по образцу WAI-ARIA «select-only combobox» (выбор без ввода текста).
   - Кнопка: `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`,
     `aria-activedescendant`; имя — `aria-label` или связанный `<label>` (`id`); `aria-invalid`,
     `aria-describedby`, `data-testid` передаются на неё.
   - Список: `role="listbox"`, строки `role="option"` с `aria-selected`. Портал в `document.body`:
     `overflow` родителя его не режет. Открывается вниз, если места нет — вверх.
   - Клавиши. Закрыт: ↓, ↑, Enter, Space открывают. Открыт: ↑ и ↓ (по кругу), Home и End; Enter и
     Space выбирают и закрывают; Esc закрывает без выбора и зовёт `preventDefault`, чтобы не закрыть
     режим фокуса или диалог под ним; Tab закрывает и уводит фокус дальше. Набор букв переходит к
     строке, которая с них начинается (буфер сбрасывается через 500 ms). Клик вне — закрывает.
   - Props: `value`, `options` (`value`, `label`, `detail`, `disabled`), `onChange`, `disabled`,
     `mono`, `onOpen` (composer обновляет список моделей при открытии), подпись-префикс.
   - Вид. Кнопка — высота 24 px, рамка 1 px, радиус chip-а, шеврон справа (макет). Список — вид
     меню F-SPEC: поверхность, рамка, радиус 10 px, тень Node-а, отступ 4 px, строки 28 px; у
     выбранной — галочка.
2. **Замена** native `<select>` в `ConnectProject.tsx:634` и `MigrationForm.tsx:212` на `Select`.
   `id`, `aria-invalid`, `aria-describedby` поля и `data-testid="profile-<key>"` переходят на кнопку.

Решено в Ticket-е, подтвердить у владельца: свои меню worfy (меню Canvas, Autopilot, контекстные,
Binding, Slash) на Select не переводятся.

**Не входит:** composer — Ticket 09; свои меню worfy; поле с вводом и поиском (combobox с текстом).

## Готово, когда

- [ ] Unit `test/unit/select.test.tsx` (новый): ARIA кнопки и списка; ↓ открывает, ↑/↓ двигают
  `aria-activedescendant` по кругу, Enter выбирает и закрывает, Esc закрывает без выбора и событие
  дальше не идёт (`defaultPrevented`); набор «pl» выбирает строку на «Pl…»; `disabled` не
  открывается; клик вне закрывает; `onOpen` зовётся при открытии.
- [ ] Unit `test/unit/harness-migration-form.test.tsx`: поля Profile-а выбираются через Select (клик
  по кнопке и строке) вместо `fireEvent.change`; неактивное поле — кнопка `disabled`.
- [ ] e2e `test/e2e/select.spec.ts` (новый): форма Profile-а при подключении Project-а — тем же
  путём, что `test/e2e/projects-connect.spec.ts`; поле открывается с клавиатуры, значение выбирается
  набором букв и Enter, черновик Profile-а меняется. Снимок `select-open` в светлой и тёмной теме.
- [ ] grep: в `src/renderer` `<select` — только в `Pickers.tsx` (его меняет Ticket 09).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.

## Тесты

Сначала падающий test — unit «↓ открывает список, Enter выбирает»: компонента нет. В «Итог» — API
компонента для Ticket-а 09 и как падал первый test.

## Где в коде

- `src/renderer/theme/Select.tsx` (новый)
- `src/renderer/theme/select.css` (новый)
- `src/renderer/projects/ConnectProject.tsx`
- `src/renderer/harness/MigrationForm.tsx`
- `test/unit/select.test.tsx` (новый)
- `test/unit/harness-migration-form.test.tsx`
- `test/e2e/select.spec.ts` (новый)

## Итог

Заполняется при закрытии.
