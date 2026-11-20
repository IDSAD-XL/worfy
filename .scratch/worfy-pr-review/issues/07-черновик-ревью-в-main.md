# 07 — Черновик ревью в main: файл в `state/pr-review/`, формат `payload` с `by` и `suggestedEvent`, каналы `prReview.*`, поиск строки заново, хранение 30 дней

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 7; «Решения по реализации», 6 и 11; «Решения по test-ам», Seam 1 и 2;
[critic](../../../docs/product/critic/worfy-pr-review-2026-11-20.md), возражение 3

Кто: агент.

Не платформенный Ticket (`src/main/`, `src/shared/`, ADR). Глубина ревью — `medium`.

## Что происходит

- Черновики ответов PR inbox лежат на этой машине в `<Profile folder>/state/pr-inbox/drafts/` (ADR-0105, пункт 6;
  `src/main/github/pr-reply-send.ts`); их каналы — `'local'` (`src/shared/ipc/pr-inbox.ts:233-239`).
- Формат черновика ревью Team reviewer-а — тело `POST /repos/{o}/{r}/pulls/{n}/reviews` (`event`, `body`, `comments[]`
  с `path`, `line`, `side`); его проверяет `harness/bin/review-draft-lint` (`:8-11`).
- Черновика ревью чужого PR нет. Pending review на GitHub worfy не создаёт (ADR-0105) — черновик только локальный файл.
- Возражение 3 critic-а (принято владельцем 2026-11-20): test гонки с `bin/pr-review-draft` — не здесь, а в Ticket-е 08,
  который создаёт этот скрипт.

## Что делаем

1. `src/main/github/pr-review-draft.ts` (новый): файл `<Profile folder>/state/pr-review/<owner>-<repo>-<N>.json` —
   `{ schema: 1, repo, pr, startedOn, payload: { event, body, comments: [{ path, line, side, start_line?, start_side?,
   body }] }, anchors: [{ text, by: 'person'|'agent' }], suggestedEvent?, agent?: { sessionId, state }, viewed: {
   <path>: <blob> }, state: 'draft'|'submitting'|'submitted', reviewUrl?, error? }`. `anchors[i]` — к
   `payload.comments[i]`; правка человеком ставит `by: 'person'`.
2. Запись через временный файл и rename, не чаще раза в 500 ms; один черновик на PR; `startedOn` — head PR при
   создании.
3. Поиск строки заново (re-anchor): по `anchors[i].text` после нового head-а; не нашлась — комментарий остаётся на
   старой строке с отметкой «line moved».
4. Discard удаляет файл; `submitted` хранится 30 дней и удаляется при запуске worfy.
5. Каналы `src/shared/ipc/pr-review.ts` (новый) и `src/main/ipc/pr-review.ts` (новый): `prReview.draft`,
   `prReview.saveComment`, `prReview.deleteComment`, `prReview.setViewed`, `prReview.discard` — все `'local'`; Linked
   machine их не вызывает. `prReview.drafts` — список PR с черновиком для chip-а `Review draft` (Ticket 10).
6. Amendment к ADR-0005: новое место состояния `state/pr-review/`.

## Готово, когда

- [ ] Unit `test/unit/pr-review-draft-format.test.ts` (новый): черновик ↔ `payload`, который принимает
      `review-draft-lint` (тот же `payload` проходит `node harness/bin/review-draft-lint` без находок формата);
      `by` после правки; re-anchor на сдвинутой строке и «line moved». Красный до правки — в «Итог».
- [ ] Contract `test/contract/pr-review-draft.test.ts` (новый): запись через rename (нет полузаписанного файла при
      обрыве), 500 ms, Discard, 30 дней, отказ Linked machine на каждом `prReview.*`. Без test-а гонки с
      `bin/pr-review-draft` — он в Ticket-е 08.
- [ ] Amendment ADR-0005 влит в этом PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/github/pr-review-draft.ts` (новый)
- `src/shared/ipc/pr-review.ts` (новый), `src/main/ipc/pr-review.ts` (новый)
- `docs/adr/0005-worfy-own-state-inventory.md`
- `test/unit/pr-review-draft-format.test.ts` (новый), `test/contract/pr-review-draft.test.ts` (новый)

Только читать: `src/main/github/pr-reply-send.ts` (папка черновиков, запись через rename), `src/shared/ipc/pr-inbox.ts`
(`'local'` каналы черновиков), `harness/bin/review-draft-lint`, `test/contract/pr-inbox-send.test.ts` (образец).

## Вне скоупа

- `bin/pr-review-draft`, Session Agent review и test гонки двух писателей — Ticket 08. Отметки Viewed с github.com —
  Ticket 09. Submit — Ticket 11.
