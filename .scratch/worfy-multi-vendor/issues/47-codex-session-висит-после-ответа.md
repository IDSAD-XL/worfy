# 47 — Session на Codex висит «в работе» после ответа

Type: bug
Status: claimed 2026-11-11T12:16Z
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
3. `thread/status/changed` с `systemError` молча глотается (QUIET): если после него `turn/completed` не придёт,
   Session висит.

## Что делаем

1. Hook-и Codex видны в transcript-е: пока hook Stop идёт — строка со spinner-ом («Stop hook running»); законченный
   hook показывается, только если он что-то сказал (не `completed` или есть вывод) — то же правило, что у Claude Code
   (`hookSaidSomething`).
2. Любой `turn/completed` хода этой Session заканчивает ход: статус, которого разбор не знает, даёт `result`.
3. `thread/status/changed` → `systemError` во время хода заканчивает ход с ошибкой; поздний `turn/completed` того же
   хода второго `result` не даёт.
4. Без слепого timeout-а.

Глубина review — `medium`.

## Готово, когда

- [ ] Contract test на fake app-server: `turn/completed` со статусом `inProgress` — Session получает `result`
      (до правки — нет, test красный).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/codex-session.test.ts` exit 0 (red before the fix: no result) · mac - · 6d961ae3e7080b5f92491c1ebd94bce9a11b5802
- [ ] Contract test на fake app-server: `thread/status/changed` `systemError` во время хода — `result` с ошибкой,
      поздний `turn/completed` второго `result` не даёт.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/contract/codex-session.test.ts test/unit/codex-items.test.ts` exit 0 (red before the fix: no result) · mac - · 6d961ae3e7080b5f92491c1ebd94bce9a11b5802
- [ ] Unit test-ы: hook Stop идёт — событие `hook` с outcome `running`; законченный молчащий hook строку убирает,
      сказавший что-то — остаётся.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs run test/unit/codex-items.test.ts test/unit/transcript-hooks.test.tsx` exit 0 · mac - · 6d961ae3e7080b5f92491c1ebd94bce9a11b5802
- [ ] Все unit и contract test-ы `src/main/vendors/codex` и `src/main/agent`, `pnpm typecheck`, `pnpm lint` — exit 0.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 6d961ae3e7080b5f92491c1ebd94bce9a11b5802

## Где в коде

- `src/main/vendors/codex/items.ts` — `turn/completed`, `thread/status/changed`, `hook/started`, `hook/completed`.
- `src/main/vendors/codex/session.ts` — конец хода (`turnEnded`).
- `src/renderer/session/fold.ts`, `src/renderer/session/Transcript.tsx` — строка идущего hook-а.
- `test/fixtures/codex-scripts/` — сценарии fake app-server-а.
- `test/contract/codex-session.test.ts`, `test/unit/codex-items.test.ts`, test-ы fold-а transcript-а.
- `docs/features/` — страница Codex, если меняется то, что видит пользователь.
