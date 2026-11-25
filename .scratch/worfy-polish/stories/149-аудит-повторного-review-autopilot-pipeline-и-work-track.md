# Code story — worfy-polish 149: Аудит повторного review: Autopilot, Pipeline и Work track

Kind: pr · Epic: worfy-polish · Ticket: 149 · PR: - · Language: ru

## 1. Что было не так

Пять finding-ов аудита повторного review. Два — пробелы test-ов Autopilot: запись вызовов `git push` при возврате
Session человеку посреди turn-а (53) и остановка run-а с причиной `waits-owner`, когда все следующие Epic-и идут на
другой Machine (55); mutant-ы в обоих местах выживали. Три — ошибки показа Ticket-а: у Ticket-а на нескольких
repository время входа в Stage бралось только у отстающих repository (206); в цепочке из трёх repository первый ждал
release второго, и его красный CI прятался за Stage `release` (209); marks строк CI и статусов в Work track лежали
друг на друге (212).

- Требование: [Что происходит](../issues/149-аудит-повторного-review-autopilot-pipeline-и-work-track.md#что-происходит)

## 2. Время входа Ticket-а в Stage и порядок строк Release

Code: `src/shared/workflow/pipeline.ts:303-316` · key lines: 305, 309, 316

```ts
  const own = releases.length > 0 ? { release: releases.map(({ repo, kind, ref, state }) => ({ repo, kind, ref, state })) } : {}
  /** The lines not met that a repository waits for: of any repository but those in `not` (itself, and those after it). */
  const awaited = (not: readonly (string | null)[]) => releases.filter((release) => release.state !== 'released' && !not.includes(release.repo))
  const repos = facts.repos ?? []
  if (repos.length === 0) return { ...stageOfOne(facts, pipeline, awaited([facts.repo ?? null])).stage, ...own }
  const names = repos.map((repo) => repo.repo)
  const judged = repos.map((repo, at) => stageOfOne({ ...facts, headSha: repo.headSha, pr: repo.pr, marks: repo.marks, deploys: repo.deploys }, pipeline, awaited(names.slice(at))))
  const each = judged.map(({ stage }) => stage)
  const index = Math.min(...each.map((stage) => stage.index))
  const behind = each.filter((stage) => stage.index === index)
  // Every repository on the Ticket's Stage has passed the same Stages before it.
  const first = behind[0]!
  // A repository on the Stage entered it at its own enteredAt (a rework counts); one past it, when it reached it.
  const entered = latest(judged.map(({ stage, reached }) => (stage.index === index ? timeOf(stage.enteredAt) : (reached[index] ?? null))))
```

- Что делает: `awaited` получает список repository, чьи строки `Release:` не ждать: для repository на месте `at` —
  он сам и все после него в строках `Repo:` (`names.slice(at)`). Время входа Ticket-а — самое позднее среди всех
  repository: у стоящего на Stage-е Ticket-а — его `enteredAt`, у ушедшего вперёд — `reached[index]`, момент, когда он
  дошёл до этого Stage-а.
- Почему здесь: Ticket называет `stageOf`, `awaited`, `behind`, `entered` в «Где в коде». Порядок строк `Repo:` —
  порядок merge-ей, библиотека первой (ADR-0104, пункт 1).
- Без него: Ticket показывает «на CI с 10:00», хотя второй repository пришёл туда в 13:00, и «stuck» появляется на три
  часа раньше; `lib-a` ждёт release `lib-b`, который сам ждёт `lib-a`, и красный CI `lib-a` не виден.
- Требование: [Что делаем, п. 3 и 4](../issues/149-аудит-повторного-review-autopilot-pipeline-и-work-track.md#что-делаем)
- Риски и пробелы test-ов: строки `Release:` библиотеки, которой нет среди `Repo:`, по-прежнему ждут все repository
  (решено без владельца); test проверяет это одной строкой.

## 3. Когда repository дошёл до каждого Stage-а

Code: `src/shared/workflow/pipeline.ts:393-399` · key lines: 394, 397

```ts
  const times: (number | null)[] = [timeOf(facts.statusAt)]
  const reached: (number | null)[] = []
  let index = pipeline.length - 1
  for (const [at, stage] of pipeline.entries()) {
    reached.push(latest(times))
    const verdict = judge(stage)
    if (!verdict.passed) {
```

- Что делает: перед суждением о каждом Stage-е `stageOfOne` записывает самое позднее время уже пройденных Stage-ей
  (и `statusAt`): это момент, когда repository дошёл до этого Stage-а. Массив уходит в `stageOf` рядом со Stage-ем.
- Почему здесь: время входа в Stage уже считалось этой же формулой по `times` для Stage-а, на котором repository стоит;
  `reached` даёт то же для Stage-ей, которые он прошёл.
- Без него: у ушедшего вперёд repository нет времени входа в более ранний Stage, и `stageOf` знал бы только время
  прохождения, позже реального входа.
- Требование: [Что делаем, п. 3](../issues/149-аудит-повторного-review-autopilot-pipeline-и-work-track.md#что-делаем)
- Риски и пробелы test-ов: Stage, пройденный без известного времени (например, до merge-а), не сдвигает `reached`.

## 4. Группы marks в Work track

Code: `src/shared/work-track/lanes.ts:220-237` · key lines: 225, 227, 231

```ts
export function markGroups(row: MarkRow, bounds: { start: number; end: number }, widthPx: number): MarkGroup[] {
  const width = widthPx > 0 ? widthPx : UNMEASURED_TRACK_PX
  const px = (time: number): number => ((Math.min(Math.max(time, bounds.start), bounds.end) - bounds.start) / (bounds.end - bounds.start)) * width
  const groups: { group: MarkGroup; right: number }[] = []
  for (const span of [...row.marks].sort((a, b) => a.start - b.start)) {
    const right = Math.max(px(span.end), px(span.start) + MARK_PX[row.id])
    const last = groups.at(-1)
    if (last !== undefined && px(span.start) < last.right) {
      const { group } = last
      group.marks.push(span)
      group.end = Math.max(group.end, span.end)
      if (badness(row.id, span) >= badness(row.id, group.lead)) group.lead = span
      last.right = Math.max(last.right, right)
    } else {
      groups.push({ group: { marks: [span], start: span.start, end: span.end, lead: span }, right })
    }
  }
  return groups.map(({ group }) => group)
```

- Что делает: marks строки в порядке начала; mark, который начинается левее правого края предыдущих (их конец или
  начало плюс ширина mark-а: 4 px у CI, 8 px у статуса), входит в их группу. `lead` — mark с худшим исходом, при
  равенстве — более поздний: его цвет у группы и его панель по клику. `MarkRows` в `Lanes.tsx` рисует группу одной
  mark-ой со счётчиком, tooltip — счётчик и строка на каждый mark.
- Почему здесь: Ticket называет `Lanes.tsx` и unit test `test/unit/work-track-lanes.test.ts`, который проверяет модель
  `src/shared/work-track/lanes.ts`; расчёт чистый и проверяется без DOM.
- Без него: 17 смен статуса за минуту — одна точка, красный CI run под зелёными не виден.
- Требование: [Что делаем, п. 5](../issues/149-аудит-повторного-review-autopilot-pipeline-и-work-track.md#что-делаем)
- Риски и пробелы test-ов: до замера трека (и в test DOM) ширина берётся 1000 px; счётчик шире mark-а и может задеть
  соседнюю группу ближе 14 px. Вид в живом приложении не снимался.

## 5. Test возврата Session человеку посреди turn-а

Code: `test/contract/orchestrator-continue.test.ts:585-600` · key lines: 589, 594, 598

```ts
  it('a Session given back to the person mid-turn keeps the calls the turn made while a run had it: a push without its result is not retried after a 529', async () => {
    const h = harness({ script: 'orchestrator-continue-handback-push' })
    await h.open()
    // A run owns the Session when the turn starts and while the turn runs `git push`.
    h.setUnattended(true)
    h.write(PERSON)
    await until(() => h.windowEvents.some((event) => event.type === 'tool_use'), 'the push of the turn')
    await tick()
    // The person takes the Session back before the push's result; the turn then ends with a 529.
    h.setUnattended(false)
    h.releases.release('handback')
    await until(() => h.results().length === 1, 'the turn with the error')
    await tick(200)
    expect(h.timers.all).toEqual([])
    expect(h.continuer.wait(PROJECT)).toBeNull()
    expect(h.notices()).toEqual(['worfy: not retried: `git push origin demo/01` may or may not have run'])
```

- Что делает: run владеет Session при старте turn-а и во время `git push`; до результата push-а Session возвращается
  человеку, turn падает с 529. Test ждёт: таймера нет, «continue» не отправлен, строка «not retried».
- Почему здесь: Ticket просит test рядом с test-ом разрешения посреди turn-а; fake-скрипт
  `orchestrator-continue-handback-push.jsonl` держит turn на release `handback`, чтобы test успел сменить владельца.
- Без него: mutant `if (!owned) entry.retry.observe(event)` в `orchestrator-continue.ts` выживал, и Autopilot мог бы
  повторить незавершённый push.
- Требование: [Готово, когда — 53](../issues/149-аудит-повторного-review-autopilot-pipeline-и-work-track.md#готово-когда)
- Риски и пробелы test-ов: код модуля не менялся. Test 55 (`test/contract/autopilot-queue.test.ts`) так же закрывает
  mutant `return effect` в `run.ts`.

## 6. Что сознательно не меняли

`src/main/agent/orchestrator-continue.ts` и `src/main/autopilot/run.ts`: поведение было верным, finding-и 53 и 55 —
только пробелы test-ов. Другие строки Work track (deploy, gate) без группировки — вне scope Ticket-а.

## 7. Как проверено

Новые test-ы 206, 209 и 212 красные на origin/main до правки, зелёные после. Mutant-ы 53 и 55 — красные test-ы, файлы
восстановлены. `pnpm lint && pnpm typecheck && pnpm test` и gate fast — exit-коды в отчёте исполнителя и в Evidence
строках Ticket-а.

## Проверить себя

1. Почему для ушедшего вперёд repository берётся время входа в Stage, а не время его прохождения?
   - Ответ: Ticket вошёл в Stage, когда последний repository дошёл до него; время прохождения позже входа и сдвинуло
     бы «на Stage с» вперёд.
   - Строки: `src/shared/workflow/pipeline.ts:316-316`
2. Почему в цепочке lib-a, lib-b, app красный CI lib-a теперь виден?
   - Ответ: lib-a стоит первой в строках `Repo:` и не ждёт строк lib-b и app, поэтому её CI судится, а не пропускается
     ожиданием release.
   - Строки: `src/shared/workflow/pipeline.ts:309-309`
3. Какой mark откроет клик по группе из зелёных CI run-ов с одним красным?
   - Ответ: красный: `lead` — mark с худшим исходом, при равенстве более поздний.
   - Строки: `src/shared/work-track/lanes.ts:231-231`
