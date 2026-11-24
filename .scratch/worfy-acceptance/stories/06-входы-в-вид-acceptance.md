# Code story — worfy-acceptance 06: Входы в вид Acceptance: секция боковой панели, бейдж rail-а, строка палитры, ручные проверки и уведомление ведут на пункт

Kind: pr · Epic: worfy-acceptance · Ticket: 06 · PR: - · Language: ru

## 1. Что было не так

После Ticket-а 05 вид Acceptance открывался только вкладкой. Строка ручной проверки Command palette вела к Ticket-у, а
клик уведомления «is waiting for you» — на доску Pipeline, даже когда тот же пункт или Ticket ждал владельца в очереди.

- Требование: [Что происходит](../issues/06-входы-в-вид-acceptance.md#что-происходит)

## 2. Одно правило перехода: открыть вид, только если очередь знает строку

Code: `src/renderer/acceptance/open.ts:18-22` · key lines: 19

```ts
export function openAcceptance(target?: { projectId: string; epic: string; num: number; item?: number }): boolean {
  if (target !== undefined && !focusAcceptance(target)) return false
  setView('acceptance')
  return true
}
```

- Что делает: с целью вид открывается, только когда `focusAcceptance` нашёл её строку; иначе ничего не меняется и
  ответ `false` — вызывающий идёт туда, куда шёл раньше.
- Почему здесь: Ticket называет `src/renderer/acceptance/open.ts` среди своих файлов; правило «иначе Ticket, как
  сейчас» и «иначе доску Pipeline» — из «Что делаем», п. 3 и 4.
- Без него: палитра и уведомление переключали бы вид на Acceptance без выбранной строки и теряли старый переход.
- Требование: [Что делаем, п. 3 и 4](../issues/06-входы-в-вид-acceptance.md#что-делаем)
- Риски и пробелы test-ов: пока очередь не прочитана, цель не находится, и палитра ведёт к Ticket-у — это проверяет
  unit test «goes to the Ticket while the queue is not read yet».

## 3. Секция Acceptance и бейдж rail-а

Code: `src/renderer/shell/sidebar/AcceptanceSection.tsx:59-68` · key lines: 62, 64, 66

```tsx
export default function AcceptanceSection() {
  const { state, error, sentHere } = useAcceptance()
  const projectsState = useProjects()
  const projects = projectsInScope(projectsState?.projects ?? [], useSidebarScope((store) => store.scope), activeProject(projectsState)?.id)
  const counts = countsByProject(state, sentHere, projects.map((project) => project.id))
  const ready = counts.reduce((sum, each) => sum + (each.groups.find((group) => group.group === 'ready')?.count ?? 0), 0)
  useEffect(() => {
    setRailBadge('AcceptanceSection', ready > 0 ? { tone: 'working', count: ready, label: badgeLabel(ready) } : undefined)
    return () => setRailBadge('AcceptanceSection', undefined)
  }, [ready])
```

- Что делает: секция читает ту же очередь, что вкладка (`useAcceptance`), и Project-ы переключателя боковой панели;
  считает по Project-у группы Ready to check, Update first, Waits for you, Failed; бейдж rail-а — сумма Ready to check.
  Ready to check не считает пункты с отметкой Sent, а «Not recorded yet» считает снова — общее с вкладкой правило
  `waitsForOwner` (`useAcceptance.ts`).
- Почему здесь: секция — новый файл в `src/renderer/shell/sidebar/`, его находит `import.meta.glob` (`Sidebar.tsx`
  не менялся); образец `PullRequestsSection.tsx` назван в Ticket-е. Почему без In work и Older — not recorded:
  решено без владельца, они свёрнуты и в самом виде.
- Без него: число проверок не видно, пока не открыта вкладка, и нет перехода к пунктам одного Project-а.
- Требование: [Что делаем, п. 1](../issues/06-входы-в-вид-acceptance.md#что-делаем)
- Риски и пробелы test-ов: под одним Project-ом бейдж считает только его, а вкладка — все Project-ы; unit test
  проверяет оба случая, e2e — только «All Projects».

## 4. Строка ручной проверки находит номер пункта

Code: `src/renderer/palette/commands.ts:680-695` · key lines: 682, 685, 692

```ts
    // The manual checks and the manual items of the Evidence are the same items in the same file order: the n-th
    // check is the n-th manual item, whose number the Acceptance queue knows it by. Absent from an older model.
    const manualItems = (ticket.evidence ?? []).filter((item) => item.manual)
    ;(ticket.manualChecks ?? []).forEach((check, index) => {
      if (check.checked) return
      const item = manualItems[index]?.index
      commands.push({
        id: `manual-check:${ref}:${index}`,
        group: 'Manual check',
        title: `${ticket.epic} ${nn(ticket.num)} · ${check.text}`,
        queryOnly: true,
        run: () => {
          if (item !== undefined && openAcceptance({ projectId, epic: ticket.epic, num: ticket.num, item })) return undefined
          return goToNode(projectId, { id: ticketNodeId(ticket.epic, ticket.num), hidden: false }, epicNodeId(ticket.epic))
        },
      })
```

- Что делает: n-я ручная проверка Ticket-а — n-й ручной пункт его Evidence; по его номеру строка открывает вид на
  пункте, иначе — карточку Ticket-а, как раньше.
- Почему здесь: Ticket называет `manualCheckCommands`; почему номер берётся из Evidence — очередь знает пункт по номеру
  `item.index`, а `manualChecks` номеров не несёт (diff).
- Без него: строка ведёт к Ticket-у и при пункте в очереди.
- Требование: [Что делаем, п. 3](../issues/06-входы-в-вид-acceptance.md#что-делаем)
- Риски и пробелы test-ов: модель старого worfy (Linked machine) без `evidence` даёт `undefined` — переход к Ticket-у;
  отдельного test-а на это нет.

## 5. Клик уведомления ждёт очередь и выбирает вид или Pipeline

Code: `src/renderer/canvas/overlays/NotificationTarget.tsx:103-125` · key lines: 114, 119, 123

```tsx
    // A Ticket that waits for the owner (worfy-pipeline ticket 06): the Acceptance view on it when the queue holds it
    // (worfy-acceptance ticket 06), else the Pipeline board of its Project, once this window knows its Projects and
    // the queue. The view is over every Project, so it selects none. A queue that has not answered when the note's
    // wait ends (a Linked machine's, or one main is still building at the start) gives the Pipeline board, as before
    // ticket 06; without the Projects the note goes.
    if ('view' in note) {
      const open = (queueKnown: boolean): void => {
        if (projects === undefined) return
        dropNote(pending)
        const target = pipelineProjectOf(note, projects.projects)
        if (target === undefined) console.warn(`a notification of ${note.epic} ${note.num}: ${note.projectRoot ?? note.projectId} is no longer in the list of Projects`)
        else if (!queueKnown || !openAcceptance({ projectId: target.id, epic: note.epic, num: note.num }))
          void openPipelineOf(target.id, projects.activeId ?? undefined).then((problem) => {
            if (problem !== undefined) console.error('a notification could not open the Pipeline of its Project:', problem)
          })
      }
      if (projects !== undefined && acceptanceKnown) {
        open(true)
        return
      }
      const timer = setTimeout(() => (projects === undefined ? dropNote(pending) : open(false)), Math.max(0, pending.until - Date.now()))
      return () => clearTimeout(timer)
    }
```

- Что делает: заметка ждущего Ticket-а ждёт и список Project-ов, и первый ответ очереди (`useAcceptanceKnown`); есть
  строка Ticket-а — вид на ней без выбора Project-а, нет или очередь не прочитана с ошибкой — доска Pipeline. Очередь
  не ответила, пока заметка ждёт (10 s), а Project-ы известны — тоже доска Pipeline, как до Ticket-а 06.
- Почему здесь: Ticket называет `src/main/workflow/waits-notify.ts` и `test/unit/notify.test.ts`. Очередь есть и в
  main, но окно читает очередь своей Machine в момент клика (перезагруженное на Linked machine окно — очередь той
  Machine); проверка в main потребовала бы нового поля заметки и видела бы очередь на момент показа. Это расхождение с
  Ticket-ом — в отчёте implementer-а.
- Без него: клик всегда открывал бы доску Pipeline.
- Требование: [Что делаем, п. 4](../issues/06-входы-в-вид-acceptance.md#что-делаем)
- Риски и пробелы test-ов: `acceptance.get` без ответа за 10 s — доска Pipeline, даже если Ticket в очереди; test
  с fake timers проверяет этот путь; test-ы — в `test/unit/notification-ticket-click.test.tsx` вместе со старыми test-ами этого клика.

## 6. Как проверено

- `pnpm exec vitest run test/unit/acceptance-section.test.tsx test/unit/palette-manual-check-row.test.tsx test/unit/pipeline-board.test.tsx` —
  exit 1 до правки (4 test-а и файл секции), exit 0 после; test-ы клика уведомления потом вынесены в
  `test/unit/notification-ticket-click.test.tsx`. Test «leave out an item already Sent» — exit 1 на секции до правила Sent.
- `pnpm test:e2e test/e2e/sidebar-rail.spec.ts test/e2e/sidebar-sections.spec.ts` — exit 0 (9 test-ов), снимки секции
  и вида при 1280 px в обеих темах.
- `pnpm lint`, `pnpm typecheck`, `node scripts/check-feature-docs.mjs` — exit 0.

## Проверить себя

1. Что откроет клик уведомления, если очередь окна не ответила, пока заметка ждёт?
   - Ответ: доску Pipeline Project-а, как до Ticket-а 06; без списка Project-ов заметка просто уходит.
   - Строки: `src/renderer/canvas/overlays/NotificationTarget.tsx:123`
2. Что сделает строка ручной проверки, если очередь не содержит её пункт?
   - Ответ: `openAcceptance` вернёт `false`, вид не переключится, и строка уйдёт к карточке Ticket-а.
   - Строки: `src/renderer/palette/commands.ts:692-693`
3. Почему бейдж rail-а может быть меньше счёта на вкладке?
   - Ответ: секция и её бейдж следуют переключателю боковой панели, а вкладка считает все Project-ы.
   - Строки: `src/renderer/shell/sidebar/AcceptanceSection.tsx:62-64`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-acceptance 06 (entries into the Acceptance view: the sidebar section, the rail badge, the palette rows, manual checks and the notification lead to the item), head 1c629449143e47ef2bf84d9d6689b2f51262452e
>
> Gate (depth medium, one round): verifier (lens: implementer's claims, sonnet) — MERGE, claims 1–4 and 6 CONFIRMED, claim 5 partly (the stated reason for the window-side choice was wrong, the choice holds), 6 of 6 mutants red, e2e sidebar-rail + sidebar-sections 9/9 EXIT=0; reviewer (correctness) — FIX (one med: the notification click waited for the queue's first answer longer than the note lives and then opened nothing); round 1 checked by the Orchestrator; the rebase onto main after #2166 checked by the Orchestrator (only 06's files).
>
> - What the user sees: an Acceptance section in the sidebar with per-Project counts of Ready to check (without Sent, with «Not recorded yet»), Update first, Waits for you and Failed; a rail badge with the Ready-to-check count of the Projects chosen by the Project switcher; an «Acceptance» row in the palette's View group; a palette manual-check row opens the view on its item when the item is in the queue, else goes to the ticket; a click on «<epic> NN is waiting for you» opens the view on the item when the ticket is in the queue, else the Pipeline board, and still the Pipeline board when the queue has not answered by the end of the note's wait.
> - Fixed in round 1: the notification click falls back to the Pipeline board when the queue does not answer in NOTE_WAIT_MS and the Projects are known (test: the queue never answers, timers +11 s → Pipeline; red before); the ticket's «Итог» gives the right reason (the window reads its own Machine's queue at click time); the badge's departure from spec.md:94 named in the decisions. After the rebase the section and badge count «Not recorded yet» like the tab (test red before).
> - Evidence: new tests red before each change; 6 unit files EXIT=0 (155); pnpm lint, typecheck EXIT=0; gate fast green; e2e sidebar-rail + sidebar-sections whole EXIT=0 with screenshots at 1280 px in both themes; 6 verifier mutants red; story-check, evidence-check, check-feature-docs EXIT=0.
> - Debt (low): a palette row matches the n-th manual check to the n-th manual item by position across two parsers (manual-checks.ts and evidence.ts); the reviewer found both read the same items in the same order, no test holds that parity; the ticket's item 3 names test/unit/notify.test.ts, the test lives in test/unit/notification-ticket-click.test.tsx (the choice is made in the window).
> - Not verified: a real Linked machine notification; a cold start with many Projects.
>
> Decided without the owner (to confirm): the section follows PullRequestsSection, one row per group per Project, only Ready to check, Update first, Waits for you and Failed (In work and Older left out, folded in the view too); the section and the rail badge follow the Project switcher like Pull requests — with one Project chosen the badge can be smaller than the tab's number, a departure from spec.md:94 (one number on the rail and the tab); badge tone «working», label «N checks ready to check», order 15 after Pull requests; the n-th manual check = the n-th manual item of ticket.evidence, a model without evidence (an old worfy on a Linked machine) → the ticket; the notification waits for the queue's first answer, an error answer → Pipeline; the choice is made in the window, not in src/main/workflow/waits-notify.ts as the ticket's «Где в коде» said.
