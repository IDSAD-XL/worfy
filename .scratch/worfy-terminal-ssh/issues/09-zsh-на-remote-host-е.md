# 09 — zsh на Remote host-е: интеграция без файлов на диске, Fix и Command request как в bash

Type: task
Status: open
Blocked by: 04, 06, 07
Source: решения владельца 2026-10-18: пункты 2 (только память, ничего на диске), 5 (сначала bash, потом zsh) ([spec.md](../spec.md)); риск 10 spec-а (zsh без файлов на диске)

## Что происходит

- После Ticket-а 04 команда запуска (`src/main/terminal/ssh-bootstrap.ts`) запускает bash. Login shell
  пользователя zsh — тоже bash с интеграцией или обычный вход, по выбору Ticket-а 04.
- Локальная интеграция zsh приходит через `ZDOTDIR` — папку с файлами `.zshenv`, `.zprofile`,
  `.zshrc`, `.zlogin` (`src/main/terminal/zsh/`). У zsh нет `--rcfile`.
- Скрипт OSC 633 для zsh уже есть: `src/main/terminal/zsh/integration.zsh`.

## Что делаем

1. **Способ запуска zsh без файлов.** Сначала короткий замер, итог — в «Итог». Варианты:
   - (a) папка в tmpfs (`$XDG_RUNTIME_DIR`, `/dev/shm`), удаляется сразу после чтения zsh-ем — это
     запись, хоть и в память. Без слова владельца не выбирается;
   - (b) zsh, которому скрипт приходит не файлом: например, `zsh -is` с stdin из here-string и
     переключением stdin обратно на терминал;
   - (c) другой способ, который найдёт замер.

   Нет способа без записи — Ticket ставится `blocked`, `Waits: owner`, вопрос — про вариант (a).
   Решение владельца 2026-10-18 (Q11, spec, риск 10): пробовать (b) или (c); (a) — только по новому слову
   владельца.
2. **Удалённый скрипт zsh** — `src/main/terminal/zsh/remote.zsh` (новый): OSC 633 с nonce SSH session
   на основе `integration.zsh`, без socket-а и ZLE widget-ов Terminal AI. Файлы пользователя — в
   порядке login zsh.
3. **Команда запуска** — `ssh-bootstrap.ts`: login shell zsh — zsh с интеграцией; иначе — bash, как в
   Ticket-е 04.

**Не входит:** Suggestion и Next command в удалённом zsh.

## Готово, когда

- [ ] «Итог»: способ запуска zsh, замер, и что ни одного файла на диске Remote host-а не появляется.
- [ ] Unit `test/unit/terminal-ssh-bootstrap.test.ts`: login shell zsh — команда запуска zsh; bash и
  sh — bash; restricted — без интеграции.
- [ ] Contract `test/contract/terminal-ssh-zsh.test.ts` (новый), настоящий zsh как удалённый shell,
  поддельный `ssh`: удалённый prompt; `cd /tmp; false` — удалённый слой: папка `/tmp`, код 1; новых
  файлов во временном «HOME Remote host-а» и в `TMPDIR` нет, кроме истории; `~/.zshrc` пользователя
  прочитан.
- [ ] Тот же contract: Fix и Command request в удалённом zsh — ответ fake в строке, не запущен.
- [ ] `test/contract/terminal-ssh-bash.test.ts` зелёный без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

Сначала падающий test — contract «удалённый zsh → папка `/tmp` в удалённом слое»: сегодня там bash.
Потом Fix и Command request.

## Где в коде

- `src/main/terminal/ssh-bootstrap.ts`
- `src/main/terminal/zsh/remote.zsh` (новый)
- `src/main/terminal/shell-integration.ts`
- `test/unit/terminal-ssh-bootstrap.test.ts`
- `test/contract/terminal-ssh-zsh.test.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
