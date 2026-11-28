# 11: Строки перед потерей cache

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Ticket-ы», 11; «Решение», «Где это видно», 4; «Как пользователь этим пользуется», шаг 6;
«Экран» (Session view); «Решения по реализации» («Строки перед действием», «Hook-и SDK»); «Решения по test-ам», Seam 2
(SDK); «Риски» («Версия SDK»); «Вопросы владельцу», Q4; «Волны», Wave 4

Кто: агент. Глубина ревью — `high`: Ticket добавляет hook-и SDK в options каждой Session Claude Code; reviewer
проверяет, что `toolUseHooks` и guard остаются и что hook не меняет ход Session.

## Что происходит

- Picker модели (`src/renderer/session/composer/Pickers.tsx`) не говорит, что смена модели перечитает весь разговор.
  Поле ввода (`src/renderer/session/MessageInput.tsx`) не говорит, что cache остыл; context meter показывает только
  заполнение до порога autocompact (`docs/features/sessions.md:305-310`). Строка Auto-continue
  (`src/renderer/session/composer/ContinueCountdown.tsx`) не называет цену продолжения.
- `options.hooks` ставит только `toolUseHooks` (`src/main/vendors/claude/options.ts:474`, `:820`).
- SDK 0.3.322 (`package.json:29`): `SessionStart` с source `resume` даёт `seconds_since_last_response`,
  `context_tokens`, `prompt_cache_likely_expired` (`sdk.d.ts:6968-6990`); `PostModelSwitch` — `context_tokens`,
  `prompt_cache_warm`, `cache_ttl` (`sdk.d.ts:2687-2722`). `PreModelSwitch` с `ask` в Session без человека отменяет
  смену (`sdk.d.ts:2846-2852`).

## Что строить

- Picker модели: под выбором другой модели — «Switching to <model> re-reads ≈180K tokens of this conversation (≈0.7%
  of the week)»; без оценки — только token-ы. Контекст — из события `context` (`src/shared/agent/events.ts:140`).
- Над полем ввода Session, чей последний ответ старше жизни cache (5 min или 1 h — куда он писал): «Not cached any
  more: the next message re-reads ≈210K tokens (≈1.6% of the week)». У Orchestrator-а рядом — «New Orchestrator
  Session · starts with ≈30K» (оценка нового старта из Ticket-а 04).
- Строка Auto-continue перед продолжением — та же оценка.
- Строки ничего не блокируют (решение владельца 2026-11-28, Q4 (а)): ни подтверждения, ни диалога. Renderer считает их сам по коэффициенту из канала учёта.
- Hook-и SDK: `SessionStart` (source `resume`) и `PostModelSwitch` добавляются к `toolUseHooks`, а не вместо; они
  уточняют причину и контекст. `estimated_cache_write_usd` не показывается. `PreModelSwitch` не ставится.
- `test/contract/sdk-compat.test.ts` держит поля обоих hook-ов закреплённой версии.
- Тексты UI — английские (ADR-0074).

## Где в коде

- `src/renderer/session/composer/Pickers.tsx`, `src/renderer/session/MessageInput.tsx`,
  `src/renderer/session/composer/ContinueCountdown.tsx`
- `src/main/vendors/claude/options.ts` — `hooks` рядом с `toolUseHooks`
- `src/main/vendors/claude/session.ts` — куда приходит ответ hook-а, если нужно событие
- `test/unit/pickers-captions.test.tsx`; unit test строки над полем ввода рядом с существующими test-ами Session view
- `test/contract/sdk-compat.test.ts`
- e2e: строка в picker-е модели у fake Session

## Test-ы

- Unit test-ы: строка в picker-е при другой модели; строка над полем ввода после паузы дольше жизни cache и её нет до
  неё; «New Orchestrator Session» с оценкой нового старта у Orchestrator-а; строка Auto-continue; без оценки — token-ы.
- Contract test: поля `SessionStart` и `PostModelSwitch` в `sdk.d.ts` закреплённой версии; options Session держат и
  `toolUseHooks`, и новые hook-и.
- e2e: fake Session — строка в picker-е модели видна.
- Сначала падающий test: красный на нынешнем коде, это пишется в «Итог».
- Без моделей и без сети.

## Готово, когда

- [ ] Picker модели и Session после простоя показывают оценку перечитывания; у Orchestrator-а рядом «New Orchestrator
      Session» с оценкой нового старта; строка Auto-continue — та же оценка.
- [ ] Строки ничего не блокируют.
- [ ] Hook-и `SessionStart` и `PostModelSwitch` стоят рядом с `toolUseHooks`; `sdk-compat` держит их поля.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
