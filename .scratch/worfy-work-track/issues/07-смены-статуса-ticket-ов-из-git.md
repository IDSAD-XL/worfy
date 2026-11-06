# 07 — Смены статуса Ticket-ов из git

Type: task
Status: done 2026-11-06T16:30Z
PR: #1509
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает» → «Источники», «Чтение»; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), п. 5; [01](../../worfy-autopilot-queue/issues/01-destination-и-масштаб.md), Q5

## Что происходит

- Смена статуса Ticket-а вне Run-а нигде не записана (ADR-0092); журнал Run-а пишет `ticket-status` только внутри Run-а.
- В git она есть: main — 1182 смены за 30 дней (почти всё — squash merge), remote-ветки — ещё 908 (research 04).
  Время есть в значении `Status:` у 71 % (`done 2026-11-05T07:39Z`), у остальных — только дата; форм значения не
  меньше шести.

## Что делаем

1. `src/shared/work-track/status-value.ts` — разбор значения `Status:` всех форм (`done 2026-11-05`, `done — 2026-11-05,
   [PR #N](…)`, `done 2026-11-05 07:39`, ISO с `Z`…): состояние и время или дата.
2. `src/main/work-track/ticket-status.ts` — `git log -p --since` по `.scratch/*/issues/*.md` на main и `--remotes --not
   origin/main`: факты `ticket-status` (Epic, Ticket, из какого в какое состояние, время: значение → коммит ветки →
   коммит main); дубли ветки и main — одна смена. `git` — только чтение.

## Готово, когда

- [ ] Unit test разбора: все формы из research 04 и неизвестная форма (`null`, без ошибки).
  - evidence: test-run pass · `pnpm test -- test/unit/work-track-status-value.test.ts` exit 0 · mac - · 70447ad4f76a5f728271162fbe05917b7d13efcb
  - evidence: review pass · PR #1509 · - - · f5e800307fe204c7a765ea1529e1676937b9c18d
- [ ] Contract test на временном репозитории: claim и done в ветке, squash в main — две смены с временем значения;
      смена без времени — время коммита ветки; репозиторий не изменён.
  - evidence: test-run pass · `pnpm test -- test/contract/work-track-ticket-status.test.ts` exit 0 · mac - · 70447ad4f76a5f728271162fbe05917b7d13efcb
  - evidence: review pass · PR #1509 · - - · f5e800307fe204c7a765ea1529e1676937b9c18d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 70447ad4f76a5f728271162fbe05917b7d13efcb
  - evidence: gate pass · `gate fast` exit 0 · mac - · 70447ad4f76a5f728271162fbe05917b7d13efcb
  - evidence: review pass · PR #1509 · - - · f5e800307fe204c7a765ea1529e1676937b9c18d
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42245113926 · ci - · f5e800307fe204c7a765ea1529e1676937b9c18d

## Тесты

- Unit `test/unit/work-track-status-value.test.ts`, contract `test/contract/work-track-ticket-status.test.ts` (новые).
- Сначала падающий: модулей нет.

## Где в коде

- `src/shared/work-track/status-value.ts`, `src/main/work-track/ticket-status.ts` (новые)
- `test/unit/work-track-status-value.test.ts`, `test/contract/work-track-ticket-status.test.ts` (новые)

Только читать: `harness/bin/epic-status` (разбор `Status:` Harness-а), `harness/bin/TICKETS.md`.

## Итог

- `src/shared/work-track/status-value.ts` — чистый разбор значения `Status:`: состояние (`open`, `claimed`, `blocked`,
  `done`; старое `in-progress` — `claimed`) и время трёх видов: момент (ISO с `Z` или смещением), дата и время без
  пояса (`done 2026-11-01 00:00` — пояс берётся у коммита, который его записал), только дата. Неизвестное слово — `null`
  без ошибки; дата в тексте причины (`blocked — отложен … 2026-10-12`) временем не считается.
- `src/main/work-track/ticket-status.ts` — два `git log -p --unified=0` по `.scratch/*/issues/*.md`: main
  (`origin/main`, без него — `HEAD`) с начала периода и `--remotes --not <main>` с запасом 14 дней до начала. Смена —
  строка `Status:` в первых 15 строках файла с другим состоянием до и после коммита. Смена в main, чьё новое значение
  есть в ветке, — та же смена: остаётся ветка, номер PR берётся из `(#N)` коммита main. `git` только читает
  (`GIT_OPTIONAL_LOCKS=0`); `readTicketStatusFacts` отдаёт факты `ticket-status` источника `git` (`start` = `end`).
- Сначала падающий test: оба test-а красные на `ceb9435e4` — модулей нет (vitest не находит импорт, 2 файла failed); после
  реализации 45 unit- и 9 contract-test-ов зелёные.
- Проверка на истории репозитория worfy (только чтение): 30 дней — 1234 смены за 0.34 с; время из значения у 931,
  из коммита ветки у 189, из коммита main у 114.

Решено без владельца:

1. **Время ветки — дата автора коммита**, не коммиттера: rebase меняет вторую, а смена была сделана в момент первой.
   Время main — дата коммиттера (момент merge).
2. **Новый файл Ticket-а — смена, только если он сразу `claimed` или `done`** (`from: null`, в заголовке «new»).
   Созданный `open` или `blocked` — не работа, а нарезка Ticket-ов.
3. **Смена формы без смены состояния** (`claimed — 2026-11-05` → `claimed 2026-11-05`, `ticket migrate`) — не смена.
4. **Запас 14 дней для веток**: squash в периоде повторяет коммиты ветки до периода; без них он считался бы новой
   сменой во время squash.
5. **Строка `Status:` в теле Ticket-а** (дальше 15-й строки) — не заголовок, не читается.
6. **`outcome`** факта — `blocked` для смены в `blocked`, иначе `ok`; `title` — `07 claimed → done`.
