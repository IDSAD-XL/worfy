# 0106 — Base UI (`@base-ui/react`) — слой поведения под свой CSS; правила kit-а
Дата: 2026-11-12. Статус: принят.

**Контекст.** В `package.json` нет ни одной библиотеки UI-компонентов. Окна, popover-ы, menu и группы кнопок
написаны каждое своё: focus trap, стрелки, Esc, переворот у края окна и закрытие снаружи разошлись между копиями
(spec Epic-а `worfy-ui-kit`, `.scratch/worfy-ui-kit/spec.md`). Владелец 2026-11-11 принял spec: поведение берём из
библиотеки, вид остаётся свой. Spike (Ticket 01 Epic-а, заметка `.scratch/worfy-ui-kit/spike-base-ui.md`) ответил «да»:
Base UI уживается с Electron worfy — с `<webview>`, Node-ами Canvas, xterm, guard-ами окон Settings и focus mode.
Решение принято вместе с Ticket-ом 03 Epic-а. Без записи агент-исполнитель может взять Radix, cmdk или Sonner сам.

**Решение.**

1. **Зависимость `@base-ui/react` 1.9.0** — в `dependencies` с точной версией. Версия вышла 2026-10-09, тот же
   релиз мерил spike. Лицензия — MIT. `pnpm add --save-exact @base-ui/react@1.9.0` добавил в lockfile 7 пакетов:
   `@base-ui/react` 1.9.0, `@base-ui/utils` 0.5.0, `@floating-ui/core` 1.8.0, `@floating-ui/dom` 1.8.0,
   `@floating-ui/react-dom` 2.1.9, `@floating-ui/utils` 0.2.12, `reselect` 5.3.0. У всех лицензия MIT. Ни у одного
   нет `preinstall`, `install`, `postinstall` или `prepare` в `scripts` и нет `binding.gyp` (проверено чтением
   `package.json` каждого в `node_modules/.pnpm`). `allowBuilds` в `pnpm-workspace.yaml` не меняется, `pnpm install`
   прошёл без `ERR_PNPM_IGNORED_BUILDS`. `date-fns` и `@date-fns/tz` — необязательные peer, не ставятся.
   Размер: JS renderer-а +89 087 байт gzip (+5,96 %, сборка без минификации), четыре компонента отдельно (Dialog,
   Popover, Menu, Tooltip) — 71 149 байт min+gzip; e2e test бюджета старта на ветке spike-а зелёный.
2. **NumberFlow (`@number-flow/react`)** — второй пакет Epic-а, ставит его Ticket 17. Лицензия MIT; у версии 0.6.2 и
   её зависимостей `number-flow` 0.6.2 и `esm-env` в `scripts` только сборка и test-ы пакета, без install scripts
   (`npm view … scripts`). Ticket 17 проверяет то же на версии, которую ставит, и дописывает её сюда разделом
   `## Amendments`.
3. **Обновления — вручную**, как у остальных зависимостей: точная версия, не моложе суток (правило
   `minimumReleaseAge` pnpm). Исключений из этого правила (`minimumReleaseAgeExclude`) для Base UI нет. Обновление —
   отдельный PR, в нём unit test-ы kit-а и e2e-сценарии слоёв.
4. **kit — обёртки в `src/renderer/theme/kit/`.** Только kit импортирует Base UI: правило lint
   в `eslint.config.js` запрещает `@base-ui/*` во всём `src/`, кроме `src/renderer/theme/kit/`: `no-restricted-imports`
   ловит `import` и `export … from`, `no-restricted-syntax` — `import()` и `typeof import(…)` (test
   `test/unit/kit-import-lint.test.ts`). Test-ы в `test/` импортировать Base UI могут: они собирают probe
   так же, как обёртка. Остальной renderer берёт обёртку kit-а.
5. **Общая часть обёрток — `theme/kit/layer.ts`.** Каждая обёртка popup-а берёт `useKitLayer` (props `popup` — на
   popup, `trigger` — на trigger) и `layerStyle` (на portal):
   - popup закрывается по `blur` окна (нажатие в `<webview>` Browser Node-а Base UI не считает нажатием снаружи,
     Base UI #5410) и при смене вида shell-а;
   - popup Node-а на Canvas — с классами `nodrag`, `nopan`, `nowheel` и пометкой «внутри Node»; обработчик Canvas,
     который снимает активность Node-а, нажатие внутри такого popup-а пропускает;
   - popup несёт `data-toast-keep-out`: toast-ы его обходят;
   - popup несёт пометку kit-а `data-kit-popup`, по ней helper «открытые слои» (`theme/open-layers.ts`) узнаёт
     открытый popup kit-а.
6. **Слой — из шкалы z-index** (`theme/layers.ts`, токены `--z-*`), и стоит на позиционированном элементе: на
   portal-е с `position: relative` (`layerStyle`) или на positioner-е. Без `position` z-index не действует, и backdrop
   окна с меньшим z-index закрывает popup (spike, run 43129431332, Popover над Settings).
7. **Esc: одно нажатие — одно действие.**
   - Обёртка kit-а отмечает Esc обработанным в фазе React там, где стоит фокус: на popup-е и, пока popup открыт, на
     его trigger-е. `onKeyDown` из `useKitLayer` (`popup` и `trigger`) закрывает popup, вызывает `preventDefault()` и
     `stopPropagation()`. Предок popup-а или trigger-а по дереву React со своим Esc (панель справа в
     `session/ProductSessionPanel.tsx`, её `onKeyDown` закрывает панель) нажатие не получает. При закрытом popup-е Esc
     на trigger-е — предка, как у любой кнопки. Если Esc уже взял элемент внутри popup-а (`defaultPrevented`), popup
     остаётся открытым, и свой обработчик Base UI на этом нажатии не работает (`preventBaseUIHandler`).
   - Base UI 1.9.0 сам закрывает popup по Esc в двух местах: в `onKeyDown` своего popup-а и trigger-а (фаза React) и
     в слушателе `keydown` на `document` (после всех обработчиков React). Первое найдено при чтении исходника
     (`floating-ui-react/hooks/useDismiss.mjs`) в Ticket-е 03; spike считал, что только второе. Первое — внутренность
     Base UI. Для фокуса на popup-е и на trigger-е kit на неё не опирается: правило выше держится и без неё (test-ы
     `the shared part alone, without Base UI` в `test/unit/kit-layer.test.tsx`). Фокус вне popup-а и trigger-а Base UI
     ловит только на `document` — об этом следующий пункт.
   - Поле, в котором фокус остаётся при открытом popup-е, не полагается на `defaultPrevented`: Base UI отметит Esc
     позже, на `document`. Поле спрашивает helper «открытые слои» — `escapeBelongsToPopup(field)`: открыт ли popup kit-а,
     в котором поле не лежит. Так делает поле ввода чата (`session/MessageInput.tsx`): при открытом popup-е kit-а Esc
     закрывает popup и ход агента не прерывает; следующий Esc прерывает ход.
   - Popup Base UI, который ещё в DOM, но уже закрывается (`data-ending-style`, `data-closed`), — не открытый слой.
8. **Popup-ы и menu на Canvas — `modal={false}`**, кнопки — с `nodrag`, как сейчас все свои. Модальное menu Base UI
   рисует backdrop на всё окно, и Node под ним не тащится (spike, шаг 2, пункт 3).
9. **Вид — свои классы и tokens worfy.** Где DOM меняется, CSS переходит на data-атрибуты Base UI (`data-open`,
   `data-checked`, `data-side`). Вид можно менять, если это улучшает UX (решение владельца 2026-11-11); PR называет
   такую правку отдельной строкой.

**E2e-сценарий для Ticket-ов 10 и 11** (Esc в popup-е внутри элемента со своим Esc; история 4 spec-а). Пишут его
Ticket 10 (popover-ы Queued messages и Effort в composer-е, `test/e2e/layers-popover.spec.ts`) и Ticket 11 (menu
«Modes» в composer-е, `test/e2e/layers-menu.spec.ts`), каждый на своих popup-ах. Сценарий: Session занята ходом агента
(`busy`); в composer-е открыт popup kit-а.
- Фокус в popup-е (или на его trigger-е): Esc закрывает popup, ход идёт дальше (Session `busy`, запроса на interrupt
  нет). Следующий Esc в поле ввода прерывает ход.
- Фокус остаётся в поле ввода при открытом popup-е — popup с `initialFocus={false}`, открытый наведением или клавишей
  из поля: Esc в поле закрывает popup и ход не прерывает; следующий Esc прерывает. Это и есть риск: поле видит Esc
  раньше Base UI. Если ни один popup Ticket-а так не открывается, Ticket так и пишет, а этот случай держит unit test
  `test/unit/kit-layer.test.tsx` › `the chat field keeps the focus while a kit popup is open`.

## Considered Options

- **Radix UI Primitives.** Не выбрано: такой же слой поведения без стилей, но в Electron worfy (`<webview>`, Node-ы
  Canvas, xterm, guard-ы окон) spike проверял только Base UI. Base UI делают авторы Radix, Floating UI и MUI. Два
  слоя поведения в одном renderer-е — тот самый разнобой, который Epic убирает, поэтому берём один.
- **cmdk** для Command palette. Не выбрано: свои ranking, асинхронная группа «In transcripts», неактивные строки с
  причиной и клавиши остаются, а окну palette нужен только Dialog kit (focus trap, `aria-modal`, возврат фокуса).
- **Sonner** для toast-ов. Не выбрано: store и правила toast-ов свои (показ по Project, очередь сверх трёх, раскладка
  в обход открытых слоёв, `role="alert"` для ошибок), Sonner их не держит.
- **Vaul** (drawer). Не выбрано: выезжающих панелей-drawer-ов в worfy нет.
- **shadcn/ui.** Не выбрано: это копии компонентов на Radix и Tailwind в репозиторий, то есть свой код плюс Radix
  плюс Tailwind.
- **Tailwind CSS.** Не выбрано: вид worfy — свои классы и tokens (`docs/design/F-SPEC.md`), второй способ стилей
  разведёт вид так же, как разошлось поведение.
- **Без библиотеки, свои правки** (запасной путь spec-а на ответ «нет» spike-а): общий hook модального окна из
  `focusablesOf`, стрелки в группах, переворот у края в popover-ах. Не выбрано: дешевле, но позиционирование 11
  popover-ов, 6 menu и 5 context menu остаётся своим кодом, где 17 из 147 commit-ов чинили поведение (критик spec-а,
  `docs/product/critic/worfy-ui-kit-2026-11-11.md`).
- **Base UI** (выбрано).
