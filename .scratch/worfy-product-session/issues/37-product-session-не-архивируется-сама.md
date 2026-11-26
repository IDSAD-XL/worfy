# 37: Product Session не уходит в архив сама

Type: task
Status: done 2026-11-25T14:22Z
PR: #2194
Blocked by: None — can start immediately
Source: owner 2026-11-25: «они не должны архивироваться вообще пока пользователь сам ее не кинет в архив».

**What to build:** автоархив законченных Session (ADR-0076) никогда не берёт Node Product Session, что бы ни стояло в
Settings → Canvas «Archive finished sessions after». В архив её отправляет только Archive самого пользователя на этой
Node; Restore работает как раньше. Product Session, которые уже ушли в архив, сами не возвращаются.

## Что происходит

Product Session, простоявшая дольше порога «Archive finished sessions after» (или с правилом `ticket-done`, или по
«Archive finished sessions now»), уходит в архив вместе с обычными законченными Session. Владелец хочет, чтобы она
оставалась на Canvas, пока он сам её не заархивирует.

## Где в коде

- `src/main/layout/archive.ts` — `AutoArchiver`, `archiveCandidates`, правило `ticket-done`, `candidatesNow`
  (`layout.archiveCandidates`, «Archive finished sessions now»), `archiveFromScreen`. Product Session распознаётся
  уже существующим предикатом (тем, по которому её узнают экран Product Session и sidebar), второй не заводится.
- Unit и contract test-ы архива: `test/unit/*archive*`, `test/contract/*archive*`.
- `docs/adr/0076-*.md` — Amendment 2026-11-25 (одна-две фразы; бриф его называет).
- `docs/features/` — страница, которая описывает автоархив (en и `docs/features/ru/`).

Уточнено при работе (2026-11-25):

- Отдельного предиката Product Session не было: main узнавал её Node прямо в `src/main/agent/node-sessions.ts`
  (`isWorfyNode(node) && node.data.kind === 'product'`, сигнал сохранения при архиве). Эта проверка вынесена в
  `isProductSessionNode` (`src/shared/ipc/sessions.ts`); её читают `node-sessions.ts` и `archive.ts`.
- Действия Archive на одном Node в UI нет. Архив, который просит сам пользователь, — `archive` с экрана через
  `archiveFromScreen` (⌘Z после Restore, ⇧⌘Z); он Product Session по-прежнему берёт.
- Автоархив описан в `docs/features/canvas.md`; про архив Product Session говорят ещё `docs/features/product-session.md`
  и `docs/features/sessions.md` (en и ru). Комментарий в `test/contract/product-save-signal.test.ts` называл архив Node-а
  Product Session автоматическим.
- Test-ы: `test/unit/archive-rule.test.ts`, `test/contract/layout-archive.test.ts`.

Добавлено по решению Orchestrator-а (2026-11-25, PR #2194): слова владельца «пока пользователь сам ее не кинет в архив»
значат, что у пользователя должно быть действие Archive на Node.

- `src/renderer/canvas/nodes/SessionNode.tsx` — кнопка Archive у каждого Session Node, в конце строки под шапкой (своего
  контекстного меню у Session Node нет; в шапке рядом с Keep, Hide, Remove она отнимала у заголовка всё место — CI
  windows-e2e, `codex-sessions-on-canvas.spec.ts`, Node Codex шириной 300 px). Неактивна с причиной в tooltip, пока
  Session работает или ещё не начиналась; на read-only экране — как прочие действия записи.
  На строке под шапкой место отдают сначала источник, потом метка «Product Session»: на live Node-е минимальной ширины
  240 px Archive остаётся целой (ревью PR #2194).
- `src/renderer/canvas/archive-node.ts` (новый; в `tsconfig.test.node.json`, чтобы его грузил contract test) —
  `archiveSessionNode`: `archive` одного Node-а с экрана через `applyRecorded` (шаг ⌘Z), main проверяет его в
  `archiveFromScreen` и не берёт Node с Keep или закреплённый — кнопка тогда неактивна. Правило в записи — `idle`:
  новое значение старый worfy не прочитал бы и начал бы с пустого Layout-а.
- `src/renderer/settings/CanvasSection.tsx` — подсказка под порогом: Product Session сама не уходит, её архивирует Archive
  на её Node.
- Строки «Archive session» в Command palette нет: у palette нет строк для выбранного Node-а. Toast-а нет: toast архива —
  про партии таймера с Undo мимо ⌘Z, а Archive на Node отменяет ⌘Z.
- Test-ы: `test/unit/session-node-product.test.tsx`, `test/unit/settings-canvas.test.tsx`,
  `test/contract/layout-archive.test.ts`, `test/e2e/session-archive.spec.ts`.

## Готово, когда

- [ ] archiveCandidates никогда не возвращает Node Product Session — при любом пороге, при правиле ticket-done и в
  «Archive finished sessions now»; unit test красный на origin/main, зелёный здесь.
  - evidence: test-run pass · `pnpm test test/unit/archive-rule.test.ts test/contract/layout-archive.test.ts` exit 0 (8 new tests; red before the fix) · mac - · 98c52342d
  - evidence: review pass · PR #2194 · - - · 5eae90d104cf4930c8b854173a5824b9251a290b
- [ ] Ручной Archive на Node Product Session по-прежнему архивирует её, Restore возвращает; test.
  - evidence: test-run pass · `pnpm test test/contract/layout-archive.test.ts` exit 0 (a screen archive of a Product Session, Restore, next run leaves it) · mac - · 98c52342d
  - evidence: review pass · PR #2194 · - - · 5eae90d104cf4930c8b854173a5824b9251a290b
- [ ] Комментарий в `archive.ts`, ADR-0076 Amendment (дата 2026-11-25, одна-две фразы) и страница `docs/features`,
  которая описывает автоархив (en и ru), говорят, что Product Session не уходит в архив сама.
  - evidence: commit pass · worfy-product-session/37: the automatic archive never takes a Product Session · - - · 98c52342d
  - evidence: review pass · PR #2194 · - - · 5eae90d104cf4930c8b854173a5824b9251a290b
- [ ] Кнопка Archive под шапкой Session Node (любого, не только Product Session) отправляет в архив этот Node одним шагом ⌘Z
  через `archive` с экрана; пока Session работает или ещё не начиналась, кнопка неактивна и tooltip говорит почему.
  Unit и contract test-ы красные на origin/main; e2e `test/e2e/session-archive.spec.ts`: Archive на Product Session
  убирает её с Canvas, Restore в Archive возвращает, таймер её не берёт.
  - evidence: test-run pass · `pnpm test test/unit/session-node-product.test.tsx test/contract/layout-archive.test.ts` exit 0 (button and archiveSessionNode tests; red before the change) · mac - · b3bac6916
  - evidence: test-run pass · `pnpm test:e2e test/e2e/session-archive.spec.ts` exit 0 · mac dev · b3bac6916
  - evidence: test-run pass · `pnpm test:e2e test/e2e/session-archive.spec.ts test/e2e/codex-sessions-on-canvas.spec.ts` exit 0 (Archive under the header; titles visible) · mac dev · 8404d697e
  - evidence: test-run pass · `pnpm test test/unit/session-node-product.test.tsx test/unit/session-node-remove.test.tsx` exit 0 (pinned alone; read-only Node with a live Session) · mac - · 773dd1253
  - evidence: test-run pass · `pnpm test:e2e test/e2e/session-archive.spec.ts test/e2e/codex-sessions-on-canvas.spec.ts` exit 0 (Archive whole at 240 px; label whole at 340 px) · mac dev · 773dd1253
  - evidence: review pass · PR #2194 · - - · 5eae90d104cf4930c8b854173a5824b9251a290b
- [ ] Settings → Canvas под порогом «Archive finished sessions after» говорит, что Product Session сама в архив не уходит;
  unit test.
  - evidence: test-run pass · `pnpm test test/unit/settings-canvas.test.tsx` exit 0 (red before the change) · mac - · b3bac6916
  - evidence: review pass · PR #2194 · - - · 5eae90d104cf4930c8b854173a5824b9251a290b
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 98c52342d
  - evidence: gate pass · `gate fast` exit 0 · mac - · 98c52342d
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · b3bac6916
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 8404d697e
  - evidence: gate pass · `gate fast` exit 0 · mac - · 8404d697e
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 0645247f7
  - evidence: gate pass · `gate fast` exit 0 · mac - · 0645247f7
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45618805239/job/139271751095 · ci - · 5eae90d104cf4930c8b854173a5824b9251a290b
- [ ] (вручную) На Mac Stable Product Session, простоявшая дольше порога, остаётся на Canvas; Archive в её меню убирает
  её в архив.
  - needs: mac stable

## Решено без владельца — подтверждено владельцем 2026-11-26

Записано в PR #2194 и в [Code story](../stories/37-product-session-не-архивируется-сама.md) («Decided without the owner
(to confirm)»); владелец подтвердил 2026-11-26 (раунд Q1–Q12 вечернего отчёта 2026-11-25, Q6):

1. Product Session, закрытая без Close, даёт сигнал сохранения только на Archive, Close или `product_save`, а не после
   порога архива.
2. Ручной архив пишется с правилом `idle`: новое значение сделало бы `layout.json` нечитаемым для старого worfy.
3. Строки в Command palette и toast у кнопки Archive нет.
4. Product Session-ы, уже заархивированные автоматически, не восстанавливаются.
5. Кнопка Archive есть у каждой Session Node.
