# worfy-week: неделя работы владельца из worfy

Status: принят владельцем 2026-10-07 (ответы на вопросы 3 и 4)
Source: [roadmap.md](../../docs/roadmap.md), E2, условие «владелец неделю работает из worfy»;
[CONTEXT.md](../../CONTEXT.md); ADR [0020](../../docs/adr/0020-profile-shared-and-personal-parts.md);
HANDOFF 2026-10-06, «Ждёт владельца»; Epic [worfy-daily](../worfy-daily/spec.md) — формат и соглашения.
Ticket-ы: Epic `worfy-week`, нумерация с `01`. Шапка — тот же диалект, что у worfy-daily
(`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`, `ticket` и
вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Владелец неделю работает из worfy каждый день без трения. Трение — всё, из-за чего приходится
уйти из worfy в терминал или браузер или что мешает работать в самом worfy. Каждый такой дефект,
найденный за неделю, становится Ticket-ом этого Epic-а. Wave-ы Epic-а ведёт Autopilot.

Epic готов, когда:

1. Неделя работы владельца из worfy прошла — это условие 4 готовности E2
   ([worfy-daily spec.md](../worfy-daily/spec.md), «Цель»; в roadmap — последнее условие E2).
2. Каждый дефект недели стал Ticket-ом `worfy-week`: он закрыт, или владелец сам отложил его.
3. Wave-ы Epic-а прошли в Autopilot. Точка, где понадобился человек, — дефект (CONTEXT.md,
   Autopilot) и тоже Ticket.

## Как устроено

- Как в worfy-daily: worfy только показывает workflow и запускает его теми же инструментами
  ([ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md)). В репозиторий Project и
  в `~/.claude` worfy не пишет ([ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md)).
  Profile читается только через `~/.claude/bin/profile`.
- Wave-ы ведёт Orchestrator worfy в Autopilot на Stable copy. Между прогонами Stable copy
  обновляется по README, раздел «Stable copy».
- Состав Epic-а растёт по ходу недели. Новый Ticket берёт следующий свободный номер. В `Source` —
  когда и на чём нашли дефект.
- Сейчас Ticket-ов два: 01 и 02. После раунда дизайна добавятся Ticket-ы про Canvas: Edge-и
  между Node-ами, auto-layout и snapping (прилипание при перетаскивании). Их номера и
  Wave-ы появятся в таблице «Волны» тогда же.
- Первый длинный прогон Autopilot над этим Epic-ом может впервые упереться в Limits. Тогда
  проверится условие 3 готовности E2 ([worfy-daily spec.md](../worfy-daily/spec.md), «Цель»;
  Ticket 05 `worfy-daily`): прогон ждёт сброса и продолжает сам.

## Этапы

1. **Дефекты, известные к началу недели** — 01, 02.
   - 01: бейджи PR и CI идут от аккаунта GitHub Project-а — часть ADR-0020, нужная сейчас.
   - 02: ⌘Z после двух жестов над одним Node возвращает его на исходное место.
2. **Canvas после раунда дизайна** — Edge-и, auto-layout, snapping. Ticket-ов пока нет.
3. **Дефекты недели** — по мере находок.

## Не в этом Epic-е

- **E3 — Harness как часть worfy** ([roadmap](../../docs/roadmap.md)). В том числе остаток
  ADR-0020: выбор аккаунта GitHub в UI при подключении Project, `GH_TOKEN` в окружении Session-ов
  агентов, Profile из двух частей. Ticket 01 берёт из ADR-0020 только аккаунт из нынешнего Profile
  для вызовов `gh`, которые делает сам worfy.
- Раздел Autopilot в [F-SPEC.md](../../docs/design/F-SPEC.md) — E3 (решение владельца 2026-10-07).
- Долги из HANDOFF, раздел «Риски и долги», которые не мешают работать каждый день. Вынос
  `LayoutChannel` из `Canvas.tsx` ради одного мутанта — долг, а не Ticket (решение владельца
  2026-10-07).
- E4 — подпись Developer ID и нотаризация.

## Риски и открытые технические вопросы

1. **Токен GitHub не должен утечь** (Ticket 01). Токен из `gh auth token` живёт только в окружении
   дочернего процесса `gh`: не в логе, не в журнале прогона, не в ответе IPC renderer-у.
2. **Аккаунт есть в Profile, а входа в gh под ним нет** (Ticket 01). `gh auth token -u <аккаунт>`
   падает. Бейдж называет причину, а не идёт молча от глобального аккаунта gh.
3. **Что делает ⌘Z, пока жест ещё идёт** (Ticket 02). Шаг жеста встанет в историю раньше, чем жест
   кончится. Ticket решает и записывает решение в «Итог».
4. **Объём Epic-а заранее неизвестен.** Дефекты недели приходят по ходу. Таблица «Волны» — план,
   а Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-daily](../worfy-daily/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»:
сначала падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI
в двух темах, Autopilot над worfy — только на Stable copy. Отличия:

- **Ветки** — `worfy-week/<NN>`; worktree — по Profile.
- **ADR** — следующий свободный номер в момент взятия Ticket-а (сейчас 0037). Номера заранее не
  держатся.
- **Проверка перед мержем** — `GATE_SCOPE=all gate.sh full` на ветке (правило `rules.md`
  Profile-а worfy). CI на PR — только lint, typecheck, unit и contract test-ы.
- **Ручные проверки** Orchestrator проводит одним блоком, когда владельца нет за Mac-ом (решение
  владельца 2026-10-07). Не сделанный пункт — «не проверено: …» в «Итог» и пункт в HANDOFF,
  раздел «Ждёт владельца».

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/main/ipc/checks.ts`, `src/main/github/prs.ts`, `src/main/workflow/profile.ts`, `test/contract/github-prs.test.ts`, `test/contract/workflow-profile.test.ts` | 1 |
| 02 | `src/renderer/canvas/history.ts`, `test/unit/history.test.ts` | 1 |

Общих файлов у 01 и 02 нет, блокеров нет: оба в Wave 1. Ticket-ы после раунда дизайна получат
Wave-ы, когда их заведут.
