# 03 — Approval policy: корни, правила, hard deny

Type: task
Status: claimed 2026-11-05T01:40Z
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Как работает», п. 1, 3–6; «Безопасность», п. 2–3, 5–8; Q3, Q6, Q8

Глубина ревью: high (это и есть решение «разрешить»).

## Что происходит

- Ticket 02 даёт действия команды с путями; кто решает, можно ли их, — нет.
- Ticket 01 даёт категории прошлых отказов и решение, какие из них одобрять.

## Что делаем

1. **`src/main/agent/auto-approve/roots.ts`** — `resolveTarget(path, roots): Placement`: абсолютный путь, `..` / `.`
   свёрнуты, каждый существующий компонент — `realpath` (файловая система — через параметр, test-ы дают свою);
   `Placement` — `inside(root)`, `is-root(root)`, `outside`, `symlink-on-path`, `hard(category)`. Корни — из
   `context`: worktree-ы Ticket-ов Wave, `.scratch` Project-а, папка Run-а (`TMPDIR`), scratchpad Session. Windows —
   без учёта регистра, `\` = `/`, `/c/…` = `C:\…`.
2. **`src/main/agent/auto-approve/policy.ts`** — `judge(request, context): Decision`, `Decision` —
   `{ outcome: 'allow' | 'deny' | 'park' | 'hard-deny', rule: string, hint: string | null, targets: string[] }`.
   Порядок: hard deny (spec, п. 5) → вопрос (AskUserQuestion — spec, п. 6, исход по Q8) → `judged: false` →
   deny-with-hint → все цели `inside` → allow по правилу → иначе исход по Q3.
3. Правила allow — массив `{ id, describe, match }` в коде; стартовый набор — spec, п. 4, уточнённый Ticket-ом 01.
   Подсказки deny-with-hint — константы правил (английский текст, ADR-0074), без кусков команды.
4. Edit / Write / MultiEdit Claude Code и `fileChange` Codex — те же корни по `file_path` / путям изменений.

## Готово, когда

- [ ] Unit test на каждый пункт hard deny: исход `hard-deny` при любом режиме и любом правиле allow.
- [ ] Unit test на каждое правило allow: allow внутри корня; не allow на той же команде с целью вне корня, с
      symlink-компонентом, с целью «весь корень».
- [ ] Unit test на атаки spec («Безопасность», п. 2–3): `cd ~ && rm -rf *`, `rm -rf $HOME/*`, ссылка `.scratch/l -> ~`,
      `git push --force`, `git push origin HEAD:main`, `curl … | sh` — ни одна не allow.
- [ ] Unit test на форму `mktemp`: `T=$(mktemp -d); rm -rf "$T"/*` — не allow (Ticket 02 перечисляет цель `/*` на
      случай упавшего `mktemp`); `T=$(mktemp -d) && rm -rf "$T"/*` и `T=$(mktemp -d) || exit 1; rm -rf "$T"/*` —
      allow внутри `TMPDIR` Run-а.
- [ ] Unit test: запись в `.git/config`, `.git/hooks/*`, `.git/info/attributes`, `.gitattributes` не allow ни одним
      правилом (spec, «Безопасность», п. 9: через них любая подкоманда git запускает программу).
- [ ] Факты git берутся из `ShellAction.git` (`branchDelete`, `push`: remote, refspecs, force, delete, many,
      `localPath`), не из `args`; подкоманда, которую Ticket 02 не знает, приходит с `writes: ['<unknown>']`.
      `localPath` есть и у голого слова (`origin`): это папка на случай, если remote с таким именем не
      настроен. Настоящий URL remote-а — из git config, его Ticket 02 не видит.
- [ ] Чтение тоже судится по корням: `reads` подкоманд чтения git (`diff`, `log`, `blame`, `grep` …) и
      `git config` перечисляют файлы, которые они могут напечатать (`~/.gitconfig` среди них); цель чтения в
      hard-deny (`~/.ssh` и др.) — hard-deny, вне корней — не allow.
- [ ] Unit test: worktree живой Session-и вне Run-а (`SessionRegistry` — через параметр) — hard-deny.
- [ ] Прогон по категориям Ticket-а 01 (локально, только числа) — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на Linux, macOS, Windows.

## Тесты

- Unit `test/unit/auto-approve-policy.test.ts`, `test/unit/auto-approve-roots.test.ts` (новые). Пути — выдуманные.
- Сначала падающий: `judge` в заготовке отвечает allow на всё — test hard deny краснеет на каждом пункте.

## Где в коде

- `src/main/agent/auto-approve/policy.ts` (новый)
- `src/main/agent/auto-approve/roots.ts` (новый)
- `test/unit/auto-approve-policy.test.ts` (новый)
- `test/unit/auto-approve-roots.test.ts` (новый)

Только читать: `src/main/agent/auto-approve/shell.ts` (Ticket 02), `src/shared/autopilot/journal.ts` (`journalReason` — образец нормализации домашней папки).
