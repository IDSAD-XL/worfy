# Code story — worfy-polish 135: Одноразовые вызовы Haiku переходят на Haiku 5.5; thinking больше не отменяет Suggestion Terminal AI

Kind: pr · Epic: worfy-polish · Ticket: 135 · PR: - · Language: ru

## 1. Что было не так

Suggestion, Next command на haiku и narrator Live summary звали Haiku 4.5 по ID и выключали thinking. Владелец решил
перейти на Haiku 5.5: она в 10 раз дешевле, а Haiku 4.5 могут снять. У Haiku 5.5 thinking не выключается: каталог моделей
Claude Code 2.1.322 даёт ей `rejects_disabled_thinking`. По правилу ADR-0058, пункт 3, Suggestion отменялась, как только
поток ответа начинался с thinking, — после перехода отменялась бы каждая Suggestion от модели.

- Требование: [Что происходит](../issues/135-одноразовые-вызовы-haiku-на-haiku-5-5.md#что-происходит)

## 2. Одна модель Haiku, по ID, при low effort

Code: `src/main/vendors/claude/terminal-ai.ts:70-82` · key lines: 70, 77, 78

```ts
export const HAIKU_MODEL_ID = 'claude-haiku-5-5'

/** What one request sets at claim(): the feature's model at low effort, Haiku by its id. */
export function claimOptions(feature: TerminalAiFeature, settings: TerminalAiSettings, dataDir: string): ClaimOptions {
  const model = featureModel(feature, settings)
  return {
    cwd: assistDir(dataDir),
    model: model === 'haiku' ? HAIKU_MODEL_ID : model,
    settings: { effortLevel: 'low' },
    appendSystemPrompt: FEATURE_PROMPTS[feature],
    title: FEATURE_TITLES[feature],
  }
}
```

- Что делает: Suggestion и Next command на haiku называют `claude-haiku-5-5` и, как Sonnet, идут при
  `effortLevel: 'low'`. `maxThinkingTokens: 0` больше нет, и `coldQueryOptions` его больше не переносит. Константа
  `HAIKU_WITHOUT_THINKING` переименована в `HAIKU_MODEL_ID`: прежнее имя обещало модель без thinking.
- Почему здесь: Ticket называет `terminal-ai.ts` и `claimOptions`. ID, а не alias, — слова владельца в просьбе. Effort
  `low` — потому что Claude Code 2.1.322 перечисляет у Haiku 5.5 `effort` и `per_turn_effort` (effort по умолчанию —
  `medium`); это прочитано в каталоге моделей бинарника pinned SDK, живой запрос не делался.
- Без него: модель осталась бы Haiku 4.5; или, с alias `haiku`, модель менялась бы молча при обновлении Claude Code.
- Требование: [Что делаем, п. 1, 3, 6](../issues/135-одноразовые-вызовы-haiku-на-haiku-5-5.md#что-делаем)
- Риски и пробелы test-ов: unit test-ы закрепляют ID, effort и отсутствие `maxThinkingTokens` в `claim()` и в
  холодном `query()`. Примет ли живой Claude Code `effortLevel` для Haiku 5.5 без `option_not_applied`, test не знает —
  это покажет скрипт замера (строка `option_not_applied` в его итоге).

## 3. Thinking больше не заканчивает Suggestion

Code: `src/main/terminal-ai/assist.ts:483-516` · key lines: 484, 509, 511

```ts
        if (message.startsWith('option_not_applied')) {
          this.log(`[terminal-ai] ${feature}: option_not_applied; the answer is taken`)
          return
        }
        refusal = refusalCode(message)
        local.abort('not-claimed')
      },
    )

    const aborted = new Promise<never>((_, reject) => {
      const fail = (): void => reject(new Aborted(reasonOf(local.signal)))
      if (local.signal.aborted) fail()
      else local.signal.addEventListener('abort', fail, { once: true })
    })
    aborted.catch(() => undefined)

    const iterator = query[Symbol.asyncIterator]()
    let text = ''
    let result: string | null = null
    let error: string | null = null
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next.done === true) break
        const message: unknown = next.value
        this.recordLimits(message)
        this.observeSystem(message)
        const m = record(message)
        if (m?.type === 'assistant') text += assistantText(m)
        if (m?.type === 'result') {
          if (m.subtype === 'success' && m.is_error !== true) result = typeof m.result === 'string' ? m.result : ''
          else error = typeof m.result === 'string' ? m.result : String(m.subtype ?? 'error')
        }
      }
```

- Что делает: из цикла чтения ушла проверка `isThinking` и `flight.abort('thinking')`; из обработки `claimed` —
  `flight.abort('option-not-applied')` для Suggestion. Теперь `option_not_applied` у любой функции пишет строку в log, а
  ответ берётся. Причины отказа `thinking` и `option-not-applied` убраны из `AssistRefusalReason`: их больше никто не
  выставляет. Ответ по-прежнему собирается из `assistantText` (только блоки `text`) и `result` хода.
- Почему здесь: Ticket называет `assist.ts`, `attempt` и `AssistRefusalReason`. Отмена на `option_not_applied` была
  нужна только выключателю thinking (ADR-0058, пункт 3); владелец велел оставить Suggestion только две причины отмены —
  таймаут 5 с и ответ, который не продолжает набранное (`src/main/terminal-ai/features/suggest.ts:25`, не менялся).
- Без него: каждая Suggestion от Haiku 5.5 кончалась бы отказом `thinking`, и серый текст от модели не появлялся бы
  никогда.
- Требование: [Что делаем, п. 2, 4](../issues/135-одноразовые-вызовы-haiku-на-haiku-5-5.md#что-делаем)
- Риски и пробелы test-ов: contract test `terminal-ai-assist.test.ts` гоняет поток с thinking (начало блока, delta с
  текстом, блок `thinking`, блок `redacted_thinking` рядом с `text`) с `result` и без него — в Suggestion приходит
  только `git status`. Был красным до правки. Сколько Suggestion уложится в 5 с с thinking, test не меряет.

## 4. narrator: Haiku 5.5, low effort и место для thinking

Code: `src/main/vendors/claude/narrator.ts:35-60` · key lines: 41, 54, 59, 60

```ts
/**
 * The most the answer may take, in tokens, thinking included. The line itself is under 100 tokens (120 characters);
 * the rest is room for Haiku 5.5's thinking at low effort. A cap is a ceiling, not a spend: only the tokens written
 * count against the Limits, while a cap that cuts thinking short leaves no line at all. 4096 is a guess with wide
 * room, not a measurement (worfy-polish 135).
 */
export const NARRATOR_MAX_OUTPUT_TOKENS = 4096

export interface NarratorOptionsInput {
  /** The agent environment (agentEnv()); its API keys are dropped again here. */
  env: Readonly<Env>
  runtime: RuntimeInfo
  cwd: string
  stderr?: ((data: string) => void) | undefined
}

/** What one request of the narrator starts Claude Code with. */
export function narratorOptions(input: NarratorOptionsInput): Options {
  const env = withoutApiKeys(input.env)
  for (const key of API_KEY_VARS) delete env[key]
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(NARRATOR_MAX_OUTPUT_TOKENS)
  const executable = claudeExecutablePath(input.runtime)
  return {
    cwd: input.cwd,
    model: NARRATOR_MODEL,
    effort: 'low',
```

- Что делает: `NARRATOR_MODEL` теперь `HAIKU_MODEL_ID`; `thinking: { type: 'disabled' }` заменён на `effort: 'low'`;
  предел вывода поднят с 256 до 4096 token-ов.
- Почему здесь: Ticket называет `narrator.ts`, `NARRATOR_MODEL` и `NARRATOR_MAX_OUTPUT_TOKENS`. Почему 4096: строка
  пересказа — до 120 символов, меньше 100 token-ов; thinking считается в тот же предел; предел — потолок, а не расход,
  а обрезанный thinking не оставляет строки совсем. Это оценка с большим запасом, не замер. Effort `low` для narrator-а
  — решение без владельца: просьба называет его только для Suggestion, но цель та же — короткий thinking.
- Без него: при 256 token-ах thinking Haiku 5.5 мог съесть весь предел, и Live summary молчал бы.
- Требование: [Что делаем, п. 5](../issues/135-одноразовые-вызовы-haiku-на-haiku-5-5.md#что-делаем)
- Риски и пробелы test-ов: `narrator-options.test.ts` закрепляет модель, effort, отсутствие `thinking` и предел 4096.
  Хватает ли 4096 живому Haiku 5.5 и не слишком ли это много, test не знает.

## 5. Что сознательно не меняли

`JUDGE_MODEL` eval-скриптов (`scripts/eval-run-env.mjs:33`) остался Haiku 4.5: смена судьи ломает сравнимость прошлых
eval-ов, это вопрос владельцу (раздел «Вне скоупа» Ticket-а). Таймаут Suggestion 5 с и правило «ответ продолжает
набранное» не тронуты. Модель Sessions (Haiku им по-прежнему нельзя) не менялась.

## 6. Как проверено

`pnpm lint && pnpm typecheck && pnpm test` под временным HOME — exit 0 (862 файла test-ов). До правки 19 случаев в семи
файлах test-ов были красными, после — 140 из 140 зелёные. `node scripts/check-feature-docs.mjs` — exit 0. Живой модели
никто не звал: скрипт замера `measure.mjs` лежит вне репозитория, его запускает Orchestrator.

## Проверить себя

1. Почему отказ `option_not_applied` больше не отменяет Suggestion?
   - Ответ: он был нужен, только чтобы Suggestion не шла с включённым thinking; теперь thinking разрешён, и
     непринятая настройка — повод для строки в log, а не для отмены.
   - Строки: `src/main/terminal-ai/assist.ts:483-486`
2. Как текст thinking мог бы попасть в Suggestion и почему не попадает?
   - Ответ: ответ собирается из `result` хода или из текста assistant-сообщений; `assistantText` берёт только блоки
     `text`, а блоки `thinking` и `redacted_thinking` пропускает.
   - Строки: `src/main/terminal-ai/assist.ts:509-512`
3. Почему предел вывода narrator-а вырос в 16 раз, а расход — нет?
   - Ответ: предел — потолок; в Limits идут только написанные token-ы, а thinking считается в тот же потолок, и при 256
     он мог не оставить места строке.
   - Строки: `src/main/vendors/claude/narrator.ts:35-41`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-polish 135 (one-shot Haiku calls on Haiku 5.5), head 7c0f47492b5ebab92a69ce04977bccdc86822dc6
>
> Gate (depth medium): verifier (lens: implementer's report) VERIFIED; reviewer (lens: correctness) no findings above low.
>
> - Verifier: claude-haiku-5-5 as HAIKU_MODEL_ID (terminal-ai.ts:70); claimOptions sends settings.effortLevel 'low', no maxThinkingTokens (:73-82, :92); thinking and option_not_applied no longer abort a Suggestion (assist.ts:483-486); thinking text never reaches a Suggestion (assist.ts:216-221; contract test covers thinking_delta, thinking block, redacted_thinking, with and without result); narrator Haiku 5.5 effort low, cap 4096 (narrator.ts:35-41, 59-60); ADR-0058 Amendment; feature pages match. Mutants: assist.ts from main → 3 red, terminal-ai.ts from main → 4 red, narrator cap 256 + thinking disabled → 2 red. claude-haiku-4-5 gone from src/main/terminal-ai and narrator.ts. The «Итог» table matches before.txt/after.txt (n=20 each: 20/20 within 5 s; median 1397 → 1864 ms; p90 1676 → 2558 ms; 5/20 turns with thinking; 0 option_not_applied).
> - Reviewer: no thinking leak (assist.ts:218-222, 513-516; narrator takes only result; a mutant taking block.thinking → exit 1); 5 s timeout and the drop of a non-continuing answer kept; zsh cancels on any line change; the narrator line is cut to 120 chars downstream (agent/narrator.ts:28,108-110) so the 4096 cap cannot reach the UI; Claude Code 2.1.322 lists effort for claude-haiku-5-5; Codex untouched. typecheck exit 0; 22 test files 685 passed exit 0.
> - ci-ok pass on the head.
>
> Decided without the owner (to confirm): the cancel on option_not_applied removed too (a refused model now yields the default model's answer within 5 s — 0 such refusals measured); narrator effort low, cap 4096 not measured; JUDGE_MODEL of the eval scripts left on haiku-4-5 (owner question).
>
> Consider [low]: suggest.ts:5 comment still says «Haiku without thinking»; docs/features/terminal.md:322 and ADR-0058 Amendment :205 say «Only its 5 s limit or an answer that no longer continues the typed line ends it» — a new request, a line change or a refused claim end it too, and a non-continuing answer is hidden, not ending; scripts/agent-cost.mjs:31 has no Haiku 5.5 price row.

Code: `docs/features/terminal.md:322-322` · key lines: 322

```md
- **A Suggestion that would come late is dropped.** Only its 5 s limit or an answer that no longer continues the typed line
```

Code: `scripts/agent-cost.mjs:31-31` · key lines: 31

```mjs
  'claude-haiku-4-5-20251001': [1, 5, 0.1, 1.25, 2],
```
