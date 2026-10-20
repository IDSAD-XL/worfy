# 13 — e2e и `test:package` до merge — только когда diff трогает renderer, main process, упаковку или watcher-ы; иначе — ночной run на `main`

Type: task
Status: open
Blocked by: 10, 11
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов», решение Q5;
[ADR-0081](../../../docs/adr/0081-per-pr-linux-ci-shards-and-affected-tests.md) (принят 2026-10-20), пункт 3;
Ticket [03](03-implementer-гоняет-только-свои-e2e.md) (done, PR #385).

## Что происходит

- gate full перед merge гоняет весь `test:e2e` (88 файлов в `test/e2e`; 87 из них запускают Electron через
  `launchApp` → `_electron.launch`, `test/e2e/helpers.ts:146`, кроме `linked-autopilot.spec.ts`) и
  `test:package` (собранный `.app`) на каждом PR с кодом или на наборе Wave. Playwright идёт в один
  поток: `workers: 1`, `fullyParallel: false` (`playwright.config.ts`).
- Ticket 03 записал правило implementer-а: e2e — только файлы, которые трогает Ticket; весь `test:e2e` —
  в gate full Orchestrator-а перед merge (`harness/agents/implementer.md:174-179`).
- Пути, от которых зависит e2e: renderer — `src/renderer/`, `src/preload/`; main process — `src/main/`;
  упаковка — `electron-builder.yml`, `electron.vite.config.ts`, `build/`; watcher-ы —
  `src/main/workflow/watch.ts`, `src/main/link-safe-watch.ts`, `src/main/chokidar-close.ts`,
  `src/main/watch-gone.ts`, `src/main/cards/store.ts`, `src/main/claude-home/registry.ts`. Списка путей в
  Profile-е нет.

## Что делаем

1. Поле Profile-а — список путей (glob), при которых e2e и `test:package` нужны до merge. Для worfy —
   пути из «Что происходит»; окончательный список — в «Итог».
2. Шаг перед merge: diff PR против базы трогает путь из списка — весь `test:e2e` и `test:package` на Mac,
   как сейчас; не трогает — e2e до merge нет.
3. Ночной run на `main`: весь `test:e2e` и `test:package`. Что делать с красным ночным run-ом — в
   «Открытые вопросы».
4. **Связь с Ticket-ом 03.** Первая половина правила 03 остаётся: implementer гоняет только e2e-файлы,
   которые трогает Ticket. Вторая половина — «весь `test:e2e` — в gate full перед merge» — меняется:
   весь `test:e2e` перед merge — только по списку путей пункта 1, иначе — ночью. Текст
   `harness/agents/implementer.md:174-179` и пункт `rules.md` Profile-а, который записал 03, правятся
   под это.
5. `docs/lessons/agents.md:57-66` и `:95-101` (заблокированный экран — e2e падает на первом окне) касаются и
   ночного run-а: экран Mac ночью должен быть включён.

Платформенный PR (ADR-0056, пункт 2): меняются скрипты Harness — до merge нужен вердикт Windows (ADR-0071).

## Готово, когда

- [ ] `profile` читает и проверяет поле списка путей; неверный тип — exit 1 с причиной;
      `harness/bin/tests/profile.test.sh` это проверяет.
- [ ] На временном репозитории: diff в `src/renderer/` — шаг перед merge гоняет e2e и `test:package`;
      diff только в `src/shared/` — не гоняет; shell test это проверяет.
- [ ] Текст implementer-а и skill-ов говорит новое правило; `harness/bin/tests/agents-text.test.sh`
      проверяет фразу; правило Ticket-а 03 о своих e2e-файлах на месте.
- [ ] Ночной run на `main` запущен хотя бы один раз; ссылка или лог и код выхода — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; вердикт
      Windows; gate full — шаг Orchestrator-а перед merge (последний по старой схеме).

## Открытые вопросы

Решает владелец по числам Ticket-а 10; исполнитель не выбирает сам.

- **Кто и где запускает ночной run.** Job-а на macOS нет (Q4), e2e нужен экран Mac. Варианты:
  scheduled task на Mac, отдельный Autopilot run, ручной `full-macos` по расписанию — последний
  противоречит Q4.
- **Красный ночной run.** Q5 решает только, что e2e и `test:package` идут ночью на `main`. Тот же порядок,
  что красный `main` у Ticket-а 11 (bisect и revert), или только отчёт — не решено.
- **Точный список путей.** Входит ли `src/shared/` (общий код renderer-а и main process) и
  `harness/` (Harness ставится из приложения, `harness-install.spec.ts`).

## Где в коде

- `harness/bin/profile`, `harness/bin/tests/profile.test.sh`
- `harness/bin/wave-gate`, `harness/skills/epic-wave/SKILL.md` (раздел 3 «Verification gate»)
- `harness/agents/implementer.md` (`:174-179`), `harness/bin/tests/agents-text.test.sh`
- `harness/profiles/README.md`, `harness/profiles/draft.schema.json`
- `playwright.config.ts` (только чтение)

Вне репозитория (шаг Orchestrator-а после merge): live Profile worfy (список путей) и `rules.md` (правило
о замке e2e).

## Вне скоупа

- Параллельный Playwright (`workers` больше 1) — отдельный Ticket по числам Ticket-а 10.
- e2e в CI на GitHub — нет (Q4).

## Итог
