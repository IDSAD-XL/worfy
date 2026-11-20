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

Code: `src/shared/autopilot/continuation.ts:43-53` · key lines: 44, 50, 52

```ts
function setAsidePlace(tickets: readonly number[], branches: Readonly<Partial<Record<number, string>>>, mode: ProjectMode): string {
  if (mode === 'silent') return `Run ${tickets.length === 1 ? 'it' : 'them'} from any directory, with no commit: in Silent mode the status goes straight into the Workflow folder.`
  const known = tickets.flatMap((num) => {
    const branch = branches[num]
    return branch === undefined || branch === '' ? [] : [{ num, branch }]
  })
  const one = tickets.length === 1
  const named = known.length === 0 ? '' : ` (${known.map((each) => (one ? `branch ${each.branch}` : `${ticketNumber(each.num)}: branch ${each.branch}`)).join('; ')})`
  const run = one ? "Run it in the Ticket's own worktree" : "Run each in its Ticket's own worktree"
  return `${run}${named} and commit only the Ticket file on its branch: git -C <worktree> commit -m "<message>" -- <ticket file>. A Ticket with no worktree gets the block on the main branch the way the documents PR carries statuses, never by a direct commit to main.`
}
```

- Что делает: строит предложение о месте, которое `setAsideText` ставит между командами `ticket block` и «Then end the
  turn.». Full mode: worktree Ticket-а, commit на его ветке только с файлом Ticket-а; Ticket без worktree — main branch,
  но только так, как статусы несёт docs PR, а не прямым commit-ом в main. Ветки известных Ticket-ов идут в скобках
  (`(branch demo/01)`, для нескольких — `(05: branch …; 07: branch …)`); номер, которого нет среди `tickets`, в текст не
  попадает. Silent mode: файлы Ticket-ов лежат в папке Workflow вне репозитория, поэтому текст говорит запускать команду
  из любой папки и ничего не commit-ить — без worktree, ветки и git.
- Почему здесь: Ticket называет `setAsideText` в `continuation.ts`; слова — из абзаца «Where the owner-stop status is
  written» skill-а epic-wave (worfy-polish 131), включая его пункт про Silent mode.
- Без него: Orchestrator ставит block в своём дереве, и Autopilot тратит turn-ы на Ticket, который уже ждёт владельца; в
  Silent mode текст про worktree отправил бы git commit вне репозитория.
- Требование: [Что делаем, п. 1](../issues/138-autopilot-сообщение-отложи-ticket-называет-ветку-ticket-а.md#что-делаем)
- Риски и пробелы test-ов: путь worktree worfy не знает, поэтому `<worktree>` и `<ticket file>` остаются местами для
  Orchestrator-а. Что он действительно запустит команду в worktree, test не проверяет: фальшивый Orchestrator
  contract test-а пишет block сам.

## 3. Откуда run берёт ветку и mode

Code: `src/main/autopilot/run.ts:2933-2938` · key lines: 2935, 2937, 2938

```ts
    // The worktree branch each Ticket's claim was read from, so the message names where the block goes (worfy-polish 138).
    const branches = Object.fromEntries(
      (await this.freshTickets(run)).flatMap((ticket) => (ticket.epic === run.epic && effect.tickets.includes(ticket.num) && ticket.fromBranch ? [[ticket.num, ticket.fromBranch]] : [])),
    )
    const mode = await this.projectMode(run)
    const text = setAsideText({ epic: run.epic, tickets: effect.tickets, attempts: effect.attempts, cause: effect.cause, branches, mode, ...(tool === undefined ? {} : { ticketTool: tool }) })
```

- Что делает: перед сообщением run читает workflow заново и берёт `fromBranch` откладываемых Ticket-ов своего Epic-а —
  ветку worktree, из которой reader прочёл claim. Чтение, которое не удалось, даёт пустой список: текст тогда описывает
  правило словами. Mode Project-а run берёт из нового dep `projectMode` (в приложении — `readProjectLayout(...).mode`,
  `src/main/ipc/autopilot.ts`); без dep или при ошибке чтения — Full.
- Почему здесь: Ticket называет `run.ts:2905-2916` — вызов `setAsideText`, «откуда брать ветку или worktree Ticket-а».
  Эффект `set-aside` цикла Ticket-ов не несёт: один из путей к нему — таймер settle, без события с Ticket-ами. Модель
  workflow mode не несёт, поэтому он идёт отдельным dep.
- Без него: текст никогда не называет ветку, даже когда claim лежит только в ветке; без фильтра по Epic-у ветка Ticket-а
  с тем же номером из другого Epic-а попала бы в текст.
- Требование: [Что делаем, п. 1](../issues/138-autopilot-сообщение-отложи-ticket-называет-ветку-ticket-а.md#что-делаем)
- Риски и пробелы test-ов: `fromBranch` есть только пока статус ветки перекрывает checkout; claim, уже влитый в main,
  ветки не даёт, и текст говорит правило без скобок. Contract test подменяет `fromBranch` и mode опциями
  `autopilot-faults-setup.ts`, без настоящего worktree и без настоящего Silent Project-а; провод `projectMode` в
  `ipc/autopilot.ts` test-ом не покрыт.

## 4. Что сознательно не меняли

- worfy по-прежнему статус не пишет (ADR-0002): команду запускает Orchestrator.
- Skill epic-wave — правило уже записал worfy-polish 131.

## 5. Как проверено

Unit test-ы `test/unit/autopilot-continuation.test.ts` были красными до правки (раунд 1: 3 failed; раунд 2 вместе с
contract test-ами: 9 failed, exit 1) и зелёные после. Mutant-ы: «место убрано из текста» — 7 test-ов красные;
«run.ts не передаёт `branches`» — scenario 2 `autopilot-faults-ladder.test.ts` красный; «убран фильтр
`ticket.epic === run.epic`» — scenario 2 красный (у Ticket-а 01 второго Epic-а своя ветка `demo-b/01`); «run.ts не
передаёт `mode`» — Silent-сценарий красный. Все 42 файла `test/unit` и `test/contract` `autopilot-*.test.ts` — exit 0;
`pnpm lint`, `pnpm typecheck`, gate fast — exit 0.

## Проверить себя

1. Почему block, записанный в дереве Orchestrator-а, не помогает Autopilot-у?
   - Ответ: worfy читает main branch с веткой Ticket-а поверх; пока block не в main, claim ветки перекрывает его, и
     Ticket остаётся застрявшим. Поэтому текст отправляет block в worktree Ticket-а с commit-ом на его ветке.
   - Строки: `src/shared/autopilot/continuation.ts:43-53`
2. Почему в Silent mode текст не говорит про worktree и commit?
   - Ответ: файлы Ticket-ов там в папке Workflow вне репозитория; `ticket block` из любой папки пишет статус прямо туда, а
     git commit вне репозитория упал бы.
   - Строки: `src/shared/autopilot/continuation.ts:43-53`
3. Когда сообщение не называет ветку Ticket-а?
   - Ответ: когда у Ticket-а своего Epic-а нет `fromBranch` в свежем чтении — claim уже в main, ветки нет или чтение не
     удалось; тогда правило звучит только словами.
   - Строки: `src/main/autopilot/run.ts:2933-2938`

## 6. Что нашёл review и что осталось

> VERIFIED — worfy-polish 138 (the Autopilot «set the Ticket aside» message says where to run `ticket block`), head 4a517c31c4d32601f74753cc0a37e8072e52a4a3
>
> Gate (depth medium, two rounds): verifier (lens: implementer's claims, sonnet) — all six claims CONFIRMED on round 1; reviewer (correctness) — round 1 FIX (one medium, two low), round 2 MERGE, all three FIXED.
>
> - Fix: continuation.ts names `branch <epic>/<NN>` per Ticket when the fresh workflow read knows fromBranch (run.ts, filtered by run.epic), asks for `git -C <worktree> commit … -- <ticket file>`; a Ticket without a worktree gets the block on main only the way the documents PR carries statuses, never by a direct commit. Silent mode (projectMode dep = readProjectLayout(root).mode, wired in ipc/autopilot.ts; failure → Full): «Run it from any directory, with no commit», no worktree/branch/git words — as the skill epic-wave says.
> - Evidence: unit red before (exit 1) / green after (exit 0); round 2 tests 9 failed → 27 passed; mutants re-run by the reviewer: drop the epic filter → scenario 2 red, no mode → Silent scenario 3 red; 42 autopilot-* unit+contract files 1049 passed EXIT=0; lint, typecheck, story-check, evidence-check EXIT=0; gate fast green EXIT=0.
> - Low findings (not tickets): projectMode bypasses the projectLayouts() cache (two extra node processes per set-aside); «from any directory» is literal-loose (ticket finds the profile from cwd; the Orchestrator runs in the Project root); the ipc wiring has no test.
> - worfy has no worktree path in its model (only fromBranch), so `<worktree>` stays a placeholder the Orchestrator fills — meets the ticket («ветку или worktree»).
>
> Decided without the owner (to confirm): branch from fromBranch of a fresh workflow read; unknown mode → Full; helper options fromBranch/silent in autopilot-faults-setup.ts and the ipc/autopilot.ts edit outside «Где в коде»; ru/autopilot-faults.md updated because the brief named it.
