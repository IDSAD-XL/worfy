# Code story — worfy-polish 156: Фоновая сборка Update ждёт тихий `main`, идёт с пониженным приоритетом и не ставит зависимости зря

Kind: pr · Epic: worfy-polish · Ticket: 156 · PR: - · Language: ru

## 1. Что было не так

Issue #2252, часть 2: Stable copy на Windows собирала Update в фоне почти после каждой проверки — `git fetch`,
`git clean`, `pnpm install --frozen-lockfile`, `pnpm package` — и держала CPU около 2 минут. Проверка Update идёт раз
в час (`CHECK_EVERY_MS`), а не раз в 6 минут: цикл 6 минут из issue — другая работа (часть 1, Ticket 155). Но на
активном `main` почти каждая часовая проверка находила новую голову и сразу собирала её, каждый раз с `pnpm install`
и с обычным приоритетом процессов.

- Требование: [Что происходит](../issues/156-фоновая-сборка-update-ждёт-тихий-main-ниже-приоритетом-и-без-лишнего-pnpm-install.md#что-происходит)

## 2. Сколько ждать тихий `main`

Code: `src/main/update/auto.ts:63-67` · key lines: 64, 66

```ts
export function quietWaitMs(update: AvailableUpdate, now: Date, quietMs: number): number {
  if (update.committedAt === undefined) return 0
  const age = now.getTime() - Date.parse(update.committedAt)
  return Math.min(quietMs, MAX_TIMER_MS, Math.max(0, quietMs - age))
}
```

- Что делает: остаток ожидания до сборки головы: `quietMs` минус возраст commit-а головы, не меньше 0 и не больше
  `quietMs` и не больше 2^31 − 1 ms (дольше таймер Node не держит: он сработал бы через 1 ms, и проверка пошла бы по
  кругу). Время commit-а — committer date из того же ответа GitHub о ветке `main` (`github.ts`), лишнего запроса нет.
  Время неизвестно — 0, то есть сборка сразу, как до Ticket-а.
- Почему здесь: Ticket называет `auto.ts` в «Где в коде»; там же `autoBuildFor` решает, что собирать само. N = 20 минут
  и переменная `WORFY_UPDATE_QUIET_MINUTES` (не больше суток, `MAX_QUIET_MS`) записаны в «Решено без владельца».
- Без него: каждая проверка, нашедшая новую голову, собирает её сразу, и серия merge-ей даёт серию сборок.
- Требование: [Что строить, п. 1](../issues/156-фоновая-сборка-update-ждёт-тихий-main-ниже-приоритетом-и-без-лишнего-pnpm-install.md#что-строить)
- Риски и пробелы test-ов: часы машины и GitHub могут расходиться; commit «из будущего» ждёт не больше N
  (test `update-build-light`), отставшие часы машины укорачивают ожидание — это не проверяется.

## 3. Повторная проверка вместо немедленной сборки

Code: `src/main/ipc/update.ts:235-254` · key lines: 238, 243, 248, 250

```ts
  private autoBuild(): void {
    const { builder, autoUpdate } = this.options
    if (builder === undefined || autoUpdate === undefined) return
    clearTimeout(this.quietCheck)
    this.quietCheck = undefined
    const target = autoBuildFor(readUpdateState(this.options.stateFile()), autoUpdate())
    if (target === null) return
    const quietMs = this.options.quietMs ?? UPDATE_QUIET_MS
    const wait = quietWaitMs(target, this.options.now?.() ?? new Date(), quietMs)
    if (wait === 0) {
      builder.install(target)
      return
    }
    if (this.stopped) return
    console.info(`[update] main moved less than ${quietMs / 60_000} min ago: ${target.version} is built in ${Math.ceil(wait / 1000)} s, unless main moves again`)
    this.quietCheck = setTimeout(() => {
      this.quietCheck = undefined
      void this.checks.now()
    }, wait)
  }
```

- Что делает: после каждой проверки снимает прежний таймер; голова моложе N не собирается, а ставится одна
  проверка на момент, когда commit-у исполнится N. Та проверка читает голову заново: та же — собирает, новая —
  ждёт снова. Остановка расписания (`start()` → stop) снимает таймер и ставит `stopped`.
- Почему здесь: `autoBuild` — единственное место, где «Update automatically» запускает сборку; «Update worfy»
  (`install()`) идёт мимо него и не ждёт.
- Без него: ожидание пришлось бы держать в builder-е, который не знает о новых головах `main`; новый commit во время
  ожидания не сдвигал бы его.
- Требование: [Что строить, п. 1](../issues/156-фоновая-сборка-update-ждёт-тихий-main-ниже-приоритетом-и-без-лишнего-pnpm-install.md#что-строить)
- Риски и пробелы test-ов: проверка во время ожидания с `ci-ok` pending даёт `available: null` и снимает таймер; тогда
  сборка ждёт следующей часовой проверки. Это задумано (main не тих), отдельного test-а нет.

## 4. Приоритет шагов сборки

Code: `src/main/update/build.ts:165-193` · key lines: 169, 170, 175, 178, 187, 191

```ts
export function spawnBelowNormal(start: () => ChildProcess, priority: BuildPriority, platform: NodeJS.Platform): { child: ChildProcess; problem: string | null } {
  if (platform === 'win32') {
    let before: number
    try {
      before = priority.get()
      priority.set(0, BUILD_PRIORITY)
    } catch (error) {
      return { child: start(), problem: why(error) }
    }
    try {
      return { child: start(), problem: null }
    } finally {
      try {
        priority.set(0, before)
      } catch (error) {
        console.error('[update] the priority of worfy could not be given back after the spawn of a build step', error)
      }
    }
  }
  const child = start()
  if (child.pid === undefined) return { child, problem: null }
  try {
    priority.set(child.pid, BUILD_PRIORITY)
    return { child, problem: null }
  } catch (error) {
    // ESRCH: the step has ended already (a git step can, before this call), and takes no CPU any more.
    return { child, problem: (error as { info?: { code?: unknown } } | null)?.info?.code === 'ESRCH' ? null : why(error) }
  }
}
```

- Что делает: на macOS и Linux сразу после `spawn` ставит шагу `PRIORITY_BELOW_NORMAL` (nice 10); дети шага наследуют
  nice. На Windows worfy на время `spawn` понижает свой класс до `BELOW_NORMAL` и возвращает прежний: процесс,
  созданный процессом класса `BELOW_NORMAL`, получает этот класс, так что `cmd.exe` для `pnpm.cmd` и всё, что он
  запускает, рождаются пониженными. Сбой понижения — строка в `build.log`, шаг идёт; `ESRCH` (шаг уже закончился) строки не даёт.
- Почему здесь: все шаги сборки идут через `step()` этого файла; `start` — seam, через который test-ы подменяют
  `spawn`, а `priority` — вызовы `node:os`. Понижать и `git` тоже — решение из «Решено без владельца».
- Без него: `pnpm install` и electron-builder конкурируют с интерфейсом пользователя на равных.
- Требование: [Что строить, п. 2](../issues/156-фоновая-сборка-update-ждёт-тихий-main-ниже-приоритетом-и-без-лишнего-pnpm-install.md#что-строить)
- Риски и пробелы test-ов: наследование класса на настоящем Windows не проверено — test-ы видят только порядок
  вызовов через fake; на macOS и Linux остаётся теоретическая гонка, если программа шага запустит ребёнка раньше, чем
  вернётся `spawn`.

## 5. `pnpm install` только когда зависимости изменились

Code: `src/main/update/build.ts:412-422` · key lines: 414, 419

```ts
    this.stepTo('install')
    const dependencies = dependencyHash(clone)
    if (readUpdateState(this.options.stateFile()).dependencies?.hash === dependencies && existsSync(join(clone, 'node_modules'))) {
      note('\npnpm install skipped: package.json, pnpm-lock.yaml and the pnpm settings are those of the last build that was ready.')
    } else {
      // node_modules is no longer the one the hash names once the install begins: one that stops
      // half way is installed again by the next build.
      this.keepDependencies(null)
      if (this.stopped || !(await step('pnpm', ['install', '--frozen-lockfile']))) return failed()
    }
    if (this.stopped || !(await this.electronReady(clone, step, note))) return failed()
```

- Что делает: hash `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` и `scripts/postinstall.mjs` после
  checkout-а сравнивается с записанным после последней сборки `ready`; совпал и `node_modules` есть — `pnpm install`
  пропускается. Иначе запись снимается до установки и пишется снова только при `ready`. Проверка Electron
  (`electronReady`) идёт в обоих случаях, `git clean -fdx -e node_modules` перед этим — тоже.
- Почему здесь: Ticket называет `build.ts`; список файлов hash-а — в «Решено без владельца».
- Без него: каждая сборка тратит время и CPU на `pnpm install`, который ничего не меняет.
- Требование: [Что строить, п. 3](../issues/156-фоновая-сборка-update-ждёт-тихий-main-ниже-приоритетом-и-без-лишнего-pnpm-install.md#что-строить)
- Риски и пробелы test-ов: `node_modules`, испорченный вручную при том же hash-е, не переустанавливается — только его
  удаление вызывает установку. Смена версии node или pnpm на машине в hash не входит.

## 6. Новое поле state

Code: `src/shared/ipc/update.ts:118-121` · key lines: 121

```ts
  dependencies: z
    .object({ hash: z.string().regex(/^[0-9a-f]{64}$/u) })
    .optional()
    .catch(undefined),
```

- Что делает: необязательное поле `dependencies` в `update/state.json`. Неверное значение отбрасывается одно, а не
  весь файл. worfy без этого Ticket-а читает файл через свою схему, которая лишнее поле убирает, а его первая запись
  стирает его; следующая сборка тогда ставит зависимости заново.
- Почему здесь: здесь схема всего state Update; брифом велено писать hash в state, который модуль уже пишет.
- Без него: при чтении схема убрала бы поле, и hash не сохранялся бы между сборками.
- Требование: [Решено без владельца](../issues/156-фоновая-сборка-update-ждёт-тихий-main-ниже-приоритетом-и-без-лишнего-pnpm-install.md#решено-без-владельца)
- Риски и пробелы test-ов: чтение файла старой версией worfy проверено рассуждением о схеме zod, а не test-ом против
  старого кода.

## 7. Что сознательно не меняли

Расписание проверок (10 s после старта, потом раз в час), `git clean -fdx -e node_modules` и «Update worfy» — как
были. Отдельный переключатель «Build updates in the background» не добавлен: «Update automatically» выключенный уже
значит «собирать только по нажатию». Интерфейс ожидание не показывает: chip показывает Available update и кнопку
«Update worfy».

## 8. Как проверено

`node scripts/vitest-electron.mjs test/unit/update-build-light.test.ts test/unit/update-check.test.ts
test/contract/update-github.test.ts test/contract/update-state.test.ts test/contract/update-build.test.ts` — до правки
45 красных, после — exit 0 (109 passed). `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (21100 passed); gate
fast — exit 0, green. Настоящих pnpm, сборки, e2e и Electron не запускалось: шаги сборки — stand-in-ы
`test/fixtures/update/`, git — против локального bare-репозитория.

## Проверить себя

1. Почему новый commit во время ожидания не приводит к двум сборкам?
   - Ответ: таймер ведёт к проверке, а не к сборке; проверка снимает прежний таймер и читает голову заново, и новая
     голова моложе N только ставит новый таймер.
   - Строки: `src/main/ipc/update.ts:238-253`
2. Зачем на Windows понижать приоритет самого worfy, а не шага по его pid?
   - Ответ: `pnpm.cmd` идёт через `cmd.exe`, который может запустить node раньше, чем придёт вызов на pid; процесс,
     созданный из класса `BELOW_NORMAL`, сам рождается с ним, гонки нет.
   - Строки: `src/main/update/build.ts:166-183`
3. Почему hash снимается до `pnpm install`, а не после неудачи?
   - Ответ: установка, прерванная выходом worfy или сбоем, оставляет `node_modules` наполовину новым; запись,
     снятая заранее, не даст следующей сборке её пропустить, что бы ни случилось дальше.
   - Строки: `src/main/update/build.ts:416-420`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-polish 156 (the background update build waits for a quiet main, runs below normal priority and skips pnpm install when the dependencies did not change; part 2 of the owner's bug report issue #2252), head e3f5a99fab95a74acec23688184fd1a08b263c2b
>
> Gate (depth medium, two rounds):
> - Round 1, reviewer (lens: correctness) — MERGE with two lows and two test gaps:
>   - the Windows priority path holds: spawn is synchronous and the restore sits in finally, so no JS runs between;
>   - the install skip is safe: the hash is taken after checkout and clean, and is dropped before install and written only on ready;
>   - the state fields are optional both ways.
> - Round 2, checked by the Orchestrator against the diff b078cfb1b..e3f5a99fa:
>   - WORFY_UPDATE_QUIET_MINUTES capped at 24 h and every wait at 2^31−1 ms (no 1 ms timer loop);
>   - ESRCH from setPriority on an already ended step is not logged;
>   - new tests: «Check now» during the wait gives one timer and one build; a change of each hashed file reinstalls. Both mutants of the gaps are now red.
>
> - Evidence: every new test red first; 11 update test files EXIT=0; pnpm lint, typecheck EXIT=0; pnpm test EXIT=0 (round 1, 21 100 tests); gate fast green on 694b2bfd8 (head adds evidence lines); story-check ok.
> - Correction to the issue (by the implementer, checked in src/main/update/check.ts): the update check runs 10 s after start and then hourly, not every 6 minutes; the 6-minute cycle is part 1 (worfy-polish 155).
> - Not verified: on real Windows, whether the BELOW_NORMAL class reaches grandchild processes (Windows CI checks the calls only); a real update build was not run.
> - Noted: the UI does not say that a build waits for a quiet main (Settings shows Available update).
