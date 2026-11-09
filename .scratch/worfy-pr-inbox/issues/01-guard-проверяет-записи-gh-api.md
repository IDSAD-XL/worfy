# 01 — Guard: записи `gh api` в PR и issue и мутации GraphQL проверяются на следы workflow

Type: task
Status: open
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
- [ ] Test: неявный `POST` (`gh api repos/o/r/issues/7/comments -f body=…` без `--method`) проверяется так же.
- [ ] Test: `gh api --method POST repos/o/r/pulls/7/reviews --input payload.json` — следы в `comments[].body` дают
      отказ; нечитаемый `--input` — отказ с причиной.
- [ ] Test: `gh api graphql -f query='mutation { addPullRequestReviewThreadReply(…body: "…ADR-0042…") … }'` — отказ.
- [ ] Test: `gh api repos/o/r/pulls/7/comments` (GET) и `gh api graphql -f query='query { … }'` — `silent-check` не
      вызывается.
- [ ] Test: Full project с attribution on — `gh api` записи проходят, как и `gh pr comment` сегодня.
- [ ] `bash harness/hooks/tests/guard-silent.test.sh` — exit 0 на Mac.
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
