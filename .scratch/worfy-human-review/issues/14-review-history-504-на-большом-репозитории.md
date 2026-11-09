# 14 — `review-history fetch` падает на большом репозитории с HTTP 504

Type: bug
Status: claimed 2026-11-09T13:35Z
PR: —
Blocked by: —
Source: отчёт владельца 2026-11-09 (обезличен): `review-history fetch --passes 2` в проекте Silent mode из трёх частных
репозиториев, один из них — с тысячами PR

Платформенный: меняется скрипт Harness `harness/bin/review-history` (ADR-0056 — Windows verdict до merge: job Windows в
`ci-ok`). Глубина ревью — `medium`.

## Что происходит

- Из корня проекта `review-history fetch --passes 2`:
  - попытка 1 — exit 1, `review-history: gh api graphql failed for <owner>/<repo> (exit 1): unexpected end of JSON input`;
  - попытка 2, через несколько минут, — exit 1, `… gh: HTTP 504`.
- Падает первая же страница, до записи в `raw/`; `review-history clean` после этого говорит, что удалять нечего.
- Не причина: квота GraphQL (сразу после — 4987 из 5000) и доступ (отказ в доступе даёт exit 3, здесь exit 1).
- Вероятная причина — размер страницы. Одна страница — 100 PR (`Q.page`, `harness/bin/review-history:~336`); у каждого PR
  `files(first:100)`, `reviews(30)`, `reviewThreads(50)` × `comments(20)` с `diffHunk` (`LINE_COMMENT`, `~:325`) и
  `comments(50)`. Это около 118 тысяч узлов и крупные `diffHunk` — больше, чем GitHub успевает за свой предел времени
  сервера (около 10 с).
- `graphql()` (`~:295-319`) повторяет запрос только на rate limit (`rateLimit()`, `~:268`). 502, 503, 504 и тело ответа,
  которое не разбирается как JSON (обрезанное), — сразу `fail()` и exit 1.

## Что делаем

1. Повтор на HTTP 502/503/504 и на тело, которое не разбирается как JSON: с паузой, ограниченное число раз.
2. На повторяющийся timeout — уменьшать страницу PR вдвое (100 → 50 → 25 → … до нижней границы) и продолжать с того же
   `endCursor`. Меньший размер — до конца прогона или осторожный рост обратно: решить по коду.
3. Рассмотреть меньшую страницу по умолчанию и запрос страницы без `diffHunk`, когда вложенные connection всё равно
   дочитывает `readOn()`. Только если данные те же: `raw/` хранит те же факты, что раньше; доказать test-ом, который
   сравнивает выход на stub-репозитории.
4. Сообщения говорят, что случилось: «HTTP 504 on a page of 100 PRs, retrying with 50». Окончательный отказ называет
   размер страницы и cursor.

Детали решения — в «Итог».

## Готово, когда

- [ ] Shell test `harness/bin/tests/review-history.test.sh` (stub `gh`, без сети и без настоящего `gh`): 504, потом
      успех; обрезанный JSON, потом успех; несколько 504 подряд уменьшают страницу, потом успех — cursor тот же, ни один
      PR не потерян и не повторён; 504 на нижней границе — exit 1 с понятным сообщением (размер страницы и cursor);
      rate limit обрабатывается как раньше.
- [ ] `raw/prs.jsonl` прогона с уменьшением страницы совпадает с прогоном без сбоев на том же stub-репозитории.
- [ ] Страница Feature `docs/features/human-review.md` говорит о повторах и уменьшении страницы.
- [ ] `node scripts/check-personal.mjs` — exit 0; `plugin-neutral.test.sh` — exit 0; gate fast — exit 0; `ci-ok` на PR
      зелёный (Linux, macOS, Windows).

## Тесты

- `harness/bin/tests/review-history.test.sh` и его fixture `harness/bin/tests/fixtures/review-history/`.
- Contract test-ы, которые запускают `review-history` через stand-in eval-а (`test/contract/harness-evals.test.ts`).

## Где в коде

- `harness/bin/review-history` — `graphql()`, `parseIncluded()`, `Q.page`, `walk()`, комментарий в начале файла
- `harness/bin/tests/review-history.test.sh`, `harness/bin/tests/fixtures/review-history/`
- `docs/features/human-review.md` — абзац «Reading GitHub costs API points, not tokens»

## Итог

Решено без владельца (по коду):

- **Что считается сбоем стороны GitHub** (`transient()`): HTTP 504, ошибка GraphQL «Something went wrong while executing
  your query… timeout», ответ, обрезанный на середине (тело не JSON или gh пишет «unexpected end of JSON input»), — это
  timeout; HTTP 502 и 503 — сбой, который о тяжести запроса ничего не говорит. Rate limit и отказ в доступе (exit 3)
  проверяются раньше и работают как прежде.
- **Страница уменьшается сразу, на первом timeout-е**, а не на втором подряд (`readPage()`): тяжесть страницы — свойство
  самого запроса, та же страница снова упрётся в тот же предел времени GitHub, а каждый лишний timeout — около 10 с.
  Размеры 100 → 50 → 25 → 12 → 10, нижняя граница 10 (страница из 10 PR — около 12 тысяч узлов в худшем случае). Перед
  меньшей страницей — пауза 5 с. Продолжение — с того же `endCursor`; cursor GitHub не зависит от размера страницы.
- **HTTP 502/503 и timeout на нижней границе** — та же страница снова, не больше 3 повторов, паузы 5, 10, 15 с; потом
  exit 1 с размером страницы и cursor-ом: `gh api graphql failed for <owner>/<repo>: HTTP 504 on a page of 10 PRs (the
  smallest page), after cursor <cursor>, still failing after 3 retries — gh: HTTP 504`.
- **Меньший размер остаётся до конца репозитория** и не растёт обратно; следующий репозиторий проекта начинает снова со
  100. Ограничение записано комментарием `shortcut:` в `walk()`.
- **Запросы дочитывания (`readOn()`)** повторяются так же (до 3 раз с паузой), размер у них не меняется.
- **Пункт 3 не сделан, сознательно.** Страница по умолчанию осталась 100: уменьшение срабатывает само и стоит одного
  неудачного запроса на тяжёлый репозиторий, а меньшая страница по умолчанию удвоила бы число запросов везде. `diffHunk`
  остался в запросе страницы: `raw/` хранит `diff_hunk` у каждого комментария в thread-е, и без него на странице его
  пришлось бы дочитывать отдельным запросом на каждый PR с thread-ами — сотни лишних запросов. Данные не изменились:
  test сравнивает `raw/prs.jsonl` прогонов со сбоями с прогоном без сбоев на одном stub-репозитории из 230 PR.
- Пауза в test-ах — 0 через переменную `REVIEW_HISTORY_RETRY_WAIT` (секунды); один test проверяет паузу 1 с по времени
  вызовов stub-а.
- Не проверено на настоящем GitHub: по условию брифа `review-history` не запускается против реального репозитория.
