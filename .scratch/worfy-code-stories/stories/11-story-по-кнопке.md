# Code story — worfy-code-stories 11: Story по кнопке: PR без story, PR Session, PR коллег, story Epic-а до конца

Kind: pr · Epic: worfy-code-stories · Ticket: 11 · PR: - · Language: ru

## 1. Что было не так

Story была только у PR Ticket-а: её пишет implementer. У PR обычной Session, PR коллег, старых PR и у Epic-а до его конца
story не было, а кнопки «Code story» Ticket-а 10 в этих местах стояли неактивными. Кроме того, аудит PR #1890 нашёл три
дыры, до которых эта кнопка дотягивается: уход с экрана во время сборки не останавливал платный запрос, две сборки
одного storyId обе шли и Stop не доставал ни одну, а в Project-е из нескольких репозиториев папку одного репозитория
сборка отказывалась читать.

- Требование: [Что происходит](../issues/11-story-по-кнопке.md#что-происходит)

## 2. Сохранённая story открывается без запроса, Codex отказывает до чтения

Code: `src/main/stories/by-button.ts:228-260` · key lines: 232, 233, 237, 238, 253, 254, 257

```ts
    const key = storyKeyOf(request.target, repo?.slug ?? null)
    const stopped: StoryMade = { key, reused: false, outcome: { status: 'stopped' } }
    if (signal.aborted) return stopped
    if (request.rebuild !== true) {
      const saved = readSavedStory(project.dataDir, key)
      if (saved !== null) return { key, reused: true, outcome: { status: 'story', story: saved.story } }
    }
    // A Vendor without a oneShot: its reason, before gh or a file is read.
    try {
      const refusal = oneShotRefusal(await this.deps.capabilities(project.vendor))
      if (refusal !== null) return { key, reused: false, outcome: { status: 'unavailable', reason: refusal } }
    } catch (error) {
      return failed(key, `What ${project.vendor} can do could not be read: ${messageOf(error)}`)
    }
    if (signal.aborted) return stopped

    let prepared: Prepared
    try {
      prepared = request.target.kind === 'pr' ? await this.preparePr(request.projectId, project.root, repo!, repos, request.target.number, signal) : await this.prepareEpic(project.root, request.target.epic, signal)
    } catch (error) {
      return signal.aborted ? stopped : failed(key, messageOf(error))
    }
    // No wait between this check and the builder taking the storyId (it does so before its first wait): from here Stop
    // is the builder's, and an answer that comes after it is dropped there (`stopped`).
    if (signal.aborted) return stopped
    const outcome = await this.deps.builder.build({ storyId: request.storyId, folder: prepared.folder, vendor: project.vendor, input: prepared.input }, onActivity)
    if (outcome.status !== 'story') return { key, reused: false, outcome }
    const story = outcome.story.kind === 'epic' ? settleChapters(outcome.story, prepared.chapters) : outcome.story
    try {
      const saved = saveStory(project.dataDir, key, { story, colleague: prepared.colleague })
      return { key, reused: false, outcome: { status: 'story', story: saved.story } }
    } catch (error) {
      return failed(key, `The story could not be kept: ${messageOf(error)}`)
```

- Что делает: окно называет только, о чём story (`stories.make`: PR или Epic); main сначала смотрит хранилище Ticket-а 08
  по ключу `owner/name#N` или `epic:<имя>` и отдаёт сохранённую story без запроса, потом спрашивает возможности Vendor-а
  Project-а, затем читает материал и строит story через сборщик Ticket-а 04. В хранилище попадает только story со
  статусом `story`: остановленная или упавшая сборка возвращает свой исход и ничего не пишет. После каждого ожидания
  стоит проверка Stop: пока main читает материал, остановленная сборка отвечает `stopped` и до запроса не доходит.
- Почему здесь: `src/main/stories/by-button.ts` назван в списке файлов Ticket-а. Ticket требует, чтобы повторное
  нажатие открывало сохранённую story, а остановленная сборка ничего не сохраняла (пункт 5 «Что делаем»); Project на Codex без `oneShot` получает причину из Ticket-а 04 (пункт 6). Почему
  проверка Vendor-а стоит раньше чтения gh, а не только внутри сборщика, — не записано.
- Без него: не записано
- Требование: [Что делаем, п. 5 и 6](../issues/11-story-по-кнопке.md#что-делаем)
- Риски и пробелы test-ов: ключ PR пишется так, как его даёт `origin` клона; если строка Pull requests пишет владельца
  репозитория в другом регистре, «Rebuild story» в окне не узнает о сохранённой story (main её всё равно найдёт без
  учёта регистра). Test-а на это расхождение нет.

## 3. Stop доходит до сборки с первого нажатия

Code: `src/main/stories/by-button.ts:189-208` · key lines: 191, 193, 200, 203

```ts
  stop(storyId: string): boolean {
    const run = this.running.get(storyId)
    const inBuilder = this.deps.builder.stop(storyId)
    if (run === undefined) return inBuilder
    run.abort()
    return true
  }

  /** Makes the story of `request.target`, or opens the one kept before; `onActivity` hears the build's lines. */
  async make(request: MakeRequest, onActivity: (text: string) => void): Promise<StoryMade> {
    const asked = request.target.kind === 'pr' ? request.target.repo : null
    if (this.running.has(request.storyId)) return failed(storyKeyOf(request.target, asked), `The story ${request.storyId} is already being built.`)
    // Taken before the first wait, so Stop reaches the build from the press on.
    const stop = new AbortController()
    this.running.set(request.storyId, stop)
    try {
      return await this.makeWith(request, stop.signal, onActivity)
    } finally {
      if (this.running.get(request.storyId) === stop) this.running.delete(request.storyId)
    }
```

- Что делает: сборка по кнопке занимает свой storyId в `StoryMaker` до первого ожидания, ещё до чтения gh. `stories.stop`
  идёт в `StoryMaker.stop`: он прерывает чтение материала и передаёт Stop сборщику Ticket-а 04, если запрос уже идёт.
  Вторая сборка того же storyId получает отказ, ничего не прочитав.
- Почему здесь: файл назван в списке файлов Ticket-а; остановленная сборка ничего не сохраняет (пункт 5 «Что делаем»).
  Комментарий в diff: между последней проверкой Stop и вызовом сборщика нет ожидания, а сборщик занимает storyId до
  своего первого ожидания.
- Без него: Stop, нажатый пока main читает PR из GitHub, не доходит до сборки: test «Stop while main reads the diff»
  в `test/contract/story-by-button.test.ts` и test `stories.stop` в `test/contract/stories-handler.test.ts` красные без
  этой регистрации.
- Требование: [Что делаем, п. 5](../issues/11-story-по-кнопке.md#что-делаем)
- Риски и пробелы test-ов: чтение, которое уже идёт (`gh pr view`, `gh pr diff`), не прерывается: сборка заканчивается
  после него. Сам процесс gh Stop не убивает.

## 4. PR: diff, текст, Ticket, вердикты; чей PR — решает worfy

Code: `src/main/stories/by-button.ts:276-307` · key lines: 279, 287, 294, 296, 300, 305

```ts
    // The Ticket whose `PR:` line names this PR: `PR: <repo>#N`, or a bare `PR: #N` of the Project's first repository.
    const model = await this.deps.workflow(root).catch(() => null)
    stopIf(signal)
    const ticket = model?.tickets.find((one) => ticketNamesPr(one, repo, repos, number)) ?? null
    const ticketFile = ticket === null ? null : await this.deps.ticketFile(root, ticket).catch(() => null)
    stopIf(signal)
    const viewer = await this.deps.viewer(projectId).catch(() => null)
    const account = await this.deps.account(root).catch(() => null)
    const me = viewer ?? account
    const verdictsBy = account ?? viewer
    const verdicts = pr.comments
      .filter((comment) => sameLogin(comment.author, verdictsBy))
      .map((comment) => findVerdict(comment.body)?.text ?? null)
      .filter((text): text is string => text !== null)
      .slice(-20)
      .map(cutMaterial)
    const language = await this.deps.language(root).catch((): StoryLanguage => 'en')
    stopIf(signal)
    const colleague = !sameLogin(pr.author, me)
    // A colleague's title stays between the markers of the material: the instruction above them names the PR by number.
    const title = colleague || pr.title.trim() === '' ? `PR #${String(number)}` : pr.title
    const input: StoryInput = {
      kind: 'pr',
      header: { title, epic: ticket?.epic ?? null, ticket: ticket === null ? null : nn(ticket.num), pr: number, language, commit: pr.head },
      diff: cutMaterial(diff),
      prText: cutMaterial(`${pr.title}\n\n${pr.body}`.trim()),
      ticket: ticketFile === null ? null : { file: ticketFile.file, text: cutMaterial(ticketFile.text) },
      verdicts,
    }
    const folder = await this.deps.checkout(repo, pr.branch).catch(() => repo.folder)
    stopIf(signal)
    return { input, folder, colleague, chapters: [] }
```

- Что делает: собирает вход агента для PR — diff (`gh pr diff`, Bash у `oneShot` запрещён), заголовок и описание PR,
  файл Ticket-а, чья строка `PR:` называет этот PR, и вердикты (`VERIFIED`/`REJECTED` по правилу `findVerdict`) только
  от аккаунта Project-а. Head PR идёт в шапку (`commit`): story хранится вне git. PR коллеги — тот, чей автор не совпал
  с логином PR inbox-а или аккаунтом Project-а; неизвестный автор считается коллегой, и хранилище убирает его слова. В
  инструкции над материалом PR коллеги назван номером, а не его заголовком. Ticket ищется по `PR: <repo>#N` в
  репозитории с этим именем из Profile; голый `PR: #N` относится к первому репозиторию Project-а.
- Почему здесь: файл назван в списке файлов Ticket-а; вход PR и запрет хранить слова коллег записаны в Ticket-е (пункты 2 и 4 «Что делаем») и в ADR-0105; diff в
  тексте запроса — потому что Bash у `oneShot` запрещён (пункт 2). Строки `PR: <repo>#N` описаны в
  `harness/bin/TICKETS.md` («Header»). Почему вердикты берутся только от аккаунта Project-а — не записано.
- Без него: не записано
- Требование: [Что делаем, п. 2 и 4](../issues/11-story-по-кнопке.md#что-делаем)
- Риски и пробелы test-ов: реальный `gh` не запускался: test-ы идут через stand-in и stub `gh`.

## 5. Story Epic-а: у каждой главы head своего PR, неготовые — в «Начале»

Code: `src/main/stories/by-button.ts:155-167` · key lines: 157, 160, 162, 163, 166

```ts
export function settleChapters(story: Extract<Story, { kind: 'epic' }>, known: readonly KnownChapter[]): Extract<Story, { kind: 'epic' }> {
  const language = story.header.language
  const chapters: StoryChapter[] = known.map((ours) => {
    const chapter = story.chapters.find((one) => one.ticket === ours.ticket)
    const asNotReady = (why: string): StoryChapter => ({ ready: false, pr: null, ticket: ours.ticket, title: chapter?.title ?? ours.title, head: null, steps: [], why })
    if (ours.ready === null) return asNotReady(ours.why ?? '-')
    // A ready Ticket the answer left out, or gave without steps: nothing of it to tell, so not ready, with why.
    if (chapter === undefined || !chapter.ready || chapter.steps.length === 0) return asNotReady(chapter?.why ?? notReady.skipped(language))
    return { ...chapter, pr: ours.ready.pr, head: ours.ready.head, why: null }
  })
  const waiting = chapters.filter((chapter) => !chapter.ready).map((chapter) => chapter.ticket)
  const start = waiting.length === 0 ? story.start : { ...story.start, text: `${story.start.text.trimEnd()}\n\n${notReadyLine(language, waiting)}` }
  return { ...story, start, chapters }
```

- Что делает: после ответа агента worfy оставляет только известные ему Ticket-ы, по одной главе на каждый. Каждой готовой
  главе он сам ставит PR и head, прочитанный из GitHub, а не тот, что написал агент. Ticket без PR или без story PR в
  основной ветке, а также готовый Ticket, который агент пропустил или дал без шагов, становится главой «Ready: no» без
  шагов. «Начало» заканчивается строкой с неготовыми Ticket-ами. Причины пишутся на языке story (`not-ready.json`).
- Почему здесь: файл назван в списке файлов Ticket-а; у глав разные head, одно поле `Commit:` не подходит, и каждая глава несёт head своего PR (пункт 7
  «Что делаем», `harness/bin/TICKETS.md`, «Story anchor»); неготовые Ticket-ы помечаются в «Начале» (решение 18 spec-а,
  пункт 2 Ticket-а). Почему head ставит worfy, а не берёт из ответа агента, — не записано.
- Без него: не записано
- Требование: [Что делаем, п. 7](../issues/11-story-по-кнопке.md#что-делаем)
- Риски и пробелы test-ов: готовой глава считается, если у Ticket-а есть `PR: #N` и story его PR лежит в основной ветке;
  слияние PR отдельно не проверяется. Head готовых глав читается из `gh pr view` основного репозитория Project-а.

## 6. Сборка занимает storyId до первого ожидания

Code: `src/main/stories/one-shot.ts:168-182` · key lines: 171, 172, 182

```ts
    if (this.running.has(request.storyId)) return { status: 'failed', reason: `The story ${request.storyId} is already being built.` }
    // Taken before the first wait: a second build of the same story, started while this one reads the Vendor's
    // capabilities, is refused above, and Stop reaches this one from now on (audit of PR #1890).
    const stop = new AbortController()
    this.running.set(request.storyId, stop)
    let structured: unknown
    try {
      let refusal: string | null
      try {
        refusal = oneShotRefusal(await this.deps.capabilities(request.vendor))
      } catch (error) {
        return { status: 'failed', reason: `What ${request.vendor} can do could not be read: ${messageOf(error)}` }
      }
      if (refusal !== null) return { status: 'unavailable', reason: refusal }
      if (stop.signal.aborted) return { status: 'stopped' }
```

- Что делает: AbortController регистрируется под storyId до чтения возможностей Vendor-а, поэтому вторая сборка того же
  storyId получает отказ, а Stop доходит до первой и тогда, когда она ещё ждёт возможности; `finally` удаляет запись только
  если она всё ещё своя.
- Почему здесь: `src/main/stories/one-shot.ts` назван в списке файлов Ticket-а; комментарий в diff: регистрация до
  первого ожидания даёт отказ второй сборке того же storyId и Stop первой (аудит PR #1890)
- Без него: вторая сборка того же storyId запускала второй запрос, а Stop первой не доходил: оба test-а builder-а в
  `test/contract/story-by-button.test.ts` красные на прежнем `one-shot.ts`.
- Требование: [Что делаем, п. 5](../issues/11-story-по-кнопке.md#что-делаем)
- Риски и пробелы test-ов: не записано

## 7. Брошенная сборка останавливается

Code: `src/renderer/stories/story-build.ts:51-58` · key lines: 52, 55, 58

```ts
  /** Stops the build main runs for this hook, if any: nobody waits for its answer any more. */
  const abandon = useCallback((): void => {
    const storyId = current.current
    current.current = null
    if (storyId !== null) void invoke('stories.stop', { storyId })
  }, [])

  useEffect(() => abandon, [abandon])
```

- Что делает: `stories.stop` идёт для идущей сборки, когда компонент кнопки уходит с экрана, при reset во время сборки и
  при новом start или make, который её заменяет.
- Почему здесь: не записано
- Без него: уход с экрана, reset или второй start не посылали `stories.stop`, и запрос шёл до конца: три test-а
  «a build left behind is stopped» красные на прежнем `story-build.ts`.
- Требование: [Что делаем, п. 5](../issues/11-story-по-кнопке.md#что-делаем)
- Риски и пробелы test-ов: переключение на другой PR в Pull requests тоже останавливает сборку: у кнопки ключ по PR.

## 8. Сборка читает репозиторий Project-а из нескольких репозиториев

Code: `src/main/ipc/stories.ts:145-152` · key lines: 149, 150, 151

```ts
async function storyCheckouts(root: string): Promise<string[]> {
  const layout = await projectLayouts()
    .get(root)
    .catch(() => null)
  const repos = layout?.repos.map((repo) => repo.path) ?? []
  const worktrees = await Promise.all([root, ...repos].map((folder) => gitWorktrees(folder)))
  return [...repos, ...worktrees.flat()]
}
```

- Что делает: кроме корня Project-а, `stories.build` принимает папку репозитория, которую Profile перечисляет в
  `_resolved.repos`, и git worktree каждого из них; любая другая папка по-прежнему отказывается до запроса.
- Почему здесь: `src/main/ipc/stories.ts` назван в списке файлов Ticket-а; почему список репозиториев берётся из
  `_resolved.repos` — не записано
- Без него: в Project-е из нескольких репозиториев папка любого из них отказывалась до запроса: test «a Project over
  several repositories» красный на прежнем `src/main/ipc/stories.ts`.
- Требование: не записано
- Риски и пробелы test-ов: не записано

## 9. Вопрос о такой story идёт в репозиторий её PR

Code: `src/main/ipc/stories.ts:444-454` · key lines: 446, 448, 450, 453, 454

```ts
    // A story made by the button names the key it was kept under: the repository of its PR (ticket 11), whose clone
    // and worktrees are the checkouts, and where gh reads the PR. Otherwise the Project's root and its worktrees.
    const made = madeKey === undefined ? null : await madeStoryRepo(project.path, madeKey, story)
    if (made !== null && !made.ok) return { status: 'failed' as const, reason: made.reason }
    const base = made?.repo?.folder ?? project.path
    // The checkout the story's code was read from, as for a build (storyFolder): the PR's worktree when it is checked out.
    const chosen = await askFolder(base, folder, storyHeadOf(story, about), await gitWorktrees(base), (one) => headOf(one).catch(() => null))
    if (!chosen.ok) return { status: 'failed' as const, reason: chosen.reason }
    const vendor = readProjectSettings(store.dataDir(project.id)).defaultVendor ?? 'claude'
    const key = madeKey ?? (await answersKey(project.path, story))
    const where = made === null ? {} : { made: { repo: made.repo?.slug ?? null, root: project.path } }
```

- Что делает: renderer передаёт в `stories.ask` и `stories.answers` ключ, под которым main сохранил story по кнопке
  (`StoryMade.key`, например `shop/api#7`). Main проверяет, что это репозиторий Project-а и тот же PR, что в story, и
  берёт из него checkout (worktree с head story, иначе клон репозитория) и `gh pr view --repo` / `gh pr diff --repo`;
  ответы и отметки «прочитано» (`stories.marks`, Ticket 13) хранятся и читаются под этим же ключом. Story, открытая из файла, ключа не передаёт — как раньше.
- Почему здесь: review второго раунда PR #1923 — в Project-е из нескольких репозиториев вопрос о story PR не первого
  репозитория уходил в чужой PR: ключ ответов брал первый репозиторий, `gh pr view N` шёл без `--repo`, папка — только
  из worktree корня.
- Без него: contract test «a question about a story made by the button of a PR in a Project over several repositories»
  красный на прежнем коде — ответы двух репозиториев с одним номером PR смешивались, gh читал PR без `--repo`.
- Требование: [Что делаем](../issues/11-story-по-кнопке.md#что-делаем)
- Риски и пробелы test-ов: ключ живёт в памяти renderer-а рядом с открытой story; story той же PR, открытая заново из
  файла, задаёт вопрос по-старому.

## 10. Что сознательно не меняли

Безопасность запроса осталась как после PR #1907: `readFolders` с одним checkout-ом, read guard драйвера Claude Code,
без Harness plugin, только Read, Glob и Grep. Хранилище ответов (`store.ts`, ответы) и вид Story (`StoryView.tsx`) не
трогали: их правит PR #1917 (Ticket 12). Опубликовать story на GitHub нельзя. «Rebuild story» есть только в Pull
requests: на рамке Epic-а и карточке Ticket-а места под вторую кнопку нет. Цену первых сборок (пункт 8 «Что делаем»)
не измеряли: настоящие запросы к модели в этом Ticket-е не запускались.

## 11. Как проверено

`pnpm lint`, `pnpm typecheck`, `pnpm test` и gate fast — exit 0. Contract test `test/contract/story-by-button.test.ts`:
вход PR, PR коллеги без его слов и без его заголовка в инструкции, Stop во время запроса и во время чтения diff без
запроса и без записи, ответ Vendor-а после Stop отброшен, повторное нажатие без запроса, PR Ticket-а в репозитории из
`PR: <repo>#N`, head у каждой главы story Epic-а и код главы из её head, главы только известных Ticket-ов, причины на
русском, Codex без запроса, две сборки одного storyId. `test/contract/stories-handler.test.ts`: `stories.stop` доходит
до сборки по кнопке, пока main ждёт gh. Unit test-ы: `test/unit/story-progress.test.tsx` (уход с экрана, reset и второй
start останавливают сборку), `test/unit/story-entries.test.tsx` (bar на Canvas нарисован вне рамки и карточки, кнопка
неактивна, пока он открыт, фокус после Close на кнопке, репозиторий PR Ticket-а) и `test/unit/pr-inbox-view.test.tsx`
(«Failed», фокус после Close, «Code story» без `rebuild`). Вопрос о story по кнопке: `test/contract/stories-handler.test.ts` (два
репозитория с одним номером PR — свои ответы, свой checkout, `gh` с `--repo`; чужой репозиторий и чужой PR отказаны до
gh) и `test/unit/line-question.test.tsx` (ключ доходит до `stories.ask` и `stories.answers`, у story из файла его нет). Mutant-ы этих изменений в своей копии убиты тестами. e2e
`test/e2e/code-story.spec.ts` локально не запускался — только в CI; он снимает bar на рамке Epic-а и на карточке Ticket-а
во время сборки и после ошибки в обеих темах.
