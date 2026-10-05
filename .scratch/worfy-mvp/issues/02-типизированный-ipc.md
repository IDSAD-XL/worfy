# 02 — Типизированный IPC: канал описан один раз, проверяется на границе и расширяется без правки центральных файлов

Type: task
Status: blocked — ревью дважды не чистое: contract test IPC не ловит лишние ключи в выходе обработчика — мутант в src/main/ipc/index.ts:143 (сырой выход вместо разобранного) проходит; PR #3
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

- [ ] Канал `app.version` работает из renderer: версия приложения видна в окне.
- [ ] Неверный вход (например, число вместо строки) возвращает `{ok:false}` с текстом ошибки zod; main не падает.
- [ ] Новый канал добавляется двумя новыми файлами (`src/shared/ipc/<домен>.ts`, `src/main/ipc/<домен>.ts`) без правки `channels.ts`, `src/main/ipc/index.ts` и preload — это показывает test с каналом-образцом.
- [ ] Вызов `invoke` с каналом, которого нет в контракте, не компилируется (`// @ts-expect-error` в test-е).
- [ ] Вызов из чужого frame отклоняется.
- [ ] ADR-0006 записан.

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
