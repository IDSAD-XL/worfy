# Code story — worfy-acceptance 03: Шаблон действия `ownerCheck` и канал `actions.ownerCheck`: решение владельца уходит Orchestrator-у

Kind: pr · Epic: worfy-acceptance · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

Решение владельца Pass или Fail по ручному пункту не могло уйти из worfy: не было ни действия с шаблоном текста, ни
канала, который отдаёт этот текст Orchestrator-у Project-а. Skill `owner-check` Harness-а (Ticket 04) уже ждал команду
`/worfy:owner-check <epic> <NN> <item> <pass|fail> <platform> <copy> <sha|->` с абзацем «Owner's words:».

- Требование: [Что делаем](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)

## 2. Действие и шаблон по умолчанию

Code: `src/shared/projects/action-templates.ts:122-122` · key lines: 122

```ts
  ownerCheck: '/worfy:owner-check {epic} {NN} {item} {verdict} {platform} {copy} {sha}',
```

- Что делает: шаблон «Record owner check» с plugin-ом Harness и без Harness; со старым Harness — пустая строка, и
  кнопка неактивна с причиной «Set the Record owner check template in Project settings». Новые placeholders `{item}`,
  `{verdict}`, `{platform}`, `{copy}` добавлены в `PLACEHOLDERS`; поле шаблона в Project settings появляется само:
  диалог рисует поля по списку `ACTIONS`.
- Почему здесь: Ticket называет `src/shared/projects/action-templates.ts`; форма команды — из skill-а Ticket-а 04.
- Без него: Project settings не держали бы текст действия, и кнопкам Ticket-а 05 нечего было бы отправить.
- Требование: [Что делаем, п. 1–2](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)
- Риски и пробелы test-ов: `ownerCheck` входит в `LATER_ACTIONS`: файл настроек, сохранённый раньше, читается с шаблоном
  по умолчанию, ответ Linked machine старой сборки — с пустым (test «reads settings saved before it…»).

## 3. Слова владельца — абзац-цитата после команды, не placeholder

Code: `src/shared/actions/render-template.ts:206-210` · key lines: 207, 209

```ts
export function ownerWordsParagraph(words: string): string {
  if (words.trim() === '') return "Owner's words:"
  const lines = words.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '').split('\n')
  return ["Owner's words:", ...lines.map((line) => (line.trim() === '' ? '>' : `> ${line}`))].join('\n')
}
```

- Что делает: каждая строка комментария владельца становится строкой цитаты `> …`; `ownerCheckState` ставит этот абзац
  после команды через пустую строку. Ни одна строка слов не начинает строку текста, поэтому `/worfy:…` внутри
  комментария не читается как своя команда.
- Почему здесь: spec, «Решение — шаблон действия»: «Комментарий владельца — не placeholder… Так шаблон не вставит
  свободный текст внутрь команды».
- Без него: слова попали бы в первую строку команды (mutant M7) или шли бы без цитаты (mutant M1) — оба красные на
  test-е «never lets the owner's words into the command».
- Требование: [Что делаем, п. 3](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)
- Риски и пробелы test-ов: пустые строки по краям комментария отбрасываются, внутренние становятся `>`; сам текст
  слов не меняется.

## 4. `{sha}` у «Record owner check» — короткий commit или `-`

Code: `src/shared/actions/render-template.ts:63-65` · key lines: 63, 64

```ts
  if (values.sha !== undefined && action === 'ownerCheck') {
    if (!OWNER_CHECK_SHA.test(values.sha)) return { ok: false, error: '{sha} is not a commit hash of 7 to 40 hex characters or -' }
  } else if (values.sha !== undefined && !SHA.test(values.sha)) return { ok: false, error: '{sha} is not a commit hash of 40 hex characters' }
```

- Что делает: `{sha}` действий над PR по-прежнему ровно 40 hex-символов; у «Record owner check» — 7–40 hex-символов
  или `-`, как в таблице слов skill-а `owner-check`.
- Почему здесь: `renderTemplate` уже проверял `{sha}` для PR-действий; spec: `sha` — «commit копии или `-`, когда он не
  известен». Файл не назван в «Где в коде» Ticket-а: это общий render шаблонов, рядом с `prReplyState`.
- Без него: `-` и короткий commit отказывались бы (mutant M5, красный на 7 test-ах).
- Требование: [Что делаем, п. 1](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 5. Схема канала проверяет каждое слово

Code: `src/shared/ipc/actions.ts:149-159` · key lines: 153, 154, 157, 158

```ts
export const ownerCheckDecisionSchema = z.object({
  epic: epicNameSchema,
  num: ticketNumSchema,
  item: z.number().int().positive(),
  itemText: z.string().min(1).max(OWNER_WORDS_MAX),
  verdict: z.enum(OWNER_CHECK_VERDICTS),
  platform: z.enum(OWNER_CHECK_PLATFORMS),
  copy: z.enum(OWNER_CHECK_COPIES),
  sha: z.string().regex(OWNER_CHECK_SHA),
  words: z.string().max(OWNER_WORDS_MAX),
})
```

- Что делает: `actions.ownerCheck` (`'project', 'write'`) принимает только значения skill-а: вердикт `pass`/`fail`,
  платформа `mac`/`windows`/`linux`, копия `stable`/`installed`/`dev`, commit или `-`; слова — свободный текст до
  10 000 символов. `itemText` — текст пункта, который видел владелец (строка очереди его показывает); Orchestrator-у он
  не уходит. Неверное значение отказывает до launcher-а.
- Почему здесь: Ticket, п. 3: «Значения placeholders проверяют схемы (как `githubRepoSchema`)»; текст уходит Session-у
  в bypassPermissions. `itemText` — раунд 2 ревью PR #2157: пункт адресован только номером, и пункт, добавленный выше,
  забрал бы решение.
- Без него: `verdict: 'passed'` дошёл бы до шаблона (mutant M4); Pass ушёл бы на чужой пункт (mutant B раунда 2).
- Требование: [Что делаем, п. 3–4](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)
- Риски и пробелы test-ов: предел 10 000 символов выбран без владельца; текст вместо hash-а — тоже: hash-а в строке
  очереди нет, а `itemTextHash` считает `node:crypto`.

## 6. Проверка пункта и Autopilot до отправки, «Sent» после неё

Code: `src/main/actions/launch.ts:499-518` · key lines: 500, 509, 510, 511, 513

```ts
  async ownerCheck(projectId: string, decision: SeenOwnerCheck): Promise<OwnerCheckResult> {
    if (this.autopilot?.running(projectId) === true) throw new Error(OWNER_CHECK_AUTOPILOT_HINT)
    const acceptance = this.deps.acceptance
    if (acceptance === undefined) throw new Error('The Acceptance queue is not running: the decision has nowhere to be kept')
    const state = ownerCheckState({ template: this.deps.settings(projectId).actionTemplates.ownerCheck, decision })
    if (!state.enabled) throw new Error(state.reason)
    const view = await this.deps.orchestrators.open(projectId)
    if (view.sessionId === null) throw new Error('The Orchestrator has no Session')
    const session = this.deps.registry.get(view.sessionId)
    const { epic, num, item, itemText, verdict } = decision
    await acceptance.check(projectId, { epic, num, item, itemText, verdict })
    if (this.autopilot?.running(projectId) === true) throw new Error(OWNER_CHECK_AUTOPILOT_HINT)
    const delivery = session.send(state.text)
    try {
      await acceptance.markSent(projectId, { epic, num, item, verdict })
    } catch (error) {
      // The text has gone: the skill writes the line whatever the mark. Without the mark the row shows no "Sent".
      console.warn(`[actions] ${projectId}: ${epic} ${ticketNumber(num)} item ${item} sent, but not kept as Sent`, error)
    }
    return { sessionId: view.sessionId, text: state.text, delivery }
```

- Что делает: пока идёт Autopilot — отказ с причиной; служба Acceptance проверяет пункт (`checkDecision`: ручной, ждёт
  владельца, текст тот, что видел владелец) и иначе отказывает, ничего не отправив; Autopilot спрашивается ещё раз после
  последнего `await`; текст уходит Orchestrator-у, в его очередь, пока идёт ход; «Sent» пишется только после `send`.
- Почему здесь: spec называет обработчиком `ActionLauncher` и путь Run wave; Q6 (а) — отказ при Autopilot. Порядок
  «проверка — отправка — Sent» — раунд 2 ревью PR #2157.
- Без него: решение шло бы в Orchestrator во время Run-а, начатого, пока Orchestrator открывался (mutant C); Session,
  закрытая перед отправкой, оставила бы «Sent» на 24 часа (mutant A); пункт, который не ждёт владельца, получил бы текст
  (mutant M6).
- Требование: [Что делаем, п. 4](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)
- Риски и пробелы test-ов: причина отказа — своя, `OWNER_CHECK_AUTOPILOT_HINT`. Если `markSent` бросит после отправки
  (Ticket-файл изменился в тот же миг), текст уже ушёл, а «Sent» нет — только предупреждение в log. Второе решение по
  тому же пункту, пока первое в очереди, тоже уходит: это для UI Ticket-а 05.

## 7. Как проверено

`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `node scripts/check-feature-docs.mjs` — exit 0; gate fast — exit
0. Contract test `test/contract/actions-owner-check.test.ts` идёт через настоящие `ActionLauncher`, `Orchestrators` и
Session registry на fake agent и настоящую службу Acceptance. Mutants M1–M7 и A–C раунда 2 по одному на поведение в
копии под `mktemp -d`, все красные.

## Проверить себя

1. Почему комментарий владельца не стал placeholder-ом `{words}`?
   - Ответ: placeholder можно поставить в любое место шаблона, в том числе внутрь команды; абзац-цитата после команды
     держит свободный текст вне её, и ни одна его строка не начинается с `/`.
   - Строки: `src/shared/actions/render-template.ts:209`
2. Владелец нажал Pass по пункту, который в это время уже отметили `[x]`. Что уйдёт Orchestrator-у?
   - Ответ: ничего: `checkDecision` службы бросает до `send`, канал отвечает отказом с причиной, «Sent» не пишется.
   - Строки: `src/main/actions/launch.ts:509-511`

## 8. Что нашёл review и что осталось

> VERIFIED — worfy-acceptance 03 (the ownerCheck action template «Record owner check» and the channel actions.ownerCheck: the owner's decision goes to the Orchestrator), head 6162fcc512458ed6d51e31e14c96098de8c81396 (e3dcbbcac + merge of main: tickets 02, #2159 ladder fix, #2160–#2162; no change to the PR's own files)
>
> Gate (depth medium, two rounds): verifier (lens: implementer's claims, sonnet) — FIX on one low only (item 2 named the other Autopilot constant), all claims CONFIRMED, 9 of 9 own mutants red, no command injection found (newlines, backticks, $( ), a line starting with /, unicode line separators); reviewer (correctness) — MERGE with four lows, all sent to round 2; round 2 (about 70 lines of src) checked by the Orchestrator.
>
> - What it gives: the Project action «Record owner check» renders `/worfy:owner-check {epic} {NN} {item} {verdict} {platform} {copy} {sha}` from the plugin template (empty, with a refusal, for an old Harness); the owner's words follow as a quoted «Owner's words:» paragraph and never enter the command line; the channel actions.ownerCheck (project, write; a read-only Linked machine is refused) checks every word, refuses while Autopilot runs in the Project (its own reason, asked again right before the send), refuses an item that is not a manual item waiting for the owner or whose text changed since the owner saw it («reload the Acceptance view»), sends the text to the Orchestrator and keeps «Sent» only after the send.
> - Fixed in round 2: «Sent» written only after a successful send (a Session closed meanwhile → error, no Sent); the decision carries the item text the owner saw (itemText, not a hash: the renderer has no node:crypto) and a changed item is refused; Autopilot re-checked after the last await; ticket item 2 reworded to OWNER_CHECK_AUTOPILOT_HINT.
> - Evidence: action-templates 16 tests red before; three round-2 contract tests red before (5 failures); 7 + 3 implementer mutants and 9 verifier mutants each red; 7 touched files 201 tests EXIT=0; verifier 22 files 975 tests EXIT=0; reviewer 26 files 1043 tests EXIT=0; pnpm lint, typecheck EXIT=0; gate fast green with the full pnpm test; check-feature-docs, story-check EXIT=0.
> - Debt (low): a second decision on the same item while the first is queued also reaches the Orchestrator (Pass then Fail → [x] and a rework ticket) — noted in the ticket's Итог for ticket 05's UI; if markSent throws after a successful send (the item stopped waiting in between), the text is gone but the caller sees an error.
> - Not verified: how a live Claude or Codex Orchestrator reads the command with the «Owner's words:» paragraph (no live agents run); the Project settings field drawn from ACTIONS not opened in the GUI.
>
> Decided without the owner (to confirm): the Autopilot refusal uses its own text OWNER_CHECK_AUTOPILOT_HINT (the general one says «run a Wave by hand»); «Sent» only after the send; the item matched by its text the owner saw; with no words the paragraph is only the heading «Owner's words:»; the words limit 10 000 characters; {sha} 7–40 hex or «-» for this action only (PR actions keep 40).
