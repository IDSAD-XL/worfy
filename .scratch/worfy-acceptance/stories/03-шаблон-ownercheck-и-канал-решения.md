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

Code: `src/shared/ipc/actions.ts:147-156` · key lines: 151, 154, 155

```ts
export const ownerCheckDecisionSchema = z.object({
  epic: epicNameSchema,
  num: ticketNumSchema,
  item: z.number().int().positive(),
  verdict: z.enum(OWNER_CHECK_VERDICTS),
  platform: z.enum(OWNER_CHECK_PLATFORMS),
  copy: z.enum(OWNER_CHECK_COPIES),
  sha: z.string().regex(OWNER_CHECK_SHA),
  words: z.string().max(OWNER_WORDS_MAX),
})
```

- Что делает: `actions.ownerCheck` (`'project', 'write'`) принимает только значения skill-а: вердикт `pass`/`fail`,
  платформа `mac`/`windows`/`linux`, копия `stable`/`installed`/`dev`, commit или `-`; слова — свободный текст до
  10 000 символов. Неверное значение отказывает до launcher-а.
- Почему здесь: Ticket, п. 3: «Значения placeholders проверяют схемы (как `githubRepoSchema`)»; текст уходит Session-у
  в bypassPermissions.
- Без него: `verdict: 'passed'` дошёл бы до шаблона (mutant M4).
- Требование: [Что делаем, п. 3–4](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)
- Риски и пробелы test-ов: предел 10 000 символов на слова выбран без владельца.

## 6. Отказ при Autopilot, «Sent» до отправки текста

Code: `src/main/actions/launch.ts:489-501` · key lines: 490, 498, 499

```ts
  async ownerCheck(projectId: string, decision: OwnerCheckDecision): Promise<OwnerCheckResult> {
    if (this.autopilot?.running(projectId) === true) throw new Error(OWNER_CHECK_AUTOPILOT_HINT)
    const acceptance = this.deps.acceptance
    if (acceptance === undefined) throw new Error('The Acceptance queue is not running: the decision has nowhere to be kept')
    const state = ownerCheckState({ template: this.deps.settings(projectId).actionTemplates.ownerCheck, decision })
    if (!state.enabled) throw new Error(state.reason)
    const view = await this.deps.orchestrators.open(projectId)
    if (view.sessionId === null) throw new Error('The Orchestrator has no Session')
    const session = this.deps.registry.get(view.sessionId)
    await acceptance.markSent(projectId, { epic: decision.epic, num: decision.num, item: decision.item, verdict: decision.verdict })
    const delivery = session.send(state.text)
    return { sessionId: view.sessionId, text: state.text, delivery }
  }
```

- Что делает: пока идёт Autopilot — отказ с причиной; иначе текст уходит Orchestrator-у Project-а, в его очередь, пока
  идёт ход (`delivery: 'queued'`). Перед отправкой служба Acceptance (`markSent`, Ticket 01) записывает «Sent»; для
  пункта, который не ручной или не ждёт владельца, она бросает ошибку — и текст не уходит.
- Почему здесь: spec называет обработчиком `ActionLauncher` и путь Run wave; Q6 (а) — отказ при Autopilot.
- Без него: решение шло бы в Orchestrator во время Run-а Autopilot (mutant M2), или «Sent» не появлялось бы (mutant
  M3), или текст ушёл бы по пункту, который не ждёт владельца (mutant M6).
- Требование: [Что делаем, п. 4](../issues/03-шаблон-ownercheck-и-канал-решения.md#что-делаем)
- Риски и пробелы test-ов: причина отказа — своя, `OWNER_CHECK_AUTOPILOT_HINT`, а не `AUTOPILOT_RUNNING_HINT` из
  Ticket-а: текст той говорит про Wave. Если `send` бросит после `markSent`, «Sent» останется без отправки и через 24 часа
  станет «Not recorded yet» с Send again.

## 7. Как проверено

`pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `node scripts/check-feature-docs.mjs` — exit 0; gate fast — exit
0. Contract test `test/contract/actions-owner-check.test.ts` идёт через настоящие `ActionLauncher`, `Orchestrators` и
Session registry на fake agent и настоящую службу Acceptance. Mutants M1–M7 по одному на поведение в копии под
`mktemp -d`, все красные.

## Проверить себя

1. Почему комментарий владельца не стал placeholder-ом `{words}`?
   - Ответ: placeholder можно поставить в любое место шаблона, в том числе внутрь команды; абзац-цитата после команды
     держит свободный текст вне её, и ни одна его строка не начинается с `/`.
   - Строки: `src/shared/actions/render-template.ts:209`
2. Владелец нажал Pass по пункту, который в это время уже отметили `[x]`. Что уйдёт Orchestrator-у?
   - Ответ: ничего: `markSent` бросает до `send`, канал отвечает отказом с причиной.
   - Строки: `src/main/actions/launch.ts:498-499`
