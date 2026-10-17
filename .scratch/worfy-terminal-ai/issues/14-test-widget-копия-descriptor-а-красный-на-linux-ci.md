# 14 — Test «a program a widget started at the prompt keeps a copy of the descriptor» красный на Linux CI

Type: task
Status: claimed 2026-10-17T17:03Z
Branch: worfy-terminal-ai/14
Blocked by: —
Source: batch CI run на main после Wave 11–13 — https://github.com/IDSAD-XL/worfy/actions/runs/39049858638
(job `check`, шаг `pnpm test --sequence.shuffle.files`, main `f3e77687`); test добавлен Ticket-ом [11](11-программа-в-terminal-пишет-в-соединение-shell-а.md), круг 2.

## Что происходит

- На Linux CI красный один test из 5960:
  `test/contract/terminal-ai-zle.test.ts:849` («a program a widget started at the prompt keeps a copy of the descriptor:
  after the next command the shell is connected again, and the copy reaches main no more»). Падение — `:871`:
  `await vi.waitFor(() => expect(existsSync(wroteFile)).toBe(true), WAIT)` — `expected false to be true`. До этого в том
  же test-е insert после команды дошёл (`:869-870` зелёные): связь shell-а после команды восстановлена.
- На Mac этот test зелёный: прогоны исполнителя и проверяющего Ticket-а 11, gate full перед merge PR #443.
- Вероятная причина — в самом test-е, не в коде (не проверено на Linux): программа-держатель запускается через
  `/bin/sh -c "… printf … >&$__worfy_assist_fd …; : > ${wroteFile}; …"` (`:857`). На Linux `/bin/sh` — dash, а dash
  не принимает в перенаправлении номер descriptor-а больше 9 («Bad fd number»); zsh даёт `{fd}` от 10. Скрипт
  обрывается до `: > wroteFile`. На Mac `/bin/sh` — bash, у него такого предела нет.

## Что делаем

1. Воспроизвести на Linux (контейнер или CI-подобное окружение без запуска платных job-ов) или доказать причину иначе.
2. Если причина в dash — держатель без `/bin/sh` с номером fd > 9 (например, `zsh -fc` или перенос descriptor-а на
   номер ≤ 9 в самом zsh перед запуском); проверка, что test по-прежнему красный на коде без `bye` (мутант R1 Ticket-а 11).
3. Если причина в коде — это дефект Ticket-а 11: исправить `src/main/terminal/zsh/rc.d/10-assist.zsh` /
   `src/main/terminal-ai/socket.ts` и записать в «Итог».

## Готово, когда

- [ ] Причина красного на Linux названа с доказательством (вывод команды или лог).
- [ ] `test/contract/terminal-ai-zle.test.ts` зелёный на Mac и на Linux CI (batch CI run после Wave зелёный).
- [ ] Мутант «shell не шлёт `bye`» — этот test красный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка `[gate] зелено (full)`.

## Где в коде

- `test/contract/terminal-ai-zle.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `src/main/terminal/zsh/rc.d/10-assist.zsh`,
`src/main/terminal-ai/socket.ts`.

## Вне скоупа

- Остальные долги Ticket-а 11 («Итог»: `20-suggest-ai.zsh:68`, `allexport`, widget-ы на prompt-е).

## Итог

Причина — в test-е, не в коде: программы test-ов запускались через `/bin/sh -c`, а на Linux `/bin/sh` — dash.
Dash на перенаправлении в descriptor с номером больше 9 (`>&11`) пишет «Syntax error: Bad fd number» и бросает
весь скрипт. Shell держит соединение на descriptor-е от 10 (`{fd}` в zsh), поэтому держатель не доходил до
`: > wroteFile`, и test падал на `existsSync(wroteFile)`. Код `10-assist.zsh` и `socket.ts` не менялся.

Доказательства:

- Linux, контейнер `ubuntu:24.04` (как `ubuntu-latest` CI; `/bin/sh -> /usr/bin/dash`, zsh 5.9): zsh держит файл
  на fd 11; `/bin/sh -c "printf ask >&$fd 2>/dev/null; : > wrote"` — «Syntax error: Bad fd number», exit 2, файла нет;
  тот же скрипт через `zsh -fc` — exit 0, файл есть, в descriptor записано `ask`.
- Mac, test в исходном виде, держатель через `/bin/dash -c` (временная правка): exit 1, падение
  `terminal-ai-zle.test.ts:871:58` «expected false to be true» — тот же симптом и та же строка, что в CI run
  39049858638. Через `/bin/sh -c` (bash на Mac): exit 0.

Исправление — `test/contract/terminal-ai-zle.test.ts`: константа `PROGRAM` = `${ZSH} -fc` (zsh без файлов запуска)
вместо `/bin/sh -c` во всех трёх местах, где программа test-а пишет в descriptor по номеру до 255:

- держатель копии descriptor-а (test этого Ticket-а);
- `DESCRIPTORS` — перебор descriptor-ов 3–255. Под dash проверка `open:` молча не видела descriptor-ы от 10;
  проверка `socket:` (`[ -S /dev/fd/$n ]`) работала. Убрано примечание о том, что bash держит свою копию выше 9:
  zsh такой копии не держит (проверено: при открытом fd 11 bash показывает `open:10 open:11`, zsh — `open:11`);
- test «an ask a program writes into every descriptor it was given does not reach main». Под dash программа не
  писала ни в один descriptor от 10, то есть ни разу не пробовала descriptor соединения shell-а: на Linux test был
  зелёным, ничего не проверяя.

Проверка на Mac:

- `node scripts/vitest-electron.mjs test/contract/terminal-ai-zle.test.ts` — exit 0, 49 из 49.
- Мутант «shell не шлёт `bye`» (`_worfy_assist_send bye` в `_worfy_assist_close` выключен) — exit 1, красные 2
  из 49, среди них test держателя (`:875`); как у мутанта R1 Ticket-а 11. Файл восстановлен из копии.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (5890 passed, 70 skipped из 5960).

Не проверено: зелёный batch CI run на Linux — его запускает оркестратор после merge Wave. Весь test-файл
в Linux-контейнере не прогонялся (нужна сборка Electron и `node-pty` под Linux); в контейнере проверен только
механизм dash.
