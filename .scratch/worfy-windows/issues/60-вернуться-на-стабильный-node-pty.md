# 60 — Вернуться на стабильный релиз node-pty, когда выйдет релиз с исправлением #965

Type: task
Status: done 2026-10-23T00:14Z
Blocked by: —
Source: решение владельца 2026-10-18 в чате Session на Mac по [Ticket-у 40](40-node-pty-падает-при-одновременном-kill.md): закрепить `node-pty@1.2.0-beta.15`, а на стабильный релиз вернуться, когда выйдет релиз с исправлением #965. Начинать не раньше такого релиза под тегом `latest` (шаг 1 «Что делаем»).

## Что происходит

- С [Ticket-а 40](40-node-pty-падает-при-одновременном-kill.md) worfy стоит на beta-версии
  `node-pty@1.2.0-beta.15` (точная версия в `package.json`, без `^`). Причина — падение процесса с кодом
  3221225477 (`0xC0000005`, access violation) на Windows, когда несколько оболочек завершаются вместе:
  8 смертей из 144 кругов на 1.1.0, 0 из 144 на beta.15 (замер на Windows-ПК, «Итог» Ticket-а 40).
  Исправление — [microsoft/node-pty#922](https://github.com/microsoft/node-pty/pull/922) (mutex вокруг
  списка pty в `conpty.cc`), на npm оно есть только в beta.
- [microsoft/node-pty#965](https://github.com/microsoft/node-pty/issues/965) открыт: на системной консоли
  (`useConptyDll: false`) оболочка, которая вышла сама, оставляет свой `conhost.exe`, и `kill()` его не
  закрывает. beta.15 это не исправляет (20 из 20 в каждом круге). Приложение работает на консоли из пакета
  (`useConptyDll: true`, `src/main/terminal/pty.ts`), где брошенных консолей нет, поэтому на worfy это
  сейчас не влияет.
- beta — не релиз: на её поведение никто, кроме этого замера, не опирается, и следующая beta может
  поменять то, что worfy достаёт из node-pty (`_agent`, `_agent._pendingPtyInfo`, `_agent.kill`, `_getConsoleProcessList`, `inSocket`,
  `exitCode`, `_conoutSocketWorker`; `src/main/terminal/pty.ts`).

## Что делаем

1. Дождаться релиза node-pty под тегом `latest` (`npm view node-pty dist-tags`), в который вошли #922 и
   исправление #965. Проверить по changelog-у или по `src/win/conpty.cc` релиза.
2. Закрепить его точной версией в `package.json`, обновить `pnpm-lock.yaml` через `pnpm install`.
3. Сравнить `lib/windowsPtyAgent.js` и `lib/windowsTerminal.js` релиза с beta.15: поля, которые worfy
   достаёт из node-pty, — на месте; если нет — поправить `src/main/terminal/pty.ts`.
4. На Windows-ПК — замер Ticket-а 40 («Итог», «Замер: исправление гонки»): 144 круга, смерти 3221225477
   и `conhost.exe` после `exit` на системной консоли.

## Готово, когда

- [ ] В `package.json` — точная версия стабильного релиза node-pty (без `^` и без beta).
- [ ] Windows-ПК: 144 круга замера Ticket-а 40 — 0 смертей; число `conhost.exe` после `exit` на системной
      консоли — в «Итог».
- [ ] Windows-ПК, проверка платформенного PR (Q23, ADR-0056): gate full — строка вердикта и код выхода;
      test-ы Terminal (`test/contract/terminal-windows.test.ts`, `test/contract/terminal.test.ts`,
      `test/unit/terminal-console.test.ts`, `test/unit/terminal-shell.test.ts`) — exit 0.
- [ ] `gate full` зелёный на Mac.

## Тесты

Свои test-ы не нужны: работу закрывают test-ы Terminal на обеих системах и ручной замер на ПК.

## Где в коде

- `package.json`, `pnpm-lock.yaml`
- `src/main/terminal/pty.ts` — только если поля node-pty поменялись (`withoutConsoleHelper`, `killUnconnected`,
  `spawnShellPty`, `exitCodeKnown`, `stopOutputWorker`)

## Вне скоупа

- Переход на системную консоль (`useConptyDll: false`) — отдельное решение, даже когда #965 исправят.
- Отчёт в upstream — только с разрешения владельца.

## Итог

**Решение владельца 2026-10-23:** стабильный релиз ждать не нужно — worfy остаётся на `node-pty@1.2.0-beta.15` (точная версия в `package.json`). На 2026-10-23 `latest` у node-pty — 1.1.0, исправления #922 в нём нет. Ticket закрыт без правок; переход на новую версию node-pty — новым Ticket-ом, с замером Ticket-а 40.
