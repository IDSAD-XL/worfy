# 16 — Topic Projects

Type: task
Status: claimed 2026-10-31T22:27Z
Branch: worfy-guide/16
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/projects.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

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

- `src/renderer/guide/`, `docs/features/projects.md` — только чтение страниц.

## Итог

Topic `projects` (`src/renderer/guide/topics/projects/`): `Scene.tsx` (простой уровень, `viewBox` 976×500, 10 блоков,
10 связей, 4 шага проигрывателя), `Flow.tsx` (поток данных в Under the hood, 976×556, 11 блоков, 11 связей), `en.json`,
`ru.json`, `topic.json` и одна строка `registry.ts` (ключи поиска `silent mode`, `full mode`, `workflow folder`).
`topic.json` сверен с `docs/features/projects.md` на 59164fed. Блок Project на Map of worfy уже вёл в этот Topic.
На схеме блок Canvas ведёт в Topic `canvas`, Harness и Profile — в Topic `harness` (Ticket 18), пока его нет — на
страницу `harness.md`. Остальные блоки только подсвечиваются.

Решено без владельца. Цвета групп — как на Map of worfy: Profile, Harness и Orchestrator — `harness`; список Projects,
диалог Add project и раздел ADR — код окна worfy, нейтральный `machine`; репозиторий и вкладка Canvas — `project`;
Workflow folder и HANDOFF — `workflow` (документы workflow, как Ticket на Map). Раздел ADR стоит вне рамки Canvas
без подписи области: это часть боковой панели, а не Node. Ни одна схема не рисует Tickets: их чтение — Topic Workflow.
Ключи `handoff`, `adr` и `add project` не взяты: `handoff` — заголовок строки Node-а HANDOFF, `adr` ищет строки ADR.

**Утверждения и их источники.** `p.md` = `docs/features/projects.md` на 59164fed.

| Что на схеме или в тексте | Источник |
|---|---|
| Project — репозиторий или папка над несколькими репозиториями | `CONTEXT.md:9-10`, `p.md:18`, `:49` |
| Project добавляют один раз и выбирают режим; Full mode держит файлы workflow в репозитории, Silent mode — в папке вне его | `p.md:11-13`, `:17`, `:33-34` |
| Список Projects переключает Project окна; подпись «the sidebar list» | `p.md:190-192`, `:198` |
| HANDOFF и ADR — виды только для чтения; «a read-only Node» | `p.md:302`, `src/main/docs/watch.ts` (`readDoc`, нет записи), `src/main/ipc/docs.ts:40` |
| Add project: «Folder, Mode, Harness, Draft, Review» | `p.md:40` |
| Шаг 1: папка и режим, Session Claude Code готовит Profile, проверка формой, Connect — Harness пишет Profile, Project попадает в список («joins the list», «Connect», «writes») | `p.md:42-73`, `:132`, `src/main/projects/connect.ts:673`, `src/main/ipc/projects.ts:147` |
| Harness: «rules, skills, agents, hooks» (подпись Map of worfy) | `src/renderer/guide/topics/map-of-worfy/en.json` (`harnessNote`) |
| Profile: «on the Machine, with the mode»; «names it» (Profile называет Workflow folder) | `p.md:67-68`, `:125-127`, `src/main/workflow/folder.ts` (`readProjectLayout`, `workflowFolder`) |
| Шаг 2 и связь «Full: is its root»: в Full mode Workflow folder — корень репозитория | `p.md:11-12`, `:17`, `src/main/ipc/docs.ts:31` |
| Шаг 2 и связь «Silent: refuses traces»: Harness отказывает commit-у, имени ветки и тексту PR со следом workflow | `p.md:28-30`, `harness/hooks/guard.mjs:4`, `:18-20` |
| Workflow folder: «the workflow's files» | `p.md:3`, `:11` |
| Repository: «your code and its branches» | `p.md:11-12` |
| Шаг 3: щелчок переключает Canvas, Session view и Pipeline board, открывает Orchestrator этого Project-а; все окна Machine следуют («switches», «opens», «opens on a switch», Canvas «of the active Project») | `p.md:198-205`, `src/main/agent/app-orchestrators.ts:127` |
| Шаг 4: HANDOFF.md и ADR читаются из Workflow folder; HANDOFF — Node на Canvas, ADR — раздел боковой панели («HANDOFF.md», «docs/adr/», «sidebar list and panel»); правка HANDOFF.md на Node-е в пределах секунды | `p.md:302-309`, `:324`, `:331`, `src/shared/ipc/docs.ts:9`, `:11`, `test/e2e/handoff.spec.ts:65` |
| UTH: worfy спрашивает Harness, где файлы; Add project пишет только через `project-connect` | `p.md:122-123`, `:132`, `src/main/workflow/folder.ts:126`, `:142` |
| UTH: у Session черновика только Read, Glob, Grep; режим и Workflow folder worfy ставит поверх ответа | `p.md:128-131`, `src/main/projects/connect.ts:54`, `:20`, `:426` |
| UTH: у списка ревизия, опоздавший ответ не откатывает | `p.md:257-258`, `src/main/projects/store.ts:120`, `:154` |
| UTH: состояние документов несёт хеш файла, вид перечитывает текст при новом хеше | `p.md:381-382`, `src/main/docs/watch.ts:106`, `:155`, `:162` |
| Поток: ConnectProject «the Add project dialog» → ProjectConnector «runs the steps in main» по `projects.connect.*` | `p.md:151`, `:154`, `:166-171`, `src/shared/ipc/projects.ts:203-249` |
| Поток: ProjectConnector → project-connect «--facts, --check, write»; project-connect «checks the draft, writes» | `p.md:167-171`, `:160` |
| Поток: ProjectConnector → ProjectStore «add» | `p.md:166`, `:171-172`, `src/main/projects/connect.ts:673` |
| Поток: useProjects «openProject, the list's copy» ⇄ ProjectStore `projects.select` / `projects.changed`; ProjectStore «projects.json, a revision» | `p.md:270`, `:278`, `:285-287`, `src/shared/ipc/projects.ts:98`, `:139`, `src/renderer/projects/useProjects.ts:59`, `:77` |
| Поток: ProjectStore → app-orchestrators «onChange»; «opens the new Project's» | `p.md:277`, `:205`, `src/main/agent/app-orchestrators.ts:127` |
| Поток: LayoutCache «one answer per 30 s» → bin/profile «profile -C --json», «and ticket root» | `p.md:148-149`, `src/main/workflow/folder.ts:113`, `:170`, `:180` |
| Поток: LayoutCache → DocsHub «the root, by mode» | `p.md:393`, `:404`, `src/main/ipc/docs.ts:29-31` |
| Поток: Workflow folder → DocsHub «fs.watch»; DocsHub «one watch per Project» | `p.md:377`, `:391` |
| Поток: DocsHub → виды `docs.changed`, вид → DocsHub `docs.read`; «HANDOFF Node, ADR section» | `p.md:404-406`, `:398-399`, `src/shared/ipc/docs.ts:51`, `:64`, `:72` |
| Таблица файлов: назначение каждого из шести | `p.md:148-149`, `:151-152`, `:160`, `:133`, `:270-271`, `:391-394`; шапки самих файлов |
| Лимит: Connect до 30 минут из-за индекса qmd; факты и проверки — 120 секунд | `p.md:71-72`, `:172-173`, `src/main/projects/connect.ts:105`, `:113` |
| Лимит: HANDOFF.md или ADR больше 1 MiB читается как отсутствующий | `p.md:345-346`, `src/main/docs/watch.ts:23` |

**Поиск в Command palette** (разовая проверка `rankItems` над `buildCommands`, не в репозитории): ни одна строка
приложения не теряет первое место по своему заголовку и ключам; `project` по-прежнему находит первым
`Switch to project two`, `adr` — строку ADR, `handoff` — Node HANDOFF; ключи Topic-а находят «Guide: Projects».

**Снимки** (Playwright против сборки ветки, окно 1280×800, обе темы в каждой паре):
[EN](../evidence/16-projects-en-light.png) / [dark](../evidence/16-projects-en-dark.png),
[RU](../evidence/16-projects-ru-light.png) / [dark](../evidence/16-projects-ru-dark.png),
[подсветка Workflow folder](../evidence/16-projects-lit-en-light.png), [шаг 2](../evidence/16-projects-step-en-light.png),
[reduced motion, RU](../evidence/16-projects-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/16-projects-under-the-hood-en-light.png) / [RU dark](../evidence/16-projects-under-the-hood-ru-dark.png),
[таблица файлов и лимиты EN](../evidence/16-projects-under-the-hood-files-en-light.png) / [RU](../evidence/16-projects-under-the-hood-files-ru-light.png),
[подсветка ProjectStore на потоке данных](../evidence/16-projects-flow-lit-en-light.png); у каждого есть пара `-dark`.
Контраст текста: каждый видимый текст Topic-а (HTML, подписи блоков, областей и связей обеих схем, 120 текстов) против
своего фона, обе темы, EN и RU — минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 нет ни одного.

**Подписи связей** (разовая проверка Playwright вне репозитория, удалена): наведение на каждый блок обеих схем и
каждый шаг, EN и RU, — 50 состояний, 104 подсвеченные подписи; ни одна не перекрывает другую подпись, блок или
наконечник стрелки. Первый прогон нашёл одно: русская подпись «переключает» (Projects → Canvas) не помещалась между
блоком Projects и вкладкой Canvas; рамка Canvas сдвинута на 40 вправо. Снимки сняты со сборки закоммиченного head
ветки, без `.dirty`.

**Tokens.** Автор: около 230 тыс. токенов контекста (точного счётчика у агента нет; оценка по объёму прочитанного и
написанного). Проверка: считает ревьюер.
