# Code story — worfy-layout 07: Документация en и ru

Kind: pr · Epic: worfy-layout · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 03–06 сделали footer с chip-ом версии, View button-ы в трёх зонах, меню «Move to», Reset layout, клавиши и
drag. Английская `app-shell.md` описывала их одним длинным вступлением, без своих разделов, а русские страницы ещё
говорили о колонке Harness в toolbar, о «вкладках» видов и о «Memory in the toolbar». В `CONTEXT.md` не было терминов
View button и Footer. Темы Guide и комментарии в main называли toolbar местом, где ставится Harness и видна память.

- Требование: [Что строить](../issues/07-документация-en-и-ru.md#что-строить)

## 2. Термины View button и Footer в CONTEXT.md

Code: `CONTEXT.md:352-358` · key lines: 353, 354, 357

```md
**View button**:
Кнопка, которая переключает main area на один из шести видов (Canvas, Session, Pipeline, Runs, Pull requests, Acceptance). Стоит в одной из трёх зон: Header, Sidebar (rail), Footer. Расстановка — в app settings этой Machine. Header в коде и документах остаётся toolbar (`Toolbar.tsx`, `w-toolbar`); «Header» — имя зоны в меню «Move to».
_Avoid_: вкладка, tab, View switch (как имя всего набора)

**Footer**:
Полоса внизу окна под sidebar и main area: View button-ы зоны Footer и chip версии с popover-ом приложения и Harness.
_Avoid_: status bar, нижняя панель
```

- Что делает: два термина раздела App, тексты — из «Решений» Ticket-а. К View button добавлена строка о том, что header
  в коде и документах остаётся toolbar.
- Почему здесь: Ticket называет `CONTEXT.md`, раздел App, в «Где в коде»; тексты терминов заданы в его «Решениях».
- Без него: агенты и страницы продолжали бы звать кнопки вкладками или View switch, а footer — status bar.
- Требование: [Решения](../issues/07-документация-en-и-ru.md#решения)
- Риски и пробелы test-ов: словарь ничем не проверяется. Две строки раздела Workflow («вкладка Runs», «вкладка Pull
  requests») переписаны на «вид», чтобы не спорить с _Avoid_.

## 3. Раздел View buttons: зоны таблицей, а не абзацем

Code: `docs/features/app-shell.md:191-202` · key lines: 193, 195, 196, 197, 199

```md
Each button stands in one of three zones, in an order of its own:

| Zone | Where | By default | Look |
|---|---|---|---|
| Header | The group of the toolbar, after the title of the Project | Canvas, Session | Icon, label and badge |
| Sidebar | A block of the rail under a thin line, after the sections of the top group and before Health check | Pull requests, Acceptance | A square of 34 pixels with an 18-pixel icon and a small window mark in its corner; the tooltip on the right |
| Footer | The left part of the footer | Pipeline, Runs | 22 pixels high: icon, label and badge |

These pages call the top strip the toolbar; "Header" is the name of its zone in the button's menu. Where the buttons
stand is the layout. It is one per Machine, kept in the app settings of this computer, and every window of this computer
shows it and follows each change at once. No button can be hidden: each of the six always stands in exactly one zone. A
zone may be empty and then draws nothing, except during a drag.
```

- Что делает: новый раздел «View buttons» страницы App shell с блоками Behaviour, Windows, On a Linked machine, How it
  works и Implementation. Вступление страницы стало коротким и ссылается на него, раздел Footer получил таблицу точки
  chip-а, четыре строки popover-а и свои Windows, Linked machine, How it works. Описаны решения, как они построены:
  «Move to» — заголовок группы радио-пунктов, а не подменю; при скрытом sidebar кнопки rail стоят в конце header после
  черты и не принимают drop; неактивная кнопка — `aria-disabled`, остаётся Tab stop и двигается; янтарная точка при
  выключенном plugin Harness и кнопка Enable.
- Почему здесь: Ticket называет `docs/features/app-shell.md` и требует разделы Footer и View buttons с этими блоками.
- Без него: читателю пришлось бы собирать поведение кнопок из трёх абзацев вступления, а How it works и Implementation
  для них не было.
- Требование: [Что строить](../issues/07-документация-en-и-ru.md#что-строить)
- Риски и пробелы test-ов: `scripts/check-feature-docs.mjs` проверяет только пути. Утверждения сверены с
  `ViewZone.tsx`, `ViewButton.tsx`, `views.tsx`, `version-dot.ts`, `VersionChip.tsx` и `shell.css` вручную.

## 4. Focus mode: footer вне слоя

Code: `docs/features/focus-mode.md:22-25` · key lines: 22, 23, 24, 25

```md
The layer covers the main area of the window: the toolbar and the Canvas. The sidebar stays next to it and the footer
under it, and both keep working, except their [View buttons](app-shell.md#view-buttons): those of the rail and of the
footer are inert while focus mode is on, as the view under the layer is not seen. The version chip of the footer keeps
working. With the sidebar hidden, the layer is the whole width of the window above the footer.
```

- Что делает: страница Focus mode больше не говорит, что при скрытом sidebar слой — всё окно: footer остаётся под ним.
  Строка Tab в таблице клавиш называет chip версии и исключает View button-ы.
- Почему здесь: Ticket называет `focus-mode` среди страниц для правки.
- Без него: страница противоречила бы `ViewZone.tsx`, где у зон rail и footer стоит `inert` в focus mode.
- Требование: [Что строить](../issues/07-документация-en-и-ru.md#что-строить)
- Риски и пробелы test-ов: не проверено test-ом страницы; поведение покрывает `test/unit/view-zones.test.tsx`.

## 5. Guide: строка Harness в popover-е версии

Code: `src/renderer/guide/topics/harness/en.json:56-58` · key lines: 57, 58

```json
        "claude": "CLAUDE CODE",
        "item": "Harness line",
        "itemNote": "version popover, Settings → Pipeline",
```

- Что делает: схема Under the hood темы Harness называет источник установки строкой Harness в popover-е версии, а не
  пунктом toolbar. Так же поправлены описание потока, вступление и шаг 1 темы Harness, подпись счётчика памяти темы
  «The window and your data», и их ru.json. Тема Sessions говорит о toolbar только про Limits, которые там и остались.
- Почему здесь: Ticket называет `src/renderer/guide/topics/harness/`, `sessions/` и `the-window-and-your-data/`.
- Без него: Guide отправлял бы искать Install и память в header, где их нет.
- Требование: [Что строить](../issues/07-документация-en-и-ru.md#что-строить)
- Риски и пробелы test-ов: ни один test не сверяет тексты темы; длина подписи на схеме не проверена глазами.
  `topic.json` темы Harness ссылается на `harness.md` по старому commit-у, поэтому `scripts/guide-lag.mjs` покажет
  отставание, пока commit не обновят после merge.

## 6. Что сознательно не меняли

- Комментарии и строки вне списка брифа, которые тоже зовут toolbar местом Harness, памяти или версии (`src/main/index.ts`,
  `src/main/harness/install.ts`, `src/main/first-run/checks.ts`, `src/main/ipc/harness-migration.ts`,
  `src/main/ipc/first-run.ts`, `src/main/harness/dependency-cleanup.ts`, `src/shared/settings/app-settings.ts`) и
  комментарии test-ов: они вне «Где в коде» и списка брифа.
- Русские страницы, которые отстают по другим Epic-ам, синхронизированы целиком только для девяти страниц Ticket-а; в
  `storage-and-diagnostics`, `transcripts-and-usage`, `autopilot`, `vendors`, `changes` и `link` поправлены лишь места
  про toolbar, вкладки и колонку Harness, их строка перевода не менялась.

## 7. Как проверено

- `pnpm lint` — exit 0 (в нём `scripts/check-feature-docs.mjs`: 40 страниц, 3310 путей).
- `pnpm typecheck` — exit 0.
- `pnpm test` — exit 0 (964 файла test-ов).
- `gate fast` — exit 0, `[gate] green (fast)`.

## Проверить себя

1. Почему страницы продолжают звать верхнюю полосу toolbar, хотя в меню кнопки её зона называется «Header»?
   - Ответ: так решено в spec (Q3): header в коде и документах остаётся toolbar (`Toolbar.tsx`, `w-toolbar`), а
     «Header» — только имя зоны в меню «Move to».
   - Строки: `CONTEXT.md:352-354`
2. Окно в focus mode, sidebar скрыт. Что из footer-а можно нажать?
   - Ответ: только chip версии: footer вне слоя, а его View button-ы inert, пока focus mode включён.
   - Строки: `docs/features/focus-mode.md:22-25`
3. Где в Guide теперь стоит источник установки Harness и почему не в toolbar?
   - Ответ: в строке Harness popover-а версии (и в Settings → Pipeline): в toolbar Harness больше нет, его строки — в popover-е chip-а версии в footer-е.
   - Строки: `src/renderer/guide/topics/harness/en.json:56-58`
