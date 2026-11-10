# 01 — Guard: записи `gh api` в PR и issue и мутации GraphQL проверяются на следы workflow

Type: task
Status: claimed 2026-11-09T22:05Z
Branch: worfy-pr-inbox/01
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Guard на `gh api` (Ticket 01)»; «Риски» («Публикация по ошибке»);
«Ticket-ы», «Волны» (Wave 1); [ADR-0105](../../../docs/adr/0105-pr-reply-only-on-the-users-click.md), пункт 5;
[ADR-0042](../../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md), пункт 5

Платформенный Ticket: hook Harness (`harness/hooks/guard.mjs`) идёт на Mac и Windows; PR ждёт Windows verdict до merge
(ADR-0056). Глубина ревью — `high`.

## Что происходит

- `harness/hooks/guard.mjs:230-237` — раздел 3 проверяет на следы workflow (`bin/silent-check`) тексты git commit,
  имена веток и `gh pr create|edit|comment|review|merge` (`--title`, `--body`, `--body-file`, `--subject`).
- `guard.mjs:540-552` — `ghCommand` выходит сразу, если первое слово не `pr`: `gh api` не проверяется вовсе.
- Поэтому отправка Team reviewer-а `gh api --method POST "repos/<owner>/<repo>/pulls/<n>/reviews" --input …`
  (`harness/skills/human-review-setup/template/SKILL.template.md:150`) и любой ответ
  `gh api … pulls/<n>/comments/<id>/replies -f body=…` проходят без проверки. Между черновиком и GitHub стоит только
  шаг `review-draft-lint` самого skill-а.

## Что делаем

1. `ghCommand` узнаёт `gh api <path>`, который пишет:
   - явный метод `--method`/`-X` `POST`, `PATCH` или `PUT`;
   - неявный `POST`: gh шлёт `POST`, когда есть `-f`/`-F`/`--field`/`--raw-field`/`--input`, а метода нет.
2. Пути записи, чей текст проверяется (`<o>/<r>` — любые, с ведущим `/` и без):
   `repos/<o>/<r>/pulls/<n>/comments`, `…/pulls/<n>/comments/<id>/replies`, `…/pulls/<n>/reviews`,
   `…/pulls/<n>/reviews/<id>/events`, `…/pulls/comments/<id>`, `…/issues/<n>/comments`, `…/issues/comments/<id>`,
   `…/pulls/<n>` и `…/issues/<n>` (`PATCH` заголовка и описания), `…/pulls` (создание PR).
3. `gh api graphql` с текстом `mutation` — проверяются все значения `-f`/`-F` и сам текст запроса (там может быть
   строка комментария).
4. Текст для проверки: значения полей `body`, `title` (`-f body=…`, `-F body=@file`, `--raw-field body=…`), файл
   `--input <file>` целиком (JSON-payload review — `body` и `comments[].body`) и heredoc у `--input -`. Файл
   `--input`, который не читается, — отказ с причиной (так же, как раздел 3 отказывает, когда проверка не может
   начаться).
5. Чтение не трогается: `gh api` без записи (GET, `graphql` с `query`) проходит без вызова `silent-check`.
6. Комментарий раздела 3 перечисляет новые команды; сообщение отказа называет `gh api <path>`.

## Готово, когда

- [ ] Test: `gh api --method POST repos/o/r/pulls/7/comments/11/replies -f body='…<epic>/03…'` в Silent project —
      отказ; тот же чистый текст — проходит.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
- [ ] Test: неявный `POST` (`gh api repos/o/r/issues/7/comments -f body=…` без `--method`) проверяется так же.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
- [ ] Test: `gh api --method POST repos/o/r/pulls/7/reviews --input payload.json` — следы в `comments[].body` дают
      отказ; нечитаемый `--input` — отказ с причиной.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
- [ ] Test: `gh api graphql -f query='mutation { addPullRequestReviewThreadReply(…body: "…ADR-0042…") … }'` — отказ.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
- [ ] Test: `gh api repos/o/r/pulls/7/comments` (GET) и `gh api graphql -f query='query { … }'` — `silent-check` не
      вызывается.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
- [ ] Test: Full project с attribution on — `gh api` записи проходят, как и `gh pr comment` сегодня.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
- [ ] `bash harness/hooks/tests/guard-silent.test.sh` — exit 0 на Mac.
  - evidence: test-run pass · `bash harness/hooks/tests/guard-silent.test.sh` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
  - evidence: gate pass · `gate fast` exit 0 · mac - · 89fc90b724520e4490ba1ef98bc40d74576e5b1b
- [ ] Тот же test на Windows (Git Bash) — exit 0.
  - needs: windows
- [ ] `ci-ok` на PR зелёный.

## Тесты

- `harness/hooks/tests/guard-silent.test.sh`: новые случаи рядом с `gh pr comment`.
- Сначала падающий: на `main` `gh api … /replies -f body='<epic>/03'` в Silent project проходит.
- Ни настоящего GitHub, ни модели: hook только разбирает команду; test-ы подают JSON PreToolUse на stdin и не
  запускают `gh`.
- Guard сам ничего не публикует; test-ы проверяют, что разрешённая команда не исполняется hook-ом (он только отвечает
  `permissionDecision`).

## Где в коде

- `harness/hooks/guard.mjs`
- `harness/hooks/tests/guard-silent.test.sh`

## Итог

- Сначала падающий: на `main` (45deec736) 14 новых проверок `guard-silent.test.sh` красные — `gh api … /replies
  -f body='checkout-flow/03'` в Silent project проходил, `silent-check` не вызывался вовсе.
- `ghCommand` отдаёт `gh api` новой функции `ghApi` (`harness/hooks/guard.mjs`). Запись — явный `-X`/`--method`
  `POST`/`PATCH`/`PUT` или неявный `POST` gh (есть `-f`/`-F`/`--field`/`--raw-field`/`--input`, метода нет); формы флагов
  `--field=…`, `-fbody=…`, `-XPOST` тоже. Путь — без хоста, ведущих `/`, `api/v3/` и query; `<o>/<r>` и номера — любое
  слово, переменная shell тоже.
- Пути записи: из списка тикета и ещё два, решено без владельца: `repos/<o>/<r>/issues` (новый issue — та же запись
  в issue) и `…/pulls/<n>/merge` (поля `commit_title`, `commit_message` — то же, что `gh pr merge --subject/--body`,
  которые раздел 3 уже проверяет); `…/pulls/<n>/reviews/<id>` (`PUT` — правка текста review) тоже. Раунд 2 (ревью
  PR #1754): `…/reviews/<id>/dismissals` с полем `message`; GraphQL GitHub Enterprise по полному URL (`api/graphql`).
- Текст REST-записи — поля `body`, `title`, `commit_title`, `commit_message` (вложенное поле — по последнему ключу,
  `comments[][body]`), `-F key=@file`, а у `--input` JSON — те же поля на любой глубине (`body` и `comments[].body`
  review). Решено без владельца: файл `--input` не проверяется «целиком», если это JSON — `comments[].path` не
  публикуемый текст, а Epic часто назван по области кода (`silent-check`, комментарий про diff), и путь файла дал бы
  ложный отказ. Не JSON — весь текст. Heredoc у `--input -` — так же; heredoc у `-F body=@-` и `"$(cat <<EOF …)"`
  проверяется целиком (раунд 2). Обход JSON — со своим стеком: payload глубже стека вызовов не роняет hook.
- GraphQL: проверяется, только когда в тексте запроса или в полях есть `mutation`; тогда все значения `-f`/`-F` и
  весь файл `--input`. `query { … }` — без вызова `silent-check`.
- Нечитаемый файл (`--input`, `-F @file`) уходит в `silent-check` как `--file <путь>`: Full project с attribution on
  отвечает 0 до чтения файлов — команда проходит; проект, который проверяет, падает с `cannot read`, и guard
  отказывает с причиной «a file it sends could not be read (…)». Сообщения отказа называют `gh api <path>`.
- Раунд 2: путь файла читается так, как его прочтёт shell команды: `~`, `$HOME`, `$TMPDIR`, переменные, которые
  команда сама задала простым значением (`V=/x; …`, `export V=/x`); на Windows — пути Git Bash `/c/…` и `/tmp`
  (временная папка пользователя). Путь с переменной, которую guard не знает, или с подстановкой команды — отказ,
  который называет этот путь. Тот же разбор пути — у `git commit -F` и `gh pr --body-file`.
- Раунд 2: если файл назван в более ранней части той же команды (шаг публикации Team reviewer-а писал payload и
  отправлял его одной командой), отказ говорит записать файл одной командой и отправить следующей, а не «run the
  same command again». Шаблон `harness/skills/human-review-setup/template/SKILL.template.md`, шаг 8, разбит на две
  команды; contract test `test/contract/harness-human-review-setup.test.ts` это проверяет. Записанный вывод платного
  прогона `test/fixtures/human-review-setup/built-SKILL.md` не тронут: это снимок прошлого прогона.
- Раунд 2: связки коротких флагов читаются, как их читает gh (`-iX POST`, `-XPOST`, `-X=POST`, `-fbody=…`);
  `docs/features/skills-agents-and-hooks.md` перечисляет записи `gh api` и мутации GraphQL.
- Не проверяются (как и раньше): `gh api … --input -` без heredoc (текст приходит по pipe, hook его не видит — так же
  ведёт себя `gh pr create --body-file -` по pipe), `-f body="$(cat file)"`, записи вне PR и issue (labels, refs).
