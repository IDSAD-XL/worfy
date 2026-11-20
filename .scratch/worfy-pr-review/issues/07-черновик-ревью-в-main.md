# 07 — Черновик ревью в main: файл в `state/pr-review/`, формат `payload` с `by` и `suggestedEvent`, каналы `prReview.*`, поиск строки заново, хранение 30 дней

Type: task
Status: done 2026-11-20T06:42Z
PR: #2061
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
  - evidence: test-run pass · `pnpm test` (test/unit/pr-review-draft-format.test.ts, 16 tests) exit 0 · mac - · ac8ebab4b
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-review-draft-format.test.ts test/contract/pr-review-draft.test.ts` (19 unit) exit 0 · mac - · 2b0e9436a2af78dd037bba64411ccb2346cba070
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-review-draft-format.test.ts test/contract/pr-review-draft.test.ts` (20 unit) exit 0 · mac - · 7fe051346e95d8047d56e7655db7f82c77dab2a4
- [ ] Contract `test/contract/pr-review-draft.test.ts` (новый): запись через rename (нет полузаписанного файла при
      обрыве), 500 ms, Discard, 30 дней, отказ Linked machine на каждом `prReview.*`. Без test-а гонки с
      `bin/pr-review-draft` — он в Ticket-е 08.
  - evidence: test-run pass · `pnpm test` (test/contract/pr-review-draft.test.ts, 13 tests) exit 0 · mac - · ac8ebab4b
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-review-draft-format.test.ts test/contract/pr-review-draft.test.ts` (17 contract) exit 0 · mac - · 2b0e9436a2af78dd037bba64411ccb2346cba070
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-review-draft-format.test.ts test/contract/pr-review-draft.test.ts` (18 contract) exit 0 · mac - · 7fe051346e95d8047d56e7655db7f82c77dab2a4
- [ ] Amendment ADR-0005 влит в этом PR.
  - evidence: commit pass · worfy-pr-review/07: the review draft in main — state/pr-review/ file, prReview.* local channels · - - · ac8ebab4b
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · ac8ebab4b
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44680171080/job/136131606679 · ci - · 8f642554ac3817f945789583049c76de981504d1

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

## Итог

- `src/main/github/pr-review-draft.ts` — черновик ревью: чистая часть (`newReviewDraft`, `putComment`, `removeComment`,
  `setViewed`, `reviewPayloadOf`, `reanchor`) и класс `PrReviewDrafts` — файл
  `<Profile folder>/state/pr-review/<owner>-<name>-<N>.json`. Формат и каналы — `src/shared/ipc/pr-review.ts`, handler-ы —
  `src/main/ipc/pr-review.ts` (модуль находится сам, `import.meta.glob`; `test/unit/link-access.test.ts` перечисляет
  только каналы `project`, правка не нужна).
- Запись: изменение кладётся в очередь файла, первое пишется сразу, следующие — одной записью не раньше чем через
  500 ms после предыдущей. Запись читает файл заново и применяет к нему изменения из очереди: то, что за это время
  записал другой писатель (Agent review, Ticket 08), и поля, которых эта версия не знает, остаются. Ответ каждого
  канала — файл с применённой очередью. Временный файл и rename; сбой записи оставляет файл прежним, без `.tmp`, а
  изменение ждёт следующей записи. При выходе (`will-quit`) очередь пишется синхронно.
- Красный test до правки: `test/unit/pr-review-draft-format.test.ts` падал на импорте
  `src/main/github/pr-review-draft` (модуля не было), «Tests no tests», exit 1. После — 16 unit и 13 contract
  (`test/contract/pr-review-draft.test.ts`) зелёные.
- Amendment ADR-0005 (место `state/pr-review/`) — в этом PR.

Решено без владельца, подтверждено владельцем 2026-11-20:

- **Поля сверх формата spec-а.** `anchoredOn` — head, к строкам которого привязаны комментарии (нет — `startedOn`);
  `reanchor` ставит его, `startedOn` не меняется (tooltip «started on …» и полоса «N new commits since you started»
  считают от начала). `anchors[i].moved: true` — отметка «line moved». `submittedAt` — время Submit, от него считаются
  30 дней (нет — время изменения файла). `payload.event` нет, пока человек не выбрал вердикт в Finish review: worfy
  не выбирает `COMMENT` за него.
- **Удаление отправленных черновиков старше 30 дней — при первом обращении к черновикам Project-а после запуска**
  (`prReview.drafts`, chip `Review draft`), а не в `src/main/index.ts` при старте: папку Profile-а даёт `bin/profile`,
  и запускать его для каждого Project-а при старте worfy — лишняя цена; черновик, на который не смотрят, никому не
  мешает.
- **Re-anchor** ищет текст строк (без хвостовых пробелов) только для комментариев стороны `RIGHT`; ближайшее к старой
  строке совпадение; диапазон двигается целиком. Комментарий к `LEFT` не двигается: база не head. Канала для
  re-anchor нет — его вызовет Review mode (Ticket 09).
- **Каналы** сверх списка Ticket-а: `prReview.setViewed` и `prReview.saveComment` принимают `head` — первый
  комментарий или отметка Viewed создают черновик на этом head-е. Комментарий именуется `{index, path, body}`, как ответ
  в `prInbox.*`: Agent review мог сдвинуть комментарии, main берёт комментарий этого файла с этим текстом, ближайший к
  `index`, или отказывает.

Раунд ревью 1 (находки ревью корректности, каждая — test, красный до правки):

1. **Сбой записи — один честный исход.** Раньше изменение возвращалось в очередь, а вид получал отказ «The review
   draft was not saved»; повторный Save того же нового комментария добавлял его дважды. Теперь — как написано выше в
   «Итог» («изменение ждёт следующей записи»): канал отвечает успехом, черновик с изменением и `problem` «The review
   draft is not written yet: … worfy writes it with the next change, and when it quits». Очередь снимается только
   после rename: файл, который стал нечитаемым или битым между изменением и записью, больше не теряет очередь.
   Test-ы: contract «a write broken half way … told as not written yet, and written once», «the changes waiting are
   kept when the file cannot be read at the time of the write, and written once it can».
2. **Discard файла, который не разбирается** (обрезан, другая форма от `bin/pr-review-draft` или ручной правки):
   удаляет его без разбора; `submitting` проверяется, только когда файл читается как черновик; черновик другого PR по
   тому же пути не удаляется. Test-ы: contract «removes a file that is not a draft any more» (два случая), «does not
   remove a draft of another PR found at its path».
3. **Диапазон и текст строк.** `putComment` отказывает, если в `anchor` не столько строк, сколько в диапазоне
   `start_line..line` (один перевод строки в конце не считается строкой); `reanchor` берёт размер диапазона из
   комментария, а не из текста, — черновик после поиска строк заново всегда разбирается. Test-ы: unit «the text of a
   comment has exactly the lines it comments…», «a range keeps its size…», «a trailing line end … does not move the
   comment a line down».
4. **Payload без полей worfy:** test payload теперь кладёт неизвестное поле в сам `payload` — `...draft.payload` в
   `reviewPayloadOf` даёт красный.

После раунда — 19 unit и 17 contract зелёные.

Раунд ревью 2 (ревьюер подтвердил четыре правки и нашёл одну регрессию от них; каждая правка — test, красный до неё):

1. **Очередь снимается сразу после rename**, а не после удаления временного файла: выход worfy (`flushSync` на
   `will-quit`) в этом окне применял записанное изменение второй раз — `['A','B','B']` в файле. Для test-а добавлен
   параметр `removeTemp` (удаление временного файла). Test: contract «a quit between the rename and the removal of the
   temporary file writes nothing twice».
2. **Диапазон не выходит за конец файла после поиска строк заново:** место, где `start + size - 1` больше длины файла,
   не считается; не осталось мест — комментарий на старой строке с отметкой «line moved» (иначе GitHub ответил бы 422
   на Submit). Test: unit «a range that would run past the end of the file stays in place, marked moved».

После раунда — 20 unit и 18 contract зелёные.
