# worfy-skills: skills Matt Pocock — внутри plugin-а worfy

Status: черновик — ждёт приёмки владельцем
Source: решения владельца 2026-11-07 (п. 1–7 ниже: что берём, конфликт имени `retro`, `code-review`, старые установки,
заморозка на 1.3.1, перекрёстные ссылки, проверки); [ADR-0059](../../docs/adr/0059-installer-installs-plugin-dependencies.md)
(установщик ставит зависимости plugin-а), [ADR-0047](../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md), п. 5
(plugin объявляет зависимость `mattpocock-skills`), [ADR-0094](../../docs/adr/0094-vendor-seam.md) (Codex ставит
зависимость отдельным plugin-ом), [ADR-0074](../../docs/adr/0074-harness-neutral-by-language-and-project.md) (тексты plugin-а и кода — английские, epic
worfy-neutral), [ADR-0056](../../docs/adr/0056-windows-checks-and-two-sessions.md) (платформенный PR ждёт Windows verdict); [TICKETS.md](../../harness/bin/TICKETS.md)
(язык Ticket-ов и `bin/ticket`); [profiles/README.md](../../harness/profiles/README.md) (контракт Profile).
Ticket-ы: Epic `worfy-skills`, 5 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` / `Source:`,
как у worfy-retry. Спутник — карта [worfy-human-review](../worfy-human-review/map.md): тот Epic идёт после этого.

## Цель

Plugin `worfy` (`harness/`) объявляет зависимость `mattpocock-skills@claude-plugins-official`
(`harness/.claude-plugin/plugin.json:7`). Её ставит установщик worfy (ADR-0059): Claude Code — командой
`claude plugin install`, Codex — отдельным plugin-ом (`src/main/harness/codex-install.ts:329-339`). Plugin зависимости
Claude Code обновляет сам из marketplace `claude-plugins-official`.

Что это даёт сегодня:

- **Внезапные обновления.** Содержимое skills меняется без PR в worfy: Claude Code подтягивает новую версию сам.
- **Разные версии у разных пользователей.** Каждый получает ту версию, что была в marketplace в день установки или
  последнего обновления.
- **Длинный префикс.** `/mattpocock-skills:grilling` вместо `/worfy:grilling`. Claude Code всегда показывает имя plugin-а
  перед skill-ом из plugin-а, так что `worfy:` останется в любом случае.

Epic переносит стабильные skills Matt Pocock (MIT) в plugin `worfy`, замораживает их на версии 1.3.1 и перестаёт
ставить plugin `mattpocock-skills`. Собственный skill `retro` worfy и его напоминание уходят: место занимает `retro`
Matt Pocock.

## Решения владельца 2026-11-07

1. **Что берём.** Стабильные skills из `engineering/` и `productivity/` установленной копии 1.3.1 (кэш plugin-ов Claude
   Code, `plugins/cache/claude-plugins-official/mattpocock-skills/1.3.1/skills/`; upstream — `github.com/mattpocock/skills`,
   commit `49dd158d1076134a641b33efb035946536778336`; MIT, `LICENSE` в корне копии; копия только читается).
   Не берём: `misc/*`, `in-progress/*`, `ask-matt`, `setup-matt-pocock-skills`. Работа
   `setup-matt-pocock-skills` (где проект держит Ticket-ы и как в нём идёт wayfinding) переходит в skill
   `connect-project` worfy. Skill, который не подходит по содержанию, назван ниже с рекомендацией и пометкой
   «подтвердить».
2. **Конфликт имени `retro`.** Свой `retro` worfy ни разу не вызывался ни в одном транскрипте. Он уходит вместе с
   напоминанием: часть hook-ов SessionEnd и SessionStart (`harness/hooks/session-end.mjs`, `session-start.mjs`, их
   test-ы) и поле Profile `session.retro_reminder_after` (контракт `harness/profiles/README.md` и код Profile в
   приложении). Старые Profile-ы с этим полем продолжают работать. Вместо него — `retro` Matt Pocock: только ручной
   вызов (`disable-model-invocation: true`).
3. **`code-review` Matt Pocock берём** как `/worfy:code-review`.
4. **Старые установки.** worfy больше не ставит plugin `mattpocock-skills`. При обновлении worfy удаляет этот plugin,
   только если его поставил сам worfy. Если его поставил пользователь, plugin остаётся.
5. **Заморозка на 1.3.1.** MIT `LICENSE` и строка об авторстве лежат рядом с копией. Автоматической синхронизации
   нет: изменения upstream владелец смотрит руками, когда захочет, отдельным PR.
6. **Перекрёстные ссылки.** Каждая ссылка skill-а на другой skill называет имя `worfy:`; настройка tracker-а — через
   `connect-project`.
7. **Проверки.** Eval-ы Harness на переименованных skills (платный eval до 100 USD разрешён заранее; сначала dry run,
   cap ниже 100). Страница Feature `docs/features/skills-agents-and-hooks.md` и её `ru/` копия. Поправка ADR-0059.
   PR установщика и скриптов Harness — платформенные: ждут Windows verdict (ADR-0056).

## Какие skills берём

Раскладка — плоская: `harness/skills/<имя>/` (как у skills worfy); Claude Code без поля `skills` в `plugin.json` ищет
skills на один уровень вглубь. Папка `agents/` (файл `openai.yaml` для Codex) и файлы рядом с `SKILL.md` копируются как
есть.

**Берём — 20 skills.** `retro` приходит в Ticket-е 02, остальные 19 — в Ticket-е 01.

| Skill | Откуда | Вызов | Что делает |
| --- | --- | --- | --- |
| `code-review` | engineering | модель и `/worfy:code-review` | ревью изменений с точки отсчёта по двум осям — стандарты репозитория и spec — двумя Subagent-ами |
| `codebase-design` | engineering | модель | словарь глубоких модулей: interface, seam, depth; «design it twice» |
| `diagnosing-bugs` | engineering | модель | цикл диагностики тяжёлого дефекта и регрессии скорости; шаблон `scripts/hitl-loop.template.sh` |
| `domain-modeling` | engineering | модель | glossary и ADR проекта по ходу проектирования |
| `grill-with-docs` | engineering | только вручную | grilling с записью glossary и ADR (вызывает `grilling` и `domain-modeling`) |
| `improve-codebase-architecture` | engineering | только вручную | поиск мест для углубления модулей, HTML-отчёт, grilling по выбранному |
| `prototype` | engineering | модель | одноразовый прототип логики или UI под вопрос дизайна |
| `research` | engineering | модель | исследование по первоисточникам в Markdown-файл репозитория |
| `retro` | engineering | только вручную | ретроспектива Session: что поменять в окружении агента (Ticket 02) |
| `tdd` | engineering | модель | red-green-refactor, integration test-ы |
| `to-spec` | engineering | только вручную | spec из текущего разговора в tracker |
| `to-tickets` | engineering | только вручную | нарезка плана на Ticket-ы с `Blocked by` |
| `wayfinder` | engineering | только вручную | карта решений для большой работы, Ticket-ы карты по одному |
| `grill-me` | productivity | только вручную | grilling (обёртка над `grilling`) |
| `grilling` | productivity | модель | допрос плана по одному вопросу |
| `handoff` | productivity | только вручную | сжать разговор в документ для следующего агента |
| `teach` | productivity | только вручную | обучение теме внутри рабочей папки |
| `to-questionnaire` | productivity | только вручную | вопросник для того, кто знает ответ |
| `wait-what` | productivity | только вручную | пересказать последнее сообщение заново |
| `writing-for-agents` | productivity | модель | как писать skills, `AGENTS.md`, `CLAUDE.md` |

**Не берём — по решению владельца.**

| Skill | Почему |
| --- | --- |
| `ask-matt` | роутер по skills репозитория Matt Pocock; решение владельца |
| `setup-matt-pocock-skills` | его работу берёт `connect-project` (Ticket 01); решение владельца |
| `misc/git-guardrails-claude-code` | `misc/*` — решение владельца |
| `misc/migrate-to-shoehorn` | `misc/*` — решение владельца |
| `misc/scaffold-exercises` | `misc/*` — решение владельца |
| `misc/setup-pre-commit` | `misc/*` — решение владельца |
| `in-progress/chief-of-staff` | `in-progress/*` — решение владельца |
| `in-progress/claude-handoff` | `in-progress/*` — решение владельца |
| `in-progress/loop-me` | `in-progress/*` — решение владельца |
| `in-progress/setup-ts-deep-modules` | `in-progress/*` — решение владельца |
| `in-progress/writing-beats` | `in-progress/*` — решение владельца |
| `in-progress/writing-fragments` | `in-progress/*` — решение владельца |
| `in-progress/writing-shape` | `in-progress/*` — решение владельца |

Папка `deprecated/` содержит только `README.md` — skills там нет.

**Не берём — по содержанию, рекомендация («подтвердить»).**

| Skill | Почему не подходит |
| --- | --- |
| `pr` | Модель вызывает его на каждом теле PR («Use when writing a PR body»). Его шаблон (Summary / Evidence / Merge Danger) спорит с форматом PR skill-а `ship-ticket`, с языком `language.team` Profile-а и с Silent mode, где PR не несёт следов workflow. Раздел Summary — почти дословная копия skill-а `show-me` третьего автора (`CREDITS.md`); его лицензию в копии мы не проверили. **Подтвердить: не брать.** |
| `wizard` | Модель вызывает его сама. Он пишет bash-скрипт, который кладёт секреты в `.env` и в `gh secret`. Скрипты worfy — Node (ADR-0055), должны работать на Windows (ADR-0054); запись секретов агентом — вне правил Harness. **Подтвердить: не брать.** |
| `triage` | Пишет роли триажа (`needs-triage`, `ready-for-agent`, …) в строку `Status:` и ждёт словаря меток от `setup-matt-pocock-skills`. У worfy строку `Status:` пишет только `bin/ticket`, слова — `open`, `claimed`, `blocked`, `done`; чужое слово `epic-status` читает как «old header» (TICKETS.md). **Подтвердить: не брать.** |
| `implement`, `implement-spec` | Свой конвейер: Subagent-ы implementer-а, integration branch, `code-review` в конце — без gate, Evidence и правил merge Profile-а. Ту же работу в worfy делают `epic-wave` и `ship-ticket`; два пути к одному результату путают и человека, и модель. **Подтвердить: не брать.** |

Если владелец решит взять какой-то из пяти, Ticket 01 копирует его так же, как остальные: только ручной вызов
(`disable-model-invocation: true` у `pr` и `wizard` дописывается — это единственная правка поведения).

## Как работает

### Копия и авторство (Ticket 01)

- Каждый взятый skill копируется байт в байт, кроме правок ссылок (ниже). Правка ссылок — единственное отличие от 1.3.1.
- `harness/skills/THIRD_PARTY.md`: откуда (upstream, версия 1.3.1, commit), лицензия MIT, автор, список взятых skills
  и список правок ссылок по файлам. Рядом — `harness/skills/LICENSE.mattpocock-skills` с текстом `LICENSE` копии без
  изменений. Оба файла едут в `.app` вместе с `harness/` (`src/main/harness/bundled.ts`).
- Синхронизации нет. Правило в `THIRD_PARTY.md`: новая версия upstream — отдельный PR по слову владельца, diff
  upstream между версиями читается руками.

### Перекрёстные ссылки (Ticket 01)

Найдено grep-ом по копии 1.3.1 (`setup-matt-pocock-skills`, `Skill tool`, `Wayfinding operations`, `/<skill>`):

- **Вызовы Skill tool по имени** — `"grilling"`, `"domain-modeling"`, `"research"`, `"prototype"` (`wayfinder`,
  строки 77–79, 111, 115); `"codebase-design"`, `"grilling"`, `"domain-modeling"` (`improve-codebase-architecture`,
  13, 64, 66, 71); `"grilling"`, `"domain-modeling"` (`grill-with-docs`, 7); `"grilling"` (`grill-me`, 7);
  `"codebase-design"` (`tdd`, 26); `` `writing-for-agents` `` (`retro`, 11). Каждое имя становится `worfy:<имя>`.
  Вызовы из `triage`, `implement` и `implement-spec` уходят вместе с ними, если владелец подтвердит, что их не берём.
- **`/setup-matt-pocock-skills`** — `code-review` (13), `to-spec` (9), `to-tickets` (11, 60), `wayfinder` (25);
  ещё `triage` (43) и `implement-spec` (9). Становится `/worfy:connect-project`.
- **Ссылки вида `/codebase-design`** в `improve-codebase-architecture/SKILL.md` (54) и `HTML-REPORT.md` (42, 108, 123),
  `/teach` в `teach/SKILL.md` (12) — становятся `/worfy:<имя>`.
- **«Wayfinding operations»** — раздел tracker-документа, который пишет `setup-matt-pocock-skills`
  (`issue-tracker-local.md`, `-github.md`, `-gitlab.md`). Его место — новый раздел `## Wayfinding operations` в
  `harness/bin/TICKETS.md` (ниже).
- Ссылки на файлы `README.md` папок `engineering/` и `productivity/` не копируются: этих файлов в worfy нет.

Test Ticket-а 01 повторяет этот grep над `harness/skills/` и падает на любой ссылке `mattpocock`,
`setup-matt-pocock-skills`, `ask-matt` и на вызове Skill tool с именем без `worfy:`.

### Где skills находят tracker (Ticket 01, «подтвердить»)

`setup-matt-pocock-skills` пишет в репозиторий проекта блок `## Agent skills` в `CLAUDE.md` или `AGENTS.md` и папку
`docs/agents/`. worfy так не делает: в Silent mode следов workflow в репозитории нет, а tracker у worfy один — папка
Ticket-ов Profile-а (`tickets.root`, `tickets.path`).

**Рекомендация:** скопированные skills вместо «run /setup-matt-pocock-skills» говорят: «Tracker — папка Ticket-ов
Profile-а worfy: `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field tickets.root`; формат и операции — `bin/TICKETS.md`,
раздел «Wayfinding operations». Profile-а нет — предложи `/worfy:connect-project`». Раздел в `TICKETS.md` переводит
операции wayfinder на язык worfy: map — `map.md`; Ticket карты — `issues/NN-slug.md` с `Type:`
(`research`/`prototype`/`grilling`/`task`) вместо метки `wayfinder:<type>`; claim и resolve — `bin/ticket claim` и
`bin/ticket done` (слово `done`, не `resolved`); метки триажа (`ready-for-agent`) — нет, Ticket в `open`; glossary —
файл `docs.context` Profile-а вместо `GLOSSARY.md`. `connect-project` в отчёте называет найденный tracker и glossary,
а если в проекте уже есть `docs/agents/issue-tracker.md` от `setup-matt-pocock-skills` с GitHub или GitLab, говорит,
что skills worfy работают только с папкой Ticket-ов. Файлов в репозиторий проекта `connect-project` не пишет.
**Подтвердить.**

### Уход `retro` worfy (Ticket 02)

- Удаляется `harness/hooks/session-end.mjs` целиком: он только пишет строку в `<profile>/state/pending-retro.log` для
  напоминания (`:1-8`, `:95-102`). Из `harness/hooks/hooks.json` уходит его запись `SessionEnd` (`:124-133`); запись
  `bin/worktree-lock release` в том же событии остаётся. `hooks.json` общий для Claude Code и Codex — Codex тоже
  перестаёт его звать.
- `harness/hooks/session-start.mjs` теряет п. 4 (напоминание, `:20-21`, `:139`, `:205-215`); п. 0–3 не меняются.
  Profile без `session.inject_rules: true` снова печатает пустой ответ, даже если в нём осталось
  `session.retro_reminder_after`.
- `harness/skills/retro/` — содержимое заменяется на `retro` Matt Pocock (`SKILL.md`, `agents/openai.yaml`); путь
  тот же. `test/contract/harness-retro-skill.test.ts` (test шагов старого skill-а) удаляется.
- **Поле `session.retro_reminder_after`.** Контракт Profile (`harness/profiles/README.md:208`) отмечает его как
  снятое: «ignored if present». Код приложения поле не читает: grep `retro_reminder_after` по `src/` — пусто; Profile
  читает `src/main/workflow/profile.ts` схемами zod без `.strict()`, лишние ключи там не ошибка. Значит «код Profile в
  приложении» — это test, а не правка: Profile с полем загружается, как раньше. `bin/profile` и
  `bin/project-connect --schema-only` поле тоже не проверяют (grep по `harness/bin` — пусто); test закрепляет и это.
- Файлы `state/pending-retro.log` в Profile-ах на машинах остаются: это данные пользователя, worfy их не удаляет.
- Строка `HANDOFF.md` про первый `retro` на настоящем сбое (ручной пункт worfy-reliability 09) уходит: того skill-а
  больше нет.

### Зависимость больше не ставится (Ticket 03)

- `harness/.claude-plugin/plugin.json` — без `dependencies`. Механизм ADR-0059 в коде остаётся (на будущую зависимость):
  `install.ts` и `codex-install.ts` с пустым списком просто не строят команд зависимости, строка первого запуска
  «Plugin dependencies» показывает `none` (`src/main/first-run/checks.ts:602-604`). Test-ы установщика, которым нужна
  зависимость, берут fixture-копию Harness с одной зависимостью вместо настоящего `harness/`.
- `scripts/eval-harness.mjs` копирует Harness «без dependencies» (`:13-15`, `:371`) — комментарий и строка вывода
  меняются: зависимости больше нет, копия остаётся (её правит `HARNESS_DIR`).

### Удаление plugin-а, поставленного worfy (Ticket 03, «подтвердить»)

**Записывает ли worfy, кто поставил plugin, — нет.** Проверено по коду:

- Claude Code: установщик зовёт `claude plugin install <id> --scope user` (`src/main/harness/install.ts:826`) и ничего
  о зависимости не записывает: сам он пишет только копию Harness, остальное — команды Claude Code (`install.ts:23`).
- Codex: запись `harness-codex.json` в папке данных worfy (`src/main/ipc/harness.ts:109`) хранит только
  `{ version }` (`codex-install.ts:415-418`).

Что есть у Claude Code: `plugins/installed_plugins.json` хранит у каждого plugin-а `installedAt` и `lastUpdated`.
worfy ставил зависимость только в одном месте — сразу перед первой установкой `worfy`, в том же диалоге (ADR-0059,
п. 4): тогда `installedAt` зависимости лежит за секунды до `installedAt` у `worfy@worfy-harness`. Plugin, который
пользователь поставил сам до worfy, worfy не трогал — он уже был в `plugin list`. На Mac владельца так и есть:
`mattpocock-skills` поставлен за два месяца до `worfy` — по правилу ниже он остаётся.

**Рекомендация (б):**

- (а) Маркер «поставил worfy» с этой версии — не помогает: этот же Ticket убирает установку зависимости, новых
  установок не будет, а старые маркера не имеют.
- **(б) Окно времени по записи Claude Code — рекомендую.** Plugin `mattpocock-skills@claude-plugins-official` удаляется
  (`claude plugin uninstall … --scope user`), если его `installedAt` не раньше чем за 10 минут до `installedAt` у
  `worfy@worfy-harness` и не позже его. Иначе — остаётся. Случай, когда worfy доставил зависимость позже (Retry после
  ошибки шага `dependency install`, ADR-0059, п. 5), правило не узнаёт и plugin оставляет: ошибка в безопасную сторону.
  Ложное срабатывание — пользователь сам поставил plugin меньше чем за 10 минут до первой установки worfy; тогда
  worfy зависимость не ставил бы, а plugin удалится. Против этого — строка в итоге Update Harness: что удалено и
  команда, чтобы вернуть.
- (в) Спросить пользователя один раз в окне: «worfy больше не нужен plugin `mattpocock-skills`. Удалить?». Безопасно,
  но лишнее окно на каждой машине, где plugin есть.
- (г) Не удалять никогда. Тогда у пользователя две копии каждого skill-а: `mattpocock-skills:grilling` и
  `worfy:grilling`.

Где и когда: после того как Harness новой версии встал — в установке после Update (`src/main/update/harness-after-update.ts`,
без второго окна, ADR-0089) и в Update Harness из toolbar. Никогда до установки `worfy`: иначе между шагами у
пользователя нет ни одной копии skills. Ошибка удаления — строка в итоге, Harness остаётся установленным. Marketplace
`claude-plugins-official` остаётся: в нём могут быть другие plugin-ы пользователя. Канал помечен `local` (ADR-0052,
п. 6): Linked machine чужой plugin не удаляет.

**Codex.** Своей даты установки plugin-а в записи worfy нет, а читает ли worfy дату у Codex — не проверено. Рекомендую:
правило (б), если Codex отдаёт время установки; иначе plugin в Codex остаётся. Команду удаления Ticket берёт из
документации и протокола Codex в репозитории, настоящий Codex не запускает. **Подтвердить (б) и вариант для Codex.**

### Документация, ADR, eval-ы (Ticket-ы 04, 05)

- Поправка ADR-0059 в разделе `## Amendments`: plugin `worfy` больше не объявляет `mattpocock-skills`; skills взяты
  копией 1.3.1 внутрь plugin-а (отвергнутый в «Considered Options» вариант «перенести нужные skills в Harness» принят
  2026-11-07); п. 8 «не удаляет её» меняется правилом удаления выше. Короткие поправки со ссылкой — ADR-0047, п. 5 и
  ADR-0094 (строка про отдельный plugin зависимости в Codex).
- Eval-ы: новые случаи в `harness/evals/` на переименованные skills и ссылки между ними; платный прогон — сначала
  `--dry-run`, затем `--max-cost-usd 30`. `scripts/eval-harness.mjs` сам не поднимает бюджет выше `BUDGET_USD = 30`
  (`:81`), так что cap ниже 100 USD выполняется.

## Решено без владельца

1. **Плоская раскладка и прежние имена.** `harness/skills/<имя>/`, имена skills как у 1.3.1. Раздела `engineering/` и
   `productivity/` в plugin-е нет; откуда skill — пишет `THIRD_PARTY.md`.
2. **Правим только ссылки.** Текст skills, кроме ссылок, остаётся 1.3.1: так diff с upstream при ручном обновлении
   читается. Расхождения с языком worfy (`GLOSSARY.md`, метки, слово `resolved`) переводит один раздел
   `TICKETS.md`, а не правки в каждом skill-е.
3. **Слова Stage не меняются.** `epic-status` и `epic-board` пишут Stage словами `/to-spec`, `/wayfinder`,
   `/to-tickets`, `/implement` (TICKETS.md, «Stage»). Это имена этапов, а не команды; их видят test-ы и worfy.
4. **Механизм зависимостей ADR-0059 остаётся** в коде, с пустым списком.
5. **`state/pending-retro.log` и marketplace `claude-plugins-official` не удаляются** — данные и настройки
   пользователя.
6. **Тексты в коде и plugin-е — английские** (ADR-0074), документы — русские.
7. **Поле Profile-а `lessons`** и индекс уроков в SessionStart остаются. Уроки и дальше пишут закрытие Ticket-а
   (`harness/skills/ship-ticket/step-11-close.md:104-105`) и конец Wave (`harness/skills/epic-wave/SKILL.md:1629`);
   уходит только отдельный путь через `retro` worfy (см. «Риски», 3).

## Ticket-ы

- **01 — Skills Matt Pocock в plugin worfy: копия, лицензия, ссылки.** 19 skills (без `retro`), `THIRD_PARTY.md`,
  `LICENSE`, ссылки `worfy:`, раздел «Wayfinding operations» в `TICKETS.md`, `connect-project`, `tickets-to-tasks`.
  Blocked by: —. Не платформенный. Глубина ревью — `medium`.
- **02 — Убрать `retro` worfy и напоминание; `retro` Matt Pocock на его место.** Blocked by: 01. Платформенный (hook-и
  Harness на Claude Code и Codex). Глубина ревью — `high`.
- **03 — Не ставить `mattpocock-skills`; убрать поставленный worfy.** Claude Code и Codex. Blocked by: 01.
  Платформенный (установщик). Глубина ревью — `high`: удаление чужого plugin-а — разрушающее действие.
- **04 — Документация и поправки ADR.** Страницы Feature, `harness/README.md`, ADR-0059, -0047, -0094. Blocked by: 02, 03.
  Не платформенный. Глубина ревью — `low` и проверка утверждений страниц Feature против кода.
- **05 — Eval-ы skills и проверка на Stable copy.** Blocked by: 01, 02, 03. Не платформенный. Глубина ревью — `low`.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave). Ticket с большим
номером при общем файле уходит дальше (`filesOverlap`, `src/shared/workflow/waves.ts`).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/skills/code-review/**`, `harness/skills/codebase-design/**`, `harness/skills/diagnosing-bugs/**`, `harness/skills/domain-modeling/**`, `harness/skills/grill-with-docs/**`, `harness/skills/improve-codebase-architecture/**`, `harness/skills/prototype/**`, `harness/skills/research/**`, `harness/skills/tdd/**`, `harness/skills/to-spec/**`, `harness/skills/to-tickets/**`, `harness/skills/wayfinder/**`, `harness/skills/grill-me/**`, `harness/skills/grilling/**`, `harness/skills/handoff/**`, `harness/skills/teach/**`, `harness/skills/to-questionnaire/**`, `harness/skills/wait-what/**`, `harness/skills/writing-for-agents/**`, `harness/skills/THIRD_PARTY.md`, `harness/skills/LICENSE.mattpocock-skills`, `harness/skills/connect-project/SKILL.md`, `harness/skills/tickets-to-tasks/SKILL.md`, `harness/bin/TICKETS.md`, `harness/evals/lib/coverage.json`, `test/contract/harness-third-party-skills.test.ts` | 1 |
| 02 | `harness/hooks/session-end.mjs`, `harness/hooks/session-start.mjs`, `harness/hooks/hooks.json`, `harness/hooks/hook-stdin.mjs`, `harness/hooks/tests/session-hooks.test.sh`, `harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/tests/harness-home.test.sh`, `harness/skills/retro/**`, `harness/skills/THIRD_PARTY.md`, `harness/profiles/README.md`, `harness/evals/lib/coverage.json`, `test/contract/harness-retro-skill.test.ts`, `test/contract/harness-hook-stdin.test.ts`, `test/contract/harness-codex-hooks.test.ts`, `test/contract/codex-parity.test.ts`, `test/contract/workflow-profile.test.ts`, `HANDOFF.md` | 2 |
| 03 | `harness/.claude-plugin/plugin.json`, `src/main/harness/install.ts`, `src/main/harness/codex-install.ts`, `src/main/harness/dependency-cleanup.ts`, `src/main/update/harness-after-update.ts`, `src/main/ipc/harness.ts`, `src/shared/ipc/harness.ts`, `src/shared/agent/subagent-type.ts`, `scripts/eval-harness.mjs`, `test/contract/harness-plugin.test.ts`, `test/contract/harness-install.test.ts`, `test/contract/harness-codex-install.test.ts`, `test/contract/harness-dependency-cleanup.test.ts`, `test/contract/first-run-checks.test.ts`, `test/unit/harness-codex-manifest.test.ts`, `test/unit/harness-status.test.tsx`, `test/unit/subagent-type.test.ts`, `test/e2e/harness-install.spec.ts`, `test/e2e/first-run.spec.ts`, `test/e2e/claude-plugin-stub.ts`, `test/acceptance/e3.spec.ts`, `test/fixtures/first-run-tools/README.md` | 2 |
| 04 | `docs/features/skills-agents-and-hooks.md`, `docs/features/ru/skills-agents-and-hooks.md`, `docs/features/harness.md`, `docs/features/ru/harness.md`, `harness/README.md`, `docs/adr/0059-installer-installs-plugin-dependencies.md`, `docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md`, `docs/adr/0094-vendor-seam.md` | 3 |
| 05 | `harness/evals/skill-grilling-trigger/**`, `harness/evals/skill-wayfinder-refs/**`, `harness/evals/skill-to-tickets-format/**`, `harness/evals/skill-code-review/**`, `harness/evals/lib/coverage.json`, `test/contract/harness-evals.test.ts`, `.scratch/worfy-skills/evidence/05-*` | 3 |

- **Wave 1 — 01.** Skills должны быть в plugin-е раньше, чем уйдёт зависимость: иначе между PR-ами у пользователя
  без `mattpocock-skills` нет ни одной копии.
- **Wave 2 — 02, 03.** Оба ждут 01 (02 — `THIRD_PARTY.md` и `coverage.json`; 03 — skills внутри plugin-а). Общих
  файлов нет. Оба платформенные: merge после Windows verdict.
- **Wave 3 — 04, 05.** 04 описывает сделанное в 02 и 03; 05 гоняет eval-ы на итоговом plugin-е. Общих файлов нет.

Имена новых файлов test-ов и случаев eval — предложение; implementer может назвать иначе, не задевая чужих Ticket-ов
своей Wave. Пути существующих файлов сверены с `main` 2026-11-07 (`0451a4fde`).

## Не в этом Epic-е

- **Синхронизация с upstream** — ни автоматическая, ни по расписанию (решение владельца, п. 5).
- **Skills `misc/*`, `in-progress/*`, `ask-matt`, `setup-matt-pocock-skills`** (решение владельца, п. 1).
- **Правки содержания взятых skills** сверх ссылок: язык worfy подстраивает `TICKETS.md`.
- **Tracker на GitHub или GitLab** для skills worfy: у Harness tracker — папка Ticket-ов.
- **Отключение копии пользователя** (`mattpocock-skills`, который он поставил сам) в Session-ах worfy: это уже делает
  поле Profile-а `skills.allowed`, если пользователь его задал.
- **Настоящий Claude Code или Codex** в test-ах: только stub `claude` и fake Codex; настоящий Claude Code — только в
  платном eval Ticket-а 05.
- **Epic [worfy-human-review](../worfy-human-review/map.md)** — после этого.

## Риски

1. **Удалён plugin, который пользователь поставил сам.** Правило окна времени (б) ошибается, только если пользователь
   поставил plugin меньше чем за 10 минут до первой установки worfy. Итог Update Harness называет удаление и команду
   возврата. Test: plugin старше окна — не удаляется; ошибка чтения даты — не удаляется.
2. **Две копии skills.** Пока у пользователя остаётся свой `mattpocock-skills`, модель видит `grilling` дважды и может
   взять чужую версию. Вред — другая версия текста, не поломка; `skills.allowed` Profile-а убирает чужую копию из
   Session-ов worfy.
3. **Меньше уроков.** `retro` worfy был ручным путём записать урок после отладки вне Ticket-а. Дальше уроки пишут
   закрытие Ticket-а и конец Wave; `retro` Matt Pocock предлагает правки окружения агента и сам ничего не пишет.
4. **Codex и имена `worfy:<skill>`.** В Claude Code skill из plugin-а вызывается как `worfy:<имя>`; как Codex называет
   skill из plugin-а при вызове по имени — не проверено. Ticket 01 сверяет по протоколу Codex в репозитории
   (`src/main/vendors/codex/protocol/`) и записям `test/contract/codex-compat.test.ts`;
   если у Codex имя без префикса, ссылки остаются `worfy:` (Claude Code — основной Vendor), а расхождение пишется в
   «Итог» 01.
5. **Шаблоны bash внутри plugin-а.** `diagnosing-bugs/scripts/hitl-loop.template.sh` — шаблон, который агент копирует
   в проект, а не скрипт Harness; `.gitattributes` держит `harness/` целиком в LF. ADR-0055 касается скриптов
   `harness/bin` и `harness/hooks` (`test/contract/harness-node-only.test.ts`), skills он не трогает.
6. **Hook-и Codex просят подтверждения заново.** Ticket 02 меняет `hooks.json`; Codex после обновления Harness ждёт,
   что их подтвердят (`src/main/vendors/codex/harness-hooks.ts`) — как после любого обновления hook-ов.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-skills/<NN>`, worktree `.claude/worktrees/<NN>`. Конец Ticket-а — `pr-green-ci`: PR, зелёный `ci-ok`
  (Linux, macOS и Windows job-ы), отметка `review`. Глубина ревью — в строке каждого Ticket-а; 02 и 03 — не ниже `high`.
- **Платформенные PR** (02, 03): Windows verdict до merge (ADR-0056).
- **Сначала падающий test**: показать красный на старом поведении, это пишется в «Итог».
- **Без токенов и без чужих учётных записей.** `WORFY_AGENT=fake`, `WORFY_CODEX=fake` с временным `CODEX_HOME`, stub
  `claude` (`test/fixtures/first-run-tools/`). Ни один test не пишет в настоящий `~/.claude` или `~/.codex`.
  Исключение — платный eval Ticket-а 05, на учётной записи владельца, по его заранее данному разрешению.
- **Копия Matt Pocock только читается.** Источник копирования — установленная копия 1.3.1 или upstream на commit-е
  `49dd158d`; результат сверяется по хэшам файлов в «Итог» 01.
- Скрипты Node, не bash (ADR-0055); всё работает на Windows (ADR-0054). Timeout-ы — через `ms()` (`test/time-scale.ts`).
- Flaky test — Quarantine со сроком (`test/quarantine.ts`). Low findings не становятся Ticket-ами.
- Репозиторий публичный: в fixture-ах и логах нет путей домашней папки, имён машин, id учётных записей.
- Язык: документы — русские, термины — латиницей из `CONTEXT.md`; skills, код и комментарии — английские (ADR-0074).

## Вопросы владельцу

Рекомендация — первой. Пункты помечены «подтвердить» и в тексте выше.

1. **Q1. `pr`** — (а) не брать; (б) взять только ручным вызовом. **Рекомендую (а).**
2. **Q2. `wizard`** — (а) не брать; (б) взять только ручным вызовом. **Рекомендую (а).**
3. **Q3. `triage`** — (а) не брать; (б) взять и научить писать `Status:` словами worfy. **Рекомендую (а).**
4. **Q4. `implement` и `implement-spec`** — (а) не брать; (б) взять. **Рекомендую (а).**
5. **Q5. Кто поставил `mattpocock-skills`** — (б) окно 10 минут по `installedAt`; (в) спросить в окне; (г) не удалять.
   **Рекомендую (б).** Codex — (б), если Codex отдаёт время установки, иначе не удалять.
6. **Q6. Где skills находят tracker** — (а) раздел «Wayfinding operations» в `harness/bin/TICKETS.md` и
   `tickets.root` Profile-а, `connect-project` ничего не пишет в репозиторий проекта; (б) `connect-project` пишет блок
   `## Agent skills` в `CLAUDE.md` проекта, как `setup-matt-pocock-skills`. **Рекомендую (а).**

## Готово, когда

- [ ] 19 skills (01) и `retro` (02) лежат в `harness/skills/`, текст совпадает с 1.3.1, кроме перечисленных в
      `THIRD_PARTY.md` правок ссылок; `LICENSE` и строка авторства рядом.
- [ ] Ни один файл `harness/` не ссылается на `mattpocock-skills`, `setup-matt-pocock-skills`, `ask-matt`; каждый
      вызов Skill tool по имени — `worfy:<имя>` (01).
- [ ] Свой `retro` worfy, `session-end.mjs` и напоминание удалены; Profile с `session.retro_reminder_after` работает
      (02).
- [ ] worfy не ставит `mattpocock-skills`; после Update plugin, поставленный worfy, удалён, поставленный
      пользователем — на месте (03).
- [ ] Страницы Feature, `harness/README.md`, поправки ADR-0059, -0047, -0094 (04).
- [ ] Eval-ы на переименованные skills прошли, расход записан; на Stable copy владельца `/worfy:grilling` и
      `/worfy:code-review` есть в списке slash-команд (05).
