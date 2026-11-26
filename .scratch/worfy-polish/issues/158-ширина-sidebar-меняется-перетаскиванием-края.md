# 158 — Ширина sidebar меняется перетаскиванием его правого края и сохраняется

Type: task
Status: claimed 2026-11-26T18:35Z
Branch: worfy-polish/158
Blocked by: —
Source: просьба владельца 2026-11-26: «Слишком узкий интерфейс, давай добавим возможность ресайзить сайдбар». На
снимке — раздел Assistant в sidebar: текст переносится по 2–3 слова в строке.

Кто: агент; последний пункт — владелец.

## Что происходит

Sidebar — колонка слева в окне: полоса под кнопками окна, rail из кнопок разделов (48 px) и панель с одним разделом.
Его ширина задана одним числом, `--sidebar-width: 264px` (`src/renderer/theme/tokens.css`), и не меняется. Панель
раздела после rail — около 210 px: длинные строки раздела Assistant, имена Epic-ов и Session переносятся по два-три
слова.

В worfy уже есть разделитель, который тянут мышью: `SplitDivider` между Mind map и чатом Product Session
(`src/renderer/session/SplitDivider.tsx`) — доля 0–1, drag, стрелки, Home/End, двойной щелчок, запись один раз в
конце жеста. Его единственный пользователь — `ProductSessionPanel.tsx`.

## Что строить

1. **Край sidebar тянется мышью.** У правого края sidebar — узкая полоса (около 6 px), курсор `col-resize`; при
   наведении и во время drag на краю видна линия цвета акцента темы. Тянешь — меняется ширина всего sidebar.
2. **Ширина сохраняется на Machine** — в app settings, поле `sidebar.width` (px, необязательное). Нет поля —
   ширина по умолчанию, поэтому старые `app-settings.json` читаются как раньше.
3. **Пределы.** По умолчанию 264 (у тех, кто не тянул край, ничего не меняется), наименьшая 220, наибольшая 640 и
   не больше ширины окна минус 480 px, чтобы Canvas оставалось место. Ширина приводится к пределам при чтении и при
   изменении размера окна; изменение размера окна в настройки ничего не пишет.
4. **Клавиатура и сброс.** Полоса берёт фокус: `role="separator"`, `aria-orientation="vertical"`,
   `aria-valuenow/min/max`. Стрелки ←/→ двигают край на 16 px, Home и End — к пределам. Двойной щелчок
   возвращает ширину по умолчанию. Полоса — внутри `.w-sidebar`, так что `SidebarFocusKeeper` (`AppShell.tsx`)
   по-прежнему держит фокус, когда sidebar прячется.
5. **Запись один раз.** Во время drag ширина меняется сразу, в настройки пишется один раз, когда кнопку мыши
   отпустили. Escape во время drag возвращает ширину, с которой drag начался, и ничего не пишет.
6. **Hide/show и focus mode.** Cmd/Ctrl+B и focus mode работают как раньше; показанный снова sidebar — той же
   сохранённой ширины. Ширина одна для обычного вида и focus mode.
7. **Масштаб интерфейса.** `--interface-scale` не должен применяться дважды: хранить ширину в единицах, которые
   масштаб уже увеличивает сам, и сказать в «Итог», в каких и почему.
8. Логику разделителя не писать второй раз: обобщить `SplitDivider` (или вынести его общую часть), чтобы и
   Product Session, и sidebar пользовались одной.

## Где в коде

- `src/renderer/theme/tokens.css` — `--sidebar-width: 264px`.
- `src/renderer/shell/shell.css` — `.w-sidebar` (ширина из переменной), rail, `.w-sidebar__sections`.
- `src/renderer/shell/Sidebar.tsx` — `<nav class="w-sidebar">`, сюда — полоса края.
- `src/renderer/shell/AppShell.tsx` — где sidebar монтируется, `SidebarFocusKeeper`.
- `src/renderer/shell/sidebar-width.ts` (новый) — ширина: из настроек, во время drag, пределы окна, переменная
  `--sidebar-width`.
- `src/renderer/shell/sidebar/AdrSection.tsx:66` — читает `var(--sidebar-width)`: значит, менять переменную, а не
  отдельную ширину.
- `src/renderer/session/SplitDivider.tsx`, `src/renderer/session/session.css`,
  `src/renderer/session/ProductSessionPanel.tsx` — нынешний разделитель и его пользователь.
- `src/renderer/theme/kit/` — общий разделитель, если вынести его туда.
- `src/shared/settings/app-settings.ts` — `sidebar`: схема состояния, patch, значения по умолчанию, пределы ширины.
- `src/main/settings/store.ts` — чтение файла (мягкая схема), `copy`, `merge`, `same`.
- `src/renderer/shell/sidebar-visibility.ts` — образец записи через `setAppSettings`.
- Test-ы: `test/contract/app-settings.test.ts`, `test/unit/shell.test.tsx`, `test/unit/interface-scale.test.tsx`,
  `test/unit/product-session-panel.test.tsx`, новый unit test полосы края, новый e2e
  `test/e2e/sidebar-resize.spec.ts` (рядом с `test/e2e/sidebar-rail.spec.ts`).
- `docs/features/app-shell.md` (ширина 264, настройки sidebar, файлы и test-ы), перевод
  `docs/features/ru/app-shell.md`.

## Решения (Orchestrator, 2026-11-26)

- Полоса — на правом краю sidebar, тянет весь sidebar; около 6 px, `col-resize`, линия акцента при наведении и drag.
- `sidebar.width` в app settings, px, необязательное; нет поля — 264.
- Пределы 220…640 и не больше «окно минус 480 px»; приводить при чтении и при изменении окна, без записи.
- Двойной щелчок — по умолчанию; стрелки — 16 px; полоса внутри `.w-sidebar`.
- Запись один раз в конце drag; Escape отменяет drag.
- Одна ширина для обычного вида и focus mode.

## Test-ы

- Contract: `sidebar.width` читается из файла и приводится к пределам; файл без поля читается как раньше; patch с
  шириной сливается, остальные поля `sidebar` не трогает; patch, который возвращает ширину по умолчанию, убирает
  поле.
- Unit: пределы с учётом окна; полоса — drag, стрелки, Home/End, двойной щелчок, Escape, одна запись на жест;
  ширина в px не умножается на масштаб интерфейса.
- Unit Product Session: разделитель Mind map и чата ведёт себя как раньше.
- E2e `test/e2e/sidebar-resize.spec.ts`: drag края, ширина та же после перезапуска, двойной щелчок сбрасывает.
  Локально e2e не запускается (правило владельца): его гоняет CI.

## Готово, когда

- [ ] Край sidebar тянется мышью и стрелками в пределах 220…640 и «окно минус 480 px»; двойной щелчок — 264;
      Escape отменяет drag; во время drag ширина живая, запись одна.
- [ ] `sidebar.width` хранится в app settings и переживает перезапуск; старый файл без поля читается как раньше.
- [ ] Hide/show (Cmd/Ctrl+B) и focus mode работают как раньше, sidebar возвращается сохранённой ширины.
- [ ] Разделитель Product Session и полоса sidebar — одна логика; test-ы Product Session зелёные.
- [ ] `docs/features/app-shell.md` говорит о ширине, её пределах и настройке.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR, job
      `macos-e2e` с `test/e2e/sidebar-resize.spec.ts`.
- [ ] (вручную) Сделай: в Stable worfy потяни правый край sidebar вправо, перезапусти worfy, потом дважды щёлкни по
      краю → Должно быть: раздел Assistant шире и строки длиннее; после перезапуска ширина та же; двойной щелчок
      возвращает прежнюю ширину.
  - needs: mac stable
