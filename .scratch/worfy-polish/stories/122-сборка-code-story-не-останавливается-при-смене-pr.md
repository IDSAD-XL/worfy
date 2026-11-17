# Code story — worfy-polish 122: Сборка Code story кнопкой не останавливается при смене PR или view, и её статус виден по возвращении

Kind: pr · Epic: worfy-polish · Ticket: 122 · PR: - · Language: ru

## 1. Что было не так

Кнопка «Code story» в Pull requests стоит с `key` на PR, и смена PR её размонтирует; hook `useStoryBuild` при
размонтировании звал `stories.stop` (правило аудита PR #1890). На Canvas смена view и Esc закрывали Popover бара, и
`onOpenChange(false)` тоже звал Stop. Сборка молча отменялась, вернувшись к PR владелец видел снова «Code story», а
второе нажатие начинало новый платный запрос.

- Требование: [Что происходит](../issues/122-сборка-code-story-не-останавливается-при-смене-pr.md#что-происходит)

## 2. main держит идущие сборки по Project и ключу; второе нажатие присоединяется

Code: `src/main/stories/by-button.ts:250-276` · key lines: 256, 257, 265, 269, 274

```ts
      const project = this.deps.project(request.projectId)
      const place = await this.placeOf(project.root, request.target)
      if (!place.ok) made = place.made
      else if (stop.signal.aborted) made = { key: place.key, reused: false, outcome: { status: 'stopped' } }
      else {
        const id = keyedId(request.projectId, place.key)
        const under = this.byKey.get(id)
        if (under !== undefined) return await this.join(under, request.storyId, onActivity)
        // No wait between the look-up above and this entry: two presses of one key never both start a request.
        const build: KeyedBuild = { storyId: request.storyId, key: place.key, lines: [], listeners: new Set([onActivity]), done: Promise.resolve(failed(place.key, 'not started')) }
        const hear = (text: string): void => {
          build.lines = [...build.lines, text].slice(-RUNNING_LINES_KEPT)
          for (const listener of build.listeners) listener(text)
        }
        build.done = this.makeWith(request, project, place, stop.signal, hear)
        this.byKey.set(id, build)
        try {
          made = await build.done
        } finally {
          if (this.byKey.get(id) === build) this.byKey.delete(id)
        }
      }
    } finally {
      if (this.running.get(request.storyId) === stop) this.running.delete(request.storyId)
    }
    onEnd(made)
    return made
```

- Что делает: после того как ключ story известен (`owner/name#N` или `epic:<name>`), смотрит реестр `byKey`. Есть идущая
  сборка этого ключа — нажатие присоединяется к ней (`join`: её строки идут и ему, ответ — её `StoryMade`, Stop под его
  storyId останавливает её). Нет — заводит запись без ожидания между поиском и записью и убирает её, когда сборка
  кончилась. `onEnd` (событие `stories.made`) зовётся только для своей сборки и уже после того, как записи в реестре нет.
- Почему здесь: Ticket называет `src/main/stories/by-button.ts` (реестр, присоединение, `running`) в «Где в коде»; ключ
  здесь же считается и под ним же story сохраняется, поэтому результат ложится на свой PR, что бы ни было открыто.
- Без него: кнопка, вернувшаяся к PR, не знала бы о сборке, а второе нажатие (или нажатие на Ticket card того же PR)
  начало бы второй платный запрос.
- Требование: [Что делаем, пункт 1](../issues/122-сборка-code-story-не-останавливается-при-смене-pr.md#что-делаем)
- Риски и пробелы test-ов: запись появляется только после чтения репозиториев Project-а; кнопка, смонтированная в эти
  миллисекунды, сборку не найдёт, а её нажатие найдёт. Contract test проверяет два ключа сразу, присоединение, Stop только
  своей сборки и что `onEnd` идёт один раз и после ухода из реестра; настоящий `gh` и модель не вызываются.

## 3. Кнопка больше не останавливает сборку при уходе, а при появлении подхватывает её

Code: `src/renderer/stories/story-build.ts:165-176` · key lines: 168, 173

```ts
  const follow = useCallback(
    async (target: StoryTarget): Promise<void> => {
      if (current.current !== null) return
      const result = await invoke('stories.running', { projectId, target })
      // A press, or another follow, took a build while main answered: that one stays.
      if (!result.ok || result.value === null || current.current !== null || !live.current) return
      const { storyId, lines } = result.value
      hold(storyId, false)
      setRun({ kind: 'running', storyId, lines: lines.slice(-SHOWN_LINES), stopping: false })
    },
    [hold, projectId],
  )
```

- Что делает: `follow` спрашивает main (`stories.running`) об идущей сборке своего target и, если она есть, берёт её
  storyId и последние строки в бар; дальше строки идут через `stories.activity`, конец — через `stories.made`, на который
  hook подписан с монтирования, так что конец сразу после ответа main не теряется до отрисовки бара. Рядом
  `abandon` зовёт `stories.stop` только для сборки `start` (`stories.build`), у которой нет ключа в main; сборка кнопкой
  при уходе просто отпускается.
- Почему здесь: Ticket называет `story-build.ts` и его комментарий `:6` — решение владельца 2026-11-17 записано там же,
  где стояло правило #1890.
- Без него: после смены PR, view или reload окна бар не вернулся бы, хотя сборка в main идёт.
- Требование: [Что делаем, пункт 2](../issues/122-сборка-code-story-не-останавливается-при-смене-pr.md#что-делаем)
- Риски и пробелы test-ов: unit test-ы идут на подставном IPC, включая конец сборки до отрисовки бара; связку с
  настоящим main после reload окна проверяет e2e в CI, локально e2e не запускался.

## 4. На Canvas Esc и смена view закрывают бар, но не сборку

Code: `src/renderer/stories/StoryBuildButton.tsx:60-64` · key lines: 61, 63

```tsx
  useEffect(() => {
    if (floating && !canvasShown) return
    setBarHidden(false)
    void follow(JSON.parse(targetKey) as StoryTarget)
  }, [follow, targetKey, floating, canvasShown])
```

- Что делает: при монтировании, а для кнопки на Canvas ещё и когда Canvas снова показан, ищет сборку своего target и
  снимает отметку «бар закрыт». Popover этой же кнопки на закрытии (Esc, смена view) при идущей сборке только прячет бар
  (`setBarHidden(true)`), а не зовёт Stop; нажатие кнопки показывает его снова.
- Почему здесь: Ticket называет `StoryBuildButton.tsx` (бар идущей сборки, Popover на смене view и Esc). View-ы
  `AppShell` не размонтируются, а Popover закрывается на смене view (`src/renderer/theme/kit/layer.ts`), поэтому кнопка
  на Canvas сама должна вернуть бар.
- Без него: на Canvas сборка шла бы, но бара не было бы видно до нажатия; до правки смена view её останавливала.
- Требование: [Что делаем, пункт 2](../issues/122-сборка-code-story-не-останавливается-при-смене-pr.md#что-делаем)
- Риски и пробелы test-ов: Esc раньше означал Stop, теперь только закрывает бар — это решение в «Итог» Ticket-а.
  Кнопку Epic-а на Canvas, которую никто не нажимал, при идущей сборке её Epic-а проверяет unit test на подставном IPC;
  e2e этого пути нет. Сборка, упавшая при баре, закрытом Esc, видна только по нажатию кнопки или со сменой view.

## 5. Story, которую никто не ждёт на экране, приходит toast-ом

Code: `src/renderer/stories/use-story-toasts.ts:65-77` · key lines: 70, 72, 74

```ts
  useEffect(() => {
    // A window without the preload (the App rendered in jsdom) hears no event.
    if (!hasPreloadBridge()) return
    return subscribe('stories.made', ({ storyId, projectId, made }) => {
      setTimeout(() => {
        if (takeEndedInView(storyId) || made.reused) return
        const outcome = made.outcome
        if (outcome.status === 'story') showMadeStoryToast(projectId, made.key, outcome.story)
        // A build that failed with nobody looking: its reason, or it would be lost — the button shows no bar for it any more.
        else if (outcome.status === 'failed' || outcome.status === 'unavailable') showMadeStoryFailure(projectId, made.key, outcome.status, outcome.reason)
      }, 0)
    })
  }, [])
```

- Что делает: слушает `stories.made` всего окна; если ни одна смонтированная кнопка не довела эту сборку до конца
  (`takeEndedInView`), а пришла новая story, показывает toast «The Code story of PR owner/name#N is ready» с «Open»;
  сборка «Failed» или «Not available» даёт error toast с причиной, Stop — ничего. Решение откладывается `setTimeout`,
  чтобы порядок слушателей события не влиял на ответ.
- Почему здесь: Ticket предлагает переиспользовать toast Ticket-а 10; тот хранит показанные Epic-и в localStorage и
  живёт на `story.md` модели workflow — для story, которую держит main, он не подходит, поэтому здесь общий
  `showToast` того же вида.
- Без него: story, собранная, пока владелец смотрел другой PR, молча легла бы в `stories.json`, а упавшая сборка
  пропала бы без следа: вернувшаяся кнопка не находит её в main и показывает просто «Code story».
- Требование: [Что делаем, пункт 3](../issues/122-сборка-code-story-не-останавливается-при-смене-pr.md#что-делаем)
- Риски и пробелы test-ов: после reload окна toast зависит от того, что main шлёт событие тому же `webContents`; e2e
  проверяет reload с открытым PR, toast после reload без кнопки — только unit test.

## 6. Строки и конец сборки идут всем окнам, а не окну, которое нажало

Code: `src/main/ipc/stories.ts:422-427` · key lines: 424, 425

```ts
export function buttonBuildEvents(storyId: string, projectId: string): { activity: (text: string) => void; end: (made: StoryMade) => void } {
  return {
    activity: (text) => toEveryWindow((client) => emit(client, storiesActivity, { storyId, text })),
    end: (made) => toEveryWindow((client) => emit(client, storiesMadeEvent, { storyId, projectId, made })),
  }
}
```

- Что делает: отдаёт `stories.make` два обработчика сборки, которые шлют `stories.activity` и `stories.made` каждому
  клиенту приложения через `toEveryWindow`; hook каждого клиента берёт только тот storyId, что держит.
- Почему здесь: Ticket называет `src/main/ipc/stories.ts` (handler-ы `stories.running`, событие `stories.made`). Сборка
  переживает своё окно: на macOS окно закрывается Cmd+W, а новое из Dock — другой `webContents`.
- Без него: окно, открытое заново, или Linked machine, подхватившие сборку через `stories.running`, видели бы бар
  «running» навсегда, Stop — «stopping», и toast не пришёл бы.
- Требование: [Что делаем, пункт 4](../issues/122-сборка-code-story-не-останавливается-при-смене-pr.md#что-делаем)
- Риски и пробелы test-ов: contract test подменяет `toEveryWindow` двумя окнами; что Linked machine получает события
  `project`/`read`, проверяет общий механизм link, не этот PR.

## 7. Что сознательно не меняли

- `stories.build` (`start`): main не держит её ключа, правило #1890 для неё остаётся — unmount, reset и новая сборка её
  останавливают.
- Вид бара и кнопки — по F-SPEC и kit, без изменений.

## 8. Как проверено

- `pnpm test test/unit/story-*.test.ts* test/contract/stories-*.test.ts test/contract/story-*.test.ts test/unit/link-access.test.ts test/unit/pr-inbox-view.test.tsx test/unit/line-question.test.tsx` — exit 0.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
- `playwright test --list test/e2e/code-story.spec.ts` — новый e2e в списке; сам e2e идёт в CI.

## Проверить себя

1. Почему второе нажатие «Code story» на PR, который уже собирается, не тратит второй запрос, даже если нажато с
   Ticket card, где repo не назван?
   - Строки: `src/main/stories/by-button.ts:255-257`
   - Ответ: ключ считается после чтения репозиториев Project-а, так что `repo: null` и `owner/name` дают один ключ;
     идущая запись в `byKey` под ним ведёт в `join`, а не в новую сборку.
2. Почему кнопка, которая подхватила сборку, не получает toast вдобавок к открытой story?
   - Строки: `src/renderer/stories/use-story-toasts.ts:69-70`
   - Ответ: её подписка на `stories.made` отмечает storyId в `endedInView`, а слушатель окна, отложенный `setTimeout`,
     забирает эту отметку и toast не показывает.
3. Что останавливает сборку кнопкой теперь?
   - Строки: `src/renderer/stories/story-build.ts:84`
   - Ответ: только явный Stop в баре (и выход из приложения); уход кнопки зовёт `stories.stop` лишь для сборки `start`.

## 9. Что нашёл review и что осталось

> VERIFIED
> PR #1940 (worfy-polish 122), round 3, head aa6f1fbdeaea10713e5dccf81d7735fadead73db.
> - Range-diff 98f84a846..8fd2adf49 vs 094aa4429..aa6f1fbde: commits 1-5 identical (=); only new commits are db6265d7b (src/main/ipc/stories.ts:458-460 guard + test/contract/stories-handler.test.ts:258-282) and aa6f1fbde (4 lines in the ticket result).
> - Production: sharedMaker is created only by stories.make / stories.stop (src/main/ipc/stories.ts:445,455); runningOf reads only the maker's byKey map, so with no maker no button build exists and null is the true answer. stories.saved/answers/marks/markRead never call maker(), builder() or asker().
> - globalThis.worfyFakeRelease is set only in sharedStoryReleases(), reached only past the WORFY_AGENT !== 'fake' return (stories.ts:110): test-only concern.
> - Mutant (temp copy, removed): running handler back to maker().runningOf -> regression test red (expected [Function] to be [Function sessions]), EXIT=1.
> - Ran: pnpm test stories/story contract+unit 14 files 186 tests EXIT=0; pnpm typecheck EXIT=0; story-check --head aa6f1fbde EXIT=0 (5 fragments ok); gh pr checks 1940: all pass incl. ci-ok, macos-e2e 1/2 and 2/2, windows-e2e 1-4.
> - Findings: none.

Code: `src/main/ipc/stories.ts:458-460` · key lines: 458

```ts
  // Every "Code story" button asks on mount: with no maker yet no build runs, and none is made here — making it makes the
  // fake agent's story releases, which would take globalThis.worfyFakeRelease from the Sessions' fake agent in e2e runs.
  defineHandler(storiesRunning, ({ projectId, target }) => (sharedMaker === undefined ? null : sharedMaker.runningOf(projectId, target))),
```

Code: `test/contract/stories-handler.test.ts:258-282` · key lines: 258

```ts
// worfy-polish 122, CI of PR #1940: every "Code story" button asks stories.running on mount. Asking made the app's
// story maker, and with it the story releases of the fake agent, which took globalThis.worfyFakeRelease from the fake
// agent of the Sessions: the Autopilot e2e runs never released their turns and stayed "stopping".
describe('stories.running makes no story maker', () => {
  it('asked before any build, it answers none and leaves globalThis.worfyFakeRelease to the Sessions\' fake agent', async () => {
    vi.resetModules()
    const before = process.env.WORFY_AGENT
    process.env.WORFY_AGENT = 'fake'
    const sessions = (): void => undefined
    const holder = globalThis as { worfyFakeRelease?: (name: string) => void }
    const kept = holder.worfyFakeRelease
    holder.worfyFakeRelease = sessions
    try {
      const { default: fresh } = await import('../../src/main/ipc/stories')
      const running = fresh.find((entry) => entry.channel.name === 'stories.running')!
      const answer = await running.handle({ projectId: 'p1', target: { kind: 'pr', repo: null, number: 212 } } as never, { event: { sender: { send: () => undefined, isDestroyed: () => false } } } as never)
      expect(answer).toBeNull()
      expect(holder.worfyFakeRelease).toBe(sessions)
    } finally {
      holder.worfyFakeRelease = kept
      if (before === undefined) delete process.env.WORFY_AGENT
      else process.env.WORFY_AGENT = before
    }
  })
})
```

Code: `src/main/ipc/stories.ts:445-445` · key lines: 445

```ts
    const build = maker().stop(storyId)
```
