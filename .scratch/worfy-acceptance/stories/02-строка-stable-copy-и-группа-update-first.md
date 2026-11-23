# Code story — worfy-acceptance 02: Строка Stable copy пункта и группа Update first: есть ли изменение в Stable copy владельца

Kind: pr · Epic: worfy-acceptance · Ticket: 02 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 01 очередь Acceptance знала пункты и группы, но поле `stable` у строки пункта всегда было `null`, а вход
«есть ли изменение в Stable copy» никто не заполнял: группа Update first оставалась пустой. Владелец не видел, есть ли
проверяемое изменение в его Stable copy, пока не откроет её сам.

- Требование: [Что происходит](../issues/02-строка-stable-copy-и-группа-update-first.md#что-происходит)

## 2. Очередь спрашивает строку один раз на Ticket и только для двух групп

Code: `src/shared/acceptance/queue.ts:99-110` · key lines: 100, 102, 109

```ts
      let line: AcceptanceStable | null | undefined
      const stable = (): AcceptanceStable | null => (line === undefined ? (line = options.stable?.(project.projectId, ticket) ?? null) : line)
      for (const item of waiting) {
        const group = groupOf(ticket, item, options.now, stable)
        const row: AcceptanceRow = {
          kind: 'item',
          ticket: ticketOf(project, ticket),
          item,
          prepared,
          sent: options.sent?.(project.projectId, ticket, item) ?? null,
          stable: group === 'ready' || group === 'update' ? stable() : null,
        }
```

- Что делает: строка Stable copy спрашивается лениво: `groupOf` зовёт `stable()` только последним шагом, когда пункт
  уже не Failed, не In work и не Older; ответ `out` ставит пункт в Update first. Ответ запоминается на Ticket, так что
  несколько пунктов одного Ticket-а спрашивают один раз. Строки других групп несут `null`.
- Почему здесь: Ticket требует, чтобы merge commit спрашивался только для групп Ready to check и Update first (п. 5);
  опция `inStable` из Ticket-а 01 стала `stable`, чтобы та же строка попала и в группу, и в снимок. Файл
  `src/shared/acceptance/queue.ts` не назван в следе Ticket-а — это его правка вне следа.
- Без него: gh спрашивался бы и для пунктов In work, Failed и Older — то, от чего предостерегает риск «Лимит gh»
  spec-а; unit test «Update first takes the items…» проверяет список спрошенных Ticket-ов.
- Требование: [Что делаем, п. 4–5](../issues/02-строка-stable-copy-и-группа-update-first.md#что-делаем)
- Риски и пробелы test-ов: пункт, чья строка ещё не пришла (`null`), стоит в Ready to check и переедет в Update first,
  когда придёт ответ `out`.

## 3. Какие merge-и составляют изменение Ticket-а

Code: `src/main/acceptance/stable-line.ts:87-93` · key lines: 88, 91

```ts
function refsOf(ticket: Ticket, tickets: readonly Ticket[]): MergeRef[] {
  if (ticket.pr || merged(ticket)) return [refOf(ticket)]
  return ticket.blockedNums.flatMap((num) => {
    const blocker = tickets.find((each) => each.epic === ticket.epic && each.num === num)
    return blocker !== undefined && merged(blocker) ? [refOf(blocker)] : []
  })
}
```

- Что делает: у Ticket-а со строкой `PR:` или `done` в checkout-е — его собственный PR (по номеру или по ветке
  `branchOfTicket`, как у Stage); у Ticket-а, который ждёт владельца без своего PR, — PR-ы его блокеров, которые уже
  `done`.
- Почему здесь: так требует п. 1 Ticket-а и раздел spec-а «Stable copy пункта».
- Без него: Ticket приёмки (Orchestrator подготовил проверку, своего PR нет) всегда читался бы «not checked».
- Требование: [Что делаем, п. 1](../issues/02-строка-stable-copy-и-группа-update-first.md#что-делаем)
- Риски и пробелы test-ов: Ticket над несколькими репозиториями (поле `prs`) здесь не разбирается: Stable copy есть
  только у Project-а worfy, у которого один репозиторий.

## 4. Строка из того, что уже известно

Code: `src/main/acceptance/stable-line.ts:162-192` · key lines: 163, 165, 175, 182, 189, 191

```ts
  line(project: StableProject, ticket: Ticket): AcceptanceStable | null {
    if (!isWorfyRepo(project.repoUrl)) return mergedLine(ticket)
    const stable = (this.sources.stableCommit ?? stableCopyCommit)()
    if (stable === null || !SHA.test(stable)) return notChecked('no Stable copy found')
    const { root } = project
    let pending = false
    const shas: string[] = []
    for (const ref of refsOf(ticket, project.tickets)) {
      const merge = this.merges.get(`${root}\n${refKey(ref)}`, () => this.askMerge(root, ref))
      if (merge === undefined) pending = true
      else if (merge.kind === 'failed') return notChecked('GitHub did not answer')
      else if (merge.kind === 'merged') shas.push(merge.sha)
    }
    if (pending) return null
    if (shas.length === 0) return notChecked('no merged PR found')
    const facts = shas.map((sha) => ({
      sha,
      ancestry: this.ancestry.get(`${root}\n${sha}\n${stable}`, () => this.askAncestry(root, sha, stable)),
      build: this.builds.get(`${root}\n${sha}`, () => this.askBuild(root, sha)),
    }))
    const running = this.builds.get(`${root}\n${stable}`, () => this.askBuild(root, stable))
    if (running === undefined || facts.some((fact) => fact.ancestry === undefined || fact.build === undefined)) return null
    if (facts.some((fact) => fact.ancestry === 'missing-stable')) return notChecked(`its commit ${short(stable)} is not in this checkout`)
    const missing = facts.find((fact) => fact.ancestry === 'missing-merge')
    if (missing !== undefined) return notChecked(`the merge commit ${short(missing.sha)} is not in this checkout`)
    if (facts.some((fact) => fact.ancestry === 'failed')) return notChecked('git did not answer')
    // The first build with the whole change: the one of its latest merge.
    const since = facts.map((fact) => fact.build!).reduce((a, b) => ((b.number ?? -1) > (a.number ?? -1) ? b : a))
    if (facts.every((fact) => fact.ancestry === 'in')) return lineOf('in', `In your Stable copy ${running.label} — the change is there since ${since.label}`)
    return lineOf('out', `Not in your Stable copy yet: it runs ${running.label}, the change is in ${since.label}`, this.updateFor(since))
  }
```

- Что делает: синхронно собирает строку из сохранённых ответов (merge commit от gh, «предок или нет» и номер версии от
  git) и запускает вопросы, которых ещё нет; пока чего-то нет — `null`, а пришедший ответ зовёт `onChange`, и служба
  считает очередь заново. Project не worfy получает «merged #N» / «not merged» из одной модели, без gh и git.
- Почему здесь: Ticket называет `src/main/acceptance/stable-line.ts`; тексты строк — из п. 3 Ticket-а; «not checked»
  вместо `git fetch` — ADR-0005 и риск «Commit-а Stable copy нет в checkout-е».
- Без него: группа Update first оставалась бы пустой, а снимок ждал бы gh при каждом пересчёте.
- Требование: [Что делаем, п. 2–3](../issues/02-строка-stable-copy-и-группа-update-first.md#что-делаем)
- Риски и пробелы test-ов: major и minor версии берутся из `package.json` того commit-а — решение без владельца; на
  commit-е без `package.json` строка показывает короткий SHA вместо `0.4.N`.

## 5. Один вопрос gh на влитой PR

Code: `src/main/acceptance/stable-line.ts:126-140` · key lines: 128, 133

```ts
  get(key: string, ask: () => Promise<{ value: T; final: boolean }>): T | undefined {
    const kept = this.answers.get(key)
    if ((kept === undefined || kept.until <= this.now()) && !this.asking.has(key)) {
      this.asking.add(key)
      void ask().then(
        ({ value, final }) => {
          this.answers.set(key, { value, until: final ? Infinity : this.now() + RETRY_MS })
          this.asking.delete(key)
          this.onAnswer()
        },
        // Not expected (the asks catch their own failures); the key is asked again next time rather than never.
        () => this.asking.delete(key),
      )
    }
    return kept?.value
```

- Что делает: окончательный ответ (влитой PR с merge commit-ом, «предок»/«не предок», номер версии) хранится до конца
  работы приложения; ответ, который может измениться (PR не влит, commit-а нет в checkout-е, отказ GitHub), — 5 минут
  (`RETRY_MS`), и всё это время строка показывает прежний ответ, пока идёт новый вопрос.
- Почему здесь: spec, «Решения по реализации»: merge commit спрашивается один раз на влитый PR и хранится в памяти;
  риск «Лимит gh».
- Без него: каждый пересчёт очереди (правка Ticket-файла, тик раз в минуту) снова звал бы gh; contract test «asks gh
  once per merged PR» это ловит.
- Требование: [Что делаем, п. 1](../issues/02-строка-stable-copy-и-группа-update-first.md#что-делаем)
- Риски и пробелы test-ов: память не ограничена по размеру: по ключу на PR и на пару commit-ов, что для одного Project-а
  worfy — сотни записей.

## 6. Как проверено

- `pnpm test test/unit/acceptance-stable-line.test.ts test/unit/acceptance-queue.test.ts test/contract/acceptance-stable-copy.test.ts`
  до правки — exit 1, после — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; `gate fast` — exit 0.
- 12 mutant-ов, по одному на поведение (перевёрнутый ответ `merge-base`, Update first по `in`, нет проверки
  отсутствующего commit-а, влитой PR не хранится, обратное сравнение с Available update, точное сравнение адреса
  репозитория, блокеры не `done`, номер версии +1, нет «no Stable copy found», строка во всех группах, отказ хранится
  навсегда, служба не передаёт строку) — все убиты.

## Проверить себя

1. Почему Ticket в работе или пункт Failed никогда не вызывает gh, даже если у Ticket-а есть строка `PR:`?
   - Ответ: `groupOf` зовёт `stable()` только последним шагом, после возврата `failed`, `work` и `older`, а строка
     пункта берёт `stable()` только для групп `ready` и `update`.
   - Строки: `src/shared/acceptance/queue.ts:99-110`
2. Commit Stable copy есть, а merge commit PR — нет в checkout-е владельца. Что увидит владелец, и когда worfy спросит
   снова?
   - Ответ: «Stable copy not checked: the merge commit … is not in this checkout»; ответ `missing-merge` не
     окончательный, его спросят снова через `RETRY_MS`, когда checkout получит commit сам — worfy его не fetch-ит.
   - Строки: `src/main/acceptance/stable-line.ts:162-192`, `src/main/acceptance/stable-line.ts:126-140`
3. Почему в строке `out` указан номер последнего merge, а не первого?
   - Ответ: изменение Ticket-а с несколькими merge-ами целиком есть только в сборке, где есть все они: `since` — сборка
     с наибольшим номером.
   - Строки: `src/main/acceptance/stable-line.ts:162-192`
