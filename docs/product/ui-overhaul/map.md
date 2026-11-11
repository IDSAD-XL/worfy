# UI overhaul worfy на готовых библиотеках — карта

Тема Product Session `ui-overhaul`, начата 2026-11-11. Вопрос владельца: UI worfy во многом написан
вручную. Стоит ли переделать его на готовых библиотеках компонентов, которые ставятся «как код»?
Список владельца: shadcn/ui, Base UI, Radix, Sonner, Vaul, cmdk, NumberFlow, skill pick-ui-library
(github.com/emilkowalski/skills), Beautiful UI, RareUI, Magic UI, Aceternity UI, 21st.dev. Что можно
заменить, какой это объём работы и что мы выиграем.

## Destination

Владелец решил, переводить ли UI worfy на готовые компоненты. Варианты: полный overhaul, замена
отдельных primitives (dialog, menu, tooltip, toast…) или отказ. Если «да», в `drafts/` лежит черновик
epic-а с объёмом в Ticket-ах.

## Notes

- Skills темы: `worfy:grilling` для вопросов, `worfy:research` для фактов. Заметки агентов лежат в
  `notes/`, сводка — в `research-ui-библиотеки.md`.
- Факты о стеке на 2026-11-11 (main `e66d9cf4f`), из [package.json](../../../package.json):
  - renderer: React 19.3.0, @xyflow/react 12.12.0 (canvas), zustand 5.0.15, react-markdown 10.1.0,
    @xterm/xterm 6.0.0; сборка Vite 7.3.6 через electron-vite 5.0.0, Electron 44.10.2;
  - UI-библиотеки компонентов нет. Tailwind нет. Иконочного набора в зависимостях нет;
  - `src/renderer`: 207 файлов `.tsx` (40 994 строки), 207 `.ts` (27 267), 42 `.css` (12 478).
- Сводка исследования: [research-ui-библиотеки.md](research-ui-библиотеки.md), 2026-11-11. Главное:
  - самописное в worfy — поведение, а не вид. 19 модальных dialog без общего компонента: у 13 нет focus
    trap, у 12 нет возврата фокуса. 11 popover и 11 menu со своим позиционированием. Около 335 `title=`
    вместо tooltip;
  - свой вид уже собран в систему: 85 design tokens, `docs/design/F-SPEC.md`. `docs/design/BRIEF.md:88`
    запрещает копировать вид чужого продукта;
  - Base UI (`@base-ui/react` 1.9.0, MUI) работает под свой CSS. С July 2026 он стоит по умолчанию и в
    shadcn/ui;
  - shadcn/ui без Tailwind v4 не работает. Tailwind встанет рядом с нашим CSS только с `prefix(tw)`;
  - Sonner и cmdk почти ничего не дают: свои toast-ы и палитра умеют больше. Vaul не поддерживается;
  - коллекции эффектов (Magic UI, Aceternity UI, RareUI, 21st.dev) — для landing page. Beautiful UI —
    образец для чата;
  - объём: путь Base UI 15–20 Ticket-ов, полный overhaul на shadcn 35–45, только своя чистка 4–6.

## Decisions so far

Владелец, 2026-11-11, ответ на сводку [research-ui-библиотеки.md](research-ui-библиотеки.md):

- Запрет `docs/design/BRIEF.md:88` «Do NOT copy the look of any existing product» отменён: «отменяем это
  решение, никаких запретов». Вид можно брать у других продуктов. Строку из `BRIEF.md` убирает docs PR
  orchestrator-а [#1802](https://github.com/IDSAD-XL/worfy/pull/1802); строка 87 («no AI tropes»)
  остаётся.
- NumberFlow: «NumberFlow можно». Для процентов limits, context meter и стоимости; анимировать только
  реальную смену значения.
- Остальное — «с остальным согласен»:
  - полного overhaul на shadcn/ui с Tailwind нет. Остаётся довод цены: 35–45 Ticket-ов, весь CSS и сотни
    test-ов;
  - Base UI — слой поведения под свой CSS: Dialog, Popover, Menu, Context Menu, Tooltip, Toggle Group,
    Radio Group, Tabs;
  - первым идёт spike Base UI в Electron. Перед миграцией — фундамент: шкала z-index, один helper
    открытых слоёв, `defaultPrevented` в `MessageInput`. Settings, Keyboard shortcuts и Guide переносятся
    одним шагом вместе с их guard-ами;
  - toast-ы свои, Sonner нет. Command palette: свой ranking, cmdk нет, оболочка — Dialog из Base UI.
    Vaul нет;
  - коллекции эффектов (Magic UI, Aceternity UI, RareUI, 21st.dev) в UI нет. Beautiful UI — образец для
    chat Session;
  - свои `Button` и `Chip` с вариантами, без библиотеки; `eslint-plugin-jsx-a11y` и axe в e2e;
  - выбор и правила обёрток — в ADR. Skill pick-ui-library — только справка.
- Seam-ы test-ов черновика [worfy-ui-kit](drafts/worfy-ui-kit.md): «да, устраивает». Это unit test на каждую
  обёртку kit и один e2e spec «слои» в Electron. Существующие test-ы по роли и `data-testid` остаются защитой.
- Рецензия критика [worfy-ui-kit-2026-11-11](../critic/worfy-ui-kit-2026-11-11.md), вердикт Split. Все три
  возражения приняты («ок», «ок», «да») и внесены в черновик:
  - spike проверяет свой `Select` внутри модального окна kit и выбирает одно из трёх решений;
  - фундамент без Base UI (шкала z-index, helper слоёв, Esc в поле чата) — отдельный Ticket во Wave 1;
  - 4 inline confirm внутри панелей остаются inline.
- Вид в Epic-е можно менять, если это улучшает UX: «насчет того что вид не поменяется это не так критично,
  изменения внешнего вида допустимы если они улучшают UX».
- Черновик [worfy-ui-kit](drafts/worfy-ui-kit.md) принят: «да». В нём 19 Ticket-ов в 6 Wave-ах. Orchestrator
  переносит его в Epic.
- Запрет «no AI tropes (gradient washes, left-border accent cards, emoji, Inter/Roboto/Arial)» в
  `docs/design/BRIEF.md:87` тоже отменён: «да отменяю». Остальные правила строки Craft остаются. Правку файла
  делает orchestrator: файл вне папки темы.
- Epic запустит владелец сам, позже: «запущу епик потом». В очередь его никто не ставит.
- 2026-11-11 orchestrator перенёс черновик в Epic `worfy-ui-kit`:
  [.scratch/worfy-ui-kit/spec.md](../../../.scratch/worfy-ui-kit/spec.md), 19 Ticket-ов в 6 Wave-ах. Черновик
  [worfy-ui-kit](drafts/worfy-ui-kit.md) остаётся с пометкой «Moved».

## Not yet specified

- Что покажет spike Base UI: клик в `<webview>`, фокус рядом с xterm, drag Node-а, Esc под focus mode,
  бюджет старта 3 s.

## Out of scope

- Редизайн всего приложения, shadcn/ui, Tailwind.
- Sonner, cmdk, Vaul, Magic UI, Aceternity UI, RareUI, 21st.dev.
- Перенос вида Beautiful UI в chat Session: возможная отдельная тема.
