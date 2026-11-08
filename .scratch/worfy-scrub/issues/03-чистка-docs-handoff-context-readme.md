# 03 — Чистка `docs/`, `HANDOFF.md`, `CONTEXT.md`, `README.md`

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Что нашла разведка 2026-11-08»; «Как работает» → «Чистка»; «Решено без владельца», п. 5; Q1, Q2

Не платформенный: только документы. Глубина ревью — `medium`: правка текста принятых ADR.

## Что происходит

- `docs/adr`: 18 файлов с именами других проектов владельца, ≈ 65 строк. 7 ADR называют аккаунт репозитория там, где
  он адрес репозитория — эти строки остаются (Q1).
- Остальное `docs/` (страницы Feature и `ru/` копии, roadmap, design, research) — ≈ 67 строк; адрес tailnet — в
  `docs/features/link.md:15` и `docs/features/ru/link.md:17`.
- `HANDOFF.md` и `CONTEXT.md` — 3 строки. `README.md` — clone URL с аккаунтом репозитория (остаётся).
- Правило ADR (`rules-adr.md`): текст принятого ADR не переписывается, изменения — в датированном `## Amendments`.

## Что делаем

1. Отчёт guard-а по этим путям — список работы.
2. ADR (Q2): заменить только личные строки нейтральными словами, смысл не менять. В конце каждого тронутого ADR —
   раздел `## Amendments` (создать, если нет) со строкой «2026-11-xx: личные имена заменены нейтральными словами
   (Epic worfy-scrub), смысл не менялся», дата — день merge.
3. Страницы Feature и `ru/` копии — одинаковые правки в обеих; адрес tailnet → `<host>.<tailnet>.ts.net` или
   «адрес MagicDNS».
4. Прочее `docs/`, `HANDOFF.md`, `CONTEXT.md` — по таблице spec-а («Чистка»).
5. Аккаунт репозитория в URL и в примерах команд, которые без него не работают, — не трогать.

## Готово, когда

- [ ] Отчёт guard-а по `docs/`, `HANDOFF.md`, `CONTEXT.md`, `README.md` — ноль находок, кроме аккаунта репозитория в
      URL.
- [ ] `git diff origin/main -- docs/adr` меняет только строки с личным и дописывает `## Amendments`; второй агент
      проверил, что смысл каждой правленой строки ADR не изменился.
- [ ] `node scripts/check-feature-docs.mjs`, `node scripts/check-handoff.mjs`, `node scripts/check-cyrillic.mjs` —
      exit 0; `ci-ok` на PR зелёный.

## Тесты

- Документы; test-ов нет. Проверка — отчёт guard-а и второй агент по ADR.

## Где в коде

- `docs/**`
- `HANDOFF.md`
- `CONTEXT.md`
- `README.md`

## Итог

Ветка `worfy-scrub/03`. Личные строки в `docs/**`, `HANDOFF.md` и `CONTEXT.md` заменены нейтральными словами;
`README.md` не менялся: в нём только clone URL с аккаунтом репозитория (Q1).

### Счёт до и после

- Отчёт guard-а (`node scripts/check-personal.mjs --report --list`) по `docs/`, `HANDOFF.md`, `CONTEXT.md`,
  `README.md`: до — 167 находок (deny-word 157, home-path 8, host 2), после — 0. Весь репозиторий: 6717 → 6550 (остальное — пути других Ticket-ов).
- Поиск подстрокой по открытому списку на машине владельца (`git grep -n -i -F -I` по каждой записи, те же пути),
  строк до → после по номеру записи: 0: 6 → 0, 1: 2 → 0, 2: 0 → 0, 3: 36 → 0, 4: 99 → 0, 5: 0 → 0, 6: 2 → 0,
  7: 0 → 0, 8: 1 → 0, 9: 0 → 0.
- Аккаунт репозитория: в прозе заменён в одном ADR (0048, две строки); в URL, в адресе репозитория `<аккаунт>/worfy`
  и в командах `gh … --repo`, `gh auth token -u` остался (Q1).

### Что заменено

- ADR — 20 файлов: имя другого проекта владельца → «другой проект владельца», имя проекта из трёх репозиториев →
  «рабочий проект владельца» (имена репозиториев → «расширение браузера, сервер и общая библиотека»), домашние пути →
  `~/…` или «домашний путь владельца», имя пользователя Windows в примере кодировки → `<имя кириллицей>`, имена
  личных скриптов → их назначение. Числа, ссылки, Status и смысл не менялись. В конце каждого, в разделе
  `## Amendments`, строка «2026-11-08: личные имена заменены нейтральными словами (Epic worfy-scrub), смысл не менялся.»
  (раздел создан в 18 файлах, в двух уже был).
- Страницы Feature: имя компьютера в примере (`link.md` и `ru/link.md`) → stand-in Q6; путь Windows в примере
  (`gate-and-github.md` и `ru/gate-and-github.md`) → `C:/Users/someone/worfy`. Правки одинаковые в паре.
- Макеты `docs/design/` (`BRIEF.md`, четыре `F-*.dc.html`): проекты в макете — вымышленные `acme` и `globex`.
- `docs/roadmap.md`, три файла `docs/research/`, `HANDOFF.md`, `CONTEXT.md` — по таблице spec-а («Чистка»).
- Новых категорий личного, которых нет в списке guard-а, не найдено.

### Проверки

- `node scripts/check-feature-docs.mjs` — exit 0 (`feature docs: ok (33 pages, 2294 paths)`).
- `node scripts/check-cyrillic.mjs` — exit 0.
- `node scripts/check-handoff.mjs` — exit 0 (`handoff: ok`).
- `pnpm lint && pnpm typecheck && pnpm test` — exit 1: lint и typecheck зелёные, в test-ах упал один test,
  не связанный с документами: `test/contract/harness-hook-stdin.test.ts` («project-connect refuses a terminal on
  stdin at once», пустой stderr под нагрузкой полного набора). Отдельно этот файл — exit 0, `Tests 18 passed (18)`.
- `gate fast` (lint, typecheck, весь `pnpm test`) — exit 0, `[gate] green (fast)`.
- Смысл правленых строк ADR проверяет второй агент на ревью (пункт 2 «Готово, когда»).
