# Team reviewer

> Перевод [английской версии](../human-review.md), commit `same-pr`.

**Team reviewer** — частный skill ревью Project-а. Он написан по истории ревью pull request-ов Project-а на GitHub, чтобы
черновик ревью читался как ревью самой команды: короткий nit там, где команда пишет nit, и ничего там, где команда
пропускает изменение молча. worfy предлагает собрать его при добавлении Project-а, показывает его в «Project settings…»,
раз в месяц напоминает обновить и отдаёт его Session-ам Project-а. Skill и всё, что прочитано для его сборки, остаются на
этой машине, в папке Profile-а Project-а. Термины объяснены в [Concepts](concepts.md); «Project settings…» и добавление
Project-а — на странице [Projects](projects.md). План и причины — в spec Epic-а
[worfy-human-review](../../../.scratch/worfy-human-review/spec.md) и в
[ADR-0102](../../adr/0102-private-project-skills-in-profile-folder.md).

**Не Stage `human-review`.** В [Pipeline](workflow.md) есть Stage вида `human-review`, на доске — «Human review»: он ждёт,
пока решение ревью GitHub на открытом PR станет `APPROVED`. Этот Stage следит за ревью, которое человек даёт на GitHub.
Team reviewer — skill, который пишет черновик ревью. Общее у них только слово: Stage не пользуется skill-ом, а skill не
двигает Ticket по Pipeline.

## Team reviewer

### Behaviour

**Предложение после добавления.** Как только в список добавлена новая папка, через Connect или как папка, которую Harness
уже знает, worfy в фоне запускает `review-history probe` из Harness, с аккаунтом GitHub из Profile-а и пределом в 2 минуты.
Probe читает pull request-ы, обновлённые за последние 12 месяцев, у которых есть ревью команды, и останавливается на 30-м
содержательном комментарии. Комментарий считается, если его автор из команды (owner, member или collaborator
репозитория), не бот и не автор этого pull request-а, а его собственный текст без цитат не короче 20 знаков или содержит
блок `suggestion`; одни «LGTM», «+1», «thanks» или emoji не считаются. При 30 таких комментариях (`voice: yes`) у Project-а
появляется `action` toast «Build a reviewer in your team's style?» с кнопками «Build» и «Later». `voice: no`, нет `origin` на
GitHub, нет `gh`, ошибка или истёкший предел ничего не показывают, а в log пишется одна строка. «Later» или закрытие toast-а
сохраняется в настройках Project-а, и предложение больше не появляется. Project с уже собранным ревьюером предложения не
получает.

**«Build».** «Build» в toast-е или в «Project settings…» открывает новую [Session](sessions.md) в корне Project-а, всегда на
Claude Code, с первым сообщением `/worfy:human-review-setup`. Этот skill, генератор, идёт по порядку:

1. **Чтение и оценка.** Он читает историю во временную папку: pull request-ы, обновлённые за последние 12 месяцев, с ревью
   команды, не больше 500 на репозиторий. Потом показывает счётчики (pull request-ы, ревью по состояниям, комментарии по
   видам, содержательные комментарии, ревьюеры), число знаков и оценку токенов, которые прочтёт модель, и список
   игнорируемых логинов и начал текстов — человек может его дополнить. Он говорит, что комментарии коллег уйдут Vendor-у
   модели, как любой код Session-а. Ни один комментарий модель не читает до явного «да». Без него временная папка
   удаляется, и больше ничего не происходит.
2. **Мало истории.** Меньше 30 содержательных комментариев: «The team's voice cannot be built: N substantive comments of
   people over M pull requests, 30 are needed.» Вместо этого он предлагает `/worfy:code-review` — ревью по документированным
   стандартам репозитория. Остаются только счётчики, ни одного текста комментария.
3. **Один ревьюер.** Если 80% или больше комментариев команды написал один ревьюер, генератор говорит об этом: голос будет
   в основном его. Голос всё равно строится по числам всех, и ни один ревьюер не даёт больше трети примеров уровня, когда
   примеры дали трое или больше.
4. **Анализ.** После «да» 5 недавних pull request-ов откладываются для проверки ниже, или треть из них, если подходящих
   меньше 15. Subagent-ы читают остальные пачками
   по областям кода и раскладывают каждый комментарий команды по уровню (let go, nit, question, heads-up, followup, argued,
   blocker) и по теме. Итог — `research.md`, файл доказательств: разделы `R1`, `R2`, … с числами и ссылками на комментарии.
5. **Skill.** Генератор заполняет шаблон из восьми шагов (загрузить pull request, triage, checklist по областям, проверить
   и оценить, голос по уровню, состояние ревью, черновик, показать человеку). Каждое правило кончается `[R<n>]` раздела
   `research.md`, на котором оно стоит, и скрипт не пропускает skill, пока у правила нет такого раздела.
6. **Проверка на 5 pull request-ах.** На каждый отложенный pull request один Subagent пишет черновик ревью на том commit-е,
   который видело первое ревью команды, и ничего не отправляет. Замечания черновика сопоставляются с настоящими
   комментариями команды на этом commit-е: два комментария к строкам — только в одном файле и не дальше 10 строк друг от
   друга, и каждую пару подтверждает Subagent-судья. У каждого pull request-а — страница, где комментарии команды стоят
   рядом с черновиком, и строка «matched K of N remarks of the team, M extra»; у итога — слова «a rough measure».
   Комментарии команды к более поздним commit-ам перечислены отдельно и не считаются.
7. **Решение человека.** **Keep** удаляет временную папку и записывает дату. **Build again** берёт замечания человека в
   skill и снова запускает проверку; её итог тогда помечен «after the person saw these PRs». **Refuse** удаляет частную
   папку. Без ответа временная папка удаляется, остальное остаётся.

**Использование.** Собранный ревьюер попадает в каждую Session Project-а на Claude Code, которую ведёт человек, как skill
`/human-review`: Orchestrator, «New session», «Ship ticket» и Product Session. Когда его просят отревьюить pull request, он
пишет черновик голосом команды, проверяет его через `review-draft-lint` и показывает. На GitHub ничего не уходит без явного
«да» человека на этот черновик в разговоре; просьба поправить, вопрос или молчание — не «да». Эти Session-ы его никогда не
получают:

- Session Autopilot и любая другая Session без человека: там некому сказать «да»;
- Session черновика в «Add project»;
- Session на Codex: частную папку добавляет только driver Claude Code;
- Session, запущенная вне Project-а или с неподключившимся Canvas.

**Claude Code в терминале.** `claude`, запущенный вами в shell — в [Terminal](terminal.md) worfy или где угодно ещё, — не
Session worfy, и папку он не получает. Дайте её вручную: найдите папку Profile-а командой Harness `profile -C <project>
--dir`, потом запустите `claude --add-dir "<Profile folder>/state/human-review"`. Claude Code грузит `.claude/skills/`
добавленного каталога, поэтому `/human-review` будет на месте.

**«Team reviewer» в «Project settings…».** Раздел показывает `Not built`, `Built <date>, <N> PRs` или
`Too little history: <N> of 30` или `Not available: <reason>`, когда папку Profile-а прочитать не удалось. Дата — когда человек оставил результат, иначе последнее полное чтение истории; после
обновления, которое человек принял, — дата этого обновления, и `<N>` прибавляет pull request-ы, прочитанные обновлением.
«Build» запускает Session генератора и закрывает диалог, если в диалоге не правили ни одного поля; иначе диалог
остаётся открытым и говорит, что Session запущена. У собранного ревьюера на её месте «Update». «Delete» сначала
спрашивает, потом стирает частную папку и ничего больше.

**Ежемесячное обновление.** Каждый раз, когда окно делает Project активным, оно спрашивает main, пора ли напомнить. Пора,
когда ревьюер собран, его дате больше 30 дней и за последние 30 дней напоминания не было. Напоминание записывается до
ответа, поэтому оно приходит один раз и в одно окно. Тогда у Project-а появляется `action` toast «Update your team
reviewer?» с кнопками «Update» и «Later». Напоминание читает только частную папку: ни скрипта Harness, ни GitHub, ни
модели. «Update», здесь или в «Project settings…», открывает Session с `/worfy:human-review-setup --refresh`:

- Она читает только pull request-ы после последнего анализа и считает только комментарии команды, написанные после этой
  даты. Если их нет, она говорит, что нового pull request-а с ревью команды с этой даты нет, удаляет прочитанное и не
  тратит токенов.
- Она задаёт тот же вопрос «да» после оценки и анализирует новые комментарии вместе с прежним `research.md`. Старые
  разделы сохраняют номера, новые темы получают следующие.
- Она пишет новый skill как черновик и показывает diff правил: **Added**, **Changed** и **Removed**, у каждого — его
  `[R<n>]` и для каждого числа правила «before → now».
- Она проверяет черновик на 5 новых pull request-ах, как и сборка.
- **Accept** переносит установленный skill, его примеры, `research.md`, `lint.json` и старые страницы проверки в
  `previous/` с отметкой времени и ставит новые на место. **Reject** или отсутствие ответа удаляет черновик и ничего не
  меняет.

#### Windows

Своего кода для Windows у Feature нет. Probe запускается, как любой скрипт Harness, — `node <script>`, а путь частной папки
доходит до Claude Code как написан, с буквой диска или пробелами.

#### On a Linked machine

Экран Linked machine с доступом только на чтение видит строку состояния «Team reviewer» без кнопок и не спрашивает о
напоминании: ответ на этот вопрос записывает дату напоминания. Экран с полным доступом работает как окно самой Machine.

### How it works

- **Одна частная папка на Project, на этой машине.** Всё лежит в `<Profile folder>/state/human-review/`: `meta.json` (окно,
  счётчики, даты, отложенные pull request-ы, итог проверки), `ignore.json` (логины ботов и служебных учётных записей и
  начала текстов, правит человек), `research.md`, `lint.json`, `check/`, `previous/`, временная `raw/` и skill в
  `.claude/skills/human-review/`. Harness держит `state/` Profile-а вне истории git своей папки, поэтому слова коллег
  никогда не попадают в историю git, а «Delete» стирает их по-настоящему. Ревьюер собран ровно тогда, когда в этой папке
  есть `.claude/skills/human-review/SKILL.md`; поля для этого в Profile нет
  ([ADR-0102](../../adr/0102-private-project-skills-in-profile-folder.md)).
- **Голос — команды.** Все ревьюеры команды считаются вместе. В skill-е, его примерах и `research.md` — ссылки на
  комментарии и метки вроде «reviewer A», никогда не логин. Логины есть только в `ignore.json` и на время одного запуска в
  `raw/`.
- **Чтение GitHub стоит очков API, а не токенов.** `review-history` читает через `gh api graphql`, по 100 pull request-ов на
  страницу, по одному запросу за раз, под аккаунтом GitHub из Profile-а; глобальный аккаунт `gh` он не переключает. Ответ о
  rate limit повторяется три раза.
- **Черновик проверяется до того, как его увидит человек.** `review-draft-lint` не пропускает комментарий длиннее предела
  его уровня, след workflow (Epic, Ticket, номер ADR, `.scratch`, `HANDOFF`), строку авторства AI, личные данные и слово,
  которое человек дописал в `forbidden` в `lint.json`.
- **Проверка не видит ответа.** Черновик отложенного pull request-а строится по diff между commit-ом, от которого
  pull request ответвился, и commit-ом, который видело первое ревью. У влитого pull request-а эта база — merge base первого
  родителя merge commit-а и этого commit-а; у не влитого — `origin/<base branch>` и этого commit-а. Pull request с пустым
  diff пропускается. Subagent черновика не читает более позднюю историю pull request-а.
- **Session получает папку как дополнительный каталог.** При каждом старте Session на Claude Code с человеком читает папку
  Profile-а через `bin/profile` и добавляет частную папку после папки Cards, в `additionalDirectories`. `skills.allowed`
  Profile-а её не убирает. Ошибка оставляет Session без папки и пишет одну строку в log, а не оставляет человека без Session.

### Implementation

**Модули.**

| Что | Где |
|---|---|
| Предложение, состояние «Team reviewer», напоминание (`refreshDue`), «Delete» | `src/main/projects/review-offer.ts` |
| Каналы `projects.reviewer.*` и их доступ | `src/main/ipc/projects.ts`, `src/shared/ipc/projects.ts` |
| Toast-ы предложения и напоминания | `src/renderer/projects/review-offer.ts`, вопрос при активации — из `src/renderer/projects/useProjects.ts` |
| Раздел «Team reviewer» | `src/renderer/shell/ProjectSettings.tsx` |
| Session генератора (`buildTeamReviewer`) и её команда | `src/main/actions/launch.ts`, `src/shared/projects/action-templates.ts` |
| `humanReview.offer` и `humanReview.remindedAt` | `src/main/projects/settings.ts` |
| Частная папка в Session (`privateSkillsFolder`, `additionalDirectories`) | `src/main/vendors/claude/query.ts`, `src/main/vendors/claude/options.ts` |
| Папка Profile-а (`readProfileFolder`) | `src/main/workflow/profile.ts` |
| Чтение истории, оценка, probe | `harness/bin/review-history` |
| Проверка черновика и skill-а | `harness/bin/review-draft-lint`, `harness/lib/workflow-traces.cjs` |
| Генератор | `harness/skills/human-review-setup/SKILL.md` с `analyse.md`, `write.md`, `check.md`, `refresh.md` |
| Шаблон сгенерированного skill-а | `harness/skills/human-review-setup/template/` |

**Основные test-ы.**

- `test/contract/projects.test.ts`: предложение по ответу probe, «Later», состояние и «Delete», напоминание раз в 30 дней с
  «Update».
- `test/e2e/projects.spec.ts`: предложение с «Later» и «Build» в собранном приложении.
- `test/unit/review-offer-toast.test.ts`, `test/unit/project-settings-shell.test.tsx`: toast-ы и раздел.
- `test/unit/agent-options.test.ts`, `test/contract/workflow-profile.test.ts`: какие Session-ы получают частную папку,
  после папки Cards, и с `skills.allowed` тоже.
- `harness/bin/tests/review-history.test.sh`, `test/contract/harness-review-draft-lint.test.ts`,
  `test/contract/harness-human-review-setup.test.ts`: скрипты и тексты генератора.
