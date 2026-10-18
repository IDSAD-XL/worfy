# 06 — Fix в SSH session: кнопка после упавшей удалённой команды, ответ в удалённой строке без Enter

Type: task
Status: open
Blocked by: 04
Source: решения владельца 2026-10-18: пункты 1 (первый шаг — Fix и Command request), 4 (тот же уровень данных, что локально), 9 (пока идёт удалённая команда, в модель ничего не уходит) ([spec.md](../spec.md)); «Решено без владельца», пункты 2 (ветка git не отправляется, вместо неё — система и shell), 7 (ответ без Enter); Fix Epic-а worfy-terminal-ai — [Ticket 07](../../worfy-terminal-ai/issues/07-fix-после-команды-с-ошибкой.md)

## Что происходит

- Локальный Fix: `src/main/terminal-ai/fix.ts`, каналы `src/main/ipc/terminal-ai-fix.ts`.
  `available` требует, чтобы команда не шла и zsh был подключён к socket-у
  (`terminal-ai-fix.ts:47`). Во время `ssh host` идёт команда, и `runFix` отвечает «Terminal is
  busy» (`fix.ts:93`).
- Отказ `command-running` перед любым запросом — `src/main/terminal-ai/assist.ts:375`.
- Ветка git — с локального диска (`src/main/terminal-ai/git-branch.ts:14`), по `cwd` запроса
  (`assist.ts:291`).
- После Ticket-а 04 у Terminal-а есть удалённый слой: команды, код выхода, вывод, папка, система; и
  `remote-insert` для ответа.

## Что делаем

1. **Контекст SSH session** — `src/main/terminal-ai/remote-context.ts` (новый): `TerminalAiInput` из
   удалённого слоя. `commandRunning` и `alternateScreen` — удалённые. Ветки нет. Новое поле
   `remote: {system, shell}` в `src/shared/terminal-ai/context.ts`; `contextText` пишет строку
   «Command runs on a remote host: Linux, bash». Имя Remote host-а в контекст не попадает.
2. **Ветка** — `assist.ts`: для запроса SSH session `branchOf` не зовётся.
3. **Доступность** — `terminal-ai-fix.ts`: в SSH session с интеграцией `available` — последняя
   удалённая команда упала, удалённая не идёт, удалённый shell ждёт ввода, Remote host включён, Fix
   включён в Settings. Связь zsh с socket-ом в SSH session не нужна.
4. **Запуск** — `fix.ts`: в SSH session — контекст из `remote-context.ts`, ответ — через
   `remote-insert`. Отказ `remote-insert` — «Terminal is busy».

**Не входит:** Fix команды внутри tmux или вложенного shell-а на Remote host-е; переключатель отправки
(Ticket 08).

## Готово, когда

- [ ] Unit `test/unit/terminal-ai-remote-context.test.ts` (новый): удалённый слой → вход с удалённой
  папкой и командами, `branch: null`, `remote: {system: 'Linux', shell: 'bash'}`; имени Remote host-а
  нет ни в одном поле; секрет `ghp_…` в выводе — `[redacted]`.
- [ ] Contract `test/contract/terminal-ssh-fix.test.ts` (новый), настоящие zsh и bash, поддельные `ssh`
  и assist: в SSH session `ls /nonexistent-worfy` — `available` true; `terminalAi.fix.run` — в журнале
  fake команда, код выхода не 0, хвост с «No such file», ветки нет; ответ fake в удалённой строке;
  команда не запущена (нет `\r` в записи в pty).
- [ ] Тот же contract: пока идёт удалённая команда (`read -s`) — `available` false и запроса нет;
  удалённая команда упала, но Remote host не включён (SSH session без интеграции) — false; `git-branch`
  не вызывался ни разу за SSH session.
- [ ] Тот же contract: после выхода из SSH session локальный Fix работает как раньше.
- [ ] e2e `test/e2e/terminal-ssh-fix.spec.ts` (новый), fake с ответом, поддельный `ssh`: в SSH session
  команда с ошибкой — кнопка «Fix»; нажатие — ответ в строке xterm; вывода исправленной команды нет,
  пока test не нажал Enter.
- [ ] `test/contract/terminal-ai-fix.test.ts` и `test/e2e/terminal-ai-fix.spec.ts` зелёные без правки
  ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «в SSH session `ls /nonexistent-worfy` → `available` true»: сегодня
false, идёт команда `ssh`. Потом контекст, отказы, e2e.

## Где в коде

- `src/main/terminal-ai/remote-context.ts` (новый)
- `src/shared/terminal-ai/context.ts`
- `src/main/terminal-ai/assist.ts`
- `src/main/terminal-ai/fix.ts`
- `src/main/ipc/terminal-ai-fix.ts`
- `test/unit/terminal-ai-remote-context.test.ts` (новый)
- `test/contract/terminal-ssh-fix.test.ts` (новый)
- `test/e2e/terminal-ssh-fix.spec.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
