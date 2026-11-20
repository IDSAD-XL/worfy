# Для Orchestrator-а: одноразовые вызовы Haiku переходят на Haiku 5.5

Дата: 2026-11-20. Это просьба владельца, записанная Product Session `proactive-runtime`. Product Session код не меняет,
поэтому изменение делает Orchestrator.

Слова владельца:

- «Переходим на 5.5, без проблем. Это по прежнему очень дешевая и очень быстрая модель.»
- О правиле, по которому Suggestion отменяется на thinking: «Тогда поменяй это правило, что бы оно не мешало.»

## Что сейчас (main `ad2169058`)

- `HAIKU_WITHOUT_THINKING = 'claude-haiku-4-5'` (`src/main/vendors/claude/terminal-ai.ts:70`). Константу берут:
  - Suggestion и Next command на haiku: `claimOptions`, `maxThinkingTokens: 0` (`src/main/vendors/claude/terminal-ai.ts:72-80`);
  - narrator: `NARRATOR_MODEL` (`src/main/vendors/claude/narrator.ts:31`), `thinking: { type: 'disabled' }` (`:55`),
    `NARRATOR_MAX_OUTPUT_TOKENS = 256` (`:36`).
- ADR-0058, пункт 3 (`docs/adr/0058-terminal-ai-assist-process.md:106-113`): Suggestion отменяется, если поток ответа
  начался с thinking или `claim()` не принял `maxThinkingTokens`. В коде это `flight.abort('thinking')`
  (`src/main/terminal-ai/assist.ts:533`).
- Модель-судья eval-скриптов — `JUDGE_MODEL = 'claude-haiku-4-5'` (`scripts/eval-run-env.mjs:33`).

## Зачем менять

- Haiku 4.5 стоит $1 за 1M входных и $5 за 1M выходных token-ов по цене API, Haiku 5.5 — $0,10 и $0,50.
- Haiku 4.5 могут снять с предупреждением за 60 дней.
- 2026-10-29 Haiku 4.5 убрали из выбора модели в приложениях Claude на планах Free, Pro и Max.
- Источник фактов выше — [research-anthropic-модели-цена-и-правила.md](research-anthropic-модели-цена-и-правила.md),
  разделы 1.2 и 1.4.
- В Claude Code thinking у Haiku 5.5 не выключается (там же, раздел 1.3). Поэтому без смены правила ADR-0058 каждая
  Suggestion от модели будет отменяться.

## Что поменять

1. **Модель.** Одноразовые вызовы Haiku переходят на Haiku 5.5. Указывать ID `claude-haiku-5-5`, а не alias.
2. **Правило ADR-0058, пункт 3.**
   - Thinking больше не отменяет Suggestion. Её отменяют только таймаут функции
     (`FEATURE_TIMEOUT_MS.suggest = 5_000`, `src/main/terminal-ai/options.ts:13`) или ответ, который уже не продолжает
     набранное.
   - `maxThinkingTokens: 0` убрать.
   - Если Claude Code принимает effort для Haiku 5.5, поставить `low`.
   - К ADR-0058 дописать Amendment с датой.
3. **narrator.**
   - Модель — Haiku 5.5.
   - `thinking: { type: 'disabled' }` убрать.
   - `NARRATOR_MAX_OUTPUT_TOKENS` поднять, чтобы thinking не съедал строку пересказа. Насколько поднять — замерить.
4. **Next command на haiku** — та же модель.
5. **По желанию владельца** — `JUDGE_MODEL` eval-скриптов.

## Риски и что замерить

- **Задержка Suggestion.** Сейчас Suggestion от модели приходит через 1,5–5 с (`docs/adr/0058-terminal-ai-assist-process.md:156`).
  С thinking часть ответов не уложится в 5 с и не покажется. Ввод от этого не ломается: история команд показывается
  первой, без модели. Замерить долю Suggestion, которые уложились в 5 с, до перехода и после.
- **Token-ов больше.** На тот же текст Haiku 5.5 тратит примерно на 30 % больше token-ов, а thinking считается как
  выходные token-ы. Оба фактора расходуют лимиты подписки.
- **Test-ы.** fake-backend Terminal AI уже умеет отдавать поток с thinking (`src/main/terminal-ai/fake-backend.ts:11`,
  `:101-102`). Test, который сейчас ждёт отмены Suggestion на thinking, должен ждать ответа.
