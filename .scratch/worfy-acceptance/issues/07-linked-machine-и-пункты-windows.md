# 07 — Acceptance на Linked machine и пункты Windows: Read only смотрит, Full access решает, сборка ПК из `hello.build`

Type: task
Status: open
Blocked by: 02, 05
Source: [spec.md](../spec.md), «Ticket-ы», 7; «Решения по реализации» → «Linked machine», «Платформа, копия и commit
строки»; «Риски», «Linked machine со старой worfy»; «Истории пользователя», 9

Кто: агент.

Не платформенный Ticket (link и renderer; Harness не трогает). Глубина ревью — `medium`.

## Что происходит

- После Ticket-а 05 вид показывает очередь Project-ов своей Machine; в окне Linked machine его нет.
- Сборку Linked machine Mac знает из `hello.build` (`src/main/link/messages.ts:68`). Новое сообщение получает только
  Machine, которая назвала его в `hello` (ADR-0079).
- Права Read only и Full access проверяют `src/main/link/ipc-adapter.ts` и `src/main/link/remote-calls.ts`; Evidence-
  хранилище по связи не отдаётся (`docs/features/evidence.md`, «On a Linked machine»).

## Что делаем

1. Окно Linked machine показывает очередь Project-ов той Machine, как Pull requests: `acceptance.get` и
   `acceptance.changed` идут по связи.
2. Read only — только смотреть: Pass и Fail неактивны с подсказкой Read only; Full access — решение уходит Orchestrator-у
   Project-а на его Machine.
3. Платформа строки «Checked in» — Machine окна; копия — из `needs:`; `sha` — сборка Linked machine из `hello.build`.
4. Пункт `needs: windows …` на Mac показывает сборку ПК, пока ПК связан и в сети; иначе — «PC not connected».
5. Старая worfy на той Machine — вид говорит обновить её.
6. `docs/features/link.md`: Acceptance на Linked machine.

## Готово, когда

- [ ] Contract test (`test/contract/acceptance-linked.test.ts`, новый): Read only получает снимок и получает отказ на
      `actions.ownerCheck`; Full access кладёт текст в очередь Orchestrator-а другой Machine; `needs: windows` берёт
      сборку из `hello.build`. Красный до правки — в «Итог».
- [ ] e2e test (`test/e2e/linked-acceptance.spec.ts`, новый, образец `test/e2e/linked-read-only.spec.ts`): окно Linked
      machine показывает очередь, Read only — кнопки неактивны с подсказкой.
- [ ] `docs/features/link.md` описывает Acceptance на Linked machine; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/link/messages.ts`, `src/main/link/ipc-adapter.ts`, `src/main/link/remote-calls.ts`
- `src/main/acceptance/stable-line.ts` (Ticket 02: сборка ПК), `src/renderer/acceptance/AcceptanceView.tsx` (Ticket 05)
- `test/contract/acceptance-linked.test.ts`, `test/e2e/linked-acceptance.spec.ts` (новые)
- `docs/features/link.md`

Только читать: `test/e2e/linked-read-only.spec.ts`, `test/contract/linked-ipc.test.ts`.

## Вне скоупа

- Снимки и клипы в окне Linked machine (spec, «Не в этом Epic-е»).
