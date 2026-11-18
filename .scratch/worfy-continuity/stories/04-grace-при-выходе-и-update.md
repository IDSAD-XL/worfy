# Code story — worfy-continuity 04: Grace при выходе и при Update: координатор выхода, окно «Quitting worfy», `run-suspended`

Kind: pr · Epic: worfy-continuity · Ticket: 04 · PR: - · Language: ru

## 1. Что было не так

Выход вели независимые обработчики. `before-quit` Autopilot-а останавливал каждый Run с `app-quit` и ждал не дольше 3 с,
`will-quit` закрывал Session-ы. Run после выхода считался остановленным, а не прерванным. `git push` или `gh pr merge`
без результата обрывался на полпути. Выключение системы worfy не замечал, а "Restart now" у Update шёл мимо всего этого.

- Требование: [Что происходит](../issues/04-grace-при-выходе-и-update.md#что-происходит)

## 2. Один координатор ведёт выход по шагам

Code: `src/main/quit-grace.ts:210-236` · key lines: 213, 217, 222, 229, 235

```ts
  private async steps(): Promise<void> {
    this.stage = 'grace'
    try {
      this.deps.depart()
    } catch (error) {
      console.error('[quit] could not stop sending', error)
    }
    if (!this.shutdownNow) await this.grace()
    if (!this.shutdownNow) {
      this.stage = 'halting'
      if (this.viewValue !== null) this.setView({ ...this.viewValue, stage: 'stopping', leftMs: 0 })
      try {
        await this.deps.halt()
      } catch (error) {
        console.error('[quit] could not stop the agents', error)
      }
    }
    this.stage = 'recording'
    try {
      await this.deps.record(this.cause)
    } catch (error) {
      console.error('[quit] could not write the records of the quit', error)
    }
    if (this.viewValue !== null) this.setView(null)
    this.stage = 'released'
    this.deps.quit()
  }
```

- Что делает: четыре шага по порядку: «уходим» (`depart`), ожидание внешних вызовов (`grace`), прерывание turn-ов и выход процессов (`halt`), записи `run-suspended` (`record`); затем `quit()` повторяет `app.quit()`, и `beforeQuit` его уже не держит. Ошибка шага пишется в лог, следующий шаг всё равно идёт.
- Почему здесь: Ticket называет новый модуль `src/main/quit-grace.ts` и этот порядок шагов (Что делаем, пункт 1). При выключении системы ожидание и halt пропускаются: Ticket, пункт 4, — «пишут записи и выходят без grace».
- Без него: выход снова собирается из независимых обработчиков, и порядок «сначала дождаться push, потом прервать turn, потом записать» никто не держит.
- Требование: [Что делаем, пункт 1](../issues/04-grace-при-выходе-и-update.md#что-делаем)
- Риски и пробелы test-ов: порядок проверен unit test-ом `quit-grace.test.ts` на часах test-а; шаги в приложении подключены в `src/main/index.ts` (`installQuitGrace`), это подключение проверяет только e2e, который локально не запускался (правило владельца: нет локального e2e на этом Mac).

## 3. Ожидание внешних вызовов: 60 с по часам, Quit now, окно

Code: `src/main/quit-grace.ts:237-267` · key lines: 240, 242, 263, 264

```ts

  /** Step 2: waits while calls without a result are left, graceMs at most or until Quit now; the window meanwhile. */
  private grace(): Promise<void> {
    if (this.deps.calls.open().length === 0) return Promise.resolve()
    return new Promise((done) => {
      const until = this.clock.now() + (this.deps.graceMs ?? GRACE_MS)
      let unobserve: () => void = () => undefined
      const finish = (): void => {
        if (this.endWait !== finish) return
        this.endWait = null
        unobserve()
        this.clock.clearTimeout(timer)
        done()
      }
      const look = (): void => {
        if (this.endWait !== finish) return
        const calls = this.deps.calls.open()
        if (calls.length === 0) return finish()
        this.setView({
          stage: 'waiting',
          calls: calls.slice(0, QUIT_GRACE_CALLS_MAX).map((call) => ({ id: call.toolUseId, description: call.description })),
          total: calls.length,
          leftMs: Math.max(0, Math.round(until - this.clock.now())),
        })
      }
      this.endWait = finish
      const timer = this.clock.setTimeout(finish, Math.max(0, until - this.clock.now()))
      unobserve = this.deps.calls.observe(look)
      look()
    })
  }
```

- Что делает: если у Session-ов нет вызовов верхнего уровня без результата, выход не ждёт и окна нет. Иначе ждёт, пока вызовы не кончатся, но не дольше `GRACE_MS` (60 с) по часам, которые передал вызывающий; Quit now зовёт тот же `finish`. Каждое изменение списка вызовов обновляет окно: вызовы (до 20) и сколько осталось.
- Почему здесь: список вызовов — `externalActions` из `src/shared/agent/continue-plan.ts` (бриф: стык с Ticket-ом 16 — только импорт), он пропускает вызовы Subagent-ов; их подключает Ticket 07. 60 с — из Ticket-а и spec.
- Без него: выход обрывает `git push` или `gh pr merge` на полпути, и после перезапуска неизвестно, дошёл ли он.
- Требование: [Что делаем, пункты 1.2 и 3](../issues/04-grace-при-выходе-и-update.md#что-делаем), [spec](../spec.md#grace-при-выходе-и-при-update-ticket-04)
- Риски и пробелы test-ов: часы — параметр (`QuitClock`), поэтому contract test проверяет предел на `GRACE_MS - 1` и `GRACE_MS` миллисекундах без ожидания по стене. Вызовы Agent/Task/Workflow верхнего уровня `externalActions` тоже считает внешними: foreground Subagent может задержать выход на все 60 с.

## 4. Registry держит очереди и прерывает turn-ы

Code: `src/main/agent/session/registry.ts:165-188` · key lines: 167, 180, 186, 187

```ts
  depart(): void {
    this.departing = true
    for (const session of this.live()) session.hold()
  }

  /**
   * worfy quits (step 3 of quit-grace.ts): every Session's turn is interrupted (Session.halt, `haltTurnMs` at most),
   * then every Session is closed and its processes waited for — EXIT_WAIT_MS, then SIGKILL and KILL_EXIT_MS more
   * (Session.exited, ADR-0064). Settles once they have exited, or were given up on; never rejects.
   */
  async haltAll(haltTurnMs?: number): Promise<void> {
    const sessions = this.live()
    await Promise.all(
      sessions.map(async (session) => {
        try {
          await session.halt(haltTurnMs)
        } catch (error) {
          console.warn(`[agent] could not halt ${session.id} on quit`, error)
        }
      }),
    )
    for (const session of sessions) session.close()
    await Promise.all(sessions.map((session) => session.exited()))
  }
```

- Что делает: `depart` ставит каждую Session, и ту, что стартует позже, в `hold()`: новое сообщение ждёт в очереди, конец turn-а ничего из неё не шлёт, а turn-ы под ногами идут дальше. `haltAll` прерывает turn каждой Session, закрывает её и ждёт выхода процессов: `exited()` — 7,5 с, затем SIGKILL и ещё 2 с (ADR-0064).
- Почему здесь: Ticket, пункт 1.1: «registry не шлёт новых сообщений, очереди держатся». Пауза очереди (`pause`) не подошла: она попала бы в `live-sessions.json` (Ticket 03) как `held`, а после выхода очередь должна продолжиться как была. Поэтому `hold()` — новый метод `src/main/agent/session.ts`, хотя бриф называл этот файл только для чтения.
- Без него: сообщение, отправленное во время ожидания, ушло бы в turn, который через секунды будет прерван; без `await exited()` записи и `app.quit()` шли бы раньше, чем упрямый процесс получил SIGKILL.
- Требование: [Что делаем, пункты 1.1 и 1.3](../issues/04-grace-при-выходе-и-update.md#что-делаем)
- Риски и пробелы test-ов: мутанты проверены: `haltAll` без `await exited()`, `hold()` без действия, `next()` без проверки `holding` (конец turn-а после `depart` отправил бы сообщение из очереди) и `session.halt(0)` вместо `haltTurnMs` (Session закрылась бы, не дождавшись прерванного turn-а) — красные test-ы в `quit-grace.test.ts`; два последних — на fake timers, с управляемым handle агента. Halt в приложении ждёт turn 2 с (`QUIT_HALT_TURN_MS`), а не 15 с Stop-а; почему именно 2 с — не записано в Ticket-е, это выбор реализации (короткий выход e2e и Update).

## 5. Run пишет `run-suspended` вместо `run-stopped`

Code: `src/main/autopilot/run.ts:1972-1995` · key lines: 1974, 1981, 1982, 1985

```ts
  async recordQuit(cause: SuspendCause): Promise<void> {
    this.quitting = true
    await Promise.all([...[...this.runs.values()].filter((run) => run.running).map((run) => this.suspendEnd(run, cause)), ...[...this.lingering].map((quit) => quit())])
  }

  private async suspendEnd(run: Run, cause: SuspendCause): Promise<void> {
    if (run.sealed) return
    this.suspend(run)
    const { wave, tickets } = this.waveInWork(run)
    await this.write(run, { kind: 'run-suspended', cause, wave, tickets, wait: run.suspendedWait })
    run.sealed = true
    this.leaveWait(run)
    // No give-back: the Orchestrator closed with every Session, and a start after the quit continues the run.
    await this.release(run, false)
    this.noteDuration(run, null)
    run.stoppedAt = Date.now()
    run.done = true
    if (this.runs.get(run.projectId) === run) this.runs.delete(run.projectId)
    this.last.set(run.projectId, this.snapshot(run))
    this.publish(run.projectId)
    run.finish()
  }

  /**
```

- Что делает: каждый работающий Run пишет последней строкой Journal-а `run-suspended` с причиной, своей Wave, её Ticket-ами в работе и ожиданием (`limits`, `retry`, `budget` или `start-window` с `until`), затем запечатывается (`sealed`: больше ни одной строки) и уходит из приложения без возврата Ticket-ов. Run, который уже остановлен и ждёт фоновые задачи, пишет здесь `tasks-killed` только после выключения системы: обычный выход пишет его раньше, до halt (следующий шаг).
- Почему здесь: Ticket, пункты 1.4 и 2: Run не останавливается, а приостанавливается, и новый выход `app-quit` не пишет. `tasks-killed` для таких Run-ов — решение брифа (ADR-0029 без поправки).
- Без него: Run после выхода выглядит законченным (`run-stopped`), и Ticket 06 не сможет продолжить его с той же Wave.
- Требование: [Что делаем, пункты 1.4 и 2](../issues/04-grace-при-выходе-и-update.md#что-делаем)
- Риски и пробелы test-ов: `stopAll` с `app-quit` остался для test-ов; приложение его больше не зовёт. Recovery invariant И4 теперь считает `run-stopped` `app-quit` нарушением, поэтому test, который вызовет `stopAll` и затем `checkRecovery`, покраснеет.

## 6. Фоновые задачи остановленного Run-а пишутся убитыми до halt

Code: `src/main/quit-grace.ts:300-314` · key lines: 305, 313

```ts
    halt: async () => {
      const { registry, live, autopilot, haltTurnMs } = parts()
      // Before any Session closes: a stopped Run would read its Session's close as given back, not killed. A failure
      // here does not keep the Sessions from being halted.
      try {
        await autopilot?.recordKilled()
      } catch (error) {
        console.error('[quit] could not journal the background tasks as killed', error)
      }
      if (live !== null && live !== undefined) {
        live.stop()
        await live.settled()
      }
      await registry?.haltAll(haltTurnMs)
    },
```

- Что делает: перед тем как закрыть Session-ы, шаг halt просит Autopilot записать `tasks-killed` (`app-quit`) для каждого уже остановленного Run-а, который ещё ждёт фоновые задачи своего Orchestrator-а, с задачами, живыми в этот момент, и отпустить keep-awake (`Autopilot.recordKilled`). Ошибка записи не мешает halt.
- Почему здесь: Run, который ждёт фоновые задачи, сам следит за своей Session и закрытие Session-и читает как возврат Orchestrator-а: в первом раунде настоящий порядок выхода (`suspendAll` → `haltAll` → `recordQuit`) писал `orchestrator-returned`, а `tasks-killed` из ADR-0029 не писался никогда, хотя `docs/features/autopilot-faults.md` это обещает (находка ревью). Запись в шаге halt, а не в `depart`: за 60 с ожидания задача может закончиться сама, и Journal не должен назвать её убитой.
- Без него: в Journal-е выход выглядит так, будто Orchestrator вернули человеку с живыми задачами, хотя приложение их убило; keep-awake отпускается тем же путём, но запись неверна.
- Требование: [Что делаем, пункт 1.4](../issues/04-grace-при-выходе-и-update.md#что-делаем)
- Риски и пробелы test-ов: два contract test-а в `test/contract/autopilot-background.test.ts` идут настоящей цепочкой `quitSteps` (depart → halt → record) над настоящими registry и Autopilot: остановленный Run с живыми задачами и Session, отданная человеку с задачами. Мутант без вызова `recordKilled` — оба красные. После выключения системы halt нет, и задачи пишет `recordQuit`, как раньше.

## 7. Выключение системы: по платформе

Code: `src/main/quit-grace.ts:338-350` · key lines: 339, 341, 345, 346

```ts
export function followShutdown(sources: ShutdownSources, shutdown: () => void): void {
  if (sources.platform === 'win32') {
    sources.windows.on('browser-window-created', (_event, window) => {
      window.on('session-end', () => shutdown())
    })
    return
  }
  sources.power.on('shutdown', (event) => {
    event?.preventDefault()
    shutdown()
  })
}

```

- Что делает: на Windows слушает `session-end` каждого окна, на macOS и Linux — `powerMonitor` `shutdown` с `preventDefault`, который просит у системы время на записи. Оба зовут `shutdown()` координатора: записи с причиной `shutdown`, без ожидания и halt.
- Почему здесь: Ticket, пункт 4, и платформенное правило ADR-0056, пункт 2: обе ветки проверены unit test-ом с подменённой платформой.
- Без него: выключение системы убивает worfy без записи, и Run выглядит упавшим (`crash`), а не прерванным выключением.
- Требование: [Что делаем, пункт 4](../issues/04-grace-при-выходе-и-update.md#что-делаем)
- Риски и пробелы test-ов: реальное выключение системы не проверялось; `session-end` проверит только job Windows в CI на head PR.

## 8. "Restart now" у Update идёт через тот же координатор

Code: `src/main/ipc/update.ts:369-373` · key lines: 371, 372

```ts
export function quitForUpdate(): void {
  const grace = appQuitGrace()
  if (grace === null) app.quit()
  else void grace.leave('update')
}
```

- Что делает: выход для Update зовёт координатор с причиной `update`; без координатора (ещё не создан) — прежний `app.quit()`.
- Почему здесь: Ticket, пункт 5. `src/main/update/restart.ts` не менялся: он уже принимает функцию выхода.
- Без него: Run, прерванный Update-ом, записался бы с причиной `quit`, и Ticket 08 не отличил бы его от выхода человека.
- Требование: [Что делаем, пункт 5](../issues/04-grace-при-выходе-и-update.md#что-делаем)
- Риски и пробелы test-ов: `test/unit/update-quit.test.ts` проверяет, что выход идёт в координатор с `update` и не зовёт `app.quit()` (мутанты `leave('quit')` и `app.quit()` — красные). Что `Restarts` получает именно `quitForUpdate` (строка `quit:` в `appUpdate()`), test не проверяет. swap-helper ждёт выхода worfy две минуты; 60 с ожидания плюс halt в них укладываются, но test-а на это нет.

## 9. Что сознательно не меняли

- `src/shared/agent/continue-plan.ts` и вызовы Subagent-ов — Ticket-ы 16 и 07.
- ADR-0029 и тип `app-quit`: тип остался для старых Journal-ов.
- `docs/features/updates.md`: «Then worfy quits» по-прежнему верно. Русский перевод страниц — Ticket 14.

## 10. Как проверено

- `node scripts/vitest-electron.mjs test/unit/quit-grace.test.ts` — exit 0 (15 test-ов), `test/unit/quitting-dialog.test.tsx` — exit 0 (4).
- `test/contract/autopilot-faults-quit.test.ts` и invariants — exit 0.
- Мутанты: `haltAll` без ожидания выхода процессов, ожидание, которое сразу кончается, `hold()` без действия, окно без
  защиты от старого ответа — на каждом краснеет хотя бы один test.
- 17 файлов test-ов Ticket-а и соседей (unit, contract quit, все Fault scenario-и, wiring main, entry renderer) — exit 0,
  202 test-а.
- `pnpm lint`, `pnpm typecheck` — exit 0. `pnpm test` и `gate fast` на этом Mac красные (exit 1 и 2) на test-ах, которых
  изменение не касается: file watcher-ы (fseventsd под нагрузкой), TMPDIR с пробелом, `safe.bareRepository` из окружения
  сессии. Те же файлы красные и на базе `cfb28389a`.
- Второй раунд: мутанты `next()` без `holding`, `session.halt(0)`, halt без `recordKilled`, `leave('quit')` и `app.quit()` в `quitForUpdate`, `OpenCalls` без state `error` — на каждом краснеет хотя бы один test.
- e2e `test/e2e/autopilot-quit.spec.ts` локально не запускался: правило владельца, его прогонит gate full. Снимки окна в светлой и тёмной теме он сохраняет helper-ом `snapshotThemes` в `test-results/e2e/snapshots/04-quitting-worfy/`, который CI выкладывает как `e2e-snapshots-*`.

## Проверить себя

1. Почему выключение системы не ждёт внешних вызовов?
   - Строки: `src/main/quit-grace.ts:217`
   - Ответ: Ticket (пункт 4) велит при выключении записать и выйти без grace: `shutdownNow` пропускает и ожидание, и halt,
     сразу пишутся записи с причиной `shutdown`, а Session-ы закрываются вместе с приложением.
2. Почему очереди держатся через `hold()`, а не через паузу очереди?
   - Строки: `src/main/agent/session/registry.ts:167`
   - Ответ: пауза попала бы в `live-sessions.json` как `held`, и продолжение после выхода получило бы очередь на паузе,
     которую поставил не человек.
3. Почему `tasks-killed` пишется в начале шага halt, а не в `depart` и не вместе с `run-suspended`?
   - Строки: `src/main/quit-grace.ts:305`, `src/main/quit-grace.ts:313`
   - Ответ: после `haltAll` Session закрыта, и Run, ждущий задачи, прочёл бы закрытие как возврат Orchestrator-а; а в
     `depart` рано — за время ожидания задача может закончиться сама и не должна попасть в убитые.
