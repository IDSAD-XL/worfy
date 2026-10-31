# 06 — Topic Autopilot

Type: task
Status: done 2026-10-31T20:23Z
PR: #1157
Blocked by: 05
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/autopilot.md` до одного экрана. Страницы остаются источником и полной версией.

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

- `src/renderer/guide/`, `docs/features/autopilot.md` — только чтение страниц.

## Итог

Topic `autopilot` в `src/renderer/guide/topics/autopilot/`: `Scene.tsx` (живая схема одного прогона, 9 блоков, 8 связей,
5 шагов), `Flow.tsx` (поток данных в Under the hood, 9 блоков, 12 связей, 4 шага, по контракту Ticket-а 07), `en.json`,
`ru.json`, `spec.ts` (обе схемы, чтобы test мог их прочесть), `topic.json` (страница `docs/features/autopilot.md`, сверена на `02be335e`; 8 главных файлов) и строка в
`registry.ts`. Блок Autopilot на Map of worfy теперь открывает этот Topic, а не Full page.

### Утверждения и подписи — источники

`AP` = `docs/features/autopilot.md`. Подписи схем, повторяющие утверждения таблицы, сверены по той же строке.

| Утверждение или подпись | Источник |
|---|---|
| Autopilot ведёт Wave-ы одного Epic-а одну за другой без человека у Orchestrator-а; отправляет, ждёт конца, следующую | `AP:3-4`, `src/main/autopilot/run.ts:1-2`, `src/shared/autopilot/cycle.ts:223` |
| Кнопка Autopilot на рамке Epic-а (подпись `epicNote`) | `src/renderer/canvas/actions/AutopilotAction.tsx:22`, `:416` |
| Останавливается: нет готовой Wave, Stop autopilot, ошибка | `src/shared/autopilot/cycle.ts:38-39`, `:205-209`, `:230-235`, `:259-261`; `AP:168-184` |
| Сам прогон не начинается | `AP:39`; единственный вызов `start` — `src/main/ipc/autopilot.ts:74` |
| Orchestrator без человека, вопросы и запросы разрешений отклоняются (подпись `orchestratorNote`, шаг 2) | `src/main/agent/session-settings.ts:46-48`, `src/main/agent/permissions.ts:98-105`, `src/main/agent/session.ts:177` |
| Экран не гаснет (только в Under the hood: подпись `keepAwake`, `powerSaveBlocker`, шаг 2 потока) | `src/main/autopilot/power.ts:2`, `:19`; `src/main/autopilot/run.ts:668-669` |
| Каждый шаг — в журнал, один файл на прогон, `<run>.jsonl`; строка JSON на шаг (`lines`) | `src/main/autopilot/journal.ts:1`; `src/main/autopilot/run.ts:1584`; `AP:194`, `AP:340` |
| Ready wave · N: Ticket-ы, которые можно брать параллельно сейчас; «готов сейчас» | `CONTEXT.md:84`, `src/shared/workflow/waves.ts:164-171` |
| Текст Run wave Project-а называет Ticket-ы Wave (шаг 2, `text`) | `src/main/actions/launch.ts:286-294`, `src/shared/actions/render-template.ts:13` |
| Orchestrator обычно запускает implementer-ов в фоне (подписи `implementers`, `startsInBackground`) | `AP:226`, `docs/adr/0029-autopilot-waits-for-background-tasks.md:5` |
| Статус Ticket-ов ставят агенты, worfy не пишет (`ticketsNote`, `workOn`) | `AP:201`, `docs/adr/0002-worfy-is-a-view-over-the-workflow.md:5` |
| Wave кончилась: ход завершён без ошибки, в фоне ничего, ни один Ticket Wave не в работе; затем следующая или остановка (шаг 4, `turnEnded`) | `src/shared/autopilot/cycle.ts:5-7`, `:214-223`, `:258-265` |
| Отказ Limits: ждёт сброса плюс 2 минуты; каждые 30 минут без времени сброса; дольше 24 часов — `limits-timeout` (шаг 5, лимиты) | `src/shared/autopilot/resume-at.ts:14`, `:20`, `:27`, `:82-87` |
| Limits: 5 часов и 7 дней | `CONTEXT.md:37-38` |
| Поток: кнопка → `autopilot.start` по IPC; `autopilot.changed` во все окна | `src/shared/ipc/autopilot.ts:113`, `:152`; `src/main/autopilot/run.ts:1616-1620`; `AP:319`, `AP:333` |
| Проверки старта по порядку: прогон в Project-е, отказ на собственном репозитории и шаблон, workflow и Epic, ключ origin и Linked machine | `src/main/autopilot/run.ts:629-643`; `AP:319-320` |
| `setUnattended` перезапускает Orchestrator, продолжая SDK session; журнал, keep-awake, workflow watch | `src/main/autopilot/run.ts:4-5`, `:656-671` |
| Workflow watch: только поля Ticket-ов | `src/main/ipc/autopilot.ts:107`, `:113` |
| Цикл чистый: состояние + событие → следующее состояние и эффекты; фазы starting…stopped | `src/shared/autopilot/cycle.ts:1-3`, `:79` |
| Одна очередь на прогон, события по порядку | `src/main/autopilot/run.ts:518-522`; `AP:219` |
| send-wave → launcher (`autopilotWave`), одно чтение workflow | `src/main/autopilot/run.ts:1040`, `:1077`; `src/main/actions/launch.ts:287-288` |
| События Session: prompt, result, state, background_tasks | `src/main/autopilot/run.ts:829`, `:835`, `:869`, `:877`; `AP:328` |
| Каждая Wave после первой обычно идёт в новую SDK session (не идёт, когда Orchestrator занят, после `tasks-timeout` и со старым Harness) | `src/main/autopilot/run.ts:7-14`, `:1062-1063` |
| Force stop — в меню ⋯ рядом с кнопкой (строка таблицы файлов) | `src/renderer/canvas/actions/AutopilotAction.tsx:33` |
| Таблица файлов: назначение каждого из 8 | `AP:289-314` (строки этих файлов) |
| Один прогон на Project; тот же Epic того же репозитория на Linked machine отклоняет старт; Start anyway — единственный обход | `src/main/autopilot/run.ts:629`, `:335`, `:338`, `:642-643`; `AutopilotAction.tsx:60-62` |
| Dev-сборка отказывает на собственном репозитории worfy, включая worktree | `src/main/autopilot/run.ts:359-360`, `:376-388` |
| Ticket в работе после хода — до 10 минут, затем `wave-unfinished`; background task-и без событий час — `background-stalled` | `src/shared/autopilot/cycle.ts:58`, `:65`, `:9-13` |
| Ожидание Limits по таймеру настенных часов; текст продолжения | `src/main/autopilot/limits-wait.ts:17`, `:25`, `:33` |

### Снимки

Playwright, окно 1280×800, через временный spec вне PR:
- EN [светлая](../evidence/06-autopilot-en-light.png), [тёмная](../evidence/06-autopilot-en-dark.png);
  RU [светлая](../evidence/06-autopilot-ru-light.png), [тёмная](../evidence/06-autopilot-ru-dark.png);
- блок Autopilot под указателем: [светлая](../evidence/06-autopilot-lit-en-light.png), [тёмная](../evidence/06-autopilot-lit-en-dark.png);
- шаг 4: [светлая](../evidence/06-autopilot-step-en-light.png), [тёмная](../evidence/06-autopilot-step-en-dark.png);
- reduced motion, RU: [светлая](../evidence/06-autopilot-reduced-motion-ru-light.png), [тёмная](../evidence/06-autopilot-reduced-motion-ru-dark.png);
- Under the hood развёрнут, поток данных: EN [светлая](../evidence/06-autopilot-under-the-hood-en-light.png),
  [тёмная](../evidence/06-autopilot-under-the-hood-en-dark.png), RU [светлая](../evidence/06-autopilot-under-the-hood-ru-light.png),
  [тёмная](../evidence/06-autopilot-under-the-hood-ru-dark.png); файлы и лимиты: EN [светлая](../evidence/06-autopilot-under-the-hood-files-en-light.png),
  [тёмная](../evidence/06-autopilot-under-the-hood-files-en-dark.png), RU [светлая](../evidence/06-autopilot-under-the-hood-files-ru-light.png),
  [тёмная](../evidence/06-autopilot-under-the-hood-files-ru-dark.png).

Контраст текста: 316 текстов Topic-а (заголовок, абзацы, таблица, лимиты, подписи обеих схем, подписи связей у
подсвеченных блоков, подпись шага), обе темы, оба языка, по пикселям снимка: минимум 4.67:1 (`<run>.jsonl`, светлая
тема), ниже 4.5:1 — ни одного.

### Tokens

Автор: около 300 тысяч токенов за первый раунд и около 60 тысяч за раунд правок (оценка по объёму контекста; точного
счётчика у агента нет). Проверка: около 130 тысяч (оценка ревьюера).

### Раунд правок

- Цвета групп на схеме потока: Orchestrator — `harness`, как на простой схеме и в `scene-colours.ts`; Launcher — `workflow`,
  как Run и Cycle (это код worfy). Обе схемы вынесены в `spec.ts`; `test/unit/guide-autopilot.test.tsx` требует одну группу
  для блока с одним названием на обеих схемах. Мутанты (Orchestrator → `agents`, Launcher → `harness`) делают его красным.
- «обычно» для новой SDK session; «строка JSON на шаг» в подписи и описании потока.
- Сокращено: «экран не гаснет» на простом уровне; в Under the hood — абзац о взгляде на workflow, абзац о Stop и Force stop,
  лимиты о бюджете и о выходе из приложения; короче строки `run.ts` и `journal.ts`. То же в RU.
