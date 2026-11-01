# 11 — Topic Workflow

Type: task
Status: claimed 2026-10-31T22:07Z
Branch: worfy-guide/11
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/workflow.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

## Что делаем

1. Простой уровень: живая схема и короткий текст, понятный без знания кода. Объём судит автор по этому Feature: текст должен читаться быстро, но его не режут под число слов (Q5).
2. Under the hood, свёрнут: техническая схема потока данных, короткий текст, таблица главных файлов и важные лимиты.
3. Английский и русский в одном PR; технические термины и названия UI по-английски.
4. Страницы-источники и их SHA в реестре Topic-ов.

## Готово, когда

- [ ] Каждое утверждение и подпись на схемах сверены с кодом вторым агентом.
- [ ] Снимки: обе темы, оба языка, reduced motion, развёрнутый Under the hood, в `.scratch/worfy-guide/evidence/`.
- [ ] Topic читается быстро: второй агент называет места, которые можно убрать.
- [ ] Tokens автора и проверки в `## Итог`.

## Тесты

Новых нет: test-ы реестра из Ticket-а 03 покрывают Topic.

## Где в коде

- `src/renderer/guide/`, `docs/features/workflow.md` — только чтение страниц.

## Итог

Topic `workflow` (`src/renderer/guide/topics/workflow/`): `spec.ts` с двумя схемами, `Scene.tsx` (простой уровень,
`viewBox` 976×508, 10 блоков, 11 связей, 5 шагов проигрывателя), `Flow.tsx` (поток данных в Under the hood, 976×452,
9 блоков, 13 связей), `en.json`, `ru.json`, `topic.json` и одна строка `registry.ts` (ключи поиска `pipeline`, `binding`,
`epics and tickets`). `topic.json` сверен с `docs/features/workflow.md` на 74d5ad8d. Блоки Epic, Ticket и Ready wave
на Map of worfy и на схеме Autopilot теперь открывают этот Topic. На схеме Topic-а Canvas и Orchestrator, Session ведут
в Topic-и `canvas` и `sessions`, GitHub — в `gate-and-github` (пока его нет — на страницу); Epic, Ticket-ы, Wave, файлы
Ticket-ов и Pipeline только подсвечиваются: это сам Topic.

Решено без владельца: Topic показывает три Feature-а страницы — Ticket и Epic на Canvas, Pipeline и Binding — на одной
схеме. Плашка Ready wave стоит на кромке рамки Epic-а, как на Map of worfy и схеме Autopilot; в приложении она — подпись
колонки Level 1 внутри рамки. Ticket 01 нарисован карточкой в раскрытой стопке Done (подпись «done: Done stack
opened»): по умолчанию стопка Done свёрнута, и тогда у сделанного Ticket-а нет карточки и стрелки к нему нет
(`w.md:44`, `:50`, `src/renderer/canvas/edges/blocking.ts:5-6`). Стрелка от сделанного блокера в приложении видна, только
когда подсвечена (`w.md:48-49`); на схеме Guide все связи так и ведут себя: пока ничего не выбрано, они бледные. Цвета: свой код окна
worfy (общая копия, WorkflowHub) — нейтральный `machine`; Epic, Ticket-ы, Wave, Pipeline и то, что их рисует, —
`workflow`; файлы Ticket-ов, git и GitHub — `project`; Orchestrator и epic-status — `harness`. Подписи рядом с вкладками
Canvas и Epic убраны: при снимке в масштабе 1 их тонкий текст 11 px давал по пикселям 3,8–4,1:1.

**Утверждения и их источники.** `w.md` = `docs/features/workflow.md` на 74d5ad8d.

| Что на схеме или в тексте | Источник |
|---|---|
| Работа Project-а — в файлах Ticket-ов, собранных в Epic-и; блок «Ticket files», «the source of truth» | `w.md:3`, `:95`, `CONTEXT.md` (Epic, Ticket), `src/main/workflow/reader.ts:1-3` |
| worfy читает их и рисует Epic рамкой, Ticket — карточкой в ней; «worfy reads them» | `w.md:11`, `src/renderer/canvas/sources/epics.ts:1-4` |
| Стрелки от блокеров; связь «blocks» Ticket 01 → Ticket 02 | `w.md:48-50`, `src/renderer/canvas/edges/blocking.ts:1-3` |
| Статус worfy не пишет никогда, его ставят агенты; связь «ticket claim» Session → файлы Ticket-ов; шаг 3 «The agent marks its Ticket claimed itself» | `w.md:81`, `:95`, `src/main/actions/launch.ts:12`, ADR-0002 |
| Pipeline показывает Stage каждого Ticket-а («a Stage for each Ticket») | `w.md:4`, `:167` |
| Binding связывает агента с его Ticket-ом или Epic-ом | `w.md:4-5`, `:326`, `src/shared/binding/resolve.ts:1-2` |
| Ticket 01 «done: Done stack opened» (карточка есть только в раскрытой стопке Done); шаг 1: сделанные сложены в колонку Done, остальные — по уровням зависимостей | `w.md:42-45`, `:50`, `src/renderer/canvas/epic-layout.ts:6-8`, `:219`, `src/renderer/canvas/edges/blocking.ts:5-6` |
| Ticket 02 «open, its blocker done»; «ready now» в плашку «Ready wave · N»; «Tickets to take now, computed and stored nowhere» | `w.md:57-66`, `src/shared/workflow/waves.ts:4-5`, `:165-170`, `src/renderer/canvas/nodes/EpicFrameNode.tsx:140` |
| Шаг 2: открытые Ticket-ы, все блокеры сделаны, файлы не держит другой Ticket — готовая Wave | `w.md:57-63`, `src/shared/workflow/waves.ts:165-169` |
| «Run wave» с рамки Orchestrator-у; шаг 3: Run wave отправляет Wave Orchestrator-у | `w.md:68-70`, `:76`, `src/shared/projects/action-templates.ts:47`, `src/main/actions/launch.ts:1-12` |
| «Ship ticket» Ticket → Session, «started by Ship ticket»; шаг 3: Ship ticket запускает Session на один Ticket | `w.md:75`, `src/main/actions/launch.ts:10` |
| Orchestrator — главная Session Project-а | `CONTEXT.md` (Orchestrator) |
| Binding Orchestrator → Epic и Session → Ticket; шаг 5: по запуску, ticket claim, ветке или броску Node-а; пунктирная линия | `w.md:333-341`, `:345`, `src/shared/binding/resolve.ts:4-12`, `src/renderer/canvas/edges/bindings.ts:1` |
| Pipeline: «status» из файлов, «PR, checks, marks» из GitHub; «stepper on the card»; шаг 4: доска Pipeline колонками | `w.md:172-178`, `:264`, `src/main/workflow/stages.ts:1-16`, `src/renderer/pipeline/Stepper.tsx:1-3`, `src/renderer/pipeline/PipelineBoard.tsx:1-3` |
| GitHub «PRs, CI checks, marks» (метки — commit statuses головы PR; в Silent mode и `local-green` без `origin` — файл, на схеме не показан) | `w.md:268-270`, `src/main/workflow/stages.ts:4-8` |
| UTH-схема: общая копия «one model per Project», `workflow.open` в WorkflowHub, `workflow.changed` обратно, копия → Node-ы; «Frames and cards», «computed, not saved» | `w.md:111`, `:147-150`, `src/renderer/workflow/useWorkflow.ts:1-5`, `src/shared/ipc/workflow.ts:15`, `:21`, `src/renderer/canvas/sources/epics.ts:1-9` |
| UTH-схема: WorkflowHub «one watcher per Project», «file events» из файлов Ticket-ов, «moved branches» из git, «runs» epic-status, «--json model» обратно; epic-status «reads» файлы: папки Epic-ов, spec.md, issues/ | `w.md:105-108`, `:147-149`, `src/main/workflow/watch.ts:5-11`, `:804-808`, `src/main/workflow/reader.ts:3`, `:9-10` |
| UTH-схема: StageHub «changed fields» из hub, «facts, then stageOf», «branch heads» из git, «PRs, checks, marks» из GitHub («read with gh»), `pipeline.get` и `pipeline.changed` с доской и stepper-ом | `w.md:307-311`, `src/main/workflow/stages.ts:1-16`, `:204`, `:302`, `src/shared/ipc/pipeline.ts:50`, `:56` |
| UTH: worfy не пишет workflow; единственный читатель формата Ticket-а — epic-status | `w.md:95-97`, `src/main/workflow/reader.ts:1-3`, `:14` |
| UTH: в Full mode статус ветки worktree поверх checkout-а, взятый Ticket виден сразу, ветка не отменяет blocked или done | `w.md:31-33`, `:109`, `src/main/workflow/reader.ts:9-12` |
| UTH: рамки, карточки, Stage-и и автоматические Binding-и вычисляются и не хранятся; хранятся только сдвиг и свёрнутость рамки, ручные Binding-и и Binding-и запуска, в папке данных | `w.md:111`, `:261`, `:371-374`, `src/renderer/canvas/sources/epics.ts:4-9`, `src/main/layout/bindings.ts:2`, `src/main/workflow/stages.ts:2` |
| Таблица файлов: назначение каждого из шести | `w.md:131-135`, `:294-295`, `:401`; шапки самих файлов |
| Лимит: событие файла — один epic-status после 300 мс тишины, самое позднее через 1 с | `w.md:105-106`, `src/main/workflow/watch.ts:5`, `:81-85` |
| Лимит: Stage-и при изменении полей и раз в 60 с; gh раз в 60 с, удвоение до 32 минут | `w.md:273-275`, `src/main/workflow/stages.ts:301-306`, `src/main/github/prs.ts:9`, `:35`, `:37` |
| Лимит: stuck по умолчанию — 2 часа на Implementing, CI, Agent review, Gate & merge; 24 часа на Human review или Awaiting merge, или пока `Waits:` — owner или team | `w.md:215-221`, `src/shared/workflow/pipeline.ts:314-324`, `:326-332` |

**Снимки** (Playwright против сборки ветки, окно 1280×800, у каждого есть пара `-dark`):
[EN](../evidence/11-workflow-en-light.png) / [dark](../evidence/11-workflow-en-dark.png),
[RU](../evidence/11-workflow-ru-light.png) / [dark](../evidence/11-workflow-ru-dark.png),
[подсветка Ticket 02](../evidence/11-workflow-lit-en-light.png), [шаг 3](../evidence/11-workflow-step-en-light.png),
[подсветка Epic, RU: Run wave и Binding](../evidence/11-workflow-lit-epic-ru-light.png), [шаг 2, RU: «блокирует»](../evidence/11-workflow-step-2-ru-light.png),
[reduced motion, RU](../evidence/11-workflow-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/11-workflow-under-the-hood-en-light.png) / [RU](../evidence/11-workflow-under-the-hood-ru-light.png),
[таблица файлов и лимиты EN](../evidence/11-workflow-under-the-hood-files-en-light.png) / [RU](../evidence/11-workflow-under-the-hood-files-ru-light.png).
Контраст текста измерен двумя способами, обе темы, EN и RU. По вычисленным цветам (способ Topic-а Sessions) — 122 текста
на каждую пару «язык, тема», с подсветкой и без: минимум 5,60:1 в светлой и 5,93:1 в тёмной. По пикселям снимка (способ
Topic-а Autopilot, с подписями связей обеих схем и подписью шага) — 336 текстов, минимум 4,60:1. Ниже 4,5:1 нет ни одного.

**Поиск в Command palette.** Временный test (удалён до commit-а) прогнал `rankItems` над `buildCommands` по названию,
каждому слову названия и каждому ключу всех команд, плюс `pipeline`, `board`, `epic`, `ticket`, `wave`, `run wave`,
`ship ticket`: строка `guide:workflow` не стала первой ни для одного из них. Первой она стоит только для своих слов:
`workflow`, `pipeline`, `binding`, `epics and tickets`. Команды «Pipeline» в Command palette нет (вид переключается в
toolbar), поэтому ключ `pipeline` ни у какой команды первого места не отнимает.

**Tokens.** Автор: около 230 тыс. токенов контекста (точного счётчика у агента нет; оценка по объёму прочитанного и
написанного) за первый раунд и около 60 тыс. за доработку. Проверка: оценку называет ревьюер.

**Доработка после REJECTED (PR #1165, ревью medium).** Подписи связей при подсветке больше не наезжают друг на друга и
на блоки: «Binding» Orchestrator → Epic отведена вправо от «Run wave» (концы на Orchestrator-е +50, на вкладке Epic
+24), «Ship ticket» и «Binding» под Ticket 02 разведены до ±40, Ticket 01 сдвинут влево на 40, чтобы «блокирует» умещалась
между карточками. Проверено throwaway Playwright-проверкой вне репозитория (удалена): наведение на каждый блок обеих схем
и каждый шаг проигрывателя, EN и RU, рамки подписей по DOM против рамок подписей и блоков: 120 подсвеченных подписей,
наложений 0. Та же проверка по геометрии `spec.ts` (ширина подписи по числу знаков) на прежней раскладке находила все три
наложения ревью. Ticket 01 подписан как карточка
раскрытой стопки Done. Лимит 24 часов сужен до Human review, Awaiting merge и `Waits:` owner или team.
