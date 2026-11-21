# 0105 — worfy публикует ответ в PR только по щелчку пользователя: main отправляет ровно показанный текст; PR inbox читает GitHub из main
Дата: 2026-11-09. Статус: принят Orchestrator-ом под карт-бланш владельца 2026-11-09; подтверждён владельцем
2026-11-10 при приёмке. Epic `worfy-pr-inbox`; spec — `.scratch/worfy-pr-inbox/spec.md` (принят так же; ответы Q1–Q10 в нём
записаны); критика — `docs/product/critic/worfy-pr-inbox-2026-11-09.md` (Reorder, принята). В силе с 2026-11-09:
Orchestrator принял spec в тот же день под карт-бланш владельца.

**Контекст.** В командном проекте в Silent mode работу пользователя ждут люди: ревью чужих PR и ответы в нитях ревью
на его PR. worfy их не видит: PR tracker (`src/main/github/prs.ts`) читает только ветки Ticket-ов и не читает нитей
ревью. Ответить можно руками на GitHub или попросив Session опубликовать текст — тогда шаг публикации держит модель.
Session «Ship ticket» стартует в `bypassPermissions` (`src/main/actions/launch.ts:10-11`), так что «только по
щелчку» на одной модели не держится.

До сих пор main только читал GitHub. Заголовок `src/main/github/gate-queue.ts:3-4` формулирует правило так: «worfy
never comments, merges or edits a label; the skill /worfy:gate-queue does that in a Session (ADR-0002)». ADR-0005
держит собственное состояние worfy в `WORFY_DATA_DIR`. Team reviewer (spec `worfy-human-review`, решения 8 и 9)
закрепил: слова коллег — только на машине пользователя, в папке Profile-а; на GitHub ничего не уходит без явного «да»
человека. Guard hook (`harness/hooks/guard.mjs:230-237`) проверяет на следы workflow тексты `gh pr …`, но не
`gh api`.

**Решение** (Orchestrator под карт-бланш владельца 2026-11-09, ответы Q1–Q10 spec-а; владелец подтверждает при
приёмке).

1. **PR inbox читает GitHub из main.** По Project-у, с его GitHub-аккаунтом (`accountAuth`), только репозитории
   Project-а: поиск открытых PR пользователя и запросов ревью у него, детали и нити ревью, REST
   `GET /notifications` как триггер (ответ 304 — «без перемен», хотя gh выходит на нём с кодом 1). Это только чтение: уведомление никогда не помечается прочитанным.
2. **Main публикует ответ только по щелчку пользователя.** Send на одном черновике или Send all после диалога со
   всеми текстами. Канал `prInbox.send` — `local`: Linked machine его не вызывает ни при каком уровне доступа.
3. **Публикуется ровно показанный текст.** Main берёт текст из поля редактора как есть, перед публикацией снова
   проверяет его `review-draft-lint --reply` (следы workflow, подпись ИИ, личные данные, длина). Находка — публикации
   нет, черновик остаётся.
4. **Только две записи.** Ответ на верхний комментарий нити ревью
   (`POST /repos/{o}/{r}/pulls/{n}/comments/{comment_id}/replies`) и комментарий в разговоре PR
   (`POST /repos/{o}/{r}/issues/{n}/comments`). Один POST на черновик; автоматического повтора нет. Resolve, re-request
   review, отправка review, pending review, «прочитано», push, метки main не делает.
5. **Модель не публикует.** Черновики пишет Session со skill-ом `/worfy:pr-reply` в файлы; skill ничего не
   публикует. Guard hook проверяет на следы workflow тексты записей `gh api` в PR и issue и мутаций GraphQL.
6. **Где лежит состояние.** `<Project data folder>/pr-inbox.json` в `WORFY_DATA_DIR` — что пользователь видел: id, sha
   и время, без текстов коллег. Черновики — `<Profile folder>/state/pr-inbox/drafts/` на этой машине, вне истории git
   Harness home; Session их пишет, main дописывает правку пользователя и отметку `sent`. Тексты нитей main держит
   только в памяти. Никогда — GitHub pending review.
7. **Включено по умолчанию** для каждого Project-а с remote на GitHub; поле `prInbox: false` в `settings.json`
   Project-а выключает чтение.

**Что меняется в прежних ADR.** ADR-0002 — правило «main читает, пишет Session» (как его читает gate queue) получает
одно исключение: пункты 2–4. Остальное в ADR-0002 в силе: статус Ticket-ов и Epic-ов worfy по-прежнему меняет только
инструментами workflow. ADR-0005 — два новых места собственного состояния из пункта 6. Обе поправки дописаны в
`## Amendments` этих ADR.

**Последствия.**

- Main впервые пишет на GitHub. Код записи — один модуль (`src/main/github/pr-reply-send.ts`), его ревью — ступень
  `max`; test-ы проверяют, что ни чтение, ни открытый вид, ни черновик без щелчка Send не делают ни одной записи.
- Повтор после ошибки сети — новый щелчок; перед ним main перечитывает нить и, если этот текст от этого аккаунта уже
  опубликован, только отмечает `sent`.
- Session `/worfy:pr-reply` технически может вызвать `gh api` сама (в `bypassPermissions`). Её текст это запрещает,
  guard ловит следы workflow, чистый текст пройдёт. Это сила самого агента, такая же, как у любой Session с Bash;
  по правилу соразмерности защиты она описана, а не закрыта. Так же процесс Machine, который ведёт окно worfy через
  debugging port, может нажать Send: такой процесс и без worfy может вызвать gh.
- Публикация ответа у fine-grained токена требует «Pull requests: write»; без него Send показывает причину GitHub.
- Team reviewer публикует свой review, как раньше, после «да» в разговоре; guard теперь проверяет и его текст.

## Considered Options

- **Main публикует ровно показанный текст по щелчку** (выбрано, Q2).
- **Session, которой сказали «опубликуй».** Не выбрано: шаг публикации держит модель; Session в `bypassPermissions`
  может опубликовать раньше или другими словами.
- **Черновики как GitHub pending review**, пользователь отправляет на сайте. Не выбрано (Q8): запись на GitHub до
  щелчка, забытый pending review висит.
- **Помечать уведомления прочитанными, когда пользователь открыл PR в worfy.** Не выбрано (Q4): это меняет inbox
  пользователя на GitHub.
- **Автоматический повтор POST после ошибки сети.** Не выбрано: потерянный ответ после успешного POST дал бы два
  одинаковых комментария.
- **Хранить тексты нитей на диске** (`state/pr-inbox/`). Не выбрано: память main достаточна, после рестарта тексты
  читаются снова, и слова коллег не ложатся на диск без нужды.

## Amendments

- **2026-11-18 — действия правки PR и skill `pr-fix`: push только по ответу «Push», конфликт — по режиму Profile-а**
  (worfy-pr-follow 06, по Ticket-ам 01–05; Q3 и Q4 spec-а `.scratch/worfy-pr-follow/spec.md` — решено без владельца
  2026-11-18, подтвердить). Действия Fix checks, Resolve conflicts и Address comments на PR пользователя (Pull
  requests, Ticket Node, Command palette) из main на GitHub не пишут: main заново читает PR и отдаёт шаблон действия
  (по умолчанию `/worfy:pr-fix <checks|conflicts|comments> {repo}#{pr} {sha}`) Session-и Project-а на Claude Code —
  Session Ticket-а этого PR, если последняя запись её транскрипта моложе 24 часов, иначе новой Session
  (`src/shared/ipc/actions.ts:107-122`, `src/shared/projects/action-templates.ts:95-97`,
  `src/main/actions/launch.ts:164`). Правку и commit делает Session со skill-ом `pr-fix` в worktree ветки PR, не в
  checkout пользователя. Push делает только Session и только после ответа «Push» в карточке вопроса — и в Silent
  mode, и в Full mode, где ship-ticket пушит сам (Q3); «Push», написанный в просьбе заранее, ответом не считается, а
  без человека ничего не уходит (`harness/skills/pr-fix/SKILL.md:14-18`, `:264-282`). Конфликт с базовой веткой — по
  режиму Profile-а (Q4): в Full mode rebase на базу в worktree и push только с
  `--force-with-lease=<ветка>:<head до rebase>`, который назван в вопросе «Force-push (with lease) …», никогда голым
  `--force`; если ветку на GitHub сдвинули, lease отказывает, и skill больше ничего не пушит. В Silent mode — merge
  commit базы, без rebase и force-push (`harness/skills/pr-fix/SKILL.md:170-186`, `:264-276`). Пункт 4 в силе: main
  делает только две записи из него, ничего больше в PR не пишет и не пушит. Ответы на нити ревью режима `comments`
  skill отдаёт черновиками в `pr-reply-draft`, публикует их, как раньше, щелчок Send (пункты 2–3). Сообщение main в
  Session записано в ADR-0108, пункт 5; своего ADR о нём нет.
- **2026-11-20 — пункт 1: поиск PR по запросу пользователя и чтение одного PR из его результатов могут назвать любой
  репозиторий, видимый аккаунту Project-а** (worfy-pr-review 04; решение владельца 2026-11-20, Q1 (а) spec-а
  `.scratch/worfy-pr-review/spec.md`). Фоновые чтения PR inbox (поиск раз в 5 минут, детали, уведомления) остаются в
  репозиториях Project-а. Поиск во вкладке Pull requests идёт только по Enter, в одной из трёх областей: This Project
  (`repo:` каждого репозитория Project-а, по умолчанию), организации владельцев этих репозиториев (`org:`), All of
  GitHub — всё, что видит аккаунт Project-а (`src/shared/pr-search/query.ts`). PR из результатов, которого нет в inbox,
  читается тем же запросом деталей, что и строка inbox (`prSearch.pull`, `src/main/github/pr-search.ts`). Это только
  чтение тем же аккаунтом (`accountAuth`): `gh api graphql` с `query`, без `--method` и без `mutation`; на GitHub
  ничего не меняется, Mark seen для таких PR не пишется. Детали PR вне inbox — только в памяти main, не больше 200 PR;
  на диск, как и по пункту 6, слова коллег не попадают. Пауза на rate limit общая с PR inbox (порог 10 %): поиск,
  который видит низкий остаток, останавливает и inbox этого аккаунта, и наоборот.
- **2026-11-21 — пункт 4: третья запись — отправка review по Submit пользователя** (worfy-pr-review 11; решение
  владельца 2026-11-20, Q2 (а) spec-а `.scratch/worfy-pr-review/spec.md`; ADR-0112). Main делает один
  `POST /repos/{o}/{r}/pulls/{n}/reviews` по щелчку Submit review в диалоге Finish review, который показывает Summary,
  событие и каждый комментарий так, как они уйдут (`src/main/github/pr-review-submit.ts`). Всегда с `event`: pending
  review main по-прежнему не создаёт. Порядок тот же, что у Send: проверка `review-draft-lint`, отметка
  `submitting`, один POST, без автоматического повтора; новый Submit после сбоя сначала ищет ревью на GitHub.
  Resolve, re-request review, dismiss, merge main не делает.
