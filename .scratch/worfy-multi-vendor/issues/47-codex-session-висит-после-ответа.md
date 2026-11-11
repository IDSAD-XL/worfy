# 47 — Session на Codex висит «в работе» после ответа

Type: bug
Status: done 2026-11-11T18:24Z
PR: #1796
Branch: worfy-multi-vendor/47
Blocked by:
Source: отзыв тестировщика, переданный владельцем 2026-11-11: «на кодексі він пише відповідь і далі висить у стані що
не відповів, і доводиться тиснути інтерапт» — в Session на Codex агент пишет ответ, а Session остаётся в состоянии
«работает», пока пользователь не нажмёт Interrupt. Платформа не известна.

## Что происходит

Session уходит из `busy` только по `result` (`src/main/agent/session.ts`, `onEvent`). У Codex `result` даёт
`turn/completed` или `error` (`src/main/vendors/codex/items.ts`). Interrupt помог — значит, ход в Codex ещё шёл:
`turn/interrupt` дошёл до живого хода. Что держит ход после ответа, разбирается в этом Ticket-е. Гипотеза
владельца — что-то с занятостью Orchestrator-а во время работы; это гипотеза, не факт.

Места, которые проверяются:

1. Hook-и Stop после ответа. Под Codex `harness/hooks/stop.mjs` на каждом Stop сам запускает `gate.mjs fast`
   (timeout 900 с, Ticket 36). Пока gate идёт, ход не закончен, а worfy не показывает ничего: `hook/started` и
   `hook/completed` идут в `unknown`. Ответ уже на экране, Interrupt активен, видимой работы нет.
2. `turn/completed` со статусом, которого разбор не знает (в схеме 0.166.0 есть `inProgress`), даёт `unknown`, а не
   `result`: Session остаётся `busy` навсегда.
3. `thread/status/changed` с `systemError` молча глотается (QUIET). Проверено и отклонено как причина: живая запись
   0.166.0 (`test/fixtures/codex-messages/turn-failed.jsonl`, строки 20–22) шлёт после него `error` с причиной и
   `turn/completed` `failed`; они и заканчивают ход.

## Что делаем

1. Hook-и Codex видны в transcript-е: пока hook Stop идёт — строка со spinner-ом («Stop hook running»); законченный
   hook показывается, только если он что-то сказал (не `completed` или есть вывод) — то же правило, что у Claude Code
   (`hookSaidSomething`).
2. Любой `turn/completed` хода этой Session заканчивает ход: статус, которого разбор не знает, даёт `result`.
3. `systemError` хода не заканчивает: иначе `result` уходит раньше настоящего `error` — без причины, с видом
   `systemError` вместо `modelNotFound`, Auto-continue перестаёт повторять временные ошибки, а `limit_reached` приходит
   после `result` (review round 1 PR #1796).
4. Строка идущего hook-а закрывается и при `state` `error`, `closed`, `idle` — процесс умер или Session закрыта.
5. Без слепого timeout-а.

Глубина review — `medium`.

## Готово, когда

- [ ] Contract test на fake app-server: `turn/completed` со статусом `inProgress` — Session получает `result`
      (до правки — нет, test красный).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/codex-session.test.ts` exit 0 (red before the fix: no result) · mac - · de96916aca4aebd721cae937964df6f29d96671e
- [ ] Unit test на живой записи `codex-messages/turn-failed.jsonl`: один `result` с текстом ошибки Codex и видом
      `modelNotFound`, `turnFailureKind` — как на origin/main (`other`); `systemError` ничего не даёт.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/codex-items.test.ts test/contract/codex-session.test.ts` exit 0 · mac - · de96916aca4aebd721cae937964df6f29d96671e
- [ ] Unit test-ы: hook Stop идёт — событие `hook` с outcome `running`; законченный молчащий hook строку убирает,
      сказавший что-то — остаётся; конец хода и `state` `error`/`closed`/`idle` строку убирают.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/codex-items.test.ts test/unit/transcript-hooks.test.tsx` exit 0 · mac - · de96916aca4aebd721cae937964df6f29d96671e
- [ ] Все unit и contract test-ы `src/main/vendors/codex` и `src/main/agent`, `pnpm typecheck`, `pnpm lint` — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · de96916aca4aebd721cae937964df6f29d96671e

## Где в коде

- `src/main/vendors/codex/items.ts` — `turn/completed`, `thread/status/changed`, `hook/started`, `hook/completed`.
- `src/main/vendors/codex/session.ts` — конец хода (`turnEnded`).
- `src/renderer/session/fold.ts`, `src/renderer/session/Transcript.tsx` — строка идущего hook-а.
- `test/fixtures/codex-scripts/` — сценарии fake app-server-а.
- `test/contract/codex-session.test.ts`, `test/unit/codex-items.test.ts`, test-ы fold-а transcript-а.
- `docs/features/` — страница Codex, если меняется то, что видит пользователь.
