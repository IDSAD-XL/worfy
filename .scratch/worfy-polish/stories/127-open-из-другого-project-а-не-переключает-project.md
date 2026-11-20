# Code story — worfy-polish 127: «Open» Session из другого Project-а не переключает Project

Kind: pr · Epic: worfy-polish · Ticket: 127 · PR: - · Language: ru

## 1. Что было не так

«Open» toast-а вопроса и щелчок по уведомлению ОС о Session своей машины звали только `openSession`. Он запоминает
Session за её Project-ом и ставит `view: 'session'`, но активный Project не меняет, а Session view рисует последнюю
Session активного Project-а. Человек видел чат чужого Project-а и находил нужный только после ручного переключения.

- Требование: [Что происходит](../issues/127-open-из-другого-project-а-не-переключает-project.md#что-происходит)

## 2. Helper: сначала Project, потом Session

Code: `src/renderer/session/open-in-project.ts:18-29` · key lines: 20, 25, 26, 27

```ts
export function openSessionInProject(target: OpenedSession): void {
  const projects = projectsNow()
  if (target.projectId === activeProject(projects)?.id) {
    openSession(target)
    return
  }
  const name = projects?.projects.find((project) => project.id === target.projectId)?.name ?? "The Session's Project"
  void openProject(windowMachine(), target.projectId).then((refused) => {
    if (refused === undefined) openSession(target)
    else showToast({ kind: 'error', key: `open-project:${target.projectId}`, text: `${name} could not be opened: ${readableReason(refused)}` })
  })
}
```

- Что делает: Session активного Project-а открывается сразу, как раньше, без `openProject`. Для другого Project-а
  окна — `openProject(windowMachine(), id)`, и только после ответа `openSession`. Отказ — error toast с именем
  Project-а и причиной, ничего не открывается. Активный Project helper читает через новую `projectsNow()`
  (`useProjects.ts`), так как toast вопроса живёт вне React.
- Почему здесь: Ticket просит helper «рядом с `openSession`». Отдельный файл, а не `navigation.ts`: `navigation.ts`
  импортирует почти весь renderer, а часть unit test-ов подменяет `useProjects.ts` без `openProject` — решено без
  владельца. Порядок «сначала Project» выбран, чтобы Session view не показал на миг чат чужого Project-а — решено без
  владельца.
- Без него: окно остаётся на активном Project-е, нужный чат запомнен за другим.
- Требование: [Что делаем, п. 1 и 2](../issues/127-open-из-другого-project-а-не-переключает-project.md#что-делаем)
- Риски и пробелы test-ов: unit test-ы проверяют оба исхода и отсутствие `projects.select` для активного Project-а.
  Окно на Linked machine (`openProject` с той же Machine меняет только показанный Project) проверено unit test-ом
  toast-а (раунд ревью 1).

## 3. «Open» toast-а вопроса

Code: `src/renderer/session/question-toast.ts:41-71` · key lines: 45, 47, 49, 63, 66, 68

```ts
async function loadViews(): Promise<void> {
  const projects = projectsNow()?.projects ?? []
  await Promise.all(
    projects.map(async (project) => {
      const [sessions, layout] = await Promise.all([invoke('sessions.views', { projectId: project.id }), invoke('layout.get', { projectId: project.id })])
      if (sessions.ok) for (const view of sessions.value.views) acceptSessionNodeView(view)
      const orchestrator = layout.ok ? layout.value.layout.nodes.find((node) => node.kind === ORCHESTRATOR_KIND) : undefined
      if (orchestrator === undefined) return
      const result = await invoke('orchestrator.view', { nodeId: orchestrator.id })
      if (result.ok && result.value.view !== null) acceptOrchestratorView(result.value.view)
    }),
  )
}

/**
 * Shows the Session, selecting its Project first when it runs in another one (worfy-polish ticket 127).
 * When this window knows no Node for it, the views of every Project are asked for first; still none,
 * the Session view of the active Project.
 */
function openAsking(sessionId: string): void {
  const target = targetOf(sessionId)
  if (target !== null) {
    openSessionInProject(target)
    return
  }
  void loadViews().then(() => {
    const found = targetOf(sessionId)
    if (found !== null) openSessionInProject(found)
    else useNavigation.setState({ view: 'session' })
  })
}
```

- Что делает: найденный Node Session открывается через helper шага 2. Когда окно не знает Node-а Session (окно
  загружено после её старта и знает views только Canvas-а активного Project-а), `loadViews` спрашивает у каждого
  Project-а машины окна `sessions.views`, а Orchestrator — через его Node в `layout.get` и `orchestrator.view`; потом
  поиск повторяется. Не нашлось и так — Session view активного Project-а, как раньше. В окне на Linked machine helper
  меняет показанный Project той машины (`linked.open`), а не активный Project.
- Почему здесь: Ticket называет `question-toast.ts:26-31`. Загрузка views всех Project-ов — находка ревью, раунд 1;
  поиск Orchestrator-а через Layout — решено без владельца: channel-а «Orchestrator Project-а» нет.
- Без него: «Open» на вопросе `pr-fix` из Session другого Project-а показывает чат активного Project-а.
- Требование: [Готово, когда](../issues/127-open-из-другого-project-а-не-переключает-project.md#готово-когда)
- Риски и пробелы test-ов: в окне со многими Project-ами «Open» без известного Node-а шлёт по три вызова на Project;
  это бывает только после перезагрузки окна. Unit test-ы покрывают Session Node и Orchestrator другого Project-а и окно
  на Linked machine.

## 4. Overlay уведомления ОС на своей машине

Code: `src/renderer/canvas/overlays/NotificationTarget.tsx:113-134` · key lines: 115, 120, 121, 134

```tsx
    // A Session from the registry is looked for in the Project of its root, whichever is active.
    const root = note.projectRoot
    const where = root === null ? project : (projects?.projects.find((each) => sameProjectRoot(each.path, root)) ?? project)
    const target = notificationTarget(note, where, machine)
    if (target !== null) {
      dropNote(pending)
      // A Session of another Project of this Machine: that Project first (worfy-polish ticket 127).
      if (machine === null) {
        openSessionInProject(target)
        return
      }
      if (target.projectId !== projects?.activeId) {
        void openProject(machine, target.projectId).then((problem) => {
          if (problem !== undefined) console.error('a notification could not open its Project:', problem)
        })
      }
      openSession(target)
      return
    }
    // The Session Nodes of the Projects may not have asked for their views yet; the Session may be
    // in any Project of the window's Machine.
    for (const each of projects?.projects ?? []) ensureProject(each.id)
```

- Что делает: на своей машине уведомление открывает Session через helper. Ещё две правки: views Session Node-ов
  спрашиваются у всех Project-ов, а не только у активного, и Session из registry ищется в Project-е её корня. Обе так
  уже работали на Linked machine. Ветка Linked machine (`machine !== null`) не менялась.
- Почему здесь: Ticket называет `NotificationTarget.tsx:110-121`. Поиск во всех Project-ах — решено без владельца:
  без него окно, которое ещё не спросило views другого Project-а, не находит его Session, и уведомление гаснет через
  10 s.
- Без него: щелчок по уведомлению о Session другого Project-а открывает чат активного Project-а или ничего.
- Требование: [Что делаем, п. 1](../issues/127-open-из-другого-project-а-не-переключает-project.md#что-делаем)
- Риски и пробелы test-ов: окно с многими Project-ами шлёт по одному `sessions.views` на Project, пока уведомление
  ждёт свою Session (один раз на Project, `ensureProject` помнит спрошенные).

## 5. Что сознательно не меняли

- Остальные вызовы `openSession(` в `src/renderer/` открывают Session активного Project-а; список — в «Итог» Ticket-а.
- Перевод `docs/features/ru/sessions.md` — по ADR-0088 правится только английская страница.

## 6. Как проверено

Четыре новых случая unit test-ов (`test/unit/question-card.test.tsx` — 2, `test/unit/permission-card.test.tsx` — 2)
были красными на коде `main` (exit 1) и зелёные после правки (66 из 66, exit 0). Все unit test-ы, что импортируют
тронутые модули, и contract `test-timeout-scale.test.ts` — 81 файл, exit 0. `pnpm lint` и `pnpm typecheck` — exit 0.
e2e `session-question.spec.ts` и `linked-notify.spec.ts` целиком — 3 passed, exit 0.
Раунд ревью 1: три новых случая `question-card.test.tsx` (окно после перезагрузки — Session Node и Orchestrator другого
Project-а; окно на Linked machine) красные на прежнем `question-toast.ts` (exit 1), после правки 34 из 34 (exit 0).

## Проверить себя

1. Почему для Session активного Project-а helper не зовёт `openProject`?
   - Ответ: `openProject` своей машины шлёт `projects.select`; для уже активного Project-а это лишний вызов, а Session
     view и так показывает его Session — поэтому сразу `openSession`.
   - Строки: `src/renderer/session/open-in-project.ts:18-29`
2. Что увидит человек, если main откажет выбрать Project?
   - Ответ: error toast «<Project> could not be opened: <причина>»; вид и запомненные Session не меняются.
   - Строки: `src/renderer/session/open-in-project.ts:18-29`
3. Почему overlay теперь спрашивает views всех Project-ов своей машины?
   - Ответ: Node Session другого Project-а окно знает только из его views; без запроса уведомление о такой Session не
     находит её и истекает.
   - Строки: `src/renderer/canvas/overlays/NotificationTarget.tsx:113-134`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-polish 127 («Open» on a Session of another Project switches the Project), head e0518be58db068e0be4ff9f8e18795ad17e165a8
>
> Gate (depth medium, two rounds): verifier (lens: implementer's report) — claims backed, two low gaps; reviewer (lens: correctness) round 1 one low (Linked machine claim), round 2 three low — no high or med.
>
> - Fix: openSessionInProject (src/renderer/session/open-in-project.ts) opens the Session's Project first, then the Session; error toast and nothing opened when the Project cannot be selected; question toast «Open» and the notification overlay use it; the overlay asks every Project for its Session views and matches a registry Session by its Project root.
> - Round 1: a window reloaded after the Session started now finds the Session (or an Orchestrator through its Project's Layout) by asking every Project of the window's Machine; Linked machine window toast path tested; «Итог» corrected.
> - Tests: question-card + permission-card 69/69 EXIT=0 (three new cases red on the previous question-toast.ts, four new cases red on main); 81 unit files importing touched modules + test-timeout-scale 1597 tests EXIT=0; e2e session-question.spec.ts + linked-notify.spec.ts whole 3/3 EXIT=0; lint, typecheck, story-check, evidence-check EXIT=0. Local gate fast not run: file-watcher tests red on this Mac (fseventsd); CI is the verdict.
>
> Decided without the owner (to confirm): overlay loads Session views of every Project; helper in its own file; projectsNow() in useProjects.ts; order Project then Session; Orchestrator of another Project found through its Layout.
>
> Consider [low]: question-toast.ts:66-68 — nothing found after the sweep opens the active Project's last Session with no notice (Project removed, Orchestrator not run since start); question-toast.ts:41-71 — no in-flight guard, a late openSession still moves a user who navigated away; a miss repeats the whole sweep on every click (no negative cache).
