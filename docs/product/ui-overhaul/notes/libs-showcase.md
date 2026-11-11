# Коллекции компонентов «как код»: Beautiful UI, RareUI, Magic UI, Aceternity UI, 21st.dev

Заметка агента для темы `ui-overhaul`. Это тема Product Session о том, переводить ли UI worfy на готовые
компоненты ([map.md](../map.md)). Все источники прочитаны 2026-11-11.

## Сводная таблица

| Название | Что это | Распространение | Зависимости типичного компонента | Лицензия: free / paid, OSS-ok? | Доля app UI | Fit для worfy |
|---|---|---|---|---|---|---|
| Beautiful UI | 21 primitive для agent UI. Автор — Shane Levine, студия Turbo. С июля 2026 | shadcn CLI по URL (`/r/<name>.json`) или copy-paste. В официальном индексе shadcn нет | Tailwind v4 и обязательный `foundation.css`. Без motion. В отдельных компонентах glimm (WebGL), liveline, iconoir-react, платные Central Icons | MIT. Платного уровня нет. OSS-ok: да. Исключение — Sidebar Nav: его иконки требуют платную лицензию | ~100 % (21 из 21) | Высокий как образец: chat Sessions, loading states, selection toolbar. Переносить в свой CSS |
| RareUI | Личная коллекция Swapnil Kalambe: 21 декоративный компонент. С декабря 2025 | Свой CLI `npx rareui add` или copy-paste. JSON в формате shadcn на `/r/` | Tailwind v4 (сайт пишет «3+»), framer-motion или motion, three, свой WebGL2, `next/dynamic` | MIT. Всё бесплатно. OSS-ok: да | ~20 % (4 из 21), все с тяжёлым декором | Низкий. Нет ARIA и prefers-reduced-motion. Repo без коммитов с 2026-04-06 |
| Magic UI | Анимированные компоненты для landing page. Автор — Dillion Verma, с лета 2023. Плюс платный Magic UI Pro | shadcn registry `@magicui` в официальном индексе (status healthy). MCP server | Tailwind v4 (v3 — отдельный legacy-сайт). motion в 30 из 79. Иногда cobe, canvas-confetti, shiki, Radix | Free — MIT, OSS-ok: да. Pro — $199 разово, OSS-ok: нет | ~10 % (8 из 79), и то демо для landing page | Низкий для app UI. Точечно для Guide и onboarding |
| Aceternity UI | Коммерческая коллекция эффектов для landing page. Автор — Manu Arora, Aceternity Labs LLC, с декабря 2023 | Copy-paste, shadcn registry `@aceternity` (в индексе status degraded), shadcn MCP. Templates — zip | Tailwind v4, motion, @tabler/icons-react. Иногда three, `@react-three/fiber@alpha`, tsparticles | Free — своя лицензия, OSS-ok: неясно. All-Access $169–$1 590, OSS-ok: нет | ~16 % (18 из 114) | Низкий: лицензия, слабая a11y, тяжёлые эффекты |
| 21st.dev | Marketplace 12 000+ компонентов разных авторов, 21st Labs Inc. С сентября 2024. Плюс генератор 21st AI (бывший Magic Chat) и 21st MCP (бывший Magic MCP) | shadcn CLI по URL с API key, «Copy prompt» для агента, MCP, CLI. Бесплатно — 2 копии в день | Зависит от автора. Обычно Tailwind, TypeScript, lucide-react, motion или framer-motion, Radix или Base UI. Иногда `next`, gsap | Лицензию выбирает автор. В выборке из 40: 31 MIT, 1 Apache-2.0, 8 без пригодной лицензии. Сверху ToS 21st. Builder $6/мес, AI от $15/мес. OSS-ok: только MIT и Apache, со ссылкой на 21st | ~23 % по тегам категорий. Точная доля — не проверено | Низкий как источник кода. Полезен как каталог примеров. Agent Elements (MIT) — образец tool cards |

## Как собраны данные

- Источники: сайты, docs, страницы license и terms, JSON из registry, `gh api`, metadata из npm registry.
- Пакеты не ставились. shadcn CLI не запускался.
- «App UI» здесь — inputs, menus, dialogs, tabs, tooltips, tables, sidebars, loaders, вывод кода.
- «Маркетинг» — animated backgrounds, hero sections, marquee, 3D cards, text effects, device mockups.
- Доли app UI я посчитал сам по спискам компонентов. Это оценка, а не цифры авторов.
- Факты о worfy из [map.md](../map.md): React 19.3.0, Tailwind нет, библиотеки компонентов нет, 42 файла `.css`
  на 12 478 строк.
- `gh api repos/IDSAD-XL/worfy` показывает `visibility: public` и `license: null`. Исходники видны всем.
  Поэтому код из платного уровня любой библиотеки окажется в публичном доступе.

## 1. Beautiful UI — beautifului.dev

### Что это и кто за ним

- Сайт описывает себя так: «A small library of extremely crafted, copy-paste components for chat agents,
  thinking states, human-in-the-loop approvals, and everything agents need to talk to humans beautifully.»
  ([beautifului.dev](https://beautifului.dev), meta description).
- Это коллекция компонентов. Templates, marketplace и AI-генератора нет.
- Есть демо `/harness`. В нём primitives собраны в рабочий agent chat с выдуманными сценариями
  ([beautifului.dev/harness](https://beautifului.dev/harness), [README](https://github.com/slev12397/beautiful-ui#readme)).
- Автор — Shane Levine. Его GitHub-профиль: «Founder at Turbo» ([api.github.com/users/slev12397](https://api.github.com/users/slev12397)).
- Turbo — product design studio из Brooklyn, NY ([turbodesign.co](https://turbodesign.co/)). Сайт подписан «Built by Turbo».
- На сайте есть кнопка «Book a call» к студии. Платного уровня нет.
- Repo создан 2026-07-16 ([gh api](https://api.github.com/repos/slev12397/beautiful-ui)).
- Вторичный источник: статья Dr. Web от 2026-08-12 описывает набор из 19 компонентов
  ([drweb.de](https://www.drweb.de/beautiful-ui-ki-agenten-bausteine/)). Сейчас на сайте 21.

### Распространение

- Рекомендованный путь — shadcn CLI по URL: `npx shadcn add https://www.beautifului.dev/r/approval-card.json`
  ([README, Install a component](https://github.com/slev12397/beautiful-ui#install-a-component)).
- Index: [beautifului.dev/r/registry.json](https://www.beautifului.dev/r/registry.json). В нём 27 items.
- Состав index: `foundation` (стили), 6 building blocks (Button, GlideMenu, EntityChip, ValuePill, Shimmer,
  StreamText) и 20 primitives. Agent Screen есть на сайте, но не в registry.
- Второй путь — copy-paste из code view на сайте. README: code view «lists exactly what to also copy and `npm i`».
- npm-пакета нет.
- В официальном индексе shadcn (565 registries) Beautiful UI нет ([ui.shadcn.com/r/registries.json](https://ui.shadcn.com/r/registries.json)).
- Есть сторонний «Unofficial shadcn registry for Beautiful UI» ([ansh/beautiful-ui-registry](https://github.com/ansh/beautiful-ui-registry)).
  Это вторичный источник, я его не проверял.

### Зависимости

- Tailwind CSS v4. README: «Stack: Next.js (App Router) · React · Tailwind CSS v4 · TypeScript.»
- В CSS сайта есть метка `tailwindcss v4.3.3` (файл `/_next/static/css/916c3f25c8795666.css`).
- Компонент сам по себе не работает. README: «A single component is **not** self-contained on its own — it
  renders on this shared foundation stylesheet.»
- `foundation.css` — 644 строки ([foundation.json](https://www.beautifului.dev/r/foundation.json)). Внутри:
  - `@import "tailwindcss"` и `@import "shadow-plugin/unprefixed"`;
  - tokens в блоке `@theme inline` (`bg-ink`, `text-ink-3`, `shadow-overlay` и др.);
  - все `@keyframes`;
  - правила для `html` и `body`;
  - глобальное правило для `*` при prefers-reduced-motion: `animation-duration: 0.01ms !important`.
- Item `foundation` не объявляет npm-зависимость `shadow-plugin`, хотя импортирует её. Так видно по JSON.
  Поставит ли её CLI — не проверено.
- motion в primitives не используется. Он нужен только оболочке сайта ([package.json](https://github.com/slev12397/beautiful-ui/blob/main/package.json)).
- Внешние пакеты по компонентам (из JSON registry):
  - Prompt Bar — `glimm`: MIT, «WebGL sweep transitions for the web». У версии 0.4.1 peerDependency `next >=14`
    ([npm glimm](https://registry.npmjs.org/glimm)).
  - Insight Cards — `liveline`: MIT, «Real-time animated charts for React», версия 0.0.7 ([npm liveline](https://registry.npmjs.org/liveline)).
  - Selection Actions — `iconoir-react`.
  - Sidebar Nav — `@central-icons-react/round-outlined-radius-2-stroke-2`, платный набор иконок.
- Radix, Base UI и shadcn/ui не используются. Импортов `next/*` в primitives нет.

### Лицензия

- MIT: «Copyright (c) 2026 Shane Levine» ([LICENSE](https://github.com/slev12397/beautiful-ui/blob/main/LICENSE),
  [beautifului.dev/license](https://beautifului.dev/license)).
- README: «MIT licensed. Take it, wire it to your own agent, ship it.»
- Исключение — иконки Sidebar Nav. README: «Heads up — commercial icon set. `SidebarNav` uses
  `@central-icons-react`, a paid icon library with a license check that runs on `npm install`.»
- Лицензия Iconists разрешает иконки в публичном коде только при купленном плане (Single, Team, Enterprise,
  Ultimate): «You may include central icons in your End Product's public source code, builds, or component
  packages, subject to the restrictions below. This applies to free, paid, and open-source projects.»
  ([LICENSE.md в npm-пакете](https://unpkg.com/@central-icons-react/round-outlined-radius-2-stroke-2@1.2.39/LICENSE.md),
  [iconists.co/license](https://iconists.co/license)).
- Цены Central Icons — не проверено.
- Вывод для OSS: да. В Sidebar Nav иконки надо заменить.

### Состав

- 21 primitive на сайте: Loading State, Thinking, Streaming Text, Approval Card, Tool Chips, Task Rows, Chat,
  Prompt Bar, Recommendation Card, Context Cards, Diff Table, Records Table, Filter Table, Sidebar Nav, Search,
  Flowchart, Insight Cards, Code Block, Fine-tune Card, Selection Actions, Agent Screen ([beautifului.dev](https://beautifului.dev)).
- Все они — app UI для agent-интерфейса. Маркетинговых эффектов нет.
- Дизайн-система плотная. Радиусы 6–14 px, шрифты Inter и JetBrains Mono, tabular numerals. Светлая и тёмная
  тема из одних tokens ([README, The design system](https://github.com/slev12397/beautiful-ui#the-design-system)).

### Качество (spot-check)

- Approval Card ([approval-card.json](https://www.beautifului.dev/r/approval-card.json),
  [исходник](https://github.com/slev12397/beautiful-ui/blob/main/components/primitives/ApprovalCard.tsx)):
  - нативные `<button>`;
  - `aria-label` у Dismiss, Previous question, Next question и поля Custom answer;
  - `aria-pressed` у вариантов ответа, `aria-live="polite"`;
  - roving `tabIndex` и `onKeyDown` в поле своего ответа;
  - проверка `matchMedia("(prefers-reduced-motion: reduce)")` перед анимацией.
- Thinking ([thinking-state.json](https://www.beautifului.dev/r/thinking-state.json)): `aria-expanded` на
  раскрытии, `role="status"`.
- Loading State ([loading-state.json](https://www.beautifului.dev/r/loading-state.json)):
  - `role="status"`, декоративная сетка с `aria-hidden`;
  - анимация — CSS `infinite`, при prefers-reduced-motion её останавливает глобальное правило `foundation.css`;
  - таймер обновляет state каждые 100 мс;
  - вариант Surfer по умолчанию грузит видео с внешнего адреса `*.public.blob.vercel-storage.com`.
- GlideMenu ([glide-menu.json](https://www.beautifului.dev/r/glide-menu.json)): только подсветка строки под
  курсором, с `aria-hidden`. Ролей `menu` и стрелок нет.
- Клавиатуру в меню Prompt Bar делает сам компонент. В его комментарии: «Type @ or / to open the menus; ↑↓ +
  Enter to pick.» ([prompt-bar.json](https://www.beautifului.dev/r/prompt-bar.json)).
- TypeScript — да. React 19 — да (`react ^19.1.0`).
- Нагрузка: в основном CSS-анимации. Тяжелее всего WebGL-вспышка `glimm` в Prompt Bar (по событию, с проверкой
  reduced motion) и canvas-графики `liveline` в Insight Cards с автопрокруткой.

### Поддержка

- [slev12397/beautiful-ui](https://github.com/slev12397/beautiful-ui): 361 stars, 49 forks, 2 open issues.
  Releases нет.
- Последний push — 2026-09-22 ([commits](https://api.github.com/repos/slev12397/beautiful-ui/commits?per_page=5)).
- Последние коммиты Shane Levine: 2026-09-22 (#21, сжатие видео), 2026-09-21 (#19, «Remove PostHog, DialKit,
  and Mesurer to cut hosting costs»), 2026-09-09 (#17), 2026-09-02 (#16, Agent Screen).
- Один автор. Около семи недель без коммитов.

### Вывод для worfy

- По смыслу ближе всех к worfy.
- Chat Sessions: Thinking, Streaming Text, Tool Chips, Approval Card (запросы разрешений агенту), Task Rows,
  Context Cards, Prompt Bar, Diff Table, Code Block.
- Selection Actions — аналог selection toolbar.
- Loading states: Loading State с таймером для долгой работы агента.
- Только маркетинг: ничего.
- Главный риск — Tailwind v4 и глобальный `foundation.css`. Он переопределяет `html`, `body` и анимации всех
  элементов.
- Реалистичный путь — переносить разметку и поведение в свой CSS и сохранять MIT-notice.
- Другие риски: один автор, платные иконки в Sidebar Nav.

## 2. RareUI — rareui.in

### Что это и кто за ним

- Заголовок сайта: «RareUI - Free React UI Component Library» ([rareui.in](https://rareui.in)).
- Это коллекция компонентов. Раздел templates пустой: «Full-stack component templates are coming soon.»
  ([rareui.in/templates](https://rareui.in/templates)).
- Автор — Swapnil Kalambe: GitHub `Codewithswappy`, Navi Mumbai, X `@heyyswap`
  ([api.github.com/users/Codewithswappy](https://api.github.com/users/Codewithswappy),
  [docs/installation/cli](https://rareui.in/docs/installation/cli)). Компании нет.
- Repo создан 2025-12-02. npm-пакет CLI опубликован 2025-12-04 ([gh api](https://api.github.com/repos/Codewithswappy/RareUI),
  [npm rareui](https://registry.npmjs.org/rareui)).
- В changelog v1.0.0 датирован 2026-03-01 ([changelog](https://rareui.in/changelog)).
- Счётчики расходятся:
  - meta description: «Discover 100+ premium, free, and open-source React UI components»;
  - текст главной: «50+ animated components»;
  - в docs — 21 компонент ([rareui.in/docs](https://rareui.in/docs));
  - в index registry — 23 записи, из них 2 lazy-обёртки ([rareui.in/r/index.json](https://rareui.in/r/index.json)).
- Главная обещает «New Component every week». Последняя запись changelog — v1.5.0 от 2026-04-07.
- Домен rareui.com упоминают сторонние порты на SwiftUI и Compose. Он отдал HTTP 429 (Vercel Security
  Checkpoint). Связь с rareui.in — не проверено.

### Распространение

- Свой CLI: `npx rareui@latest init`, `npx rareui@latest add [component-name]` ([docs/installation/cli](https://rareui.in/docs/installation/cli)).
- npm `rareui` 0.1.6, последняя публикация 2025-12-09 ([npm](https://registry.npmjs.org/rareui)).
- Copy-paste тоже можно. Docs: «the CLI is purely for convenience».
- На сайте лежат JSON в формате shadcn с `"type": "registry:ui"`, например
  [rareui.in/r/LiquidButton.json](https://rareui.in/r/LiquidButton.json). Docs о shadcn CLI молчат.
  Работает ли `npx shadcn add` с этими URL — не проверено.
- В официальном индексе shadcn RareUI нет.

### Зависимости

- JSON-LD сайта: «React 18+, Next.js 14+, Tailwind CSS 3+».
- Repo фактически на `tailwindcss ^4`, `react ^19.2.0`, `next ^16.2.1` ([package.json](https://github.com/Codewithswappy/RareUI/blob/main/package.json)).
- Главная пишет «zero dependencies». Это не так. Компоненты импортируют `framer-motion` или `motion/react`,
  `three`, `clsx`, `tailwind-merge`.
- Пакеты анимации смешаны. Liquid Button импортирует `motion/react`. Liquid Tooltip, Loading Spinner и Animated
  Tab — `framer-motion` ([LiquidTooltip.json](https://rareui.in/r/LiquidTooltip.json)).
- Liquid Metal — свой WebGL2. Liquid Wave — three.js.
- Lazy-обёртки используют `next/dynamic`. Это работает только в Next.js
  ([LiquidMetalLazy.tsx](https://github.com/Codewithswappy/RareUI/blob/main/components/rareui/LiquidMetalLazy/LiquidMetalLazy.tsx)).
- В JSON items `typescript` и `@types/react` записаны как runtime dependencies. `@/lib/utils` импортируется,
  но не объявлен.

### Лицензия

- MIT: «Copyright (c) 2025 Swapnil Kalambe (RareUI)» ([LICENSE](https://github.com/Codewithswappy/RareUI/blob/main/LICENSE)).
- Платного уровня нет. OSS-ok: да.

### Состав

- По docs ([rareui.in/docs](https://rareui.in/docs)):
  - Components (14): Animated Tab, Floating Navigation, Glass Shimmer Button, Liquid Button, Liquid Tooltip,
    Neumorphism3DButton, Particle Card, Premium Button, Premium Profile Card, Retro Pixel Button, Soft Button,
    Toast Tabs, Liquid Metal, Loading Spinner;
  - Text Animation (4): Magnetic ScatterText, Sound Text, Vapor SmokeText, Word Magnet;
  - 3D Elements: Book 3d. Interactive Background: Liquid Wave. Sections: Image Expand Testimonial.
- App UI: Animated Tab, Toast Tabs, Liquid Tooltip, Loading Spinner. Это 4 из 21, ~20 %.
- Остальное — 6 декоративных кнопок, 4 text effects, карточки, 3D, WebGL-фоны, testimonial, навигация для
  landing page.

### Качество (spot-check)

- Liquid Metal ([исходник](https://github.com/Codewithswappy/RareUI/blob/main/components/rareui/LiquidMetal/LiquidMetal.tsx)):
  WebGL2 и непрерывный `requestAnimationFrame`. Паузы вне экрана нет. reduced motion нет. ARIA нет.
- Liquid Tooltip ([исходник](https://github.com/Codewithswappy/RareUI/blob/main/components/rareui/LiquidTooltip/LiquidTooltip.tsx)):
  открывается только по `onMouseEnter` и `onMouseMove`. Реакции на фокус нет, с клавиатуры не открыть.
- Animated Tab ([исходник](https://github.com/Codewithswappy/RareUI/blob/main/components/rareui/AnimatedTab/AnimatedTab.tsx)):
  `motion.button` с классом `outline-none` и без замены через focus-visible. Ролей `tablist` и `tab` нет,
  `aria-selected` нет.
- Liquid Wave ([исходник](https://github.com/Codewithswappy/RareUI/blob/main/components/rareui/LiquidWave/LiquidWave.tsx)):
  three.js, 23 вхождения `: any`.
- GitHub code search по repo: `prefers-reduced-motion` и `useReducedMotion` — 0 совпадений. `aria-label` —
  в одном компоненте (Image Expand Testimonial).
- TypeScript — да, но с `any`. React 19 — да в repo, сайт обещает React 18+.

### Поддержка

- [Codewithswappy/RareUI](https://github.com/Codewithswappy/RareUI): 34 stars, 1 fork, 0 open issues, около
  162 коммитов. Releases нет.
- Последний push — 2026-04-06, коммит «chore: fixed gitignore and purged node_modules»
  ([commits](https://api.github.com/repos/Codewithswappy/RareUI/commits?per_page=5)).
- Больше семи месяцев без коммитов.

### Вывод для worfy

- Полезного почти нет. Tooltip и tabs у RareUI хуже по a11y, чем нужно worfy.
- Loading Spinner можно разве что посмотреть как идею для loading state.
- Только маркетинг: кнопки-эффекты, text animations, 3D, WebGL-фоны.
- Главные риски: WebGL-циклы без паузы, нет a11y и prefers-reduced-motion, repo не развивается.

## 3. Magic UI — magicui.design

### Что это и кто за ним

- Meta description: «Beautiful UI components and templates to make your landing page look stunning.»
  ([magicui.design](https://magicui.design)).
- Описание в индексе shadcn: «UI Library for Design Engineers. 150+ free and open-source animated components
  and effects built with React, Typescript, Tailwind CSS, and Motion.» ([registries.json](https://ui.shadcn.com/r/registries.json)).
- Это коллекция компонентов (free) и Magic UI Pro — templates и sections для landing page
  ([pro.magicui.design](https://pro.magicui.design)). Есть MCP server.
- Автор — Dillion Verma. Начал летом 2023, когда переделывал landing page своего SaaS ([docs/story](https://magicui.design/docs/story)).
- Repo создан 2023-06-26 ([gh api](https://api.github.com/repos/magicuidesign/magicui)).
- Сторона договора в Pro-лицензии — «Magic UI». Право — штат California ([pro license](https://pro.magicui.design/license)).

### Распространение

- shadcn CLI: `pnpm dlx shadcn@latest add @magicui/globe`. Docs: «We have the exact same installation process
  as shadcn/ui.» ([docs/installation](https://magicui.design/docs/installation)).
- `@magicui` есть в официальном индексе shadcn: status `healthy`, score 98.9 ([registries.json](https://ui.shadcn.com/r/registries.json)).
- MCP: `pnpm dlx @magicuidesign/cli@latest install cursor` или общий `npx shadcn@latest mcp` ([docs/mcp](https://magicui.design/docs/mcp)).
- Пакет `@magicuidesign/mcp` 2.1.0 ([npm](https://registry.npmjs.org/@magicuidesign%2Fmcp)).
- Pro выдаётся после покупки. Как именно (zip или доступ к GitHub) — не проверено.

### Зависимости

- Tailwind v4. Для v3 — отдельный сайт: «For older Magic UI components using Tailwind CSS v3, visit:
  v3.magicui.design» ([docs/legacy](https://magicui.design/docs/legacy)).
- Код использует синтаксис v4, например `gap-(--gap)` в Marquee.
- Сайт собран на `react 19.1.1`, `tailwindcss ^4.1.13`, `motion ^12.23.12`, `shadcn 4.23.0`
  ([apps/www/package.json](https://github.com/magicuidesign/magicui/blob/main/apps/www/package.json)).
- Из 79 компонентов `registry:ui` 30 объявляют `motion` ([magicui.design/r/registry.json](https://magicui.design/r/registry.json)).
- Другие пакеты: next-themes (8 items), @radix-ui/react-icons (6), lucide-react (5), cobe (Globe),
  canvas-confetti, shiki, react-tweet, rough-notation, svg-dotted-map.
- 66 из 79 импортируют утилиту `cn` из shadcn (`@/lib/utils`).

### Лицензия

- Free — MIT, «Copyright (c) Magic UI» ([LICENSE.md](https://github.com/magicuidesign/magicui/blob/main/LICENSE.md)).
  OSS-ok: да, с сохранением copyright notice.
- Pro — «Individual License - Lifetime Access $199 one-time payment». Team-плана на странице нет.
- На странице Pro: «Commercial Use — Use the templates for commercial projects. Re-selling of code is NOT
  allowed.» ([pro.magicui.design](https://pro.magicui.design)).
- Ключевой пункт Pro License Agreement (Effective Date: October 14, 2024): «Licensee may not redistribute,
  resell, share, or otherwise transfer the Products, whether in their original form or a modified version, to
  any third party.» ([pro.magicui.design/license](https://pro.magicui.design/license)).
- Там же штраф: «liquidated damages in the amount of ten thousand United States Dollars ($10,000 USD) per
  instance of unauthorized redistribution.»
- Вывод: код Pro в публичном repo worfy — это передача третьим лицам. OSS-ok: нет.
- `pro.magicui.design/pricing` отдал 404. Цена взята с главной Pro.

### Состав

- В registry 79 компонентов `registry:ui`. Сайт пишет «150+». Страница библиотеки на 21st показывает 64
  ([21st.dev](https://21st.dev/@dillionverma/library/magic-ui.md)).
- Моя группировка 79 компонентов:

| Группа | Число | Примеры |
|---|---|---|
| Backgrounds и patterns | 17 | warp-background, meteors, dot-pattern, flickering-grid, particles, retro-grid, light-rays, dither-field |
| Text effects | 20 | aurora-text, morphing-text, hyper-text, typing-animation, sparkles-text, number-ticker |
| Кнопки и click-эффекты | 8 | shimmer-button, rainbow-button, pulsating-button, cool-mode, confetti |
| Эффекты карточек и рамок | 9 | magic-card, border-beam, shine-border, glare-hover, lens |
| Секции landing page | 11 | marquee, globe, orbiting-circles, icon-cloud, animated-beam, bento-grid, tweet-card |
| Device mockups | 3 | android, safari, iphone |
| Cursor и scroll | 3 | pointer, smooth-cursor, scroll-progress |
| Ближе к app UI | 8 | file-tree, terminal, code-comparison, animated-list, dock, animated-circular-progress-bar, animated-theme-toggler, blur-fade |

- Доля app UI ~10 %. Настоящий app UI из восьми — разве что File Tree.
- Terminal — анимация набора текста для landing page, не терминал
  ([terminal.tsx](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/terminal.tsx)).
- Pro — только маркетинг. Templates: AI Agent, Dev Tool, Mobile, SaaS, Startup, Portfolio, Codeforge,
  Changelog, Blog. Sections: Header, Hero, Social Proof, Feature, Pricing, Call To Action, FAQ, Footer
  ([pro.magicui.design](https://pro.magicui.design)).

### Качество (spot-check)

- Marquee ([marquee.tsx](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/marquee.tsx)):
  по умолчанию рендерит children 4 раза (`repeat = 4`). У копий нет `aria-hidden`, screen reader прочтёт
  содержимое 4 раза. reduced motion нет.
- Particles ([particles.tsx](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/particles.tsx)):
  canvas, непрерывный `requestAnimationFrame`, listener `mousemove` на `window`. Паузы вне экрана нет.
  reduced motion нет.
- File Tree ([file-tree.tsx](https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/file-tree.tsx)):
  построен на Radix Accordion, клавиатура приходит от Radix.
- Но item [file-tree.json](https://magicui.design/r/file-tree.json) не содержит `dependencies` и
  `registryDependencies`. Код при этом импортирует `@radix-ui/react-accordion`, `lucide-react`,
  `@/components/ui/button`, `@/components/ui/scroll-area`.
- Ещё 5 проверенных items (globe, border-beam, terminal, animated-list, dock): ни одной проверки reduced motion.
- GitHub code search: `prefers-reduced-motion` или `useReducedMotion` есть в 6 компонентах из 79
  (dia-text-reveal, icon-cloud, retro-grid, scroll-based-velocity, dither-field, floating-3d-particles).
  Индекс поиска GitHub мог быть неполным.
- TypeScript — да. React 19 — да.

### Поддержка

- [magicuidesign/magicui](https://github.com/magicuidesign/magicui): 23 207 stars, 1 243 forks, 14 open issues.
  GitHub releases нет.
- Последний push — 2026-11-09 ([commits](https://api.github.com/repos/magicuidesign/magicui/commits?per_page=5)).
- Коммиты: 2026-11-08 (#1050), 2026-11-04 (#1047; #1041 — Dependabot), 2026-11-02 (#1038 — DitherField на WebGL2).
- MCP repo [magicuidesign/mcp](https://github.com/magicuidesign/mcp): последний push 2026-11-04.
- Из пяти это самый активный open-source repo.

### Вывод для worfy

- Для app UI почти ничего. Inputs, menus, dialogs и tables в библиотеке нет.
- Guide: animated-beam (линии между блоками схемы), orbiting-circles, animated-list, file-tree, terminal как
  анимация набора, number-ticker.
- Onboarding: border-beam или shine-border для подсветки кнопки, blur-fade, confetti.
- Empty states: dot-pattern или grid-pattern как тихий фон.
- Только маркетинг: device mockups, tweet cards, hero video, globe, marquee, большинство text effects.
- Главные риски: Tailwind v4 и motion как новые зависимости, почти нет prefers-reduced-motion, непрерывные
  анимации. Лицензия free чистая.

## 4. Aceternity UI — ui.aceternity.com

### Что это и кто за ним

- Сайт: «The React component library for beautiful landing page[s]» ([ui.aceternity.com](https://ui.aceternity.com)).
- На главной: «118+ free» components, «183+ blocks», «17 templates», «5 landing pages».
- Это коммерческий продукт: free components и платный All-Access (blocks, templates, pages, interactions)
  ([pricing](https://ui.aceternity.com/pricing)).
- Автор — Manu Arora. Brand facts: «Aceternity Labs LLC», основан в 2023 ([brand-facts](https://ui.aceternity.com/brand-facts)).
- Запуск на Product Hunt — 21 декабря 2023 ([Product Hunt](https://www.producthunt.com/products/aceternity-ui/launches), сторонний источник).
- Юрлица расходятся. В footer — «© 2026 Aceternity Labs LLC». В Terms — «Aceternity Solutions Private Limited»
  ([terms](https://ui.aceternity.com/terms)).
- Число free расходится: главная — 118+, pricing — «100+», brand facts — «200+».
  На странице [/components](https://ui.aceternity.com/components) 114 ссылок на компоненты.

### Распространение

- Copy-paste со страницы компонента или shadcn CLI: `npx shadcn@latest add @aceternity/bento-grid`
  ([installation](https://ui.aceternity.com/installation)).
- Registry URL: `https://ui.aceternity.com/registry/{name}.json`.
- Templates: «Full templates download as a zip from the Templates section» (FAQ на [pricing](https://ui.aceternity.com/pricing)).
- MCP — через общий shadcn MCP server: «Add the @aceternity registry to your components.json, connect the shadcn
  MCP server» (там же).
- В индексе shadcn у `@aceternity` status `degraded`: «Sampled registry items are failing validation», score
  78.6 ([registries.json](https://ui.shadcn.com/r/registries.json)).
- Пример: item `github-globe` вернул JSON без файлов ([github-globe.json](https://ui.aceternity.com/registry/github-globe.json)).
- `ui.aceternity.com/docs/installation` отдал 404. Использована страница `/installation`.

### Зависимости

- Installation: React 19, Tailwind v4 (v3 — legacy-настройка), `npm i motion clsx tailwind-merge`.
- Spot-check JSON:
  - sidebar — `@tabler/icons-react`, `motion`;
  - animated-modal — `motion`;
  - sparkles — `@tsparticles/react`, `@tsparticles/engine`, `@tsparticles/slim`, `motion`;
  - globe — `three`, `three-globe`, `@react-three/fiber@alpha`, `@react-three/drei`;
  - canvas-reveal-effect — `three`, `@react-three/fiber`;
  - vortex — `simplex-noise`, `motion`.
- Tabs объявляет `@radix-ui/react-tabs`, но не импортирует его. Вкладки сделаны своими кнопками
  ([tabs.json](https://ui.aceternity.com/registry/tabs.json)).

### Лицензия

- OSI-лицензии нет. Публичного repo с кодом компонентов нет. В GitHub-организации `aceternity` только plugin и
  boilerplates ([gh api](https://api.github.com/users/aceternity/repos)).
- Free по FAQ ([pricing](https://ui.aceternity.com/pricing)):
  - «Aceternity UI has a free tier of 100+ copy-paste components … that you can use in personal and commercial
    projects.»
  - «The only restriction is that you cannot resell or redistribute the components themselves as a competing
    template or component library.»
- Licence распространяется на «each item available for purchase or download on ui.aceternity.com»
  ([licence](https://ui.aceternity.com/licence)). В нём:
  - разрешено: «End products may be sold, licensed, sub-licensed, or freely distributed.»;
  - запрещено: «Re-distribution: You cannot re-distribute the Item as a stock image or its source files,
    regardless of modifications.»
- Terms: «You must not: Republish material from ui.aceternity.com … Reproduce, duplicate or copy material from
  ui.aceternity.com … Redistribute content from ui.aceternity.com» ([terms](https://ui.aceternity.com/terms)).
- Вывод для free: собранное приложение распространять можно. Исходники в публичном repo — это source files.
  FAQ и licence противоречат друг другу. Без письменного ответа Aceternity это риск.
- Pro подпадает под тот же пункт о source files. OSS-ok: нет.
- Цены All-Access, разовые платежи:

| План | Цена | Что даёт |
|---|---|---|
| Free | $0 | 100+ free components, MCP access |
| 1-Year License | $169 (обычно $249) | 200+ premium blocks, 15+ templates, 5 pages, 16 interactions, обновления на год |
| Lifetime Access | $199 (обычно $299) | То же навсегда |
| Team | $1 590 (обычно $1 990) | До 10 человек, lifetime |

- Refunds нет: «We do not offer refunds because purchases grant immediate and complete access to all source
  code and downloads.» (FAQ).

### Состав

- 114 компонентов на /components. Моя группировка:

| Группа | Число | Примеры |
|---|---|---|
| Backgrounds, beams, shaders, glow, pointer-эффекты | 37 | aurora-background, background-beams, sparkles, vortex, lamp-effect, meteors, dither-shader, tracing-beam |
| Text effects | 14 | flip-words, typewriter-effect, text-generate-effect, encrypted-text |
| 3D и hover-карточки | 15 | 3d-card-effect, 3d-pin, evervault-card, wobble-card, glare-card |
| Scroll, parallax, секции | 15 | hero-parallax, macbook-scroll, sticky-scroll-reveal, timeline, bento-grid |
| Carousels, testimonials, galleries | 8 | apple-cards-carousel, infinite-moving-cards, 3d-marquee, compare |
| Globes и maps | 3 | 3d-globe, github-globe, world-map |
| Navbar для landing page и декоративные кнопки | 4 | floating-navbar, resizable-navbar, magnetic-button, tailwindcss-buttons |
| Ближе к app UI | 18 | animated-modal, animated-tooltip, tooltip-card, link-preview, tabs, sidebar, navbar-menu, floating-dock, file-upload, gooey-input, placeholders-and-vanish-input, signup-form, stateful-button, loader, multi-step-loader, image-generation-loader, code-block, terminal |

- Доля app UI ~16 %.
- Blocks — в основном платные («Access to 200+ premium Blocks»). Ближе к app: Empty States (Pro, добавлены
  2026-05-11), Sidebars, Login and Signup, Stats, Cards ([licence](https://ui.aceternity.com/licence), footer;
  [changelog](https://ui.aceternity.com/changelog)).
- Templates — все маркетинговые или portfolio (Agenforce Marketing, AI SaaS, Startup Landing Page и др.).

### Качество (spot-check)

- Animated Modal ([animated-modal.json](https://ui.aceternity.com/registry/animated-modal.json)):
  - нет `role="dialog"` и `aria-modal`;
  - нет закрытия по Escape и нет focus trap;
  - кнопка закрытия — `<button>` с одной SVG и без `aria-label`;
  - прокрутку блокирует через `document.body.style.overflow`.
- Sidebar ([sidebar.json](https://ui.aceternity.com/registry/sidebar.json)): на desktop раскрывается по hover.
  На mobile открытие — `onClick` на SVG-иконке, закрытие — `onClick` на `<div>`. С клавиатуры не достать.
- Tabs: своя реализация без `tablist` и `aria-selected`.
- Проверено 13 items с кодом: sidebar, animated-modal, placeholders-and-vanish-input, tabs, background-beams,
  sparkles, canvas-reveal-effect, terminal, multi-step-loader, globe, 3d-globe, world-map, vortex.
  Проверки prefers-reduced-motion нет ни в одном.
- TypeScript — да. FAQ: «every component ships with TypeScript types». React 19 — да.

### Поддержка

- Публичного repo нет. Stars и коммиты — неприменимо.
- Последняя запись changelog — 2026-05-29: Productized Agency Template, «Next.js 16 + React 19, Tailwind CSS
  4.0+, Motion for React» ([changelog](https://ui.aceternity.com/changelog)).
- В меню сайта раздел «Interactions» отмечен как «New».

### Вывод для worfy

- Почти всё — маркетинг для landing page.
- Теоретически: multi-step-loader для onboarding, tracing-beam и timeline для Guide,
  placeholders-and-vanish-input как эффект отправки в chat. Empty States — только Pro.
- Главный риск — лицензия. У free нет OSI-лицензии, тексты противоречат друг другу. Pro запрещает
  публиковать source files.
- Второй риск — a11y. Модалка и sidebar слабее нативных или Radix/Base UI.
- Третий риск — тяжёлые эффекты (three, tsparticles) без reduced motion.

## 5. 21st.dev

### Что это и кто за ним

- «Community catalog of 12,000+ hand-crafted React and Tailwind CSS components, templates, and component
  libraries.» ([llms.txt](https://21st.dev/llms.txt)).
- Это marketplace и registry, а не библиотека. FAQ главной: «21st is a registry: many authors, many styles, and
  the code is copied into your repo rather than imported.» ([21st.dev](https://21st.dev), markdown-версия).
- Поверх каталога — генератор 21st AI, 21st MCP и CLI. Terms также покрывают «21st Agents» SDK и хостинг
  агентов ([terms](https://21st.dev/terms)).
- Компания — 21st Labs Inc. (Terms, «Last updated: July 20, 2026»).
- «Founded by Serafim Korablev and Sergey Bunas.» ([llms.txt](https://21st.dev/llms.txt)).
- Публичный repo маркетплейса создан 2024-09-30 ([serafimcloud/21st](https://github.com/serafimcloud/21st)).

### Модель registry и marketplace

- Публиковать может любой. FAQ: «Anyone can publish to the registry. You keep authorship … and template authors
  can sell their work directly.»
- Три пути получить компонент: «Copy prompt» для агента («the agent rebuilds it inside your codebase»),
  shadcn CLI или MCP.
- Команда со страницы компонента: `npx shadcn@latest add "https://21st.dev/r/dillionverma/file-tree?api_key=$API_KEY_21ST"`.
  Там же: «Requires a 21st API key» ([file-tree.md](https://21st.dev/@dillionverma/components/file-tree.md)).
- Без ключа registry отвечает HTTP 403 с `{"error":"Authentication required"}`. Проверено curl на
  `https://21st.dev/r/dillionverma/file-tree`.
- Free: «2 component code retrievals, copies, or installs per day total across Web, MCP, and CLI»
  ([llms.txt](https://21st.dev/llms.txt)).
- В официальном индексе shadcn 21st нет.
- На 21st есть страницы известных библиотек: Aceternity UI, Magic UI, ReUI, Kokonut UI, Origin UI, Motion
  Primitives, HextaUI ([llms.txt](https://21st.dev/llms.txt)).

### Лицензия компонентов

- Лицензию выбирает автор. Поле видно на странице компонента, например «License: mit»
  ([file-tree.md](https://21st.dev/@dillionverma/components/file-tree.md)).
- В архивном коде платформы варианты такие: MIT, Apache 2.0, BSD 3-Clause, LGPL, MPL 2.0, ISC, «No License»
  ([licenses.ts](https://github.com/serafimcloud/21st/blob/main/apps/web/lib/licenses.ts)). Код не обновлялся
  с 2025-05-28. Текущий список — не проверено.
- Моя выборка — первые 40 компонентов категории [AI Chat](https://21st.dev/community/components/s/ai-chat.md):
  31 MIT, 1 Apache-2.0, 6 «unknown», 2 «no-license». У каждого пятого нет пригодной лицензии.
- Поверх лицензии автора действуют Terms 21st ([terms](https://21st.dev/terms), разделы 2 и 3):
  - «All code, content, and materials published on the Marketplace, including but not limited to components …
    are the sole and exclusive property of their respective authors and 21st Labs Inc. Users are granted access
    to view and use the content solely through the official 21st.dev platform in accordance with these Terms.»
  - Запрещено: «Redistributing, selling, or licensing any content from the Marketplace without authorization.»
  - Запрещено: «Copying and redistributing components originally published on the Marketplace to other
    websites, social media platforms, or any other medium without providing a clear and visible link back to
    the original component page on 21st.dev.»
- Вывод для OSS: компонент под MIT или Apache можно, с атрибуцией автора и ссылкой на страницу 21st.
- Чище брать тот же компонент из repo автора, если он есть. Например, Magic UI — с GitHub по MIT.
- «unknown» и «no-license» в публичный repo брать нельзя.
- Templates продают авторы поштучно («Bought per template» в [pricing.md](https://21st.dev/pricing.md)).
  Лицензии templates — не проверено.

### Magic: 21st AI и 21st MCP

- Переименования из [llms.txt](https://21st.dev/llms.txt):
  - «"Magic MCP" is the former name of the 21st MCP.» Пакет `@21st-dev/magic` работает как alias и проксирует
    на `https://21st.dev/api/mcp`.
  - «"Magic Chat" is the former name of 21st AI, the web component generator.»
  - «API keys issued by the old Magic console were reset and no longer work.»
- Установка MCP: `npx @21st-dev/cli@latest init --client <cursor|claude|codex|vscode|devin>`. Затем API key с
  [21st.dev/mcp](https://21st.dev/mcp) ([mcp.md](https://21st.dev/mcp.md)).
- Tools MCP (там же): `search` (бесплатно, только metadata), `get_component` («paid retrieval»),
  `get_inspiration`, `search_logo`, `generate` («paid on the free tier»).
- 21st AI ([ai.md](https://21st.dev/ai.md)):
  - режим `code`: «a full React/shadcn component with a live sandbox»;
  - режим `sketch`: «fast, self-contained HTML/Tailwind drafts»;
  - через MCP `generate` «returns a url to open and watch it build, not inline code».
- Права на результат генерации Terms отдельно не описывают. Не проверено.
- Repo [21st-dev/magic-mcp](https://github.com/21st-dev/magic-mcp): ISC, 6 458 stars, последний push 2026-09-09.
- `@21st-dev/cli` 1.18.0 опубликован 2026-10-06 ([npm](https://registry.npmjs.org/@21st-dev%2Fcli)).

### Цены

| План | Цена | Что даёт |
|---|---|---|
| Free (Hobby) | $0 | Весь каталог, 2 копии в день, 5 проверок Design Bug Bot |
| Builder | $6/мес при оплате за год, $8/мес поквартально | Безлимит копий, установок и MCP retrieval. AI credits нет |
| Builder + AI | $15, $30 или $60 в месяц за год — 500, 1 000 или 2 000 credits | 21st AI. Ещё 100 credits — $5 |
| Team | $7.50 за место в месяц без AI, $18.75 с AI, за год | Общие коллекции, биллинг, admin |

- Источник — [pricing.md](https://21st.dev/pricing.md).
- Refunds нет: «Payments for paid plans and credit packs are non-refundable.» ([terms](https://21st.dev/terms), 4.1).

### Состав и доля app UI

- 30 категорий в [llms.txt](https://21st.dev/llms.txt). Маркетинг: Hero, Features, CTA, Pricing,
  Testimonials, Footer, Landing Pages, Text Animation, Backgrounds, Marquee. App UI: AI Chat, Navigation,
  Login, Dashboard, Dialogs, Forms, Tables, Sidebar, Tabs, Tooltips, Avatars, Badges, Charts, Accordion, Search,
  Notifications. Смешанные: Animated, Cards, Buttons, Carousel.
- Оценка по числам в описаниях категорий (страницы `community/components/s/<tag>.md`):
  - маркетинг — 716 (hero 284, landing-page 143, features 102 и др.);
  - app UI — 545 (ai-chat 78, accordion 69, badge 47, tabs 42, form 40, table 36 и др.);
  - смешанные — 1 153 (animated 426, card 422, button 250, carousel 55).
- Это ~30 % маркетинга, ~23 % app UI, ~48 % смешанных тегов.
- Оговорки: теги пересекаются, сумма (~2 400) далека от заявленных 12 000+, а счётчик «components available»
  на тех же страницах упирается в 200. Точная доля — не проверено.

### Зависимости и качество

- Обещание платформы: «Components are React and TypeScript, styled with Tailwind CSS, and built to sit next to
  shadcn/ui primitives.» ([21st.dev](https://21st.dev)).
- Код скрыт до копирования (403 без ключа). Код community-компонентов я не проверял — не проверено.
  Код Magic UI и Aceternity проверен в их разделах.
- npm-зависимости в той же выборке из 40 AI Chat-компонентов:
  - lucide-react — 14, class-variance-authority — 6, @solar-icons/react — 6;
  - framer-motion — 5, @base-ui/react — 5, motion — 1, gsap — 1;
  - tailwind-merge — 3, clsx — 3, ai — 1;
  - `next` — 2, то есть код только для Next.js;
  - `cn` — 6. Это утилита, а не npm-пакет. Metadata у этих авторов ошибочна.
- Единого стандарта a11y и reduced motion нет. Качество зависит от автора.

### Поддержка

- Changelog: 77 releases, последний 2026-10-09 ([changelog.md](https://21st.dev/changelog.md)).
- Последние записи — про video blocks для Remotion, Design Bug Bot для PR и каталог open-source apps.
- Публичный код маркетплейса [serafimcloud/21st](https://github.com/serafimcloud/21st) (MIT, 5 559 stars) не
  обновлялся с 2025-05-28.

### Agent Elements — отдельный MIT-registry команды 21st

- README: «A shadcn-style registry of agent UI primitives — message lists, streaming markdown, tool cards (Bash,
  Edit, Search, Todo, Plan…), clarifying questions, and a composable input bar»
  ([21st-dev/agent-elements](https://github.com/21st-dev/agent-elements)).
- 25 items: agent-chat, message-list, input-bar, model-picker, mode-selector, bash-tool, edit-tool, todo-tool,
  plan-tool, subagent-tool, mcp-tool, thinking-tool, question-tool и др. ([r/index.json](https://agent-elements.21st.dev/r/index.json)).
- Требования: «React 19, Tailwind v4, a shadcn-initialised project».
- input-bar зависит от `ai` (Vercel AI SDK). edit-tool — от `@pierre/diffs`. spiral-loader — от `next/dynamic`,
  `lottie-react`, `next-themes`.
- MIT, 110 stars. Repo создан 2026-03-12, последний push 2026-04-24.
- Для worfy это самый близкий образец tool cards в chat Sessions. Но код завязан на Vercel AI SDK и Tailwind.

### Вывод для worfy

- Как источник кода — слабо. Лицензия и качество у каждого компонента свои. Код за ключом. Tailwind и shadcn везде.
- Как каталог примеров — полезно. AI Chat, Sidebar, Dialogs, Tabs, Tables дают много вариантов одной задачи.
- 21st AI: режим `code` выдаёт React + shadcn + Tailwind. worfy пишет свой CSS, результат придётся переписывать.
- Качество генерации на экранах worfy — не проверено. Генерация платная.
- Только маркетинг: Hero, Features, CTA, Pricing, Testimonials, Footer, Landing Pages, Backgrounds, Marquee,
  Text Animation.
- Риски: лицензия на уровне компонента, ToS с обязательной ссылкой на 21st, Next.js-only код у части
  компонентов, платный доступ к коду.

## Что пригодится worfy по зонам

| Зона worfy | Beautiful UI | RareUI | Magic UI | Aceternity UI | 21st.dev |
|---|---|---|---|---|---|
| Canvas (React Flow) | Flowchart как образец схемы | — | animated-beam для иллюстраций связей | — | только поиск идей |
| Chat Sessions | Thinking, Streaming Text, Tool Chips, Approval Card, Task Rows, Context Cards, Prompt Bar, Diff Table, Code Block | — | — | placeholders-and-vanish-input (эффект отправки) | категория AI Chat; Agent Elements (MIT) |
| Terminals (xterm) | Code Block для вывода команд | — | terminal — только анимация для Guide | terminal — демо | — |
| Panels, sidebars | Sidebar Nav (заменить иконки), Search, Records Table, Filter Table | — | dock, file-tree | sidebar (слабая a11y) | категория Sidebar |
| Selection toolbar | Selection Actions | — | — | — | — |
| Onboarding | Loading State | — | border-beam или shine-border (подсветка кнопки), blur-fade, animated-list, confetti | multi-step-loader | — |
| Guide (анимированная графика) | кадры из Thinking, Tool Chips, Agent Screen | — | animated-beam, orbiting-circles, file-tree, terminal, number-ticker | tracing-beam, timeline, typewriter-effect | — |
| Empty states | — | — | dot-pattern, grid-pattern | Empty States — только Pro | — |
| Loading states | Loading State (сетка и таймер), Thinking | Loading Spinner | animated-circular-progress-bar | loader, multi-step-loader | — |

## Сквозные риски

1. Tailwind. Все пять рассчитаны на Tailwind, четыре — на v4. В worfy Tailwind нет.
   - `@import "tailwindcss"` подключает Preflight. Он сбрасывает базовые стили всех элементов: margins,
     borders, headings, lists, images ([tailwindcss.com/docs/preflight](https://tailwindcss.com/docs/preflight)).
   - Рядом с 12 478 строками своего CSS это меняет вид существующих экранов.
   - Docs показывают, как подключить Tailwind без Preflight. Как компоненты выглядят без него — не проверено.
2. motion. Magic UI, Aceternity и RareUI делают анимации на motion или framer-motion. Это новая runtime-зависимость.
   Beautiful UI обходится CSS.
3. Лицензии.
   - Чисто: Beautiful UI (MIT, кроме иконок Sidebar Nav), RareUI (MIT), Magic UI free (MIT).
   - Нельзя в публичный repo: Magic UI Pro, Aceternity All-Access.
   - Неясно: Aceternity free.
   - Решается для каждого компонента отдельно: 21st.
4. Доступность. У Magic UI, Aceternity и RareUI почти нет ARIA, клавиатуры и prefers-reduced-motion. У Beautiful
   UI заметно лучше, но меню без ролей.
5. Постоянные анимации. WebGL и canvas-циклы без паузы (RareUI Liquid Metal, Magic UI Particles). three.js и
   tsparticles у Aceternity. В окне Electron рядом с React Flow и xterm это лишняя нагрузка на GPU.
   Замеров нет — не проверено.
6. Next.js-специфика. `next/dynamic` в RareUI и Agent Elements. Зависимость `next` у части компонентов 21st.
   peerDependency `next` у `glimm`. worfy собирается Vite.
7. Ошибки в JSON registry.
   - Magic UI File Tree не объявляет свои зависимости.
   - Aceternity Tabs объявляет лишнюю зависимость, registry в статусе degraded.
   - Beautiful UI `foundation` не объявляет `shadow-plugin`.
   - RareUI объявляет `typescript` как runtime dependency.

## Что не проверено

- Работа shadcn CLI с этими registry в проекте без Tailwind. CLI не запускался по правилам задачи.
- Цены Central Icons.
- Как выдаётся код Magic UI Pro.
- Связь rareui.com и rareui.in: rareui.com отдал HTTP 429.
- Код community-компонентов 21st (закрыт API key) и качество 21st AI на экранах worfy.
- Лицензии templates, которые продают авторы на 21st.
- Текущий список лицензий в форме публикации 21st.
- Нагрузка на GPU и прирост размера bundle.

## Источники

Все прочитаны 2026-11-11. Вторичные источники помечены.

Beautiful UI:
- https://beautifului.dev — главная, список primitives, meta description
- https://beautifului.dev/license — MIT
- https://beautifului.dev/harness — демо agent chat
- https://www.beautifului.dev/r/registry.json и items `/r/<name>.json` (approval-card, thinking-state,
  loading-state, glide-menu, prompt-bar, sidebar-nav, foundation)
- https://github.com/slev12397/beautiful-ui — README, LICENSE, package.json; `gh api repos/slev12397/beautiful-ui`
  и `/commits?per_page=5`
- https://api.github.com/users/slev12397 — профиль автора
- https://turbodesign.co/ — студия Turbo
- https://registry.npmjs.org/glimm, https://registry.npmjs.org/liveline — metadata пакетов
- https://unpkg.com/@central-icons-react/round-outlined-radius-2-stroke-2@1.2.39/LICENSE.md — лицензия Iconists
- https://www.drweb.de/beautiful-ui-ki-agenten-bausteine/ — вторичный, статья от 2026-08-12
- https://github.com/ansh/beautiful-ui-registry — вторичный, неофициальный registry

RareUI:
- https://rareui.in — главная, meta description, JSON-LD
- https://rareui.in/docs, https://rareui.in/docs/installation/cli, https://rareui.in/changelog, https://rareui.in/templates
- https://rareui.in/r/index.json, https://rareui.in/r/LiquidButton.json, https://rareui.in/r/LiquidTooltip.json
- https://github.com/Codewithswappy/RareUI — LICENSE, package.json, исходники LiquidMetal, LiquidTooltip,
  AnimatedTab, LiquidWave, LiquidMetalLazy; `gh api` repo и commits; GitHub code search
- https://registry.npmjs.org/rareui — CLI
- https://rareui.com — не открылся (HTTP 429)

Magic UI:
- https://magicui.design, https://magicui.design/docs/installation, https://magicui.design/docs/legacy,
  https://magicui.design/docs/mcp, https://magicui.design/docs/story
- https://magicui.design/r/registry.json и items (marquee, particles, globe, border-beam, terminal, file-tree,
  animated-list, dock)
- https://pro.magicui.design, https://pro.magicui.design/license; https://pro.magicui.design/pricing — 404
- https://github.com/magicuidesign/magicui — LICENSE.md, apps/www/package.json, исходники компонентов;
  `gh api` repo и commits; GitHub code search
- https://github.com/magicuidesign/mcp, https://registry.npmjs.org/@magicuidesign%2Fmcp,
  https://registry.npmjs.org/@magicuidesign%2Fcli

Aceternity UI:
- https://ui.aceternity.com, https://ui.aceternity.com/components, https://ui.aceternity.com/pricing (включая
  FAQ в JSON-LD), https://ui.aceternity.com/licence, https://ui.aceternity.com/terms,
  https://ui.aceternity.com/installation, https://ui.aceternity.com/brand-facts, https://ui.aceternity.com/changelog
- https://ui.aceternity.com/registry/<name>.json — sidebar, animated-modal, placeholders-and-vanish-input, tabs,
  background-beams, sparkles, canvas-reveal-effect, terminal, multi-step-loader, globe, 3d-globe, world-map,
  vortex, github-globe
- https://api.github.com/users/aceternity/repos, https://api.github.com/users/manuarora700
- https://www.producthunt.com/products/aceternity-ui/launches — сторонний источник, дата запуска

21st.dev:
- https://21st.dev (markdown-версия по `Accept: text/markdown`), https://21st.dev/llms.txt,
  https://21st.dev/pricing.md, https://21st.dev/mcp.md, https://21st.dev/ai.md, https://21st.dev/changelog.md,
  https://21st.dev/terms, https://21st.dev/openapi.json
- https://21st.dev/@dillionverma/library/magic-ui.md, https://21st.dev/@dillionverma/components/file-tree.md
- https://21st.dev/community/components/s/ai-chat.md и 40 страниц компонентов из него; страницы
  `community/components/s/<tag>.md` для 30 категорий
- https://21st.dev/r/dillionverma/file-tree — HTTP 403 без API key
- https://github.com/serafimcloud/21st (включая apps/web/lib/licenses.ts), https://github.com/21st-dev/magic-mcp,
  https://github.com/21st-dev/agent-elements, https://agent-elements.21st.dev/r/index.json и items
  (input-bar, edit-tool, question-tool, spiral-loader)
- https://registry.npmjs.org/@21st-dev%2Fmagic, https://registry.npmjs.org/@21st-dev%2Fcli

Общие:
- https://ui.shadcn.com/r/registries.json — официальный индекс shadcn registries и их health
- https://tailwindcss.com/docs/preflight — Preflight в Tailwind v4
- `gh api repos/IDSAD-XL/worfy` — visibility и license репозитория worfy
