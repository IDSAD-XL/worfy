# Sonner, Vaul, cmdk, NumberFlow и emilkowalski/skills — факты для темы ui-overhaul

Заметка агента для Product Session `ui-overhaul`. Вопрос владельца: заменить ли написанные вручную
части UI worfy готовыми библиотеками. Здесь только четыре библиотеки и repo со skills.

Все источники прочитаны 2026-11-11. Цифры GitHub — из `gh api`. Цифры npm — из registry.npmjs.org и
api.npmjs.org. Ссылки на код ведут на конкретный commit, поэтому номера строк не сдвинутся.
«12 месяцев» здесь — 2025-11-11…2026-11-11. Weekly downloads — неделя 2026-11-04…2026-11-10.

## Сводка

| library | purpose | version/date | maintenance | deps | needs Tailwind | license | weekly downloads |
|---|---|---|---|---|---|---|---|
| Sonner | toast-уведомления | 2.0.8, 2026-08-09 | поддерживается, но редко: 1 release за 12 месяцев; 41 open issue, 44 open PR | runtime deps нет; peer `react`/`react-dom` `^18 \|\| ^19` | нет | MIT | 57 495 761 |
| Vaul | drawer (панель, которая выезжает от края и тянется drag-ом) | 1.1.2, 2024-12-14 | **unmaintained** — notice в README с 2025-10-03 | `@radix-ui/react-dialog ^1.1.1`; peer `react` `^16.8`…`^19` | нет | MIT | 31 235 789 |
| cmdk | command menu (⌘K) и combobox | 1.1.1, 2025-03-14 | notice нет; за 12 месяцев 0 release, 0 merged PR, 0 закрытых issue | 4 пакета Radix, среди них `@radix-ui/react-dialog`; peer `^18 \|\| ^19` | нет | MIT | 46 651 697 |
| NumberFlow (`@number-flow/react`) | анимированные числа | 0.6.2, 2026-07-18 | активен: 7 release за 12 месяцев, 14 merged PR | `number-flow` 0.6.2, `esm-env`; peer `^18 \|\| ^19` | нет | MIT | 2 998 823 (core `number-flow`: 3 305 546) |
| emilkowalski/skills | skills для агентов: UI, анимации, выбор библиотек | release-ов и tag-ов нет; последний commit 2026-11-09 | активен: 25 закрытых issue, 9 merged PR за 12 месяцев | файлы Markdown; CLI `skills` требует Node.js ≥ 22.20 | нет | MIT | — (56 066 stars) |

Главное в пяти строках:

- Все четыре библиотеки принимают React 19.3 как peer dependency. Ни одной не нужен Tailwind.
- Vaul официально без поддержки. В списке skill `pick-ui-library` его нет, но skill `gestures`
  того же автора по-прежнему советует Vaul для drawer.
- cmdk стоит на месте: последняя правка кода библиотеки — 2025-03-14. Repo переехал в org `dip`.
- cmdk и Vaul тянут за собой Radix Dialog. Sonner и NumberFlow — без сторонних UI-зависимостей.
- Sonner и Vaul вставляют свой CSS в `document.head` из JS. CSP renderer-а worfy это разрешает.

## Окружение worfy, к которому примеряем

- React 19.3.0, Electron 44.10.2. Ни одной из четырёх библиотек в `package.json` сейчас нет.
  Источник: `package.json` на main `e66d9cf4f`.
- Electron 44.10.2 несёт Chromium 152.0.7977.169 (релиз 2026-11-03).
  Источник: https://releases.electronjs.org/releases.json.
- CSP (Content Security Policy, список разрешённых источников скриптов и стилей) renderer-а:
  `style-src 'self' 'unsafe-inline'`. Значит, `<style>`, вставленный из JS, работает.
  Источник: `src/renderer/index.html`, строка 5.

## Sonner

### Что это и что умеет

- Описание repo: «An opinionated toast component for React.» https://github.com/emilkowalski/sonner
- Автор и почти единственный разработчик — Emil Kowalski: 207 commit-ов; у следующего участника 6.
  npm maintainer — `emilkowalski`. Docs: https://sonner.emilkowal.ski
- Модель: один `<Toaster />` в корне и функция `toast()`. Это обычная функция, не hook. Её можно
  звать из любого кода renderer-а, не только из компонента. Источник: skill `ask-sonner` автора,
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/ask-sonner/SKILL.md

Возможности (docs https://sonner.emilkowal.ski/toaster и https://sonner.emilkowal.ski/toast, типы
опубликованной 2.0.8 https://cdn.jsdelivr.net/npm/sonner@2.0.8/dist/index.d.ts):

| Возможность | Как устроено |
|---|---|
| Типы toast | `toast()`, `toast.success/error/info/warning`, `toast.loading` |
| Promise toast | `toast.promise(promise, { loading, success, error })`; `success`/`error` принимают функцию от результата; есть `unwrap()` |
| Кнопки | `action` (закрывает toast, если `onClick` не вызвал `event.preventDefault()`) и `cancel` |
| Свой JSX | `toast(<jsx />)` в стандартной оболочке; `toast.custom((t) => <jsx />)` — headless, без стилей Sonner |
| Обновление и закрытие | повторный `toast()` с тем же `id` обновляет toast; `toast.dismiss(id?)`; `toast.getToasts()`, `toast.getHistory()`, hook `useSonner()` |
| Stacking | по умолчанию стопка, видно 3 (`visibleToasts`); при hover стопка раскрывается; `expand` держит её раскрытой; `gap` 14 px |
| Позиции | 6: `top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`, `bottom-right`; на Toaster и на отдельный toast |
| Swipe-to-dismiss | pointer events; направления из позиции или из `swipeDirections`; порог 45 px или скорость больше 0.11 px/ms ([код](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/index.tsx#L348)) |
| Duration | 4000 ms по умолчанию; на toast или на весь Toaster; `Infinity` — не закрывается сам; `dismissible: false` |
| Пауза таймера | см. ниже, «Пауза» |
| Несколько Toaster-ов | у каждого `id`, у toast — `toasterId`; без `toasterId` toast появится во всех Toaster-ах |
| Цвета и тема | `richColors`, `invert`; `theme`: `light` (по умолчанию), `dark`, `system`; по умолчанию за ОС не следует |
| Прочее | `closeButton`, `icons`, `offset`/`mobileOffset`, `dir`, `hotkey`, `containerAriaLabel`, `testId` (рендерится как `data-testid` для e2e test), callbacks `onDismiss` и `onAutoClose` |

Пауза. Таймер стоит, пока выполнено одно из трёх условий
([код](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/index.tsx#L204-L241)):

- курсор над списком — hover раскрывает стопку, а раскрытая стопка держит таймеры;
- идёт pointer-взаимодействие (нажатие, swipe);
- `document.hidden` — событие `visibilitychange`
  ([hooks.tsx](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/hooks.tsx)).

Listener-а на `window.blur` нет. Вывод из кода: окно worfy видно, но фокус у другого приложения —
toast продолжает отсчёт и закрывается.

### Repo и активность

- Repo создан 2023-02-23. 13 193 stars. README без notice о поддержке.
- Releases за 12 месяцев: только 2.0.8 (2026-08-09). Предыдущий, 2.0.7, вышел 2025-08-02.
  https://github.com/emilkowalski/sonner/releases
- 2.0.8 — в основном PR #777 «Fix a batch of reported issues» (13 issue за раз, влит 2026-08-08).
  https://github.com/emilkowalski/sonner/pull/777
- Последний commit — 2026-08-10, правка README. Последняя правка кода — 2026-08-08.
- Open: 41 issue, 44 PR. За 12 месяцев закрыто 27 issue и влито 8 PR.
- README предлагает поставить skill `/ask-sonner` из emilkowalski/skills.

### Зависимости и размер

- Runtime dependencies нет. Peer: `react` и `react-dom` `^18.0.0 || ^19.0.0 || ^19.0.0-rc`;
  `@types/react` — optional peer с 2.0.8. https://registry.npmjs.org/sonner
- Unpacked size на npm — 174 012 B, 8 файлов.
- Bundlephobia (сторонний замер): 34.1 kB min, 9.4 kB gzip. CSS лежит внутри JS.
  https://bundlephobia.com/package/sonner@2.0.8

### Стили

- При импорте JS вставляет `<style>` в `document.head` (функция `__insertCSS` в dist). Тот же CSS
  лежит отдельным файлом `sonner/dist/styles.css`. https://cdn.jsdelivr.net/npm/sonner@2.0.8/dist/index.mjs
- Docs описывают ступени: `toastOptions.style` → `classNames` (нужен `!important`) → `unstyled`
  (стили без `!important`) → headless `toast.custom()`. Про headless docs пишут: «the recommended
  approach as people usually either use the defaults or go fully custom».
  https://sonner.emilkowal.ski/styling
- Data attributes для CSS: `[data-sonner-toaster]`, `[data-sonner-toast]`, `data-type`,
  `data-x-position`, `data-y-position`, `data-expanded`, `data-front`, `data-swiping`,
  `data-removed`, `data-rich-colors`, `data-sonner-theme`, `data-styled`.
  [код](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/index.tsx#L262-L300)
- CSS variables темы: `--normal-bg`, `--normal-border`, `--normal-text`, `--success-*`, `--error-*`,
  `--info-*`, `--warning-*`, `--border-radius`; ширина `--width` — 356 px.
  [styles.css](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/styles.css)
- Обычный CSS работает. Tailwind не нужен.
- `prefers-reduced-motion`: CSS выключает `transition` и `animation` у toast-ов.
  [styles.css#L708](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/styles.css#L708-L715)

### Accessibility

- Контейнер — `<section aria-live="polite" aria-relevant="additions text" aria-atomic="false"
  tabIndex={-1}>`. Его `aria-label` по умолчанию — «Notifications alt+T».
  [код](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/index.tsx#L786-L795)
- Toast — `<li tabIndex={0}>` внутри `<ol>`. Кнопка закрытия — `aria-label="Close toast"`.
- Hotkey (по умолчанию Alt+T, на macOS Option+T) раскрывает стопку и ставит фокус в список.
  Escape стопку сворачивает.
  [код](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/index.tsx#L750-L770)
- Когда фокус уходит из списка toast-ов, `onBlur` вызывает `focus()` на элементе, который был в
  фокусе до входа в список.
  [код](https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/index.tsx#L821-L840)
- В 2.0.8 декоративные SVG спрятаны от assistive technology (#713 в PR #777).
- PR #765 добавляет свои ARIA-объявления. Он открыт и не влит.
  https://github.com/emilkowalski/sonner/pull/765
- Live region раньше был собран неверно (#306, 2024). Исправлено в PR #436.
  https://github.com/emilkowalski/sonner/issues/306

### Известные проблемы для desktop-приложения

1. Hotkey перехватывает фокус. Listener `keydown` висит на `document`. Если на экране есть toast,
   Alt+T в любом поле, которое не останавливает всплытие события, переносит фокус в список toast-ов.
   xterm.js 6.0.0 останавливает всплытие для клавиш, которые сам отправил в PTY (pseudo-terminal)
   ([cancel](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L1321-L1327),
   [вызов](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L1098-L1100)).
   Для third-level shift (Option на macOS без `macOptionIsMeta`, AltGr) xterm возвращается раньше,
   и событие уходит дальше
   ([код](https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts#L1057)).
   Отключить hotkey: `hotkey={[]}`. Это работает только с 2.0.8 (PR #703). До 2.0.8 пустой массив
   ломал клавиатуру (#701). https://github.com/emilkowalski/sonner/issues/701
2. Нет паузы на `window.blur` — см. «Пауза».
3. Возврат фокуса. Код `onBlur` возвращает фокус на прежний элемент, даже если пользователь ушёл
   из toast-а кликом в другое поле. Вывод из кода; в браузере не проверено. Открытый PR #731 ещё
   чинит `listRef`: при нескольких позициях hotkey фокусирует только последний список.
   https://github.com/emilkowalski/sonner/pull/731
4. Утечки в долгоживущем окне:
   - #605 (open с 2025-03-18): после каждого toast остаётся detached DOM-узел `<li>`.
     https://github.com/emilkowalski/sonner/issues/605
   - #782 (open): listener `matchMedia` не снимается при смене `theme` и при unmount.
     https://github.com/emilkowalski/sonner/issues/782
   - #729: `ToastState` хранил все toast-ы навсегда. Исправлено в 2.0.8.
5. Регрессии 2.0.8:
   - #786 (open): remount `Toaster` снова показывает toast, который был на экране при unmount.
     https://github.com/emilkowalski/sonner/issues/786
   - #791 (open): toast, показанный снова с тем же `id` во время exit-анимации, теряется. В issue
     пример: на toast «Couldn't save» не нажималась кнопка «Try again».
     https://github.com/emilkowalski/sonner/issues/791
6. StrictMode: toast из `useEffect` в dev появляется дважды (#322). Совет автора в skill
   `ask-sonner`: звать из обработчика события или давать стабильный `id`.
   https://github.com/emilkowalski/sonner/issues/322
7. В docs есть ошибки таблиц (#781, open): например, тип `hotkey` — `string[]`, а не `string`.
   https://github.com/emilkowalski/sonner/issues/781
8. Поиск issue по слову «electron» — 0 результатов.

## Vaul

### Что это

- Описание repo: «A drawer component for React.» https://github.com/emilkowalski/vaul
- Старый README (удалён 2025-10-03): «Vaul is an unstyled drawer component for React that can be
  used as a Dialog replacement on tablet and mobile devices.»
  https://github.com/emilkowalski/vaul/commit/3e97aac6a38e4481bade71d7233ed6002e80f9b0
- Статья автора: «I prefer using a drawer instead of a modal on mobile for a more native feel.» и
  «I chose to build Vaul on top of Radix's Dialog primitive. Radix ensures the component is
  accessible, handles focus management etc.» https://emilkowal.ski/ui/building-a-drawer-component
- Автор — Emil Kowalski (204 commit-а). npm maintainer — `emilkowalski`. 8 714 stars.

### Статус поддержки

Весь текущий README — один notice, дословно (https://github.com/emilkowalski/vaul, commit
«Explain maintenance» от 2025-10-03):

> **Note**
> This repo is unmaintained. I might come back to it at some point, but not in the near future. This
> was and always will be a hobby project and I simply don't have the time or will to work on it
> right now.

- Issue #630 «Vaul's future» открыт с 2025-10-29. 2025-12-23 автор попросил добровольца написать
  ему на почту. После этого ни одного merge. В том же issue один участник советует Base UI Drawer,
  другой пишет, что перешёл на drawer из Ark UI. https://github.com/emilkowalski/vaul/issues/630
- Последний release — 1.1.2, 2024-12-14. За 12 месяцев: 0 release, 0 merged PR, 4 закрытых issue.
- Open: 134 issue, 27 PR.
- Последняя правка кода — 2025-07-25 (PR #580: prop `modal` передаётся в Radix Dialog). В release
  она не попала. Issue #647 просит release. https://github.com/emilkowalski/vaul/issues/647
- Замена той же функции: у Base UI 1.9.0 есть Drawer: «A panel that slides in from the edge of the
  screen.» Четыре направления swipe, snap points. https://base-ui.com/react/components/drawer

### Возможности

- Части: `Root`, `NestedRoot`, `Trigger`, `Portal`, `Overlay`, `Content`, `Title`, `Description`,
  `Close`, `Handle`. `Trigger`, `Close`, `Title`, `Description` — прямо из Radix Dialog.
  [код](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/index.tsx#L1137-L1147)
- Направления: `direction?: 'top' | 'bottom' | 'left' | 'right'`, по умолчанию `bottom`.
  [код](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/index.tsx#L105)
- Snap points: `snapPoints` (доля экрана или строка с px), `activeSnapPoint`, `setActiveSnapPoint`,
  `fadeFromIndex`, `snapToSequentialPoint`. https://vaul.emilkowal.ski/api
- Прочие props: `modal` (по умолчанию `true`), `dismissible`, `handleOnly`, `repositionInputs`,
  `container`, `onAnimationEnd`. https://vaul.emilkowal.ski/api
- Drag идёт через pointer events и `setPointerCapture`, поэтому мышью тоже тянется.
  [код](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/index.tsx#L276)
  Дочерний элемент с `data-vaul-no-drag` drag не начинает.

Нужен ли Vaul на desktop с мышью. Сам автор описывал его как замену Dialog на телефоне и планшете.
Главная ценность — инерция drag пальцем и обходы iOS (`usePreventScroll`, `usePositionFixed`,
`repositionInputs`). Для боковой панели на desktop хватает Dialog из Radix или Base UI либо
Base UI Drawer. Это вывод из источников выше, а не утверждение автора про desktop.

### Зависимости, размер, стили

- Dependency: `@radix-ui/react-dialog ^1.1.1` (последняя версия на npm — 1.3.1). Peer: `react` и
  `react-dom` `^16.8 || ^17.0 || ^18.0 || ^19.0.0 || ^19.0.0-rc`. https://registry.npmjs.org/vaul
- Unpacked size — 184 301 B. Bundlephobia: 60.0 kB min, 18.5 kB gzip вместе с Radix Dialog.
  https://bundlephobia.com/package/vaul@1.1.2
- Внешнего вида нет (unstyled). CSS для позиций и transition вставляется в `document.head` из JS
  (`__insertCSS` в dist). https://cdn.jsdelivr.net/npm/vaul@1.1.2/dist/index.mjs
- Data attributes: `data-vaul-drawer`, `data-vaul-overlay`, `data-vaul-drawer-direction`,
  `data-vaul-snap-points`, `data-vaul-handle`, `data-vaul-no-drag`. Обычный CSS работает.
- Правила для `prefers-reduced-motion` в `src/style.css` нет (поиск по файлу).
  https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/style.css

### Accessibility и известные проблемы

- Focus trap, Escape, `Title`/`Description` — от Radix Dialog.
- Open issue про accessibility: #517 (ошибка `aria-hidden`), #582 (`aria-hidden="true"` у
  non-modal drawer), #497 (фокус заперт при `modal={false}`), #492 (controlled drawer с
  `modal={false}` не работает).
  https://github.com/emilkowalski/vaul/issues/517 · https://github.com/emilkowalski/vaul/issues/582 ·
  https://github.com/emilkowalski/vaul/issues/497 · https://github.com/emilkowalski/vaul/issues/492
- #656 (open): блокировка scroll у `body` не снимается при закрытии drawer, только при unmount
  `Root`. https://github.com/emilkowalski/vaul/issues/656
- #653 (open): `Overlay` падает с «Rendered fewer hooks than expected», если `modal` меняется у
  открытого drawer. https://github.com/emilkowalski/vaul/issues/653
- #391 (open): `<input type="date">` внутри drawer не открывает календарь в desktop Chrome.
  https://github.com/emilkowalski/vaul/issues/391
- #475 (open): drawer тормозит при закрытии swipe-ом, когда на странице много содержимого.
  https://github.com/emilkowalski/vaul/issues/475
- Поиск issue по слову «electron» — 0 результатов.

## cmdk

### Что это и где живёт

- Описание repo: «Fast, unstyled command menu React component.» README: «⌘K is a command menu React
  component that can also be used as an accessible combobox. You render items, it filters and sorts
  them automatically.» https://github.com/dip/cmdk
- Repo сейчас в org `dip`. Адрес `pacocoursey/cmdk` перенаправляет туда. Поле `repository` на npm
  всё ещё указывает на `pacocoursey/cmdk`. Дата переноса — не проверено.
- Dip о себе: «Tools for interface excellence». Состав: Benji Taylor, Dennis Jin, Alex Vanderzon,
  Paco Coursey. cmdk 1.1.1 там указан как продукт. https://dip.org
- Автор — Paco Coursey (69 commit-ов), затем Rauno Freiberg (19). npm maintainers: `paco`, `dipnpm`.
  13 117 stars.
- Demo-сайт https://cmdk.paco.me отвечает 307 и ведёт на GitHub. Строку «Demo and examples:
  cmdk.paco.me» убрали из README 2025-10-29.
  https://github.com/dip/cmdk/commit/dd2250ed608443e8f32bafc5fa2d1d07a3746aa3

### Статус поддержки

- README прочитан целиком (481 строка). Notice о поддержке в нём нет.
- Последний release — 1.1.1, 2025-03-14. После него в repo только стили demo-сайта (2025-08-03) и
  README (2025-10-29).
- За 12 месяцев: 0 release, 0 merged PR, 0 закрытых issue. Open: 55 issue, 26 PR.
- Вывод: проект не объявлен заброшенным, но фактически не развивается.

### Возможности

- Части и атрибуты для CSS: `Command` `[cmdk-root]`, `Command.Dialog` `[cmdk-dialog]` и
  `[cmdk-overlay]`, `Command.Input` `[cmdk-input]`, `Command.List` `[cmdk-list]` (высота в CSS
  variable `--cmdk-list-height`), `Command.Item` `[cmdk-item]` с `data-selected` и `data-disabled`,
  `Command.Group` (скрывается атрибутом `hidden`, из DOM не удаляется), `Command.Separator`,
  `Command.Empty`, `Command.Loading`, hook `useCommandState`.
- Фильтр и сортировка по умолчанию — функция `commandScore`
  ([код](https://github.com/dip/cmdk/blob/dd2250ed608443e8f32bafc5fa2d1d07a3746aa3/cmdk/src/index.tsx#L161)).
  Это нечёткое (fuzzy) сравнение. Его константы и комментарии совпадают с superhuman/command-score:
  непрерывное совпадение — 1, начало слова после пробела — 0.9, после другого разделителя — 0.8,
  прыжок к символу — 0.17, перестановка букв — 0.1, плюс штрафы за пропуски и регистр.
  [command-score.ts](https://github.com/dip/cmdk/blob/dd2250ed608443e8f32bafc5fa2d1d07a3746aa3/cmdk/src/command-score.ts) ·
  https://github.com/superhuman/command-score
- `keywords` у item — псевдонимы для поиска. Свой ранжир: `filter(value, search, keywords)`
  возвращает число. Свой фильтр целиком: `shouldFilter={false}`.
- Async items: рендерить по мере прихода, показывать `Command.Loading`.
- Вложенные страницы встроенно не поддержаны. README показывает пример со своим state `pages`.
- Производительность, README FAQ дословно: «Virtualization? No. Good performance up to 2,000-3,000
  items, though.» Со `shouldFilter={false}` можно подключить свою virtualization.
- Controlled и uncontrolled: `value`/`defaultValue`/`onValueChange` — выбранный item; у
  `Command.Input` `value`/`onValueChange` — строка поиска; у `Command.Dialog` `open`/`onOpenChange`.
- Props `loop`, `disablePointerSelection`, `vimBindings` (по умолчанию `true`).
- `Command.Dialog` собран на Radix Dialog. README: «The overlay is always rendered.» Prop `container`
  задаёт, куда рендерится portal.
  [код](https://github.com/dip/cmdk/blob/dd2250ed608443e8f32bafc5fa2d1d07a3746aa3/cmdk/src/index.tsx#L880-L892)
- Глобального hotkey нет. README: «Listen for ⌘K automatically? No, do it yourself to have full
  control over keybind context.»
- README: «React strict mode safe? Yes.» Про concurrent mode: «Maybe… Uses risky approaches like
  manual DOM ordering.»

### Клавиатура и accessibility

Клавиатура — только внутри `Command`, через `onKeyDown` на корне
([код](https://github.com/dip/cmdk/blob/dd2250ed608443e8f32bafc5fa2d1d07a3746aa3/cmdk/src/index.tsx#L540-L640)):

| Клавиши | Действие |
|---|---|
| ↑ / ↓ | предыдущий / следующий item |
| Ctrl+P, Ctrl+K / Ctrl+N, Ctrl+J | то же, если `vimBindings` |
| ⌘+↑ / ⌘+↓, Home / End | первый / последний item |
| Alt+↑ / Alt+↓ | предыдущая / следующая группа |
| Enter | выбрать item (`onSelect`) |

Во время ввода через IME (способ ввода для китайского, японского, корейского) клавиши не
срабатывают — исправление #339 в 1.1.1.

ARIA ([код](https://github.com/dip/cmdk/blob/dd2250ed608443e8f32bafc5fa2d1d07a3746aa3/cmdk/src/index.tsx#L809-L867)):

- `Command.Input`: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`,
  `aria-activedescendant`. Фокус остаётся в поле ввода.
- `Command.List`: `role="listbox"`. `Command.Item`: `role="option"`, `aria-selected`, `aria-disabled`.
- `Command.Group`: `role="group"` и `aria-labelledby`. `Command.Separator`: `role="separator"`.
  `Command.Loading`: `role="progressbar"`.
- README: «Labeling, aria attributes, and DOM ordering tested with Voice Over and Chrome DevTools.»

Open issue про accessibility:

- #413: у `Command.Input` нет `aria-activedescendant` при mount, а после фильтрации он указывает не
  на тот item (React 19, 2026-09). https://github.com/dip/cmdk/issues/413
- #417: `Command.Empty` рендерится внутри `role="listbox"`; axe ругается на aria-required-children.
  https://github.com/dip/cmdk/issues/417
- #393: у `Command.Dialog` нет `DialogTitle`, Radix пишет предупреждения в console.
  https://github.com/dip/cmdk/issues/393

### Зависимости, размер, стили

- Dependencies: `@radix-ui/react-dialog ^1.1.6`, `@radix-ui/react-id ^1.1.0`,
  `@radix-ui/react-primitive ^2.0.2`, `@radix-ui/react-compose-refs ^1.1.1`. Peer: `react` и
  `react-dom` `^18 || ^19 || ^19.0.0-rc`. https://registry.npmjs.org/cmdk
- #420 (open, создан 2026-11-11): Radix Dialog попадает в bundle, даже если `Command.Dialog` не
  используется. С ним приезжают `@radix-ui/react-focus-scope`, `@radix-ui/react-dismissable-layer`,
  `react-remove-scroll`, `aria-hidden`. https://github.com/dip/cmdk/issues/420
- Unpacked size — 81 852 B. Bundlephobia: 49.6 kB min, 16.7 kB gzip вместе с Radix.
  https://bundlephobia.com/package/cmdk@1.1.1
- Стилей нет совсем (unstyled). Стилизация — через атрибуты `[cmdk-*]`. Готовые темы лежат в
  `website/styles/cmdk`: `raycast.scss`, `linear.scss`, `vercel.scss`, `framer.scss` (это SCSS).
- Обычный CSS работает. Tailwind не нужен.

### Известные проблемы для desktop-приложения

- #368 (open с 2025-06-17): с 1.1.0 фокус прыгает в другой `Command.Input`. Причина — изменение
  #254. PR #412 с исправлением открыт с 2026-08-29: «one `Command` can steal focus from another
  `Command` input». https://github.com/dip/cmdk/issues/368 · https://github.com/dip/cmdk/pull/412
- #405 (open): `Command`, смонтированный за пределами экрана, может прокрутить окно (через
  `scrollIntoView`). PR #408 открыт. https://github.com/dip/cmdk/issues/405
- Virtualization нет — см. «Возможности».
- Поиск issue по словам «electron» и «StrictMode» — 0 результатов.

## NumberFlow

### Что это

- Описание repo: «An animated number component for React, Vue, Svelte, and TS/JS.»
  https://github.com/barvian/number-flow
- Автор — Max Barvian (793 commit-а). Дальше идут bot release-ов (37) и единичные commit-ы других
  людей. npm maintainer — `maxbarvian`. 7 796 stars. Docs: https://number-flow.barvian.me
- Monorepo: `number-flow` (без framework), `@number-flow/react`, `@number-flow/vue`,
  `@number-flow/svelte`.
- README без notice о поддержке. В конце README ссылка на Torph — компонент анимированного текста
  другого автора.

### Активность

- `number-flow` и `@number-flow/react` 0.6.2 — 2026-07-18. За 12 месяцев у каждого по 7 release:
  0.5.x в январе–феврале 2026, 0.6.0 2026-02-28, 0.6.1 2026-06-27, 0.6.2 2026-07-18.
  https://github.com/barvian/number-flow/releases
- Последний commit — 2026-09-20 (README). Последняя правка кода — 2026-07-18.
- Open: 10 issue, 8 PR. За 12 месяцев закрыто 10 issue, влито 14 PR.

### Как рендерится

- Это custom element. Ядро `NumberFlowLite` наследует `HTMLElement`. React-пакет регистрирует
  элемент `<number-flow-react>` и оборачивает его в class component: `getSnapshotBeforeUpdate`
  нужен, чтобы измерить layout до и после обновления.
  [NumberFlow.tsx](https://github.com/barvian/number-flow/blob/c5906cf35c86583e756a6b91e043291c10b416e0/packages/react/src/NumberFlow.tsx#L20-L33)
- Open shadow root (`attachShadow({ mode: 'open' })`). В каждый shadow root кладётся свой
  `<style>`. Комментарий в коде: не `adoptedStylesheets`, «because it works unreliably in Safari».
  Поддержан CSP `nonce`.
  [lite.ts](https://github.com/barvian/number-flow/blob/c5906cf35c86583e756a6b91e043291c10b416e0/packages/number-flow/src/lite.ts#L139-L175)
- SSR (рендер на сервере) — через Declarative Shadow DOM. Для Electron не нужен.
- React 19: wrapper определяет React ≥ 19 и передаёт данные свойством элемента; для старых версий —
  атрибутами.

### Форматирование и анимация

- Форматирование — `Intl.NumberFormat`. Props: `format` (`Intl.NumberFormatOptions`), `locales`,
  `prefix`, `suffix`. https://number-flow.barvian.me
- Анимация — WAAPI (Web Animations API, `element.animate()`) с CSS-кривой `linear()`. Цифры
  прокручиваются через `transform`, символы появляются и исчезают через `opacity`.
  [lite.ts#L338](https://github.com/barvian/number-flow/blob/c5906cf35c86583e756a6b91e043291c10b416e0/packages/number-flow/src/lite.ts#L338)
- Props анимации: `animated`, `trend`, `transformTiming`, `spinTiming`, `opacityTiming`, `isolate`,
  `willChange`, `respectMotionPreference`, `plugins` (сейчас только `continuous` — показывает
  промежуточные числа), `digits` (максимум цифры на позиции), события `onAnimationsStart` и
  `onAnimationsFinish`.
- Анимация идёт, только если выполнено всё сразу
  ([lite.ts#L183](https://github.com/barvian/number-flow/blob/c5906cf35c86583e756a6b91e043291c10b416e0/packages/number-flow/src/lite.ts#L183-L190)):
  браузер умеет `mod()`, `linear()` и `@property`; `animated` включён; motion preference не
  запрещает; элемент видим; `document.visibilityState === 'visible'`. Иначе число просто меняется.
- Первый mount не анимируется — ветка `if (!this.created)` только строит DOM. Анимация — при смене
  значения.
- Chromium 152 в Electron 44 поддерживает все три возможности. MDN: `mod()` — Baseline 2024,
  `linear()` — Baseline widely available с 2023-12, `@property` — Baseline 2024.
  https://developer.mozilla.org/en-US/docs/Web/CSS/mod ·
  https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear ·
  https://developer.mozilla.org/en-US/docs/Web/CSS/@property

### prefers-reduced-motion, accessibility, стили

- `respectMotionPreference` по умолчанию `true`: при `prefers-reduced-motion` анимации нет.
  Hooks: `useCanAnimate`, `usePrefersReducedMotion`, `useIsSupported`.
  [index.tsx](https://github.com/barvian/number-flow/blob/c5906cf35c86583e756a6b91e043291c10b416e0/packages/react/src/index.tsx)
- Accessibility: через `ElementInternals` элемент получает `role = 'img'` и `ariaLabel` с готовой
  строкой значения. Screen reader читает итоговое число, а не цифры анимации.
  [lite.ts#L204](https://github.com/barvian/number-flow/blob/c5906cf35c86583e756a6b91e043291c10b416e0/packages/number-flow/src/lite.ts#L204)
- Стили: `::part()`; CSS variables `--number-flow-mask-height` (`.25em`) и `--number-flow-mask-width`
  (`.5em`); docs советуют `font-variant-numeric: tabular-nums`. Обычный CSS работает.

### Много экземпляров

- `NumberFlowGroup` синхронизирует обновления нескольких NumberFlow и сам ничего не рендерит.
- 0.6.2 исправила лишние измерения layout (PR #196). На странице с множеством NumberFlow (профиль
  x.com) Chrome насчитал около 500 ms forced synchronous layout. Причина: React 19 дважды ставил
  `data`, и каждый mount измерял все цифры. https://github.com/barvian/number-flow/pull/196
- У каждого экземпляра свой shadow root и свой `<style>` (см. «Как рендерится»).

### Ограничения и известные проблемы

- Docs, «Limitations»: «Scientific and engineering notations aren't supported»; «Non-Latin digits and
  RTL locales aren't currently supported». https://number-flow.barvian.me
- Open issue: #148 — старое и новое значение видны одновременно; #164 — старые Safari; #131 — iOS
  ниже 17.2; #133 — italic; #93 — RTL; #8 — не латинские цифры.
  https://github.com/barvian/number-flow/issues/148
- #183 (закрыт 2026-05-10): Chromium DevTools писал о неудачном compositing анимации opacity.
  https://github.com/barvian/number-flow/issues/183
- Поиск issue по словам «electron» и «StrictMode» — 0 результатов.

### Зависимости и размер

- `number-flow` зависит только от `esm-env ^1.1.4`. `@number-flow/react` — от `number-flow` 0.6.2
  (точная версия) и `esm-env`. Peer: `react` и `react-dom` `^18 || ^19`.
  https://registry.npmjs.org/@number-flow/react
- Unpacked size: core — 59 525 B, React-пакет — 25 039 B.
- Bundlephobia: core — 17.3 kB min, 5.7 kB gzip; `@number-flow/react` вместе с core — 18.9 kB min,
  6.3 kB gzip. https://bundlephobia.com/package/@number-flow/react@0.6.2

## emilkowalski/skills

### Repo

- Описание: «Skills for Designers and Engineers.» https://github.com/emilkowalski/skills
- License: MIT, «Copyright (c) 2026 Emil Kowalski».
- Создан 2026-03-16. Последний commit — 2026-11-09T12:07:26Z, «Update README.md» (`715c1807e`).
  Release-ов и tag-ов нет. 56 066 stars, 1 open issue.
- README: skills основаны на опыте автора в Vercel и Linear. Установка:
  `npx skills@latest add emilkowalski/skills`.
- Кроме skills в корне две шпаргалки: `ui-cheatsheet.md` и `performance-cheatsheet.md`.

### Все skills (18)

Описания — по frontmatter `SKILL.md` и README.

| Skill | Что делает |
|---|---|
| `emil-design-eng` | главный skill: философия автора о полировке UI, анимациях и мелких деталях |
| `animate` | строит анимацию с нуля: нужна ли она, какой инструмент, свойства, кривая, длительность, прерывание, выход |
| `animate-expo` | то же для React Native и Expo: Reanimated, Gesture Handler, haptics |
| `review-animations` | строгий review кода анимаций по правилам автора; «Default to flagging; approval is earned»; только по явному вызову |
| `improve-animations` | read-only аудит всех анимаций проекта и планы, которые выполнит другой агент |
| `find-animation-opportunities` | read-only поиск мест, где анимация нужна, и отказ там, где не нужна |
| `remove-animations` | удаляет лишние анимации: на действиях с клавиатуры, на частых поверхностях, на рабочих данных |
| `choreograph` | согласует несколько элементов, которые анимируются вместе: порядок, перекрытие, stagger |
| `animation-performance` | анимации, которые теряют кадры: composite-only свойства, CSS против WAAPI и rAF, `will-change` |
| `animation-vocabulary` | словарь: описание эффекта словами → точный термин |
| `apple-design` | принципы Apple из докладов WWDC для интерфейса и физичной анимации, переведённые на web |
| `gestures` | drag, swipe и sheet, которые идут за пальцем 1:1, сохраняют скорость и прерываются |
| `write-swift` | современный Swift: value types, Swift 6 concurrency, generics, Swift Testing |
| `pick-ui-library` | выбор библиотеки из курируемого списка автора; только по явному вызову |
| `prototype` | несколько разных версий куска UI за переключателем; только по явному вызову |
| `mobile-native` | мелкие правки CSS и meta-тегов, чтобы web-приложение ощущалось нативным на телефоне |
| `break-ui` | ломает UI худшими данными (длинные имена, пустые списки, огромные числа) и даёт исправления |
| `ask-sonner` | гид по Sonner: setup, стили, рецепты, частые проблемы |

«Только по явному вызову» — во frontmatter стоит `disable-model-invocation: true`.

### pick-ui-library

- Папка `skills/pick-ui-library`, один файл `SKILL.md` (4 790 B). Добавлен 2026-07-21, последний раз
  изменён 2026-09-15.
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/pick-ui-library/SKILL.md
- Frontmatter: «Only runs when explicitly invoked; it does not trigger on its own.»
  (`disable-model-invocation: true`).
- Первый ответ без вопроса — одна фраза: «I'm ready to pick the right library for your task, my picks
  come from Emil Kowalski's curated list.»
- Суть: «These are deliberate, taste-driven picks — don't substitute alternatives outside this list
  unless the user asks for one or the task genuinely isn't covered.»

Правила, по шагам (дословно, сокращено):

1. «**Identify the task**, not the library the user named.» Пример из skill: dropdown — это задача
   UI primitives, то есть base-ui.
2. «**Check what's already installed.** Look at `package.json` first.» Если стоит конкурент, «flag
   the recommendation but don't churn the dependency without being asked».
3. «**Recommend one library**… Don't present a menu of options when the list has a clear answer.»
4. Если задачи нет в списке, сказать об этом прямо и советовать от себя, «but be clear you've left
   the curated list».

Список целиком:

| Раздел | Задача | Библиотека |
|---|---|---|
| UI components & primitives | unstyled accessible компоненты (dialogs, popovers, menus, selects) | base-ui |
| | command menus (⌘K) | cmdk |
| | toasts / notifications | Sonner |
| | поле для одноразового кода (OTP) | input-otp |
| | панели настроек для разработки | Leva; альтернатива — dialkit |
| Motion & visuals | анимация общего назначения (springs, layout, enter/exit) | motion (Framer Motion) |
| | анимация чисел (counters, prices, stats) | NumberFlow |
| | анимированный текст | torph |
| | 3D-глобус | Cobe |
| | OG-картинки из HTML/CSS | Satori |
| | подсветка синтаксиса | shiki |
| Charts | графики с потоком данных в реальном времени | Liveline |
| | остальные графики | recharts |
| Interaction & performance | drag and drop | dnd kit |
| | virtualization длинных списков и таблиц | Virtuoso |
| State & styling | state management | zustand |
| | условная сборка `className` | clsx |
| | типизированные variants для Tailwind | cva |
| | переключение темы без вспышки при загрузке | next-themes |

Пояснения из skill, дословно:

- Про motion: «A simple hover or fade doesn't need it — plain CSS transitions are the right tool
  there.»
- Про стили: «clsx for ad-hoc conditional classes; cva when a component has real variants (size,
  intent, state) that deserve a typed API.»
- Про графики: «if data points arrive live and the chart scrolls with time, use Liveline. Everything
  else is recharts.»

Раздел «Common mismatches to catch», дословно:

- «**Toasts built by hand or with a modal library** → Sonner exists for exactly this.»
- «**A `<div>`-based dropdown/dialog with manual focus handling** → base-ui, which handles
  accessibility, focus trapping, and dismissal.»
- «**Animating a number by re-rendering text** → NumberFlow handles digit transitions properly.»
- «**Rendering a 1,000+ row list directly** → Virtuoso before reaching for pagination hacks.»
- «**A `useState`-per-component web of props for shared state** → zustand.»
- «**Template-literal className ternaries three conditions deep** → clsx (or cva if it's
  variant-shaped).»

Что skill говорит о том, о чём спрашивал владелец:

| Тема | Что в pick-ui-library | Что в других skills |
|---|---|---|
| Radix против Base UI | Radix не упомянут. Для primitives — только base-ui | `var(--transform-origin)` из Base UI советуют `animate`, `emil-design-eng`, `review-animations`, `find-animation-opportunities`; Radix — только в списке стеков, которые `improve-animations` определяет в проекте |
| shadcn/ui | не упомянут | только в том же списке стеков `improve-animations` |
| Tailwind | только строка cva «for Tailwind» | `ask-sonner`: классы Tailwind на Sonner требуют `!important`; `mobile-native`: hover-variant Tailwind v4 |
| Анимационные библиотеки | motion; простые hover и fade — CSS transitions; NumberFlow для чисел; torph для текста | `animation-performance` сравнивает CSS, WAAPI и rAF |
| Drawer | строки нет | `gestures`: «For a bottom sheet / drawer, default to Vaul»; `animate` при нужде в drawer отправляет к `pick-ui-library` |

Расхождения, которые стоит знать:

- Vaul без поддержки, но `gestures` (добавлен 2026-11-08) советует его по умолчанию.
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/gestures/SKILL.md
- `animate` отправляет за drawer к `pick-ui-library`, а там drawer нет.
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/animate/SKILL.md
- Ссылка на cmdk в списке (`cmdk.paco.me`) теперь ведёт на GitHub.
- `ask-sonner` советует `toast.getActiveToasts()`. В опубликованной 2.0.8 такой функции нет; есть
  `toast.getToasts()` и `toast.getHistory()`. `getActiveToasts` — внутренний метод `ToastState`.
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/ask-sonner/API.md ·
  https://github.com/emilkowalski/sonner/blob/8e4662b39255120b62138312058f5d77c0139a5e/src/state.ts

Правила автора из соседних skills, которые касаются частей worfy:

- Command palette не анимировать: «100+ times/day (keyboard shortcuts, command palette, core
  navigation) | **Reject. No animation. Ever.**»
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/find-animation-opportunities/SKILL.md
- Числа на рабочих данных: «Yes → DELETE, unless it shows a real change in value (e.g. a number
  ticking from old to new on user action).» В список лишнего входят «Numbers that count up on page
  load rather than on a change».
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/remove-animations/SKILL.md
- Toast-ы анимировать можно: они «Occasional», анимация «Standard».
  https://github.com/emilkowalski/skills/blob/715c1807e08c497cfd1dc4feb450a2a3300ef2a9/skills/emil-design-eng/SKILL.md

### Можно ли поставить как skill Claude Code

Да. Формат совпадает: папка `<name>/SKILL.md` с YAML frontmatter `name`, `description` и
необязательным `disable-model-invocation`. Все три поля описаны в docs Claude Code.
https://code.claude.com/docs/en/skills

Что для этого нужно:

- Место. Claude Code ищет skills в `~/.claude/skills/<name>/SKILL.md` (личные, все проекты),
  `.claude/skills/<name>/SKILL.md` (один repo) и `<plugin>/skills/<name>/SKILL.md` (внутри
  plugin-а, вызов — `/plugin-name:skill-name`). https://code.claude.com/docs/en/skills
- Способ 1 — CLI: `npx skills add emilkowalski/skills --skill pick-ui-library -a claude-code`. По
  умолчанию CLI ставит в `.claude/skills/` текущего проекта, с `-g` — в `~/.claude/skills/`. CLI
  требует Node.js 22.20 или новее. CLI шлёт анонимную телеметрию; отключается `DISABLE_TELEMETRY=1`
  или `DO_NOT_TRACK=1`. https://github.com/vercel-labs/skills (npm `skills` 1.8.1 от 2026-11-11)
- Способ 2 — скопировать один файл `SKILL.md` в такую папку вручную. MIT требует сохранить
  copyright и текст license.
- Вызов — только `/pick-ui-library`. Сам агент этот skill не позовёт.
- Skill не знает ограничений worfy: Electron, свой CSS без Tailwind. Он только смотрит в
  `package.json`. Из его списка в worfy сейчас стоит один zustand.
- Куда класть в worfy (repo, личная папка или plugin Harness-а) — решение владельца. Здесь не
  решается.

## Применимость к worfy — факты, не решение

| Вопрос | Sonner | Vaul | cmdk | NumberFlow |
|---|---|---|---|---|
| React 19.3 | да (`^19.0.0`) | да (`^19.0.0`) | да (`^19`) | да (`^19`) |
| Без Tailwind | да | да | да | да |
| CSS из JS и CSP worfy | вставляет `<style>`; CSP разрешает | вставляет `<style>`; CSP разрешает | CSS не вставляет | `<style>` внутри shadow root; есть `nonce` |
| Тянет Radix | нет | Radix Dialog | Radix Dialog и ещё 3 пакета | нет |
| Глобальные клавиши | Alt+T на `document`; отключается `hotkey={[]}` с 2.0.8 | Escape от Radix Dialog, пока drawer открыт | у `Command` нет, клавиши только внутри меню; у `Command.Dialog` — Escape от Radix, пока открыт | нет |
| Поддержка | редкие release | unmaintained | стоит с 2025-03 | активна |
| Открытые проблемы для долгой сессии | утечки #605, #782; регрессии 2.0.8 #786, #791 | scroll lock #656 | фокус #368, scroll #405 | исправлено в 0.6.2 (#196) |

## Не проверено

- Когда cmdk переехал из `pacocoursey` в org `dip`.
- Исправлена ли в 2.0.8 утечка DOM-узлов Sonner #605. Issue открыт; проверка в браузере не делалась.
- Как Sonner ведёт себя в Electron при свёрнутом или перекрытом окне: стоит ли `document.hidden`.
  Это зависит от Electron, здесь не измерялось.
- Размеры из Bundlephobia — сторонний замер, а не данные авторов. В bundle worfy через Vite цифры
  будут другими.
- Как поведёт себя Alt+T Sonner в xterm.js на Windows с AltGr и на macOS с `macOptionIsMeta: true`.
  Вывод сделан по коду xterm.js 6.0.0, без запуска.
- Перебивает ли возврат фокуса Sonner (`onBlur`) клик пользователя в другое поле. Вывод сделан по
  коду, без запуска в браузере.
- Будет ли конфликт с canvas worfy (React Flow). Vaul меняет `document.body.style`
  ([код](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/index.tsx#L184-L194)).
  Radix Dialog у `Command.Dialog` подключает `react-remove-scroll` (#420). Не запускалось.

## Источники

Все прочитаны 2026-11-11.

- Sonner: https://github.com/emilkowalski/sonner · https://github.com/emilkowalski/sonner/releases ·
  https://sonner.emilkowal.ski/toaster · https://sonner.emilkowal.ski/toast ·
  https://sonner.emilkowal.ski/styling · https://registry.npmjs.org/sonner ·
  https://api.npmjs.org/downloads/point/last-week/sonner ·
  https://cdn.jsdelivr.net/npm/sonner@2.0.8/dist/index.d.ts
- Vaul: https://github.com/emilkowalski/vaul ·
  https://github.com/emilkowalski/vaul/commit/3e97aac6a38e4481bade71d7233ed6002e80f9b0 ·
  https://vaul.emilkowal.ski/api · https://vaul.emilkowal.ski/getting-started ·
  https://emilkowal.ski/ui/building-a-drawer-component · https://registry.npmjs.org/vaul ·
  https://api.npmjs.org/downloads/point/last-week/vaul · https://base-ui.com/react/components/drawer
- cmdk: https://github.com/dip/cmdk · https://dip.org · https://cmdk.paco.me (ответ 307) ·
  https://registry.npmjs.org/cmdk · https://api.npmjs.org/downloads/point/last-week/cmdk ·
  https://github.com/superhuman/command-score
- NumberFlow: https://github.com/barvian/number-flow · https://number-flow.barvian.me ·
  https://registry.npmjs.org/number-flow · https://registry.npmjs.org/@number-flow/react ·
  https://api.npmjs.org/downloads/point/last-week/@number-flow/react
- Skills: https://github.com/emilkowalski/skills · https://code.claude.com/docs/en/skills ·
  https://github.com/vercel-labs/skills · https://registry.npmjs.org/skills
- Окружение: https://releases.electronjs.org/releases.json ·
  https://github.com/xtermjs/xterm.js/blob/6.0.0/src/browser/CoreBrowserTerminal.ts ·
  MDN `mod()`, `linear()`, `@property` (ссылки в разделе NumberFlow) · bundlephobia.com (ссылки в
  разделах библиотек)
- Счётчики issue и PR: GitHub search API, запросы вида
  `repo:<owner>/<repo> is:issue is:open`, `is:pr is:merged merged:>=2025-11-11`.
