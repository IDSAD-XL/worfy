# 23 — Действия «Ship ticket», «Run wave» и «Open PR» на Холсте

Type: task
Status: done — 2026-10-05, [PR #30](https://github.com/IDSAD-XL/worfy/pull/30)
Blocked by: 04, 16, 17, 18, 19
Source: [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md), «меняет состояние только теми же инструментами»; [BRIEF.md](../../../docs/design/BRIEF.md), действия; [CONTEXT.md](../../../CONTEXT.md), «Волна», «Привязка»; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md), Привязки и настройки worfy; [spec.md](../spec.md), риск 12 (шаблоны действий на проект)

## Что делаем

worfy запускает работу теми же skills, что и терминал, и не пишет статус Тикета сам. Что именно
отправить, worfy не знает: текст сообщения берётся из шаблона действия в настройках Проекта
(хранение и окно «Project settings» — тикет 04), worfy только подставляет значения.

- **Подстановка** (`src/shared/actions/render-template.ts`, чистая функция): `{epic}` — имя папки
  Эпика, `{NN}` — номер Тикета с ведущим нулём, `{wave}` — номер готовой Волны (тикет 10),
  `{slug}` — slug из имени файла Тикета, `{branch}` — текущая ветка корня Проекта (тикет 04).
  Подстановка, у которой нет значения для этого действия (например `{NN}` в «Run wave»), — ошибка
  рендера, а не пустая строка.
- **«Ship ticket»** на Тикете (слот действий, `TicketActions.tsx`): активна, если Тикет открыт,
  все блокеры `done` и шаблон Проекта задан и рендерится; иначе неактивна с причиной
  («blocked by 09», «Set the Ship ticket template in Project settings»). Нажатие создаёт новую
  Сессию в корне Проекта (как «New session» из 18) и отправляет в неё отрендеренный шаблон (по
  умолчанию `/ship-ticket {epic} {NN}`). Сессия сразу привязана к Тикету: Привязка с источником
  `launch` записывается в `<папка Проекта>/bindings.json` через `src/main/layout/bindings.ts`
  (тикет 16), а `resolve.ts` получает сигнал `launch` — по силе сразу после ручной.
- **«Run wave»** на рамке Эпика (`EpicActions.tsx`), если готовая Волна не пуста и шаблон задан:
  отправляет отрендеренный шаблон (по умолчанию `/epic-wave волна {wave} эпика {epic}`)
  Оркестратору Проекта; если он занят — в его очередь (тикет 19). Без шаблона — неактивна с той
  же подсказкой про «Project settings». Оркестратор получает Привязку к Эпику с источником `launch`.
- **«Open PR»** (`OpenPr.tsx`) на Тикете с PR (данные из 17): открывает URL PR в браузере
  через `shell.openExternal` (тикет 11); открываются только `https://github.com/...`.
- `src/main/actions/launch.ts` — чтение шаблона Проекта, рендер и запуск; режим разрешений новой Сессии — по
  умолчанию (`bypassPermissions`).
- Статус Тикета меняют только агент и скрипт `ticket` внутри skill; worfy видит перемену через
  слежение за `.scratch` (тикет 10).

## Готово, когда

- [x] «Ship ticket» на открытом Тикете с закрытыми блокерами создаёт Сессию с отрендеренным шаблоном Проекта (с шаблоном по умолчанию — `/ship-ticket worfy-mvp 07`; fake-агент записывает промпт); Сессия привязана к Тикету с источником `launch`, Привязка переживает перезапуск.
- [x] Шаблон, изменённый в «Project settings», уходит в следующем запуске как есть, с подставленными значениями; другой Проект со своим шаблоном шлёт свой текст.
- [x] На Тикете с открытым блокером кнопка неактивна и называет блокер.
- [x] С пустым шаблоном «Ship ticket» и «Run wave» неактивны и подсказывают задать шаблон в «Project settings»; Сессия не создаётся.
- [x] «Run wave» отправляет отрендеренный шаблон (по умолчанию `/epic-wave волна 3 эпика worfy-mvp`) Оркестратору; при занятом Оркестраторе встаёт в очередь.
- [x] «Open PR» открывает URL из данных `gh`; не-GitHub URL отклоняется.
- [x] После любого действия файлы `.scratch` не изменены worfy (test сверяет mtime на fake-агенте).
- [ ] Ручной прогон на репозитории worfy: «Ship ticket» запускает настоящую Сессию, та делает `ticket claim`, chip Тикета меняется на working; снимок в «Итог».

## Тесты

- `test/unit/render-template.test.ts` — подстановка всех пяти значений, шаблон без подстановок, повтор одной подстановки, подстановка без значения для действия — ошибка (новый).
- `test/unit/launch.test.ts` — условия активности: блокер, пустой шаблон, ошибка рендера (новый).
- `test/unit/binding.test.ts` — дополнить: сигнал `launch` слабее ручного и сильнее `ticket claim`.
- `test/e2e/ship-ticket.spec.ts` — fake-агент: Ship ticket с шаблоном по умолчанию и с изменённым, Run wave с занятым Оркестратором, пустой шаблон, Open PR (новый).
- Сначала падающий test: неактивная кнопка с причиной у Тикета с открытым блокером.

## Где в коде

- `src/main/actions/launch.ts`
- `src/shared/actions/render-template.ts`
- `src/renderer/canvas/actions/TicketActions.tsx`, `src/renderer/canvas/actions/EpicActions.tsx`, `src/renderer/canvas/actions/OpenPr.tsx`
- `src/shared/binding/resolve.ts` — сигнал launch
- `src/main/layout/bindings.ts` — запись в bindings.json

## Итог

Сделано в ветке `worfy-mvp/23`. Тесты: `test/unit/render-template.test.ts`, `test/unit/launch.test.ts`,
`test/unit/canvas-actions.test.tsx` (кнопки), дополнены `test/unit/binding.test.ts`,
`test/unit/binding-canvas.test.tsx`, `test/contract/bindings.test.ts`; новый контракт
`test/contract/actions.test.ts`; e2e — `test/e2e/ship-ticket.spec.ts` (fake-агент, сценарий
`orchestrator`, запись промптов через `WORFY_AGENT_LOG`; снимки `ship-ticket-buttons.png`,
`ship-ticket-after.png` в выводе Playwright).

Первый падающий test — `test/unit/canvas-actions.test.tsx`, «Ship ticket › is inactive on a Ticket
with an open blocker, and names the blocker». Ветка — один коммит, поэтому порядок по истории не
восстановить; на круге доработки после ревью падение воспроизведено двумя способами:
- поверх `origin/main` без реализации test не запускается: `Failed to resolve import
  "../../src/renderer/canvas/actions/TicketActions"` (у `test/unit/launch.test.ts` — `Cannot find
  module '../../src/main/actions/launch'`);
- поверх реализации без проверки блокеров в `shipTicketState` test падает по существу:
  `AssertionError: expected '/ship-ticket demo 10' to be 'blocked by 09'`.

Решения исполнителя (владелец был недоступен):

- **`{wave}` — номер Волны по плану Эпика.** «Номер готовой Волны» из тикета 10 (`waveNumbers`)
  для текущего состояния всегда 1: готовая Волна — первая из оставшихся. Чтобы `/epic-wave волна 3`
  называл ту же Волну, что таблица «Волны» в `spec.md` (и макет BRIEF: «Wave 2 … Ready wave · 3»),
  номер считается по плану, где все Тикеты Эпика открыты (`readyWaveNumber` в
  `src/shared/actions/render-template.ts`); если готовые Тикеты лежат в разных Волнах плана — меньший
  номер. Если план не даёт номера ни одному готовому Тикету, у `{wave}` нет значения и рендер падает.
- **`{branch}` — ветка корня Проекта**, как в тексте тикета. Подпись подстановки в «Project settings»
  (тикет 04, `PLACEHOLDER_DESCRIPTIONS.branch`) говорит «ticket branch» — расхождение не правил,
  файл вне следа.
- **Привязка `launch` хранится в том же `bindings.json`**, отдельной записью с полем
  `source: "launch"`; запись без поля — ручная, как у тикета 16, так что старые файлы читаются без
  изменений. У агента может быть одна ручная и одна `launch`-Привязка; «Remove binding» снимает
  только ручную; `bindings.set` из renderer-а не может записать `launch` (поля нет во входе канала).
  Пишет её main (`src/main/actions/launch.ts`), когда Claude Code сообщит id сессии, который
  называет транскрипт: опрос `session.sdkId` раз в 250 мс до 10 минут, или до закрытия Сессии.
  По силе — сразу после ручной (`BINDING_RULES`: manual → launch → claim → …), подпись «launched».
- **Проверка перед запуском — в main по свежему чтению workflow** (`readWorkflow`): кнопка
  показывает тот же вердикт (`shipTicketState`, `runWaveState`), но Тикет, взятый в терминале
  секунду назад, второй раз не запустится. Отказ main показывается в tooltip кнопки.
- **Второй «Ship ticket» на тот же Тикет отклоняется, пока жива запущенная Сессия** (круг
  доработки после ревью). Тикет остаётся `open`, пока запущенный агент не выполнит `ticket claim`,
  а `ticket claim` не отказывает уже взятому Тикету — без этого два агента работали бы над одним
  Тикетом. `ActionLauncher` помнит запуск (проект, Эпик, номер, Сессия) от отправки текста до
  закрытия этой Сессии: закрытие видно по `session.state === 'closed'` при следующем запросе и в
  цикле, который смотрит на запущенные Сессии раз в секунду, пока они есть. Две одновременные
  команды на один Тикет до создания Сессии тоже не проходят обе (резерв до первого `await`).
  Причина — `launchedHint` в `render-template.ts`, общая для main и кнопки; кнопка узнаёт о
  запусках через новый канал `actions.launches` и событие `actions.launches.changed` (снимок с
  `revision`, renderer держит самый новый — `src/renderer/canvas/actions/launches.ts`).
  Запись **не** снимается, когда Тикет уходит из `open`, вопреки предложению ревью: Тикет не
  в `open` и так отклоняется по своему состоянию, а Тикет, вернувшийся в `open` при живой
  запущенной Сессии, — это снова два агента на одном Тикете; причина говорит закрыть ту Сессию.
  Запуски хранятся в памяти main: после перезапуска worfy они забыты (Привязка `launch` остаётся).
- **Причина отказа main** берётся из ошибки IPC через `failureReason` (`src/shared/ipc/channels.ts`),
  а обёртка обработчиков в `src/main/ipc/index.ts` пишет ошибку через `handlerFailure` оттуда же:
  формат ошибки — часть контракта, а не регулярное выражение в renderer.
- **Кнопки не показываются**, где действовать нечего: «Ship ticket» — на Тикете в работе или
  `done`; «Run wave» — на Эпике, где все Тикеты `done`; «Open PR» — без PR. Неактивная кнопка —
  `aria-disabled` с причиной в tooltip (у `disabled` tooltip-а нет).
- **«Open PR» проверяет адрес в renderer-е** (`https://github.com/…`, без порта и логина); канал
  `shell.openExternal` тикета 11 по-прежнему открывает любой `https://` — для ссылок из Markdown.
- **Тикет с бейджами и кнопкой** (PR + «Open PR») ставит их в одну строку, бейджи обрезаются слева
  от кнопки: в Узел высотой 104 px две строки не помещаются, иначе вылезал заголовок
  (`src/renderer/canvas/actions/actions.css`).

Выход за след (нужен, чтобы действия работали; соседям по волне 10 не пересекается):
`src/shared/ipc/actions.ts`, `src/main/ipc/actions.ts` (новый домен IPC `actions.*`);
`src/shared/ipc/bindings.ts` (поле `source`), `src/renderer/binding/store.ts`,
`src/renderer/session/rail/BindingRail.tsx` (учёт `launch`); `src/shared/ipc/projects.ts`,
`src/main/ipc/projects.ts` (событие `projects.settings.changed`, чтобы кнопки сразу видели новый
шаблон); вспомогательные `src/renderer/canvas/actions/templates.ts`, `launches.ts`, `action-button.ts`,
`actions.css`; `src/shared/ipc/channels.ts` и `src/main/ipc/index.ts` (`handlerFailure`,
`failureReason`). e2e сверяет и список файлов временного `WORFY_CLAUDE_HOME` до запуска и после
обоих закрытий приложения (ADR 0005).

не проверено: ручной прогон на репозитории worfy с настоящей Сессией (`ticket claim` и смена chip на
working) — бриф запрещает настоящие запуски агента в этой работе; пункт оставлен `[ ]`.
