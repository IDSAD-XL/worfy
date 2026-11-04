# 08 — Документация: раздел «Failure records»

Type: task
Status: open
Blocked by: 07
Source: [spec.md](../spec.md), «Решено без владельца» (раздел на странице Gate, не новая страница), «Риски», п. 1 и 4 (что не ловится), «Новые термины»; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (страницы функций: английский — основной, перевод — `docs/features/ru/`)

## Что происходит

- Страница `docs/features/gate-and-github.md` описывает Gate и Gate full (разделы «Gate», «Gate full» с блоками
  Behaviour / How it works / Implementation); перевод — `docs/features/ru/gate-and-github.md`. Форма раздела —
  `docs/features/README.md`, «Section template». `node scripts/check-feature-docs.mjs` (часть `pnpm lint`)
  проверяет, что пути на английских страницах существуют.
- О записях о падениях, `gate-failures` и `quarantine-suggest` страница не знает.

## Что делаем

1. `docs/features/gate-and-github.md` — новый раздел «Failure records» после «Gate full»:
   - Behaviour: что оставляет красный gate, строка `--- failure records:` в отчёте, команды `list`, `rerun`,
     `report`, `export`, `import`, `machine`, коды выхода; классы flaky / стабильно красный / без повтора и «под
     нагрузкой»; `quarantine-suggest` печатает, но не пишет; срок 60 дней; проект без reporter-ов получает только
     записи шагов.
   - How it works: контракт `GATE_FAILURES_FILE` (проект пишет, gate собирает), id test-а без строки, очистка и
     что она не ловит, компьютер без hostname; ссылка на ADR Ticket-а 07 и ADR-0086.
   - Implementation: модули Harness и worfy, reporter-ы, test-ы. Без номеров строк.
   - Подраздел `Windows`: оба пути запуска script-а; замок e2e и проверка экрана — при заданном
     `workflow.e2e_lock` на любой машине.
2. `docs/features/ru/gate-and-github.md` — перевод того же раздела.
3. Термины Failure record и Solo rerun — в `CONTEXT.md` только если владелец принял раздел spec-а «Новые термины»;
   правит Orchestrator, не этот Ticket.

## Готово, когда

- [ ] Раздел «Failure records» на английской странице и в переводе; каждое утверждение сверено с кодом вторым
      агентом.
- [ ] Раздел называет, чего очистка не ловит, и что CI не пишет записей.
- [ ] `node scripts/check-feature-docs.mjs` — exit 0 и строка `feature docs: ok (…)`.
- [ ] `pnpm lint` — exit 0; CI PR зелёный.

## Тесты

- Test кода нет. Проверка — `scripts/check-feature-docs.mjs` и сверка утверждений с кодом вторым агентом.
- Сначала падающий: ссылка на `harness/bin/gate-failures` на странице в ветке без файла — `check-feature-docs.mjs`
  exit 1 (проверка на копии ветки до merge 01).

## Где в коде

- `docs/features/gate-and-github.md`
- `docs/features/ru/gate-and-github.md`

Только читать: `harness/hooks/gate-failures.mjs`, `harness/hooks/gate.mjs`, `harness/lib/gate-failures/`,
`test/failures-reporter.ts`, `test/e2e/failures-reporter.ts`, `scripts/quarantine-suggest.mjs`,
`docs/features/README.md`, ADR Ticket-а 07.
