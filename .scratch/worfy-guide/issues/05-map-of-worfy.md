# 05 — Map of worfy: обзорная схема, из которой можно перейти в любой Topic

Type: task
Status: done 2026-10-31T19:39Z
PR: #1152
Blocked by: 04
Source: [spec.md](../spec.md), Q7, Q13, Q18

## Что происходит

Новому пользователю нужна одна картинка: как связаны Project, Canvas, Session, Epic, Ticket, Wave, Autopilot, Gate и Harness. Основа — `docs/features/concepts.md`.

## Что делаем

Map of worfy в выбранном стиле первым пунктом списка: простой уровень, Under the hood, оба языка. Блок ведёт в свой Topic; блок ещё не написанного Topic-а ведёт на Full page.

## Готово, когда

- [x] Связи и подписи сверены с кодом и `docs/features/concepts.md`.
- [x] Клик по блоку открывает Topic или страницу.
- [x] Обе темы, оба языка, reduced motion проверены снимками.

## Тесты

- Тесты реестра из Ticket-а 03 покрывают новый Topic; e2e переход по клику в `test/e2e/guide.spec.ts`.

## Где в коде

- `src/renderer/guide/`, `docs/features/concepts.md`, `CONTEXT.md` — только чтение.

## Итог

Map of worfy — Topic `map-of-worfy` (`src/renderer/guide/topics/map-of-worfy/`), первая строка `registry.ts`: Guide
открывается на нём и в упакованной сборке. Схема `viewBox` 976×690, 17 блоков, 17 связей, 3 шага проигрывателя; тексты
EN и RU, Under the hood с пятью файлами и одним ограничением; `topic.json` сверен с `docs/features/concepts.md`
(35ac7463) и `docs/features/epic-frames.md` (e3c54550).

**Набор схем дополнен, не скопирован** (`scene/model.ts`, `scene/LivingScene.tsx`, `guide.css`): то, что Ticket 04
оставил Map-у (его «Итог»: «рамки Epic с вкладкой, плашки Wave, подписи областей»). Рамка (`SceneFrame`: `canvas` —
точечное поле, `epic` — подкраска 8 % / обводка 70 %) лежит под блоками, её блок — вкладка (`shape: 'tab'`, 32 по
высоте, 14 px / 700, подпись справа 11 px `--text-muted`), рамка светится и гаснет вместе с вкладкой. Плашка
(`shape: 'chip'`, 26, пунктир `4 3`, 16 % цвета группы) — Ready wave. Подписи областей (`regions`) 11 px / 600,
разрядка 0,06 em. Схема со своей рамкой Canvas не рисует поле под собой целиком. У связи можно назвать стороны и
сдвиг концов вдоль стороны (`fromSide`/`toSide`/`fromShift`/`toShift`): две связи одной стороны не сходятся в точку.
`edgeShape` считает по прямоугольнику блока (`boxOf`), а не по размеру Node.

**Куда ведёт блок** — `blockTarget` (`scene/model.ts`): в Topic, если Guide его показывает (`shownTopics` реестра),
иначе на Full page — страницу `docs/features/` блока на GitHub, на commit сборки (`githubFileUrl`), через
`shell.openExternal`. Блок с Topic-ом и без страницы, как в Ticket-е 04, всегда открывает Topic. Под указателем у блока,
ведущего на страницу, подсказка «Opens on GitHub». Вызов `shell.openExternal` вынесен из `GuideWindow.tsx` в
`links.ts` (`openInBrowser`): один путь для ссылок окна и блоков. Id Topic-ов — slug их Ticket-ов
(`06-topic-autopilot.md` → `autopilot`, `19-…-the-window-and-your-data.md` → `the-window-and-your-data`); test
`guide-map.test.tsx` краснеет, если Topic реестра появится под другим id и до него нельзя дойти с Map.
Решено без владельца: Machine ведёт в «The window and your data» (страница `storage-and-diagnostics.md`: папка данных
и есть Machine), Limits — в Sessions (страница `transcripts-and-usage.md`, раздел Limits), Profile — в Harness.

**Утверждения и их источники** (для проверки; `concepts.md` = `docs/features/concepts.md` на 35ac7463):

| Что на схеме или в тексте | Источник |
|---|---|
| Три области по положению: выше подписи «THIS MACHINE» только Linked machine («OTHER MACHINE»); всё остальное ниже; Autopilot и Limits — своя колонка «NOT NODES» справа от рамки Canvas | `concepts.md:113-114`, `:117-120`, `:59` |
| Linked machine вне Canvas, «linked by a 6-digit code» (подпись блока); связь Linked machine → Machine без подписи | `concepts.md:117`, `docs/features/link.md:4`, `src/main/link/pairing.ts:140` |
| Linked machine → Canvas «opens it, if access is on» | `concepts.md:118-120` |
| Machine «a computer with a worfy data folder» | `concepts.md:112-113` |
| Machine → Project «hosts» (RU «держит»); «A Project lives on one Machine» | `concepts.md:113-114` |
| Project «a repository or a folder»; Project → Canvas «has exactly one» | `concepts.md:10-11` |
| Machine → Harness «one per Machine» | `concepts.md:96-97` |
| Harness «rules, skills, agents, hooks»; Harness → Session «guides the agents» | `concepts.md:94` |
| Harness → Gate «includes» | `concepts.md:94-95` |
| Harness → Profile «runs a Project by»; Profile → Project «describes»; «how one Project is run» | `concepts.md:97-99` |
| Gate «are the changes ready?» | `concepts.md:65` |
| Canvas «an infinite plane of Nodes»; внутри рамки Canvas — Ticket, Session, Card, Terminal, Browser | `concepts.md:11-12`, `:23` |
| Epic frame, Ticket и Subagent внутри рамки Canvas (Derived Node) | `concepts.md:15-16` |
| Epic «Tickets for one goal», Ticket внутри рамки Epic; Ticket «one unit of work» | `concepts.md:37` |
| Плашка «Ready wave · N» на рамке Epic | `docs/features/epic-frames.md:26`, `src/renderer/canvas/nodes/EpicFrameNode.tsx:140` |
| Ticket → Wave «ready now» (входит в плашку снизу); Wave вычисляется и нигде не хранится (сказано один раз, в подписи плашки) | `concepts.md:39-41`, `src/shared/workflow/waves.ts:4-5` |
| Autopilot → Wave «runs», Autopilot «Waves without a person»; Autopilot → Limits «waits for reset» | `concepts.md:59-60` |
| Limits «subscription windows: 5 hours, 7 days» (число и единица через неразрывный пробел); вне Canvas (в toolbar) | `concepts.md:32-33`, `docs/features/transcripts-and-usage.md:5` |
| Session «one Claude Code conversation» | `concepts.md:79-80` |
| Session → Subagent «starts»; Subagent «started by a Session» | `concepts.md:81-82` |
| Session → Ticket и Subagent → Ticket «Binding» | `concepts.md:90-91` |
| Card «an HTML app an agent built»; Session → Card «may change» | `concepts.md:21-22` |
| Browser «built-in Chromium»; Session → Browser «arrives signed in» | `concepts.md:23`, `:26` |
| Terminal «your shell; agents do not use it» | `concepts.md:22` |
| Under the hood: worfy не владеет workflow, источник правды — Ticket-ы, HANDOFF, ADR, транскрипты, Gate; меняет только инструментами Harness | `docs/adr/0002-worfy-is-a-view-over-the-workflow.md:5` |
| Ticket-ы приходят из `epic-status` Harness-а | `src/main/workflow/reader.ts:3-4` |
| Binding — из сигналов (claim, ветка) или руками | `src/shared/binding/resolve.ts:4-11`, `concepts.md:90-91` |
| Layout, Settings, список Project-ов — в папке данных Machine, не в репозитории | `docs/features/storage-and-diagnostics.md:11-12`, ADR-0005 |
| Profile вне репозитория, читается через Harness | `concepts.md:99`, `src/main/workflow/profile.ts:6-8` |

Не нарисовано ради читаемости (единственный пункт «Limits» Topic-а): Blocked by, Subagent-ы Subagent-ов, Pipeline и Stage-и,
HANDOFF, Full/Silent mode, Stable copy, Archive, Done shelf. Terminal AI из прототипа Ticket-а 01 убран: у него нет
своего Topic-а, он часть Terminal.

**Контраст** (WCAG 2.x, порог 4.5:1; `test/unit/guide-scene-colours.test.tsx` дополнен этими парами):

| Текст | Фон | Светлая | Тёмная |
|---|---|---|---|
| Название вкладки (`--text`) | `--surface` | 16,83 | 14,24 |
| Подпись вкладки, подпись области (`--text-muted`) | `--surface` | 5,99 | 5,93 |
| Подпись вкладки Epic (`--text-muted`) | `--canvas` | 5,60 | 6,58 |
| Название плашки (`--text`) | 16 % цвета группы на `--surface` (Workflow) | 13,95 | 9,43 |

Новых цветов нет: рамки и плашка — `color-mix` от цвета группы.

**Tests:**

- Unit: `test/unit/guide-map.test.tsx` (новый) — Map первый в реестре и в упакованной сборке; у каждого блока, связи,
  области и шага есть текст на двух языках, названия блоков в RU английские; Node-ы внутри рамки Canvas, остальное
  вне; Ticket внутри рамки Epic, плашка на её кромке; ровно 17 связей, у каждой строка `concepts.md` в комментарии;
  каждый блок ведёт в Topic из spec и на существующую страницу; у каждого Topic-а реестра есть блок; клик и Enter
  открывают Full page на commit сборки, а при показанном Topic-е — Topic. `guide-scene-model.test.tsx` — вкладка и
  плашка, стороны и сдвиги связи, `blockTarget`. `guide-scene.test.tsx` — рамка светится и гаснет с вкладкой, поле
  Canvas, подпись области, плашка. `guide-window.test.tsx` — Guide открывается на Map, Full page Map-а —
  `concepts.md`.
- e2e `test/e2e/guide.spec.ts`: Map первый и открыт по умолчанию; клик по каждому из 17 блоков — Topic, если он
  есть, иначе адрес `https://github.com/IDSAD-XL/worfy/blob/<sha>/docs/features/<page>.md` в `shell.openExternal`
  (в test-е подменён и только записывает); Enter на блоке работает как клик. Test-ы Ticket-а 04 теперь сначала
  выбирают test-овый Topic: Guide открывается на Map.

**Снимки** (Playwright `page.screenshot()` на собранном приложении, 1280×800):

- EN: [светлая](../evidence/05-map-en-light.png), [тёмная](../evidence/05-map-en-dark.png); RU:
  [светлая](../evidence/05-map-ru-light.png), [тёмная](../evidence/05-map-ru-dark.png);
- подсвечен Session, подписи его связей: [светлая](../evidence/05-map-lit-en-light.png),
  [тёмная](../evidence/05-map-lit-en-dark.png);
- шаг 1 (Epic, Ticket, Wave, Autopilot, Limits): [светлая](../evidence/05-map-step-en-light.png),
  [тёмная](../evidence/05-map-step-en-dark.png);
- Reduce motion, RU: [светлая](../evidence/05-map-reduced-motion-ru-light.png),
  [тёмная](../evidence/05-map-reduced-motion-ru-dark.png);
- Under the hood развёрнут: EN [светлая](../evidence/05-map-under-the-hood-en-light.png),
  [тёмная](../evidence/05-map-under-the-hood-en-dark.png); RU [светлая](../evidence/05-map-under-the-hood-ru-light.png),
  [тёмная](../evidence/05-map-under-the-hood-ru-dark.png).

**Круг правок после ревью (REJECTED, 2 средних/высоких и 6 low).** Autopilot и Limits ушли из верхнего ряда «OTHER
MACHINE» в свою колонку «NOT NODES» справа от Canvas; столбец Machine → Project → Profile → Harness → Gate слева, связь
Machine → Harness идёт дугой справа от столбца. Подпись Ticket → Wave — «ready now», связь входит в плашку снизу.
Сокращены: вступление сводки, шаг 1 (повторял сводку), подпись связи Linked machine → Machine, повторы «computed and
stored nowhere», два пункта «Limits». Снимок Under the hood прокручен к заголовку. Новые unit-test-ы
(`guide-map.test.tsx`: области, подписи связей не закрывают блоки на EN и RU, вход в плашку снизу, «ready now»,
число с единицей не разрываются, каждое утверждение один раз) краснеют на 12 мутантах, все убиты.

**Известные слабые места** (low): схема 976 единиц идёт в масштабе около 0,68, подписи Node-ов около 7,5 px на экране —
цена отдельной колонки «NOT NODES». Долг Ticket-а 04 (проигрыватель шагов идёт, пока схема вне видимости,
`LivingScene.tsx`) не тронут: эти строки не менялись.

**Токены:** автор ≈ 250 тыс. первый круг и ≈ 60 тыс. круг правок (оценка по объёму разговора, счётчика у агента нет).
