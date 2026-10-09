# 08 — Общий Select: стилизованный список вместо native `<select>`

Type: task
Status: claimed — 2026-10-09
Branch: worfy-ui/08
Blocked by: —
Source: решение владельца 2026-10-09: 4 (один общий стилизованный компонент Select/Menu — стрелки, Enter, Esc, набор букв, ARIA — заменяет каждый native `<select>` в renderer; макет — `docs/design/F-session-dark.dc.html:177-179`) ([spec.md](../spec.md), «Как устроено», «Select»); [worfy-terminal-ai 08](../../worfy-terminal-ai/issues/08-settings-terminal-ai.md) — выбор модели Next command в Settings → «Terminal AI» ждёт этот Ticket

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
- Макет Session (`docs/design/F-session-dark.dc.html:170` — шапка Session) рисует Model и Effort
  кнопками с подписью-префиксом и шевроном (`:178-179`), а не системным списком. Вид кнопки
  берётся оттуда.
- Диалоги, где стоят эти `<select>`, закрываются по Esc в своём `onKeyDown` и `defaultPrevented` не
  смотрят: `ConnectProject.tsx:779`, `MigrationForm.tsx:318`. Native-список забирал Esc сам; кнопка
  Select-а — нет, и Esc всплывёт до диалога.
- Режим фокуса закрывается по Esc, если его никто не забрал раньше (`src/renderer/focus/FocusMode.tsx:232-238`).
- Диалоги worfy — порталы в `document.body` с `z-index` 90–101; окно Settings Ticket-а 02 — 110.
- Test-ы, которые полагаются на native `<select>`:
  - `test/unit/harness-migration-form.test.tsx:149-151` (`fireEvent.change`) и `:158` (`disabled` у
    `HTMLSelectElement`);
  - `test/e2e/projects-connect.spec.ts:129`, `:252`, `:272`, `:308` — `toHaveValue` у полей «Reports»
    и «Finish»: у кнопки значения `value` нет, Playwright бросит ошибку.

  Test-ы composer-а — Ticket 09.

## Что делаем

1. **Компонент** — `src/renderer/theme/Select.tsx` (новый) и `src/renderer/theme/select.css` (новый),
   по образцу WAI-ARIA «select-only combobox» (выбор без ввода текста).
   - Кнопка: `role="combobox"`, `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls`,
     `aria-activedescendant`; имя — `aria-label` или связанный `<label>` (`id`); `aria-invalid`,
     `aria-describedby`, `data-testid` передаются на неё. Выбранное значение — в `data-value`
     кнопки (для test-ов).
   - Список: `role="listbox"`, строки `role="option"` с `aria-selected`. Портал в `document.body`,
     `z-index` выше всех диалогов (выше 110 окна Settings): `overflow` родителя его не режет, и он
     виден над окном Settings. Открывается вниз, если места нет — вверх.
   - Клавиши — как в образце APG. Закрыт: ↓, ↑, Enter, Space, Home, End открывают. Открыт: ↑ и ↓ —
     без перехода по кругу, Home и End; Enter и Space выбирают и закрывают; Tab выбирает строку под
     курсором, закрывает и уводит фокус дальше; набор букв переходит к строке, которая с них
     начинается (буфер сбрасывается через 500 ms). Клик вне — закрывает.
   - Esc в открытом списке закрывает его без выбора и дальше не идёт: `preventDefault` и
     `stopPropagation`. Диалог под Select-ом и режим фокуса этот Esc не получают. Закрытый Select Esc
     не трогает: он закрывает диалог, как раньше.
   - Props: `value`, `options` (`value`, `label`, `detail`, `disabled`), `onChange`, `disabled`,
     `mono`, `onOpen` (composer обновляет список моделей при открытии), подпись-префикс.
   - Вид. Кнопка — высота 24 px, рамка 1 px, радиус chip-а, шеврон справа (макет). Список — вид
     меню F-SPEC: поверхность, рамка, радиус 10 px, тень Node-а, отступ 4 px, строки 28 px; у
     выбранной — галочка.
2. **Замена** native `<select>` в `ConnectProject.tsx:634` и `MigrationForm.tsx:212` на `Select`.
   `id`, `aria-invalid`, `aria-describedby` поля и `data-testid="profile-<key>"` переходят на кнопку.
   Диалоги `ConnectProject` и `MigrationForm` не меняются: Esc им не доходит (пункт 1).
3. **Test-ы** из «Что происходит» переходят на Select: `toHaveValue` — на `data-value` кнопки,
   `fireEvent.change` — на клик по кнопке и строке.
4. Пользователи Select-а после этого Ticket-а: composer (Ticket 09), выбор модели Next command в
   разделе «Terminal AI» (Ticket 08 `worfy-terminal-ai`, `SettingRow` Ticket-а 02).

Решено в Ticket-е, подтверждено владельцем 2026-10-09: свои меню worfy (меню Canvas, Autopilot, контекстные,
Binding, Slash) на Select не переводятся.

**Не входит:** composer — Ticket 09; свои меню worfy; поле с вводом и поиском (combobox с текстом).

## Готово, когда

- [ ] Unit `test/unit/select.test.tsx` (новый): ARIA кнопки и списка; ↓ открывает, ↑/↓ двигают
  `aria-activedescendant` и на краях стоят; Enter выбирает и закрывает; Tab выбирает и закрывает;
  набор «pl» выбирает строку на «Pl…»; `disabled` не открывается; клик вне закрывает; `onOpen`
  зовётся при открытии.
- [ ] Unit, тот же файл: Select внутри контейнера с `onKeyDown`, который ловит Esc, и с
  `window`-слушателем Esc — Esc в открытом списке закрывает список, а ни контейнер, ни `window` его
  не получают; Esc на закрытом Select-е доходит до контейнера.
- [ ] Unit `test/unit/harness-migration-form.test.tsx`: поля Profile-а выбираются через Select (клик
  по кнопке и строке) вместо `fireEvent.change`; неактивное поле — кнопка `disabled`; Esc в открытом
  списке не закрывает форму.
- [ ] e2e `test/e2e/projects-connect.spec.ts`: проверки «Reports» и «Finish» (`:129`, `:252`, `:272`,
  `:308`) читают `data-value` кнопки; зелёный.
- [ ] e2e `test/e2e/select.spec.ts` (новый): форма Profile-а при подключении Project-а — тем же
  путём, что `test/e2e/projects-connect.spec.ts`; поле открывается с клавиатуры, значение выбирается
  набором букв и Enter, черновик Profile-а меняется; Esc в открытом списке закрывает только список,
  форма остаётся. Снимок `select-open` в светлой и тёмной теме.
- [ ] grep: в `src/renderer` `<select` — только в `Pickers.tsx` (его меняет Ticket 09); в `test/e2e`
  `selectOption` — только в spec-файлах Ticket-а 09.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.

## Тесты

Сначала падающий test — unit «↓ открывает список, Enter выбирает»: компонента нет. Затем Esc в
контейнере. В «Итог» — API компонента для Ticket-а 09 и раздела «Terminal AI» и как падал первый
test.

## Где в коде

- `src/renderer/theme/Select.tsx` (новый)
- `src/renderer/theme/select.css` (новый)
- `src/renderer/projects/ConnectProject.tsx`
- `src/renderer/harness/MigrationForm.tsx`
- `test/unit/select.test.tsx` (новый)
- `test/unit/harness-migration-form.test.tsx`
- `test/e2e/projects-connect.spec.ts`
- `test/e2e/select.spec.ts` (новый)

## Итог

Заполняется при закрытии.
