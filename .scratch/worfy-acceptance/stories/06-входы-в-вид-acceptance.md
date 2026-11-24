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

Code: `src/renderer/shell/sidebar/AcceptanceSection.tsx:58-67` · key lines: 61, 63, 65

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
  Ready to check не считает пункты с отметкой Sent — то же правило, что у счёта вкладки (`readyCount`).
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

Code: `src/renderer/canvas/overlays/NotificationTarget.tsx:103-116` · key lines: 107, 111

```tsx
    // A Ticket that waits for the owner (worfy-pipeline ticket 06): the Acceptance view on it when the queue holds it
    // (worfy-acceptance ticket 06), else the Pipeline board of its Project, once this window knows its Projects and
    // the queue. The view is over every Project, so it selects none.
    if ('view' in note) {
      if (projects !== undefined && acceptanceKnown) {
        dropNote(pending)
        const target = pipelineProjectOf(note, projects.projects)
        if (target === undefined) console.warn(`a notification of ${note.epic} ${note.num}: ${note.projectRoot ?? note.projectId} is no longer in the list of Projects`)
        else if (!openAcceptance({ projectId: target.id, epic: note.epic, num: note.num }))
          void openPipelineOf(target.id, projects.activeId ?? undefined).then((problem) => {
            if (problem !== undefined) console.error('a notification could not open the Pipeline of its Project:', problem)
          })
        return
      }
```

- Что делает: заметка ждущего Ticket-а ждёт и список Project-ов, и первый ответ очереди (`useAcceptanceKnown`); есть
  строка Ticket-а — вид на ней без выбора Project-а, нет или очередь не прочитана с ошибкой — доска Pipeline.
- Почему здесь: Ticket называет `src/main/workflow/waits-notify.ts` и `test/unit/notify.test.ts`, но очередь
  Acceptance знает окно, а main решает только, что заметку держать (`notify.pending`); выбор перенесён в окно, где
  клик и так открывает Pipeline. Это расхождение с Ticket-ом — в отчёте implementer-а.
- Без него: клик всегда открывал бы доску Pipeline.
- Требование: [Что делаем, п. 4](../issues/06-входы-в-вид-acceptance.md#что-делаем)
- Риски и пробелы test-ов: если `acceptance.get` не ответит вовсе, заметка истечёт, как заметка Project-а, которого
  ещё нет; test-ы — в `test/unit/notification-ticket-click.test.tsx` вместе со старыми test-ами этого клика.

## 6. Как проверено

- `pnpm exec vitest run test/unit/acceptance-section.test.tsx test/unit/palette-manual-check-row.test.tsx test/unit/pipeline-board.test.tsx` —
  exit 1 до правки (4 test-а и файл секции), exit 0 после; test-ы клика уведомления потом вынесены в
  `test/unit/notification-ticket-click.test.tsx`. Test «leave out an item already Sent» — exit 1 на секции до правила Sent.
- `pnpm test:e2e test/e2e/sidebar-rail.spec.ts test/e2e/sidebar-sections.spec.ts` — exit 0 (9 test-ов), снимки секции
  и вида при 1280 px в обеих темах.
- `pnpm lint`, `pnpm typecheck`, `node scripts/check-feature-docs.mjs` — exit 0.

## Проверить себя

1. Почему клик уведомления не решает, куда вести, сразу при взятии заметки?
   - Ответ: очередь окна может быть ещё не прочитана; без её первого ответа Ticket из очереди ушёл бы на Pipeline.
   - Строки: `src/renderer/canvas/overlays/NotificationTarget.tsx:107`
2. Что сделает строка ручной проверки, если очередь не содержит её пункт?
   - Ответ: `openAcceptance` вернёт `false`, вид не переключится, и строка уйдёт к карточке Ticket-а.
   - Строки: `src/renderer/palette/commands.ts:692-693`
3. Почему бейдж rail-а может быть меньше счёта на вкладке?
   - Ответ: секция и её бейдж следуют переключателю боковой панели, а вкладка считает все Project-ы.
   - Строки: `src/renderer/shell/sidebar/AcceptanceSection.tsx:61-63`
