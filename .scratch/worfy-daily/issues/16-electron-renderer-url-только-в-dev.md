# 16 — ELECTRON_RENDERER_URL только в dev-сборке

Type: task
Status: done — 2026-10-06, [PR #71](https://github.com/IDSAD-XL/worfy/pull/71)
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

- [x] Упакованный `.app` с `ELECTRON_RENDERER_URL=http://127.0.0.1:1` в окружении грузит `out/renderer/index.html` (e2e `@packaged`).
- [x] `appUrlMatcher` упакованного приложения не доверяет origin из переменной.
- [x] dev-запуск по-прежнему грузит dev-сервер: unit `rendererEntry` с `isPackaged === false`.
- [x] Невалидная строка в переменной при dev-запуске показывает окно ошибки запуска с названием шага.

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

## Итог

**Условие — `app.isPackaged`**, а не режим сборки electron-vite (`import.meta.env.DEV`); ADR поэтому не нужен.
`rendererEntry()` (`src/main/window.ts`) читает `ELECTRON_RENDERER_URL` только при `app.isPackaged === false`.
Путь e2e не ломается: `pnpm test:e2e` запускает собранное, но не упакованное приложение (`electron <repo>`), у него `isPackaged` — `false`, как и раньше. Переменная там по-прежнему учитывается, как в `pnpm dev`.
Режим сборки отвергнут: он отключил бы переменную и в `out/` под e2e, а тикет просит именно упакованное приложение.

**Невалидная строка.** В dev-запуске значение, которое не является http(s) URL, бросает ошибку с именем переменной. `src/main/index.ts` строит проверку отправителя IPC внутри `inStep('loadURL', …)`, до `registerIpc`. Поэтому старт кончается окном ошибки запуска с шагом `loadURL` и кодом выхода 1, а не необработанным `TypeError`. Отдельного шага для чтения переменной нет: шаги перечислены в `src/main/startup-failure.ts`, файл вне следа тикета. Совет шага `loadURL` («запусти dev-сервер») дополнен текстом самой ошибки: «Unset it, or start worfy with `pnpm dev`».
`appUrlMatcher` (`src/main/ipc/index.ts`) сам отказывается строить проверку по адресу не-http(s). Иначе `localhost:5173` или `about:blank` дают origin `"null"`, а он совпадает с origin любой `data:`-страницы.

**Тесты.**
- `test/unit/renderer-entry.test.ts` (новый) — переменная задана или нет × `isPackaged`; невалидные значения; проверка отправителя, построенная из `rendererEntry()`, в упакованном приложении не доверяет origin из переменной.
- `test/contract/actions.test.ts` — проверка отправителя с dev-сервером: свой origin, чужие порт, хост и схема, `file://`, Card, `data:`, неразбираемый URL кадра, неразбираемый адрес dev-сервера.
- `test/contract/startup-failure.test.ts` — вне следа, но иначе ломался: test-ы загрузки с dev-сервера шли с `isPackaged: true`. Mock `app.isPackaged` стал переключаемым. Добавлены два случая старта: dev-запуск с `not a url` — шаг `loadURL` до регистрации обработчиков; упакованное приложение с тем же значением стартует.
- `test/e2e/packaged.spec.ts` — `@packaged`: копия `.app` с `ELECTRON_RENDERER_URL=http://127.0.0.1:1` грузит `…/app.asar/out/renderer/index.html`, и вызов `app.version` из страницы проходит. Без тега: dev-запуск с `not a url` выходит с кодом 1 и шагом `loadURL` в stderr.

Не проверено: e2e `@packaged` не прогонялся на сборке `.app` без правки (красный на старом коде — по рассуждению; unit и contract test-ы краснеют на мутантах правки).

Не проверено: живой `pnpm dev` с окном — что dev-сервер по-прежнему грузится в окно и IPC со страницы проходит. Ревью проверило это кодом и test-ами (адрес `http://localhost` проходит проверку отправителя), окно глазами не смотрели. Пункт — в HANDOFF, «Ждёт владельца».

**Ревью и мерж.** [PR #71](https://github.com/IDSAD-XL/worfy/pull/71), merge 8a9c978. Ревью — VERIFIED, без доработки: упакованный `.app` не смотрит на переменную и доверяет только своему `file://`; правка `test/contract/startup-failure.test.ts` (Ticket 15) сохранила все прежние проверки. Перед мержем — rebase на e31c0c0 и `GATE_SCOPE=all gate.sh full` с exit 0 ([комментарий в PR #71](https://github.com/IDSAD-XL/worfy/pull/71#issuecomment-6026434721), CI run 37538172616).

Долги [low]:
- `test/e2e/helpers.ts:123-126` — `launchApp` передаёт `ELECTRON_RENDERER_URL` из shell разработчика в e2e неупакованной сборки. Убирать её, если `options.env` её не задаёт.
- `src/main/startup-failure.ts:10-21` — нет отдельного шага старта для неверного адреса renderer. Совет шага `loadURL` (`:49-52`) написан про незапущенный dev-сервер.

