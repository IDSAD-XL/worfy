# 13 — Остатки review Ticket-а 04

Type: task
Status: claimed 2026-11-06T02:57Z
Blocked by: 04
Source: review PR #1460 (Ticket 04), раунды 4–5; предел трёх раундов review (`review-of-another-pr.md:32-36`)

Глубина ревью: medium.

## Что происходит

PR #1460 (Ticket 04: policy Auto-approval для Claude, Shadow и Journal) влит после раунда 5. По пределу трёх раундов
после раунда 3 PR держали открытым только high-находки. Остальное собрано здесь.

## Что делаем

1. **Ложные срабатывания маскировки Journal** (`src/shared/autopilot/journal.ts:586-600`). Сейчас скрываются
   безопасные команды: `sort --key=2`, `git commit -m "auth: …"` / `"session: …"` / `"keyboard: …"`,
   `grep -rn password src/`, `docker run -u 1000:1000`, `rg "apiKey: string"`, `grep -H "token: none"`.
   Раунд 4 сузил маскировку по программе. Это открыло секреты в формах раунда 3, поэтому раунд 5 вернул маскировку
   раунда 3 целиком. Сузить можно только списком исключений. Table test раунда 5 (`keeps every form of round 3`,
   53 входа) должен остаться зелёным без правок.
2. **Test-ы на настоящем git на Windows.** Test-ы `include.path`, `includeIf.*.path`, `commondir` и счёта вызовов git
   в `test/unit/auto-approve-run.test.ts` пропускаются на Windows (`it.skipIf(!posix)`). Включить их на win32 или
   написать вариант для win32: регистр путей, которые печатает git, `~/` в include, realpath.
3. **Ветка по умолчанию при reftable.** Если хранилище ref-ов не файловое, `readGitFacts` считает веткой по умолчанию
   `main`. Читать её через `git symbolic-ref` внутри тех же двух вызовов git на checkout или явно park-ить запросы,
   которые двигают ветку, когда она неизвестна. Test на настоящем git с `--ref-format=reftable`.
4. **Пустой config-файл внутри корня не защищён.** Пустой файл без записей не попадает в origin-ы
   `--show-origin`. Пример — пустой глобальный config, на который `GIT_CONFIG_GLOBAL` указывает внутри корня.
   Защищать и такой путь из env (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `XDG_CONFIG_HOME/git/config`), если он
   внутри корней.
5. **Русский перевод** `docs/features/ru/autopilot.md` отстаёт от английской страницы по разделу Auto-approval с
   раунда 2 PR #1460.
6. **Секреты в `targets` Journal** (найдено review PR #1469). `journalTarget` (`src/shared/autopilot/journal.ts`)
   не скрывает секреты, а `journalCommand` скрывает: `touch <wt>/ghp_…` пишет token в `targets` строки
   `auto-approval` (Claude и Codex). Скрывать в `targets` те же формы `SECRET_FORMS`.

## Готово, когда

- [ ] Unit test на каждое ложное срабатывание из п. 1 даёт команду без `***`; table test раунда 5 зелёный.
- [ ] На win32 test-ы п. 2 запускаются в CI и зелёные (или описано, почему форма для win32 другая).
- [ ] Test reftable из п. 3 на настоящем git.
- [ ] Test п. 4: запись в пустой config по `GIT_CONFIG_GLOBAL` внутри корня → deny git-files.
- [ ] `docs/features/ru/autopilot.md` совпадает по смыслу с английской страницей.
- [ ] Test п. 6: путь с литеральным token `ghp_…` / `github_pat_…` в `journalTarget` даёт `***`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Где в коде

- `src/shared/autopilot/journal.ts` (маскировка, `SECRET_FORMS`)
- `src/main/agent/auto-approve/run-approval.ts` (`readGitFacts`, защищённые config-файлы)
- `test/unit/auto-approve-run.test.ts`, `test/unit/autopilot-journal.test.ts`
- `docs/features/ru/autopilot.md`
