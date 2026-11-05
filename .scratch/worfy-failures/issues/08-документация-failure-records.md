# 08 — Документация: раздел «Failure records»

Type: task
Status: done 2026-11-05T05:16Z
PR: #1416
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
  - evidence: review pass · PR #1416 · - - · 14c619f2810792f17a6c1a84348712690dad3615
- [ ] Раздел называет, чего очистка не ловит, и что CI не пишет записей.
  - evidence: commit pass · docs: section "Failure records" on the Gate feature page (worfy-failures 08) · - - · f51519768
  - evidence: review pass · PR #1416 · - - · 14c619f2810792f17a6c1a84348712690dad3615
- [ ] `node scripts/check-feature-docs.mjs` — exit 0 и строка `feature docs: ok (…)`.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0, feature docs: ok (26 pages, 1964 paths); on a copy before worfy-failures 01 exit 1 · mac - · f51519768
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0, feature docs: ok (26 pages, 1964 paths), round 2 · mac - · bfda0211bfd32eb6176b06e7f420ed2c6b266bb0
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/41971902281 · ci - · 14c619f2810792f17a6c1a84348712690dad3615
- [ ] `pnpm lint` — exit 0; CI PR зелёный.
  - evidence: test-run pass · `pnpm lint` exit 0 (CI of the PR not yet read) · mac - · f51519768
  - evidence: gate pass · `gate fast` exit 0, GATE_SCOPE=all · mac - · f51519768
  - evidence: test-run pass · `pnpm lint` exit 0, round 2 · mac - · bfda0211bfd32eb6176b06e7f420ed2c6b266bb0
  - evidence: gate pass · `gate fast` exit 0, GATE_SCOPE=all, round 2 · mac - · bfda0211bfd32eb6176b06e7f420ed2c6b266bb0
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/41971902281 · ci - · 14c619f2810792f17a6c1a84348712690dad3615

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

## Итог

- `docs/features/gate-and-github.md`: раздел «Failure records» после «Gate full» — Behaviour (что оставляет red run,
  строка `--- failure records:`, subcommand-ы `list`, `rerun`, `report`, `export`, `import`, `machine` и их exit code-ы,
  классы flaky / stable red / without rerun и «under load», кандидаты, `quarantine-suggest` печатает и не пишет, срок
  60 дней, шаги без test-ов, CI записей не пишет), подраздел Windows, How it works (контракт `GATE_FAILURES_FILE`, id
  test-а без строки, очистка и чего она не ловит, компьютер без hostname, ссылки на ADR-0096 и ADR-0086),
  Implementation без номеров строк. Вступление страницы теперь называет четыре Feature.
- `docs/features/ru/gate-and-github.md`: перевод раздела; заодно переведены абзацы про Codex из #1308, на которые
  перевод отставал, поэтому строка `same-pr` остаётся верной.
- Сначала падающий: страница на копии дерева до merge 01 (`649954d91^`) — `check-feature-docs.mjs` exit 1, 20 путей
  «does not exist», среди них `harness/bin/gate-failures`; на ветке — exit 0, `feature docs: ok (26 pages, 1964 paths)`.
- Страница теперь 586 строк — больше порога шаблона в ~400 строк; раздел на этой странице решён spec-ом, разбиение
  страницы — вопрос Orchestrator-у.
- Сверка утверждений вторым агентом (пункт 1) — за Orchestrator-ом.
- Раунд 2 (замечания проверки #1416): `list --json` и `report --json` кладут пропущенные файлы в поле `skipped`
  JSON-объекта и в stderr не пишут — страница говорит это для обоих режимов; записи reporter-а vitest для файла,
  упавшего вне своих test-ов, и для необработанных ошибок run-а названы в «What a red run leaves» (в `<n> tests`
  входят, `list`, `rerun` и `report` считают их шагами); строка индекса `docs/features/README.md` называет Failure
  records. Оба языка. Разбиение страницы — не в этом раунде.
