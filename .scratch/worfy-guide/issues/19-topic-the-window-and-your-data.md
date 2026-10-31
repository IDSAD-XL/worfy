# 19 — Topic The window and your data

Type: task
Status: claimed 2026-10-31T22:11Z
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/app-shell.md`, `docs/features/notifications.md`, `docs/features/storage-and-diagnostics.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

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

- `src/renderer/guide/`, `docs/features/app-shell.md`, `docs/features/notifications.md`, `docs/features/storage-and-diagnostics.md` — только чтение страниц.

## Итог

Topic `the-window-and-your-data` (`src/renderer/guide/topics/the-window-and-your-data/`): `Scene.tsx` (простой уровень,
`viewBox` 976×496, 12 блоков, 10 связей, 5 шагов проигрывателя), `Flow.tsx` (поток данных в Under the hood, 976×476,
10 блоков, 10 связей), `en.json`, `ru.json`, `topic.json` и одна строка `registry.ts` (ключи `data folder`,
`notifications`, `diagnostics`, `theme`). `topic.json` сверен с `docs/features/app-shell.md` (058d618b),
`docs/features/notifications.md` (41f4e01b) и `docs/features/storage-and-diagnostics.md` (fc627df0). Блок Machine на
Map of worfy теперь открывает этот Topic. Блоки Canvas и Session ведут в свои Topic-и, Ticket и «Workflow files» — в
Topic `workflow` (Ticket 11), пока его нет — на страницу `workflow.md`.

Решено без владельца: схема простого уровня — три области слева направо. «READ WHERE THEY LIE» — файлы workflow и
Claude home, «THE WINDOW» — Command palette, меню, Settings, toast и Canvas с Ticket-ом и Session, «ON THIS MACHINE» —
папка данных, диагностика и системное уведомление. Все части окна worfy — нейтральная группа `machine`, как требует
урок пилота. Вкладка Canvas стоит у правого края рамки, чтобы её связи к папке данных и к toast не шли вдоль кромки
рамки; подписи у вкладки нет. Поток данных показывает три пути: настройку, уведомление и счётчик памяти. Toast-ы
живут только в renderer, у них нет потока между процессами, поэтому в Flow их нет. Из трёх страниц в Topic не вошли
Shortcuts (кроме ⌘K и Settings… ⌘,), Theme (одна фраза), hang-sample, uncaught exception и Linked machine: Topic
читается за минуту, полные страницы — по Full page.

**Утверждения и их источники.** `a.md` = `docs/features/app-shell.md` на 058d618b, `n.md` =
`docs/features/notifications.md` на 41f4e01b, `s.md` = `docs/features/storage-and-diagnostics.md` на fc627df0.

| Что на схеме или в тексте | Источник |
|---|---|
| Простой уровень: вокруг Canvas — окно worfy: Command palette (⌘K), меню, Settings | `a.md:3-4`, `:11-12`, `:200-209`, `:264`, `src/shared/shortcuts.ts:72` |
| …и уведомления, когда Session или Ticket ждут вас | `n.md:11-17`, `src/main/notify.ts:4-12`, `src/main/workflow/waits-notify.ts:6-8` |
| Окно светлое или тёмное, как система | `a.md:443-444`, `src/renderer/theme/tokens.css:4`, `:102` |
| Своё состояние worfy хранит в папке данных на этой Machine; блок «Data folder: worfy's own state» | `s.md:3`, `:12-13`, `:60`, `src/main/storage/paths.ts:28`, `:35-38` |
| Ticket-ы, ADR и транскрипты читает там, где они лежат; область «READ WHERE THEY LIE»; связь «read, not copied»; шаг 3 | `s.md:14`, `:67-68`, `src/main/workflow/reader.ts:1-9` |
| «Workflow files: Tickets, HANDOFF, ADRs»; связь в Ticket, Ticket «read from its file» | `s.md:14`, `src/main/workflow/reader.ts:1-9`, `n.md:97` |
| «Claude home: ~/.claude, the transcripts»; связь «transcripts read» в Session | `s.md:14`, `src/main/storage/paths.ts:50`, `a.md:60-62` |
| Session — «one Claude Code conversation» | `CONTEXT.md:157-159` |
| Command palette «⌘K: find and run»; шаг 1: находит команды и вещи Project-а и выполняет их | `a.md:11-15`, `src/shared/shortcuts.ts:72` |
| Связь palette → Settings (без подписи: обе строки — «Settings…», это говорит подпись связи меню) | `a.md:25`, `:264-265`, `src/renderer/palette/commands.ts:338` |
| Меню «Settings…, Help ▸ worfy Guide»; связь «Settings… (⌘,)» | `a.md:204-211`, `:124`, `src/main/menu.ts:2-4`, `:30` |
| Settings «worfy's own, on this Machine»; шаг 1 | `a.md:264`, `:333` |
| Связь Settings → папка данных «app-settings.json» | `a.md:336`, `src/main/settings/store.ts:1-3`, `:48` |
| Связь Canvas → папка данных «Layout, Cards, trash»; шаг 2: список Project-ов, Settings, Layout, Card-ы и корзина каждого Project-а; ничего не попадает в репозиторий | `s.md:12-14`, `:142`, `:160-174`, `src/main/projects/store.ts:131`, `src/main/layout/store.ts:74`, `src/main/layout/trash.ts:48` |
| Toast «a short message in the window»; шаг 4: внутри окна короткие сообщения — toast-ы | `n.md:3-4`, `src/renderer/toast/toasts.ts:1` |
| Связь Canvas → Toast «Archived N · Undo» (автоархив Canvas) | `n.md:55`, `a.md:277`, `src/renderer/canvas/archive-toast.ts:1-3`, `:30` |
| Системное уведомление «when worfy is not in front»; шаг 4: пока ни одно окно worfy не в фокусе | `n.md:3-4`, `:26-27`, `src/main/notify.ts:4-5` |
| Связь Session → уведомление «finished or needs you»; шаг 4: Session закончила ход или ждёт ответа | `n.md:13-16`, `src/main/notify.ts:7-12` |
| Связь Ticket → уведомление «waits for you» | `n.md:17`, `:30-31`, `src/main/workflow/waits-notify.ts:1-8` |
| Область «OUTSIDE THE WINDOW» («ВНЕ ОКНА»): папка данных, диагностика (окно неудачного запуска — отдельное окно с ошибкой), системное уведомление — баннер операционной системы. Claude home тоже вне окна, но стоит под своей подписью «READ WHERE THEY LIE» | `s.md:12`, `:193`, `:205`, `n.md:3-4` |
| «Diagnostics: a failed start, ended processes»; шаг 5: окно и stderr называют упавший шаг и что попробовать | `s.md:3-5`, `:191-196`, `:205-206`, `:215`, `src/main/startup-failure.ts:27`, `:37-53` |
| Связь диагностика → папка данных «logs/: ended processes»; шаг 5: только завершившийся процесс renderer или вспомогательный процесс оставляет строку в logs/ | `s.md:155`, `:194`, `:233-234`, `src/main/diagnostics/process-gone.ts:4`, `:36-38` |
| UTH Flow: окно Settings «one file per section» | `a.md:368-369` |
| UTH Flow: `appSettings.set` из окна Settings в хранилище | `src/renderer/settings/useAppSettings.ts:56-60`, `src/renderer/settings/GeneralSection.tsx:38`, `src/shared/ipc/app-settings.ts:15` |
| UTH Flow: хранилище «writes only a real change» | `a.md:346`, `src/main/settings/store.ts:266` |
| UTH Flow: «temp file, then rename» в папку данных | `s.md:77-78`, `src/main/storage/json-file.ts:6-7`, `:87-91` |
| UTH Flow: `appSettings.changed` копии в каждом окне; копия «keeps the newest revision»; «newest state» окну | `a.md:346-348`, `src/main/ipc/app-settings.ts:2-3`, `:11`, `src/renderer/settings/useAppSettings.ts:3`, `:21-25`, `src/renderer/settings/GeneralSection.tsx:25` |
| UTH Flow: SessionRegistry «the Sessions worfy runs» → Notifier «result, permission, question» | `src/main/notify.ts:7-9`, `:794` |
| UTH Flow: Notifier «decides; NoteDisplay shows» | `src/main/notify.ts:27-29`, `:231`, `:266` |
| UTH Flow: показ системного уведомления «macOS or Windows», клик назад в Notifier | `src/main/notify.ts:1`, `:716-723` |
| UTH Flow: `notify.open` в NotificationTarget, «opens what a click names» | `n.md:100-101`, `:125`, `src/main/notify.ts:15-17`, `:707`, `src/renderer/canvas/overlays/NotificationTarget.tsx:24`, `:52-57` |
| UTH Flow: счётчик памяти «in the toolbar»; `memory.open`, `memory.changed` | `s.md:282`, `:336-337`, `src/renderer/memory/useAppMemory.ts:2`, `:18`, `:26` |
| UTH Flow: MemorySampler «every 5 s, while shown» | `s.md:291`, `:320-321`, `src/main/diagnostics/memory.ts:13`, `:72` |
| UTH Flow: папка данных «app-settings.json and more» | `s.md:140-155` |
| UTH текст 1: worfy у собранного приложения, worfy-dev у сборки для разработки, обе работают одновременно; WORFY_DATA_DIR переопределяет; второй запуск над занятой папкой завершается | `s.md:16-21`, `:25`, `src/main/storage/paths.ts:28`, `:36-38`, `src/main/index.ts:124-128` |
| UTH текст 2: большинство нечитаемых JSON-файлов состояния откладываются как `<name>.unreadable-<time>`, не перезаписываются, часть стартует пустой. «Большинство», потому что положение окна, отметка First run и Limits status line не откладываются | `s.md:43-45`, `:48-49`, `src/main/storage/json-file.ts:8` |
| Таблица файлов: назначение каждого из восьми | `s.md:112-113`, `:116`, `:329`, `a.md:103`, `:187`, `:359-360`, `n.md:117`, `:126`; шапки самих файлов (`src/shared/shortcuts.ts:1-4`, `src/renderer/toast/toasts.ts:1-3`) |
| Лимит: нет уведомлений Session или Ticket-а, пока окно worfy в фокусе; от одной Session — не больше одного за 10 секунд | `n.md:26-29`, `src/main/notify.ts:85` |
| Лимит: не больше 3 toast-ов; info и success скрываются через 4 секунды | `n.md:48`, `:52`, `src/renderer/toast/toasts.ts:8`, `:21`, `:24` |
| Лимит: записи старше 3 дней удаляются из корзины каждого Project-а при запуске | `s.md:40-41`, `src/shared/ipc/trash.ts:13`, `src/main/ipc/trash.ts:38-45` |

**Снимки** (Playwright против сборки commit-а 2d2dc69b без незакоммиченных правок, окно 1280×800, у каждого есть пара `-dark`):
[EN](../evidence/19-the-window-and-your-data-en-light.png) / [dark](../evidence/19-the-window-and-your-data-en-dark.png),
[RU](../evidence/19-the-window-and-your-data-ru-light.png) / [dark](../evidence/19-the-window-and-your-data-ru-dark.png),
[подсветка Data folder](../evidence/19-the-window-and-your-data-lit-en-light.png), [шаг 2](../evidence/19-the-window-and-your-data-step-en-light.png),
[reduced motion, RU](../evidence/19-the-window-and-your-data-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/19-the-window-and-your-data-under-the-hood-en-light.png) / [RU dark](../evidence/19-the-window-and-your-data-under-the-hood-ru-dark.png),
[таблица файлов и лимиты EN](../evidence/19-the-window-and-your-data-under-the-hood-files-en-light.png) / [RU](../evidence/19-the-window-and-your-data-under-the-hood-files-ru-light.png),
[подсветка Notifier на потоке данных](../evidence/19-the-window-and-your-data-flow-lit-en-light.png).
Контраст текста: каждый видимый текст Topic-а (HTML, подписи блоков, областей и связей обеих схем, 129 текстов) против
своего фона, обе темы, EN и RU — минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 нет ни одного.
Перекрытия: одноразовый Playwright-check (вне репозитория, удалён) навёл указатель на каждый блок Scene и Flow и нажал каждый шаг, EN и RU — 54 состояния. Ни одна подсвеченная подпись связи не перекрывает другую подпись, блок, подпись вкладки или наконечник стрелки. Первый прогон нашёл перекрытия в трёх узких промежутках (связи из левой колонки, palette → Settings, Canvas → Toast); раскладка раздвинута, у palette → Settings подпись снята.
Объём: простой уровень 53 слова EN / 44 RU, Under the hood (текст, таблица файлов, лимиты) 153 EN / 126 RU.

**Tokens.** Автор: около 230 тыс. токенов контекста (точного счётчика у агента нет; оценка по объёму прочитанного и написанного: три страницы-источника, пилот 08 как образец, сверка кода, снимки). Доработка: около 40 тыс. Проверка — оценку даёт ревьюер.

**Доработка после REJECTED (PR #1181, ревью medium).** Три замечания линзы утверждений, EN и RU. (1) medium: фраза об
откладывании нечитаемых файлов сужена до «Most JSON state files…» / «Большинство JSON-файлов состояния…»: положение
окна, отметка First run и файл Limits status line не откладываются (`s.md:48-49`). (2) low: подпись связи Diagnostics →
Data folder теперь «logs/: ended processes», шаг 5 и описание схемы говорят, что неудачный запуск пишет в окно и stderr,
а в logs/ пишет только завершившийся процесс renderer или вспомогательный процесс (`s.md:191-194`, `:233`). (3) low:
область справа переименована из «ON THIS MACHINE» в «OUTSIDE THE WINDOW» («ВНЕ ОКНА»): Claude home тоже лежит на этой
Machine (`src/main/storage/paths.ts:50`), и старая подпись выглядела так, будто его там нет. Проверка перекрытий
повторена на новой подписи, EN и RU; снимки пересняты со сборки нового закоммиченного head.
