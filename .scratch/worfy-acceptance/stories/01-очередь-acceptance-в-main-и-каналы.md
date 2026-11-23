# Code story — worfy-acceptance 01: Очередь Acceptance в main и каналы: правило «ждёт владельца», группы, хранилище «Sent», `acceptance.get` и `acceptance.changed`

Kind: pr · Epic: worfy-acceptance · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Списка «что ждёт владельца по всем Project-ам» не было нигде. Ручной пункт и его состояние уже были в модели
Project-а, а правило «Ticket ждёт владельца» жило только в очереди Autopilot, в функции `ownersOwn`, которая не
экспортировалась. Отправленное решение владельца нигде не помнилось до прихода строки `owner-check`.

- Требование: [Что происходит](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-происходит)

## 2. Одно правило «ждёт владельца» на две очереди

Code: `src/shared/autopilot/epic-queue.ts:41-42` · key lines: 41

```ts
export const ownersOwn = (ticket: Pick<Ticket, 'state'> & Partial<Pick<Ticket, 'waits'>>): boolean =>
  ticket.state === 'none' || (ticket.state === 'blocked' && ticket.waits?.trim().toLowerCase() === 'owner')
```

- Что делает: та же функция очереди Autopilot, теперь экспортированная и с узким типом входа, чтобы очередь
  Acceptance звала её на любом Ticket-е модели.
- Почему здесь: Ticket называет `src/shared/autopilot/epic-queue.ts` в своих файлах и требует общую функцию вместо
  копии.
- Без него: два правила разошлись бы при первой правке одного из них.
- Требование: [Что делаем, п. 1](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: Autopilot считает владельца и Ticket без статуса (`none`); очередь Acceptance берёт только
  `blocked` с `Waits: owner` (`blockedOnOwner` в `src/shared/acceptance/queue.ts`), test «a Ticket with no status is not
  Waits for you».

## 3. Пункт ждёт владельца и его группа

Code: `src/shared/acceptance/queue.ts:62-70` · key lines: 63, 64, 67, 69

```ts
function groupOf(project: QueueProject, ticket: Ticket, item: EvidenceItem, options: QueueOptions): AcceptanceGroupName {
  if (item.state === 'failed') return 'failed'
  if (!merged(ticket) && !blockedOnOwner(ticket)) return 'work'
  if (merged(ticket)) {
    const closed = statusTime(ticket.statusAt)
    if (closed !== null && options.now - closed > OLDER_AFTER_DAYS * DAY_MS) return 'older'
  }
  return options.inStable?.(project.projectId, ticket) === false ? 'update' : 'ready'
}
```

- Что делает: ждущий пункт (ручной, без `[x]`, не `verified`) уходит в Failed, если его последняя строка Evidence —
  `fail`; в In work, если изменение не влито и Ticket сам не ждёт владельца; в Older, если Ticket закрыт больше 14
  дней назад; в Update first, если ответ про Stable copy — «нет»; иначе в Ready to check.
- Почему здесь: Ticket называет `src/shared/acceptance/queue.ts`; порог 14 дней — Q1 spec-а. «Влит» читается из
  модели без gh: модель читается из main-ветки Project-а (ADR-0107), Ticket `done` там и не только в своей ветке.
- Без него: владелец видел бы пункты невлитых Ticket-ов среди готовых к проверке, а 93 октябрьских пункта — вперемешку
  с новыми.
- Требование: [Что делаем, п. 1](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: Ticket, чей PR уже влит, но статус ещё не `done`, стоит в In work до docs PR, который
  отмечает его `done`. Ответ про Stable copy пока не даёт никто: Update first пуста до Ticket-а 02.

## 4. Служба считает очередь только по изменению модели

Code: `src/main/acceptance/service.ts:223-228` · key lines: 224, 227

```ts
      send: () =>
        void this.sources.hub.model(entry.root).then((model) => {
          if (!current() || model === null) return
          entry.model = model
          this.compute()
        }),
```

- Что делает: hub шлёт изменение Ticket-файлов; служба берёт его модель целиком, уже с изменением, и считает очередь
  заново; подписчики получают `acceptance.changed`, только если очередь стала другой.
- Почему здесь: Ticket требует службу поверх workflow hub, как `installWaitsNotifications`, без gh и git.
- Без него: правка Ticket-файла не доходила бы до окна; contract test «an edit of a Ticket file gives
  acceptance.changed» красный (mutant M13).
- Требование: [Что делаем, п. 2](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: подписчик hub-а — `fieldsOnly`: правка, меняющая только текст Ticket-а вне его полей, очередь
  не пересчитывает, и её не нужно пересчитывать.

## 5. «Sent» уходит только с новой строкой того же вердикта

Code: `src/main/acceptance/service.ts:77-82` · key lines: 81

```ts
function settled(model: WorkflowModel, decision: SentDecision): boolean {
  const ticket = model.tickets.find((each) => each.epic === decision.epic && each.num === decision.num)
  if (ticket === undefined) return false
  const item = itemOf(ticket, decision)
  return item === null || !itemWaitsForOwner(item) || ownerLines(item, decision.verdict) > decision.lines
}
```

- Что делает: запись «Sent» помнит, сколько строк `owner-check` с её вердиктом было у пункта при отправке, и уходит,
  когда их стало больше; ещё — когда пункт исчез, переписан или больше не ждёт владельца.
- Почему здесь: правило записано в Ticket-е («запись уходит, когда в checkout-е появилась строка `owner-check` с тем
  же вердиктом»); счёт строк при отправке — решение без владельца: иначе повторный Fail на уже проваленном пункте
  снимался бы старой строкой сразу.
- Без него: отметка «Sent» не уходила бы никогда (mutant M15) или уходила бы от старой строки (mutant M14).
- Требование: [Что делаем, п. 3](../issues/01-очередь-acceptance-в-main-и-каналы.md#что-делаем)
- Риски и пробелы test-ов: Ticket, которого нет в модели, свои записи держит; если Ticket удалён навсегда, запись
  остаётся в файле без вреда.

## 6. Как проверено

`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `node scripts/check-feature-docs.mjs` — exit 0; gate fast — exit
0. Mutants по одному на поведение в копии под `mktemp -d`, каждый красный на своём test-е.

## Проверить себя

1. Почему Ticket `done` только в своей ветке стоит в In work, а не в Ready to check?
   - Ответ: «влит» — это `done` в checkout-е main-ветки; `done` только в ветке значит, что PR ещё не влит, и смотреть
     в Stable copy нечего.
   - Строки: `src/shared/acceptance/queue.ts:64`
2. Владелец второй раз шлёт Fail на пункт, у которого уже есть строка `owner-check fail`. Когда уйдёт «Sent»?
   - Ответ: когда у пункта станет больше строк `owner-check fail`, чем было при отправке, то есть с новой строкой.
   - Строки: `src/main/acceptance/service.ts:81`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-acceptance 01 (the Acceptance queue in main and its channels: the one «waits for the owner» rule, groups, the «Sent» store, acceptance.get and acceptance.changed), head 2c2d4b51b9c1f5cf32b2b3a946c4989b92119b54 (d3a9c671d + the Linked machine contract test made order-independent: Beta's read may end first; checked by the Orchestrator)
>
> Gate (depth medium, two rounds): verifier (lens: implementer's claims, sonnet) — MERGE, claims 1–6 CONFIRMED, 8 of 10 own mutants red, the two survivors sent to round 2; reviewer (correctness) — MERGE with four lows, all sent to round 2; round 2 (6 lows, 30 lines of src) checked by the Orchestrator.
>
> - What it gives: main keeps one Acceptance queue over every Project — manual items without [x] and not verified, grouped Failed / Waits for you / Ready to check / In work / Older (closed more than 14 days ago); «Waits for you» holds only tickets blocked with Waits: owner (the rule ownersOwn is shared with Autopilot's Epic queue); a decision sent from the view is «Sent» until a new owner-check line of the same verdict appears, «Not recorded yet» after 24 h, and survives a restart; acceptance.get / acceptance.changed are read channels with no Project in the request, and a Linked machine gets no rows of Projects kept on this Machine only; the service reads the workflow hub's models and starts no gh.
> - Fixed in round 2: contract test of the Linked machine filter (answer and later changes); the 24 h switch inside a running service on fake timers; the recheck delay capped at 2^31−1 ms (a decision dated 30 days ahead no longer recomputes every ms); a ticket with no status is In work, not Waits for you (spec: only Waits: owner); the 14-day threshold pinned by a literal date; the service asserted to start no gh and no extra epic-status reads.
> - Evidence: new tests red before / green after; 6 touched files 149 tests EXIT=0; verifier: 21 + 27 files (716 + 811 tests) EXIT=0; implementer: pnpm lint, typecheck, test (900 files, 20525 tests) EXIT=0; 20 + 6 mutants each red; gate fast green; check-feature-docs, story-check, evidence-check EXIT=0.
> - Debt (low): scripts/windows-test-list.mjs FORBIDDEN_WORDS refuses any file named «acceptance», so the acceptance tests cannot be named in a manual Windows files run (the full Windows run covers them).
> - Not verified: the outside prerequisite «docs PR of the 2026-11-06 review» is not merged — the owner's 2026-11-06 delegated Stable-copy checks (worfy-week 05, 08–12, 15, 17, 18; worfy-harness 18, 19, 21, 24, 25) still wait; until the Orchestrator checks them through CDP on Mac Stable (needs the owner's Stable restart with a debug port), the queue shows those items too.
>
> Decided without the owner (to confirm): «merged» = the ticket done on the checkout's main branch, no gh; a Sent record remembers how many owner-check lines of its verdict existed when sent (a repeated Fail is not settled by the old line); a Sent record also goes when the item is rewritten or no longer waits; «by Project» order = the Projects list order, as projectPulse; the row's stable field null until ticket 02; a ticket with no status is not in Waits for you (round 2, follows the spec).
