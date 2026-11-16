# 118 — Список Epic-ов из main-ветки, а не из рабочей папки Project-а

Type: bug
Status: claimed 2026-11-16T01:04Z
Blocked by: none
Source: владелец 2026-11-16: Epic `worfy-code-stories`, влитый в main (#1888), не появился в worfy, потому что основная
папка Project-а отстала от `origin/main` на 4 commit-а (detached HEAD, неотслеживаемые файлы мешали fast-forward).
Владелец: «ветка, которую читает worfy, всегда, безусловно, без каких-либо условий отражала правильное состояние».

Кто: агент.

## Что происходит

- worfy читает Epic-и и Ticket-ы из рабочего дерева папки Project-а: `WorkflowWatcher.start`
  (`src/main/workflow/watch.ts:353-375`) → `readWorkflow` (`src/main/workflow/reader.ts:699`) → `readCheckout`
  (`reader.ts:406`), который зовёт `epic-status --json` без `--ref` (`reader.ts:410`, аргументы — `reader.ts:176`).
  Какой бы HEAD, ветка или отставание ни были у папки, worfy показывает их.
- `enrichSnapshot` (`reader.ts:329`) читает spec-и Epic-ов, текст Ticket-ов, раздел `## Где в коде`, `HANDOFF.md` и
  `docs/adr` (через `src/main/docs/watch`) тоже с диска.
- Никто в `src/` не делает `git fetch`; watcher следит за `refs/heads/**`, `packed-refs` и `worktrees/<name>/HEAD`, но
  не за `refs/remotes/**` (`watch.ts:3-13`).
- `harness/bin/epic-status --json --ref <ref>` уже читает Ticket-ы из git objects (`git ls-tree` + `git cat-file
  --batch`) и не трогает рабочее дерево.

## Что делаем

1. **Источник правды — main-ветка Project-а, не рабочее дерево.** В режиме Full, когда корень Ticket-ов лежит в git:
   - `workflow.finish` = `pr-green-ci`: ref — `refs/remotes/origin/HEAD`, иначе `origin/<main>` (так же выбирает
     `harness/bin/preflight`, строка с `origin/HEAD`);
   - `workflow.finish` = `local-green` (Ticket-ы вливаются локально, без PR): ref — локальная ветка `<main>`
     (`refs/heads/<main>`), а не HEAD папки;
   - ref не разрешается (нет origin, пустой repo) — прежнее чтение рабочего дерева и пометка в UI (п. 4).
   Режим Silent (папка Workflow вне git) и корень Ticket-ов вне git читают рабочее дерево, как сейчас: там оно и есть
   правда.
2. **Всё, что видно в списке, — из того же ref.** `epic-status --json --ref <ref>`; spec-и, текст Ticket-ов, `## Где в
   коде`, state-файл и ADR в `enrichSnapshot` и docs watch — через `git cat-file --batch` того же ref (одним процессом
   на чтение, не по `git show` на файл). Никакой смеси «список из ref, текст с диска».
3. **Fetch.** Main process делает `git fetch origin --prune <main>` при старте, раз в 2 минуты, пока окно Project-а
   открыто, и при фокусе окна (не чаще раза в 30 с): timeout, `GIT_TERMINAL_PROMPT=0`, то же окружение login shell,
   что у `epicStatusRunner`. Ошибка fetch никогда не ломает чтение. Watcher добавляет `refs/remotes/origin/<main>` и
   `packed-refs`, так что fetch из терминала тоже вызывает перечитывание. Ключ кэша (`reader.ts:598`) включает sha
   ref-а.
4. **Видно, откуда данные.** Когда fetch не удался дольше 10 минут или ref не разрешился, рядом со списком Epic-ов
   строка «по состоянию на <short sha>, обновлено <время>» и причина. По F-SPEC (`docs/design/F-SPEC.md`), компонентами
   kit-а; отдельная строка изменения вида в PR.
5. **Ветки Ticket-ов.** Наложение статусов из локальных worktree `ticket/*` (`applyBranches`, `reader.ts:673`) остаётся,
   как есть. Ticket-ы, взятые только на удалённой ветке или в PR без локального worktree, — вне этого Ticket-а.
6. **ADR-0107** «worfy читает workflow из main-ветки, а не из рабочего дерева»: решение, варианты (рабочее дерево +
   авто fast-forward папки — отброшен: папку держат чужие Session-ы и неотслеживаемые файлы; скрытый собственный
   worktree — отброшен: второй checkout на Project), последствия для Silent и нескольких repo. Implementer пишет его в
   этом PR.

## Готово, когда

- [ ] Contract test, красный на нынешнем коде: папка Project-а на старом commit-е (detached HEAD, неотслеживаемый файл
      на пути нового Epic-а), `origin/main` впереди с новым Epic-ом — snapshot содержит новый Epic, его spec и текст
      Ticket-ов берутся из `origin/main`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-read-from-main.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Contract test: папка Project-а на ветке с правками Ticket-ов, не влитыми в main, — список показывает main;
      статус ветки `ticket/*` из локального worktree накладывается, как раньше.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-read-from-main.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Contract test: `local-green` — читается `refs/heads/<main>`, не HEAD папки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-read-from-main.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Contract test: нет origin / ref не разрешается — прежнее чтение рабочего дерева и пометка «по состоянию на».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-read-from-main.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Contract test: Silent mode и корень вне git — чтение рабочего дерева не изменилось.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-read-from-main.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Contract test: fetch упал (timeout, нет сети) — snapshot прежний, ошибки нет; обновление `refs/remotes/origin/<main>`
      извне вызывает перечитывание.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-read-from-main.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Unit test: частота fetch (старт, 2 минуты, фокус не чаще 30 с) на фальшивых часах.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/workflow-fetch-schedule.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Все прежние test-ы чтения workflow зелёные: `test/contract/workflow-reader.test.ts`, `workflow-profile.test.ts`,
      `workflow-branches-gone.test.ts`, `workflow-branches-handles.test.ts`, `workflow-watch-links.test.ts`,
      `workflow-watch-retry.test.ts`, `test/unit/workflow-branches-gone.test.ts`, `harness/bin/tests/epic-status.test.sh`.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
  - evidence: test-run pass · `bash harness/bin/tests/epic-status.test.sh` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
  - evidence: gate pass · `gate fast` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d
- [ ] Пути в `ls-tree`/`cat-file` работают на Windows: Windows job CI зелёный.
  - evidence: ci-check pass · PR #1898 CI run 43789873622: windows-e2e 1-4/4, windows full-suite 1-3/3, harness-scripts 1-2/2 green · windows - · d10c6ff674e5985b45012d76a0683ade378146b0
- [ ] ADR-0107 записан.
  - evidence: commit pass · Read the workflow from the Project's main branch, not the folder (worfy-polish 118) · - - · c86d2087264aabd2c704049c036d7c95d5d8170b
- [ ] Test-ы без сети: fetch идёт в локальный bare repo-фикстуру, никаких настоящих GitHub-запросов.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-read-from-main.test.ts` exit 0 · mac - · 40708f2be150ec859920138b3fd71116a751707d

## Где в коде

- `src/main/workflow/reader.ts` (`readCheckout`, `runEpicStatus`, `enrichSnapshot`, кэш)
- `src/main/workflow/watch.ts` (watched refs, start)
- `src/main/workflow/link-safe-watch.ts` (Windows watch)
- `src/main/workflow/folder.ts` (mode, ticketsRoot, repos — только читать)
- `src/main/docs/watch.ts` (state-файл и ADR из ref)
- `src/main/workflow/fetch.ts` (новый: периодический fetch)
- renderer: строка «по состоянию на» у списка Epic-ов (файл найти по списку Epic-ов в `src/renderer/`)
- `test/contract/workflow-*.test.ts`, `test/unit/workflow-*.test.ts`, новые `test/contract/workflow-read-from-main.test.ts`,
  `test/unit/workflow-fetch-schedule.test.ts`
- `docs/adr/0107-workflow-read-from-main-branch.md` (новый)
- `docs/features/` — страница, которая описывает список Epic-ов, если она говорит, откуда worfy берёт данные
