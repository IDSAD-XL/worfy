# Code story — worfy-stuck-agents 10: Документы: переводы страниц Feature, термины CONTEXT.md, тексты Guide

Kind: pr · Epic: worfy-stuck-agents · Ticket: 10 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 02–09 поменяли поведение Autopilot, Session и Harness и правили только английские страницы Feature, поэтому
`docs/features/ru/` отстал. В CONTEXT.md не было слов для продолжения застрявшего Ticket-а, отложенного Ticket-а и хода
без признаков жизни. Guide в Topic Autopilot всё ещё говорил, что Ticket, оставшийся в работе, сразу останавливает Run с
`wave-unfinished`.

- Требование: [Что происходит](../issues/10-документы-перевод-context-guide.md#что-происходит)

## 2. Строка ограничений Guide: лестница вместо немедленной остановки

Code: `src/renderer/guide/topics/autopilot/en.json:104-104` · key lines: 104

```json
      "A Ticket of the Wave still in work 10 minutes after the turn, or the same Wave ready again: the run continues the Ticket in the next Wave, at most twice, then asks the Orchestrator to set it aside with Waits: owner, and stops with wave-unfinished or no-progress only if that fails too. A red main stops the run with main-red instead. The Orchestrator's own turn quiet for 30 minutes: turn-hung. Background tasks with no event and no change of their output files for an hour: background-stalled.",
```

- Что делает: называет лестницу (продолжение в следующей Wave не больше двух раз, просьба отложить с `Waits: owner`, только потом `wave-unfinished` или `no-progress`), остановку `main-red` и `turn-hung`; `background-stalled` остаётся остановкой. Та же строка 104 в `ru.json` говорит то же по-русски.
- Почему здесь: Ticket называет строку 104 `en.json` и `ru.json` ([Что делаем, п. 3](../issues/10-документы-перевод-context-guide.md#что-делаем)).
- Без него: Guide обещал бы остановку, которой после Ticket-а 05 нет, и молчал бы о `main-red` и `turn-hung`.
- Требование: [Что делаем, п. 3](../issues/10-документы-перевод-context-guide.md#что-делаем)
- Риски и пробелы test-ов: `topic.json` Topic-а по-прежнему держит sha `cb75f5a9` страниц, по которым Topic сверяли; его нет в файлах Ticket-а, и `scripts/guide-lag.mjs` будет показывать отставание Topic-а.

## 3. Test текста: обе версии называют лестницу и причины

Code: `test/unit/guide-autopilot.test.tsx:34-46` · key lines: 35, 38, 39, 44

```tsx
describe('the limit of a stuck run in the Topic Autopilot', () => {
  const line = (limits: readonly string[]): string => limits.find((limit) => limit.includes('wave-unfinished')) ?? ''

  it.each([
    ['en', en.underTheHood.limits, /continu/, /aside/],
    ['ru', ru.underTheHood.limits, /продолж/, /отлож/],
  ])('%s names the ladder, main-red, turn-hung and background-stalled', (_language, limits, continuation, setAside) => {
    const text = line(limits)
    expect(text).toMatch(continuation)
    expect(text).toMatch(setAside)
    for (const reason of ['wave-unfinished', 'main-red', 'turn-hung', 'background-stalled']) expect(text).toContain(reason)
  })
})
```

- Что делает: берёт строку ограничений с `wave-unfinished` в `en.json` и `ru.json` и требует в ней слова продолжения и откладывания и четыре причины.
- Почему здесь: Готово, когда, п. 3 просит unit test Guide; совпадение ключей en и ru уже проверяет `test/unit/guide-content.test.tsx` (`translationGaps`).
- Без него: старая строка вернулась бы при правке текста без красного test-а; до правки JSON test был красным на обоих языках.
- Требование: [Готово, когда](../issues/10-документы-перевод-context-guide.md#готово-когда)
- Риски и пробелы test-ов: test проверяет слова, а не смысл фразы; точность формулировки проверяет только чтение.

## 4. Три термина CONTEXT.md

Code: `CONTEXT.md:135-145` · key lines: 135, 139, 143

```markdown
**Ticket continuation**:
Wave, которой Run продолжает Ticket, оставшийся в работе после хода Wave (`wave-unfinished`) или вернувшийся той же Wave (`no-progress`): Ticket идёт в неё как возобновлённый, а команда Wave несёт строку worfy вида `Continuation 1 of 2 for ticket 05: …`. Не больше двух на Ticket за Run; новый Run считает с нуля.
_Avoid_: Auto-continue (это повтор хода после временной ошибки API или отказа Limits), retry, повтор

**Set-aside Ticket**:
Ticket, который Orchestrator по просьбе Run-а перевёл в `blocked` с `Waits: owner` после двух Ticket continuation-ов. Ждёт владельца, поэтому остальные Ticket-ы Epic-а идут дальше, а очередь Epic-ов переходит к следующему. Статус пишет Orchestrator командой `ticket block`, worfy его не пишет.
_Avoid_: пропущенный Ticket, skipped, отложенный (без `Waits: owner`)

**Quiet turn**:
Ход Session, от агента которой дольше порога нет признаков жизни — ни одного события, в том числе скрытого (hook, thinking); открытый запрос разрешения, идущий hook и меняющийся файл вывода живой background task тишиной не считаются. Порог — 10 минут для чипа `busy · quiet N min` и строки с Interrupt и Restart; ход Orchestrator-а в Run-е, тихий 30 минут, останавливает Run с причиной `turn-hung`. Тишина — пометка, а не статус: Session остаётся `busy`.
_Avoid_: silent (Silent mode — режим Project-а), hung (так зовётся только причина остановки `turn-hung`), idle
```

- Что делает: вводит Ticket continuation, Set-aside Ticket и Quiet turn с _Avoid_ — отделяет их от Auto-continue (повтор хода после ошибки API) и Silent mode (режим Project-а). Строка в Relationships говорит: не больше двух продолжений, потом откладывание, красный main — остановка.
- Почему здесь: Ticket задаёт три термина, их _Avoid_ и строку Relationships ([Что делаем, п. 2](../issues/10-документы-перевод-context-guide.md#что-делаем)); термины стоят рядом с Run и Run history, потому что это слова Run-а.
- Без него: в Ticket-ах и коде те же вещи звались бы по-разному, а «silent» и «hung» путались бы с Silent mode и `turn-hung`.
- Требование: [Что делаем, п. 2](../issues/10-документы-перевод-context-guide.md#что-делаем)
- Риски и пробелы test-ов: test-а у словаря нет; факты (потолок 2, пороги 10 и 30 минут) взяты с английских страниц `autopilot-faults.md` и `sessions.md`.

## 5. Что сознательно не меняли

`autopilot.md`, `autopilot-faults.md` и `gate-and-github.md` в `docs/features/ru/` догнали английские страницы целиком
(в том числе правки audit f, PR inbox и `Stop` в главном checkout-е, вышедшие раньше), и их метка перевода теперь — последний
commit английской страницы. `sessions.md` и `skills-agents-and-hooks.md` отстают ещё на 29 и 17 commit-ов вне этого Epic-а:
в них переведены только правки Ticket-ов 04, 06 и 07, а метка осталась старой, чтобы не спрятать остальное отставание
(правило раздела Translation в `docs/features/README.md`). `topic.json` Guide не тронут: его нет в файлах Ticket-а.

## 6. Как проверено

`pnpm exec vitest run test/unit/guide-autopilot.test.tsx` — exit 1 до правки JSON (оба языка красные), exit 0 после;
`node scripts/check-feature-docs.mjs` — exit 0; `node scripts/check-personal.mjs` — exit 0;
`pnpm lint` и `pnpm typecheck` — exit 0. `pnpm test` и gate fast на Mac агента — exit 1 и exit 2: 126 test-ов, которые
этот PR не трогает, падают от окружения агента (`TMPDIR` внутри `~/Library` и `GIT_CONFIG_PARAMETERS` с
`safe.bareRepository=explicit`). С `TMPDIR` в `/tmp` и без `GIT_CONFIG_PARAMETERS` gate fast — exit 2 на одном test-е
watcher-а (`test/contract/workflow-reader.test.ts`), который отдельно проходит, exit 0. Вердикт — `ci-ok` на PR.

## Проверить себя

1. Почему у `ru/sessions.md` осталась метка `9e80b208`, хотя в неё добавлен перевод правок Ticket-ов 04 и 06?
   - Ответ: метка — commit английской страницы, с которого сделан перевод; страница отстаёт ещё на commit-ы вне Epic-а, и новая метка спрятала бы это отставание от `feature-docs-lag.mjs`.
   - Строки: `docs/features/ru/sessions.md:3-3`
2. Чем Ticket continuation отличается от Auto-continue?
   - Ответ: Ticket continuation — новая Wave для Ticket-а, оставшегося в работе, не больше двух на Ticket за Run; Auto-continue повторяет ход после временной ошибки API или отказа Limits.
   - Строки: `CONTEXT.md:135-137`
3. Какая остановка по-прежнему наступает без лестницы?
   - Ответ: `background-stalled` (Ticket не назван) и `turn-hung`; а `main-red` останавливает Run вместо продолжения.
   - Строки: `src/renderer/guide/topics/autopilot/en.json:104-104`

## 7. Что нашёл review и что осталось

> VERIFIED
> Noted: docs/features/ru/sessions.md and ru/skills-agents-and-hooks.md still lag their English pages by 29 and 17 commits from outside this Epic (markers 9e80b208 and 3f662f1c kept on purpose); src/renderer/guide/topics/autopilot/topic.json source sha still cb75f5a9 (guide-lag will flag the topic); the gate fast in the verifier run was red (exit 2) on test/contract/cards-watch-edits.test.ts, a watcher test that passes alone, and the diff touches no watcher code.
> Review depth: low — the ticket sets it (rules-review-depth; the profile has no review.depth.wave)
> Review tokens: 125108
> Could not verify:
