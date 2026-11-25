# 37: Product Session не уходит в архив сама

Type: task
Status: claimed 2026-11-25T07:57Z
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

- `src/renderer/canvas/nodes/SessionNode.tsx` — кнопка Archive в шапке каждого Session Node (рядом с Keep, Hide, Remove:
  своего контекстного меню у Session Node нет). Неактивна с причиной в tooltip, пока Session работает или ещё не
  начиналась; на read-only экране — как прочие действия записи.
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
- [ ] Ручной Archive на Node Product Session по-прежнему архивирует её, Restore возвращает; test.
  - evidence: test-run pass · `pnpm test test/contract/layout-archive.test.ts` exit 0 (a screen archive of a Product Session, Restore, next run leaves it) · mac - · 98c52342d
- [ ] Комментарий в `archive.ts`, ADR-0076 Amendment (дата 2026-11-25, одна-две фразы) и страница `docs/features`,
  которая описывает автоархив (en и ru), говорят, что Product Session не уходит в архив сама.
  - evidence: commit pass · worfy-product-session/37: the automatic archive never takes a Product Session · - - · 98c52342d
- [ ] Кнопка Archive в шапке Session Node (любого, не только Product Session) отправляет в архив этот Node одним шагом ⌘Z
  через `archive` с экрана; пока Session работает или ещё не начиналась, кнопка неактивна и tooltip говорит почему.
  Unit и contract test-ы красные на origin/main; e2e `test/e2e/session-archive.spec.ts`: Archive на Product Session
  убирает её с Canvas, Restore в Archive возвращает, таймер её не берёт.
- [ ] Settings → Canvas под порогом «Archive finished sessions after» говорит, что Product Session сама в архив не уходит;
  unit test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 98c52342d
  - evidence: gate pass · `gate fast` exit 0 · mac - · 98c52342d
- [ ] (вручную) На Mac Stable Product Session, простоявшая дольше порога, остаётся на Canvas; Archive в её меню убирает
  её в архив.
  - needs: mac stable
