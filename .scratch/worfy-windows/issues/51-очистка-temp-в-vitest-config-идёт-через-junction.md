# 51 — Очистка старых папок `%TEMP%` в `vitest.config.ts` и в `glob-probe.tsx` идёт через junction и опустошает папку за ним

Type: task
Status: done 2026-10-16
PR: #389
Blocked by: —
Source: Session на Windows-ПК «Worfy тесты на ПК», ночь 2026-10-16: опыт с поддельной старой папкой `worfy-glob-probe-zzexp` (ниже); вопрос возник при разборе Ticket-а [52](52-из-node_modules-соседних-worktree-пропадают-пакеты.md). Код перечитан на Mac по main `9974e0e0`.

## Что происходит

- **Очистка при старте vitest.** `vitest.config.ts` при каждой загрузке проходит по системной
  временной папке (`:29-38`). Папку с именем `worfy-glob-probe-*` или `worfy-contract-claude-homes-*`
  старше часа он удаляет через `rmSync(path, { recursive: true, force: true })` (`:34`). Комментарий
  `:24-28` объясняет: такие папки оставляет убитый прогон, папка моложе часа может принадлежать
  прогону в другом checkout-е. `%TEMP%` один на всех: очистка в одном worktree удаляет старые папки
  всех worktree-ов клона.
- **Откуда папки.** `worfy-glob-probe-*` строит `globProbe()` в `test/unit/glob-probe.tsx` (`:59`):
  копия модуля и symlink-и на всё остальное в корне репозитория (`:67-71`), кроме `.git` (`:69`), —
  в том числе на `node_modules`. `worfy-contract-claude-homes-*` делает
  `test/global-setup-contract.ts` (`:19`, `:22`) и сам удаляет через `removeTestTree` (`:24`).
- **`glob-probe.tsx` тоже удаляет через `rmSync`:** при ошибке сборки (`:76`) и в `remove()`
  (`:81`); сигнатура для `rmSync` — `:26`.
- **Под Node из Electron на Windows `rmSync` с `recursive` идёт через junction** (link на папку в
  NTFS) и опустошает папку за ним. Это замер Ticket-а
  [23](23-рекурсивное-удаление-не-идёт-через-junction.md); итог записан в комментарии
  `src/main/storage/remove.ts:5-13`. Поэтому test-ы удаляют через `removeTestTree`
  (`test/remove.ts:16`), а тот — через `removeTree` приложения (`src/main/storage/remove.ts:293`):
  link удаляется как link.
- **Опыт на ПК (2026-10-16).** Поддельная старая папка `%TEMP%\worfy-glob-probe-zzexp` (mtime на
  два часа назад), в ней junction и dir symlink, каждый на свою одноразовую папку. Затем
  `pnpm test test/unit/contrast.test.ts` — exit 0. После прогона: `worfy-glob-probe-zzexp` нет;
  папка за junction пуста; папка за dir symlink цела.
- **Почему test-ы этого не ловят.** `test/unit/no-rmsync.test.ts` ищет `rmSync` по тексту в `test/`
  (`:148-162`), `src/` (`:200-202`) и `scripts/` (`:206-208`). `vitest.config.ts` лежит в корне
  репозитория, ни в одну из этих папок не входит. `glob-probe.tsx` пропущен явно (`:157-161`), с
  обоснованием в комментарии `:154-156`: «папка держит копии и symlink-и, junction-ов нет». Для своей
  папки это верно. Но очистка в `vitest.config.ts` удаляет любую старую папку с этим префиксом —
  чужую, поддельную, оставленную другой версией кода — и что в ней лежит, не проверяет.
- **Почему `glob-probe.tsx` не зовёт helper.** Файл проверяется типами без типов Node
  (`tsconfig.test.web.json`) и грузит `node:fs` через вычисляемое имя модуля (`:15-18`, `:31`).
  Импорт `test/remove.ts` напрямую его typecheck не пропустит.

## Что делаем

1. **Сначала падающие test-ы.**
   - Test на поведение. Старая папка с префиксом `worfy-glob-probe-` (mtime на два часа назад),
     внутри — link на папку вне её с файлом. На Windows link — junction; на macOS и Linux — dir
     symlink, чтобы test шёл на всех системах. После очистки папки нет, файл за link-ом на месте.
     Для этого очистку вынести из тела `vitest.config.ts` в функцию с параметрами (папка, время
     «сейчас», порог), которую конфиг зовёт, а test зовёт на своей временной папке. Настоящий
     `%TEMP%` test не трогает.
   - Test на текст. `no-rmsync.test.ts` проверяет и файлы конфигурации в корне репозитория
     (`vitest.config.ts` и соседние `*.config.ts`). Пропуск `glob-probe.tsx` (`:157-161`) убирается.
2. **`vitest.config.ts`** удаляет через `removeTree` из `src/main/storage/remove.ts`. Модуль
   импортирует только `node:fs` и `node:path` (`:84-85`), конфиг грузится под Node — импорт
   возможен. Другой вариант — `removeTestTree` из `test/remove.ts`. Выбор — в «Итог».
3. **`glob-probe.tsx`** удаляет через ту же функцию. Например, грузит `test/remove.ts` тем же
   вычисляемым импортом, что `node:fs` (`:31`), и даёт ему в описании интерфейса одну сигнатуру.
   Другой вариант — функция удаления приходит параметром от вызывающего test-а. Выбор — в «Итог».
4. **Комментарии** у `vitest.config.ts:24-28` и в `no-rmsync.test.ts:154-156` переписать: почему
   очистка идёт через `removeTree`.

## Готово, когда

- [ ] Test на поведение: link в старой папке удалён как link, файл за ним на месте — на Mac (dir
      symlink) и на Windows-ПК (junction).
- [ ] На Windows-ПК этот test красный до правки (папка за junction пуста) и зелёный после. Вывод
      обоих прогонов — в «Итог». Это проверяет Session на Windows-ПК.
- [ ] Test на текст красный до правки на любой системе: он находит `rmSync` в `vitest.config.ts` и
      в `glob-probe.tsx`. После правки — зелёный, пропусков в нём нет.
- [ ] Опыт из «Что происходит» на ПК повторён после правки: папка `worfy-glob-probe-zzexp` удалена,
      цели junction и dir symlink целы.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac; `gate full` зелёный; Linux CI
      зелёный; ручной job «Windows tests» без новых по имени падений против main.

## Тесты

- Unit: функция очистки на временной папке — старая папка с link-ом удалена, link-цель цела; папка
  моложе порога осталась; папка с чужим префиксом осталась.
- Unit: `no-rmsync.test.ts` — корень репозитория в поиске, пропусков нет.
- Мутант: очистка снова через `rmSync(…, { recursive: true })` — test на текст красный на любой
  системе; на Windows-ПК красный и test на поведение.

## Где в коде

- `vitest.config.ts`
- `test/unit/glob-probe.tsx`
- `test/unit/no-rmsync.test.ts`
- `test/remove.ts`
- `src/main/storage/remove.ts` — только читается: `removeTree` (`:293`).
- `test/global-setup-contract.ts` — только читается: префикс (`:19`).

## Вне скоупа

- Пропажа пакетов из `node_modules` соседних worktree-ов — Ticket
  [52](52-из-node_modules-соседних-worktree-пропадают-пакеты.md). Связь с этой очисткой там —
  кандидат, а не доказанная причина.
- Удаление старых папок `worfy-*` других префиксов, которые test-ы оставили в `%TEMP%`, —
  [Ticket 26](26-test-ы-на-windows-оставляют-папки-в-temp.md) и [Ticket 14](14-gate-full-на-windows.md).

## Итог

Сделано Session на Windows-ПК 2026-10-16, ветка `worfy-windows/51` от main `ed820a5`. Цифры ниже
— с Windows-ПК; пункты «на Mac», Linux CI и job «Windows tests» проверяет Session на Mac.

- **Очистка — функции в новом `test/stale-leftovers.ts`.** `removeStaleProbes(dir)` (файлы
  `ZzVitestProbe*` в `src/`) и `removeStaleTempFolders(tempDir, now, staleAfterMs)` (папки
  `worfy-glob-probe-*` и `worfy-contract-claude-homes-*` старше часа). `vitest.config.ts` зовёт обе
  до `defineConfig`; test зовёт их на своей временной папке, настоящий `%TEMP%` не трогает.
- **Выбор для пункта 2: `removeTree` из `src/main/storage/remove.ts`, импорт напрямую.** Не
  `removeTestTree`: `test/remove.ts` ещё грузит Layout store (`saveLayoutNow`), и Vite сделал бы
  каждый модуль за ним файлом конфига — 17 файлов `src/`, правка любого перезапускала бы vitest в
  watch mode. Это замер review (`vite.loadConfigFromFile`). Сам модуль удаления импортирует только
  `node:fs` и `node:path`.
- **Выбор для пункта 3: вычисляемый импорт.** `glob-probe.tsx` грузит `test/remove.ts` так же, как
  `node:fs`: `import(['..', 'remove'].join('/'))`, с одной сигнатурой `removeTestTree`. Vite решает
  относительный путь от URL файла, на любой системе. Ошибка импорта случается до `mkdtempSync`:
  `globProbe` падает, в `%TEMP%` ничего не остаётся. Сигнатура `rmSync` из описания `Fs` убрана.
- **Сверх тикета: `electron.vite.config.ts`.** Поиск по файлам конфигурации в корне нашёл в нём
  `rmSync(target, { recursive: true, force: true })` — удаление старой копии `out/harness` при сборке.
  Пропусков в поиске нет, поэтому и там `removeTree`. Вне Windows это тот же вызов `rmSync` после
  проверки на смонтированный том. `electron-vite build` дважды — exit 0, второй удалил старую копию
  (файл-метка в `out/harness` пропал), версия в `plugin.json` записана.
- **`no-rmsync.test.ts`:** пропуск `glob-probe.tsx` убран, ожидание — `[]`. Новый test: файлы
  `*.config.*` в корне — по правилу `src/` (никакого `rmSync`); список файлов сравнивается целиком.
- **`tsconfig.node.json` и `tsconfig.test.node.json`** перечисляют `test/stale-leftovers.ts`:
  без этого `tsc` — TS6307.
- **Числа:**

  | Проверка | До правки | После |
  |---|---|---|
  | Test на текст (`no-rmsync`) с `vitest.config.ts`, `glob-probe.tsx`, `electron.vite.config.ts` с main | exit 1: 3 строки `glob-probe.tsx`, 5 строк в двух конфигах | exit 0 |
  | Test на поведение (junction в старой папке) с очисткой через `rmSync(…, { recursive: true })` | exit 1: `expected [] to deeply equal [ 'keep.txt' ]` — папка за junction пуста | exit 0 |
  | Опыт с `%TEMP%\worfy-glob-probe-zzexp` (junction и dir symlink), `pnpm test test/unit/contrast.test.ts` | — | exit 0; папки нет; за junction и за dir symlink по `keep.txt` |

  - Test на поведение на ветке — функцией, с мутантом — тот же test с `rmSync` в функции: старой
    функции на main нет.
  - Test на поведение на Mac с dir symlink верен, но там не отличает правку от старого кода:
    `rmSync` в Node вне Windows по symlink-у не идёт. Красный он только на Windows.
  - **Мутанты, все — exit 1:** `catch` бросает дальше; порог 90 мин и 2 мин; префикс через
    `includes`; префикс шире (`worfy-contract-claude-`); `ZzVitestProbe` через `includes`; два
    регулярных выражения для имён конфигов уже; конфиг не зовёт очистку `%TEMP%`.
  - **`pnpm test` на ветке (до merge main):** exit 1, 466 failed, 4867 passed, 84 skipped —
    падения Windows, как на main. Сравнение по имени test-а с прогоном main `524abb3` на том же
    ПК: 22 test-а падают только на ветке, почти все — timeout. Повтор их десяти файлов отдельно:
    осталось два.
    - `canvas.test.tsx` «maps each kind to its component…» — timeout 5 с. Отдельно на ветке
      38 из 38; на main `ed820a5` отдельно — тот же timeout. Flaky, не от правки.
    - `startup-failure.test.ts` — 11 падений и на ветке, и на main `ed820a5`, те же имена, два
      прогона на каждой стороне.
  - **После merge `origin/main` (`c53f8a8`):** install, `pnpm lint`, `pnpm typecheck` — exit 0;
    `stale-leftovers`, `no-rmsync`, test-ы `glob-probe` (`canvas`, `session-rail-discovery`,
    `shell-discovery`) и `e2e-no-spawn-on-load` — 94 из 94.
- **Merge.** PR #389 влит 2026-10-16, squash `0aa5fc05`. Проверки Session на Mac:
  - `gate full` на head `6e36f981` (база `c53f8a86`) — exit 0, `[gate] зелено (full)`: lint,
    typecheck, test, test:e2e, test:package. test:package собирал через новый
    `electron.vite.config.ts`.
  - Linux CI — зелёный с первого прогона.
  - Review на Mac (correctness, medium): находок нет.
