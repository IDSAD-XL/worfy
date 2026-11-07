# human-review: как добыть стиль ревьюера из истории PR

- **Дата:** 2026-11-07
- **Карта:** [`.scratch/worfy-human-review/`](../../.scratch/worfy-human-review/map.md). Исходные решения —
  [Ticket 01](../../.scratch/worfy-human-review/issues/01-решения-владельца-2026-11-07.md): генератор (рабочее имя
  `/worfy:human-review-setup`) читает историю PR проекта и пишет проектный skill `human-review`; skill содержит слова
  коллег и поэтому лежит только в папке Profile-а на машине пользователя; он готовит черновик ревью, в GitHub ничего не
  уходит без явного «да» человека.
- **Статус:** исследование, не решение. Ticket-ов не заводит. Отвечает на пункты «Not yet specified» карты: сколько
  истории читать и сколько это стоит, короткая история, несколько ревьюеров, приватность.
- **Вопрос.** Как достать из GitHub историю ревью проекта, сколько её нужно, сколько это стоит, как обойтись с ботами,
  несколькими ревьюерами, короткой историей и словами коллег, — и что уже делают другие инструменты.
- **Ответ коротко.**
  - **Четыре вида текста, три endpoint-а на весь репозиторий и один на каждый PR.** Комментарии к строкам и общие
    комментарии PR отдаются одним списком на весь репозиторий; ревью (approve, changes requested, их тело) — только по
    одному PR за запрос. GraphQL берёт всё вместе страницей по 100 PR.
  - **Для ~2k PR это дёшево по API.** Через GraphQL — около 20 запросов и ~640 очков из 5000 в час (по замеру на
    публичном репозитории). Через REST — около 2,1 тыс. запросов, почти все уходят на ревью по одному PR.
  - **Дорого по токенам, если не отсечь ботов.** В выборке из 100 PR боты дали 68% символов. Текст людей — около
    1,25 тыс. символов на PR, то есть порядка 0,6–0,7 млн токенов на 2k PR без контекста diff-а (**оценка**).
  - **Голос одного человека никто на рынке не копирует.** CodeRabbit, Greptile, Qodo, Cursor Bugbot, Graphite,
    Copilot учат правила команды — что отмечать и что не отмечать. Хранят их у себя в облаке или в файле репозитория.
    Подражания тону конкретного ревьюера ни один вендор не заявляет.
  - **Сгенерированный skill может не лежать ни в репозитории, ни в `~/.claude/skills`.** Claude Code грузит
    `.claude/skills/` из каталога, добавленного через `--add-dir` или `additionalDirectories` Agent SDK. Значит, папка
    Profile-а может отдать skill Session-ам worfy без копии в репозиторий.
- **Как проверено.** Документация GitHub и вендоров прочитана 2026-11-07 research-агентом; ключевые места перечитаны.
  Замеры — живые запросы `gh api` к двум публичным репозиториям: `cli/cli` (CLI GitHub, много ревью) и самому worfy.
  Из ответов в этот документ попали только счётчики, ни одного текста комментария. Файлы Harness-а прочитаны на
  `42372355b`.

## 1. Что доставать: четыре вида текста

| Вид | Что это | REST | GraphQL |
| --- | --- | --- | --- |
| Review | решение ревьюера по PR: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED` (ещё `DISMISSED`, `PENDING`) и общее тело | `GET /repos/{o}/{r}/pulls/{n}/reviews` — **только по одному PR** | `PullRequest.reviews`, `PullRequestReview.state`, `body`, `submittedAt`, `authorAssociation` |
| Review comment | комментарий к строке diff-а | `GET /repos/{o}/{r}/pulls/comments` — **весь репозиторий**, `since`, `sort`, `direction`; или `…/pulls/{n}/comments` | `PullRequestReview.comments`; нити — `PullRequest.reviewThreads` с `isResolved`, `isOutdated`, `path`, `line` |
| Issue comment | общий комментарий в разговоре PR (PR — это тоже issue) | `GET /repos/{o}/{r}/issues/comments` — **весь репозиторий**, `since`; PR находится по `issue_url` | `PullRequest.comments` |
| Suggestion | предложенная правка внутри review comment | тот же review comment: блок <code>```suggestion</code> в `body` | то же |

Источники и поля:

- **Ревью.** <https://docs.github.com/en/rest/pulls/reviews> — список «in chronological order», поля `state`,
  `submitted_at`, `body`, `commit_id`, `user`, `author_association`. Значения `author_association`: `OWNER`, `MEMBER`,
  `COLLABORATOR`, `CONTRIBUTOR`, `FIRST_TIMER`, `FIRST_TIME_CONTRIBUTOR`, `MANNEQUIN`, `NONE`. Перечень состояний —
  enum `PullRequestReviewState` в <https://docs.github.com/en/graphql/reference/pulls>. GraphQL-запрос к последним
  5 merged PR `cli/cli` вернул `APPROVED` и `COMMENTED`; совпадение строк состояния в REST не проверялось.
- **Комментарии к строкам.** <https://docs.github.com/en/rest/pulls/comments> — поля `body`, `path`, `diff_hunk`,
  `line`, `original_line`, `start_line`, `side`, `in_reply_to_id` (по нему собирается нить ответов),
  `pull_request_review_id`, `commit_id`, `subject_type`, `user.type`, `author_association`.
- **Общие комментарии.** <https://docs.github.com/en/rest/issues/comments> — «every pull request is an issue»; список
  на весь репозиторий включает и комментарии к обычным issue, их отсекают по `issue_url`.
- **Нити в GraphQL.** <https://docs.github.com/en/graphql/reference/pulls> — `PullRequestReviewThread.isResolved`,
  `isOutdated`, `resolvedBy`, `path`, `line`, `diffSide`, `comments`. `isResolved` и «правка после комментария»
  отличают замечание, на котором ревьюер настоял, от брошенного.
- **Suggestion.** Как работает: <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request>
  и <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request>
  («the text within the suggestion block»). Буквальный блок <code>```suggestion</code> в `body` в документации не
  показан; его подтверждает живой ответ API: на одной странице из 100 комментариев `cli/cli` (`page=60`) 11 тел
  содержат этот блок, в выборке ниже — 23.

## 2. Pagination и rate limits

- **Страница.** REST — `per_page` до 100, по умолчанию 30; следующая страница — в заголовке `Link`
  (`rel="next"`, `rel="last"`). GraphQL — `first`/`last` от 1 до 100, курсор `pageInfo { hasNextPage endCursor }`,
  не больше 500 000 узлов в одном запросе. Источники: страницы endpoint-ов выше,
  <https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api>.
- **Лимит REST в час.** 60 без токена, 5 000 для пользователя, 15 000 для пользователей и приложений организаций
  Enterprise Cloud; `GITHUB_TOKEN` в Actions — 1 000 на репозиторий. В минуту — до 100 одновременных запросов и 900
  очков (GET — 1 очко). Заголовки `x-ratelimit-limit`, `-remaining`, `-reset`, `-used`. Источник:
  <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>.
- **Лимит GraphQL в час.** 5 000 очков для пользователя, 10 000 для организаций Enterprise Cloud. Цена запроса —
  сумма запросов по всем connection-ам, делённая на 100, не меньше 1; её показывает объект `rateLimit { cost }`.
  В минуту — до 2 000 очков. Источник — страница GraphQL выше.
- **Как ходить.** Запросы — по одному, не параллельно; при ошибке лимита ждать `retry-after` или `x-ratelimit-reset`;
  условный запрос с `if-none-match` (ETag), получивший `304`, в часовой лимит не идёт. Источник:
  <https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>. Повторный запуск
  генератора («обновление» по Ticket 01) может брать только новое: `since` у двух списков на весь репозиторий.
- **`gh`.** `gh api --paginate` проходит все страницы REST; для GraphQL запрос должен принимать `$endCursor` и
  запрашивать `pageInfo { hasNextPage endCursor }`, каждая страница приходит отдельным JSON. Источник:
  <https://cli.github.com/manual/gh_api>. `gh` уже есть у пользователей worfy; отдельный токен генератору не нужен.

## 3. Замеры на живых репозиториях

Запросы 2026-11-07, `gh api`, публичные репозитории. Из ответов взяты только счётчики.

- **`cli/cli`, последние 100 merged PR, один GraphQL-запрос** (`reviews(first:30)` → `comments(first:50)` и
  `comments(first:50)` у PR):
  - цена запроса — **32 очка**;
  - 374 ревью: `COMMENTED` 266, `APPROVED` 106, `CHANGES_REQUESTED` 2; непустое тело — у 117;
  - 358 комментариев к строкам, 55 общих комментариев, 23 блока suggestion;
  - всего 787 текстов: людей — 590 текстов и 124 721 символ от 20 логинов; ботов — 197 текстов и 261 939 символов
    (`copilot-pull-request-reviewer`, `copilot-swe-agent`, `github-actions`, `cli-triage`);
  - у самого активного человека — 129 ревью из 100 PR, у следующих — 66 и 58, дальше 21 и меньше.
- **`cli/cli`, весь репозиторий, REST.** Заголовок `Link` при `per_page=100`: комментарии к строкам — 130 страниц
  (около 13 тыс.), общие комментарии issue и PR вместе — 300 страниц, PR всех состояний — 49 страниц. Из 100
  последних комментариев к строкам 39 — ответы (`in_reply_to_id`), `user.type` — `User` или `Bot`,
  `author_association` — `MEMBER`, `CONTRIBUTOR`, `NONE`.
- **worfy, последние 100 PR, GraphQL.** Цена — 3 очка. Ревью — 0, нитей — 0, общих комментариев — 58, все от одного
  логина — того же, что открыл PR. Это отчёты агентов-ревьюеров: тела начинаются с `VERIFIED (…)` или
  `REJECTED (round 1, …)`. Для генератора это «короткая история» (раздел 6): голоса человека-ревьюера в ней нет.

## 4. Сколько истории и сколько это стоит для ~2k PR

Всё в этом разделе — **оценка** по замерам раздела 3 и лимитам раздела 2. Реальный проект может отличаться в разы.

- **API через GraphQL.** 2 000 PR / 100 = 20 страниц × ~32 очка ≈ **640 очков**, 13% часового лимита пользователя.
  PR, у которых больше 30 ревью или 50 комментариев, нужно дочитать отдельными запросами; в выборке их почти нет.
- **API через REST.** Список PR — 20 запросов; комментарии к строкам на весь репозиторий — при доле `cli/cli`
  (около 2,6 на PR) примерно 53 запроса; общие комментарии — от 20 до 100 запросов, смотря сколько в репозитории
  обычных issue; ревью — **2 000 запросов, по одному на PR**. Итого ≈ 2,1 тыс., почти половина часового лимита.
  Вывод: генератору нужен GraphQL; REST — только для дочитывания нового через `since`.
- **Токены.** Текст людей в `cli/cli` — ~1 250 символов на PR. На 2k PR — ~2,5 млн символов, при ~4 символах на
  токен для английского — **~0,6–0,7 млн токенов** без `diff_hunk`. С контекстом строки (`diff_hunk`) — больше в
  2–4 раза (**предположение**, не мерилось). Русский текст даёт больше токенов на символ. Без отсечения ботов в
  выборке было бы ещё +210%.
- **Сколько истории нужно для голоса.** Первичного источника с порогом нет. Что говорят вендоры:
  - Greptile: «Suggested» правила появляются примерно после 10 PR, полная персонализация — от 9 недель
    (<https://www.greptile.com/docs/how-greptile-works/memory-and-learning>,
    <https://www.greptile.com/docs/code-review-bot/custom-context>);
  - Qodo Rule Miner: до 10 правил на репозиторий сначала, потом до 5 каждые две недели, и только из комментариев,
    которые «were accepted by developers and led to code changes»
    (<https://docs.qodo.ai/governance/rule-enforcement/rule-miner.md>);
  - Qodo auto best practices — раз в месяц, `max_patterns = 5`
    (<https://docs.qodo.ai/governance/rule-enforcement/without-rule-system/best-practices.md>).
  
  **Предложение (предположение):** не читать всё. Брать окно последних 12 месяцев или последних 300–500 PR с ревью
  выбранного человека — что меньше. Отбирать в модель только тексты выбранного ревьюера с ответами на них и пометкой
  `isResolved`. На 2k PR это, по замеру выше, сотни тысяч токенов, а не миллионы. Порог «голос есть» — порядка 30–50
  содержательных комментариев человека; ниже — режим короткой истории.

## 5. Боты и несколько ревьюеров

- **Боты.** GraphQL `author { __typename }` = `Bot` и REST `user.type` = `Bot` — замер раздела 3 показал оба значения.
  Но бот бывает обычной учётной записью: в выборке `cli-triage` пришёл как `Bot`, однако в других проектах
  служебные аккаунты часто `User` (**предположение**). Поэтому нужен второй фильтр — список логинов, который
  пользователь видит и правит перед генерацией. Ответы людей **на** комментарии ботов (Copilot, CodeRabbit) стоит
  оставить: они показывают, с чем ревьюер не согласен.
- **Свои агенты.** Если ревью в проекте пишут агенты от имени человека (как в worfy, раздел 3), `__typename`
  их не отличит. Генератор не должен выдать голос агента за голос человека. Признак — служебная строка в начале
  тела, как `VERIFIED (…)` и `REJECTED (…)` у worfy; конкретный признак выбирает проект (**предположение**).
- **Несколько ревьюеров.** Ticket 01 решил: пользователь выбирает одного или нескольких, по умолчанию — самый активный.
  Замер `cli/cli` показывает, зачем выбор: три человека дают основную массу ревью, хвост — по нескольку штук.
  Смешивать тон нескольких людей в одном голосе вредно (**предположение**): у одного — короткий nit, у другого —
  длинный разбор. Предложение — правила (на чём настаивают) объединять по всем выбранным, а примеры голоса и
  checklist держать отдельно на каждого и выбирать голос при запуске.
- **`author_association`.** `OWNER`, `MEMBER`, `COLLABORATOR` — люди проекта; `CONTRIBUTOR`, `NONE` — внешние.
  Для голоса команды берутся первые; внешние комментарии полезны только как то, на что команда отвечает.

## 6. Проекты с короткой историей

- **Признак.** Меньше порога из раздела 4 содержательных комментариев людей; или, как в worfy, ревью нет вовсе,
  а комментарии — от одного логина.
- **Что делать (предположение).**
  - Сказать прямо: «голоса нет — N комментариев за M PR» — и не выдумывать стиль.
  - Взять правила не из ревью, а из того, что проект уже записал: `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, ADR,
    lessons Profile-а. Так делают и вендоры: CodeRabbit и Copilot читают эти файлы сами (раздел 7).
  - Дать пользователю выбрать голос по образцу: несколько его собственных ревью из другого проекта или пара
    абзацев «как я пишу ревью». Это вход от человека, а не из истории; хранится там же, в папке Profile-а.
  - Перезапуск генератора через N новых PR дополняет skill, когда история накопится.

## 7. Что делают другие инструменты и где хранят правила

| Инструмент | Чему учится | Из какого сигнала | Где хранит | Голос человека |
| --- | --- | --- | --- | --- |
| CodeRabbit Learnings | правила и факты о проекте | ответы `@coderabbitai` в PR, `add a learning using <file>`, выводы во время ревью | своя база, привязана к Git-организации, vector search; правка в dashboard и через API | нет |
| Greptile | правила и предпочтения команды | комментарии людей в PR, ответы на свои комментарии, 👍/👎, правка кода после комментария | dashboard или в репозитории: `greptile.json`, `.greptile/`, `.greptile/rules.md` | нет |
| Qodo (PR-Agent, Rule Miner) | best practices | принятые suggestion; комментарии, которые привели к правке кода | wiki репозитория (`.pr_agent_accepted_suggestions`, `.pr_agent_auto_best_practices`), `best_practices.md` в корне; Rule Miner — портал Qodo | нет |
| Cursor Bugbot | learned rules | реакции и ответы на свои комментарии, комментарии людей о пропущенном | dashboard на репозиторий; `.cursor/BUGBOT.md` в репозитории | нет |
| Graphite Agent | правила, которые пишут люди | метрики принятия по правилу; правила вручную | web-интерфейс Graphite и файлы репозитория по glob | нет |
| GitHub Copilot code review | ничего на репозиторий | 👍/👎 идут в улучшение продукта | инструкции в репозитории | нет |

Источники:

- **CodeRabbit.** <https://docs.coderabbit.ai/knowledge-base/learnings> (создание, dashboard
  `app.coderabbit.ai/learnings`, `PATCH`/`DELETE /v1/learnings/{id}`);
  <https://docs.coderabbit.ai/reference/configuration> (`knowledge_base.learnings.scope`: `local`, `global`, `auto`;
  `reviews.path_instructions` до 20 000 символов);
  <https://docs.coderabbit.ai/knowledge-base/code-guidelines> (сам читает `AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
  `.github/copilot-instructions.md` и другие); <https://docs.coderabbit.ai/integrations/knowledge-base>
  («never uses customer code for model training»; `knowledge_base.opt_out: true` выключает learnings и удаляет
  данные).
- **Greptile.** <https://www.greptile.com/docs/how-greptile-works/memory-and-learning>,
  <https://www.greptile.com/docs/code-review-bot/custom-context> (конфиг в репозитории главнее dashboard),
  <https://www.greptile.com/docs/pricing>.
- **Qodo.** <https://docs.qodo.ai/governance/rule-enforcement/without-rule-system/best-practices.md> (файл
  `best_practices.md` до ~800 строк; auto best practices только на GitHub и требуют wiki),
  <https://docs.qodo.ai/governance/rule-enforcement/rule-miner.md>, <https://docs.qodo.ai/core-concepts/pr-history.md>.
- **Cursor Bugbot.** <https://cursor.com/docs/bugbot>, <https://cursor.com/blog/bugbot-learning> (`@cursor remember`,
  backfill из недавних PR).
- **Graphite.** <https://graphite.com/docs/ai-review-customization>. Утверждение «learns from your repository's past
  interactions» есть только в маркетинговом guide (<https://graphite.com/guides/ai-code-review-on-github>), в
  документации — нет.
- **Copilot.** <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review>
  (читает `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `CLAUDE.md`, `GEMINI.md`,
  `REVIEW.md`; по умолчанию оставляет ревью «Comment», не approve).
- **Коротко.** Sourcery — 👍/👎 и правила словами по путям (<https://docs.sourcery.ai/Code-Review/Teaching-Sourcery/>,
  <https://docs.sourcery.ai/reviews/review-rules/>). Bito — после трёх одинаковых отрицательных сигналов сам заводит
  правило (<https://docs.bito.ai/ai-code-reviews-in-git/implementing-custom-code-review-rules>, только текст поиска).
  Ellipsis — следит, какие комментарии resolved, какие отклонены (<https://docs.ellipsis.dev/features/code-review>,
  только текст поиска).

Что видно:

- **Сигнал «настоял» уже нашли.** Qodo берёт только комментарии, после которых код поменяли; Greptile сравнивает
  первый и последний commit. Для генератора это готовый признак правила «на чём ревьюер настаивает».
- **Хранение — облако вендора или файл в репозитории.** Ни один не хранит выученное только на машине пользователя.
  worfy здесь отличается по решению Ticket 01.
- **Голос не копирует никто.** Все учат «что отмечать», ни один — «как это сказать». Это ниша human-review.
- **Исследования.** CodeReviewer (Li et al., ESEC/FSE 2022) учит генерацию комментариев на ревью открытых проектов
  девяти языков (<https://arxiv.org/abs/2203.09095>). Google: модель закрывает 52% комментариев ревью при точности
  50%, авторы применяют 40–50% показанных правок
  (<https://research.google/blog/resolving-code-review-comments-with-ml/>). Промышленное исследование на PR-Agent:
  10 проектов, 238 разработчиков, 73,8% автоматических комментариев resolved, но время закрытия PR выросло с 5 ч 52 мин
  до 8 ч 20 мин (<https://arxiv.org/abs/2412.18531>). Последнее — довод держать черновик за «да» человека, а не
  постить автоматически.

## 8. Приватность: слова коллег

- **Что попадает в skill.** Цитаты коллег, их логины, пути файлов и куски кода из `diff_hunk`. Репозиторий может
  быть приватным, а тексты — чужими; коллеги на сбор своих слов не соглашались.
- **Где лежит (решение Ticket 01).** Папка Profile-а: `$HARNESS_HOME/projects/<name>/`, по умолчанию
  `~/.claude/worfy-harness/projects/<name>/` (`harness/profiles/README.md:24-37`). Своей подпапки для skills там
  сейчас нет: в списке — `profile.json`, `rules.md`, `lessons/`, `bin/`, `epics/`, `state/`.
- **Предложения (предположение).**
  - Хранить сырые ответы API не дольше одного запуска генератора; в skill класть только короткие примеры голоса, без
    кусков кода, кроме нескольких строк вокруг замечания.
  - Логины коллег в примерах заменить ролью («ревьюер A») по выбору пользователя.
  - Показывать пользователю, что сохранено, и давать удалить одним действием — как `knowledge_base.opt_out` у
    CodeRabbit.
  - Модель видит тексты коллег при генерации: это уходит Vendor-у модели так же, как любой код Session-а. Сказать об
    этом в предложении настройки.
- **Чего не делать.** Не класть skill в репозиторий проекта (решение Ticket 01), не публиковать черновик в GitHub без
  «да» (там же), не называть в этом репозитории проект частного образца владельца.

## 9. Куда подключить сгенерированный skill в worfy

- **Как Claude Code его найдёт.** Skills грузятся из `~/.claude/skills/`, из `.claude/skills/` проекта, из plugin-а и
  из `.claude/skills/` каталога, добавленного через `--add-dir`; Agent SDK передаёт `additionalDirectories` как
  `--add-dir` (<https://code.claude.com/docs/en/skills>). Папка Profile-а с подпапкой `.claude/skills/human-review/`,
  добавленная worfy в `additionalDirectories` Session-а, дала бы skill без записи в репозиторий и в
  `~/.claude/skills` (**предположение**: не проверено живым запуском). Поле `skills.allowed` Profile-а сейчас знает
  только plugin-ы, `~/.claude/skills` и `claude.ai` (`harness/profiles/README.md:213`).
- **`code-review` (из skills Matt Pocock, `harness/skills/THIRD_PARTY.md:20`).** Две оси: Standards и Spec
  (`harness/skills/code-review/SKILL.md:6-11`). Ось Standards ищет файлы стандартов **в репозитории**
  (`:34-36`), так что правила из папки Profile-а она сама не найдёт. Отчёт — две секции без слияния и переранжирования
  (`:76-80`). Вывод: human-review — слой поверх, а не замена. Он передаёт свои правила как ещё один источник
  стандартов в бриф Standards и переписывает готовые находки голосом ревьюера: nit — коротко, риск — с доводом.
- **Агент `worfy:reviewer` и lens-ы.** Profile перечисляет lens-ы в `review.lenses`
  (`harness/profiles/README.md:219`); описание lens-а лежит в `harness/agents/reviewer.md`, раздел «Lens descriptions»
  (`:212-217`); lens без описания читается по имени. Описание живёт в plugin-е, общем для всех проектов, поэтому
  проектный lens «как ревьюит команда» туда не впишешь. Правила human-review пойдут в бриф reviewer-а, а не в
  описание lens-а.
- **Ревью чужого PR в `ship-ticket`.** Отдельная процедура
  (`harness/skills/ship-ticket/SKILL.md:255-257`) с глубиной по `review.depth.first_round`
  (`harness/profiles/README.md:222`). Это естественная точка вызова: сначала находки, потом черновик голосом
  human-review, потом «да» человека.
- **`continuous-audit` (skill worfy, не Matt Pocock).** Lens-ы аудита — `audit_lenses` с полями `id`, `title`, `where`,
  `finding` (`harness/profiles/README.md:227`; `harness/skills/continuous-audit/SKILL.md:79-89`); правило skill-а —
  находка остаётся утверждением, пока второй агент её не воспроизвёл (`:9-10`). Устойчивые правила из истории
  («ревьюеры всегда требуют X») могли бы стать lens-ом аудита (**предположение**). Но `audit_lenses` лежит в
  `profile.json`, а не в skill-е, так что это отдельный шаг генератора с согласия пользователя.
- **Правила проекта в каждой Session.** `session.inject_rules` подмешивает `rules.md` Profile-а в каждую Session
  (`harness/profiles/README.md:206`). Класть туда слова коллег не надо: они попали бы во все Session-ы, а не только в
  ревью.

## 10. Выводы

1. **Брать данные через GraphQL, обновлять через `since`.** Для ~2k PR — ~20 запросов и ~640 очков; REST тратит
   ~2 тыс. запросов на одни ревью (**оценка**).
2. **Резать ботов и окно истории до модели.** Боты — 68% символов в выборке; окно 12 месяцев или 300–500 PR держит
   вход в сотнях тысяч токенов (**оценка**).
3. **Правило — только с доказательством «настоял».** Признаки: `CHANGES_REQUESTED`, `isResolved`, правка кода после
   комментария, повтор в нескольких PR. Так делают Qodo и Greptile.
4. **Голос отдельно от правил.** Правила объединяются по выбранным ревьюерам; примеры тона и длины — на каждого.
5. **Короткая история — честное «голоса нет».** Правила из документов проекта и образец от самого пользователя.
6. **Подключение — через бриф, а не через plugin.** code-review и `worfy:reviewer` берут правила human-review в бриф;
   сам skill грузится из папки Profile-а через `additionalDirectories` (**предположение**, нужен живой опыт).

## 11. Что не проверено

- Число токенов на символ не мерилось; `diff_hunk` в замер не входил.
- Доля ботов и длина текста — по одному публичному репозиторию; на приватном проекте может быть иначе.
- Загрузка skill-а из каталога `--add-dir` / `additionalDirectories` описана в документации, но не проверена запуском
  в worfy.
- Политика хранения данных у Greptile, цены и «обучение» Graphite, детали Bito и Ellipsis — только по тексту поиска
  или не найдены.
- Размер набора данных CodeReviewer — PDF не прочитан.
- Страница GitHub о заголовке `Link` не перечитана; его формат подтверждён живыми ответами API.

## 12. Открытые вопросы владельцу

1. **Окно истории.** 12 месяцев или 300–500 PR выбранного ревьюера — подходит как значение по умолчанию?
2. **Анонимизация.** Заменять логины коллег на «ревьюер A» в сохранённых примерах по умолчанию или только по выбору?
3. **Где лежит skill.** Подпапка `.claude/skills/` в папке Profile-а плюс `additionalDirectories` — проверить это
   отдельным prototype-Ticket-ом до spec?
4. **Ревью агентов.** В проектах, где ревью пишут агенты от имени человека, исключать их по служебной строке в теле —
   и кто задаёт эту строку: генератор спрашивает или Profile хранит?
5. **Аудит.** Предлагать ли превращать устойчивые правила истории в `audit_lenses` Profile-а, или human-review
   остаётся только про черновик ревью?
