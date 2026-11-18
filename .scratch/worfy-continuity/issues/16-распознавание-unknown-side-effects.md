# 16 — Unknown side effects: распознавание внешних вызовов без результата

Type: task
Status: claimed 2026-11-18T01:24Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», 16; «Решения по реализации» → «Unknown side effects: распознавание»;
[critic 2026-11-14](../../../docs/product/critic/worfy-continuity-2026-11-14.md), возражение 1 и «Alternative»;
«Вопросы владельцу», Q4 ((а), решено без владельца, подтвердить); «Решено без владельца», 2

Кто: агент.

Не платформенный Ticket (чистая функция в `src/shared`). Глубина ревью — `high`: от неё зависит, повторит ли worfy
`gh pr merge`.

## Что происходит

- Auto-continue уже отказывает в повторе, если у turn-а есть внешний вызов без результата: `retryDecision` возвращает
  `in-flight` (`src/shared/agent/continue-plan.ts:992–995`; `docs/features/autopilot-faults.md:55`).
- `externalActions` (`continue-plan.ts:330`) видит только вызовы верхнего уровня: вызов с `parentToolUseId` он
  пропускает (`:336`). Вызовы Subagent-ов лежат в их транскриптах; их строки читает `subagentSignalsOfLines`
  (`src/shared/transcript/subagents.ts:301`).
- Critic (возражение 1): в черновике отказ шёл Ticket-ом 07 в Wave 4, на Wave позже автоматического продолжения 05 и
  06. Между ними `main` продолжал бы Session или Wave, оборванную посреди `gh pr merge`, без проверки. Этот Ticket
  выносит чистое распознавание вперёд: 05 и 06 ждут его.

## Что делаем

1. Чистая функция (предложение: `src/shared/agent/unknown-side-effects.ts`): на входе — события оборванной Session
   (из транскрипта и записи `live-sessions.json` Ticket-а 03) и транскрипты её Interrupted Subagent-ов; на выходе —
   внешние вызовы без результата у Session и у каждого Subagent-а.
2. Для Subagent-а — его Ticket по Binding-у (`src/shared/binding/resolve.ts`): функция возвращает пары «Ticket — вызовы».
3. Правило «внешний» — то же, что у `externalActions` и отказа `in-flight`: одна классификация, без второй копии.
   Скрипт (`node <file>`) остаётся невидимым, как и сейчас (риск 9 spec-а).
4. Функция решений не принимает и ничего не пишет: продолжать или нет — Ticket-ы 05 и 06, метка и toast — Ticket 07.

## Готово, когда

- [ ] Unit test: Session с `git push` без `tool_result` — вызов найден; с результатом — нет; чтение файла без
      результата — не внешний вызов.
  - evidence: test-run pass · `pnpm test test/unit/unknown-side-effects.test.ts test/unit/continue-plan.test.ts` exit 0 · mac - · a7222c62f
- [ ] Unit test: Subagent с `gh pr merge 1234` без результата в своём транскрипте — найден и привязан к Ticket-у его
      Binding-а; Subagent без Binding-а — вызов найден, Ticket `null`.
  - evidence: test-run pass · `pnpm test test/unit/unknown-side-effects.test.ts test/unit/continue-plan.test.ts` exit 0 · mac - · a7222c62f
- [ ] Unit test: рваная последняя строка транскрипта не роняет функцию; вызов из неё не теряется, если `tool_use`
      прочитан.
  - evidence: test-run pass · `pnpm test test/unit/unknown-side-effects.test.ts test/unit/continue-plan.test.ts` exit 0 · mac - · a7222c62f
- [ ] Unit test: классификация совпадает с `externalActions` на fixture-ах `test/unit/continue-plan.test.ts`.
  - evidence: test-run pass · `pnpm test test/unit/unknown-side-effects.test.ts test/unit/continue-plan.test.ts` exit 0 · mac - · a7222c62f
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- Новый `test/unit/unknown-side-effects.test.ts`, fixture-транскрипты рядом. Каждый test сначала красный.

## Где в коде

- `src/shared/agent/unknown-side-effects.ts` (новый)
- `src/shared/agent/continue-plan.ts` (только если классификацию надо вынести для общего использования)
- `test/unit/unknown-side-effects.test.ts` (новый)

Только читать: `src/shared/transcript/subagents.ts`, `src/shared/binding/resolve.ts`, `src/shared/agent/live-sessions.ts`
(Ticket 03).

## Вне скоупа

- Отказ в продолжении Session — Ticket 05; Ticket не в Wave — Ticket 06; метка, toast, «Checked, include», строка
  Journal-а и ожидание вызовов Subagent-ов при выходе — Ticket 07. Документацию этот Ticket не меняет: поведения,
  видного человеку, нет.
