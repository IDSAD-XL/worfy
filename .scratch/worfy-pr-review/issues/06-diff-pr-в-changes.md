# 06 — Diff PR в Changes: предмет `pr`, локальный diff или diff из GitHub, нити ревью на строках, Amendment ADR-0110

Type: task
Status: open
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
- [ ] Contract `test/contract/changes-pr.test.ts` (новый) на gh stand-in и временном git-репозитории: локальный путь,
      путь GitHub, 3 000 файлов, файл без `patch`, кэш по head (второй вызов gh не делает), Since my review; ни одного
      `fetch`, `.git/index` не тронут (mtime и hash), ни одного `--method` у gh.
- [ ] `test/contract/changes-read.test.ts`, `test/unit/changes-view.test.tsx`, `test/e2e/changes.spec.ts` зелёные с
      `subject` вместо `ticket`.
- [ ] Amendment ADR-0110 влит в этом PR; `node scripts/check-feature-docs.mjs` — exit 0.
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
