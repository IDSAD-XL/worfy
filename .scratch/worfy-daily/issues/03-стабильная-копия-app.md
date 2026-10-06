# 03 — Стабильная копия worfy.app вне репозитория

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), тема A, риски 5 и 6; [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) — папка данных worfy; Ticket 32 worfy-mvp (сборка `.app`)

## Что делаем

Autopilot над самим worfy нельзя вести из сборки, которую агенты в это же время переписывают. Сейчас
`pnpm package` (`electron-vite build && electron-builder --mac dir`) кладёт `.app` в `dist/`, и
следующая сборка его заменит. Детали `electron-builder.yml`: output `dist/`, target `dir`, identity
`'-'` (ad-hoc), `notarize: false`. Нужна копия вне репозитория, которая меняется только по явной
команде.

**Скрипт `scripts/install-stable.sh`** и команда `pnpm install:stable` в `package.json`:

- Собирает `.app` и копирует `dist/mac*/worfy.app` в `~/Applications/worfy-stable.app`. Путь можно
  передать аргументом.
- Отказывает с кодом ≠ 0 и понятным текстом, если копия сейчас запущена.
- Пишет рядом с копией файл с commit-ом и временем сборки, например
  `~/Applications/worfy-stable.json`. Внутрь `.app` после копирования ничего не пишется: это сломало
  бы подпись.

**Папка данных.** Копия и dev-запуск (`pnpm dev`) сейчас делят
`~/Library/Application Support/worfy`: `src/main/storage/paths.ts:10-13`, `userData` переставлен
туда же в `src/main/index.ts:15`. Одновременный запуск двух процессов портит `limits.json` и
`bindings.json`. Решение принимает ADR (номер с 0022). Варианты:

- (а) dev-запуск (`app.isPackaged === false`) берёт отдельную папку, например `worfy-dev`;
- (б) `app.requestSingleInstanceLock()` — lock по `userData`, и тогда dev не запустится, пока
  работает копия;
- (в) оба.

e2e это не затрагивает: у них `WORFY_DATA_DIR` во временной папке.

**Раздел «Стабильная копия» в `README.md`:**

- как поставить копию;
- что Autopilot над worfy идёт только на ней;
- когда и в каком порядке её обновлять:
  1. main зелёный — Gate full и CI;
  2. Autopilot на копии остановлен или стоит между Wave-ами;
  3. запущен `pnpm install:stable`;
  4. копия запущена;
  5. системные диалоги новой копии получили ответ до старта Autopilot.

**Права macOS.** Ad-hoc подпись меняется с каждой сборкой, поэтому macOS может заново спросить права
у новой копии: уведомления и другие. Проверяется вживую, список увиденных диалогов идёт в «Итог».

## Готово, когда

- [ ] `pnpm install:stable` кладёт копию в `~/Applications/worfy-stable.app` или в путь из аргумента. Повторный запуск заменяет копию. Если копия запущена — отказ с понятным текстом и кодом ≠ 0.
- [ ] Рядом с копией записаны commit и время сборки.
- [ ] ADR о папке данных копии и dev-запуска принят. Одновременный запуск копии и `pnpm dev` не пишет в одни и те же `limits.json` и `bindings.json` — это проверяет test на `paths.ts` или на single-instance lock, по выбранному варианту.
- [ ] В `README.md` есть раздел «Стабильная копия» с порядком обновления.
- [ ] e2e `@packaged` запускает копию, которую скрипт положил во временную папку. Путь передаётся через env.
- [ ] (вручную) Копия запущена из Finder, открыт Project worfy. Через computer use снят экран после старта: системных диалогов нет, или они перечислены в «Итог».

## Тесты

- `test/unit/paths.test.ts` — папка данных packaged- и dev-запуска по принятому ADR.
- `test/e2e/packaged.spec.ts` — `@packaged`: путь к `.app` из env, а не только `dist/mac*/worfy.app` (`:14-31`).
- Сначала падающий test: копия и dev-запуск получают одну папку данных (или оба берут lock) — test по принятому ADR, красный на нынешнем коде.

## Где в коде

- `scripts/install-stable.sh` (новый)
- `package.json`
- `src/main/storage/paths.ts`
- `src/main/index.ts`
- `README.md`
- `test/unit/paths.test.ts`
- `test/e2e/packaged.spec.ts`
