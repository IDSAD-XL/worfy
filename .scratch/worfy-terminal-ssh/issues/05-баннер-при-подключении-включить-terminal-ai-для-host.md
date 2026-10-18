# 05 — Баннер при подключении: «Включить Terminal AI для `host`?» в шапке Terminal-а

Type: task
Status: open
Blocked by: 02, 03
Source: решение владельца 2026-10-18, пункт 3 (баннер в шапке Terminal-а при подключении, кнопки «Включить» и «Не спрашивать для этого хоста», включение — со следующего входа, без принудительного переподключения) ([spec.md](../spec.md)); «Решено без владельца», пункты 4 (каналы `local`), 6 (отправка по умолчанию включена)

## Что происходит

- После Ticket-а 02 main шлёт событие `ssh-session-started {host}` и `ssh-session-ended` для каждого
  интерактивного входа по `ssh`, включён Remote host или нет.
- После Ticket-а 03 есть список Remote host-ов и канал `terminalAi.hosts.set`.
- Шапка Terminal Node-а — `src/renderer/canvas/nodes/TerminalNode.tsx`: заголовок, имя shell-а,
  кнопка «Fix», после выхода shell-а — `exit N` и Restart.

## Что делаем

1. **Когда предлагать** — `src/main/terminal-ai/ssh-offer.ts` (новый). SSH session началась, Remote
   host-а нет в списке, Terminal AI включён в Settings. Remote host с `dontAsk` или уже в списке —
   баннера нет. Конец SSH session убирает баннер.
2. **Каналы** — `src/shared/ipc/terminal-ai-ssh-offer.ts`, `src/main/ipc/terminal-ai-ssh-offer.ts`
   (новые): `terminalAi.sshOffer.state {projectId, nodeId}` → `{host | null}`, событие
   `terminalAi.sshOffer.changed`. Пометка — `local`: с экрана Linked machine-а баннера нет.
3. **Баннер** — `src/renderer/canvas/nodes/TerminalSshBanner.tsx` (новый), в шапке Terminal Node-а.
   Текст «Включить Terminal AI для `host`?». «Включить» — `terminalAi.hosts.set {host, enabled:
   true}`, баннер сменяется на «Включено со следующего входа» на несколько секунд. «Не спрашивать для
   этого хоста» — `{host, dontAsk: true}`. Закрыть крестиком — баннер до следующей SSH session.
4. Терминал под баннером не сдвигается и не теряет фокус.

**Не входит:** переподключение текущей SSH session; баннер на экране Linked machine-а.

## Готово, когда

- [ ] Contract `test/contract/terminal-ai-ssh-offer.test.ts` (новый), настоящий zsh, поддельный `ssh`:
  `ssh srv` для Remote host-а не из списка — `terminalAi.sshOffer.changed` с `srv`; выход — `null`;
  Remote host в списке или с `dontAsk` — события нет; Terminal AI выключен в Settings — нет; `ssh srv
  ls` — нет; каналы помечены `local`.
- [ ] Unit (jsdom) `test/unit/terminal-ssh-banner.test.tsx` (новый): баннер с именем; «Включить»
  зовёт `terminalAi.hosts.set` с `enabled: true` и показывает «Включено со следующего входа»; «Не
  спрашивать для этого хоста» — `dontAsk: true`; крестик прячет; событие с `null` прячет.
- [ ] e2e `test/e2e/terminal-ssh-banner.spec.ts` (новый), поддельный `ssh` первым в `PATH` Terminal-а:
  `ssh srv` — баннер в шапке; «Включить» — в `terminal-ai-hosts.json` запись `srv` с `enabled: true`;
  вывод Terminal-а не прервался; фокус остался в xterm.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: баннер в светлой и тёмной теме —
  `../evidence/05-banner-light.png`, `../evidence/05-banner-dark.png`. Как проверить: окно worfy.
- [ ] `test/e2e/terminal.spec.ts` и `test/e2e/terminal-ai-fix.spec.ts` зелёные без правки ожиданий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «`ssh srv` → `terminalAi.sshOffer.changed`»: модуля ещё нет. Потом
баннер в jsdom, e2e.

## Где в коде

- `src/main/terminal-ai/ssh-offer.ts` (новый)
- `src/shared/ipc/terminal-ai-ssh-offer.ts` (новый)
- `src/main/ipc/terminal-ai-ssh-offer.ts` (новый)
- `src/renderer/canvas/nodes/TerminalSshBanner.tsx` (новый)
- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/canvas/nodes/TerminalNode.css`
- `test/unit/terminal-ssh-banner.test.tsx` (новый)
- `test/contract/terminal-ai-ssh-offer.test.ts` (новый)
- `test/e2e/terminal-ssh-banner.spec.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
