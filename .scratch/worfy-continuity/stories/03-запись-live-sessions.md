# Code story — worfy-continuity 03: `live-sessions.json`: запись Session-ов с turn-ом или очередью

Kind: pr · Epic: worfy-continuity · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

Session, которую запустил worfy, кончается вместе с приложением: на `will-quit` registry закрывает все Session-ы, а
очередь сообщений не переживает свою Session. После перезапуска worfy не знает, какие Session-ы были в turn-е и что
лежало в их очередях, и продолжить их нечем.

- Требование: [Что происходит](../issues/03-запись-live-sessions.md#что-происходит)

## 2. Запись идёт через временный файл и rename

Code: `src/main/agent/live-sessions.ts:97-108` · key lines: 100, 102, 103, 105

```ts
export async function writeAtomically(fs: LiveSessionsFs, file: string, text: string): Promise<void> {
  const dir = dirname(file)
  await fs.mkdir(dir)
  const temporary = join(dir, `.${LIVE_SESSIONS_FILE}.${process.pid}.${temporaryCounter++}.tmp`)
  try {
    await fs.writeFile(temporary, text)
    await fs.rename(temporary, file)
  } catch (error) {
    await fs.rm(temporary).catch(() => undefined)
    throw error
  }
}
```

- Что делает: текст ложится во временный файл в той же папке, затем rename ставит его на место `live-sessions.json`;
  при ошибке временный файл удаляется.
- Почему здесь: Ticket требует атомарную запись (временный файл и rename) в новом модуле
  `src/main/agent/live-sessions.ts`. Почему запись асинхронная, а не через синхронный `writeJsonFile`
  (`src/main/storage/json-file.ts`): файл пишется на каждое изменение turn-а и очереди, а синхронная запись держала бы
  main process; бриф Ticket-а называет запись асинхронной.
- Без него: падение посреди записи оставляет половину JSON, и reader при старте не читает ни одной записи.
- Требование: [Что делаем, пункт 3](../issues/03-запись-live-sessions.md#что-делаем)
- Риски и пробелы test-ов: падение процесса между `writeFile` и `rename` оставляет временный файл; его никто не убирает
  при следующем старте. Test «crash mid-write» имитирует падение ошибкой `writeFile`, а не смертью процесса.

## 3. Одна запись Project-а за раз, последняя — самая новая

Code: `src/main/agent/live-sessions.ts:280-312` · key lines: 286, 294, 300, 302, 303, 304

```ts
  private schedule(projectId: string): void {
    if (this.stopped) return
    const slot = this.slots.get(projectId) ?? { wanted: null, written: null, writing: null }
    this.slots.set(projectId, slot)
    const sessions = this.records(projectId)
    // The file of the run before stays until this run has a record to write there.
    if (sessions.length === 0 && slot.wanted === null) return
    const file: LiveSessionsFile = { version: LIVE_SESSIONS_VERSION, sessions }
    const parsed = liveSessionsFileSchema.safeParse(file)
    if (!parsed.success) {
      console.warn(`[agent] ${LIVE_SESSIONS_FILE} of ${projectId} not written: the records do not match its format`, parsed.error)
      return
    }
    slot.wanted = `${JSON.stringify(parsed.data, null, 2)}\n`
    slot.writing ??= this.drain(projectId, slot)
  }

  /** Writes what the Project's file should hold until it holds it; one write at a time. */
  private async drain(projectId: string, slot: Slot): Promise<void> {
    // Never settles before `slot.writing` is set, even when the folder cannot be found.
    await Promise.resolve()
    try {
      while (slot.wanted !== null && slot.wanted !== slot.written) {
        const text = slot.wanted
        await writeAtomically(this.fs, join(this.deps.dirOf(projectId), LIVE_SESSIONS_FILE), text)
        slot.written = text
      }
    } catch (error) {
      // The next change tries again.
      console.warn(`[agent] ${LIVE_SESSIONS_FILE} of ${projectId} could not be written`, error)
    } finally {
      slot.writing = null
    }
```

- Что делает: каждое изменение ставит в `wanted` полный текст файла; запись идёт, только если другой записи этого
  Project-а нет, и после неё цикл пишет ещё раз, если за это время `wanted` изменился. Пока у Session-ов этого запуска
  не было ни одной записи, файл прошлого запуска не трогается.
- Почему здесь: Ticket требует писать на каждое изменение; две записи подряд с rename могут закончиться в обратном
  порядке, и файл остался бы со старым состоянием. Файл прошлого запуска нужен старту (Ticket 05) — это следует из
  спецификации («Продолжение Session»), а не записано в Ticket-е 03.
- Без него: десять изменений очереди за одну запись дают десять одновременных записей, и победит не обязательно
  последняя; первый же переход Orchestrator-а в `idle` при старте стёр бы записи прошлого запуска до того, как их
  прочтут.
- Требование: [Что делаем, пункт 3](../issues/03-запись-live-sessions.md#что-делаем)
- Риски и пробелы test-ов: после неудачной записи следующая попытка будет только при следующем изменении; Ticket 05
  должен прочесть файл до того, как Session этого запуска получит первую запись.

## 4. Запись привязана к Node, а не к id Session

Code: `src/main/agent/live-sessions.ts:175-192` · key lines: 176, 178, 188, 190

```ts
  private own(given: string | null, owner: Owner): void {
    const sessionId = given === null ? null : this.current(given)
    const before = this.nodeSessions.get(owner.nodeId)
    if (before !== undefined && before !== sessionId) this.owners.delete(before)
    if (sessionId === null) this.nodeSessions.delete(owner.nodeId)
    else {
      this.nodeSessions.set(owner.nodeId, sessionId)
      this.owners.set(sessionId, owner)
    }
    this.schedule(owner.projectId)
  }

  /** The id the Session known as `sessionId` has now, after its renames. */
  private current(sessionId: string): string {
    let id = sessionId
    for (let next = this.renamed.get(id); next !== undefined; next = this.renamed.get(id)) id = next
    return id
  }
```

- Что делает: view Orchestrator-а или Session Node говорит, на каком Node работает Session; id из view, который Session
  уже сменила (`renamed`), читается как её новый id.
- Почему здесь: Session, запущенная с `resume`, живёт под временным `pending-…` id до первого init (бриф и шапка
  `src/main/agent/session.ts`); view, опубликованный до rename, может прийти после него.
- Без него: опоздавший view со старым id отвязал бы Node от Session, и запись Session в turn-е пропала бы из файла.
- Требование: [Что делаем, пункт 2](../issues/03-запись-live-sessions.md#что-делаем)
- Риски и пробелы test-ов: view-ы приходят через три точки подключения вне списка файлов Ticket-а
  (`app-orchestrators.ts`, `app-node-sessions.ts`, `ipc/autopilot.ts`); сами эти строки подключения test-ом не
  проверены, проверен только наблюдатель, который они кормят.

## 5. Выход останавливает запись раньше, чем закрываются Session-ы

Code: `src/main/agent/app-registry.ts:94-97` · key lines: 95, 96

```ts
    app.on('will-quit', () => {
      live.stop()
      registry.closeAll()
    })
```

- Что делает: на выходе наблюдатель перестаёт писать, и только потом registry закрывает Session-ы.
- Почему здесь: Ticket называет `src/main/agent/app-registry.ts` местом подключения наблюдателя; registry закрывает
  Session-ы именно здесь.
- Без него: события `closed` при выходе убрали бы все записи, и после выхода или Update файл был бы пуст — продолжать
  было бы нечего.
- Требование: [Что делаем, пункт 3](../issues/03-запись-live-sessions.md#что-делаем)
- Риски и пробелы test-ов: порядок внутри `will-quit` test-ом на `app.on` не проверен; contract test проверяет тот же
  порядок вызовов `stop` и `closeAll` на настоящем registry.

## 6. Что сознательно не меняли

- `src/main/agent/session.ts`: вложения очереди наружу не выходят, поэтому запись берёт их из текста сообщения
  (`attachmentLines`): пути файлов и имена картинок. Байтов и sha картинок в записи нет.
- Binding в файл не копируется (ADR-0002).
- Русский перевод `docs/features/ru/storage-and-diagnostics.md` — Ticket 14.

## 7. Как проверено

- `pnpm test test/unit/live-sessions.test.ts test/contract/live-sessions.test.ts` — exit 0 (17 и 5 test-ов).
- Мутанты наблюдателя (12 штук: без очереди записей, запись прямо в файл, временный файл остаётся при ошибке, rename не
  отслеживается, опоздавший view не переводится, файл прошлого запуска стирается сразу, Run без проверки unattended,
  held теряется, запись не уходит, каждое событие пишет файл, `closed` не убирает запись, ввод не считается) — на
  каждом краснеет хотя бы один test.
- `pnpm lint`, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему файл не пишется, пока у Session-ов этого запуска нет ни одной записи?
   - Строки: `src/main/agent/live-sessions.ts:286`
   - Ответ: иначе первое же событие Orchestrator-а при старте записало бы пустой список поверх записей прошлого запуска,
     которые должен прочесть старт.
2. Что случится, если убрать `??=` и запускать `drain` на каждое изменение?
   - Строки: `src/main/agent/live-sessions.ts:294`
   - Ответ: несколько записей одного файла пойдут одновременно, и rename более старой может прийти последним — файл
     останется со старым состоянием.
3. Почему запись хранится по Node, а не по id Session?
   - Строки: `src/main/agent/live-sessions.ts:176`
   - Ответ: Session, запущенная с `resume`, меняет временный `pending-…` id на id SDK при первом init; Node при этом
     остаётся тем же.
