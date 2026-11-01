# 18 — Topic Harness

Type: task
Status: done 2026-11-01T01:52Z
PR: #1178
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/harness.md`, `docs/features/skills-agents-and-hooks.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

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

- `src/renderer/guide/`, `docs/features/harness.md`, `docs/features/skills-agents-and-hooks.md` — только чтение страниц.

## Итог

Topic `harness` (`src/renderer/guide/topics/harness/`): `spec.ts` (обе схемы), `Scene.tsx` (простой уровень, `viewBox`
976×512, 10 блоков, 10 связей, 5 шагов проигрывателя), `Flow.tsx` (поток данных в Under the hood, 976×512, 9 блоков,
10 связей), `en.json`, `ru.json`, `topic.json` и одна строка `registry.ts` с ключами `plugin`, `skills`, `hooks`,
`profile`. `topic.json` сверен с `docs/features/harness.md` (8c6fc399) и `docs/features/skills-agents-and-hooks.md`
(3f662f1c). Блоки Map-а Harness и Profile теперь открывают этот Topic. На схеме Topic-а Orchestrator и Subagent ведут в
Topic `sessions`; остальные блоки — этот Topic и только подсвечиваются.

Решено без владельца: Profile на простом уровне лежит под подписью «HARNESS HOME» рядом с установленным plugin, а не на
Canvas и не в репозитории. Gate на схеме не нарисован: о нём говорит шаг 4, а у Gate свой Topic. Обе схемы — три
колонки на расстоянии 232: подписи связей стоят в середине кривой и не сдвигаются, и в более узкий промежуток они ложились
на блоки и стрелки. Сессии терминала отдельным блоком не нарисованы: о них говорит подпись блока
«Installed plugin». В потоке данных нет отдельного блока копии сборки: связь «the bundled copy, inline» и подпись
установщика говорят о ней, а отдельный блок давал пересечение связей. Ключи палитры проверены временным test-ом (удалён
до commit-а): ни одна команда палитры не уступает первое место строке «Guide: Harness» по своему заголовку и ключам.

**Утверждения и их источники.** `h.md` = `docs/features/harness.md` на 8c6fc399, `s.md` =
`docs/features/skills-agents-and-hooks.md` на 3f662f1c.

| Что на схеме или в тексте | Источник |
|---|---|
| Harness — plugin Claude Code `worfy`; skills, агенты и hooks, по которым агенты Claude ведут работу Project-а | `CONTEXT.md:139-141`, `h.md:12`, `:191`, `s.md:3-4` |
| Каждая сборка несёт копию и ставит её на Machine; «each build carries a copy»; связь «installs». Install, Update и Replace в toolbar сначала называют каждую команду в диалоге (простой уровень, шаг 1). Сужено в доработке: после Update или отката Stable второго диалога нет, поэтому «после диалога» сказано только про кнопки toolbar | `h.md:12-14`, `:28-32`, `:42-43`, `:55`, `:90-92`, `src/main/harness/bundled.ts:1-5`, `src/main/ipc/harness.ts:1-2` |
| Старая сборка не заменяет более новый Harness (шаг 1) | `h.md:76-85`, `src/main/harness/install.ts` (порядок версий) |
| Агент сначала запускает `profile` и работает по Profile; связь Subagent → Profile «reads it first»; шаг 3 | `h.md:216-219`, `s.md:107`, `harness/agents/implementer.md:10-11` |
| Profile никогда не лежит в репозитории, один на Project; лежит в Harness home (подпись области) | `CONTEXT.md:143-145`, `:275`, `h.md:217-218`, `:301`, `src/main/storage/paths.ts:57` |
| Подпись «HARNESS HOME»: plugin в `worfy-harness/plugin` (заметка «Plugin folder») | `h.md:13-14`, `src/main/harness/locate.ts:4-5` |
| «Installed plugin — what terminal sessions load» | `h.md:209` |
| Связь worfy → Orchestrator «copy, inline»; шаг 2: Session worfy получает копию сборки inline, если в `~/.claude` нет старого Harness | `h.md:205-208`, `src/main/agent/options.ts:45`, `:433-442`, `:500`, `src/main/agent/app-registry.ts:161` |
| Orchestrator — главная Session Project-а | `CONTEXT.md:173-175` |
| Orchestrator запускает `/worfy:epic-wave` (связь), ведёт Wave по skill epic-wave (шаг 2); «Skills — procedures: /worfy:<name>» | `s.md:11-12`, `:16`, `:50` |
| Orchestrator запускает Subagent-ов (связь «starts»); три роли implementer, reviewer, scout (заметки Subagent и Agents, шаг 3) | `s.md:3-4`, `:53-56`, `:107-113`, `:158-159`, `harness/agents/*.md:3` |
| Связь Agents → Subagent «its role» | `s.md:107`, `:166` |
| Hooks — по событиям Claude Code; «main rules at start» Orchestrator-у, «common rules» Subagent-у | `s.md:180-189`, `:202`, `harness/hooks/hooks.json:4-18`, `:51-56` |
| Шаг 4: Bash guard перед командой, Gate по завершении задачи | `s.md:190-191`, `harness/hooks/hooks.json:62-78`, `:133-139` |
| «Scripts — profile, ticket, preflight…», связь «runs scripts»; шаг 5: ticket пишет, preflight проверяет workflow | `h.md:235-243`, `s.md:34` (шаг 1 `ticket claim`) |
| qmd — поиск по документам, «searches decisions»; шаг 5: решения и уроки всех Project-ов | `h.md:201`, `:258-259`, `s.md:22`, `:137` |
| UTH, поток: пункт Harness в toolbar и в Settings → Pipeline; `harness.install`, ответ `harness.changed` каждому окну | `h.md:169-171`, `src/renderer/shell/toolbar/HarnessStatus.tsx:195-196`, `src/renderer/settings/PipelineSection.tsx:230`, `src/main/ipc/harness.ts:10-12`, `:50`, `src/shared/ipc/harness.ts:78`, `:89` |
| UTH: установщик «reads, asks, then copies»; копия через промежуточную папку и rename («staging, then rename») | `h.md:42`, `:50`, `:148-149`, `src/main/harness/install.ts:22` |
| UTH: связь «install, update» — команды `claude plugin marketplace add`, `install`, `update` бинарником Claude Code из SDK; они пишут `settings.json` и папку plugins в Claude home | `h.md:45-53`, `:148-150`, `src/main/harness/install.ts:693-704`, `src/main/ipc/harness.ts:4` |
| UTH: зависимость ставится первой, иначе plugin не загружается | `h.md:152-153` |
| UTH: locateHarness — plugin, legacy или none, при каждом вызове; находит `plugin.json` и `bin/`; старый Harness главнее, Session-ы worfy тогда без plugin, старые hooks не срабатывают дважды | `h.md:154-157`, `:208`, `src/main/harness/locate.ts:1-14`, `src/main/agent/options.ts:433-442` |
| UTH: запуск скриптов — env login shell и `HARNESS_HOME`; запускает `bin/profile` из папки скриптов, которую назвал locateHarness | `h.md:289-290`, `:304-306`, `src/main/harness/script-env.ts:1-12`, `src/main/workflow/profile.ts:69`, `:256-257` |
| UTH: опции Session — plugins и MCP-серверы, копия из сборки inline; Session — один query Claude Code | `h.md:304`, `src/main/agent/options.ts:45`, `:500`, `src/main/agent/session.ts:1-2` |
| UTH: задержать ход или команду могут только Gate и Bash guard; сломанный hook не ломает Session | `s.md:198-200`, `:253` |
| Таблица файлов: назначение каждого из семи | `h.md:167-171`, `:304-306`, `s.md:261`; шапки самих файлов |
| Лимит: ставить может только собранное приложение или запуск с `WORFY_CLAUDE_HOME` | `h.md:38-40`, `src/main/harness/install.ts:71-76` |
| Лимит: 120 s на команду, 600 s на команду с зависимостью | `h.md:57-58`, `src/main/harness/install.ts:64`, `:66` |
| Лимит: текст hook длиннее 10 000 символов Claude Code обрезает до превью; общие правила с правилами пользователя укладываются | `s.md:203-206`, `harness/hooks/inject-rules.mjs:24` |

**Снимки** (Playwright против сборки ветки, окно 1280×800, у каждого есть пара `-dark`):
[EN](../evidence/18-harness-en-light.png), [RU](../evidence/18-harness-ru-light.png),
[подсветка Hooks](../evidence/18-harness-lit-en-light.png), [шаг 3](../evidence/18-harness-step-en-light.png),
[reduced motion, RU](../evidence/18-harness-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/18-harness-under-the-hood-en-light.png) / [RU](../evidence/18-harness-under-the-hood-ru-light.png),
[таблица файлов и лимиты EN](../evidence/18-harness-under-the-hood-files-en-light.png) / [RU](../evidence/18-harness-under-the-hood-files-ru-light.png),
[подсветка Installer на потоке данных](../evidence/18-harness-flow-lit-en-light.png).
Контраст текста: каждый видимый текст Topic-а (HTML, подписи блоков, областей, шагов и связей обеих схем) против своего
фона, обе темы, EN и RU. По вычисленным цветам (124 текста на каждое из восьми сочетаний языка, темы и подсветки) —
минимум 5,60:1 в светлой и 5,93:1 в тёмной теме. По пикселям снимков (400 замеров) — минимум 4,73:1 (заметка
«plugin, legacy or none», сглаживание мелкого шрифта). Ниже 4,5:1 нет ни одного.

Подписи связей проверены Playwright по рамкам в DOM: каждый блок обеих схем под указателем и каждый шаг, EN и RU, всего
48 состояний — ни одна подсвеченная подпись не ложится на другую подпись, на блок или на подсвеченную стрелку. Снимки
сняты со сборки закоммиченного head, без `.dirty`.

**Доработка после REJECTED (PR #1178, ревью medium, линза утверждений).** Утверждение об установке сужено, в EN и RU:
«после диалога» теперь сказано только про Install, Update и Replace в toolbar (простой уровень, шаг 1, подпись связи
теперь «installs» / «ставит»), потому что после Update или отката Stable второго диалога нет (`h.md:90-92`). Ссылки на
`CONTEXT.md` в таблице выровнены по нынешнему `main` (Harness 139-141, Profile 143-145, Orchestrator 173-175, «один
Profile на Project» 275). `topic.json` записан на 8c6fc399: этот commit меняет у страницы только абзац о версии в
toolbar, ни одного утверждения Topic-а он не трогает; ссылки `h.md` ниже строки 21 сдвинуты на 3. Блок установленного
plugin в RU снова называется «Установленный plugin», а не как подпись области. Комментарии `Scene.tsx` (нет блока Gate)
и `Flow.tsx` (три колонки) исправлены. Строка `registry.ts` после rebase стоит после Browser, перед skeleton.

**Tokens.** Автор: около 230 тыс. токенов контекста (точного счётчика у агента нет; оценка по объёму прочитанного и
написанного). Проверка: оценку даёт ревьюер.
