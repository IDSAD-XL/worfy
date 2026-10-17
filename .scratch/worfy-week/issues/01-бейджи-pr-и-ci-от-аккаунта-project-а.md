# 01 — Бейджи PR и CI идут от аккаунта GitHub Project-а

Type: task
Status: done 2026-10-07
PR: #81
Blocked by: —
Source: решение владельца 2026-10-07 (вопросы 3 и 4); HANDOFF 2026-10-06, «Ждёт владельца», пункт [med] о бейджах «gh unavailable»; ревью Ticket-а 17 `worfy-daily`; [ADR-0020](../../../docs/adr/0020-profile-shared-and-personal-parts.md); [spec.md](../spec.md), этап 1

## Что происходит

- Бейджи PR и CI на Node-ах Ticket-ов Project-а IDSAD-XL/worfy всегда показывают «gh unavailable».
- `appGhRunner` в `src/main/ipc/checks.ts:35-38` запускает `gh` с окружением login shell
  (ADR-0007), то есть от глобального аккаунта gh. Глобальный аккаунт на машине владельца —
  Oleksii-O-Atakama, ему репозиторий IDSAD-XL/worfy не виден.
- Ревью Ticket-а 17 `worfy-daily` воспроизвело: `gh pr list -R IDSAD-XL/worfy` без `GH_TOKEN` —
  «Could not resolve to a Repository», с `GH_TOKEN` аккаунта IDSAD-XL — PR виден.
- [ADR-0020](../../../docs/adr/0020-profile-shared-and-personal-parts.md): worfy работает с Project
  через `GH_TOKEN` аккаунта Project-а и глобальный `gh` не переключает. Целиком ADR-0020 — этап E3.
  Этот Ticket берёт из него то, что нужно для недели работы сейчас.

## Что делаем

1. **Аккаунт — из Profile, только чтение.** worfy читает поле `github.account`:
   `~/.claude/bin/profile -C <корень Project-а> --field github.account`. Скрипт и коды выхода те же,
   что у списка MCP-серверов в `src/main/workflow/profile.ts`: 0 — значение, 3 — Project не
   зарегистрирован, 4 — поля нет. Сейчас у Project-ов worfy и Auction там `IDSAD-XL`. Profile worfy
   не пишет.
2. **Токен — у gh.** Перед своим вызовом `gh` для Project-а worfy берёт токен командой
   `gh auth token -u <аккаунт>` (окружение login shell, как сейчас) и запускает `gh` с
   `GH_TOKEN=<токен>`. Правило — для каждого вызова `gh`, который делает сам worfy. Сейчас такой
   вызов один: `gh pr list` в `PrTracker` (`src/main/github/prs.ts:202`, `:220`) через
   `appGhRunner`. Исполнитель проверяет поиском по `src/`, что других нет, и пишет в «Итог», что
   нашёл.
3. **Глобальный аккаунт не трогается.** Никаких `gh auth switch`, `gh auth login` и записи в
   конфиг gh.
4. **Нет аккаунта — как сейчас.** Код 3 или 4, значение `null`, нет скрипта `profile`, сбой
   скрипта — `gh` идёт с окружением login shell без `GH_TOKEN` от worfy, как до Ticket-а. Причина —
   одна строка в лог, как у списка MCP-серверов.
5. **Аккаунт есть, токена нет.** `gh auth token -u <аккаунт>` упал (нет входа под этим
   аккаунтом). Бейдж — «gh unavailable» с причиной, где названы аккаунт и `gh auth login`. От
   глобального аккаунта worfy в этом случае не идёт: тот дал бы чужой ответ или тот же отказ.
6. **Токен не выходит наружу.** Он есть только в окружении дочернего процесса `gh`: не в логе, не
   в журнале Autopilot, не в снимке `checks`, который уходит renderer-у, не в тексте ошибки.

Брать токен на каждый вызов или держать его на время опроса — решает исполнитель. Решение и
причина — в «Итог». `gh pr list` идёт не чаще раза в 60 с (`src/main/github/prs.ts:3`).

ADR не нужен: решение уже принято в ADR-0020, Ticket выполняет его часть.

**Не входит (E3):** выбор аккаунта в UI при подключении Project-а (ADR-0020, шаг 5); `GH_TOKEN` в
окружении Session-ов агентов (ADR-0020, ADR-0007); Profile из двух частей.

## Готово, когда

- [x] У Project-а с `github.account` в Profile каждый вызов `gh`, который делает worfy, идёт с `GH_TOKEN` из `gh auth token -u <аккаунт>`. Проверяет contract test с подменённым `gh` и подменённым скриптом `profile`.
- [x] Подменённый `gh` видит от worfy только `auth token -u <аккаунт>` и `pr list`: ни `auth switch`, ни `auth login`, ни других команд, меняющих глобальный аккаунт.
- [x] Нет аккаунта в Profile (код 3, код 4, `null`, нет скрипта, сбой скрипта) — `gh` вызывается как до Ticket-а, без `GH_TOKEN` от worfy.
- [x] Аккаунт есть, а `gh auth token -u` упал — снимок `checks` несёт ошибку с именем аккаунта, и `gh pr list` от глобального аккаунта не вызывается.
- [x] Токена нет в снимке `checks` и в выводе лога.
- [x] (вручную) Stable copy, обновлённая после влития: на Canvas Project-а worfy у Ticket-ов с PR видны бейджи PR и CI, а не «gh unavailable»; номер PR и вердикт CI совпадают с `gh pr view <N> -R IDSAD-XL/worfy`. Как проверить: окно приложения. (Проверено 2026-10-07 на Stable copy из 6df9791 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).)

Ручной пункт агент проверяет, только если может посмотреть окно Stable copy. Если не может —
«не проверено: …» в «Итог» и пункт в HANDOFF, раздел «Ждёт владельца». Этот же пункт закрывает
ручную проверку (2) Ticket-а 17 `worfy-daily`: бейджи на живых PR сверяются с `gh pr view`.

## Тесты

Сначала падающий test — contract test в `test/contract/github-prs.test.ts`. Подменённый `gh`
пишет свои аргументы и значение `GH_TOKEN` в файл. Подменённый скрипт `profile` на
`--field github.account` отдаёт `IDSAD-XL`. Test ждёт `pr list` с `GH_TOKEN`, который вернул
`auth token -u IDSAD-XL`. На нынешнем main `GH_TOKEN` пуст — test красный. В «Итог» — как он падал.

- `test/contract/github-prs.test.ts` — случаи пунктов «Готово, когда» 1–5.
- `test/contract/workflow-profile.test.ts` — чтение `github.account` по исходам `profile`: код 0,
  3, 4, `null`, нет скрипта.
- e2e `test/e2e/checks-badges.spec.ts` идёт через подменённый `gh` (`WORFY_GH`). Если исполнитель
  меняет этот путь, он добавляет e2e в «Где в коде» и проверяет пересечения с Ticket-ами Wave.

## Где в коде

- `src/main/ipc/checks.ts`
- `src/main/github/prs.ts`
- `src/main/workflow/profile.ts`
- `test/contract/github-prs.test.ts`
- `test/contract/workflow-profile.test.ts`

Не меняются: `src/main/agent/env.ts` (окружение login shell берётся как есть), окружение
Session-ов агентов. Общих файлов с Ticket-ом 02 нет.

## Итог

**Что сделано.**
- `src/main/workflow/profile.ts` — `readGithubAccount()` читает `github.account` тем же скриптом
  `bin/profile -C <корень> --field github.account` и с теми же кодами выхода, что список
  MCP-серверов. Общая часть (запуск скрипта и разбор кодов 3, 4, сбоя, timeout-а, отсутствия
  скрипта) вынесена в `readField()`; поведение и тексты списка MCP-серверов не изменились. Нет
  аккаунта — код 3, код 4, `null`, пустое значение, нет скрипта, сбой скрипта, значение, которое не
  похоже на логин GitHub (например, `--hostname`), — `account: null` и одна строка в лог.
- `src/main/github/prs.ts` — `accountAuth()` берёт токен командой `gh auth token -u <аккаунт>`
  и отдаёт `GH_TOKEN` в окружение дочернего процесса `gh`. `GhRunner` принимает добавочное
  окружение на вызов. `PrTracker` спрашивает токен один раз на чтение, в котором `gh` вообще
  запускается: отказ в токене роняет первый вызов `gh` этого чтения, и `pr list` не идёт.
- `src/main/ipc/checks.ts` — `appPrTracker()` связывает всё вместе для приложения: Profile
  читается на каждом чтении с запуском `gh` (правка Profile действует без перезапуска), причина
  «аккаунта нет» пишется в лог один раз на Project, пока не сменится, а не раз в минуту.

**Решение: токен берётся на каждое чтение, а не держится на время опроса** (решено исполнителем,
как разрешает Ticket). Чтение с запуском `gh` бывает не чаще раза в 60 с на Project. Одно чтение —
один `gh auth token` на все его вызовы `gh` (список и до 10 поисков по ветке). Причина: токен
живёт только в окружении дочерних процессов одного чтения и в памяти между чтениями не лежит;
выход из аккаунта или новый вход в `gh` действуют со следующего чтения без перезапуска worfy.
Цена — один лишний быстрый локальный вызов `gh` раз в минуту.

**Другие вызовы `gh` в `src/`.** Поиск `grep -rnwE "gh" src` и по `execFile`/`spawn`: процесс
`gh` запускает только `ghRunner` в `src/main/github/prs.ts`, и его вызывает только `PrTracker`
(`pr list` списком и `pr list --head <ветка>`). Остальные упоминания `gh` — тексты бейджей в
renderer-е и схема `checks`.

**Как падал test до правки.** На `origin/main` test «the app's own checks handler…» в
`test/contract/github-prs.test.ts` (настоящий default export `src/main/ipc/checks.ts` с
`WORFY_GH` и `WORFY_CLAUDE_HOME` на подменённые `gh` и `bin/profile`) падал так:
`expected [ { token: null, …(1) } ] to deeply equal [ { …(2) } ]` — `pr list` шёл без
`GH_TOKEN`. Остальные новые test-ы падали на отсутствии `appPrTracker`.

**Test-ы.**
- `test/contract/github-prs.test.ts`, describe «gh with the Project's GitHub account» — пункты
  «Готово, когда» 1–5: каждый `pr list` с токеном аккаунта; `gh` видит только
  `auth token -u <аккаунт>` и `pr list`; пять случаев без аккаунта; собственный `GH_TOKEN` login
  shell проходит без аккаунта и заменяется при аккаунте; нет входа — ошибка с аккаунтом и
  `gh auth login`, `pr list` не вызывается, удвоенный интервал держится; токена нет в снимке
  `checks`, в логе и в console. Отдельно проверен отказ самого `gh pr list` с токеном: код выхода
  1, в stderr причина или пусто. Снимок несёт причину gh («HTTP 401: Bad credentials…» или
  «Command failed: …»), токена в нём нет. Мутант, который дописывает `GH_TOKEN` в текст ошибки
  `ghRunner`, краснеет на этом test-е.
- `test/contract/workflow-profile.test.ts`, describe «readGithubAccount» — коды 0, 3, 4, `null`,
  нет скрипта, неверные значения; настоящий запуск скрипта не пишет ни в Claude home, ни в Project.
- e2e `test/e2e/checks-badges.spec.ts` не менялся: в его временном Claude home нет `bin/profile`,
  поэтому аккаунта нет и `gh` идёт как раньше.

**Ручная проверка (окно приложения).** Сделана до влития, на сборке ветки, а не на Stable copy: собранное приложение ветки через `launchApp` (fake-агент, временные `WORFY_DATA_DIR` и
`WORFY_CLAUDE_HOME`), настоящий `gh` (`WORFY_GH=/opt/homebrew/bin/gh`), временный репозиторий с
origin `IDSAD-XL/worfy` и подменённый `bin/profile`; глобальный аккаунт gh — Oleksii-O-Atakama.
Под Ticket Node-ом на каждом снимке — панель, которую вставляет сам временный spec (подписана
«inserted by the evidence spec, not app UI»; в коде приложения её нет): в ней текст подсказки
бейджа, то есть `title`, а в нём `gh.error` из снимка `checks`. Рядом с каждым снимком — `.txt` из
того же запуска: ответ подменённого `bin/profile`, `title` строки бейджей и `title` бейджа
«gh unavailable».
- `bin/profile` отдаёт `IDSAD-XL`: на Ticket-е 01 «PR #81», «CI passing» и «REJECTED»; это
  совпадает с `gh pr view 81 -R IDSAD-XL/worfy` в ту же минуту: OPEN, check `SUCCESS`, первая
  строка комментария «REJECTED (round 1, head ccd9674)». В первом запуске, до конца CI, там было
  «CI running» при check `IN_PROGRESS`. [Снимок](../evidence/01-badges-account.png),
  [текст](../evidence/01-badges-account.txt).
- `bin/profile` с кодом 4 (аккаунта нет): «gh unavailable», в подсказке «GraphQL: Could not
  resolve to a Repository with the name 'IDSAD-XL/worfy'. (repository)» — так было до Ticket-а.
  [Снимок](../evidence/01-badges-no-account.png), [текст](../evidence/01-badges-no-account.txt).
- `bin/profile` отдаёт аккаунт, в который gh не вошёл: «gh unavailable», в подсказке «no gh login
  for nobody-logged-in-xyz, the Project's GitHub account: no oauth token found for github.com
  account nobody-logged-in-xyz; run `gh auth login` and sign in as nobody-logged-in-xyz».
  [Снимок](../evidence/01-badges-no-login.png), [текст](../evidence/01-badges-no-login.txt).

Пункт «(вручную)» проверен 2026-10-07 на Stable copy из 6df9791 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

**Ревью и влитие.** [PR #81](https://github.com/IDSAD-XL/worfy/pull/81), merge 3032865, один круг
доработки.
- Круг 1 — REJECTED (head ccd9674): [high] снимки `01-badges-no-login.png` и
  `01-badges-no-account.png` совпадали побайтно — на обоих только «gh unavailable», имя аккаунта
  и подсказка `gh auth login` были лишь в `title`; [low] test «токена нет в снимке» ронял
  `pr list` на разборе JSON, а не на отказе `gh`, и мутант, дописывающий `GH_TOKEN` в текст
  ошибки, выживал.
- Круг 2 — VERIFIED (f57313b..a468980): снимки пересняты с текстом ошибки на экране (вставленная
  панель подписана как не часть приложения, `src/` не менялся) и `.txt` рядом с каждым; test на
  отказ самого `gh pr list` ловит этот мутант. Пути утечки токена ревью не нашло.
- Перед мержем: `GATE_SCOPE=all gate.sh full` — exit 0 после rebase на d28ff1a (Ticket 02);
  rebase на aa372eb меняет только `.scratch/` и `HANDOFF.md`, после него gate fast и CI зелёные.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (второй круг ручных проверок).

**Бейджи PR и CI — проверка M19.** Stable copy из 6df9791 (pid 2455, CDP 9351), Canvas Project-а
worfy (CanvasForAI).

- Рамки `worfy-week` и `worfy-daily` развёрнуты, стопки done раскрыты щелчками мыши ОС, Canvas
  пролистан колесом. На всех 39 Ticket-ах (`worfy-daily` 01–32, `worfy-week` 01–07) видны бейджи
  «PR #N merged», «CI passing» и вердикт. Бейджа «gh unavailable» нет ни на одном экране.
- Эталон — `gh pr view` от аккаунта IDSAD-XL в 07:00Z. Номер PR, состояние, CI и вердикт совпали у 39
  из 39; номер — PR ветки `<epic>/<NN>`.
- Chip CI лежит внутри Ticket-а и строки бейджей, текст не обрезан. До «●…» обрезан только chip
  вердикта — так задумано (`src/renderer/canvas/badges/checks-badges.css:2-4`).
- Дочерний процесс `gh pr list` от worfy (родитель — pid 2455) получает `GH_TOKEN`, равный токену
  `gh auth token -u IDSAD-XL`, а не глобального аккаунта Oleksii-O-Atakama. Глобальный аккаунт без
  токена получает «Could not resolve to a Repository». Значение токена сравнивалось в памяти и нигде
  не печаталось.
- Токена нет в выводе main, в журналах Autopilot, в данных Project-а и в ответе `checks.get`:
  совпадений с шаблоном токена 0.
- Не проверено: открытых PR в IDSAD-XL/worfy нет (OPEN 0 из 92), поэтому вид бейджей у открытого PR
  не смотрели.
- После проверки viewport, выделение, стопки и свёрнутость рамок возвращены. Одно отличие: у рамки
  `worfy-week` в `layout.json` теперь явное `collapsed: true` вместо значения по умолчанию.
- Вердикт: проверено.
- Снимки: рамка `worfy-daily` с бейджами — [17-badges-stable.png](../../worfy-daily/evidence/17-badges-stable.png).
  Остальное — в scratchpad Session Orchestrator-а: `M19-frames.png`, `M19-frame-week.png`,
  `M19-badge-zoom-week01-02.png`, `M19-frame-daily-0.png`, `M19-frame-daily-6.png`,
  `M19-frame-daily-12.png`, `M19-after-restore.png`.

### Долги из HANDOFF (2026-10-08)

- [low] Harness, не код worfy: `preflight` без `GH_TOKEN` советует `gh auth switch --user <владелец remote>`
  (было `~/.claude/bin/preflight:195`, теперь `harness/bin/preflight:205`). Это противоречит правилу
  «глобальный `gh` не переключать» (ADR-0020, этот Ticket). Совет должен быть
  `GH_TOKEN=$(gh auth token -u <аккаунт>)` для команды. Найдено в Ticket-ах 01 и 02; Harness теперь в
  репозитории, править `harness/bin/preflight`.
