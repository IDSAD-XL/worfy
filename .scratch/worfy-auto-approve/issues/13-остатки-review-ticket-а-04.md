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
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-run.test.ts` exit 0 · mac - · 7d37844ee80b7843d4b2507b44180abfaa831a4f
- [ ] На win32 test-ы п. 2 запускаются в CI и зелёные (или описано, почему форма для win32 другая).
- [ ] Test reftable из п. 3 на настоящем git.
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-run.test.ts` exit 0 (git 2.50, --ref-format=reftable) · mac - · 7d37844ee80b7843d4b2507b44180abfaa831a4f
- [ ] Test п. 4: запись в пустой config по `GIT_CONFIG_GLOBAL` внутри корня → deny git-files.
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-run.test.ts` exit 0 · mac - · 7d37844ee80b7843d4b2507b44180abfaa831a4f
- [ ] `docs/features/ru/autopilot.md` совпадает по смыслу с английской страницей.
- [ ] Test п. 6: путь с литеральным token `ghp_…` / `github_pat_…` в `journalTarget` даёт `***`.
  - evidence: test-run pass · `pnpm test test/unit/auto-approve-run.test.ts` exit 0 · mac - · 7d37844ee80b7843d4b2507b44180abfaa831a4f
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Где в коде

- `src/shared/autopilot/journal.ts` (маскировка, `SECRET_FORMS`)
- `src/main/agent/auto-approve/run-approval.ts` (`readGitFacts`, защищённые config-файлы)
- `test/unit/auto-approve-run.test.ts`, `test/unit/autopilot-journal.test.ts`
- `docs/features/ru/autopilot.md`

## Итог

Сделано всё, кроме п. 5 (перевод): он ждёт merge PR #1469 (auto-approve 05, Codex), который правит ту же английскую
страницу. По ADR-0088 перевод не входит в PR с поведением; п. 5 — сам перевод раздела Auto-approval, его сделаю
отдельным коммитом после rebase на `main` с #1469.

1. **Маскировка Journal.** Формы раунда 3 не тронуты: table test раунда 5 (53 входа) зелёный без правок. Поверх
   форм — список исключений `SECRET_EXCEPTIONS` в `src/shared/autopilot/journal.ts`. Исключение называет формы,
   которые оно пропускает, и текст, внутри которого совпадение формы остаётся как есть. Каждое привязано к
   программе в позиции команды (начало строки или сегмента после `|`, `;`, `&`, `(`; после присваиваний и `sudo`,
   `env`, `xargs`…) и к виду значения:
   - `sort --key=<определение ключа sort>` (цифры, `.`, `,`, буквы опций sort);
   - сообщение `git commit -m/-am/--message` — только форма заголовка (`"auth: …"`);
   - слово-шаблон grep/rg/ag/ack/git grep без кавычек перед ним (`grep -rn password src/`);
   - шаблон grep/rg в кавычках вида `"<имя>: <только буквы>"` (`rg "apiKey: string"`, `grep -H "token: none"`);
   - `docker|podman run|exec|create -u/--user <число>:<число>`.
   Token-формы (`ghp_…`, `sk-…`) работают и внутри исключений. Test на обратное: `sort --key=s3cr3t`,
   `grep -r "password hunter2"`, `rg "X-Api-Key: s3cr3t"`, `docker run -u bob:s3cr3t`, секрет в соседнем сегменте
   до и после исключения — всё скрыто.
2. **win32.** Test-ы include.path, includeIf (gitdir и `*.path`), config.worktree, commondir (три) и счёта вызовов
   git больше не пропускаются на Windows. Счёт вызовов теперь по `GIT_TRACE2_EVENT` (событие `start` на процесс
   git): скрипт `git` перед настоящим на PATH на Windows не запускается. Регистр путей: policy сравнивает пути без
   регистра на win32 и macOS, `scratch` в test-ах — `realpathSync.native` (короткие имена 8.3 раскрыты). `~/` в
   include: без HOME Git for Windows берёт HOMEDRIVE+HOMEPATH, затем USERPROFILE — теперь защищаются оба
   (`includeHomes`), test на win32 и unit test функции. Доказательство п. 2 — Windows job CI этого PR.
3. **reftable.** Если `extensions.refStorage` не `files`, `readGitFacts` берёт origin/HEAD и текущую ветку одним
   вызовом `git for-each-ref` (третий вызов git на checkout только для такого хранилища). Test на настоящем git с
   `--ref-format=reftable`: `trunk`, затем `dev` из origin/HEAD, ветка worktree; `git checkout trunk` → hard deny.
   Вариант «внутри тех же двух вызовов» не годится: `rev-parse --symbolic-full-name HEAD` падает в ветке без
   commit-ов и уносит с собой `--git-dir`. Ветка без commit-ов в reftable по-прежнему даёт `main`.
4. **Config-файлы из env.** `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `XDG_CONFIG_HOME/git/config` защищаются
   как `.git/config` и пустыми; `/dev/null` (и `NUL` на Windows) — нет. Test: Write в пустой `GIT_CONFIG_GLOBAL`
   внутри worktree → deny `git-files`.
6. **targets.** `journalTarget` скрывает секреты так же, как `journalCommand` (присваивания, JSON, `SECRET_FORMS`
   с исключениями). Test: `ghp_…`, `github_pat_…`, `sk-…`, `GH_TOKEN=…` в пути → `***`.

Английская страница `docs/features/autopilot.md`: строка `auto-approval` (исключения, `targets`) и абзац про
config-файлы из env и reftable. Mutation testing вручную на изменённых строках: 25 мутантов, 24 убиты на macOS,
один (`includeHomes` в `configFilesOf`) убивает только test на win32 в CI.
