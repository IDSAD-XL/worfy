# 01: ADR Schedule-ов, Amendment-ы ADR-0114 и ADR-0098, исключение ADR-0005

Type: task
Status: open
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 01; «Решения по реализации» («Согласие», «Scheduled run», «Предложение
Amendment ADR-0114», «ADR»); «Модель данных» («Где лежит»); решения владельца Q3, Q15 grilling-а и Q1, Q4 spec-а; разбор
critic-а, возражение 1; «Волны», Wave 1

Кто: агент. Глубина ревью — `medium`. Только документы, кода нет.

## Что происходит

- Граница 3 ADR-0114 (`docs/adr/0114-assistant-app-session.md`, решение 5): Session с текстом Assistant-а стартует только
  по щелчку пользователя, который видел текст. Scheduled run стартует без щелчка; Q3 grilling-а решил, что щелчок
  Accept на карточке Schedule — согласие на все run-ы, пока текст, Project, Vendor и модель те же.
- ADR-0098, пункт 3 (`docs/adr/0098-approval-policy.md`): корни Approval policy — только корни Run-а Autopilot-а.
  У scheduled run-а свои корни.
- ADR-0005 (`docs/adr/0005-worfy-own-state-inventory.md`): worfy ничего не пишет в репозиторий Project-а; каждое
  исключение записано своим Amendment-ом (пример — ADR-0101). Scheduled run заставляет main worfy делать `git fetch`,
  `git worktree add` на ветке `schedule/*` и удалять чистые worktree-ы с их веткой.
- Решения Epic-а нигде, кроме spec-а, не записаны.

## Что строить

- **Новый ADR** (следующий свободный номер в момент Ticket-а): Schedule — сущность в папке данных Machine
  (`<WORFY_DATA_DIR>/schedules/`); планировщик в main без планировщиков ОС; согласие с отпечатком (SHA-256 текста, id
  Project-а, Vendor-а и точного id модели); worktree и ветка на каждый run; уведомления только об Error, Timed out и
  Needs you; без Autopilot-а; только локально. Considered Options — из spec-а и исследования (launchd / Task Scheduler,
  облачные routines, cron).
- **Amendment ADR-0114**, граница 3 — текст из spec-а, раздел «Предложение Amendment ADR-0114», с датой; плюс Q4 spec-а:
  псевдоним модели, который теперь ведёт к другому id, снимает согласие.
- **Amendment ADR-0098**, пункт 3 — корни scheduled run-а: его worktree, `<WORFY_DATA_DIR>/schedule-tmp/<run>` (TMPDIR) и
  scratchpad Session-а; рабочая копия Project-а и `.scratch` — не корни; push по-прежнему никогда не allow, самое
  большее park (Q1 spec-а).
- **Amendment ADR-0005** — исключение: текст из spec-а, раздел «ADR», пункт «Исключение ADR-0005».
- **Запись в инвентарь ADR-0005** — два файла: `schedules/schedules.json` и `schedules/runs/<id>.json`.
- ADR-0100, ADR-0091, ADR-0066, ADR-0108 не меняются — так и написать в новом ADR.
- Тексты Amendment-ов — предложение владельцу; он принимает их на PR этого Ticket-а.

## Где в коде

- `docs/adr/<NNNN>-schedules.md` (новый, имя — предложение)
- `docs/adr/0114-assistant-app-session.md`, `docs/adr/0098-approval-policy.md`, `docs/adr/0005-worfy-own-state-inventory.md` —
  раздел `## Amendments` каждого

## Test-ы

- Кода нет. `pnpm lint` проверяет Markdown и ссылки.

## Готово, когда

- [ ] Новый ADR записывает решения Epic-а с номерами Q grilling-а и spec-а.
- [ ] Amendment-ы ADR-0114 (граница 3), ADR-0098 (пункт 3) и ADR-0005 (worktree-ы и ветки `schedule/*`) и строка
      инвентаря ADR-0005 — в `main`.
- [ ] (вручную) Владелец принял тексты трёх Amendment-ов и новый ADR на PR этого Ticket-а.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
