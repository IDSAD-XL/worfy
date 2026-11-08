# 02 — Чистка `.scratch`: Ticket-ы, spec-и, research, evidence

Type: task
Status: done 2026-11-08T19:13Z
PR: #1689
Blocked by: 01
Source: [spec.md](../spec.md), «Что нашла разведка 2026-11-08»; «Как работает» → «Чистка»; «Решено без владельца», п. 2, 6; Q1, Q7

Не платформенный: только документы и картинки. Глубина ревью — `low` и запуск guard-а Ticket-а 01 по `.scratch`.

## Что происходит

- В `.scratch` по разведке: имена других проектов владельца ≈ 440 строк, домашний путь с именем пользователя 196,
  имя владельца в прозе ≈ 240, имя хоста и адрес tailnet — в worfy-link 31, 39, в evidence 26 и issue 42
  worfy-harness. Аккаунт репозитория в прозе тоже здесь.
- Имена файлов: пять картинок в `.scratch/worfy-daily/evidence/` и один Ticket в
  `.scratch/worfy-product-session/issues/` несут имя другого проекта.

## Что делаем

1. Отчёт guard-а по `.scratch` (`node scripts/check-personal.mjs --report`) — список работы.
2. Каждую строку — на нейтральные слова по таблице spec-а («Чистка»); смысл, номера, ссылки и строки evidence не
   меняются. Аккаунт репозитория в URL — остаётся, в прозе — «аккаунт репозитория».
3. Файлы с личным в имени — переименовать (`git mv`), ссылки на них во всех `.scratch/**` поправить.
   `evidence-check` видит переименованную картинку как новую и требует для неё строку scrub
   (`harness/bin/evidence-check:742`). Поэтому на каждую переименованную картинку, после того как агент её открыл и
   посмотрел (п. 4), в Ticket, который на неё ссылается, добавляется одна строка
   `- evidence: screenshot <путь> · scrub: <дата>` (возражение 1 критика, Q8).
4. Картинки Ticket-ов, где речь о других проектах владельца или о хостах: открыть и посмотреть. Личное на
   изображении — картинку убрать из дерева, строку evidence оставить с пометкой «картинка убрана: личное на
   изображении».
5. `.scratch/worfy-scrub/**` не трогать.
6. Строки `Status:` и evidence не переписывать: `epic-status` и `evidence-check` читают их как раньше.

## Готово, когда

- [x] Отчёт guard-а по `.scratch` — ноль находок, кроме аккаунта репозитория в URL; счёт до и после — в «Итог»
      (без значений).
  - evidence: test-run pass · `node scripts/check-personal.mjs --report --list` exit 0, 0 findings under .scratch outside worfy-scrub · mac - · 15b5256b7c7a3e9be4881f6a531a72ee9469e69c
  - evidence: review pass · PR #1689 · - - · 3038e9fca3e2886ea56a048aa4ab5fb3cf708acb
- [x] Ни одна ссылка внутри `.scratch` не ведёт на переименованный или убранный файл.
  - evidence: test-run pass · `git grep` of the 24 removed and 6 renamed file names as link targets in .scratch exit 1 (no match) · mac - · 15b5256b7c7a3e9be4881f6a531a72ee9469e69c
  - evidence: review pass · PR #1689 · - - · 3038e9fca3e2886ea56a048aa4ab5fb3cf708acb
- [x] `epic-status` по всем Epic-ам даёт то же число Ticket-ов и те же состояния, что до правки.
  - evidence: test-run pass · `epic-status --json` origin/main copy vs branch: 39 epics, 897 tickets, same state, statusRaw and blockedNums · mac - · 15b5256b7c7a3e9be4881f6a531a72ee9469e69c
  - evidence: review pass · PR #1689 · - - · 3038e9fca3e2886ea56a048aa4ab5fb3cf708acb
- [ ] `node harness/bin/evidence-check --changed --root .scratch` — exit 0; `pnpm lint` — exit 0; `ci-ok` на PR зелёный.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42513585636/job/128832348514 · ci - · 3038e9fca3e2886ea56a048aa4ab5fb3cf708acb

## Тесты

- Документы; test-ов нет. Проверка — отчёт guard-а и сравнение `epic-status --json` до и после.

## Где в коде

- `.scratch/**` кроме `.scratch/worfy-scrub/**`

## Итог

Сделано в ветке `worfy-scrub/02`. Значений в этом разделе нет — только категории и счёт.

**Guard Ticket-а 01** (`node scripts/check-personal.mjs --report --list`, путь `.scratch/**` без `.scratch/worfy-scrub/**`):

- до: 4780 находок в 173 файлах — deny-word 2632, home-path 2117, host 16, tailscale-ip 8, email 7. Из них 3710 —
  один CPU profile `worfy-link/evidence/33-linked-opening.cpuprofile` (домашний путь в URL файлов);
- после: 0. Аккаунт репозитория guard не проверяет (решено без владельца, п. 2).

**Поиск подстрокой по открытому списку** (`git grep -i -F` по каждой записи, строки до → после): запись 0: 228 → 0;
1: 16 → 0; 2: 12 → 0; 3: 134 → 0; 4: 303 → 0; 5: 5 → 0; 6: 16 → 0; 7: 0 → 0; 8: 6 → 0; 9: 0 → 0.

**Замены** (по таблице spec-а «Чистка»):

- два других проекта владельца — `Project A` и `Project B` в прозе (у первого упоминания в файле — пометка «другой
  проект владельца»), `project-a` / `project-b` в путях, именах файлов, веток и Profile-ов;
- домашний путь — `~/…`; в путях Windows и в закодированных именах папок — `<user>`; в CPU profile —
  `/Users/someone/…`; тестовый пользователь macOS — `~worfy-test/…`;
- имя хоста — `someones-mac`, `<host>`, `DESKTOP-<7 знаков>`; tailnet — `<tailnet>`; адреса Tailscale —
  `<адрес Tailscale Mac>`, `<адрес Tailscale ПК>`, `<адрес Tailscale>`;
- личный аккаунт GitHub — «личный аккаунт GitHub владельца»; имя владельца — «владелец», «пользователь владельца»;
  адрес почты владельца — «the owner's git identity»;
- аккаунт репозитория в прозе — «аккаунт репозитория» (9 мест); в URL, командах `gh` и значениях `github.account` — остался;
- придуманные имена в примерах test-ов (`/Users/<имя>` и т. п.), которые guard тоже считает находкой, — на stand-in-ы
  `someone`, `user`, `you`, `<…>`; адреса и хосты, которые `evidence-check` не принимает за stand-in, — в форму `<…>`.

**Файлы с личным в имени:** пять снимков `worfy-daily/evidence/10-*`, `11-before-*`, `11-after-*` (имя другого
проекта) и Ticket `worfy-product-session/issues/17-*`. Ticket переименован (`git mv`) в
`17-pilot-на-другом-проекте-владельца.md`. Все пять снимков открыты: имя проекта видно на самом изображении (заголовок
окна, список Project-ов, имена Epic-ов) — сняты из дерева. Поэтому строки `scrub:` не нужны: переименованных картинок
в дереве нет.

**Картинки Ticket-ов о других проектах и хостах** (риск 6): открыто 97 снимков из Ticket-ов, где речь о других
проектах владельца или о хостах. Личное на изображении у 19 — сняты из дерева: `worfy-daily/evidence/17-badges-stable.png`,
`17-workflow-agents-session.png`; `worfy-harness/evidence/14-done-*`, `14-form-claude-md-*`, `14-form-profiles-*`,
`23-two-repos-*`; `worfy-link/evidence/18-settings-machines-*` (4); `worfy-multi-vendor/evidence/24/24-limits-*`,
`26/26-limits-vendors-*`; `worfy-mvp/evidence/27-packaged-terminal.png`. Категории: имя другого проекта (заголовок
окна, список Project-ов, Profile в окне переноса), домашний путь с именем пользователя, имя машины. 22 ссылки на них
стали текстом с пометкой «картинка убрана: личное на изображении». Ссылок на снятые или переименованные файлы в
`.scratch` нет.

**`epic-status --json`** до (копия `.scratch` из `origin/main` 28147bddf) и после: 39 Epic-ов, 897 Ticket-ов, те же
состояния (done 869, open 18, blocked 10), те же `statusRaw` и `Blocked by`, тот же статус spec-ов. Отличаются
`title` у трёх Ticket-ов (в заголовке было личное) и `slug` у одного (переименованный Ticket 17).

**Новое слово для Ticket-а 06:** имя владельца кириллицей (категория «имя владельца», в списке есть только латиница) —
нашлось в `worfy-windows/issues/09-*`, заменено.

**Проверки:** `node scripts/check-personal.mjs --report --list` — exit 0, 0 находок в `.scratch` вне `worfy-scrub`;
`node harness/bin/evidence-check --changed --root .scratch` — exit 0, `ok (173 files)`.
