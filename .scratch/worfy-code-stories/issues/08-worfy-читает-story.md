# 08 — worfy читает story: watcher, reader, разбор формата, хранилище story по кнопке

Type: feature
Status: claimed 2026-11-16T07:26Z
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», строка 08; «Решения владельца» 4, 9, 24 (строки 95, 101–102, 128);
«Решения по реализации» → Harness: «Где лежит» (строки 204–206); worfy: «Чтение», «Story по кнопке» (строки 241–243,
263–267); «Решения по test-ам», А (строки 279–281); истории 27, 28

Кто: агент.

## Что происходит

- Watcher tickets root пропускает в папке Epic-а всё, кроме `spec.md`, `map.md` и `issues/*.md`
  (`ticketsIgnored`, `src/main/workflow/watch.ts:171-183`). `story.md` и `stories/*.md` worfy не видит.
- Reader Workflow — `src/main/workflow/reader.ts`, типы — `src/shared/workflow/types.ts`. Корень в режиме Full —
  репозиторий, в режиме Silent — папка Workflow (`src/main/workflow/folder.ts`).
- Формат story и fixture-ы задаёт Ticket 01 (`harness/bin/TICKETS.md`, `harness/bin/tests/fixtures/code-story/`).
  Общие fixture-ы Harness-а worfy уже читает: `test/unit/first-heading.test.ts` берёт `harness/bin/tests/fixtures/ticket-title`.
- Хранилище по образцу — `src/main/projects/pr-inbox-state.ts`: `<папка данных Project-а>/pr-inbox.json`, zod-схема,
  атомарная запись. Текста коллег там нет: «Never a text: the words of colleagues stay in main's memory only»
  (строка 4, ADR-0105).

## Что делаем

1. Watcher: в папке Epic-а не пропускать `story.md` и `stories/*.md`. Остальное без изменений.
2. Разбор формата в `src/shared/stories/` по fixture-ам Ticket-а 01:
   - шапка, шаги и поля шага;
   - «не записано»;
   - главы-PR story Epic-а и список передач шага «Стыки между Ticket-ами»;
   - раздел «Проверить себя».

   Файл, который не разбирается, даёт ошибку с причиной, а не пустую story.
3. Reader отдаёт story Epic-а и story PR Ticket-ов вместе с Epic-ом, в режимах Full и Silent.
4. Код фрагмента worfy читает из git, когда показывает шаг, по `TICKETS.md`, раздел «Story anchor». На main — anchor
   commit командой оттуда (`git log --first-parent --follow --diff-filter=A --format=%H -1 <main> -- <story path>`);
   фрагмент ищется в его дереве по коду, из нескольких совпадений — ближайшее к номерам строк story. Не найден
   (файл изменился, удалён, shallow clone) — шаг показывает код из самой story с видимой пометкой.
5. Хранилище story по кнопке и ответов: `<папка данных Project-а>/stories.json` (или папка), zod-схема, атомарная
   запись, по образцу `pr-inbox-state.ts`. Для PR коллег — только текст агента и ссылки `path:line@commit`, без слов
   коллег (ADR-0105).
6. IPC: чтение story Epic-а, story PR и сохранённой story по кнопке.

Решено 2026-11-16 (implementer, review PR #1910, раунд 1): в режиме Silent anchor story — merge commit её PR-а, а до
merge — head PR-а (`gh pr view <N> --json headRefOid,mergeCommit`; номер — из шапки story или из главы story Epic-а,
его передаёт вызов `stories.code`). У story с `PR -` anchor по `TICKETS.md` — HEAD worktree ветки Ticket-а — worfy не
читает: шаг показывает код из story с причиной `no-anchor`. Причина: такую story видит только implementer до
`gh pr create`, и её фрагменты уже сверяет `story-check`; чтение worktree ветки по Ticket-у — отдельная работа без
пользы для вида Story.

## Готово, когда

- [ ] Unit test `test/unit/tickets-watch.test.ts`: `story.md` и `stories/NN-*.md` в папке Epic-а не пропускаются;
      `stories/deeper/x.md` и другие файлы — по-прежнему пропускаются.
  - evidence: test-run pass · `pnpm test test/unit/tickets-watch.test.ts` exit 0 · mac - · 684049112
  - evidence: test-run pass · `pnpm test test/unit/tickets-watch.test.ts` exit 0 · mac - · facc67e27
- [ ] Unit test разбора на fixture-ах `harness/bin/tests/fixtures/code-story/`: story PR ru и en, story Epic-а со списком
      передач (брошенная передача отмечена), шаг без поля — ошибка с именем поля.
  - evidence: test-run pass · `pnpm test test/unit/story-parse.test.ts` exit 0 · mac - · 684049112
  - evidence: test-run pass · `pnpm test test/unit/story-parse.test.ts` exit 0 · mac - · facc67e27
- [ ] Contract test `test/contract/workflow-reader.test.ts`: reader отдаёт story Epic-а и story PR Ticket-ов; в режиме
      Silent — из папки Workflow.
  - evidence: test-run pass · `pnpm test test/contract/workflow-reader.test.ts` exit 0 · mac - · 684049112
  - evidence: test-run pass · `pnpm test test/contract/workflow-reader.test.ts` exit 0 · mac - · facc67e27
- [ ] Contract test на fixture `repo-main-shifted/` (временный repo со squash merge-ем): фрагмент найден по коду в anchor
      commit-е, номера строк — anchor-а, главные строки сдвинуты на ту же величину; код изменён или недоступен — код из
      story с видимой пометкой.
  - evidence: test-run pass · `pnpm test test/contract/story-code.test.ts` exit 0 · mac - · 684049112
  - evidence: test-run pass · `pnpm test test/contract/story-code.test.ts` exit 0 · mac - · facc67e27
- [ ] Contract test хранилища: запись атомарная; файл, который не проходит схему, не роняет чтение; у PR коллеги в
      файле нет текста PR и комментариев — только текст агента и ссылки.
  - evidence: test-run pass · `pnpm test test/contract/story-store.test.ts` exit 0 · mac - · 684049112
  - evidence: test-run pass · `pnpm test test/contract/story-store.test.ts` exit 0 · mac - · facc67e27
- [ ] lint, typecheck, test-ы модуля `src/main/workflow/` и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 684049112
  - evidence: gate pass · `gate fast` exit 0 · mac - · facc67e27

## Тесты

- Пункты выше; каждый test сначала красный.

## Где в коде

- `src/main/workflow/watch.ts`
- `src/main/workflow/reader.ts`
- `src/shared/workflow/types.ts`
- `src/shared/stories/parse.ts` (новый)
- `src/main/stories/code.ts` (новый: код фрагмента из git)
- `src/main/stories/store.ts` (новый)
- `src/shared/ipc/stories.ts`, `src/main/ipc/stories.ts` (из Ticket-а 04 или новые)
- `test/unit/tickets-watch.test.ts`
- `test/unit/story-parse.test.ts` (новый)
- `test/contract/workflow-reader.test.ts`
- `test/contract/story-store.test.ts` (новый)

Только читать: `src/main/projects/pr-inbox-state.ts`, `src/main/workflow/folder.ts`, `test/unit/first-heading.test.ts`,
`harness/bin/tests/fixtures/code-story/`.

## Вне скоупа

- Вид Story — Ticket 09. Сборка story по кнопке — Ticket 11.
