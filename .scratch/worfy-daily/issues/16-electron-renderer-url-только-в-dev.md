# 16 — ELECTRON_RENDERER_URL только в dev-сборке

Type: task
Status: blocked — blocked by 15
Blocked by: 15
Source: [spec.md](../spec.md), тема C; Ticket-ы 01 и 02 worfy-mvp (окно, доверенный отправитель IPC)

## Что делаем

**Что сейчас.** `rendererEntry()` (`src/main/window.ts:86-89`) берёт `process.env.ELECTRON_RENDERER_URL`
и не проверяет, в каком режиме запущено приложение. Значение используют два места:

- `createMainWindow` (`window.ts:72-77`): если переменная задана — `loadURL`, иначе `loadFile`;
- `appUrlMatcher` (`src/main/ipc/index.ts:72-85`, вызов из `src/main/index.ts:26`): при заданном
  dev-сервере доверенным отправителем IPC считается весь его origin.

**Чем это опасно** (вывод из кода). Переменная может остаться в окружении: в shell разработчика после
`electron-vite dev` или в CI. Тогда собранный `.app`:

- грузит dev-сервер, а если сервер не запущен, показывает пустое окно;
- доверяет IPC любой странице с этого origin.

Кроме того, `new URL(devServerUrl)` на невалидной строке бросает исключение при старте. e2e helper
передаёт приложению всё окружение процесса, кроме `ELECTRON_RUN_AS_NODE` (`test/e2e/helpers.ts:50-53`).
Значит, переменная доходит и до e2e.

**Правки:**

- Переменная читается только в dev-сборке: `app.isPackaged === false`.
- e2e запускают собранное, но не упакованное приложение. Надо проверить, что новое условие не ломает
  их путь. Выбор условия (`isPackaged` или режим сборки) записать в «Итог»; если выбран не
  `isPackaged` — ADR (номер с 0022).
- Невалидная строка в переменной при dev-запуске показывает окно ошибки запуска (Ticket 15), а не
  бросает необработанное исключение.

## Готово, когда

- [ ] Упакованный `.app` с `ELECTRON_RENDERER_URL=http://127.0.0.1:1` в окружении грузит `out/renderer/index.html` (e2e `@packaged`).
- [ ] `appUrlMatcher` упакованного приложения не доверяет origin из переменной.
- [ ] dev-запуск по-прежнему грузит dev-сервер: unit `rendererEntry` с `isPackaged === false`.
- [ ] Невалидная строка в переменной при dev-запуске показывает окно ошибки запуска с названием шага.

## Тесты

- `test/unit/renderer-entry.test.ts` (новый) — переменная задана или нет × `isPackaged` true или false.
- `test/contract/actions.test.ts` — `appUrlMatcher` с dev-сервером: свой origin, чужой, невалидный URL. Сейчас (`:36`) проверяется только случай без dev-сервера.
- `test/e2e/packaged.spec.ts` — `@packaged` с переменной в окружении.
- Сначала падающий test: при `isPackaged === true` и заданной переменной `rendererEntry` возвращает адрес dev-сервера.

## Где в коде

- `src/main/window.ts`
- `src/main/ipc/index.ts`
- `src/main/index.ts`
- `test/unit/renderer-entry.test.ts` (новый)
- `test/contract/actions.test.ts`
- `test/e2e/packaged.spec.ts`
