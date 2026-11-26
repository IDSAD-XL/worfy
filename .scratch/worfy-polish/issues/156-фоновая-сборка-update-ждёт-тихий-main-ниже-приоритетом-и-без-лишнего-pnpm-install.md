# 156 — Фоновая сборка Update ждёт тихий `main`, идёт с пониженным приоритетом и не ставит зависимости зря

Type: bug
Status: claimed 2026-11-26T02:14Z
Blocked by: —
Source: баг-репорт владельца #2252 (2026-11-26), часть 2.

Кто: агент.

## Что происходит

Issue #2252: на Windows Stable copy, пока `main` часто двигается, собирает Update в фоне: `git fetch`,
`git clean -fdx -e node_modules`, `pnpm install --frozen-lockfile`, `pnpm package` (electron-vite build и
electron-builder). Сборка держит CPU около 2 минут, и рабочий стол подтормаживает.

Что есть в коде (origin/main 296dc5c4c):

- Проверка Update — через 10 s после старта, потом раз в час (`FIRST_CHECK_MS`, `CHECK_EVERY_MS`,
  `src/main/update/check.ts`). Цикл 6 минут из issue — другая работа (часть 1, Ticket 155), не проверка Update.
  Сборка в 03:41 совпала с часовой проверкой: worfy стартовал около 02:41.
- После каждой проверки «Update automatically» (по умолчанию включено) сразу запускает сборку новой головы
  `main` с зелёным `ci-ok` (`autoBuildFor`, `src/main/update/auto.ts`; `UpdateService.autoBuild`,
  `src/main/ipc/update.ts`). На активном репозитории почти каждая часовая проверка находит новую голову —
  сборка около 2 минут в час.
- Каждая сборка запускает `pnpm install --frozen-lockfile`, даже когда `package.json` и `pnpm-lock.yaml`
  не менялись (`UpdateBuilder.build`, `src/main/update/build.ts`).
- Шаги сборки идут с обычным приоритетом процесса.

## Что строить

1. **Ждать тихий `main`.** «Update automatically» собирает голову `main`, только когда её commit не моложе
   N минут. Моложе — worfy ставит одну повторную проверку на момент, когда commit-у исполнится N минут.
   Новый commit за это время сдвигает ожидание, а не запускает вторую сборку. Время commit-а — из того же
   ответа GitHub о ветке `main`, лишнего запроса нет. Время неизвестно — собирается сразу, как раньше.
   «Update worfy» (явное действие) собирает сразу, без ожидания.
2. **Пониженный приоритет.** Каждый шаг сборки идёт с приоритетом ниже обычного: на macOS и Linux — nice 10
   (`os.setPriority` на pid шага; дети шага наследуют nice). На Windows — `BELOW_NORMAL`: worfy на время
   `spawn` понижает свой класс приоритета и сразу возвращает прежний, так шаг рождается с `BELOW_NORMAL`
   без гонки с `cmd.exe`, а его дети наследуют класс. Сбой понижения пишется в `build.log` и сборку не
   останавливает.
3. **Без лишнего `pnpm install`.** После успешной сборки в state Update пишется hash файлов, от которых
   зависит `pnpm install`. Следующая сборка пропускает `pnpm install`, если hash тот же и `node_modules`
   на месте. Перед настоящим `pnpm install` запись снимается, чтобы прерванная установка не считалась
   готовой. `git clean -fdx -e node_modules` остаётся.
4. Переключатель «Build updates in the background» не нужен: его Off уже есть — «Update automatically»
   выключенный собирает только по «Update worfy» (`autoBuildFor`, ADR-0089 пункт 5).

## Где в коде

- `src/main/update/github.ts` — время commit-а головы `main` из ответа о ветке.
- `src/main/update/check.ts` — время commit-а в Available update.
- `src/main/update/auto.ts` — сколько ждать тихого `main`, N и его переопределение.
- `src/main/ipc/update.ts` — таймер повторной проверки в `UpdateService`.
- `src/main/update/build.ts` — приоритет шагов, пропуск `pnpm install`, hash.
- `src/shared/ipc/update.ts` — новые необязательные поля state.
- Test-ы: `test/contract/update-build.test.ts`, `test/unit/update-check.test.ts`, `test/contract/update-github.test.ts`,
  `test/contract/update-state.test.ts`, fake-клиенты GitHub в `test/unit/update-restart-not-taken.test.ts`,
  `test/unit/version-number.test.ts`, `test/unit/version-number-main.test.ts`.
- `docs/features/updates.md`.

## Решено без владельца

- **N = 20 минут.** Переопределяется переменной окружения `WORFY_UPDATE_QUIET_MINUTES` (целое число минут, `0` —
  без ожидания), как остальные настройки Update (`WORFY_UPDATE_API`, `WORFY_UPDATE_REPO`, `WORFY_UPDATE_BUILD`).
  20 минут — больше обычного времени `ci-ok` на `main` (около 15 минут), так что голова с зелёным `ci-ok`
  обычно ждёт недолго, а серия merge-ей подряд собирается один раз в конце.
- **Время commit-а — committer date из GitHub**, а не момент, когда worfy увидел голову: при старте старая
  голова собирается сразу. Время в будущем (часы GitHub и машины разошлись) ждёт не больше N.
- **«Check now» тоже ждёт тихий `main`**, если сборку запускает «Update automatically»: явная сборка —
  «Update worfy».
- **Приоритет понижается у всех шагов сборки**, и у `git fetch` и `git clean` тоже: правило одно, а сетевой
  шаг от него не замедляется заметно.
- **Hash — sha256 от `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` и
  `scripts/postinstall.mjs`** (отсутствующий файл тоже входит в hash): `pnpm install` читает первые четыре,
  а postinstall пересобирает `node-pty`. Hash пишется только после успешной сборки (`ready`).
- **Новое поле state `dependencies`** — необязательное, с `.catch(undefined)`: worfy без этого Ticket-а
  его просто отбрасывает при чтении (zod убирает лишние поля), а при первой своей записи стирает — и тогда
  следующая сборка ставит зависимости заново. Испорченное значение не делает весь state нечитаемым.

## Test-ы

- `autoBuildFor` / ожидание: commit моложе N — ждать остаток; старше или время неизвестно — 0; время в будущем — не больше N.
- `UpdateService`: молодая голова — сборки нет, повторная проверка через остаток; новая голова за это время —
  ожидание сдвигается, сборка одна; явное «Update worfy» — сразу; stop снимает таймер.
- GitHub-клиент читает время commit-а головы; ответ без него — голова без времени.
- Сборка: вторая сборка с теми же `package.json` и lockfile не запускает `pnpm install`; изменённый lockfile
  или удалённый `node_modules` — запускает; hash в state после `ready`, снят перед `pnpm install`.
- Приоритет: через seam `spawn` и `setPriority` — на macOS/Linux nice ребёнка после spawn, на Windows свой
  класс понижен на время spawn и возвращён, и при исключении spawn тоже.
- Каждый test красный до правки.

## Готово, когда

- [ ] «Update automatically» собирает голову `main` только когда её commit не моложе 20 минут (или `WORFY_UPDATE_QUIET_MINUTES`); новый commit сдвигает ожидание; «Update worfy» собирает сразу.
- [ ] Шаги сборки идут с приоритетом ниже обычного на macOS, Linux и Windows; test через seam.
- [ ] `pnpm install` пропускается, когда hash зависимостей тот же и `node_modules` на месте; `git clean` остаётся.
- [ ] `docs/features/updates.md` описывает ожидание, приоритет и пропуск `pnpm install`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` на head PR.
