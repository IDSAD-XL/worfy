# 0042 — Profile целиком на машине; Full mode и Silent mode; Workflow folder (заменяет ADR-0020)
Дата: 2026-10-07. Статус: принят.

**Заменяет ADR-0020** (Profile из двух частей, общая — PR-ом в репозиторий). Почему — в
контексте ниже и в разделе «Что меняется в прежних ADR».

**Контекст.** ADR-0020 разделил Profile на две части. Общая (команды проверки, где лежат Ticket-ы,
ветки, линзы ревью, MCP-серверы) попадала в репозиторий Project-а PR-ом агента. Личная (пути,
папка worktree, аккаунт GitHub) оставалась на машине. Где именно лежат обе части, ADR-0020
оставил Epic-у E3 `worfy-harness` («Harness как часть worfy»).

В Session проектирования E3 владелец 2026-10-07 сначала потребовал не оставлять в репозитории
никаких следов (вопрос Q11), а потом уточнил, что нужны два режима (Q11'):

> «не все работают с одинаковыми сетапами, над разными задачами… лишние файлы будут вводить в
> заблуждение. Тикеты не должны попадать в репозиторий, ибо по сути являются внутренней
> реализацией… Для аукциона нормально оставить полный, а для атакамы нужен silent.»

Общая часть Profile в репозитории — как раз такой лишний файл. Поэтому ADR-0020 заменяется
целиком, а не правится: принятые ADR не правятся.

Факты на 2026-10-07:

- Profile лежит в `~/.claude/profiles/<имя>/` (`profile.json` и `rules.md`) и находится через
  реестр Gate. В нём есть пути к самому Harness: `tickets.status_tool`, `tickets.epic_status`,
  `workflow.preflight`, `numbering.reserve_with`. Поле `mcp.allowed` (ADR-0021) worfy уже читает
  (`src/main/workflow/profile.ts:22`), но в контракте Profile (`profiles/README.md`) его нет.
- Atakama уже почти Silent: её `.scratch/` и `HANDOFF.md` лежат в папке над тремя
  репозиториями, вне git (ADR-0018).
- В Auction под git 822 файла `.scratch/`; worktree лежат внутри репозитория, а
  `.claude/worktrees/` стоит в его `.gitignore`.
- Файлы из `.claude/rules/` репозитория Claude Code грузит сам — любому, кто открыл репозиторий в
  Claude Code.

Решения владельца по вопросам Q10, Q11, Q11', Q17 и Q23–Q28 той же Session.

**Решение.**

1. **Profile целиком на машине** — `~/.claude/worfy-harness/projects/<project>/` (папка
   состояния Harness, ADR-0040). В репозитории Project-а Profile нет, PR с Profile нет. Правила
   Project-а (`rules.md`) подмешивает в Session только Harness (сегодня это делает
   `hooks/session-start.sh` при `session.inject_rules: true`) — и только там, где Harness
   установлен. В `.claude/rules/` репозитория они не кладутся.
2. **Profile schema 2.**
   - Поля с путями Harness уходят: `tickets.status_tool`, `tickets.epic_status`,
     `workflow.preflight`, `numbering.reserve_with` — это константы Harness, а не факты о
     Project-е.
   - `mcp.allowed` входит в контракт.
   - Новые поля: `mode`, `language.docs` (язык документов Project-а, ADR-0044), `attribution`.
   - Старый формат (schema 1) читается на время перехода. Контракт пишет Ticket 11, перенос
     Profile-ов в schema 2 — Ticket 14.
3. **Два режима Project-а** — поле Profile `mode: full | silent`.
   - **Full mode** — файлы workflow (Ticket-ы, spec Epic-а, HANDOFF, ADR, уроки) лежат в
     репозитории. Так сейчас работают worfy и Auction.
   - **Silent mode** — файлы workflow лежат вне git; в репозитории от workflow не остаётся
     ничего.
4. **Workflow folder** — папка, где лежат файлы workflow Project-а. В Full mode это корень
   репозитория. В Silent mode её выбирает пользователь при подключении Project-а. По умолчанию —
   `~/.claude/worfy-harness/projects/<project>/workflow/`, локальный git-репозиторий для истории;
   свой private remote пользователь может добавить сам. У Project-а над несколькими репозиториями
   (ADR-0018) по умолчанию — папка над ними: у Atakama её `.scratch/` и `HANDOFF.md` остаются на
   месте.
5. **Silent mode не оставляет следов в репозитории.**
   - Ветки, коммиты, PR и комментарии в коде выглядят как обычная работа. Ветка называется по
     смыслу (`fix/lot-withdraw-button`). В них нет номеров Ticket-ов и ADR, имён Epic-ов и путей к
     Workflow folder. PR описывает само изменение.
   - Свои документы — ADR, глоссарий, уроки, снимки-доказательства — Harness пишет только в
     Workflow folder. Документы проекта в репозитории для него только для чтения. Исключение —
     Ticket, прямая цель которого — документ для команды (например, README функции).
   - `ticket claim` и `ticket done` пишут Status сразу в Workflow folder. Status у Ticket-а один:
     показа «Status из ветки поверх main» (ADR-0033) в Silent mode нет.
6. **Атрибуция** — поле Profile `attribution: on | off`: ставить ли в коммиты и PR строки
   атрибуции Claude. По умолчанию `on`; значение для каждого Project-а ставит владелец.
7. **Режим по умолчанию — Silent.** Full выбирается при подключении явно. worfy и Auction — Full,
   Atakama — Silent. Смены режима у подключённого Project-а в E3 нет.
8. **Worktree новых Project-ов — вне репозитория:** `~/.claude/worfy-harness/worktrees/<project>/`.
   У worfy и Auction worktree остаются в нынешних папках (`.claude/worktrees/`).
9. **Аккаунт GitHub — по-прежнему свойство Project-а**, как решил ADR-0020: поле Profile,
   `GH_TOKEN` этого аккаунта (`gh auth token -u <аккаунт>`) во всём, что делается для Project-а;
   глобальный `gh` не переключается. Как токен доходит до Session — решение владельца по Q21: hook
   `SessionStart` через `CLAUDE_ENV_FILE`; работает ли так, проверяет Ticket 01 (итог —
   ADR-0048).
10. **Подключение Project-а** (Ticket-ы 24 и 25):
    1. пользователь выбирает папку (ADR-0018);
    2. выбирает режим, а для Silent mode — Workflow folder;
    3. worfy проверяет, что Harness установлен (ADR-0040);
    4. агентская Session пишет черновик Profile;
    5. пользователь подтверждает черновик в форме;
    6. пользователь выбирает аккаунт GitHub из `gh auth status`; подходящего нет — worfy
       запускает `gh auth login` в Terminal (Node с shell-сессией пользователя), вход делает
       пользователь;
    7. Profile записывается на машину;
    8. Project регистрируется в Gate.

    Project без Ticket-ов подключается с пустым Canvas и предложением завести первый Epic
    (ADR-0018).

**Что меняется в прежних ADR.**

- **ADR-0020 заменён целиком.** Довод — цитата владельца выше: файлы workflow и Profile — внутренняя
  реализация, и в репозитории, где люди работают с разными сетапами, они вводят в заблуждение.
  Из ADR-0020 остаются аккаунт GitHub как свойство Project-а и `GH_TOKEN` (пункт 9) и шаги
  подключения без PR (пункт 10).
- ADR-0021 (MCP-серверы по списку в Profile): список `mcp.allowed` лежит в Profile на машине, а не
  в общей части в репозитории.
- ADR-0005 (worfy ничего не пишет в репозитории Project-ов): фраза «для остальных участников
  репозитория worfy невидим», которую ADR-0020 признал неточной, снова верна для Profile. В Full
  mode участники видят файлы workflow, как и до ADR-0020; в Silent mode — ничего.
- ADR-0018 (Project — папка с workflow): папка Project-а и Workflow folder могут не совпадать.
  Silent Project из одного репозитория — это сам репозиторий, а его файлы workflow лежат в
  Workflow folder вне него. У Project-а над несколькими репозиториями по умолчанию они совпадают.
- ADR-0002 (worfy — вид на workflow): источник правды о работе — файлы в Workflow folder
  Project-а.

**Последствия.**

- Цена, которую владелец принял: на второй машине или у коллеги Profile заново пишет агентская
  Session при подключении. Profile-ы разных машин могут разойтись — это тот довод, по которому
  ADR-0020 отверг «весь Profile на машине».
- Правила Project-а действуют только в Session-ах с Harness. Кто открыл репозиторий в Claude Code
  без Harness, их не получает — так и задумано.
- В Silent mode с Workflow folder по умолчанию история Ticket-ов, ADR и уроков живёт только в
  локальном git на этой машине, пока пользователь не добавит свой remote.
- В Silent mode номера Ticket-а нет в имени ветки. Где Harness и worfy хранят связь ветки с
  Ticket-ом, решает Ticket 22 (Silent mode в Harness); как worfy читает Workflow folder —
  Ticket 23.
- Worktree новых Project-ов не попадают в test runner и linter проекта и не требуют правки
  `.gitignore`.
- Auction остаётся в Full mode: его Profile переносится на машину, файлы `.scratch/` остаются под
  git. Проверка — только чтение: в репозитории Auction ничего не пишется.

## Considered Options

- **Profile целиком на машине, режимы Full и Silent, Silent по умолчанию** (выбрано).
- **Общая часть Profile в репозитории PR-ом, личная на машине (ADR-0020 как есть).** Отвергнуто
  владельцем: Profile в репозитории — след workflow, а «лишние файлы будут вводить в
  заблуждение».
- **Один режим для всех — без следов в репозитории.** Отвергнуто: для Auction владелец оставляет
  Full mode; его 822 файла `.scratch/` и история под git остаются как есть.
- **Правила Project-а в `.claude/rules/` репозитория.** Отвергнуто: Claude Code грузит их сам
  каждому, кто открыл репозиторий, — и это снова файл workflow в репозитории.
- **Worktree внутри репозитория, скрытые через `.git/info/exclude`.** Отвергнуто: test runner и
  linter проекта заходят в `.claude/worktrees/`.
- **Full mode по умолчанию.** Отвергнуто: по словам владельца, Ticket-ы — внутренняя реализация и
  не должны попадать в репозиторий, пока пользователь явно не выбрал Full.
