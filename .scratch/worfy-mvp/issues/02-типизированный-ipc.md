# 02 — Типизированный IPC: канал описан один раз, проверяется на границе и расширяется без правки центральных файлов

Type: task
Status: done — 2026-10-05, [PR #3](https://github.com/IDSAD-XL/worfy/pull/3)
Blocked by: 01
Source: [spec.md](../spec.md), раздел «Как устроено», «Точки расширения вместо центральных файлов»; [ADR-0004](../../../docs/adr/0004-stack-electron-ts-react-flow-agent-sdk.md), абзац про типы на границах IPC

## Что делаем

Почти каждый тикет эпика добавляет канал между renderer и main. Если каналы перечислены в одном
файле, параллельные тикеты будут конфликтовать в нём всегда. Поэтому контракт расширяемый.

- `src/shared/ipc/channels.ts` объявляет пустой интерфейс `IpcContract` и типы двух видов
  каналов: запрос-ответ (`invoke`) и поток событий из main (`event`). Каждый канал — пара
  zod-схем: вход и выход.
- Домен добавляет файл `src/shared/ipc/<домен>.ts`: дополняет `IpcContract` (declaration
  merging) и экспортирует схемы. Пример в этом тикете — домен `app` с каналом `app.version`.
- Preload (`src/preload/index.ts`) отдаёт в `window.worfy` три функции: `invoke(channel, input)`,
  `on(channel, handler)` и `off`. Список каналов preload не знает и после этого тикета не
  меняется.
- `src/main/ipc/index.ts` подхватывает все `src/main/ipc/*.ts` через `import.meta.glob`. Каждый
  обработчик регистрируется функцией-обёрткой, которая проверяет вход zod-схемой, ловит
  исключение и отдаёт renderer-у `{ok:false, error}` вместо падения. Выход тоже проверяется: main
  не отдаёт того, чего нет в контракте.
- Main принимает вызовы только от своего окна (проверка `event.senderFrame` на URL приложения).
- `src/renderer/ipc.ts` — типизированные обёртки `invoke`/`subscribe` для React-кода.

Решение «каналы дополняют интерфейс, обработчики подхватываются сами» записать как ADR-0006
(номер 0005 уже занят: [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) — собственное состояние worfy).

## Готово, когда

- [x] Канал `app.version` работает из renderer: версия приложения видна в окне.
- [x] Неверный вход (например, число вместо строки) возвращает `{ok:false}` с текстом ошибки zod; main не падает.
- [x] Новый канал добавляется двумя новыми файлами (`src/shared/ipc/<домен>.ts`, `src/main/ipc/<домен>.ts`) без правки `channels.ts`, `src/main/ipc/index.ts` и preload — это показывает test с каналом-образцом.
- [x] Вызов `invoke` с каналом, которого нет в контракте, не компилируется (`// @ts-expect-error` в test-е).
- [x] Вызов из чужого frame отклоняется.
- [x] ADR-0006 записан.

## Тесты

- `test/contract/ipc.test.ts` — обёртка регистрации на фейковом `ipcMain`: валидный вход, невалидный вход, невалидный выход, исключение в обработчике, чужой отправитель (новый).
- `test/e2e/launch.spec.ts` — дополнить: в окне видна версия из `app.version`.
- Сначала падающий test: contract test на невалидный вход пишется до обёртки.

## Где в коде

- `src/shared/ipc/channels.ts`, `src/shared/ipc/app.ts`
- `src/preload/index.ts`
- `src/main/ipc/index.ts`, `src/main/ipc/app.ts`, `src/main/index.ts` (подключить регистрацию)
- `src/renderer/ipc.ts`
- `docs/adr/0006-ipc-contract-by-declaration-merging.md`

## Итог

PR: https://github.com/IDSAD-XL/worfy/pull/3 (ветка `worfy-mvp/02`). CI (lint, typecheck, test на `macos-latest`) — зелёный: https://github.com/IDSAD-XL/worfy/actions/runs/37255566145 , после доработки по ревью (коммит 232169a) — https://github.com/IDSAD-XL/worfy/actions/runs/37256297490 ; e2e в CI не входит, прогнан локально.

**Сначала падающий test.** `test/contract/ipc.test.ts` и канал-образец `test/contract/ipc-sample/`
написаны до `src/`. `pnpm test` упал с `Failed to resolve import "../../src/main/ipc/index"`
(1 файл красный, остальные 29 test-ов зелёные), код 1.

**Как устроено** (подробно и почему — [ADR-0006](../../../docs/adr/0006-ipc-contract-by-declaration-merging.md)):
- `src/shared/ipc/channels.ts` — пустой `IpcContract`, `invokeChannel` / `eventChannel`, выводимые
  типы (`InvokeName`, `InvokeInput`, `InvokeOutput`, `EventPayload`), `IpcResult`, тип моста
  `WorfyBridge`, префикс `worfy:`. Рантайм-код файла не тянет zod, поэтому preload его не бандлит.
- Домен = `src/shared/ipc/<домен>.ts` (определения + `declare module './channels'`) и
  `src/main/ipc/<домен>.ts` (default export — список `defineHandler(канал, функция)`).
- `src/main/ipc/index.ts` — ленивый `import.meta.glob(['./*.ts', '!./index.ts'])`, обёртка
  (проверка frame → разбор входа → вызов → разбор выхода), `emit` для событий,
  `appUrlMatcher`. Доверенный адрес renderer-а `registerIpc` получает параметром
  `isTrustedSender` (без значения по умолчанию); `src/main/index.ts` строит его из
  `rendererEntry()` в `src/main/window.ts` — той же функции, по которой окно грузит renderer. Electron импортируется только как тип, ipcMain передаётся параметром
  `registerIpc(ipcMain)` — так файл грузится в vitest под `ELECTRON_RUN_AS_NODE`, где
  `import { ipcMain } from 'electron'` не работает (пакет `electron` там — строка с путём).
  Глоб ленивый по той же причине: обработчики импортируют `app` из Electron.
- `src/main/index.ts` регистрирует обработчики до создания первого окна. Ошибка регистрации
  (модуль неверной формы, канал в двух модулях) останавливает запуск: `console.error`,
  `dialog.showErrorBox('worfy could not start', …)` и `app.exit(1)`.
- Preload: `invoke`, `on` (возвращает номер подписки), `off(номер)`. `off` по номеру, а не по
  функции: функция, переданная через `contextBridge`, приходит новой обёрткой при каждом
  пересечении, и снять слушатель по ней нельзя.
- `src/renderer/ipc.ts` — `invoke` / `subscribe` и `createIpcClient(мост)` для test-ов; `invoke`
  всегда возвращает `IpcResult`, отказ самого моста тоже становится `{ok:false}`.

**Решения.**
- **Вне следа: `src/renderer/main.tsx` и `src/renderer/AppVersion.tsx`.** Пункт «версия видна в
  окне» без правки окна не выполнить, а в «Где в коде» его нет. `AppVersion`
  (`<small data-testid="app-version">`) — отдельный файл. Тикет 03 влит раньше и монтирует
  `<AppShell />` в `main.tsx`; при rebase на main версия встала в слот `canvas` AppShell:
  `<AppShell canvas={<AppVersion />} />`. Рядом с `<App />` в `render` её оставлять нельзя:
  `.w-shell` занимает 100vh, и версия ушла бы под окно. Слот `canvas` пуст до тикета 05 (Canvas
  на React Flow) — тикет 05, заполняя слот, переносит `AppVersion` (например, в toolbar); e2e
  `test/e2e/launch.spec.ts` («the window shows the version from package.json…») должен остаться
  зелёным. Строку-указание для тикета 03 из PR убрал: 03 уже влит.
- **Тест renderer-клиента — отдельный файл `test/contract/ipc-renderer.test.tsx`.** Проекты
  tsconfig — `composite`, и node-проект не может включить `src/renderer/ipc.ts` (TS6307). Файл
  `.tsx` объявляет свои test-каналы `client.echo` и `client.ticked`; канал-образец для main —
  `sample.*` в `test/contract/ipc-sample/`.
- **Test-каналы не входят в контракт кода `src/` (вне следа: `tsconfig*.json`, `package.json`).**
  Проектов tsconfig четыре: `tsconfig.node.json` и `tsconfig.web.json` проверяют только `src/`
  (и конфиги сборки), `tsconfig.test.node.json` и `tsconfig.test.web.json` — `src/` вместе с
  test-ами. `pnpm typecheck` прогоняет все четыре. Так `sample.*` и `client.*` дополняют
  `IpcContract` только в test-проектах. Проверено: `invoke('client.echo', …)` в
  `src/renderer/main.tsx` даёт `TS2345 … not assignable to parameter of type '"app.version"'`, а
  `'sample.echo'` как `InvokeName` в `src/main/ipc/app.ts` — `TS2322`. Попутно всплыло: без
  test-каналов в контракте нет ни одного event-канала, и `emit` не компилировался
  (`Property 'name' does not exist on type 'C'`) — тип канала в `emit` теперь расширяется до
  `EventChannel` явно.
- **Проверка «ключ = имя канала»** — `contractNamesMatch` в `channels.ts`. Проверено мутацией:
  ключ `'app.versio'` даёт `TS2322 … not assignable to type "app.versio"` при свежем
  tsbuildinfo. При инкрементальном `pnpm typecheck` ошибка в самом `channels.ts` может не
  появиться (файл не импортирует домен и не перепроверяется), но тогда падают все места
  использования канала (`defineHandler`, `invoke`).
- **`@ts-expect-error` проверены мутацией:** без комментария строка
  `client.invoke('no.such.channel', {})` даёт `TS2345 … not assignable to parameter of type
  'InvokeName'`.
- **Выход вне контракта** логируется в main (`console.error` с текстом zod), а renderer-у уходит
  только `{ok:false, error: '<канал>: invalid output from the handler'}` — без кусков значения.
- **e2e запускает приложение по каталогу (вне следа: `test/e2e/helpers.ts`).** Раньше
  `launchApp` запускал `electron out/main/index.js`, и `app.getVersion()` отдавал версию Electron
  (`v44.5.1`). Теперь — `electron <корень репозитория>`, как `pnpm dev` и собранный `.app`:
  Electron читает `package.json` (`main` → `out/main/index.js`), версия и имя приложения — свои.
  Test сравнивает текст в окне с `version` из `package.json`, а не с тем же `app.getVersion()`,
  что вызывает обработчик. Проверено мутацией: обработчик, отдающий
  `process.versions.electron`, даёт красный e2e (`Expected: "v0.0.0"`, `Received: "v44.5.1"`).
- **Обработчик не запускается для чужого frame — проверено test-ом.** Обработчик канала-образца
  `sample.echo` пишет вход в `echoCalls` (`test/contract/ipc-sample/main/sample.ts`); test
  чужого frame проверяет, что список пуст. Мутации «вызвать обработчик в ветке отказа и
  проглотить ошибку» и «проверка frame после вызова обработчика» — обе красные.
- **Preload покрыт test-ом** `test/contract/preload.test.ts` (мок модуля `electron`): `invoke` и
  `on` идут под префиксом `worfy:`, обработчик получает только payload, `off(id)` снимает ровно
  тот слушатель, что добавил `on`. Мутации «нет `removeListener` в `off`» и «нет префикса в `on`»
  — красные.
- **Ошибка запуска проверена вручную.** Временный `src/main/ipc/broken.ts` с `export default 42`,
  сборка, `electron .`: в stderr `[worfy] could not start Error: IPC handler module ./broken.ts
  must default-export …`, процесс ждёт закрытия модального окна ошибки. С временно убранным
  `showErrorBox` процесс выходит сразу с кодом 1.
- вид окна ошибки запуска и код выхода 1 после нажатия OK — см. «Ручная проверка 2026-10-05» в
  конце «Итог».

**Проверки (локально, код возврата).**
- `pnpm lint && pnpm typecheck && pnpm test` → 0 (7 файлов, 50 test-ов; после доработки по ревью).
- `bash ~/.claude/hooks/gate.sh fast </dev/null` → `[gate] зелено (fast): worfy/.:lint
  worfy/.:typecheck worfy/.:test`, код 0.
- `pnpm test:e2e` → 0, 4 test-а: версия видна в окне; `window.worfy.invoke('app.version', 42)`
  возвращает `{ok:false, error: 'app.version: invalid input …'}`, и следующий вызов — `{ok:true}`.


**Доработка, круг 2 (по подтверждённой находке ревью, линза «тесты»).**
- Находка: выход обработчика проверялся только на неверный тип, не на лишний ключ. Мутант
  `return { ok: true, value: output }` в `src/main/ipc/index.ts` (сырое значение обработчика вместо
  разобранного) оставлял `pnpm test` зелёным. Добавлен test `strips keys the contract does not
  declare from the handler output` в `test/contract/ipc.test.ts`: обработчик `sample.leak`
  возвращает `{count: 3, secret: …}`, вызывающий получает ровно `{ok: true, value: {count: 3}}`
  (`toStrictEqual`), и строки `secret` в ответе нет. Мутант теперь красный: 1 failed | 52 passed, код 1.
- Сверх находки (подсказка оркестратора): test `test/contract/main-ipc-wiring.test.ts` грузит
  настоящий `src/main/index.ts` с моком `electron` и `src/main/window` и вызывает
  зарегистрированный `app.version` от имени frame-а. Вызов из адреса `rendererEntry()` отвечает
  `{ok: true}`, из чужого адреса — отказ «untrusted». Мутант `isTrustedSender: () => true` в
  `src/main/index.ts` теперь красный: 1 failed | 52 passed, код 1. Код `src/` в этом круге не менялся.
- Проверки круга 2: `pnpm lint && pnpm typecheck && pnpm test` → 0 (8 файлов, 53 test-а);
  `gate.sh fast` → зелено, код 0; `GATE_SCOPE=all gate.sh full` → зелено (lint, typecheck, test,
  test:e2e), код 0; `pnpm test:e2e` → 0, 4 test-а. CI на коммит 52f698c не стартовал: PR #3 в
  состоянии `mergeStateStatus: DIRTY` (конфликт с `main` только в этом файле тикета — `main`
  обновил статусы волны 2), а GitHub не запускает `pull_request`-run для PR с конфликтом. Rebase
  на `main` по брифу делает шаг мержа; CI после него — не проверено.

### Ручная проверка 2026-10-05

Сборка `main` @ 479ec62. Что: при сбое запуска срабатывает `.catch` в `src/main/index.ts:36-42` —
`console.error`, окно `dialog.showErrorBox('worfy could not start', …)` и `app.exit(1)`.

- Как вызвать сбой без правки кода: невалидный `ELECTRON_RENDERER_URL`. Его читает
  `rendererEntry()` (`src/main/window.ts:88`), и `new URL()` в `appUrlMatcher`
  (`src/main/ipc/index.ts:73`) бросает исключение в том же `.then`, строкой раньше `registerIpc`.
  Сбой самой регистрации IPC без правки кода не вызвать: модули обработчиков лежат в `app.asar` и
  при загрузке данных с диска не читают. Повод другой, но `.catch`, окно и код выхода общие.
- Запуск: `worfy.app/Contents/MacOS/worfy` с временными `WORFY_DATA_DIR` и `WORFY_CLAUDE_HOME`,
  `WORFY_AGENT=fake`, `ELECTRON_RENDERER_URL='not a url'`. В stderr `[worfy] could not start
  TypeError: Invalid URL … code: 'ERR_INVALID_URL'`; процесс жив и ждёт закрытия окна.
- Окно: System Events видит у процесса одно окно subrole `AXDialog`, 260×202, с текстами «worfy
  could not start», «Invalid URL» и кнопкой OK. Снимок только этого окна (`screencapture -l` по
  CGWindowID): системный alert macOS с иконкой Electron, заголовок «worfy could not start», под ним
  «Invalid URL», кнопка OK.
- Перед нажатием проверено, что фронтальный процесс — worfy. OK нажат через System Events →
  процесс вышел с кодом 1. Первый запуск закрыл не агент: alert встал фронтальным, перехватил
  клавиатуру и был закрыт, скорее всего клавишей владельца; код выхода там тоже 1.
- Все экземпляры worfy закрыты, временные каталоги удалены.
- Вердикт: проверено. Снимок: `02-startup-error-dialog.png` (в scratchpad сессии оркестратора, в
  репозиторий не положен).
- Дефекты (не исправлены):
  - Собранный `.app` слушается `ELECTRON_RENDERER_URL`: `rendererEntry()` (`src/main/window.ts:88`)
    читает переменную без проверки, что это dev-сборка. С невалидным значением приложение не
    стартует (проверено). С валидным, по коду, загрузило бы в окно страницу с этого адреса и
    доверяло бы IPC-вызовам с её origin (`appUrlMatcher`, `src/main/ipc/index.ts:72-74`); это не
    запускалось. Серьёзность низкая: нужен контроль над окружением запуска. В шаблоне
    electron-vite переменную читают только при `is.dev`.
  - UX: окно ошибки показывает только текст исключения («Invalid URL»), без имени переменной и
    значения; stack trace есть только в stderr.
