# Radix, Base UI и shadcn/ui как фундамент UI worfy — факты

Заметка агента для Product Session `ui-overhaul`. Вопрос владельца: переводить ли UI worfy на готовые
библиотеки. Здесь три варианта фундамента: Radix Primitives, Base UI и shadcn/ui. В конце — по абзацу
о React Aria Components и Ark UI для сравнения. Решений здесь нет, только факты и источники.

Все источники прочитаны 2026-11-11. Цифры GitHub — из `gh api` (repo, commits, search). Цифры npm — из
registry.npmjs.org и api.npmjs.org. «12 месяцев» — 2025-11-11…2026-11-11. Weekly downloads — неделя
2026-11-04…2026-11-10. Размеры bundle — из bundlephobia.com: min+gzip, React не входит. Файлы worfy —
checkout `d18c4eeb1`.

## Сводка

| library | type | version/date | maintenance | needs Tailwind | license | weekly downloads |
|---|---|---|---|---|---|---|
| Radix Primitives | headless primitives | `radix-ui` 1.8.1, 2026-10-12 | WorkOS. 237 из 287 commit-ов за 12 месяцев сделал один человек — Chance Strickland. Stable release-ов не было с 2025-08-13 по 2026-06-06, потом 12 за июнь–октябрь 2026. Последний commit — 2026-10-14 | нет | MIT | `radix-ui` 27 354 123; `@radix-ui/react-dialog` 92 567 529 |
| Base UI | headless primitives | `@base-ui/react` 1.9.0, 2026-10-09; v1.0.0 — 2025-12-11 | MUI. В команде на странице About 7 человек. Minor release почти каждый месяц: 11 stable за 12 месяцев. 1 857 commit-ов за 12 месяцев. Последний commit — 2026-11-10 | нет | MIT | 29 125 232 (+1 092 504 у старого имени `@base-ui-components/react`) |
| shadcn/ui | исходный код компонентов, который CLI копирует в проект («open code»); стили на Tailwind поверх Base UI (default), Radix или React Aria | CLI `shadcn` 4.23.0, 2026-10-27 | автор shadcn, сотрудник Vercel; проект «Vercel-supported». 852 из 1 521 commit-ов за 12 месяцев — его. 65 stable release-ов CLI за 12 месяцев. Последний commit — 2026-11-11 | да, Tailwind CSS v4 (latest 4.3.5) | MIT | `shadcn` 17 908 605 |
| React Aria Components (сравнение) | headless components и hooks | 1.22.1, 2026-10-09 | Adobe. 865 merged PR за 12 месяцев | нет | Apache-2.0 | 9 118 513 |
| Ark UI (сравнение) | headless components на state machines Zag.js; React, Solid, Vue, Svelte | `@ark-ui/react` 5.40.0, 2026-10-29 | Chakra Systems. 285 merged PR за 12 месяцев | нет | MIT | 1 446 632 |

Источники каждой ячейки — в разделах ниже.

## Главное

- Base UI стабилен. v1.0.0 вышел 2025-12-11. С тех пор minor release выходит почти каждый месяц
  (в июле 2026 его не было).
- Пакет Base UI переименован: `@base-ui-components/react` → `@base-ui/react`. Последняя версия под
  старым именем — 1.0.0-rc.0.
- Base UI делают авторы Radix, Floating UI и Material UI. Repo — `mui/base-ui`, компания — MUI.
- shadcn/ui с 2026-07-02 ставит Base UI по умолчанию. Radix остаётся флагом `-b radix`. С 2026-07-17
  есть третий вариант — React Aria (`--base aria`).
- Radix поддерживается, но почти всю работу делает один maintainer WorkOS. Работа идёт неравномерно.
  Combobox в Radix нет.
- Radix и Base UI работают с обычным CSS и с существующими именами классов. shadcn/ui без Tailwind
  официально не поддерживается.
- В shadcn/ui исправления primitives приходят через npm. Скопированный верхний слой обновляется только
  вручную. `shadcn add <component> --diff` показывает разницу с registry.
- Для worfy важны три открытые проблемы. Popover не закрывается от клика внутри iframe
  ([Base UI #5410](https://github.com/mui/base-ui/issues/5410)). Focus trap отбирает focus у другого
  frame в Electron-приложении ([Radix #4261](https://github.com/radix-ui/primitives/issues/4261)). Menu
  trigger открывается на press и мешает drag
  ([Base UI #6150](https://github.com/mui/base-ui/issues/6150),
  [Radix #4221](https://github.com/radix-ui/primitives/issues/4221)). Node-ы React Flow — как раз
  draggable элементы.

## Окружение worfy, к которому примеряем

- React 19.3.0, Electron 44.10.2, electron-vite 5.0.0, Vite 7.3.6, @xyflow/react 12.12.0,
  @xterm/xterm 6.0.0. UI-библиотек компонентов и Tailwind нет. Источник: `package.json`.
- Browser Node рисует страницу в Electron `<webview>`: `webviewTag: true`, `src/main/window.ts`,
  строка 145.
- CSP (Content Security Policy) renderer-а: `script-src 'self'; style-src 'self' 'unsafe-inline'`.
  Источник: `src/renderer/index.html`, строка 5.
- Свой CSS — 42 файла в `src/renderer`. `@layer` в них нет: `git grep "@layer"` вернул exit code 1.
- Canvas масштабирует Node-ы через viewport transform React Flow (`[tx, ty, zoom]`,
  `src/renderer/canvas/Canvas.tsx`, строки 295–296).

## 1. Radix Primitives

### Что это

- Headless primitives для React. Библиотека даёт поведение, ARIA, keyboard и focus. Стилей нет.
- Docs: «Radix Primitives are unstyled—and compatible with any styling solution—giving you complete
  control over styling.» ([styling](https://www.radix-ui.com/primitives/docs/guides/styling))
- У WorkOS есть ещё styled kit — Radix Themes. `@radix-ui/themes` 3.3.0 вышел 2026-01-31. Это
  единственный его release за 12 месяцев ([npm](https://registry.npmjs.org/@radix-ui/themes)). Дальше
  речь только о Primitives.

### Кто поддерживает, деньги, заявления о будущем

- WorkOS купила Modulz — компанию, которая создала Radix. Анонс от 2022-06-01 шёл вместе с Series B на
  $80M ([WorkOS](https://workos.com/blog/series-b)).
- Обещание из анонса: «We look forward to continued work on great UI components and supporting the
  open source community.»
- Описание repo: «Maintained by @workos». README: «Copyright © 2022-present WorkOS»
  ([repo](https://github.com/radix-ui/primitives)).
- Radix не продаётся. WorkOS строит на нём свой design system. Chance Strickland: «we build our entire
  design system at WorkOS on top of Radix»
  ([SE Daily, 2025-11](https://softwareengineeringdaily.com/wp-content/uploads/2025/11/SED1871-Radix-UI.txt)).
- Top-3 автора за всю историю: chaance — 561 commit, benoitgrelard — 518, jjenzz — 224
  ([contributors](https://api.github.com/repos/radix-ui/primitives/contributors)).
- Последний commit benoitgrelard — 2024-03-14. Последний commit jjenzz — 2023-05-04. Jenna Smith
  (jjenzz) теперь в команде Base UI ([About](https://base-ui.com/react/overview/about)).
- За 12 месяцев в main 287 commit-ов. 237 из них — chaance (Chance Strickland, WorkOS).

Активность Radix по месяцам (`gh api` search и commits):

| месяц | commit-ы в main | закрыто issue | merged PR |
|---|---|---|---|
| 2025-11 (с 11-го) | 0 | 3 | 0 |
| 2025-12 | 1 | 1 | 1 |
| 2026-01 | 0 | 0 | 0 |
| 2026-02 | 1 | 2 | 0 |
| 2026-03 | 0 | 0 | 0 |
| 2026-04 | 0 | 0 | 0 |
| 2026-05 | 21 | 11 | 6 |
| 2026-06 | 90 | 359 | 54 |
| 2026-07 | 105 | 107 | 47 |
| 2026-08 | 0 | 1 | 0 |
| 2026-09 | 0 | 2 | 0 |
| 2026-10 | 69 | 97 | 41 |
| 2026-11 (до 11-го) | 0 | 0 | 0 |

- Итого за 12 месяцев: 583 закрытых issue (459 — completed, 87 — not planned) и 149 merged PR.
- Заявления людей, причастных к Radix:
  - 2025-06-19, Colm Tuite. Он один из создателей Radix (maker Radix UI, Modulz, Stitches и Base UI по
    его [профилю Product Hunt](https://www.producthunt.com/@colmtuite)). Сейчас он в команде Base UI,
    то есть говорит автор конкурента. Цитата: «i agree that radix is a liability. off all of the
    headless ui libs, it's the last option i'd consider for any serious project.»
    ([X](https://x.com/colmtuite/status/1935629877069172861))
  - 2025-11, Chance Strickland в SE Daily. О своей работе: «I am a software engineer at WorkOS. And,
    yeah, working on all of our front-end things and still maintaining Radix as well.» Radix делит его
    время с другой работой.
  - Там же о будущем: «I think for Radix Primitives, it's fairly mature there. … there's not a lot more
    that we really need to build.» И: «There will be new primitives that pop up from time to time.»
  - Там же о Combobox. На слово «Combo box» он ответил: «No. Don't say the word.», затем «This is hard,
    man.» и «keep your eyes open. You never know.»
  - 2026-10-11, chaance в issue о двух копиях одного пакета
    ([#4189](https://github.com/radix-ui/primitives/issues/4189)): «This is why I recommend using the
    `radix-ui` package rather than installing individual packages.»
- Публичного roadmap нет. В блоге Radix один пост — о Themes 3 ([blog](https://www.radix-ui.com/blog)).
- Оценка со стороны: shadcn 2026-07-02 пишет «Radix is a mature, tested library. We still run it in
  production today and we're not migrating.»
  ([changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default))

### Пакеты, версии, release-ы

- Docs ставят umbrella-пакет: `npm install radix-ui@latest`
  ([getting started](https://www.radix-ui.com/primitives/docs/overview/getting-started)).
- Import: `import { Popover } from "radix-ui"` или `import * as Popover from "radix-ui/popover"`.
- Subpath imports `radix-ui/<primitive>` есть с 1.6.3 (2026-07-20)
  ([CHANGELOG](https://github.com/radix-ui/primitives/blob/main/packages/react/radix-ui/CHANGELOG.md)).
- Отдельные пакеты `@radix-ui/react-*` публикуются по-прежнему. Пример: `@radix-ui/react-dialog`
  1.3.1, 2026-10-12 ([npm](https://registry.npmjs.org/@radix-ui/react-dialog)).
- `radix-ui` latest — 1.8.1 (2026-10-12). Tag `next` — 1.8.2-rc.1791984254107 (2026-10-14)
  ([npm](https://registry.npmjs.org/radix-ui)).
- Stable release-ов за 12 месяцев — 12: от 1.5.0 (2026-06-06) до 1.8.1 (2026-10-12).
- Предыдущий stable — 1.4.3 (2025-08-13). Перерыв между ними — почти 10 месяцев.
- Ещё 71 prerelease (`-rc.*`) за 12 месяцев.
- GitHub Releases repo не ведёт: API отдаёт пустой список. Changelog — на сайте
  ([releases](https://www.radix-ui.com/primitives/docs/overview/releases)) и в `CHANGELOG.md`.
- Repo на 2026-11-11: 19 492 stars, 140 open issues, 148 open PR. Последний commit — 2026-10-14
  (`eb3a2b709`).

### React 19

- peerDependencies `radix-ui` 1.8.1: `react` и `react-dom`
  `^16.8 || ^17.0 || ^18.0 || ^19.0 || ^19.0.0-rc`. React 19.3 подходит.
- Исправления для React 19 пришли только летом 2026 (CHANGELOG):
  - 1.5.0: «Fixed issues with focus management in React 19.2+.»
  - 1.5.0: «Fixed infinite re-render loop in React 19 caused by `Slot` creating a new ref callback on
    every render.»
  - 1.6.1: «Fixed infinite re-render loop in React 19 caused by unstable composed ref callback
    references.»
  - 1.6.2: «Fixed stale `onEscapeKeyDown`/`onDismiss` handlers on React 19.2.»
- Issue о бесконечном re-render на React 19 из-за нестабильных ref
  ([#3963](https://github.com/radix-ui/primitives/issues/3963)) открыт 2026-06-12, закрыт 2026-06-15.

### Стилизация

- Все parts принимают `className`. Docs: «This class will be passed through to the DOM element.»
  Значит, подходят обычный CSS и существующие классы worfy.
- Состояние — в `data-state`: «When components are stateful, their state will be exposed in a
  `data-state` attribute.» У popover-ов есть ещё `[data-side]` и `[data-align]`
  ([popover](https://www.radix-ui.com/primitives/docs/components/popover)).
- CSS variables (из страниц компонентов):
  - Popover: `--radix-popover-trigger-width`, `--radix-popover-trigger-height`,
    `--radix-popover-content-available-width`, `--radix-popover-content-available-height`,
    `--radix-popover-content-transform-origin`.
  - Такой же набор со своим префиксом — у Dropdown Menu, Context Menu, Hover Card, Tooltip, Select.
  - Accordion и Collapsible: `--radix-accordion-content-height/width`,
    `--radix-collapsible-content-height/width`.
  - Toast: `--radix-toast-swipe-move-x/y`, `--radix-toast-swipe-end-x/y`.
  - Navigation Menu: `--radix-navigation-menu-viewport-width/height`,
    `--radix-navigation-menu-indicator-translate-x/y`.
- Portal по умолчанию добавляется в `document.body`. Prop `container` меняет место
  ([portal](https://www.radix-ui.com/primitives/docs/utilities/portal)).
- Scroll Area имеет prop `nonce` — значит, вставляет inline `<style>`
  ([scroll area](https://www.radix-ui.com/primitives/docs/components/scroll-area)). CSP worfy
  (`style-src 'unsafe-inline'`) это разрешает.

### Accessibility

- «Radix Primitives provide basic keyboard support in accordance with the WAI-ARIA authoring
  practices.» ([accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility))
- «We take care of many of the difficult implementation details related to accessibility, including
  aria and role attributes, focus management, and keyboard navigation.»
- Labels — на разработчике: «Ultimately it's up to you to provide those labels…»
- Dialog: «Focus is automatically trapped within modal», «Esc closes the component automatically»,
  «Supports modal and non-modal modes» ([dialog](https://www.radix-ui.com/primitives/docs/components/dialog)).
- Dismiss и focus настраиваются callback-ами: `onOpenAutoFocus`, `onCloseAutoFocus`,
  `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`, у Popover ещё `onFocusOutside`.
- Modal Dialog отключает pointer events на всей странице. Это видно по issue
  [#2122](https://github.com/radix-ui/primitives/issues/2122) («DialogContent disables pointer events
  for the whole page»).
- Typeahead: у Dropdown Menu и Select в списке features есть «Typeahead support».
- Внутренние пакеты для этого: `@radix-ui/react-focus-scope` (focus trap),
  `@radix-ui/react-dismissable-layer` (dismissable layers), `aria-hidden`, `react-remove-scroll`
  (dependencies `@radix-ui/react-dialog` 1.3.1).

### Компоненты (docs, 2026-11-11)

- 30 компонентов: Accordion, Alert Dialog, Aspect Ratio, Avatar, Checkbox, Collapsible, Context Menu,
  Dialog, Dropdown Menu, Form, Hover Card, Label, Menubar, Navigation Menu, One-Time Password Field,
  Password Toggle Field, Popover, Progress, Radio Group, Scroll Area, Select, Separator, Slider,
  Switch, Tabs, Toast, Toggle, Toggle Group, Toolbar, Tooltip.
- 5 utilities: Accessible Icon, Direction Provider, Portal, Slot, Visually Hidden.
- One-Time Password Field и Password Toggle Field экспортируются как `unstable_*` (root exports
  `radix-ui` 1.8.1). Пакет Form — версии 0.3.0.
- Combobox нет. Сторонний отчёт об accessibility тоже пишет: «Radix does not ship one»
  ([discussion #4170](https://github.com/radix-ui/primitives/discussions/4170)).

### Размер

- Docs размеров не публикуют (не нашёл).
- bundlephobia для `radix-ui` 1.8.1, каждый export отдельно: Dialog — 13.2 KB gzip, Popover — 23.5 KB,
  Dropdown Menu — 30.3 KB. Полная таблица — в разделе «Radix против Base UI».
- Весь `radix-ui`: 258.5 KB min, 74.3 KB gzip, 55 dependencies
  ([bundlephobia](https://bundlephobia.com/package/radix-ui@1.8.1)).
- Unpacked в npm: `radix-ui` — 105 530 B (код лежит в зависимостях), `@radix-ui/react-dialog` —
  107 250 B.

### Известные проблемы, важные для worfy

| issue | что происходит | статус | почему важно worfy |
|---|---|---|---|
| [#4261](https://github.com/radix-ui/primitives/issues/4261) | trapped `FocusScope` возвращает focus в свой контейнер, когда у document нет focus. Так он отбирает focus у соседнего frame. Автор столкнулся с этим в Electron-приложении с same-origin iframe-панелями | open, 2026-10-30; fix PR [#4264](https://github.com/radix-ui/primitives/pull/4264) open | рядом с dialog-ами в worfy находятся `<webview>` и xterm |
| [#1721](https://github.com/radix-ui/primitives/issues/1721) | обработчики подключены к глобальному `document`, а не к `ownerDocument` | open с 2022-10-14 | только если worfy будет рендерить React в чужой `document` |
| [#4220](https://github.com/radix-ui/primitives/pull/4220) | клик снаружи не закрывает layer в другом окне; регресс с 1.1.13 | PR open, 2026-10-16 | то же |
| [#3357](https://github.com/radix-ui/primitives/pull/3357) | поддержка новых окон и Document Picture-in-Picture | PR закрыт без merge 2025-04-29 | то же |
| [#1241](https://github.com/radix-ui/primitives/issues/1241), [#3445](https://github.com/radix-ui/primitives/issues/3445) | после закрытия Dialog на `body` остаётся `pointer-events: none` | #1241 closed (108 comments); #3445 (Dialog с открытым Popover) закрыт 2026-06-01, через 14 месяцев | вся страница перестаёт реагировать на мышь |
| [#4189](https://github.com/radix-ui/primitives/issues/4189) | две копии `@radix-ui/react-focus-scope` в `node_modules` дают бесконечную рекурсию focus; `react-dialog` 1.2.0 оставлял `pointer-events: none` | closed 2026-10-11; ответ maintainer-а — ставить один пакет `radix-ui` | cmdk и Vaul приносят свои диапазоны `@radix-ui/react-dialog` |
| [#4221](https://github.com/radix-ui/primitives/issues/4221), [#3012](https://github.com/radix-ui/primitives/issues/3012) | `DropdownMenu.Trigger` открывается на `pointerdown`; это мешает drag и scroll | #4221 open, 2026-10-16; #3012 закрыт 2025-02-24 без связанного commit-а, 2025-11-13 в нём снова жалуются | trigger внутри draggable Node-а React Flow |
| [#1159](https://github.com/radix-ui/primitives/issues/1159) | scroll ломается в Popover, открытом внутри Dialog | open с 2022-02-15, 61 comment | popover-ы в модальных окнах worfy |

- В 1.7.0 исправили близкий случай: «Fixed nested, portalled layers being unusable inside a modal
  layer» (CHANGELOG).

### Лицензия

- MIT ([repo](https://github.com/radix-ui/primitives)).

## 2. Base UI

### Что это

- Unstyled React components. Docs: «Base UI components are unstyled, don't bundle CSS, and don't
  prescribe a styling solution.» ([About](https://base-ui.com/react/overview/about))
- Происхождение: «From the creators of Radix, Material UI, and Floating UI, Base UI is an unstyled
  React component library for building accessible user interfaces.»
- Repo `mui/base-ui` создан 2024-02-23. Раньше Base UI был частью MUI. В 2024-02 MUI решила вынести его
  в отдельный repo. Цитата: «Base UI is no longer merely "Material UI without the styles"»
  ([MUI blog](https://v6.mui.com/blog/base-ui-2024-plans/)).

### Кто поддерживает, деньги, заявления

- Команда на странице About: Colm Tuite, Marija Najdova, Flavien Delangle, James Nelson, Jenna Smith,
  Michał Dudak, Aarón García.
- Связи с прошлыми проектами:
  - Colm Tuite — maker Radix UI и Modulz ([Product Hunt](https://www.producthunt.com/@colmtuite)).
  - Jenna Smith (jjenzz) — третий по числу commit-ов автор Radix Primitives (224).
  - James Nelson (atomiks) — первый по числу commit-ов автор Floating UI: 1 377
    ([contributors](https://api.github.com/repos/floating-ui/floating-ui/contributors)).
- Самые активные авторы Base UI за 12 месяцев: atomiks — 587 commit-ов, michaldudak — 128,
  aarongarciah — 116, mj12albert — 49, oliviertassinari — 48, Janpot — 46. Ещё 8 человек — от 16 до 38
  commit-ов.
- Commit-ы в master по месяцам — от 109 до 192, без пустых месяцев. Всего 1 857 за 12 месяцев.
- MUI — коммерческая компания. Она продаёт лицензии MUI X Pro и Premium («open-core»)
  ([pricing](https://mui.com/pricing/)). Open-source проекты получают и sponsorship: «Funds donated via
  Open Collective are managed transparently and aimed to sustain the MIT projects.»
  ([backers](https://mui.com/material-ui/discover-more/backers/))
- Цель из About: «Our goal is to provide a complete set of open-source UI components, with a
  delightful developer experience, in a sustainable way.»
- Roadmap. Maintainer 2026-09-17: «We recently updated the roadmap: https://github.com/orgs/mui/projects/1
  We will publish updates there…» ([#5417](https://github.com/mui/base-ui/issues/5417)). Содержимое
  project-а не прочитано: токену не хватает scope `read:project`.
- Что видно в работе по открытым PR: Listbox ([#5115](https://github.com/mui/base-ui/pull/5115)),
  Virtualizer ([#5466](https://github.com/mui/base-ui/pull/5466)), Draggable
  ([#5487](https://github.com/mui/base-ui/pull/5487)).
- Calendar слит в master 2026-03-13 ([#1973](https://github.com/mui/base-ui/pull/1973)). В списке
  компонентов docs его нет. В пакете есть `internals/temporal` и необязательные peer dependencies
  `date-fns` и `@date-fns/tz`.

### Пакеты, версии, release-ы

- Пакет — `@base-ui/react`. Install: `pnpm add @base-ui/react`
  ([quick start](https://base-ui.com/react/overview/quick-start)).
- Import по компонентам: `import { Menu } from '@base-ui/react/menu'`. В `exports` пакета 80 путей.
- Последняя версия под старым именем `@base-ui-components/react` — 1.0.0-rc.0 (2025-12-04)
  ([npm](https://registry.npmjs.org/@base-ui-components/react)). Release notes v1.0.0: «The package
  name has changed from `@base-ui-components/react` to `@base-ui/react`.»
  ([v1.0.0](https://base-ui.com/react/overview/releases/v1-0-0.md))
- v1.0.0 — 2025-12-11. До него: alpha с 2024-04, beta с 2025-05-29, rc.0 — 2025-12-04.
- Stable release-ы за 12 месяцев — 11: 1.0.0, 1.1.0, 1.2.0, 1.3.0, 1.4.0, 1.4.1, 1.5.0, 1.6.0, 1.7.0,
  1.8.0, 1.9.0 ([npm](https://registry.npmjs.org/@base-ui/react),
  [GitHub releases](https://github.com/mui/base-ui/releases)).
- Latest — 1.9.0 (2026-10-09). В нём preview-функция фильтрации в Menu: `<Menu.FilterProvider>`,
  `<Menu.Input>`, `onItemHighlighted` ([v1.9.0](https://base-ui.com/react/overview/releases/v1-9-0.md)).
- Semver в 1.x. Breaking changes в minor release-ах были только у preview-компонентов:
  - 1.3.0 — Drawer перестал быть preview, сменился путь import-а.
  - 1.5.0 — OTP Field: `sanitizeValue()` переименован в `normalizeValue()`.
  - 1.6.0 — OTP Field перестал быть preview.
- Repo на 2026-11-11: 11 371 stars, 321 open issues, 131 open PR. Последний commit — 2026-11-10
  (`5aacdbb78`).

### React 19

- peerDependencies 1.9.0: `react` и `react-dom` `^17 || ^18 || ^19`. `@types/react`, `date-fns`,
  `@date-fns/tz` — optional. React 19.3 подходит.
- About: «Base UI supports React 17 and newer versions.»
- Исправления под возможности React 19 в release notes:
  - 1.1.0: «Fix `Maximum update depth exceeded` error with Suspense» (PR #3700).
  - 1.2.0: «Fix max update depth loop when using `<React.Activity>`» (PR #3931).
  - 1.9.0: «Keep item registration in sync when items change under Strict Mode» (PR #5862).
- Dependencies: `@babel/runtime`, `@base-ui/utils` 0.5.0, `@floating-ui/utils`,
  `@floating-ui/react-dom`, `use-sync-external-store`. Внутри пакета лежит своя копия Floating UI React
  (папка `floating-ui-react`, 529 KB).

### Стилизация

- Docs: «Base UI is compatible with Tailwind, CSS Modules, plain CSS, CSS-in-JS, or any other styling
  engine you prefer.» ([About](https://base-ui.com/react/overview/about))
- `className` принимает строку или функцию от state: `className={(state) => (state.checked ? 'checked'
  : 'unchecked')}` ([styling](https://base-ui.com/react/handbook/styling.md)). `style` — тоже.
- Состояние — в отдельных data attributes: `[data-checked]`, `[data-unchecked]`, `[data-highlighted]`,
  `[data-pressed]`, `[data-disabled]`. Для анимаций — `[data-starting-style]` и `[data-ending-style]`.
- CSS variables (из страниц компонентов):
  - Popover, Menu, Tooltip, Navigation Menu: `--anchor-width`, `--anchor-height`, `--available-width`,
    `--available-height`, `--positioner-width`, `--positioner-height`, `--popup-width`,
    `--popup-height`, `--transform-origin`.
  - Select: `--anchor-width/height`, `--available-width/height`, `--transform-origin`.
  - Dialog: `--nested-dialogs`.
  - Toast: `--toast-index`, `--toast-height`, `--toast-offset-y`, `--toast-frontmost-height`,
    `--toast-swipe-movement-x/y`.
  - Accordion: `--accordion-panel-height/width`. Collapsible: `--collapsible-panel-height/width`.
  - Tabs: `--active-tab-left/right/top/bottom/width/height`.
  - Scroll Area: `--scroll-area-thumb-height/width`, `--scroll-area-corner-height/width`,
    `--scroll-area-overflow-x-start/end`, `--scroll-area-overflow-y-start/end`.
- Portal: «By default, the portal element is appended to `<body>`.» Prop `container` принимает
  `HTMLElement`, `ShadowRoot` или ref ([popover](https://base-ui.com/react/components/popover.md)).
- Quick start просит добавить `isolation: isolate` на root приложения. Так popup-ы оказываются выше
  контента, и чужой `z-index` им не мешает.
- Inline-теги. ScrollArea.Viewport и Select с `alignItemWithTrigger` вставляют `<style>`, чтобы скрыть
  native scrollbar. Inline `<script>` — только по opt-in ([CSP Provider](https://base-ui.com/react/utils/csp-provider.md)).
  CSP worfy inline-стили разрешает, а opt-in script worfy не нужен (нет SSR).

### Accessibility

- «Base UI components adhere to the WAI-ARIA Authoring Practices to provide basic keyboard
  accessibility out of the box.» ([accessibility](https://base-ui.com/react/overview/accessibility))
- «Many components provide support for arrow keys, alphanumeric keys, Home, End, Enter, and Esc.»
- «Base UI components manage focus automatically following a user interaction.»
- Видимый focus — на разработчике: «it's the developer's responsibility to visually indicate focus.»
- Labels: Field, Fieldset, Form и Input связывают controls с labels автоматически.
- Dialog `modal`: `true` (focus trap, scroll lock, pointer снаружи отключён), `false` или
  `'trap-focus'` (focus trap без scroll lock). Есть `disablePointerDismissal`, `initialFocus`,
  `finalFocus` ([dialog](https://base-ui.com/react/components/dialog.md)).
- Dismiss: `onOpenChange(open, eventDetails)`. В `eventDetails.reason` приходит причина:
  `outside-press`, `escape-key`, `focus-out`, `trigger-press`, `close-press` и другие.
  `eventDetails.cancel()` отменяет смену состояния
  ([customization](https://base-ui.com/react/handbook/customization.md)).
- Typeahead: Select — «basic keyboard typeahead functionality». У Menu prop `label` у item: «Overrides
  the text used for keyboard text navigation and filtering.»

### Компоненты (llms.txt, 2026-11-11)

- 37 компонентов: Accordion, Alert Dialog, Autocomplete, Avatar, Button, Checkbox, Checkbox Group,
  Collapsible, Combobox, Context Menu, Dialog, Drawer, Field, Fieldset, Form, Input, Menu, Menubar,
  Meter, Navigation Menu, Number Field, OTP Field, Popover, Preview Card, Progress, Radio Group, Scroll
  Area, Select, Separator, Slider, Switch, Tabs, Toast, Toggle, Toggle Group, Toolbar, Tooltip
  ([llms.txt](https://base-ui.com/llms.txt)).
- 4 utilities: CSP Provider, Direction Provider, `mergeProps`, `useRender`.

Что есть только в одной из двух библиотек:

| только в Radix | только в Base UI | одно и то же под разными именами |
|---|---|---|
| Aspect Ratio, Label, Password Toggle Field (`unstable_`), Accessible Icon, Visually Hidden, отдельные Portal и Slot | Autocomplete, Combobox, Button, Checkbox Group, Drawer, Field, Fieldset, Input, Meter, Number Field, CSP Provider, фильтрация в Menu (preview) | Dropdown Menu ↔ Menu; Hover Card ↔ Preview Card; One-Time Password Field ↔ OTP Field; Slot ↔ `useRender` + `mergeProps` |

### Размер

- Docs размеров не публикуют (не нашёл).
- bundlephobia для 1.9.0, каждый export отдельно: Dialog — 20.9 KB gzip, Popover — 37.5 KB, Menu —
  56.3 KB ([bundlephobia](https://bundlephobia.com/package/@base-ui/react@1.9.0)). Полная таблица — в
  разделе «Radix против Base UI».
- Весь пакет: 522.8 KB min, 166.4 KB gzip.
- Unpacked в npm: 10 377 319 B, 3 451 файл. Из них около 3.8 MB — docs в Markdown внутри пакета (папка
  `docs`, по [unpkg](https://unpkg.com/@base-ui/react@1.9.0/?meta)).

### Известные проблемы, важные для worfy

| issue | что происходит | статус | почему важно worfy |
|---|---|---|---|
| [#5410](https://github.com/mui/base-ui/issues/5410) | non-modal Popover (и Menu с `modal={false}`) не закрывается, когда пользователь нажимает внутри same-origin iframe | open, 2026-08-04 | Browser Node worfy — `<webview>` |
| [#6150](https://github.com/mui/base-ui/issues/6150) | `Menu.Trigger` открывается на `mousedown`; внутри draggable элементов это конфликтует с drag | open, 2026-10-30, «waiting for maintainer» | trigger внутри Node-а React Flow |
| [#629](https://github.com/mui/base-ui/issues/629) | компоненты ломались в iframe, popup-окне и shadow DOM | closed 2024-10-01 как completed, PR [#660](https://github.com/mui/base-ui/pull/660) «Reference `ownerDocument`» | другой `document` поддержан лучше, чем в Radix |

- По #5410 maintainer atomiks 2026-08-13 предложил обходной путь: «make the Popover `modal`, or at least
  cover the iframe with an overlay element whenever a popover is opened».
- Он же 2026-08-25: «this appears to have been broken for a long time and most other libraries haven't
  handled iframe interactions either (Radix, React Aria, Ariakit until July this year).»
- WordPress Gutenberg держит свои обходные пути для Menu, Popover, Select, Combobox и Autocomplete
  (комментарии в #5410).
- Shadow DOM: исправления в 1.3.0, 1.4.0, 1.7.0 и 1.9.0 (release notes). Для worfy это не главное.

### Лицензия

- MIT ([repo](https://github.com/mui/base-ui)).

## 3. shadcn/ui

### Что это и что значит «open code»

- Docs: «This is not a component library. It is how you build your component library.»
  ([introduction](https://ui.shadcn.com/docs))
- Принципы из docs: Open Code, Composition, Distribution, Beautiful Defaults, AI-Ready.
- Open Code: «The top layer of your component code is open for modification.» И: «shadcn/ui hands you
  the actual component code. You have full control to customize and extend the components to your
  needs.»
- Пример из docs: «With shadcn/ui, you simply edit the button code directly.»
- Устройство: CLI копирует файл компонента (`.tsx` с классами Tailwind) в `components/ui` проекта.
  Поведение и accessibility берутся из npm-пакета primitives: `@base-ui/react`, `radix-ui` или
  `react-aria-components`.
- Пример файла: `dialog.tsx` стиля base-nova — 166 строк, классы Tailwind прямо в JSX
  ([registry](https://ui.shadcn.com/r/styles/base-nova/dialog.json)).

### Кто поддерживает

- Автор — shadcn. Vercel пишет: «The project started as a personal side project in January 2023.» Автор
  «joined Vercel shortly after». Сейчас проект «runs as a Vercel-supported open-source project»
  ([Vercel](https://vercel.com/i/what-is-shadcn)).
- v0, AI app builder Vercel, генерирует код на shadcn/ui (там же).
- За 12 месяцев в main 1 521 commit. shadcn — 852, dependabot — 120, github-actions — 68, kapishdima —
  21. У каждого из остальных авторов меньше 15 commit-ов.
- Публичного roadmap нет. Есть changelog с записями каждый месяц
  ([changelog](https://ui.shadcn.com/docs/changelog)).
- Обещание про primitives 2026-07-02: «Radix is not being deprecated. We still support it, and every
  update and new component will ship for both libraries (unless a component only exists in Base UI).»

### Версии и release-ы

- Версии есть у CLI `shadcn`, у самих компонентов — нет. Latest CLI — 4.23.0 (2026-10-27)
  ([npm](https://registry.npmjs.org/shadcn)).
- Stable release-ов CLI за 12 месяцев — 65 (от 3.5.1 до 4.23.0). Всего версий с canary/beta/rc — 108.
- CLI v4 вышел 2026-03-06 ([changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)).
- Repo на 2026-11-11: 127 911 stars, 776 open issues, 992 open PR. Последний commit — 2026-11-11
  (`dd41d19e2`).
- Важные события:

| дата | что изменилось | источник |
|---|---|---|
| 2025-12-12 | `npx shadcn create`: выбор Radix или Base UI, 5 visual styles | [changelog](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create) |
| 2026-01-20 | полная документация компонентов на Base UI | [changelog](https://ui.shadcn.com/docs/changelog/2026-01-base-ui) |
| 2026-02-02 | style `new-york` перешёл на единый пакет `radix-ui`; `shadcn migrate radix` | [changelog](https://ui.shadcn.com/docs/changelog/2026-02-radix-ui) |
| 2026-03-06 | CLI v4: presets, `--dry-run`, `--diff`, `--view`, templates, `--base` | [changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4) |
| 2026-04-08 | `shadcn apply`: применить preset к существующему проекту | [changelog](https://ui.shadcn.com/docs/changelog/2026-04-shadcn-apply) |
| 2026-05-31 | `shadcn eject`: встроить `shadcn/tailwind.css` и убрать dependency `shadcn` | [changelog](https://ui.shadcn.com/docs/changelog/2026-05-shadcn-eject) |
| 2026-07-02 | Base UI — default для новых проектов | [changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default) |
| 2026-07-17 | React Aria — третья база (`--base aria`) | [changelog](https://ui.shadcn.com/docs/changelog/2026-07-react-aria) |
| 2026-09-03 | `cn` из пакета `cn` вместо `clsx` + `tailwind-merge` | [changelog](https://ui.shadcn.com/docs/changelog/2026-09-cn) |

### Какой стек попадает в проект

Style `base-nova` — default из примера `components.json`. Его registry item `index` объявляет зависимости
([base-nova](https://ui.shadcn.com/r/styles/base-nova/index.json),
[radix-nova](https://ui.shadcn.com/r/styles/radix-nova/index.json)):

| пакет | роль | latest на 2026-11-11 |
|---|---|---|
| `tailwindcss` + `@tailwindcss/vite` | стили; ставятся до CLI по docs Vite | 4.3.5 (2026-11-06) |
| `@base-ui/react` (base-*) или `radix-ui` (radix-*) | primitives | 1.9.0 / 1.8.1 |
| `class-variance-authority` | variants компонентов | 0.7.1 (2024-11-26), Apache-2.0 |
| `cn` | склейка классов, замена `twMerge(clsx(...))` | 0.5.2 (2026-11-02), без dependencies |
| `lucide-react` | иконки по умолчанию (`iconLibrary: "lucide"`) | 1.72.0 (2026-11-11), ISC |
| `tw-animate-css` (devDependency) | CSS-анимации для Tailwind v4 | 1.4.0 (2025-09-24) |
| `shadcn` (devDependency) | файл `shadcn/tailwind.css`: общие custom variants (`data-open:`, `data-closed:`, `data-checked:`…) и keyframes | 4.23.0 |

- `clsx` (2.1.1) и `tailwind-merge` (3.7.0) — стек до 2026-09-03. Старые проекты переходят командой
  `shadcn migrate cn`. Она требует Tailwind CSS v4 ([CLI](https://ui.shadcn.com/docs/cli)).
- Docs ручной установки: `npm install shadcn class-variance-authority cn lucide-react tw-animate-css`
  ([manual](https://ui.shadcn.com/docs/installation/manual)).
- Отдельные компоненты приносят свои пакеты (registry JSON):
  - Command → `cmdk`. cmdk 1.1.1 вышел 2025-03-14 и сам зависит от `@radix-ui/react-dialog`. Значит,
    Radix попадает в проект даже при base-nova.
  - Sonner → `sonner` и `next-themes`.
  - Calendar → `react-day-picker` и `date-fns`.
  - Resizable → `react-resizable-panels`.
  - Drawer → `vaul` в radix-* styles и `@base-ui/react` в base-* styles. README Vaul: «This repo is
    unmaintained.» ([vaul](https://github.com/emilkowalski/vaul))
- `shadcn/tailwind.css` поддерживает обе библиотеки сразу. Пример: variant `data-open` срабатывает и
  на `[data-state="open"]` (Radix), и на `[data-open]` (Base UI)
  ([файл](https://unpkg.com/shadcn@4.23.0/dist/tailwind.css)).

### Можно ли без Tailwind

Официального пути нет. Факты:

- Docs ручной установки, шаг 1: «Components are styled using Tailwind CSS. You need to install Tailwind
  CSS in your project.» ([manual](https://ui.shadcn.com/docs/installation/manual))
- `--no-css-variables` (`tailwind.cssVariables: false`) не убирает Tailwind. Он только генерирует
  «inline Tailwind color utilities» вместо semantic tokens
  ([components.json](https://ui.shadcn.com/docs/components-json)).
- `shadcn eject` убирает dependency `shadcn`, но не Tailwind.
- `components.json` нужен только для CLI: «If you're using the copy and paste method, you don't need
  this file.» Но скопированный код всё равно состоит из классов Tailwind.
- Registry и CLI умеют раздавать любой код: «The registry works with any project type and any
  framework, and is not limited to React.» ([registry](https://ui.shadcn.com/docs/registry)) Так можно
  раздавать свои компоненты без Tailwind. Но это уже не компоненты shadcn/ui.
- Primitives под shadcn/ui (Base UI, Radix) работают без Tailwind сами по себе.

### CLI, components.json, registry

- `init` (alias `create`) настраивает проект: dependencies, `cn`, CSS variables. Флаги: `-t/--template`
  (next, vite, start, react-router, laravel, astro), `-b/--base` (base, radix, aria), `-p/--preset`,
  `--rtl`, `--monorepo`, `--reinstall` ([CLI](https://ui.shadcn.com/docs/cli)).
- `--defaults` = `--template=next --preset=nova`.
- `add` копирует компонент. Флаги: `--overwrite`, `--dry-run`, `--diff [path]`, `--view [path]`,
  `--all`, `--path`.
- Ещё команды: `view`, `search`/`list`, `build` (собрать свой registry), `docs`, `info`, `migrate`
  (`cn`, `icons`, `base-color`, `radix`, `rtl`), `apply`, `preset` (`decode`, `resolve`, `url`,
  `open`), `eject`.
- В dependencies CLI есть `@modelcontextprotocol/server`: у CLI есть MCP server
  ([npm](https://registry.npmjs.org/shadcn)). Для агентов есть skill: `npx skills add shadcn/ui`.
- `components.json` хранит `style`, `tailwind.css`, `tailwind.baseColor`, `tailwind.cssVariables`,
  `tailwind.prefix`, aliases и `iconLibrary`. Про `style` docs пишут: «This cannot be changed after
  initialization.» ([components.json](https://ui.shadcn.com/docs/components-json))
- Styles. 2025-12-12 вышли Vega («The classic shadcn/ui look»), Nova, Maia, Lyra, Mira. К 2026-07-17
  добавились Luma, Rhea и Sera — всего 8. Имя style в `components.json` включает базу: `base-nova`,
  `radix-nova`.
- Preset — короткий код, в котором закодированы цвета, theme, иконки, шрифты и radius:
  `npx shadcn@latest init --preset a1Dg5eFl`. Preset переписывает код компонентов, не только цвета:
  «Your config doesn't just change colors, it rewrites the component code to match your setup.»
- Registries с namespace: `@shadcn/button`, `@acme/auth-utils`. URL-шаблон и параметры (в том числе
  версия) задаются в `components.json`. Есть auth для private registries
  ([namespaces](https://ui.shadcn.com/docs/registry/namespace)).
- GitHub registries — с 2026-06. Private GitHub repo — с 2026-08. Directory community registries
  встроен в CLI ([changelog](https://ui.shadcn.com/docs/changelog)).

### Как исправления доходят до уже скопированного кода

- Автоматических обновлений нет. Код в проекте — ваш.
- FAQ в docs: «the core of your app can receive fixes by updating your dependencies, for instance,
  @base-ui/react or input-otp. The topmost layer, i.e., the one closest to your design system, is not
  coupled with the implementation of the library.» ([introduction](https://ui.shadcn.com/docs))
- Значит, исправления primitives приходят обычным обновлением npm-пакета. Исправления в самом
  `dialog.tsx` — нет.
- CLI v4: «You can use the `--diff` flag to check for registry updates. Or ask your agent: "check for
  updates from @shadcn and merge with my local changes".» Команда:
  `npx shadcn@latest add button --diff`.
- `add --overwrite` заменяет файл целиком. Локальные правки при этом пропадают.
- `init --reinstall` переустанавливает уже добавленные компоненты. CLI v4: при `init --preset` CLI
  перенастраивает и компоненты.
- Версий у элементов registry `@shadcn` docs не описывают. Версионирование описано для своих registry —
  через query-параметры URL.

### Theming

- Docs: «We use and recommend CSS variables for theming.» ([theming](https://ui.shadcn.com/docs/theming))
- «Override those tokens in your CSS to change the look of your app without rewriting component
  classes.»
- Tokens: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`,
  `destructive`, `border`, `input`, `ring`, `chart-1`…`chart-5`, 8 tokens `sidebar-*`, `radius` — каждый
  с парой `*-foreground`, где она нужна.
- Значения — в OKLCH, в блоках `:root` и `.dark`. Пример: `--primary: oklch(0.205 0 0)`.
- `@theme inline` связывает tokens с utilities Tailwind: `bg-background`, `text-foreground`,
  `border-border`, `ring-ring`.
- Новый token — в `:root`, `.dark` и `@theme inline`. Пример из docs — `--warning`.
- HSL заменили на OKLCH при переходе на Tailwind v4
  ([Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)).
- `tailwind.baseColor` нельзя сменить после init. Но есть команда `migrate base-color`.

### Внешний вид по умолчанию и цена своего вида

- Сам shadcn признал проблему 2025-12-12: «But somewhere along the way, all apps started looking the
  same. I guess the defaults were a little _too_ good. My bad.»
  ([changelog](https://ui.shadcn.com/docs/changelog/2025-12-shadcn-create))
- Ответ проекта — 8 styles и presets. Это всё равно вид shadcn/ui, только в одном из восьми вариантов.
- Что меняется через tokens: цвета, radius, шрифты. Это CSS variables, классы компонентов не трогаются.
- Что не меняется через tokens: отступы, размеры, тени, типографика внутри компонента. Они записаны
  классами Tailwind в каждом скопированном файле. Пример из `dialog.tsx` base-nova:
  `rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10`.
- Оценка для worfy. Чтобы сохранить свой вид, нужно:
  - перевести цвета, radius и шрифты worfy в tokens shadcn;
  - выбрать ближайший style и preset;
  - затем править классы в каждом скопированном компоненте.

  После таких правок `--diff` с registry показывает и ваши изменения. Merge обновлений становится
  ручной работой.

### Компоненты

- В llms.txt 59 компонентов: Field, Button, Button Group, Input, Input Group, Input OTP, Textarea,
  Checkbox, Radio Group, Select, Native Select, Switch, Slider, Calendar, Date Picker, Combobox, Label,
  Accordion, Breadcrumb, Navigation Menu, Sidebar, Tabs, Separator, Scroll Area, Resizable, Dialog,
  Alert Dialog, Sheet, Drawer, Popover, Tooltip, Hover Card, Context Menu, Dropdown Menu, Menubar,
  Command, Alert, Toast, Sonner, Progress, Spinner, Skeleton, Badge, Empty, Avatar, Card, Table, Data
  Table, Chart, Carousel, Aspect Ratio, Typography, Item, Kbd, Collapsible, Toggle, Toggle Group,
  Pagination, Direction ([llms.txt](https://ui.shadcn.com/llms.txt)).
- Changelog добавляет новые: Trace и Code Block (2026-10), Questionnaire (2026-08).
- Сам llms.txt устарел в описании: «It is built with TypeScript, Tailwind CSS, and Radix UI primitives.»

### Известные проблемы, важные для worfy

- CLI определяет Vite только по файлу `vite.config.*`
  ([get-project-info.ts, строки 155–160](https://github.com/shadcn-ui/ui/blob/954ce953412867a57b7e067c076fa7fd395ea115/packages/registry/src/get-project-info.ts#L155-L160)).
  У worfy файл называется `electron.vite.config.ts`. Значит, автоматическое определение не сработает.
- Issue [#5005](https://github.com/shadcn-ui/ui/issues/5005) (init в electron-vite) показывал ошибку
  «We could not detect a supported framework». Обходной путь из комментариев — копия конфига как
  `vite.config.ts`. Issue закрыт 2025-10-16 как устаревший, без fix-а.
- Официальный шаблон [shadcn/shadcn-electron-app](https://github.com/shadcn/shadcn-electron-app)
  устарел: последний push 2024-11-12, Tailwind 3.4, React 18, `tailwindcss-animate`.
- Tailwind v4 кладёт utilities в `@layer utilities`
  ([preflight](https://tailwindcss.com/docs/preflight)). MDN: «Styles that are not defined in a layer
  always override styles declared in named and anonymous layers.»
  ([@layer](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer)) CSS worfy не в layer-ах.
  Значит, при совпадении свойств старые правила worfy переопределят классы Tailwind.
- `@import "tailwindcss"` включает Preflight — reset базовых стилей. Docs Tailwind: при интеграции в
  существующий проект Preflight можно не подключать (импортировать только `theme.css` и
  `utilities.css`).
- Tailwind v4 требует Chrome 111+ ([compatibility](https://tailwindcss.com/docs/compatibility)).
  Chromium в Electron 44 новее. Ограничения нет.
- Docs Tailwind не советуют CSS Modules вместе с Tailwind: «Using CSS modules and Tailwind together is
  not recommended if you can avoid it.»

### Лицензия

- MIT ([repo](https://github.com/shadcn-ui/ui)). `cn`, `shadcn`, `tw-animate-css` — MIT.
  `class-variance-authority` — Apache-2.0. `lucide-react` — ISC.

## 4. Radix против Base UI

### API

| аспект | Radix | Base UI |
|---|---|---|
| composition | `asChild`: «Radix will not render a default DOM element, instead cloning the part's child» ([composition](https://www.radix-ui.com/primitives/docs/guides/composition)) | `render`: element или функция `(props, state) => ReactElement`; плюс `useRender` и `mergeProps` ([composition](https://base-ui.com/react/handbook/composition.md)) |
| требование к своему компоненту | передать все props в DOM-узел и принять ref через `React.forwardRef` | «must forward the `ref`, and spread all the received props» |
| state для CSS | `data-state="open"`, `data-state="checked"`, `data-side`, `data-align` | отдельные атрибуты: `data-open`, `data-closed`, `data-checked`, `data-starting-style`, `data-ending-style` |
| `className` | строка | строка или функция от state |
| CSS variables у popup-ов | `--radix-<component>-trigger-width`, `--radix-<component>-content-available-height`, `--radix-<component>-content-transform-origin` | `--anchor-width`, `--available-height`, `--transform-origin`, `--positioner-*`, `--popup-*` |
| структура popup-а | Portal → Content (Content сам позиционируется) | Portal → Positioner → Popup |
| смена open | `onOpenChange(open)` и отдельные callback-и: `onEscapeKeyDown`, `onPointerDownOutside`, `onFocusOutside`, `onInteractOutside` | `onOpenChange(open, eventDetails)` с `reason`, `cancel()`, `allowPropagation()` |
| modal | `modal: boolean` | `modal: true \| false \| 'trap-focus'` |
| focus при открытии и закрытии | `onOpenAutoFocus`, `onCloseAutoFocus` | `initialFocus`, `finalFocus` |
| portal container | `HTMLElement` | `HTMLElement`, `ShadowRoot` или ref |
| другой `document` (iframe, окно) | глобальный `document` в части обработчиков ([#1721](https://github.com/radix-ui/primitives/issues/1721), open) | `ownerDocument` с 2024-10 ([#660](https://github.com/mui/base-ui/pull/660)) |
| positioning | Floating UI (`@floating-ui/react-dom`) | Floating UI + своя копия Floating UI React внутри пакета |
| docs для агентов | — | `llms.txt` и Markdown-docs внутри npm-пакета |

Пример composition. Radix:

```tsx
<Tooltip.Trigger asChild>
  <MyButton>Open</MyButton>
</Tooltip.Trigger>
```

Base UI:

```tsx
<Tooltip.Trigger render={<MyButton />}>Open</Tooltip.Trigger>
```

### Размер bundle (bundlephobia, export отдельно, min+gzip, 2026-11-11)

| компонент | Radix (`radix-ui` 1.8.1) | Base UI (`@base-ui/react` 1.9.0) |
|---|---|---|
| Dialog | 13.2 KB | 20.9 KB |
| Popover | 23.5 KB | 37.5 KB |
| Dropdown Menu / Menu | 30.3 KB | 56.3 KB |
| Context Menu | 30.4 KB | 45.5 KB |
| Select | 30.4 KB | 41.1 KB |
| Tooltip | 19.3 KB | 30.8 KB |
| Toast | 11.7 KB | 23.7 KB |
| Tabs | 8.9 KB | 11.7 KB |
| Scroll Area | 7.4 KB | 7.2 KB |
| весь пакет | 74.3 KB | 166.4 KB |

- Каждая цифра считает общий код (Floating UI, utils) заново. Сумма для приложения меньше суммы
  строк.
- Оценка для worfy: код Electron-приложения грузится с диска, сеть не участвует. Остаётся время
  parse, его не измеряли.

### Зрелость и темп работы

| показатель | Radix | Base UI |
|---|---|---|
| repo создан | 2020-06-19 | 2024-02-23 |
| v1 | Primitives в 1.x давно; umbrella `radix-ui` 1.1.0 — 2025-01-22 | 1.0.0 — 2025-12-11 |
| stable release-ы за 12 месяцев | 12, все в 2026-06…2026-10 | 11, почти каждый месяц |
| commit-ы за 12 месяцев | 287, из них 237 у одного человека | 1 857, у 6 человек больше 45 |
| merged PR за 12 месяцев | 149 | 1 838 (с bot-ами renovate) |
| закрыто issue за 12 месяцев | 583 (359 — в июне 2026) | 668 |
| open issues / open PR | 140 / 148 | 321 / 131 |
| последний commit | 2026-10-14 | 2026-11-10 |
| stars | 19 492 | 11 371 |

### Momentum: weekly downloads во времени

Сумма за 7 дней до указанной даты ([api.npmjs.org range](https://api.npmjs.org/downloads/range/2025-11-04:2026-11-10/@base-ui/react)):

| неделя до | `@base-ui/react` | `@base-ui-components/react` | `radix-ui` | `@radix-ui/react-dialog` | `react-aria-components` | `@ark-ui/react` |
|---|---|---|---|---|---|---|
| 2025-11-10 | — (пакета ещё нет) | 0.27M | 0.89M | 12.98M | 0.93M | 0.49M |
| 2026-03-02 | 1.18M | 0.30M | 3.22M | 21.00M | 1.42M | 0.51M |
| 2026-07-01 | 6.47M | 0.38M | 9.21M | 59.70M | 3.11M | 0.95M |
| 2026-09-01 | 11.74M | 0.51M | 13.07M | 69.56M | 3.99M | 1.06M |
| 2026-11-10 | 29.13M | 1.09M | 27.35M | 92.57M | 9.12M | 1.45M |

- С 2026-07-01 по 2026-11-10 `@base-ui/react` вырос в 4.5 раза, `radix-ui` — в 3.0 раза,
  `@radix-ui/react-dialog` — в 1.55 раза.
- `@radix-ui/react-dialog` больше всех, потому что его ставят и транзитивно: через `radix-ui`, cmdk,
  Vaul и другие библиотеки.
- Цифры npm включают CI и транзитивные установки. За год выросли все пакеты в таблице. Поэтому
  сравнивать стоит соотношения, а не абсолютные числа.

### Что выбирают новые проекты в 2026 (первичные источники)

- shadcn/ui, 2026-07-02: «Projects created on shadcn/create now pick Base UI over Radix 2 to 1.»
- Там же: «Every new project we've started runs on Base UI.» И: «Starting something new? We recommend
  Base UI.»
- Там же — причина: «Base UI is stable. It's at 1.6.0 with 6M+ weekly downloads.» Цифра совпадает с
  npm: 6.47M за неделю до 2026-07-01.
- WordPress Gutenberg: пакет `@wordpress/ui` 0.26.0 зависит от `@base-ui/react` `^1.9.0`. Radix в нём
  нет ([package.json](https://github.com/WordPress/gutenberg/blob/trunk/packages/ui/package.json)).
- Публичных заявлений WorkOS о планах Radix на 2026 год я не нашёл. Последнее развёрнутое — SE Daily
  2025-11: «fairly mature».

### Путь миграции Radix → Base UI

- В проекте на shadcn/ui shadcn предлагает skill, а не codemod: `npx skills add shadcn/ui`, затем
  агенту «migrate accordion to base-ui»
  ([changelog](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)).
- Почему skill: «A codemod handles the components you never touched and breaks on the ones you did.»
- Миграция идёт по одному компоненту: «Both libraries coexist while you work.» На каждый компонент —
  commit и отчёт в `.migration/`.
- Замер shadcn: «60+ components, 36 of them on Radix. A full migration ran in about 25 minutes at
  roughly 10k tokens per component.»
- Без shadcn/ui механические замены такие:
  - `asChild` → `render`;
  - `data-state="open"` → `data-open` / `data-closed`; `data-state="checked"` → `data-checked`;
  - `--radix-popover-trigger-width` → `--anchor-width`; `--radix-*-content-available-height` →
    `--available-height`; `--radix-*-content-transform-origin` → `--transform-origin`;
  - Popover.Content → Popover.Portal + Positioner + Popup;
  - Dropdown Menu → Menu; Hover Card → Preview Card; One-Time Password Field → OTP Field;
  - `onEscapeKeyDown` / `onPointerDownOutside` / `onInteractOutside` → `onOpenChange` с
    `eventDetails.reason` и `cancel()`;
  - `onOpenAutoFocus` / `onCloseAutoFocus` → `initialFocus` / `finalFocus`.
- Поведение тоже различается. Пример — dismiss non-modal popup-а при клике в iframe (#5410). Это надо
  проверять руками, а не заменой текста.

## 5. Для сравнения: React Aria Components и Ark UI

**React Aria Components** (Adobe). Пакет `react-aria-components` 1.22.1, 2026-10-09; 12 stable release-ов
за 12 месяцев; Apache-2.0; peer `react` от `^16.8.0` до `^19.0.0-rc.1`
([npm](https://registry.npmjs.org/react-aria-components)). Это и «Over 50 components with built-in
behavior», и «low-level Hook-based API» ([site](https://react-aria.adobe.com/)). Стилей нет: «style-free
out of the box», есть default classes, data attributes и render props. Сильная сторона — i18n и
устройства ввода: «translations in over 30 languages», «13 calendar systems, 5 numbering systems,
right-to-left layout», отдельная логика для mouse, touch, keyboard и screen reader. С 2026-07-17
shadcn/ui умеет строить свои компоненты на React Aria (`--base aria`). Repo `adobe/react-spectrum`:
549 open issues, 865 merged PR за 12 месяцев. Почему выбрать: нужны сложные i18n-компоненты (даты,
числа, RTL) или Adobe как гарантия долгой поддержки. По словам maintainer-а Base UI, клики внутри
iframe React Aria тоже не обрабатывает (#5410).

**Ark UI** (Chakra Systems). Пакет `@ark-ui/react` 5.40.0, 2026-10-29; 24 stable release-а за 12 месяцев;
MIT; peer `react >=18.0.0` ([npm](https://registry.npmjs.org/@ark-ui/react)). Это «A headless library
with 45+ accessible components» для React, Solid, Vue и Svelte ([site](https://ark-ui.com/)). Поведение
описано state machines: 68 из 69 dependencies — пакеты `@zag-js/*`. Стилей нет: «Bring your own CSS —
Panda, Tailwind, CSS-in-JS, or plain stylesheets.» Repo `chakra-ui/ark`: 1 open issue, 8 open PR, 285
merged PR за 12 месяцев. Weekly downloads — 1.45M, в 20 раз меньше Base UI. Почему выбрать: один набор
компонентов для нескольких framework-ов или готовые машины состояний.

## 6. Применимость к worfy — факты, не решение

- React 19.3 подходит по peer dependencies Radix, Base UI, React Aria Components и Ark UI. Код
  shadcn/ui обновлён под React 19: «All components are updated for Tailwind v4 and React 19.»
  ([Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4))
- Radix и Base UI встают рядом с текущим CSS worfy. Классы задаются через `className`, состояние
  читается из data attributes. Tailwind не нужен.
- shadcn/ui потребует Tailwind v4, tokens shadcn и ручной настройки CLI под electron-vite. 12 тыс. строк
  CSS worfy не в layer-ах. Поэтому при конфликте правила worfy переопределят utilities Tailwind.
- Canvas с transform. Оба primitives по умолчанию рендерят popup в `document.body`, то есть вне
  transform React Flow. Floating UI: «portalling is the only 100% reliable method»
  ([Floating UI](https://floating-ui.com/docs/misc)). React Flow сам рисует NodeToolbar через portal:
  «This toolbar doesn't scale with the viewport» ([NodeToolbar](https://reactflow.dev/api-reference/components/node-toolbar)).
- Trigger-ы внутри Node-ов. Menu в обеих библиотеках открывается на press (Radix #4221, Base UI #6150).
  React Flow отключает drag на элементах с классом `nodrag`
  ([React Flow](https://reactflow.dev/api-reference/react-flow)).
- `<webview>` в Browser Node. Для same-origin iframe открыты проблемы в обеих библиотеках: Base UI #5410
  (popover не закрывается), Radix #4261 (focus trap отбирает focus). Обходной путь maintainer-а Base
  UI — modal popup или overlay поверх iframe.
- Несколько окон. Base UI работает с `ownerDocument`. В Radix это открытый #1721. Оценка: если каждое
  окно worfy — отдельный renderer со своим React root, проблема не возникает. Она возникает при рендере
  в чужой `document` (`window.open`, Document Picture-in-Picture).
- CSP worfy (`script-src 'self'`, `style-src 'unsafe-inline'`) пропускает inline `<style>` обеих
  библиотек. Inline `<script>` Base UI включается только по opt-in.
- Один пакет `radix-ui`, а не набор отдельных `@radix-ui/react-*`: так советует maintainer после #4189. cmdk и
  Vaul приносят свой `@radix-ui/react-dialog`. Копии нужно проверять: `pnpm why @radix-ui/react-focus-scope`.

## 7. Не проверено

- Как ведут себя dismiss и focus trap обеих библиотек с Electron `<webview>`. `<webview>` — отдельный
  процесс; issue выше описывают same-origin iframe. Нужен prototype.
- Как focus trap modal dialog-а работает вместе с xterm, который сам вызывает `focus()` на своём
  textarea.
- Работает ли `nodrag` на trigger-е Menu внутри Node-а React Flow без побочных эффектов.
- Что делает `shadcn init` 4.23.0 в проекте electron-vite: завершается с ошибкой или переходит к
  ручной настройке.
  Код определения framework прочитан, сам CLI не запускался.
- Содержимое roadmap Base UI (https://github.com/orgs/mui/projects/1): токен без scope `read:project`.
- Финансовые детали MUI и WorkOS сверх цитат выше.
- Что WorkOS планирует для Radix в 2026: публичных заявлений не нашёл.

## 8. Источники (все прочитаны 2026-11-11)

Radix:
- https://github.com/radix-ui/primitives — repo, README, описание
- https://github.com/radix-ui/primitives/blob/main/packages/react/radix-ui/CHANGELOG.md
- https://www.radix-ui.com/primitives/docs/overview/releases
- https://www.radix-ui.com/primitives/docs/overview/getting-started
- https://www.radix-ui.com/primitives/docs/guides/styling
- https://www.radix-ui.com/primitives/docs/guides/composition
- https://www.radix-ui.com/primitives/docs/overview/accessibility
- https://www.radix-ui.com/primitives/docs/utilities/portal
- https://www.radix-ui.com/primitives/docs/components/dialog
- https://www.radix-ui.com/primitives/docs/components/popover
- https://www.radix-ui.com/primitives/docs/components/scroll-area
- https://www.radix-ui.com/blog
- https://registry.npmjs.org/radix-ui, https://registry.npmjs.org/@radix-ui/react-dialog,
  https://registry.npmjs.org/@radix-ui/react-popper, https://registry.npmjs.org/@radix-ui/themes
- https://unpkg.com/radix-ui@1.8.1/dist/index.d.ts
- https://workos.com/blog/series-b
- https://softwareengineeringdaily.com/wp-content/uploads/2025/11/SED1871-Radix-UI.txt
- https://x.com/colmtuite/status/1935629877069172861 (текст через cdn.syndication.twimg.com)
- https://www.producthunt.com/@colmtuite
- Issues и PR: https://github.com/radix-ui/primitives/issues/4261,
  https://github.com/radix-ui/primitives/pull/4264, https://github.com/radix-ui/primitives/issues/1721,
  https://github.com/radix-ui/primitives/pull/4220, https://github.com/radix-ui/primitives/pull/3357,
  https://github.com/radix-ui/primitives/issues/1241, https://github.com/radix-ui/primitives/issues/3445,
  https://github.com/radix-ui/primitives/issues/2122, https://github.com/radix-ui/primitives/issues/4189,
  https://github.com/radix-ui/primitives/issues/4221, https://github.com/radix-ui/primitives/issues/3012,
  https://github.com/radix-ui/primitives/issues/1159, https://github.com/radix-ui/primitives/issues/3963,
  https://github.com/radix-ui/primitives/discussions/4170

Base UI:
- https://github.com/mui/base-ui, https://github.com/mui/base-ui/releases
- https://base-ui.com/llms.txt
- https://base-ui.com/react/overview/about
- https://base-ui.com/react/overview/quick-start
- https://base-ui.com/react/overview/accessibility
- https://base-ui.com/react/handbook/styling.md
- https://base-ui.com/react/handbook/composition.md
- https://base-ui.com/react/handbook/customization.md
- https://base-ui.com/react/components/popover.md, https://base-ui.com/react/components/dialog.md,
  https://base-ui.com/react/components/menu.md, https://base-ui.com/react/components/select.md и
  страницы tooltip, toast, scroll-area, accordion, collapsible, navigation-menu, tabs
- https://base-ui.com/react/utils/csp-provider.md
- https://base-ui.com/react/overview/releases/v1-0-0.md … v1-9-0.md
- https://registry.npmjs.org/@base-ui/react, https://registry.npmjs.org/@base-ui-components/react
- https://unpkg.com/@base-ui/react@1.9.0/?meta
- https://v6.mui.com/blog/base-ui-2024-plans/
- https://mui.com/pricing/, https://mui.com/material-ui/discover-more/backers/
- Issues и PR: https://github.com/mui/base-ui/issues/5410, https://github.com/mui/base-ui/issues/6150,
  https://github.com/mui/base-ui/issues/629, https://github.com/mui/base-ui/pull/660,
  https://github.com/mui/base-ui/issues/5417, https://github.com/mui/base-ui/pull/1973,
  https://github.com/mui/base-ui/pull/5115, https://github.com/mui/base-ui/pull/5466,
  https://github.com/mui/base-ui/pull/5487
- https://api.github.com/repos/floating-ui/floating-ui/contributors
- https://github.com/WordPress/gutenberg/blob/trunk/packages/ui/package.json

shadcn/ui:
- https://ui.shadcn.com/docs, https://ui.shadcn.com/llms.txt
- https://ui.shadcn.com/docs/cli
- https://ui.shadcn.com/docs/components-json
- https://ui.shadcn.com/docs/theming
- https://ui.shadcn.com/docs/tailwind-v4
- https://ui.shadcn.com/docs/installation/manual, https://ui.shadcn.com/docs/installation/vite
- https://ui.shadcn.com/docs/registry, https://ui.shadcn.com/docs/registry/namespace
- https://ui.shadcn.com/docs/changelog и записи 2025-12-shadcn-create, 2026-01-base-ui,
  2026-02-radix-ui, 2026-03-cli-v4, 2026-04-shadcn-apply, 2026-04-preset-commands,
  2026-05-shadcn-eject, 2026-07-base-ui-default, 2026-07-react-aria, 2026-09-cn
- https://ui.shadcn.com/r/styles/base-nova/index.json, https://ui.shadcn.com/r/styles/radix-nova/index.json,
  https://ui.shadcn.com/r/styles/base-nova/dialog.json и registry JSON компонентов command, sonner,
  drawer, calendar, resizable
- https://unpkg.com/shadcn@4.23.0/dist/tailwind.css
- https://registry.npmjs.org/shadcn, https://registry.npmjs.org/cn, https://registry.npmjs.org/tailwindcss,
  https://registry.npmjs.org/@tailwindcss/vite, https://registry.npmjs.org/tw-animate-css,
  https://registry.npmjs.org/class-variance-authority, https://registry.npmjs.org/lucide-react,
  https://registry.npmjs.org/clsx, https://registry.npmjs.org/tailwind-merge, https://registry.npmjs.org/cmdk,
  https://registry.npmjs.org/sonner, https://registry.npmjs.org/vaul
- https://vercel.com/i/what-is-shadcn
- https://github.com/shadcn-ui/ui/blob/954ce953412867a57b7e067c076fa7fd395ea115/packages/registry/src/get-project-info.ts
- https://github.com/shadcn-ui/ui/issues/5005, https://github.com/shadcn-ui/ui/issues/4994
- https://github.com/shadcn/shadcn-electron-app
- https://github.com/emilkowalski/vaul

Tailwind, CSS, React Flow, Floating UI:
- https://tailwindcss.com/docs/preflight, https://tailwindcss.com/docs/compatibility
- https://developer.mozilla.org/en-US/docs/Web/CSS/@layer
- https://reactflow.dev/api-reference/react-flow, https://reactflow.dev/api-reference/components/node-toolbar
- https://floating-ui.com/docs/misc

Для сравнения:
- https://react-aria.adobe.com/, https://registry.npmjs.org/react-aria-components, https://github.com/adobe/react-spectrum
- https://ark-ui.com/, https://registry.npmjs.org/@ark-ui/react, https://github.com/chakra-ui/ark

Размеры и downloads:
- https://bundlephobia.com/api/exports-sizes?package=radix-ui@1.8.1
- https://bundlephobia.com/api/exports-sizes?package=@base-ui/react@1.9.0
- https://bundlephobia.com/api/size?package=radix-ui@1.8.1, https://bundlephobia.com/api/size?package=@base-ui/react@1.9.0
- https://api.npmjs.org/downloads/point/last-week/<package> и
  https://api.npmjs.org/downloads/range/2025-11-04:2026-11-10/<package> для каждого пакета из таблиц
