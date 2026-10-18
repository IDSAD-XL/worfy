# 15 — Соединение shell-а с main остаётся у программ, которые запускаются на prompt-е

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-18, Q9 (низкий приоритет, low); «Итог» Ticket-а [11](11-программа-в-terminal-пишет-в-соединение-shell-а.md): «Что осталось открытым», «Что по-прежнему держит связь (вопрос владельцу, отдельный Ticket)» и два долга low ревью PR #443

## Что происходит

- ZLE widget интеграции zsh открывает Unix socket к main (процесс Electron, который отвечает Terminal
  AI), переносит соединение на descriptor выше 9 и шлёт `hello <token>`
  (`src/main/terminal/zsh/rc.d/10-assist.zsh`).
- У zsh нет close-on-exec для descriptor-а, который он открыл: каждый дочерний процесс shell-а
  наследует соединение. Ticket 11 закрывает соединение на время команды строки (`zle-line-finish`,
  запасной путь — `preexec`) и шлёт `bye`. Команды строки соединения не получают.
- На prompt-е, пока соединение открыто, его по-прежнему наследуют:
  - программы, которые запускают widget-ы и `zle -F` handler-ы (fzf по Ctrl+T, история через atuin);
  - подстановки `$(…)` в prompt при `zle reset-prompt`;
  - hook-и `zle-line-finish` из `.zshrc` пользователя, добавленные раньше worfy.
- Такая программа может писать в соединение от имени shell-а (`ask <id> <feature> <line>` —
  запрос к модели на подписке владельца) и читать то, что main шлёт shell-у. Токен и строки других
  Terminal-ов ей недоступны. После следующей строки её копия мертва: main закрывает соединение на `bye`.
- Два близких долга low ревью PR #443 (Ticket 11, «Долги (low)»):
  1. `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh:68` — подоболочка таймера Suggest AI
     (`exec {fd}< <(…)`) наследует descriptor соединения, пока идёт prompt. `bye` её закрывает, наш код
     в копию не пишет. Предложение ревью: закрывать `$__worfy_assist_fd` внутри подоболочки.
  2. `src/main/terminal/zsh/zshenv.zsh:13-14` — если `/etc/zshenv` включает `allexport`, токен
     (`__worfy_assist_token`) экспортируется и виден программам из `.zshenv`, `.zprofile`, `.zshrc`.
     Было и до Ticket-а 11, но токен теперь многоразовый. Предложение ревью: `typeset -g +x` при
     присваивании.

## Что делаем

1. Долг 1: в подоболочке таймера Suggest AI закрыть descriptor соединения первой командой.
2. Долг 2: переменные токена и socket-а в `zshenv.zsh` присваивать без экспорта даже под `allexport`.
3. Основное: развилка — к владельцу при claim. Варианты:
   - (а) закрывать descriptor в обёртке вокруг widget-ов и `zle -F` handler-ов, которые worfy не писал,
     и открывать снова после них;
   - (б) держать соединение закрытым всё время prompt-а и открывать только на время своего запроса;
   - (в) оставить как есть и записать риск в «Итог» (ADR-0058 не правится).
   Рекомендация исполнителя — при claim, по замеру задержки (порог Ticket-а 11 — 20 ms).

## Готово, когда

- [ ] Test `terminal-ai-zle.test.ts`: подоболочка таймера Suggest AI не видит descriptor соединения.
- [ ] Test: под `allexport` дочерний процесс `.zshrc` не видит токена в окружении.
- [ ] Ответ владельца по пункту 3 записан в «Итог»; если выбран (а) или (б) — test: программа, которую
      widget запустил на prompt-е, не находит descriptor соединения.
- [ ] Остальные test-ы `test/contract/terminal-ai-zle.test.ts` зелёные.

## Где в коде

- `src/main/terminal/zsh/rc.d/10-assist.zsh` — соединение, `zle-line-finish`, `bye`.
- `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh` (`:68`).
- `src/main/terminal/zsh/zshenv.zsh` (`:13-14`).
- `test/contract/terminal-ai-zle.test.ts` (больше 1000 строк: новые test-ы — в отдельный файл).
