# 06 — Diff PR в Changes: предмет `pr`, локальный diff или diff из GitHub, нити ревью на строках, Amendment ADR-0110

Type: task
Status: claimed 2026-11-20T03:43Z
PR: #2069
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 6; «Факты GitHub API» → «Diff и файлы»; «Решения по реализации», 4;
«Решения по test-ам», Seam 1 и 2; [critic](../../../docs/product/critic/worfy-pr-review-2026-11-20.md), возражение 1

Кто: агент.

Не платформенный Ticket (`src/main/`, `src/shared/`, `src/renderer/changes/`, ADR). Глубина ревью — `medium`.

Вне Epic-а: Ticket начинается после merge `worfy-changes-view` 05 (комментарии к строкам в Changes) — решение
владельца 2026-11-20, Q7 раунда, возражение 1 critic-а: оба правят `src/renderer/changes/DiffPane.tsx` и каналы
`changes.*`. Поле Blocked by берёт только номера этого Epic-а. Номера строк ниже сверены с `ad2169058` и после merge
05 сдвинутся — implementer сверяет их с `main`.

## Что происходит

- Changes знает только Ticket: `changesTicketSchema` (`src/shared/ipc/changes.ts:22`), `DiffPane` и `FileTree`
  принимают `ticket` (`src/renderer/changes/DiffPane.tsx:17-23`, `:229`; `src/renderer/changes/FileTree.tsx:45`).
- Diff считает git этой машины только на чтение (`src/main/changes/git.ts`; ADR-0110: fetch не делается никогда).
- PR как предмет Changes — набросок части 2 `worfy-changes-view` без Ticket-ов (`.scratch/worfy-changes-view/spec.md`,
  раздел о части 2); этот Epic его берёт, Ticket 12 вычёркивает пункт там.
- Нити ревью PR (`path`, `line`, `isOutdated`) уже читает PR inbox (`src/main/github/inbox.ts:77`).

## Что делаем

1. Предмет `pr` — `{ repo: 'owner/name', number, headOid, baseOid }` в `src/shared/ipc/changes.ts` рядом с
   `changesTicketSchema`; каналы `changes.scopes`, `changes.list`, `changes.file` принимают его. `DiffPane` и
   `FileTree` получают `subject` вместо `ticket`; Ticket — тоже `subject`.
2. Локально, если репозиторий PR — репозиторий Project-а и оба commit-а есть (`git cat-file -e`): тот же
   `src/main/changes/` только на чтение; показ всего файла работает.
3. Иначе GitHub — `src/main/changes/github.ts` (новый): `GET /repos/{o}/{r}/pulls/{n}/files?per_page=100` страницами,
   разбор `patch` тем же `src/shared/changes/parse.ts` (hunk-и без заголовков git); файл без `patch` — «Large diff ·
   Open on GitHub»; больше 3 000 файлов — строка «GitHub lists the first 3,000 files»; у diff-а из GitHub — «View file
   on GitHub» вместо всего файла. Кэш в памяти main по head commit-у.
4. Scope-ы предмета `pr`: All changes (база ↔ head), Commit (`GET …/pulls/{n}/commits`), Since my review (commit ↔ новый
   head; `GET /repos/{o}/{r}/compare/{a}...{b}` или локально). Список файлов несёт blob id новой стороны (`sha` у
   `pulls/{n}/files`, локально — `git ls-tree`): по нему Ticket 09 снимает отметки Viewed.
5. Нити ревью GitHub — на своих строках; outdated — списком над файлом; ответ в нити — существующий черновик и Send
   PR inbox без изменений.
6. Amendment к ADR-0110: Changes читает GitHub для предмета `pr`; только GET, только по открытому экрану.
7. `docs/features/changes.md`: предмет `pr` (английский; перевод — Ticket 12).

## Готово, когда

- [ ] Unit `test/unit/changes-github-patch.test.ts` (новый): `patch` GitHub → hunk-и; файл без `patch`; переименование;
      binary. Красный до правки — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/changes-github-patch.test.ts` exit 0 · mac - · e83146a6b5db115f2996bb2e69bc3671baa361e8
- [ ] Contract `test/contract/changes-pr.test.ts` (новый) на gh stand-in и временном git-репозитории: локальный путь,
      путь GitHub, 3 000 файлов, файл без `patch`, кэш по head (второй вызов gh не делает), Since my review; ни одного
      `fetch`, `.git/index` не тронут (mtime и hash), ни одного `--method` у gh.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/changes-pr.test.ts` exit 0 · mac - · e83146a6b5db115f2996bb2e69bc3671baa361e8
- [ ] `test/contract/changes-read.test.ts`, `test/unit/changes-view.test.tsx`, `test/e2e/changes.spec.ts` зелёные с
      `subject` вместо `ticket`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/changes-read.test.ts test/unit/changes-view.test.tsx` exit 0; `pnpm test:e2e test/e2e/changes.spec.ts test/e2e/changes-comments.spec.ts` exit 0 · mac - · e83146a6b5db115f2996bb2e69bc3671baa361e8
- [ ] Amendment ADR-0110 влит в этом PR; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · e83146a6b5db115f2996bb2e69bc3671baa361e8
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/shared/ipc/changes.ts`, `src/main/ipc/changes.ts`
- `src/main/changes/subjects.ts`, `src/main/changes/scopes.ts`, `src/main/changes/git.ts`
- `src/main/changes/github.ts` (новый)
- `src/shared/changes/parse.ts`, `src/shared/changes/types.ts`
- `src/renderer/changes/DiffPane.tsx`, `src/renderer/changes/FileTree.tsx`, `src/renderer/changes/ScopeBar.tsx`
- `docs/adr/0110-changes-reads-git-writes-nothing.md`, `docs/features/changes.md`
- `test/unit/changes-github-patch.test.ts` (новый), `test/contract/changes-pr.test.ts` (новый)

Только читать: `src/main/github/inbox.ts` (`reviewThreads`), `src/main/github/prs.ts` (`ghRunner`, `accountAuth`),
`src/renderer/changes/diff-window.ts`.

## Вне скоупа

- Review mode — Ticket 09; комментарии к строкам чужого PR — Ticket 10. Подсветка синтаксиса, diff картинок, контекст
  шире hunk-ов у diff-а из GitHub — вне Epic-а.

## Итог

Сделано implementer-ом 2026-11-20, ветка `worfy-pr-review/06`, на `main` после merge `worfy-changes-view` 05 (#2049).

- Каналы `changes.scopes`, `changes.list`, `changes.file`, `changes.commits` принимают `subject` вместо `ticket`:
  `{ kind: 'ticket', epic, num, branch?, repos? }` или `{ kind: 'pr', repo, number, headOid, baseOid }`
  (`src/shared/ipc/changes.ts`, `src/shared/changes/types.ts`). `DiffPane` получает `subject`; Changes Node передаёт
  Ticket как `subject` (`src/renderer/canvas/nodes/ChangesNode.tsx`). `changes.targets` не менялся.
- PR читается локально (`src/main/ipc/changes.ts`, `prSource`), если `origin` одного из checkout-ов — репозиторий PR и оба
  commit-а есть (`cat-file -e`): тот же reading runner, база — `baseOid`, «Show whole file» работает. Иначе — GitHub
  (`src/main/changes/github.ts`, новый): `pulls/{n}/files` страницами до 3 000, `commits/{sha}`, `compare/{a}...{head}`,
  `pulls/{n}/commits`; только `gh api <path>` от аккаунта Project-а; память по head. Ответ несёт `source` и
  `truncatedAt`; файл — `url` (GitHub `blob_url`) и `newBlob` (`sha`).
- `DiffPane`: нити ревью на строках новой стороны, outdated и без строки — списком под заголовком файла, Reply через
  `onReply` (черновик PR inbox, Ticket 09 подключит); «Large diff · Open on GitHub» (новый вид `no-patch` у
  `FileDiff`), «View file on GitHub» в заголовке файла. `FileTree`: «GitHub lists the first 3,000 files».
- Amendment ADR-0110; `docs/features/changes.md`, раздел «A pull request».
- Красный до правки: `test/unit/changes-github-patch.test.ts` и `test/contract/changes-pr.test.ts` падали на импорте
  отсутствующего `src/main/changes/github.ts` (exit 1, «no tests»), до любой строки кода.
- Вне следа Ticket-а, по необходимости: `src/renderer/canvas/nodes/ChangesNode.tsx` (поле `subject` в вызовах),
  `src/renderer/changes/changes.css` (вид нити), `test/fixtures/gh/gh-stub.mjs` (ответы `rest.json` на REST GET diff-а PR).

Решено без владельца, подтвердить:

- Since my review — не новый scope, а `compare` с commit-ом вместо ветки: оба — three-dot diff (как `compare/{a}...{b}`
  GitHub); у PR `compare` с именем ветки отвергается.
- Файл GitHub без `patch` и без строк (кроме голого переименования) считается binary; оба случая без `patch` —
  «Large diff · Open on GitHub». Голое переименование без `patch` — «No lines changed».
- Merge-base у PR из GitHub не известен (`pulls/{n}/files` его не называет): `base.mergeBase` — пустая строка.
- В памяти main держится до 16 чтений GitHub; неудачное не держится.
- Ссылки «Open on GitHub» и «View file on GitHub» ведут на `blob_url` файла на head.
- Нить с `isOutdated` или без `line` — в списке над файлом; нити с resolved показываются тоже, с подписью «resolved thread».

Проверка: `pnpm lint && pnpm typecheck && pnpm test` под временным HOME — exit 0 до rebase на `main` (864 файла test-ов),
gate fast — `[gate] green (fast)`, exit 0. После rebase тот же прогон — exit 1: упали
`test/contract/workflow-reader.test.ts` (watcher, 16,7 s) и `test/unit/story-build-button.test.tsx`; оба зелёные
отдельно (exit 0), этот PR их не трогает. 5 мутантов (`patchHunks` без заголовка, память без попадания, PR никогда не
локально, outdated на строке, без `truncatedAt`) — все убиты. Снимки diff-а PR-а на fixture-данных, светлая и тёмная
тема — в scratchpad, в репозиторий не кладутся.

### Раунд ревью 1

- Нити и сторона diff-а. PR inbox теперь спрашивает у GitHub `diffSide` нити (`src/main/github/inbox.ts`) и несёт его
  полем `side` у `PrInboxThread` (`LEFT` | `RIGHT`, без поля — `RIGHT`). `DiffPane`: нить LEFT — под строкой старого
  файла, остальные — под строкой нового. Нить, чьей строки hunk-и не показывают (например, строка 101 при
  `@@ -100,3 +100,0 @@`), — в списке под заголовком файла. Подпись списка — «N threads not on a line of this diff»; у
  каждой нити там написано, где она была: «outdated», «no line», «line 101», «old line 9». Пока файл читается, нить,
  которая ещё может найти свою строку, не показывается нигде.
- Scope-ы. All changes ставит на строки нити обеих сторон. Since my review — только новой стороны: старая сторона там —
  проверенный commit, а не база PR-а. Commit нумерует строки по-своему, там все нити — в списке под заголовком.
- Память чтений GitHub: ключ — Project, head и base PR-а и scope. Другой Project читает заново: его аккаунт может не
  видеть репозиторий. PR, перенесённый на другую базу без push, тоже читается заново.
- Репозиторий PR с частью `.` или `..` (`../..`, `acme/..`) схема `changesPrSchema` отвергает.
- Файл GitHub без `patch` и без строк — binary только при статусе `modified`. Добавленный или удалённый пустой файл,
  смена mode (`changed`) и переименование — «No lines changed».
- Вызов `gh api <path>` собирает `ghApiGet` (`src/main/changes/github.ts`): его зовут и app, и contract test. Unit
  test проверяет аргументы целиком: `['api', path]`.

Решено без владельца, подтвердить:

- Добавленный или удалённый binary-файл GitHub (без `patch`, 0/0) тоже читается «No lines changed». GitHub не отличает
  пустой файл от binary; в заголовке файла остаётся «View file on GitHub».
- Since my review ставит на строки только нити новой стороны; нити старой стороны — в списке.
- Проверка head: `pulls/{n}/files` всегда отдаёт файлы текущего head PR-а, даже если `headOid` в запросе старее. Diff
  может не совпасть с `headOid`, пока PR inbox не перечитал PR. Сверка не делается: ревью сочло её необязательной.

Проверка раунда: новые test-ы красные до правки (exit 1, 18 упавших). После правки зелёные: все test-ы
Changes и PR inbox (21 файл, 463 test-а), exit 0. Ещё `pnpm lint`, `pnpm typecheck`,
`node scripts/check-feature-docs.mjs`. gate fast в этом раунде не запускался: на этой машине fseventsd сейчас
роняет test-ы file watcher-а.
