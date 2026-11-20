# 135 — Одноразовые вызовы Haiku переходят на Haiku 5.5; thinking больше не отменяет Suggestion Terminal AI

Type: task
Status: claimed 2026-11-20T03:17Z
PR: #2063
Blocked by: none
Source: слова владельца 2026-11-20 через Product Session, тема `proactive-runtime`: «Переходим на 5.5, без проблем. Это по
прежнему очень дешевая и очень быстрая модель.» О правиле ADR-0058, по которому Suggestion отменяется на thinking: «Тогда
поменяй это правило, что бы оно не мешало.»

Кто: агент. Глубина review — `medium`. Не платформенный PR.

## Что происходит

- Одноразовые вызовы Haiku называют Haiku 4.5 по ID: `HAIKU_WITHOUT_THINKING = 'claude-haiku-4-5'`
  (`src/main/vendors/claude/terminal-ai.ts:70`). Константу берут:
  - Suggestion и Next command на haiku — `claimOptions()` с `maxThinkingTokens: 0` (`terminal-ai.ts:72-80`);
  - narrator (Live summary Product Session) — `NARRATOR_MODEL` (`src/main/vendors/claude/narrator.ts:31`) с
    `thinking: { type: 'disabled' }` (`:55`) и `NARRATOR_MAX_OUTPUT_TOKENS = 256` (`:36`).
- ADR-0058, пункт 3: Suggestion отменяется, если поток ответа начался с thinking или `claim()` не принял
  `maxThinkingTokens` (`option_not_applied`). В коде — `flight.abort('thinking')` и `flight.abort('option-not-applied')`
  (`src/main/terminal-ai/assist.ts:505`, `:533`).
- Haiku 4.5 стоит $1 / $5 за 1M входных / выходных token-ов, Haiku 5.5 — $0,10 / $0,50. Haiku 4.5 могут снять с
  предупреждением за 60 дней; 2026-10-29 его убрали из выбора модели в приложениях Claude.
- У Haiku 5.5 thinking не выключается: в каталоге моделей Claude Code 2.1.322 (Agent SDK 0.3.322) у неё
  `rejects_disabled_thinking`, `adaptive_thinking` и `effort`. Без смены правила ADR-0058 каждая Suggestion от модели
  отменялась бы.

## Что делаем

1. Модель одноразовых вызовов Haiku — `claude-haiku-5-5`, по ID, не alias. Константа получает имя, которое не врёт про
   thinking.
2. Правило ADR-0058, пункт 3: thinking больше не отменяет Suggestion. Её отменяют только таймаут функции
   (`FEATURE_TIMEOUT_MS.suggest = 5_000`, `src/main/terminal-ai/options.ts:13`) или ответ, который уже не продолжает
   набранное. `maxThinkingTokens: 0` убрать. Отмена Suggestion на `option_not_applied` тоже уходит: она была только
   ради выключателя thinking.
3. Effort `low` для Haiku 5.5 — Claude Code 2.1.322 принимает effort для этой модели (`capabilities` с `effort`,
   `default_effort: "medium"`). Suggestion и Next command на haiku идут при `effortLevel: 'low'`, как Sonnet.
4. Текст thinking никогда не попадает в Suggestion: в ответ идут только text-блоки и `result` хода.
5. narrator: модель Haiku 5.5, `thinking: { type: 'disabled' }` убрать, effort `low`, `NARRATOR_MAX_OUTPUT_TOKENS`
   поднять, чтобы thinking не съедал строку пересказа.
6. Next command на haiku — та же модель (идёт через `claimOptions()`).
7. К ADR-0058 дописать Amendment с датой 2026-11-20 (слова владельца выше это разрешают).
8. `docs/features/terminal.md`, `docs/features/product-session.md` (и перевод `docs/features/ru/terminal.md`) — модель и
   правило thinking.
9. Скрипт замера `/tmp/worfy-night-1120/polish-135/measure.mjs` (вне репозитория): N запросов Suggestion с теми же
   опциями SDK, что у приложения; доля ответов за 5 с, медиана задержки, выходные token-ы. Запускает Orchestrator,
   не implementer.

## Готово, когда

- [ ] Contract test `test/contract/terminal-ai-assist.test.ts`: Suggestion, поток которой начался с thinking, получает
      ответ, а не отмену; текст thinking не попадает в Suggestion; `option_not_applied` не отменяет Suggestion. Красный до
      правки.
  - evidence: test-run pass · `pnpm test test/contract/terminal-ai-assist.test.ts` exit 0 · mac - · 63268e2fe849c4f53edb711f7983dc2a6bf484f9
- [ ] Unit test-ы `test/unit/terminal-ai-options.test.ts` и `test/unit/narrator-options.test.ts` закрепляют ID
      `claude-haiku-5-5`, effort `low`, отсутствие `maxThinkingTokens` и `thinking: disabled`.
  - evidence: test-run pass · `pnpm test test/unit/terminal-ai-options.test.ts test/unit/narrator-options.test.ts` exit 0 · mac - · 63268e2fe849c4f53edb711f7983dc2a6bf484f9
- [ ] ADR-0058 несёт Amendment 2026-11-20; `docs/features/terminal.md` и `docs/features/product-session.md` описывают
      новую модель и правило; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 63268e2fe849c4f53edb711f7983dc2a6bf484f9
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/vendors/claude/terminal-ai.ts` (`HAIKU_WITHOUT_THINKING`, `claimOptions`, `coldQueryOptions`)
- `src/main/vendors/claude/narrator.ts` (`NARRATOR_MODEL`, `NARRATOR_MAX_OUTPUT_TOKENS`, `narratorOptions`)
- `src/main/terminal-ai/assist.ts` (`isThinking`, `attempt`, `AssistRefusalReason`)
- `src/main/terminal-ai/fake-backend.ts` — только читать (поток с thinking уже есть)
- `test/unit/terminal-ai-options.test.ts`, `test/unit/narrator-options.test.ts`, `test/unit/narrator.test.ts`,
  `test/unit/app-narrator.test.ts`
- `test/contract/terminal-ai-assist.test.ts`, `test/contract/terminal-ai-suggest.test.ts`,
  `test/contract/terminal-ai-next-command.test.ts`, `test/e2e/terminal-ai-suggest.spec.ts`
- `docs/adr/0058-terminal-ai-assist-process.md` — только раздел `## Amendments` в конце
- `docs/features/terminal.md`, `docs/features/ru/terminal.md`, `docs/features/product-session.md`

## Вне скоупа

- **Вопрос владельцу:** `JUDGE_MODEL = 'claude-haiku-4-5'` eval-скриптов (`scripts/eval-run-env.mjs:33`). Владелец сказал
  «по желанию». Смена судьи ломает сравнимость прошлых eval-ов с новыми, поэтому без отдельного решения не меняется.
- Замер доли Suggestion, уложившихся в 5 с, до и после перехода — скриптом из п. 9, его запускает Orchestrator.

## Итог

Замер Orchestrator-а 2026-11-20 скриптом `measure.mjs` (вне репозитория), путь приложения prewarm + claim, по 20 запросов
Suggestion на живой модели, вход Claude Code владельца:

| | до: `claude-haiku-4-5`, `maxThinkingTokens: 0` | после: `claude-haiku-5-5`, effort `low` |
|---|---|---|
| уложились в 5 с | 20/20 | 20/20 |
| задержка claim → result, медиана / p90 / max, ms | 1397 / 1676 / 2374 | 1864 / 2558 / 2835 |
| выходные token-ы, медиана / max | 7,5 / 12 | 13 / 148 |
| ходы с thinking | 0/20 | 5/20 |
| ответ продолжает набранное | 19/20 | 19/20 |
| ошибки, `option_not_applied` | 0, 0 | 0, 0 |

Haiku 5.5 медленнее примерно на 0,5 с по медиане, но все ответы укладываются в таймаут 5 с. Claude Code принимает effort
`low` для Haiku 5.5: `option_not_applied` ни разу. Предел narrator-а 4096 token-ов не замерялся.
