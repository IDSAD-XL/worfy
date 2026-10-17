# 32 — `wave-gate.test.sh` под нагрузкой дольше предела 120 s на файл в `harness-scripts.test.ts`

Type: task
Status: open
Blocked by: —
Source: замер [30](30-contract-test-ы-краснят-gate-full-чужих-pr-под-нагрузкой.md) 2026-10-17/18,
«Итог», раздел 5; решение Orchestrator-а 2026-10-18 — открыть отдельный Ticket, 30 ждёт его.

## Что происходит

- `test/contract/harness-scripts.test.ts` запускает каждый `harness/**/tests/*.test.sh` отдельным
  `bash` с пределом `FILE_TIMEOUT_MS` = 120 000 (`:22`, `:71`). Скрипт, который не уложился, — красный
  test с `spawnSync bash ETIMEDOUT`.
- Замер Ticket-а 30 (два прогона `--project contract` разом под `yes > /dev/null` на 9 из 18 ядер, load
  13–15): `bin/tests/wave-gate.test.sh` до #401 (`66499375`) — 68,6 s; на `origin/main` `90c5e724` —
  118,7–120 s, 5 красных из 12 прогонов, все — timeout этого test-а. Остальные файлы Ticket-а 30 в тех
  же прогонах — 0 красных.
- Рост: после `66499375` в `wave-gate.test.sh` добавлено 252 строки, убрано 19 — #428 (отметки агентов
  на SHA, замок e2e), #433 (batch CI на main), #444 (stand-in `gh` на Windows). Сейчас 820 строк, 23
  раздела `# --- … ---` в одном файле.
- Пока он краснеет, замер Ticket-а 30 не может дать «после — 0 красных», а gate full под нагрузкой
  может краснеть у PR, которые Harness не трогали.

## Что делаем

Направление выбирает тот, кто берёт Ticket, после замера, какие разделы дольше всего:

1. **Разбить файл по темам** на несколько `*.test.sh` — например, batch CI, merge (squash, resume,
   tree mismatch), замок e2e, состояние (pid-файл, resume, экран и `caffeinate`). Общие stub-ы и «мир»
   (bare origin, PR refs) — в общий файл, который части подключают через `source`. Каждая часть —
   отдельный test `harness-scripts.test.ts` со своим пределом.
2. **Или ускорить самые долгие разделы** — сначала замерить время каждого раздела под нагрузкой, потом
   убрать лишние повторы git-операций, лишние запуски `wave-gate` и ожидания.

Предел 120 s не поднимать: это правило Ticket-а 30 («`testTimeout`, `WAIT` и пределы в файлах не
поднимать как лечение»).

## Открытый вопрос

- Мутант Ticket-а 30 «stub снова пишется в каждом test-е» выжил: пять файлов зелёные и с ним, под
  нагрузкой тоже. Возможная причина: stub-ы `profile`, `ticket`, `epic-status` теперь Node-скрипты, а
  worfy запускает такой файл как `node <script>` (`harnessScriptCommand`,
  `src/main/workflow/profile.ts:189`); macOS тогда не проверяет его как новый исполняемый файл, и мутант
  не может покраснеть. Не проверено. Если это так, ускорение после #401 дал переход на Node-stub, а не
  symlink, и `wave-gate.test.sh` с его shell-stub-ами (`chmod +x`) может ждать ту же проверку macOS.

## Готово, когда

- [ ] `wave-gate.test.sh` или каждая его часть укладывается в 120 s в замере Ticket-а 30 (те же команды:
      «Итог» Ticket-а 30, «Команды замера»): после правки — 0 красных в N прогонах, N ≥ 6.
- [ ] Ни одна проверка `wave-gate.test.sh` не потеряна: число проверок до и после правки — в «Итог».
- [ ] Предел `FILE_TIMEOUT_MS` и другие пределы не подняты.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `bash harness/bin/tests/<файл>.test.sh` — exit
      0 для каждой части.

## Тесты

- `node scripts/vitest-electron.mjs --project contract test/contract/harness-scripts.test.ts` под
  нагрузкой и без; у каждого прогона — код выхода.
- Нагрузка — только когда других агентов на машине нет: она краснит gate соседей.

## Где в коде

- `harness/bin/tests/wave-gate.test.sh` — разбить или ускорить; новые `harness/bin/tests/*.test.sh`,
  если разбивать
- `test/contract/harness-scripts.test.ts` — только если новые файлы надо назвать явно

Только читать: `harness/bin/wave-gate`. Правка в `harness/` — PR со скриптами Harness: нужен вердикт
Windows (ADR-0056).

## Вне скоупа

- Другие долгие `*.test.sh` (`harness-home` 33–53 s, `gate-verdict` 31 s) — только запись в «Итог»,
  если они близки к пределу.
- Поведение `harness/bin/wave-gate`.

## Итог
