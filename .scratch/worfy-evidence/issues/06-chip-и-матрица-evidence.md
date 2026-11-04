# 06 — Chip «Evidence n/m» на карточке и матрица в focus mode

Type: task
Status: claimed 2026-11-04T02:50Z
Blocked by: 05
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 4, «Что есть сейчас» (слоты карточки, focus mode), «Решено без владельца», п. 6

## Что происходит

- После 05 у модели Ticket-а есть `evidence` с состоянием каждого пункта.
- Badge карточки — файл в `src/renderer/canvas/badges/`, подхватывается сам (`src/renderer/canvas/badges/index.ts:1-11`, `:42`);
  место под chips — две строки, `SLOTS_HEIGHT` (`src/renderer/canvas/ticket-card.ts:49-55`): gate, PR, CI и verdict уже их
  занимают.
- В focus mode под шапкой Ticket-а — весь его текст, `TicketBody` (`src/renderer/canvas/nodes/TicketNode.tsx:199`).
- Внешний адрес открывает `shell.openExternal` (`src/shared/ipc/shell.ts:45`), файл Project-а — `shell.openInEditor`
  (`src/shared/ipc/shell.ts:26`). Окна просмотра картинки по пути Project-а в renderer нет: `ImagePreview`
  (`src/renderer/session/MessageAttachments.tsx:111`) показывает только вложения сообщений.
- Страница репозитория — `repoUrl` (`src/shared/ipc/runs.ts:135-140`: `<repoUrl>/pull/<N>`, `<repoUrl>/commit/<sha>`); после 05 оно есть
  и в модели workflow.

## Что делаем

1. **`src/renderer/canvas/badges/Evidence.tsx`** — chip «Evidence 3/5»: зелёный, когда все пункты проверены; красный, когда есть
   красный; иначе нейтральный. Tooltip — «3 verified, 1 not verified, 1 failed». Ticket без пунктов — chip нет.
2. **Место chip-а** — `ticket-card.ts`: chip входит в строки `SLOTS_HEIGHT`; если не входит на самой широкой карточке — третья
   строка, числа и `epic-frame.css` правятся вместе (комментарий файла, строка 14).
3. **`src/renderer/canvas/nodes/EvidenceMatrix.tsx`** — в focus mode над `TicketBody`: заголовок «Evidence · 3 of 5 verified»,
   строка на пункт (номер, начало текста, состояние «Verified» / «Not verified: <reason>» / «Failed»), под ней строки Evidence
   (вид, исход, платформа и копия, короткий SHA, `ref`). Ссылки: SHA — `<repoUrl>/commit/<sha>`, `PR #N` — `<repoUrl>/pull/<N>`, URL —
   как есть, все через `shell.openExternal`; `repoUrl` равен null — SHA и PR текстом. Относительный путь (снимок или текстовый файл)
   разрешается от папки Ticket-а и открывается через `shell.openInEditor` — программой системы по умолчанию. Своего окна просмотра
   Epic не делает. Цвета — токены ready / working / blocked, всегда с подписью.
4. **`docs/design/F-SPEC.md`** — chip и матрица.

Названия в UI — английские (`docs/design/BRIEF.md`).

## Готово, когда

- [ ] Unit test `evidence-matrix`: три состояния, причина «needs windows stable, got windows installed», ссылки каждого вида ведут
      туда, куда сказано в п. 3 (снимок — `shell.openInEditor` с путём от папки Ticket-а); `repoUrl` null — SHA и PR текстом;
      Ticket без раздела — матрицы нет.
  - evidence: test-run pass · `pnpm test test/unit/evidence-matrix.test.tsx` exit 0 · mac dev · 1c0d13bb2
- [ ] e2e (`WORFY_AGENT=fake`, fixture-проект): карточка с «Evidence 1/3»; двойной click — focus mode с матрицей; click по `PR #N`
      зовёт `shell.openExternal` с адресом PR (stub); после записи `ticket evidence` в файл chip становится «Evidence 2/3» без
      перезапуска.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/ticket-evidence.spec.ts` exit 0 · mac dev · 1c0d13bb2
- [ ] e2e spec — строка в `scripts/e2e-specs.table.json`.
- [ ] Самая широкая карточка с пятью chips: подписи не обрезаны, карточка не налезает на соседнюю (e2e меряет высоту).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/ticket-evidence.spec.ts` exit 0 · mac dev · 1c0d13bb2
- [ ] Снимки в светлой и тёмной теме в `.scratch/worfy-evidence/evidence/06/`: chip трёх цветов и матрица; в строке Evidence — `scrub:`.
  - evidence: screenshot pass · `../evidence/06/evidence-chips-light.png` · mac dev · 1c0d13bb2 · scrub: 2026-11-04
  - evidence: screenshot pass · `../evidence/06/evidence-chips-dark.png` · mac dev · 1c0d13bb2 · scrub: 2026-11-04
  - evidence: screenshot pass · `../evidence/06/evidence-matrix-light.png` · mac dev · 1c0d13bb2 · scrub: 2026-11-04
  - evidence: screenshot pass · `../evidence/06/evidence-matrix-dark.png` · mac dev · 1c0d13bb2 · scrub: 2026-11-04
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (e2e по таблице).

## Тесты

- Unit `test/unit/evidence-matrix.test.tsx` (новый).
- e2e `test/e2e/ticket-evidence.spec.ts` (новый); строка в `scripts/e2e-specs.table.json`.
- Сначала падающий: e2e — chip «Evidence 1/3» не найден.
- Прогнать `test/unit/ticket-*.test.ts*`, `test/unit/*badges*.test.tsx`, `test/e2e/ticket-focus.spec.ts`.

## Где в коде

- `src/renderer/canvas/badges/Evidence.tsx` (новый)
- `src/renderer/canvas/badges/evidence.css` (новый)
- `src/renderer/canvas/nodes/EvidenceMatrix.tsx` (новый)
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `src/renderer/canvas/ticket-card.ts`
- `src/renderer/canvas/epic-frame.css`
- `docs/design/F-SPEC.md`
- `test/unit/evidence-matrix.test.tsx` (новый)
- `test/e2e/ticket-evidence.spec.ts` (новый)
- `scripts/e2e-specs.table.json`

Только читать: `src/renderer/canvas/badges/ChecksBadges.tsx` (образец chip-а), `src/renderer/theme/primitives.tsx`, `src/renderer/theme/primitives.css`,
`src/shared/ipc/shell.ts`.
