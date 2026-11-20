# Code story — worfy-polish 138: Autopilot: сообщение «отложи Ticket» называет ветку Ticket-а

Kind: pr · Epic: worfy-polish · Ticket: 138 · PR: - · Language: ru

## 1. Что было не так

После 2 continuation-ов Autopilot просит Orchestrator отложить застрявший Ticket командой `ticket block … --waits owner`,
но не говорит, где её запускать. Orchestrator запускал её в своём дереве. worfy читает main branch с веткой каждого
worktree Ticket-а поверх; claim ветки уступает только `blocked`, который уже в main. Поэтому block в дереве
Orchestrator-а остаётся скрыт под claim-ом ветки Ticket-а, пока не вольётся docs PR. Autopilot видел Ticket застрявшим, и
очередь Epic-ов не шла дальше.

- Требование: [Что происходит](../issues/138-autopilot-сообщение-отложи-ticket-называет-ветку-ticket-а.md#что-происходит)

## 2. Текст: где запускать block

Code: `src/shared/autopilot/continuation.ts:41-50` · key lines: 47, 48, 49

```ts
function setAsidePlace(tickets: readonly number[], branches: Readonly<Partial<Record<number, string>>>): string {
  const known = tickets.flatMap((num) => {
    const branch = branches[num]
    return branch === undefined || branch === '' ? [] : [{ num, branch }]
  })
  const one = tickets.length === 1
  const named = known.length === 0 ? '' : ` (${known.map((each) => (one ? `branch ${each.branch}` : `${ticketNumber(each.num)}: branch ${each.branch}`)).join('; ')})`
  const run = one ? "Run it in the Ticket's own worktree" : "Run each in its Ticket's own worktree"
  return `${run}${named} and commit only the Ticket file on its branch: git -C <worktree> commit -m "<message>" -- <ticket file>. A Ticket with no worktree gets the block on the main branch.`
}
```

- Что делает: строит предложение о месте, которое `setAsideText` ставит между командами `ticket block` и «Then end the
  turn.»: worktree Ticket-а, commit на его ветке только с файлом Ticket-а, а Ticket без worktree — main branch. Ветки
  известных Ticket-ов идут в скобках (`(branch demo/01)`, для нескольких — `(05: branch …; 07: branch …)`); номер,
  которого нет среди `tickets`, не попадает в текст.
- Почему здесь: Ticket называет `setAsideText` в `continuation.ts`; слова — из абзаца «Where the owner-stop status is
  written» skill-а epic-wave (worfy-polish 131).
- Без него: Orchestrator ставит block в своём дереве, и Autopilot тратит turn-ы на Ticket, который уже ждёт владельца.
- Требование: [Что делаем, п. 1](../issues/138-autopilot-сообщение-отложи-ticket-называет-ветку-ticket-а.md#что-делаем)
- Риски и пробелы test-ов: путь worktree worfy не знает, поэтому `<worktree>` и `<ticket file>` остаются местами для
  Orchestrator-а. Что он действительно запустит команду в worktree, test не проверяет: фальшивый Orchestrator
  contract test-а пишет block сам.

## 3. Откуда run берёт ветку

Code: `src/main/autopilot/run.ts:2915-2920` · key lines: 2917, 2918, 2920

```ts
    const tool = this.deps.ticketTool?.()
    // The worktree branch each Ticket's claim was read from, so the message names where the block goes (worfy-polish 138).
    const branches = Object.fromEntries(
      (await this.freshTickets(run)).flatMap((ticket) => (ticket.epic === run.epic && effect.tickets.includes(ticket.num) && ticket.fromBranch ? [[ticket.num, ticket.fromBranch]] : [])),
    )
    const text = setAsideText({ epic: run.epic, tickets: effect.tickets, attempts: effect.attempts, cause: effect.cause, branches, ...(tool === undefined ? {} : { ticketTool: tool }) })
```

- Что делает: перед сообщением run читает workflow заново и берёт `fromBranch` откладываемых Ticket-ов своего Epic-а —
  ветку worktree, из которой reader прочёл claim. Чтение, которое не удалось, даёт пустой список: текст тогда описывает
  правило словами.
- Почему здесь: Ticket называет `run.ts:2905-2916` — вызов `setAsideText`, «откуда брать ветку или worktree Ticket-а».
  Эффект `set-aside` цикла Ticket-ов не несёт: один из путей к нему — таймер settle, без события с Ticket-ами.
- Без него: текст никогда не называет ветку, даже когда claim лежит только в ветке.
- Требование: [Что делаем, п. 1](../issues/138-autopilot-сообщение-отложи-ticket-называет-ветку-ticket-а.md#что-делаем)
- Риски и пробелы test-ов: `fromBranch` есть только пока статус ветки перекрывает checkout; claim, уже влитый в main,
  ветки не даёт, и текст говорит правило без скобок. Contract test подменяет `fromBranch` опцией
  `autopilot-faults-setup.ts`, без настоящего worktree.

## 4. Что сознательно не меняли

- worfy по-прежнему статус не пишет (ADR-0002): команду запускает Orchestrator.
- Skill epic-wave — правило уже записал worfy-polish 131.

## 5. Как проверено

Unit test-ы `test/unit/autopilot-continuation.test.ts` были красными до правки (3 failed, exit 1) и зелёные после.
Mutant «место убрано из текста» — 7 test-ов красные (unit, ladder, codex); mutant «run.ts не передаёт `branches`» —
scenario 2 `autopilot-faults-ladder.test.ts` красный. Все 42 файла `test/unit` и `test/contract` `autopilot-*.test.ts` —
exit 0; `pnpm lint`, `pnpm typecheck`, gate fast — exit 0.

## Проверить себя

1. Почему block, записанный в дереве Orchestrator-а, не помогает Autopilot-у?
   - Ответ: worfy читает main branch с веткой Ticket-а поверх; пока block не в main, claim ветки перекрывает его, и
     Ticket остаётся застрявшим. Поэтому текст отправляет block в worktree Ticket-а с commit-ом на его ветке.
   - Строки: `src/shared/autopilot/continuation.ts:41-50`
2. Когда сообщение не называет ветку Ticket-а?
   - Ответ: когда у Ticket-а нет `fromBranch` в свежем чтении — claim уже в main, ветки нет или чтение не удалось; тогда
     правило звучит только словами.
   - Строки: `src/main/autopilot/run.ts:2915-2920`
