# 02 — Guard памяти в Session Autopilot: отказ на запись в папку памяти, «есть ли человек» на каждом вызове

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 2; «Решение», часть 2; «Решения владельца», Q9 и Q12; «Решено
советником» («Guard — тот же механизм, что у Product Session»); «Решения по реализации» («Модули» → guard); «Решения
по test-ам», Seam 1; «Риски» («Обход guard-а через Bash»); истории 12, 13, 18, 21; «Волны», Wave 1

Кто: агент.

## Что строить

1. **Функция решения:** (tool, его вход, папки памяти, есть ли человек сейчас) → разрешить или отказать с текстом.
2. **PreToolUse hook** — тот же механизм, что guard Product Session. Он стоит в Session-ах, которые стартуют без
   человека; сейчас это Autopilot. Hook ловит:
   - Write, Edit, MultiEdit и NotebookEdit, если путь лежит в папке памяти;
   - Bash, если путь папки памяти есть в тексте команды.
3. **«Есть ли человек»** hook берёт из живого состояния Session на каждом вызове, а не при запуске (Q12).
   Остановленный Autopilot возвращает Session человеку в том же процессе, и после этого «запомни» снова работает. Так
   же устроена проверка разрешений Session: она читает тот же флаг на каждом вызове.
4. **Ответ агенту** — на английском (Harness и код English-only, ADR-0074): «Memory is written only in a Session with a
   person. Put the note into your report.»
5. Session с человеком пишет в память как раньше (история 18).
6. Обход через переменные и `cd` шаблон не ловит. Это известная граница; её записывает ADR (Ticket 06).

Папки памяти функция решения получает на входе. Путь к ним считает правило Ticket-а 01 (`projectDirName`, база из env);
второго правила пути spec не допускает («Своего второго правила не пишем»).

## Где в коде

- `src/main/agent/product-guard.ts` — `productToolDecision`, guard Product Session: образец функции решения.
- `src/main/vendors/claude/options.ts` — PreToolUse hooks Session (`productGuard`, его выбор по `input.kind` при старте
  `query()`); `permissionMode` `bypassPermissions` для Session без человека.
- `src/main/agent/session.ts` — `unattended`, который driver читает на каждом запросе разрешения; `becomeAttended`.
- `src/main/vendors/claude/session.ts` — `liveCanUseTool`: проверка разрешений, которая читает флаг на каждом вызове.
- `src/main/agent/orchestrator.ts` — остановленный Run возвращает Session человеку (`session.becomeAttended`).

## Готово, когда

- [ ] Unit test-ы функции решения: в Session без человека Write, Edit, MultiEdit, NotebookEdit с путём в папке памяти
      и Bash с путём папки памяти в тексте команды получают отказ с текстом «Memory is written only in a Session with
      a person. Put the note into your report.»
- [ ] Unit test: те же вызовы в Session с человеком разрешены.
- [ ] Unit test: путь в чужой папке (не папке памяти) guard памяти не останавливает.
- [ ] Unit test (Q12): Session стартует без человека, её возвращают человеку в том же процессе — запись в память после
      этого проходит.
- [ ] Hook стоит в Session-ах, которые стартуют без человека (сейчас Autopilot), и читает «есть ли человек» из живого
      состояния Session на каждом вызове, а не значение, запомненное при запуске.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
