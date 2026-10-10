# 01 — Настройки приложения: файл app-settings.json и каналы appSettings

Type: task
Status: claimed — 2026-10-09
Blocked by: —
Source: решения владельца 2026-10-09: 1 (свёрнутость секций боковой панели помнится между запусками), 2 (настройки приложения — новый файл в папке данных worfy, каналы `local`, образец — `view.*` и `json-file`), 3 (масштаб интерфейса помнится), 8 (видимость боковой панели помнится отдельно для обычного вида и режима фокуса) ([spec.md](../spec.md), «Как устроено», «Настройки приложения»); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние worfy — в его папке данных); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (пометка канала)

## Что происходит

- Общего файла настроек приложения нет, домена IPC для них тоже: `app-settings` и `appSettings` в
  `src/` не встречаются (grep).
- Своё состояние worfy лежит в его папке данных — `dataRoot()` (`src/main/storage/paths.ts:30-34`);
  `WORFY_DATA_DIR` её подменяет, dev-сборка берёт `worfy-dev`. Файлы приложения сейчас:
  `window-state.json` (`src/main/window.ts:9-12`), `first-run.json` (`src/main/ipc/first-run.ts:147`),
  `viewports.json` (`src/main/layout/viewports.ts:4`), `link/settings.json`
  (`src/main/link/settings.ts:1-8`).
- Хранилища с Ticket-а 04 worfy-mvp читают и пишут через `src/main/storage/json-file.ts`: схема zod,
  атомарная запись через временный файл, нечитаемый файл переименовывается в
  `<имя>.unreadable-<время>`, и хранилище начинает с пустого состояния (`json-file.ts:1-16`). Мимо
  него пишутся `window-state.json` (`json-file.ts:12-13`) и `first-run.json`
  (`src/main/ipc/first-run.ts:163`).
- Образец домена «состояние в main, renderer следит за ним» — `view`: канал `view.get` и событие
  `view.changed` (`src/shared/ipc/view.ts:13-16`), рассылка каждому окну через `toEveryWindow`
  (`src/main/ipc/view.ts:14-18`). Состояние `view` живёт только в памяти (`src/main/ipc/view.ts:8`),
  на диск не пишется.
- Renderer держит состояние main zustand-store-ом с ревизией: `acceptLinkState` берёт состояние, если
  его ревизия не меньше текущей (`src/renderer/machines/useMachines.ts:20-23`). Так ответ и событие,
  пришедшие в обратном порядке, не откатывают состояние.
- localStorage renderer не использует; sessionStorage — только
  `src/renderer/session/notification-target.ts:97`.
- Новый домен IPC не правит `src/main/ipc/index.ts`: handler-модули находит `import.meta.glob`
  (`src/main/ipc/index.ts:62`). Пометка доступа у канала обязательна; `local` — состояние машины
  экрана, Linked machine-у закрыто (`src/shared/ipc/channels.ts:30-31`).

## Что делаем

1. **Схема** — `src/shared/settings/app-settings.ts` (новый). Сразу все поля Epic-а, чтобы
   Ticket-ы 03, 04 и 10 файл схемы не правили:
   - `interfaceScale` — от 0.8 до 1.5, кратно 0.1, по умолчанию 1 (Ticket 03);
   - `sidebar.collapsed` — `{ [id секции]: boolean }`; id — имя файла секции без расширения, как
     `ShellExtension.id` (`src/renderer/shell/registry.ts:10-15`), например `MachinesSection`. Нет
     ключа — значение по умолчанию самой секции (Ticket-ы 04 и 05);
   - `sidebar.visible` — `{ normal: boolean, focus: boolean }`, оба по умолчанию `true` (Ticket 10);
   - `revision` — растёт с каждой записью.

   Там же `clampScale(value)` — приводит число к диапазону и шагу 0.1 (его зовут меню и ползунок
   Ticket-а 03) и значения по умолчанию.
2. **Хранилище в main** — `src/main/settings/store.ts` (новый): `app-settings.json` в `dataRoot()`,
   чтение `readJsonFile`, запись `writeJsonFile`. Нет файла или он нечитаем — значения по умолчанию.
   Поле вне схемы отбрасывается, `interfaceScale` вне диапазона приводится (`3` → `1.5`). Событие
   `changed` — для модулей main (масштаб окна, Ticket 03).
3. **Каналы** — `src/shared/ipc/app-settings.ts` (новый), все `local`:
   - `appSettings.get` — состояние целиком;
   - `appSettings.set` — изменение частями: `{ interfaceScale?, sidebar?: { collapsed?, visible?:
     { normal?, focus? } } }`. `collapsed` сливается по ключам: изменение одной секции не стирает
     другие. Ответ — новое состояние;
   - событие `appSettings.changed` — каждому окну, как `view.changed`.

   Handler-ы — `src/main/ipc/app-settings.ts` (новый).
4. **Renderer** — `src/renderer/settings/useAppSettings.ts` (новый): zustand-store; первый запрос
   `appSettings.get`, подписка на `appSettings.changed`, состояние берётся по ревизии, как
   `acceptLinkState`. `setAppSettings(patch)` зовёт `appSettings.set`. Без моста preload (unit-test-ы
   компонентов) — значения по умолчанию.
5. Окно на Project-е Linked machine-а читает и пишет настройки своей Machine: канал `local`
   (`src/renderer/ipc.ts:5-11`). Файл один на Machine: изменение в одном окне приходит всем окнам
   этой Machine (масштаб, свёрнутость секций, видимость боковой панели).

**Не входит:** UI — Ticket-ы 02–05 и 10; переключатели Machines остаются в `link/settings.json`
(Ticket 05 переносит только их UI); синхронизация настроек между Machine-ами — ADR-0005, будущее
решение; перенос `window-state.json` в этот файл.

## Готово, когда

- [x] Contract `test/contract/app-settings.test.ts` (новый), хранилище над временной папкой: нет
  файла — значения по умолчанию; `appSettings.set` пишет `app-settings.json` и шлёт
  `appSettings.changed` каждому окну; новое хранилище над той же папкой читает записанное;
  нечитаемый файл отложен как `app-settings.json.unreadable-<время>`, состояние — по умолчанию;
  `interfaceScale: 3` приведён к `1.5`, `0.83` — к `0.8`; поле вне схемы отброшено; изменение
  `collapsed` одной секции не стирает другую; `revision` растёт.
- [x] Contract, тот же файл: все три канала помечены `local`; соединение Linked machine-а их не
  вызывает (адаптер канала, по образцу `test/contract/link-access.test.ts`).
- [x] Unit `test/unit/use-app-settings.test.tsx` (новый): store берёт ответ `appSettings.get`;
  событие со старшей ревизией меняет состояние, с младшей — нет; `setAppSettings` зовёт
  `appSettings.set` с переданной частью; без моста preload — значения по умолчанию.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0 (новый домен IPC грузится при старте приложения, это видят только e2e и `.app`).
  Gate full — exit 0 с четвёртого прогона; три красных прогона с разными нестабильными test-ами —
  в «Итог».

## Тесты

Сначала падающий test — contract «нет файла — значения по умолчанию»: модуля хранилища нет. Затем
слияние `collapsed` и приведение `interfaceScale`.

UI у Ticket-а нет, поэтому снимков и ручных пунктов нет. В «Итог» — имена каналов и полей, как их
зовут Ticket-ы 02–05 и 10, и как падал первый test.

## Где в коде

- `src/shared/settings/app-settings.ts` (новый)
- `src/shared/ipc/app-settings.ts` (новый)
- `src/main/settings/store.ts` (новый)
- `src/main/ipc/app-settings.ts` (новый)
- `src/renderer/settings/useAppSettings.ts` (новый)
- `test/contract/app-settings.test.ts` (новый)
- `test/unit/use-app-settings.test.tsx` (новый)

## Итог

PR #207, ветка `worfy-ui/01`.

- **Первый test.** `test/contract/app-settings.test.ts` упал раньше любой проверки: модуля
  `src/main/settings/store.ts` не было («Failed to resolve import "../../src/main/settings/store"»,
  0 test-ов). `test/unit/use-app-settings.test.tsx` — так же, без `src/renderer/settings/useAppSettings.ts`.
  Первый прогон после реализации поймал округление: `1.15 / 0.1` даёт `11.499…`, поэтому
  `clampScale` считает в десятых умножением (`Math.round(x * 10) / 10`).
- **Для Ticket-ов 02–05 и 10 — имена, как их звать.**
  - Схема — `src/shared/settings/app-settings.ts`: тип `AppSettings` = `{ interfaceScale, sidebar:
    { collapsed: { [id секции]: boolean }, visible: { normal, focus } }, revision }`; тип изменения
    `AppSettingsPatch`; `clampScale(value)`; константы `INTERFACE_SCALE_MIN` (0.8), `_MAX` (1.5),
    `_STEP` (0.1), `_DEFAULT` (1); `DEFAULT_APP_SETTINGS` и `defaultAppSettings()` (свежая копия).
    Id секции — имя файла без расширения, шаблон `^[A-Za-z0-9][\w-]{0,99}$` (так в запись не
    попадает ключ вроде `__proto__`).
  - Каналы — `src/shared/ipc/app-settings.ts`, все `local`: `appSettings.get` (`appSettingsGet`),
    `appSettings.set` (`appSettingsSet`, ответ — новое состояние), событие `appSettings.changed`
    (`appSettingsChanged`) каждому окну.
  - Main — `appSettingsStore()` из `src/main/settings/store.ts` (одно хранилище на приложение,
    создаётся без чтения файла, файл читается при первом `get`/`set`); `.get()`, `.set(patch)`,
    событие `.on('changed', state => …)` — его слушает масштаб окна Ticket-а 03. Изменение из main
    (пункт меню) тоже уходит каждому окну: `src/main/ipc/app-settings.ts` подписан на `changed`.
  - Renderer — `src/renderer/settings/useAppSettings.ts`: `useAppSettings()` или
    `useAppSettings(s => s.sidebar.visible.focus)`; `setAppSettings(patch)` → причина отказа или
    `undefined`; `acceptAppSettings`, `refreshAppSettings`.
- **Поведение хранилища.** Изменение, которое ничего не меняет, файл не пишет, событие не шлёт и
  `revision` не растит. `revision` пишется в файл и продолжается после перезапуска. Файл старой
  версии без части полей берёт для них значения по умолчанию (не откладывается); поле не того типа
  делает файл нечитаемым — он откладывается как `app-settings.json.unreadable-<время>`. Ошибка
  ввода-вывода при чтении (нет прав, на месте файла папка) — значения по умолчанию и
  предупреждение в лог; запись, которая не удалась, состояние в памяти не меняет.
- **Решено без владельца, подтвердить:** (1) пустое изменение — без записи и без роста `revision`,
  как у `link/settings.json`; (2) файл без части полей читается со значениями по умолчанию, а не
  откладывается целиком; (3) без моста preload `useAppSettings` молчит (без `console.error`), чтобы
  unit-test-ы компонентов Ticket-ов 02–05 и 10 не шумели.
- **Проверки:** `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0, «зелено».
  CI PR #207 (`check`) — зелёный.
- **Gate full — зелёный с четвёртого прогона.** `GATE_SCOPE=all` gate full под замком
  `/tmp/worfy-e2e.lock`. Первые три прогона (commit a5987b1, до rebase) — exit 2, каждый раз один
  упавший test, все три разные, и ни один не касается настроек:
  1. 02:29 (нагрузка машины около 18, четыре посторонних процесса `yes`): `test` — unit
     `test/unit/epic-layout.test.ts` «keeps every open Ticket in place over many random Epics»,
     timeout 5 s; `test:e2e` и `test:package` прошли. Отдельно тот же файл — 33 из 33 за 1.5 s.
  2. 02:49: `test:e2e` — `test/e2e/edges.spec.ts:166` (`strokeWidth` пустой вместо `1px`), 180 из
     181; остальное прошло. Этот test известен как нестабильный; на той же сборке
     `--repeat-each 5` — 4 из 5.
  3. 03:09: `test:e2e` — `test/e2e/binding.spec.ts:272` (после hover не появилась линия Binding),
     180 из 181; остальное прошло. Отдельно `--repeat-each 4` — 4 из 4.
  4. 03:53, после rebase на `origin/main` ae7a930 (commit 685bfe6): exit 0, «[gate] зелено (full):
     lint typecheck test test:e2e test:package». Следующий commit ветки меняет только этот файл.
- Mutation testing: восемь мутантов (слияние `collapsed`, рост `revision`, `clampScale` в `set`,
  пропуск пустого изменения, подписка IPC-модуля на `changed`, пометка `project` у `appSettings.set`,
  проверка ревизии в renderer, проверка моста) — каждый краснит свой test.
- **Добавлено по ревью (только test-ы).** Id секции: случаи «нечитаемый файл» и отказ
  `appSettings.set` теперь падают именно из-за id — значение `true`, id `bad id!`, `_x`, `../x`,
  101 символ. `>=` в renderer закреплён ответом `appSettings.get` с ревизией 0 и масштабом не по
  умолчанию. «Создание хранилища и импорт `src/main/ipc/app-settings.ts` не читают диск» —
  счётчик `readFileSync` из `node:fs`. Четыре мутанта красные: id как `z.string().min(1)`, id с
  ведущим `_`, `>` вместо `>=`, чтение файла в конструкторе.
- **Ключ `__proto__` в `collapsed`** zod отбрасывает сам, до шаблона id: вызов с ним ничего не
  меняет и события не шлёт, файл с ним читается как без него (не откладывается). Закреплено
  test-ом; комментарий у `sectionIdSchema` приписывает это шаблону — неточность, не дефект.
- **Долги (low, из ревью, не блокируют):**
  - ошибка ввода-вывода при первом чтении (нет прав, на месте файла папка) даёт значения по
    умолчанию, и следующая запись ложится поверх файла, который не удалось прочитать; надёжнее
    отложить его перед первой записью, как нечитаемый — образец обращения с такой ошибкой
    `src/main/link/settings.ts:38-43`;
  - читатели `sidebar.collapsed` (Ticket-ы 04 и 05) берут значение через `Object.hasOwn`, а не
    `collapsed[id]`: запись — обычный объект, и id вроде `constructor` иначе найдётся в прототипе.
- UI нет, снимков нет.
