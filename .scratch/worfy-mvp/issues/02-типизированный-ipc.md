# 02 — Типизированный IPC: канал описан один раз, проверяется на границе и расширяется без правки центральных файлов

Type: task
Status: blocked — CI на перебазированном head 05cf918 (прогон 37259626463) не завершился к моменту возврата — мерж не сделан; PR #3 открыт
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

Ветка `worfy-mvp/02`, PR — в описании ветки на GitHub (номер — в отчёте оркестратору).

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
  `appUrlMatcher`. Electron импортируется только как тип, ipcMain передаётся параметром
  `registerIpc(ipcMain)` — так файл грузится в vitest под `ELECTRON_RUN_AS_NODE`, где
  `import { ipcMain } from 'electron'` не работает (пакет `electron` там — строка с путём).
  Глоб ленивый по той же причине: обработчики импортируют `app` из Electron.
- `src/main/index.ts` регистрирует обработчики до создания первого окна.
- Preload: `invoke`, `on` (возвращает номер подписки), `off(номер)`. `off` по номеру, а не по
  функции: функция, переданная через `contextBridge`, приходит новой обёрткой при каждом
  пересечении, и снять слушатель по ней нельзя.
- `src/renderer/ipc.ts` — `invoke` / `subscribe` и `createIpcClient(мост)` для test-ов; `invoke`
  всегда возвращает `IpcResult`, отказ самого моста тоже становится `{ok:false}`.

**Решения.**
- **Вне следа: `src/renderer/main.tsx`.** Пункт «версия видна в окне» без правки компонента
  окна не выполнить, а в «Где в коде» его нет. Правка минимальная: компонент `AppVersion`
  (`<small data-testid="app-version">`) и `<span>` вокруг слова «worfy»; тикет 03 (AppShell)
  при мерже может перенести их к себе.
- **Тест renderer-клиента — отдельный файл `test/contract/ipc-renderer.test.tsx`.** Проекты
  tsconfig — `composite`, и `tsconfig.node.json` не может включить `src/renderer/ipc.ts`
  (TS6307). Файл `.tsx` проверяется в `tsconfig.web.json` вместе с renderer-ом и объявляет свои
  test-каналы `client.echo` и `client.ticked`; канал-образец для main — `sample.*` в
  `test/contract/ipc-sample/`. Цена: в typecheck эти test-каналы видны как часть `IpcContract`
  (node-проект видит `sample.*`, web-проект — `client.*`); в сборку они не попадают.
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
- **Версия в e2e — версия Electron.** `test/e2e/helpers.ts` запускает `electron out/main/index.js`,
  и `app.getVersion()` тогда отдаёт версию Electron (`v44.5.1`), а не `package.json`. Запуск
  `electron .` (как в `pnpm dev` и в собранном `.app`) показывает `v0.0.0` — проверено разовым
  Playwright-скриптом со скриншотом окна. e2e сравнивает текст в окне с `app.getVersion()`, а не
  с `package.json`; правка `helpers.ts` — вне следа тикета.

**Проверки (локально, код возврата).**
- `pnpm lint && pnpm typecheck && pnpm test` → 0 (6 файлов, 47 test-ов).
- `bash ~/.claude/hooks/gate.sh fast </dev/null` → `[gate] зелено (fast): worfy/.:lint
  worfy/.:typecheck worfy/.:test`, код 0.
- `pnpm test:e2e` → 0, 4 test-а: версия видна в окне; `window.worfy.invoke('app.version', 42)`
  возвращает `{ok:false, error: 'app.version: invalid input …'}`, и следующий вызов — `{ok:true}`.

