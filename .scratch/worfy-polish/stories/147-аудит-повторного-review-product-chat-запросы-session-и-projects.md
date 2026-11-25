# Code story — worfy-polish 147: Аудит повторного review: Product chat, запросы Session и Projects

Kind: pr · Epic: worfy-polish · Ticket: 147 · PR: - · Language: ru

## 1. Что было не так

Пять находок аудита повторного review. После Resume чат Product Session терял вопросы `AskUserQuestion` с ответом
владельца (65). Окно спрашивало main об открытых запросах только при `needs_permission`, а запрос background task
приходит, пока Session `idle` (184). Chip node-а другой темы ничего не делал (63). Подсказки частей карточки Project-а
не доходили до клавиатуры и экранного диктора (145). Удаление Project-а закрывало Session-ы и Orchestrator вложенного
repository со своим Profile и называло его в notice (130).

- Требование: [Что происходит](../issues/147-аудит-повторного-review-product-chat-запросы-session-и-projects.md#что-происходит)

## 2. Чат Product Session рисует вопрос с ответом из файла Session

Code: `src/renderer/session/product-session.ts:90-102` · key lines: 92, 97, 98

```ts
export function productChatItems(items: readonly TranscriptItem[]): TranscriptItem[] {
  const asked = new Set<string>()
  for (const item of items) if (item.kind === 'extension' && item.event.type === 'question_request' && item.event.toolUseId !== null) asked.add(item.event.toolUseId)
  const drawn: TranscriptItem[] = []
  for (const item of items) {
    if (shownInProductChat(item)) drawn.push(item)
    else if (item.kind === 'tools') {
      const calls = item.calls.filter((call) => !asked.has(call.id) && answeredQuestion(call) !== null)
      if (calls.length > 0) drawn.push({ ...item, calls })
    }
  }
  return drawn
}
```

- Что делает: из group-ы tool calls оставляет только вызовы `AskUserQuestion`, у которых есть результат без ошибки и хотя бы один ответ (`answeredQuestion`); вызов, у которого в окне есть живой `question_request` с тем же `toolUseId`, пропускается. `Transcript.tsx` рисует такие вызовы карточкой `ResolvedQuestions` — той же разметкой, что отвеченная живая карточка (`QuestionCard.tsx`).
- Почему здесь: Ticket называет `shownInProductChat` в `product-session.ts`; фильтр по одной строке не может знать о живом запросе, поэтому добавлен проход по всему списку.
- Без него: после Resume в чате нет ни вопроса, ни выбора владельца.
- Требование: [Что делаем, п. 1](../issues/147-аудит-повторного-review-product-chat-запросы-session-и-projects.md#что-делаем)
- Риски и пробелы test-ов: ответ читается из текста результата (`"<вопрос>"="<ответ>"`, как в `questionResultText` fake agent-а); если Claude Code сменит формулировку, ответов не найдётся и вопрос не нарисуется. Отклонённый и неотвеченный вопросы не рисуются. Find чата в таких карточках не ищет.

## 3. Окно спрашивает об открытых запросах один раз при монтировании

Code: `src/renderer/session/open-requests.ts:66-81` · key lines: 69, 71, 72, 76, 78

```ts
  const checked = useRef<string | null>(null)
  useEffect(() => {
    // A closed Session has no live requests, and main refuses to be asked about it.
    if (sessionId === null || state === 'closed' || checked.current === sessionId) return
    // At needs_permission the stretch's own ask below is the one.
    if (missing) return
    if (!none) {
      checked.current = sessionId
      return
    }
    const timer = setTimeout(() => {
      checked.current = sessionId
      void loadOpenRequests(sessionId)
    }, ASK_OPEN_REQUESTS_AFTER_MS)
    return () => clearTimeout(timer)
  }, [sessionId, state, missing, none])
```

- Что делает: один раз на Session и монтирование, через `ASK_OPEN_REQUESTS_AFTER_MS`, вызывает `loadOpenRequests`, если в окне нет открытых запросов; state любой, кроме `closed` (у закрытой Session живых запросов нет, main отвечает ошибкой «No live Session», а badge на холсте монтируется часто — review round 1). При `needs_permission` спрашивает прежний эффект, и `checked` не даёт спросить второй раз.
- Почему здесь: Ticket называет `open-requests.ts:45-75`.
- Без него: запрос background task при `idle` Session не виден в новом окне и истекает через 60 минут.
- Требование: [Что делаем, п. 2](../issues/147-аудит-повторного-review-product-chat-запросы-session-и-projects.md#что-делаем)
- Риски и пробелы test-ов: на каждое открытие Session view — один лишний IPC-вызов `agent.requests`; строка «waits for an answer this window cannot show» по-прежнему только при `needs_permission`.

## 4. Chip другой темы переключает карту

Code: `src/renderer/session/ProductSessionPanel.tsx:154-172` · key lines: 155, 158, 160, 163, 165

```tsx
  // Held until the map of the chip's topic is drawn, so the copy the map reads is never let go in between.
  const { topic, error } = useMindMap(projectId, wanted?.topic)
  useEffect(() => {
    if (wanted === null) return
    if (shown?.name === wanted.topic) {
      // Its map is drawn and listens now (MindMap.tsx): the pick acts on it.
      pickNode(wanted)
      wantTopic(key, null)
    } else if (topic !== undefined && topic !== null) {
      followTopic(key, wanted.topic)
    } else if (topic === null || error !== undefined) {
      showToast({
        kind: 'error',
        key: `mind-map-topic:${wanted.topic}`,
        text: error === undefined ? `The Mind map has no topic "${wanted.topic}"` : `Could not read the Mind map topic "${wanted.topic}": ${error}`,
      })
      wantTopic(key, null)
    }
  }, [key, shown, wanted, topic, error])
```

- Что делает: подписка на `useMindMapFocus` запоминает pick node-а темы, которую карта не показывает. Тема читается; прочитана — карта следует за ней (`followTopic`, общий store панели и заголовка); когда карта этой темы нарисована, pick повторяется, и `MindMap` выбирает node. Темы нет или она не читается — toast с её именем, карта остаётся.
- Почему здесь: Ticket называет `ProductSessionPanel.tsx` (`followed`) и `MindMap.tsx:1093-1096`; `MindMap` слушает только свою тему, поэтому переключение — в панели.
- Без него: клик по chip ничего не делает и ничего не говорит.
- Требование: [Что делаем, п. 3](../issues/147-аудит-повторного-review-product-chat-запросы-session-и-projects.md#что-делаем)
- Риски и пробелы test-ов: копия темы держится до того, как карта её нарисует, чтобы не перечитывать; test проверяет выбор node-а в jsdom, без e2e.

## 5. Подсказки частей — описание кнопки карточки

Code: `src/renderer/shell/sidebar/ProjectsSection.tsx:380-389` · key lines: 381, 388

```tsx
  const describedBy = useId()
  const hints = pulse === undefined ? [] : pulseParts(pulse).map((part) => `${part.hint}.`)
  return (
    <>
      <button
        type="button"
        className="w-row"
        style={pulse === undefined ? undefined : styles.card}
        aria-current={selected ? 'true' : undefined}
        aria-describedby={hints.length === 0 ? undefined : describedBy}
```

- Что делает: тексты подсказок частей (`pulseParts`) лежат в скрытом `span` рядом с кнопкой, и `aria-describedby` кнопки указывает на него. Внутри `<button>` фокусируемых элементов не добавилось.
- Почему здесь: Ticket называет `ProjectsSection.tsx:325-345`, `:375-380`.
- Без него: подсказки «N busy», «N needs you» видны только мыши.
- Требование: [Что делаем, п. 4](../issues/147-аудит-повторного-review-product-chat-запросы-session-и-projects.md#что-делаем)
- Риски и пробелы test-ов: test проверяет текст по `aria-describedby`; как его читает VoiceOver, не проверено.

## 6. Вложенный Project со своим Profile не входит в удаление

Code: `src/main/projects/remove.ts:146-158` · key lines: 147, 151, 153, 157

```ts
async function listedInside(deps: Pick<ProjectRemovalDeps, 'projects' | 'profileDir'>, project: ListedProject, profileDir: string): Promise<{ sharing: ListedProject[]; own: ListedProject[] }> {
  const inside = deps.projects.list().filter((other) => other.id !== project.id && within(other.path, project.path))
  const owns = await Promise.all(
    inside.map(async (other) => {
      try {
        return !sameFolder(await deps.profileDir(other.path), profileDir)
      } catch {
        return false
      }
    }),
  )
  return { sharing: inside.filter((_, index) => !owns[index]), own: inside.filter((_, index) => owns[index]) }
}
```

- Что делает: Project внутри папки удаляемого спрашивает свой Profile (`deps.profileDir`); другой Profile — он в `own`: его Orchestrator не останавливается, его Session-ы не закрываются (`closeInside` пропускает папки `own`), `alsoListed` и notice его не называют. Profile, который нельзя определить, считается общим, как раньше.
- Почему здесь: Ticket называет `remove.ts:137-139`, `:180-186`, `:225-265`.
- Без него: удаление monorepo закрывает Session-ы и Orchestrator отдельного repository внутри него.
- Требование: [Что делаем, п. 5](../issues/147-аудит-повторного-review-product-chat-запросы-session-и-projects.md#что-делаем)
- Риски и пробелы test-ов: на каждый вложенный Project — один вызов `bin/profile`; contract test-ы идут через настоящие `bin/profile` и `bin/project-connect`, а случай «Profile не определить» — через `profileDir`, который отказывает для вложенной папки.

## 7. Что сознательно не меняли

- Прочие tool-строки в чате Product Session не показываются (Ticket, «Вне скоупа»).
- `test/unit/session-view.test.tsx`: test «a Session that waits for no answer asks main for no request» теперь ждёт один вызов при монтировании — так требует п. 2.

## 8. Как проверено

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (924 files, 20867 tests passed).
- `gate fast` — exit 0, на первом head и на head review round 1.
- Round 1: `pnpm lint`, `pnpm typecheck` и 7 test-файлов review (waiting-requests, product-transcript, session-view, question-card, product-session-panel, project-pulse-line, projects-remove) — exit 0.
- Review round 1: test закрытой Session красный до правки; test ответа с `", ` внутри и test неизвестного Profile ловят свои мутанты (конец первого ответа на первом `", `; вложенный Project при ошибке `bin/profile` считается независимым).
- Новые test-ы красные на origin/main: `product-transcript`, `waiting-requests`, `product-session-panel`, `project-pulse-line`, `projects-remove`.

## Проверить себя

1. Почему вопрос, заданный в этом окне, не рисуется дважды — карточкой запроса и карточкой из истории?
   - Ответ: вызов, `toolUseId` которого есть у живого `question_request`, отбрасывается; его рисует карточка запроса.
   - Строки: `src/renderer/session/product-session.ts:92-97`
2. Почему pick node-а повторяется только когда `shown?.name === wanted.topic`, а не сразу после чтения темы?
   - Ответ: `MindMap` слушает pick только своей темы; пока карта новой темы не нарисована, pick ушёл бы карте старой темы и был бы пропущен.
   - Строки: `src/renderer/session/ProductSessionPanel.tsx:158-163`
3. Что будет с Session-ом вложенного Project-а, Profile которого `bin/profile` не смог определить?
   - Ответ: он считается общим с удаляемым: его Orchestrator останавливается, Session закрывается, как до изменения.
   - Строки: `src/main/projects/remove.ts:150-154`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-polish 147 (audit re-review findings 63, 65, 184, 130, 145: Product chat, Session requests, Projects), head 4144e6b6c024d3ebf1dd124165b084f0a020d9aa
>
> Gate (depth medium, two rounds): reviewer (lens: correctness) — MERGE with four lows; the Orchestrator sent three back (the destructive path's defensive branch untested and its comment stale; a mount-time request for closed Sessions; no test with «", » inside an answer); round 1 checked by the Orchestrator against the implementer's report and the diff.
>
> - What the user sees: the Product Session chat shows a question answered before Resume as the answered card with the chosen option; a window that opens a Session (not closed) asks main once for its open requests, so a waiting question or permission shows without a state change; a chip of another topic's node switches the Mind map to that topic (a toast when it is gone or unreadable); the Project card's part tooltips are read as its button's description; removing a Project folder no longer stops, closes or names a nested Project that has its own Profile (one whose Profile cannot be told still counts as shared and is closed).
> - Evidence: new tests red on origin/main (7), the reviewer's 9 of 11 mutants caught and both survivors killed in round 1; 233 tests of the 7 files EXIT=0; pnpm lint, typecheck, test EXIT=0 (924 files) on the first head; gate fast green on 24abd2935; story-check ok; the answer format checked against the Claude Code binary of SDK 0.3.322.
> - Not verified: reading a real Session file's answered question; how VoiceOver reads the description; no screenshots (no done item is about looks).
> - Noted (low, no fix): find in the Product chat does not search the read-back questions; a chip switches the topic of two open chats of one Project.
>
> Decided without the owner (to confirm): toast texts «The Mind map has no topic "<name>"» and «Could not read the Mind map topic "<name>": <error>»; a declined or unanswered question from the file is not drawn; a nested Project whose Profile cannot be determined counts as sharing it; a closed Session is not asked for requests on mount.
