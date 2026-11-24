# 10 — Комментарии к строкам чужого PR: «+» в gutter, `c`, диапазон, Suggest change, Pending и «Written by the agent», полоса Your review, Discard

Type: task
Status: done 2026-11-20T22:54Z
PR: #2115
Branch: worfy-pr-review/10
Blocked by: 07, 09
Source: [spec.md](../spec.md), «Ticket-ы», 10; «Как пользователь идёт по экрану», A (шаги 5–6) и E; «Экран»; «Решения по
реализации», 6 и 7 («Комментарии»); «Вопросы владельцу», Q7 раунда;
[critic](../../../docs/product/critic/worfy-pr-review-2026-11-20.md), возражение 1 и «Alternative»

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium` (решение владельца 2026-11-20, Q7 раунда: бывший Ticket 09
разделён, ступень `max` — только у Submit, Ticket 11).

Вне Epic-а: Ticket начинается после merge `worfy-changes-view` 05 (комментарии к строкам в Changes) — решение владельца
2026-11-20, Q7 раунда, возражение 1 critic-а: popover и клавиши берутся оттуда. Поле Blocked by берёт только номера
этого Epic-а.

## Что происходит

- После Ticket-а 09 Review mode показывает diff, дерево, нити и Viewed; черновик ревью и его каналы — Ticket 07;
  Agent review пишет свои комментарии в тот же черновик — Ticket 08.
- `worfy-changes-view` 05 даёт комментарий к строке Changes: «+» в gutter, `c`, диапазон, popover, ⌘↵ — адресат там
  Session.
- Комментарий вне diff-а PR GitHub отвергает (422); агент может ошибиться строкой.

## Что делаем

1. В Review mode — тот же popover и те же клавиши, что у `worfy-changes-view` 05; адресат — черновик ревью
   (`prReview.saveComment`). Suggest change вставляет блок `suggestion` с текстом выбранных строк; ⌘↵ — сохранить.
2. Комментарий на строке — «Pending · Edit · Delete»; комментарий агента — «Written by the agent · Edit · Delete»;
   правка человеком делает комментарий его (`by: 'person'`).
3. Комментарий к строке не из diff-а — списком «Not on a changed line» над файлом; Move to line или Delete.
4. Полоса Your review: «N pending comments on M files» и «(K by the agent)»; Discard с подтверждением «Discard N
   pending comments?»; Finish review (до Ticket-а 11 неактивна с tooltip «Coming next»; неактивна и пока Session
   пишет).
5. Строка списка PR с черновиком — chip `Review draft` (tooltip «3 pending comments, started on 3f2a9c1»;
   `prReview.drafts`).

## Готово, когда

- [ ] Unit `test/unit/review-comments.test.tsx` (новый): «+» и `c` открывают popover; диапазон; Suggest change;
      Pending и «Written by the agent»; правка делает комментарий человека; «Not on a changed line»; Discard с
      подтверждением; Finish review неактивна, пока Session пишет. Красный до правки — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/review-comments.test.tsx` exit 0 (15 tests; red before the change: 13 of 15) · mac - · 6596e039faad61ed85ea970b941d5ead06a6410a
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/review-comments.test.tsx` exit 0 (24 tests; red before: 13 of 15, round 2: 7 of 8) · mac - · 39e5b64cd5ca8d510bdb88c8c1380e902022f437
  - evidence: review pass · PR #2115 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e `test/e2e/pr-review.spec.ts`: комментарий → перезапуск worfy → черновик на месте; chip `Review draft` в
      строке; на `WORFY_AGENT=fake` — правка комментария агента; снимки обеих тем.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/changes.spec.ts test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts` exit 0 (18 passed, screenshots of both themes) · mac - · 6596e039faad61ed85ea970b941d5ead06a6410a
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/changes.spec.ts test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts` exit 0 (18 passed, screenshots of both themes) · mac - · 39e5b64cd5ca8d510bdb88c8c1380e902022f437
  - evidence: review pass · PR #2115 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Contract `test/contract/pr-review-draft.test.ts` и `test/contract/pr-search.test.ts`: ни одной записи на GitHub от
      комментариев, Discard и открытого Review mode.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-review-draft.test.ts test/contract/pr-search.test.ts` exit 0 · mac - · 6596e039faad61ed85ea970b941d5ead06a6410a
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-review-draft.test.ts test/contract/pr-search.test.ts` exit 0 · mac - · 39e5b64cd5ca8d510bdb88c8c1380e902022f437
  - evidence: review pass · PR #2115 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `test/unit/changes-view.test.tsx` и `test/e2e/changes.spec.ts` зелёные: комментарии Changes не изменились.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/changes-view.test.tsx test/unit/changes-tray.test.tsx` exit 0 and `pnpm test:e2e test/e2e/changes.spec.ts` exit 0 · mac - · 6596e039faad61ed85ea970b941d5ead06a6410a
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/changes-view.test.tsx test/unit/changes-tray.test.tsx` exit 0 and `pnpm test:e2e test/e2e/changes.spec.ts` exit 0 · mac - · 39e5b64cd5ca8d510bdb88c8c1380e902022f437
  - evidence: review pass · PR #2115 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44821710627/job/136601480838 · ci - · 27849a3684178e2caf5ca061c568019a5b16cbf9

## Где в коде

- `src/renderer/pr-review/ReviewMode.tsx`, `src/renderer/pr-review/ReviewBar.tsx` (новый)
- `src/renderer/changes/LineComment.tsx` (из `worfy-changes-view` 05; сверить с `main`), `src/renderer/changes/DiffPane.tsx`
- `src/renderer/pr-inbox/PrInboxView.tsx` (chip `Review draft`)
- `test/unit/review-comments.test.tsx` (новый), `test/e2e/pr-review.spec.ts`

Только читать: `src/shared/ipc/pr-review.ts`, `src/main/github/pr-review-draft.ts` (Ticket 07),
`.scratch/worfy-changes-view/issues/05-*.md`.

Образец вида — Card `card-53b21f06` («Prototype: PR search and review», Ticket 01), состояния `popover`,
`myself`, `moved`, `discard`. Состояние открывается сразу по `#state=<name>&theme=dark`.

## Вне скоупа

- Диалог Finish review и отправка — Ticket 11. Ответ в существующей нити — черновик и Send PR inbox без изменений.

## Итог

Сделано implementer-ом 2026-11-20, ветка `worfy-pr-review/10`, от `main` 60d2533e1.

- Комментарии к строкам в Review mode (`src/renderer/pr-review/review-comments.tsx`, новый; вид комментария —
  `src/renderer/pr-review/DraftComment.tsx`, новый: react-refresh не даёт держать компонент рядом с hook-ом): «+» в
  gutter, `c` на выбранных строках (щелчок — строка, Shift-щелчок или выделение — диапазон), popover из
  `src/renderer/changes/LineComment.tsx` — тот же, что у Changes; адресат — `prReview.saveComment` на commit
  черновика (`draftCommitOf`), не Session. LineComment получил необязательные `onSuggest` и `placeholder`, а картинки
  стали необязательными (`onFiles`/`onRemoveImage`): у Changes всё как было.
- Suggest change дописывает блок `suggestion` с текстом выбранных строк после набранного текста; ⌘↵ — сохранить;
  изменённый popover Esc не закрывает (правило polish 136), Escape под ним Review mode не закрывает.
- Комментарий под своей последней строкой: «Pending · Edit · Delete» или «Written by the agent · Edit · Delete»; Edit
  сохраняет с `ref`, main делает его `by: 'person'`; Delete — `prReview.deleteComment`.
- «Not on a changed line» над diff-ом: комментарий к строке, которой нет в hunk-ах своей стороны, или к файлу не из PR.
  Какие строки есть — `changes.file` по файлам с комментариями (main держит ответ в памяти по head). Move to line — режим:
  следующий «+» или `c` переносит комментарий туда; Delete.
- Полоса — `src/renderer/pr-review/ReviewBar.tsx` (новый): «N pending comments on M files», «N comments (K by the agent)
  on M files», Discard с kit Dialog «Discard N pending comments?» (после — файл удалён, Review mode закрыт, toast),
  Finish review неактивна: «Coming next», пока Session пишет — «Waits until the agent finishes or you stop it».
- Chip `Review draft` в строках inbox и результатов поиска (`PrListItem`, tooltip «3 pending comments, started on
  3f2a9c1»); список — `useReviewDrafts` в `review-store.ts` (`prReview.drafts`, заново после каждой правки окна и по
  `prReview.changed`; на Linked machine не читается).
- `docs/features/pr-inbox.md`: Comments on lines, The bar Your review, The chip Review draft, Implementation, Tests.

Test-ы. Красный до правки: `node scripts/vitest-electron.mjs test/unit/review-comments.test.tsx` — exit 1, 13 из 15
красные (зелёными были «Linked machine: no «+»» и «the draft could not be read»: они стерегут mutant-ов после правки);
после — exit 0, 15 из 15. Contract: `test/contract/pr-review-draft.test.ts` (комментарии, правка, перенос, Delete и
Discard — ни одного вызова gh) и `test/contract/pr-search.test.ts` (чтения открытого Review mode — только чтения) —
зелёные сразу: main не менялся. e2e `test/e2e/pr-review.spec.ts` целиком: новый test (+, Suggest change, диапазон и
`c`, перезапуск worfy, chip, Discard), правка комментария агента на fake agent, нет «+» на Linked machine; снимки
обеих тем в `test-results/worfy-pr-review-09-screens/` (`comments-1280`, `draft-chip-1280`, `discard-1280`), в
репозиторий не кладутся. `test/unit/review-mode.test.tsx` и e2e агентского test-а — новый текст счёта («… on 1 file»).

Отличия от прототипа (Card `card-53b21f06`):
- Popover kit-а у строки вместо composer-а внутри diff-а — Ticket требует popover Changes; кнопка «Save ⌘↵», а не «Add
  comment»; подсказка «Markdown…» — placeholder поля.
- `c` без выбранной строки показывает toast «Click a line first, then press c» (правило Changes), а не открывает
  комментарий на строке под указателем или первой строке файла.
- В шапке комментария нет аватара «You».
- Move to line — режим «Click a changed line's «+», or pick lines and press c»; у прототипа для него не было UI.
- «Not on a changed line» — один список над diff-ом, как в прототипе (в тексте Ticket-а — «над файлом»).
- В узкой колонке Review mode нет точки у PR с черновиком.
- Пока head ушёл от commit-а черновика, «+» нет: комментарии видны списком над diff-ом, у них Edit и Delete.

Решено без владельца:
- Chip `Review draft` — только у черновика с комментариями и не `submitted`: черновик создаётся на Start review, и
  иначе chip был бы у каждого открытого PR.
- Новые комментарии — только когда diff показывает All changes commit-а черновика (не Since my review, не новый head):
  иначе номер строки и commit Submit-а разошлись бы.
- Картинок в комментарии ревью нет (GitHub их в review comment не принимает).
- Delete — без подтверждения и без Undo (как в прототипе); Discard неактивен без комментариев и закрывает Review mode.
- Диапазон через несколько hunk-ов в UI не сохраняется: `c` и «+» показывают toast «A comment covers lines of one hunk…»
  (GitHub отвечает 422 «start_line must be part of the same hunk as the line»); такой диапазон агента — в «Not on a
  changed line».
- Правка комментария без текста строк (агент пишет "" для LEFT и для файлов, которых git не дал) берёт текст из diff-а;
  если строк в diff-е нет (комментарий не на строке diff-а) — пустые строки по числу строк комментария: main требует
  anchor ровно на столько строк.

Раунд 2 (review PR #2115). Строки для комментариев читаются без -w и с `expand` (свёрнутый файл — lock, generated,
слишком большой — больше не попадает в «Not on a changed line»); «+» и `c` при Hide whitespace читают файл сами, а не
молчат; Edit берёт текст строк в момент открытия (удаление соседа не подменяет его); Suggest change — только на новой
стороне. Test-ы: 9 новых в `test/unit/review-comments.test.tsx`; до правки из первых 8 — 7 красных (exit 1; зелёный — `draftChanged()`,
он стережёт mutant), 9-й (пустые строки) добавлен после; итог — 24 из 24, exit 0;
fake main проверяет число строк anchor-а, как `putComment`. Mutant-ы (по одному: `expand`, проверка `start_line`,
чтение при промахе, `draftChanged()` после save и после Delete, текст строк из diff-а при Edit, пустые строки, Suggest
только на новой стороне, отказ через hunk-и) — каждый даёт exit 1.
