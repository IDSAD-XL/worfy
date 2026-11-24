# 07 — Acceptance на Linked machine и пункты Windows: Read only смотрит, Full access решает, сборка ПК из `hello.build`

Type: task
Status: claimed 2026-11-24T03:36Z
Branch: worfy-acceptance/07
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
  - evidence: test-run pass · `pnpm test test/contract/acceptance-linked.test.ts` exit 0 · mac - · 555be01f7
- [ ] e2e test (`test/e2e/linked-acceptance.spec.ts`, новый, образец `test/e2e/linked-read-only.spec.ts`): окно Linked
      machine показывает очередь, Read only — кнопки неактивны с подсказкой.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/linked-acceptance.spec.ts test/e2e/acceptance.spec.ts test/e2e/linked-read-only.spec.ts` exit 0 · mac dev · 555be01f7
- [ ] `docs/features/link.md` описывает Acceptance на Linked machine; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 555be01f7
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `pnpm lint` exit 0; `pnpm typecheck` exit 0; `gate fast` exit 0 (lint, typecheck, test) · mac - · 555be01f7

## Где в коде

- `src/main/link/messages.ts`, `src/main/link/ipc-adapter.ts`, `src/main/link/remote-calls.ts`
- `src/main/acceptance/stable-line.ts` (Ticket 02: сборка ПК), `src/renderer/acceptance/AcceptanceView.tsx` (Ticket 05)
- `test/contract/acceptance-linked.test.ts`, `test/e2e/linked-acceptance.spec.ts` (новые)
- `docs/features/link.md`

Только читать: `test/e2e/linked-read-only.spec.ts`, `test/contract/linked-ipc.test.ts`.

## Вне скоупа

- Снимки и клипы в окне Linked machine (spec, «Не в этом Epic-е»).

## Итог

- `hello` несёт платформу (`platform`, необязательное поле, `src/main/link/messages.ts`); `LinkService` держит сборку и
  платформу из последнего `hello` каждого соединения (`announced`, событие `hello`, `src/main/link/service.ts`);
  `RemoteCalls.machines()` отдаёт их окнам в `linked.state` (`build`, `platform`, `src/shared/ipc/linked.ts`), пока
  соединение открыто.
- Очередь и решение по связи работали уже после Ticket-ов 01–05: `acceptance.get` и `acceptance.changed` помечены
  `project`/`read`, `actions.ownerCheck` — `project`/`write`, окно на Linked machine шлёт их туда по метке. Ticket
  добавил то, чего не было: платформу и commit Linked machine в строке «Checked in», строку сборки пункта другой
  платформы (`PC build: <build> (<name>)` или `PC not connected`), «Update worfy on <name>» для старой worfy, и строку
  Update first в окне Linked machine без кнопки, которая обновила бы эту Machine. Чистые функции —
  `src/shared/acceptance/linked-build.ts`, вид — `src/renderer/acceptance/AcceptanceView.tsx`.
- Красный до правки:
  - `pnpm test test/contract/acceptance-linked.test.ts` на коде без правки main — exit 1: test «`needs: windows` on the
    Mac…» падает, `RemoteCalls.machines()` не знает `build` и `platform` B. Test-ы Read only и старой worfy были
    зелёными и до правки: это поведение дали метки каналов Ticket-ов 01–03. Test Full access — не доказательство 07: он
    охраняет уже существующий путь решения по связи (Ticket 03) и зелёный на коде до правки. В первом run-е он упал на
    ошибке самого test-а (очередь B не была прочитана до решения: «the Project … is not read yet»); test читает
    `acceptance.get` первым, как вид.
  - `pnpm test test/unit/acceptance-view.test.tsx` на `AcceptanceView.tsx` до правки — exit 1, 4 из 5 новых test-ов
    (решение с платформой и commit-ом ПК, строка сборки, «Update worfy on», Update first в окне ПК); test Read only
    зелёный и до правки.
  - `pnpm test:e2e test/e2e/linked-acceptance.spec.ts` на виде до правки — exit 1: нет строки `acceptance-linked-build`.
  - Раунд ревью 1: 5 новых test-ов красные до правки (`pnpm test test/contract/acceptance-linked.test.ts
    test/unit/acceptance-linked-build.test.ts` — exit 1): «Update worfy» до прихода `hello` и на старом Mac при ПК вне
    сети; строка «old» только для Machine окна; `platform: 'plan9'` роняло весь `hello`; `machines()` без соединения
    отдавал сборку. Test «B's `hello` comes after A sees the connection open» зелёный и до правки — он ловит мутант без
    слушателя `hello` в `RemoteCalls` (мутант в копии под `mktemp -d`: exit 1, `'no hello change'`).
- Снимки (в репозиторий не кладутся): `test-results/worfy-acceptance-07-screens/linked-read-only-1280-light.png`,
  `linked-read-only-1280-dark.png` — окно Mac на другой Machine с Read only.
- Решено без владельца:
  - платформу Linked machine Mac узнаёт из нового необязательного поля `hello` (`mac`, `windows`, `linux`): иначе
    нельзя понять, какая из Linked machine — ПК. Старая сборка поле не шлёт и при приёме отбрасывает;
  - «ПК» — любая подключённая Linked machine с платформой `windows`; сначала Machine окна, затем первая в списке. Так же
    для `needs: mac` на ПК («Mac build: …») и `linux`;
  - строки сборки нет, когда пункт проверяется на платформе этой Machine: её строка Stable copy говорит достаточно;
  - `sha` решения — commit сборки Linked machine, когда выбранная платформа — её, при любой копии: какая копия
    работает на той Machine, по связи не известно. Сборка `.dirty` — `-`. Этот commit сильнее `stableCommit` снимка
    очереди (Ticket 05, раунд 1): тот — commit Stable copy Machine очереди; в окне Linked machine он не берётся вовсе
    (решение на платформе этого компьютера — `-`), в окне этой Machine остаётся как в 05;
  - старая worfy: «Update worfy on <name>» при ответе `not open to Linked machines` на `acceptance.get` и
    `actions.ownerCheck`, и строкой сборки, когда Machine окна назвала в `hello` сборку, но не платформу; другая такая
    Linked machine может оказаться Mac-ом и не считается — в окне этой Machine строка тогда «PC not connected»; до
    прихода `hello` Machine тоже не считается; без платформы в `hello` «Checked in» берёт платформу из `needs:` пункта;
  - неизвестное значение `platform` в `hello` отбрасывается (`.catch(undefined)`), остальной `hello` остаётся;
  - Update first в окне Linked machine говорит «Update worfy on <name>» вместо кнопки Update worfy;
  - `test/e2e/linked-acceptance.spec.ts` добавлен в правило link таблицы `scripts/e2e-specs.table.json`.
