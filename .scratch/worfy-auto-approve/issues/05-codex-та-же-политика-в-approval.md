# 05 — Codex: та же политика в approval

Type: task
Status: claimed 2026-11-06T00:00Z
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает», п. 8; Q7

Глубина ревью: high.

## Что происходит

- Unattended approval Codex — `decline` сразу и `refused` (`src/main/vendors/codex/session.ts:586-590`); запрос в
  терминах worfy — `approvalAsk` (`src/main/vendors/codex/approvals.ts:59`).
- Unattended Codex идёт в `full-access` (`approvalPolicy: 'never'`, `src/main/vendors/codex/capabilities.ts:43-44`,
  `:59`): в Autopilot запросов сейчас нет. Ветка нужна для любого другого preset-а и для Q7 (б).
- Есть ли у `decline` способ передать модели текст подсказки — не проверено.

## Что делаем

1. Ветка `if (this.opts.unattended)` зовёт `this.opts.approval` (Ticket 04): `off` — как сегодня; `shadow` — решение
   пишется, ответ `decline`; `on` — allow → `accept`, deny / hard-deny → `decline`, park → как у attended
   (`permissions.ask`, Ticket 07).
2. Вход политики: команда (`input.command`, `cwd`) — через разбор Ticket-а 02; `fileChange` — пути изменений и
   `grantRoot`. `acceptForSession` политика не отвечает никогда: каждое решение — на один запрос.
3. Подсказка при `decline`: выяснить по протоколу app-server-а (`src/main/vendors/codex/protocol/`), можно ли
   передать текст; если нет — подсказка остаётся только в Journal; записать в «Итог».

## Готово, когда

- [ ] Contract test на fake Codex (`WORFY_CODEX=fake`, временный `CODEX_HOME`): `off` — ответы как сегодня; `shadow`
      — `decline` и строка `would-allow`; `on` — `accept` внутри worktree, `decline` вне корня и на hard deny.
- [ ] Contract test: `fileChange` с путём вне корней — `decline`; с `grantRoot` вне корней — `decline`.
- [ ] Ответ про текст подсказки Codex — в «Итог», со ссылкой на файл схемы протокола.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/auto-approve-codex.test.ts` (новый). Настоящий Codex не запускается.
- Прогнать `test/contract/codex-*.test.ts`, `test/unit/codex-*.test.ts`.

## Где в коде

- `src/main/vendors/codex/session.ts`
- `src/main/vendors/codex/approvals.ts`
- `test/contract/auto-approve-codex.test.ts` (новый)
