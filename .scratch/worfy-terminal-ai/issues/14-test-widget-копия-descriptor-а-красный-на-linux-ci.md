# 14 — Test «a program a widget started at the prompt keeps a copy of the descriptor» красный на Linux CI

Type: task
Status: open
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
  `/bin/sh -c "… printf … >&$__worfy_assist_fd …; : > ${wroteFile}; …"` (`:855`). На Linux `/bin/sh` — dash, а dash
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

—
