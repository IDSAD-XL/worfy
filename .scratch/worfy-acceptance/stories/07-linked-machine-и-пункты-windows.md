# Code story — worfy-acceptance 07: Acceptance на Linked machine и пункты Windows: Read only смотрит, Full access решает, сборка ПК из `hello.build`

Kind: pr · Epic: worfy-acceptance · Ticket: 07 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 05 вид Acceptance показывал очередь Project-ов своей Machine. Каналы `acceptance.get` и
`actions.ownerCheck` уже шли по связи по своим меткам, но вид не знал ни платформы, ни сборки Linked machine: решение
из окна на ПК уходило с платформой Mac и `sha` `-`, а пункт `needs: windows` на Mac не говорил, какая сборка стоит
на ПК и подключён ли он. Старая worfy на той Machine давала сырой отказ «not open to Linked machines».

- Требование: [Что происходит](../issues/07-linked-machine-и-пункты-windows.md#что-происходит)

## 2. `hello` называет платформу

Code: `src/main/link/messages.ts:86-91` · key lines: 91

```ts
    /**
     * The platform this Machine runs on (worfy-acceptance ticket 07): the Acceptance view of a Mac shows the build of
     * the PC for an item checked on Windows. Absent from a build before it; a build before it drops the field. A value
     * this build does not know is dropped too, so the rest of the `hello` still counts.
     */
    platform: z.enum(LINK_PLATFORMS).optional().catch(undefined),
```

- Что делает: необязательное поле `platform` (`mac`, `windows`, `linux` — слова строки `owner-check`) в `hello`
  каждого соединения; `sendHello` кладёт туда платформу процесса. Незнакомое значение (`.catch(undefined)`)
  отбрасывается, остальной `hello` остаётся.
- Почему здесь: Ticket называет `src/main/link/messages.ts` и `hello.build`; платформы в `hello` не было, а без неё
  Mac не отличит ПК от другой Linked machine.
- Без него: «PC build» показать нельзя — неизвестно, какая из Machine ПК.
- Требование: [Что делаем, п. 3 и 4](../issues/07-linked-machine-и-пункты-windows.md#что-делаем)
- Риски и пробелы test-ов: старая сборка поле не шлёт; её приёмник отбрасывает лишний ключ (`z.object` без
  `strict`). Обмен со сборкой до Ticket-а test не гоняет: в contract test обе стороны новые.

## 3. Сервис связи держит сказанное в `hello` на соединение

Code: `src/main/link/service.ts:899-910` · key lines: 905, 909

```ts
        if (frame.name === helloMessage.name) {
          // Each `hello` on a connection replaces what it accepts; one without `accepts` names nothing.
          const hello = helloMessage.schema.safeParse(frame.payload)
          if (hello.success) {
            this.accepted.set(connection, new Set(hello.data.accepts ?? []))
            const { build, platform } = hello.data
            this.announcedBy.set(connection, platform === undefined ? { build } : { build, platform })
          }
        }
        await this.messages.dispatch(frame.name, frame.payload, { machineId: connection.machineId }, this.warn)
        if (frame.name === helloMessage.name && this.announcedBy.has(connection)) this.emit('hello', { id: connection.machineId })
        return
```

- Что делает: сборка и платформа из последнего `hello` лежат в `WeakMap` по соединению и уходят вместе с ним;
  событие `hello` будит `RemoteCalls`, и `linked.state` отдаёт окнам `build` и `platform` соединения, по которому
  идут вызовы.
- Почему здесь: рядом с `accepted` (ADR-0079) — тот же разбор того же кадра; почему не в файле Linked machines — не
  записано, кроме того, что сборка нужна только пока соединение открыто.
- Без него: `RemoteCalls.machines()` не знает сборки B — красный test «`needs: windows` on the Mac…».
- Требование: [Что делаем, п. 3](../issues/07-linked-machine-и-пункты-windows.md#что-делаем)
- Риски и пробелы test-ов: два соединения к одной Machine — берётся `hello` текущего; test-а на смену текущего
  соединения с разными `hello` нет.

## 4. Строка сборки пункта другой платформы

Code: `src/shared/acceptance/linked-build.ts:59-71` · key lines: 62, 64, 68, 69

```ts
export function linkedBuildLine(needsPlatform: string, here: OwnerCheckPlatform, windowMachine: string | null, machines: readonly BuildMachine[]): LinkedBuildLine | null {
  if (!isPlatform(needsPlatform)) return null
  const shown = machines.find((machine) => machine.id === windowMachine)
  if (needsPlatform === here && shown?.platform !== needsPlatform) return null
  const machine = machineOf(needsPlatform, windowMachine, machines)
  if (machine !== undefined) return { state: 'online', text: `${platformLabel(needsPlatform)} build: ${machine.build} (${machine.name})`, machineId: machine.id }
  // A worfy before ticket 07: its `hello` came (the build is known) without a platform. Only the window's Machine could be
  // the one meant — its queue holds the item; any other such Machine may as well be a Mac, and a Machine whose `hello`
  // has not come yet says nothing.
  const old = shown !== undefined && shown.online && shown.build !== undefined && shown.platform === undefined ? shown : undefined
  if (old !== undefined) return { state: 'old', text: `Update worfy on ${old.name}: it does not say its platform`, machineId: old.id }
  return { state: 'not-connected', text: `${platformLabel(needsPlatform)} not connected`, machineId: null }
}
```

- Что делает: для `needs:` другой платформы, чем у этой Machine, — «PC build: <build> (<name>)», пока Linked machine
  этой платформы в сети и её `hello` пришёл (сначала Machine окна); иначе «PC not connected». «Update worfy on <name>» —
  только когда Machine окна назвала в `hello` сборку без платформы: другая такая Machine может оказаться Mac-ом.
  Пункт своей платформы строки не получает.
- Почему здесь: чистая функция в `src/shared/acceptance/`, как `queue.ts`, чтобы contract test проверил её над ответом
  настоящего `RemoteCalls`; место файла Ticket не называет.
- Без него: Mac не показывает, где и на какой сборке проверять пункт Windows.
- Требование: [Что делаем, п. 4 и 5](../issues/07-linked-machine-и-пункты-windows.md#что-делаем)
- Риски и пробелы test-ов: при двух ПК без окна на одном из них берётся первый в списке; правило выбора не записано в
  spec, решено без владельца.

## 5. «Checked in» на Linked machine: её платформа и commit её сборки

Code: `src/renderer/acceptance/AcceptanceView.tsx:214-222` · key lines: 218, 219, 220

```tsx
  // The commit of the copy: on a Linked machine's platform the commit of its build (its `hello`, worfy-acceptance ticket
  // 07), which wins; else, in a window of this Machine, known for its Stable copy, the one the Stable copy line reads
  // (main's snapshot), with its version when this window is that copy. In a window on a Linked machine the snapshot's
  // `stableCommit` is that Machine's, so a decision on this Machine's platform names none.
  const linked = linkedCommit(platform, currentPlatform(), shownOn, machines)
  const here = linked === null && shownOn === null && copy === 'stable' && platform === currentPlatform()
  const commit = linked?.sha ?? (here ? (state?.stableCommit ?? null) : null)
  const version = linked?.build ?? (here ? (update?.enabled === true ? (update.current?.version ?? null) : commit?.slice(0, 7) ?? null) : null)
  const where: CheckedIn = { platform, copy, sha: commit !== null && OWNER_CHECK_SHA.test(commit) ? commit : '-' }
```

- Что делает: на платформе Linked machine (Machine окна или подключённой той же платформы) `sha` — commit её сборки
  (`.dirty` — `-`), рядом — сама сборка, и он сильнее `stableCommit` снимка очереди; на платформе этой Machine с
  копией `stable` — `stableCommit` из main, как в Ticket-е 05, но только в окне этой Machine: в окне Linked machine
  снимок и его `stableCommit` — той Machine, и решение на платформе этого компьютера идёт с `-`. Начальная платформа в
  окне Linked machine — её платформа из `hello`.
- Почему здесь: spec, «Платформа, копия и commit строки»: «`sha` — … сборка Linked machine из `hello.build`».
- Без него: решение из окна ПК уходит с `mac` и `-`, и строка `owner-check` называет не ту Machine.
- Требование: [Что делаем, п. 2 и 3](../issues/07-linked-machine-и-пункты-windows.md#что-делаем)
- Риски и пробелы test-ов: commit берётся при любой копии — какая копия работает на ПК, по связи не известно.

## 6. Как проверено

- `pnpm test test/contract/acceptance-linked.test.ts` — exit 0 (до правки main — exit 1 на test-е «`needs: windows`
  on the Mac…»). Test-ы Read only и Full access этого файла зелёные и на старом коде: они охраняют путь каналов
  Ticket-ов 01–03, а не доказывают 07.
- `pnpm test test/unit/acceptance-view.test.tsx test/unit/acceptance-linked-build.test.ts` — exit 0 (вид до правки —
  exit 1, 4 test-а).
- `pnpm test:e2e test/e2e/linked-acceptance.spec.ts test/e2e/acceptance.spec.ts test/e2e/linked-read-only.spec.ts` —
  exit 0 (`linked-acceptance` на виде до правки — exit 1).
- `pnpm lint`, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему вид в окне Mac на ПК не показывает кнопку Update worfy у пункта Update first?
   - Ответ: строка Stable copy пришла от ПК и говорит о его копии; кнопка обновила бы эту Machine, поэтому вместо неё —
     «Update worfy on <name>».
   - Строки: `src/renderer/acceptance/AcceptanceView.tsx:168-171`
2. Откуда Mac знает, что подключённая Linked machine — ПК, и что он покажет, если она этого не говорит?
   - Ответ: из поля `platform` её `hello`, которое сервис хранит на соединение. Без поля «Update worfy on <name>» —
     только для Machine окна; в окне этой Machine строка «PC not connected».
   - Строки: `src/shared/acceptance/linked-build.ts:68-70`
