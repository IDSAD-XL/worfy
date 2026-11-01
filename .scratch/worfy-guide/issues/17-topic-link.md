# 17 — Topic Link

Type: task
Status: claimed 2026-10-31T22:11Z
Branch: worfy-guide/17
Blocked by: 10
Source: [spec.md](../spec.md), Q5, Q6, Q17, Q18, Q19

## Что происходит

Topic сжимает `docs/features/link.md` до одного экрана. Страницы остаются источником и полной версией. Если приёмка пилота поменяла формат, Topic следует ей.

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

- `src/renderer/guide/`, `docs/features/link.md` — только чтение страниц.

## Итог

Topic `link` (`src/renderer/guide/topics/link/`): `Scene.tsx` (простой уровень, `viewBox` 976×500, 6 блоков, 5 связей,
4 шага проигрывателя), `Flow.tsx` (поток данных вызова в Under the hood, 976×440, 7 блоков, 9 связей), `en.json`,
`ru.json`, `topic.json` и одна строка `registry.ts` (ключи поиска `linked machine`, `tailscale`, `pairing code`).
`topic.json` сверен с `docs/features/link.md` на c1ea91d9 — последний commit страницы. Блок Linked machine на Map of
worfy теперь открывает этот Topic. На схеме блок Machine ведёт в Topic `the-window-and-your-data`, блок Project — в
`projects`, как на Map; пока этих Topic-ов нет — на их страницы. Остальные блоки только подсвечиваются.

Решено без владельца: на простом уровне обе Machine и всё окно worfy — группа `machine` (код окна worfy нейтральный,
как на Map), Project — `project`. На потоке данных все блоки — `machine`: это код worfy в окне и в main обеих Machine,
включая «Same handler» — обработчик IPC worfy на Linked machine. Блок Access стоит под «OTHER MACHINE»: уровень задаёт Machine, чьи это Project-ы.
На потоке данных ответ и события показаны одной связью Link service → RemoteCalls: кадры идут по соединению, которым
владеет service; источник события на M — клиент `project` IPC adapter-а.

**Утверждения и их источники.** `L` = `docs/features/link.md` на c1ea91d9.

| Что на схеме или в тексте | Источник |
|---|---|
| Machine — одна папка данных worfy («one worfy data folder») | `L:11-12`, `CONTEXT.md:209-210`, `src/main/link/service.ts:1-2` |
| Две Machine связываются кодом из 6 цифр; связь «6-digit code» Machine → Linked machine | `L:3-5`, `L:84-86`, `src/main/link/pairing.ts:1-2`, `src/renderer/machines/LinkMachineDialog.tsx:186` |
| Каждая может открывать Project-ы другой, если та разрешила | `L:4-5`, `CONTEXT.md:214` |
| Project работает на своей Machine, окно показывает и передаёт команды; связь «commands», «shown here»; шаг 4 | `L:265-267`, `CONTEXT.md:266` |
| Связь работает в локальной сети, через Tailscale — когда его включили обе стороны | `L:226-232`, `src/main/link/settings.ts:11-14`, `src/main/link/checks.ts:124-126` |
| Шаг 1: Link a machine… на обоих, выбрать другой, ввести его код; связь в обе стороны («linked both ways») | `L:84-89`, `src/renderer/machines/LinkMachineDialog.tsx:108-111` |
| Шаг 2: раздел Machines в боковой панели, состояния Online, Sleeping, Offline, Certificate changed («its state»); переподключение само | `L:37-38`, `L:133-138`, `L:154-155`, `src/renderer/shell/sidebar/MachinesSection.tsx:90-94`, `:213`, `src/main/link/connections.ts:3-5` |
| Шаг 3: решает Machine с Project-ами в Settings → Machines; «Linked machines can work with my Projects» по умолчанию выключен, пока он включён — уровень Off, Read only, Full access; новая связь — Off; «by the level» | `L:90`, `L:189-198`, `src/renderer/settings/MachinesSection.tsx:28`, `:38-40`, `src/main/link/settings.ts:3-6` |
| Описание схемы: пока у другой Machine включён этот переключатель, уровень, данный этой Machine, решает, что доходит до Project-а | `L:191-192`, `src/main/link/settings.ts:3-6`, `src/main/link/ipc-adapter.ts:15-19` |
| Шаг 4: клик по Project-у в боковой панели открывает его в окне; Session-ы, Terminal-ы, Autopilot работают там | `L:259-266`, `src/renderer/projects/useProjects.ts:131` |
| «Your window: shows one Machine's Projects»; «Project: its Sessions run here» | `L:262-263`, `L:265`, `src/renderer/ipc.ts:4-5` |
| Поток: окно читает метку канала; local и link остаются у своих обработчиков («local, link», «routes by the access mark», «this Machine's main») | `L:321-330`, `src/renderer/ipc.ts:7-10`, `:61-62` |
| Поток: project и desktop уходят как `linked.invoke` к обработчикам `linked` в main | `L:410-411`, `src/shared/ipc/linked.ts:30`, `src/main/ipc/linked.ts:251-258`, `src/renderer/ipc.ts:127` |
| «linked handlers: count windows per root» | `L:416-417`, `src/main/ipc/linked.ts:201`, `:256` |
| RemoteCalls шлёт кадр вызова по текущему соединению с M («M's current connection», «call frame») | `L:411-412`, `L:354-355`, `src/main/link/remote-calls.ts:15-18`, `:162` |
| Link service на M передаёт кадр IPC adapter-у («call»); канал — TLS 1.3 и WebSocket | `L:412`, `L:334`, `src/main/link/service.ts:856-861` |
| IPC adapter проверяет метку и уровень и запускает тот же обработчик, что окно на M («if allowed», «Same handler: as a window on M calls») | `L:412-414`, `src/main/link/ipc-adapter.ts:1-3`, `:12-19` |
| Ответ и события возвращаются кадрами («answer, event frames»), RemoteCalls разбирает их схемой этой стороны («parsed here»), до окна — ответ и `linked.event` | `L:414-416`, `src/main/link/service.ts:864-865`, `src/main/link/remote-calls.ts:8-13`, `:119-125`, `:173`, `src/main/ipc/linked.ts:30`, `src/shared/ipc/linked.ts:33` |
| UTH: вызов от Linked machine идёт в тот же обработчик IPC, с теми же схемами | `L:316-318`, `src/main/link/ipc-adapter.ts:1-3` |
| UTH: неизвестное adapter-у имя закрыто; Read only отклоняет каналы project с пометкой write | `L:331-333`, `src/main/link/ipc-adapter.ts:14-19` |
| UTH: pairing — SPAKE2 с кодом как паролем, привязан к отпечаткам обоих сертификатов, машина посередине его срывает | `L:341-343`, `src/main/link/pairing.ts:4-10` |
| Таблица файлов: назначение каждого из шести | `L:384-387`, `L:393-394`, `L:401`; шапки самих файлов |
| Лимит: код живёт 2 минуты, первая попытка его сжигает; 10 неудач подряд или за час закрывают связывание | `L:103-104`, `L:111-114`, `src/main/link/pairing.ts:12-13`, `:37`, `:164`, `:171`, `:174` |
| Лимит: сообщение до 16 MiB, вызов ждёт ответа 30 секунд | `L:369-371`, `src/main/link/messages.ts:30`, `src/main/link/connection.ts:13` |
| Лимит: без Link through Tailscale на обеих сторонах — только локальная сеть и loopback; ретранслятора нет | `L:226-232`, `src/main/link/checks.ts:1-3`, `:124` |

**Снимки** (Playwright против сборки ветки, окно 1280×800, у каждого есть пара `-dark`):
[EN](../evidence/17-link-en-light.png) / [dark](../evidence/17-link-en-dark.png),
[RU](../evidence/17-link-ru-light.png) / [dark](../evidence/17-link-ru-dark.png),
[подсветка Access](../evidence/17-link-lit-en-light.png), [шаг 4](../evidence/17-link-step-en-light.png),
[reduced motion, RU](../evidence/17-link-reduced-motion-ru-light.png),
[Under the hood EN](../evidence/17-link-under-the-hood-en-light.png) / [RU](../evidence/17-link-under-the-hood-ru-light.png),
[таблица файлов и лимиты EN](../evidence/17-link-under-the-hood-files-en-light.png) / [RU](../evidence/17-link-under-the-hood-files-ru-light.png),
подсветка на потоке данных: [RemoteCalls](../evidence/17-link-flow-lit-en-light.png),
[обработчики linked](../evidence/17-link-flow-lit-linked-en-light.png).
Контраст текста: каждый видимый текст Topic-а (HTML, подписи блоков, областей и связей обеих схем, 93 текста) против своего фона, обе темы, EN и RU — минимум 5,60:1 в светлой и 5,93:1 в тёмной, ниже 4,5:1 — 0.

**Подписи не перекрываются.** Разовая проверка Playwright вне репозитория навела указатель на каждый блок обеих схем и нажала каждый шаг, EN и RU (34 состояния): ни одна подсвеченная подпись связи не пересекает другую подпись, блок или наконечник стрелки. Снимки сняты со сборки чистого commit-а ветки.

**Объём.** Простой уровень: 57 слов EN, 50 RU. Under the hood (текст, таблица файлов, лимиты): 156 слов EN, 133 RU.
Палитра: ключи `linked machine`, `tailscale`, `pairing code` проверены разовым test-ом над `rankItems(buildCommands(…))`
с двумя Linked machine: ни для одного из 42 запросов (ключи, заголовок каждой команды и каждое его слово) строка
«Guide: Link» не встаёт выше команды; «machine» по-прежнему первой даёт Remove machine…. Test удалён до commit-а.

**Доработка после REJECTED (PR #1174, ревью medium).** Шаг 3 и описание схемы называют главный переключатель
«Linked machines can work with my Projects» (выключен по умолчанию; уровень действует, пока он включён), EN и RU.
Шаг 2 называет четвёртое состояние Certificate changed. На схеме связь «its state» выходит из Linked machine ниже
наконечника «6-digit code» (сдвиги −10 и +14). На потоке данных кадр вызова и ответ разведены сдвигами ±20, блок
«Same handler» — группа `machine`, русская подпись блока обработчиков linked — «linked handlers», как в EN (правка Orchestrator-а после второго круга). Проверка перекрытий
повторена на всех 34 состояниях, снимки сняты заново.

**Tokens.** Автор: около 180 тыс. токенов контекста (точного счётчика у агента нет; оценка по объёму прочитанного и
написанного). Проверка: ещё не было.
