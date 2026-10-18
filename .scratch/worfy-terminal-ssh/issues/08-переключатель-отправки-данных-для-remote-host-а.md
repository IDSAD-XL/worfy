# 08 — Переключатель отправки данных в модель для Remote host-а

Type: task
Status: open
Blocked by: 03, 06, 07
Source: решение владельца 2026-10-18, пункт 4 (тот же уровень данных, что локально, плюс переключатель на каждом Remote host-е, который выключает отправку) ([spec.md](../spec.md)); «Решено без владельца», пункт 6 (отправка по умолчанию включена)

## Что происходит

- После Ticket-а 03 у записи Remote host-а есть поле `send` (по умолчанию `true`), но в Settings
  переключателя нет и никто его не читает.
- После Ticket-ов 06 и 07 Fix и Command request в SSH session строят контекст в
  `src/main/terminal-ai/remote-context.ts`.

## Что делаем

1. **Проверка** — `remote-context.ts`: `send: false` — отказ `host-off` до сборки контекста. Модель не
   спрашивается, кнопка «Fix» и панель в SSH session недоступны. Интеграция на Remote host-е при этом
   работает: границы команд worfy видит.
2. **Settings** — `src/renderer/settings/TerminalAiHosts.tsx`: переключатель «Отправлять данные в
   модель» у каждого Remote host-а. Подсказка: «Выключено — Fix и Command request на этом хосте не
   работают».
3. Выключение действует сразу, в текущей SSH session: проверка — на каждый запрос.

## Готово, когда

- [ ] Unit `test/unit/terminal-ai-remote-context.test.ts`: `send: false` — отказ `host-off`, контекст
  не собран; `send: true` — как в Ticket-е 06.
- [ ] Unit (jsdom) `test/unit/terminal-ai-hosts-section.test.tsx`: переключатель «Отправлять данные в
  модель» зовёт `terminalAi.hosts.set` с `send: false`; подсказка видна.
- [ ] Contract `test/contract/terminal-ssh-send-off.test.ts` (новый), настоящие zsh и bash, поддельные
  `ssh` и assist: Remote host с `send: false` — удалённая команда упала, `terminalAi.fix.state` —
  `available` false; `terminalAi.fix.run` и запрос панели — отказ, журнал fake пуст.
- [ ] Тот же contract: выключение посреди SSH session — следующий запрос отказан; включение — снова
  работает, переподключаться не нужно.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

Сначала падающий test — contract «`send: false` → журнал fake пуст»: проверки ещё нет. Потом unit и
раздел Settings.

## Где в коде

- `src/main/terminal-ai/remote-context.ts`
- `src/renderer/settings/TerminalAiHosts.tsx`
- `test/unit/terminal-ai-remote-context.test.ts`
- `test/unit/terminal-ai-hosts-section.test.tsx`
- `test/contract/terminal-ssh-send-off.test.ts` (новый)

## Итог

Заполняется по завершении Ticket-а.
