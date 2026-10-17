# 15 — Мост Limits лежит в `.app`, а не в dev-checkout

Type: task
Status: done 2026-10-08
PR: #134
Blocked by: 13
Source: решения владельца 2026-10-07, Q19 (мост Limits: скрипт из `.app`, запись `statusLine` меняется с согласия в форме переноса), Q8; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) (worfy пишет в `~/.claude` только установщиком и переносом, с согласия); [ADR-0047](../../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) (ранний переход машины владельца); [ADR-0023](../../../docs/adr/0023-separate-data-roots-packaged-and-dev.md) (папки данных dev и packaged); [spec.md](../spec.md)

## Что происходит

- Limits из терминала и Claude desktop приходят в worfy через строку состояния пользователя: Claude
  Code передаёт её команде JSON с `rate_limits`, `scripts/statusline-bridge.sh` копирует этот объект
  в `statusline-limits.json` папки данных worfy (`Application Support/worfy` и `worfy-dev`, или
  `WORFY_DATA_DIR`), worfy читает файл (`src/main/agent/limits.ts:7-8`, `:22-23`). С аргументом скрипт
  передаёт тот же stdin команде пользователя, её вывод проходит как есть.
- У владельца `statusLine.command` в `~/.claude/settings.json` —
  `/Users/alexey/Stuff/CanvasForAI/scripts/statusline-bridge.sh`, файл в dev-checkout. Удалить или
  переместить checkout — Limits из терминала пропадут. У другого пользователя такого checkout-а нет.
- В `.app` скрипта нет: `electron-builder.yml:9-10` берёт только `out/**` и `package.json` (после
  Ticket-а 13 — ещё `harness/`).
- Скрипт и `limits.ts` пишут, что worfy мост не ставит и `settings.json` не правит
  (`scripts/statusline-bridge.sh:13-17`, `src/main/agent/limits.ts:8`, `:11`). После E3 запись
  `statusLine` меняет строка формы переноса Ticket-а 14 — с согласия пользователя (Q19).
- Путь Stable copy постоянный: `scripts/install-stable.sh:25` ставит копию в
  `~/Applications/worfy-stable.app`, а `:79-84` заменяет прежнюю на том же месте.

## Что делаем

1. **Скрипт — в `.app` (Q19).** `scripts/statusline-bridge.sh` попадает в `.app` как
   `Contents/Resources/statusline-bridge.sh` (`extraResources` в `electron-builder.yml`) и остаётся
   исполняемым. Это контракт с Ticket-ом 14: строка `statusLine` формы переноса предлагает
   `<process.resourcesPath>/statusline-bridge.sh`, когда файл там есть. Имя и место файла без
   правки Ticket-а 14 не менять.
2. **Скрипт не зависит от checkout-а.** Поведение прежнее: те же папки данных и `WORFY_DATA_DIR`,
   аргумент — команда пользователя, без `jq` ничего не пишет, строку состояния не роняет. В
   исполняемых строках нет абсолютных путей и ссылок на файлы репозитория.
3. **`statusLine` Ticket 15 не пишет.** Запись меняет только строка формы переноса (Ticket 14) после
   согласия пользователя. Комментарии `scripts/statusline-bridge.sh:13-17` и
   `src/main/agent/limits.ts:7-11` переписать: мост лежит в `.app`, `statusLine` указывает на него
   после согласия в форме переноса (ADR-0040, ADR-0047), worfy по-прежнему только читает
   `statusline-limits.json`.
4. **dev-сборка.** У `pnpm dev` моста из `.app` нет; dev-run видит Limits, которые мост Stable copy
   пишет и в `worfy-dev`, как сейчас.

**Не входит:** строка `statusLine` в форме и запись `settings.json` (Ticket 14); переход машины
владельца (Ticket 16). Предлагать мост пользователю, у которого `statusLine` нет совсем, решения
владельца не требуют (Q19 говорит о замене старой записи); если исполнитель считает, что нужно, —
вопрос владельцу в «Итог».

## Готово, когда

- [x] `@packaged` test (локально, `pnpm test:package` в `gate full`): в `.app` есть `Contents/Resources/statusline-bridge.sh`, исполняемый (`mode & 0o111`), побайтно равный `scripts/statusline-bridge.sh`.
- [x] `@packaged` test: скрипт из `.app` с образцом JSON строки состояния (тот же, что в `test/contract/statusline-bridge.test.ts`) и временным `HOME` с `Library/Application Support/worfy` пишет туда `statusline-limits.json`, равный `rate_limits`; с аргументом команда получает тот же stdin, её вывод проходит без изменений; код выхода 0.
- [x] `@packaged` test: после второго `install-stable.sh` в ту же папку `<копия>/Contents/Resources/statusline-bridge.sh` лежит на том же пути и исполняемый.
- [x] Contract test: в исполняемых строках скрипта (без комментариев) нет `/Users/`, `CanvasForAI` и путей вида `scripts/`.
- [x] `test/contract/statusline-bridge.test.ts` зелёный, его прежние случаи не менялись.
- [x] `grep -n 'never installs' scripts/statusline-bridge.sh src/main/agent/limits.ts` — код 1.
- [x] Test-ы Ticket-а не пишут в настоящий `HOME`: скрипт гоняется только с временным `HOME`.

## Тесты

Сначала падающий test — `@packaged` в `test/e2e/packaged.spec.ts`: в `.app` есть
`Contents/Resources/statusline-bridge.sh`. На main файла там нет — test красный. В «Итог» — как он
падал.

- `test/e2e/packaged.spec.ts` — три `@packaged` test-а: файл в `.app`, запуск из `.app`, путь после
  повторной установки.
- `test/contract/statusline-bridge.test.ts` — новый случай: исполняемые строки без путей checkout-а.

## Где в коде

- `electron-builder.yml`
- `scripts/statusline-bridge.sh` — только комментарии
- `src/main/agent/limits.ts` — только комментарии
- `test/e2e/packaged.spec.ts`
- `test/contract/statusline-bridge.test.ts`

Общих файлов с Ticket-ом 14 нет, он может идти в той же Wave. `electron-builder.yml` и
`test/e2e/packaged.spec.ts` меняет и Ticket 13; этот Ticket идёт после него.

## Итог

- `electron-builder.yml:26-27` — `extraResources` копирует `scripts/statusline-bridge.sh` в
  `Contents/Resources/statusline-bridge.sh`; electron-builder сохраняет право на запуск. Имя и место —
  контракт с Ticket-ом 14: форма переноса предлагает `<process.resourcesPath>/statusline-bridge.sh`.
- `scripts/statusline-bridge.sh` и `src/main/agent/limits.ts` — только комментарии: мост едет в `.app`,
  `statusLine` указывает на него только после согласия в форме переноса (ADR-0040, ADR-0047), сам worfy
  только читает `statusline-limits.json`. Фразы «never installs» больше нет. Команды скрипта не менялись.
- Красный test первым: на main все три `@packaged` test-а падали с ENOENT на
  `Contents/Resources/statusline-bridge.sh`.
- Test-ы: `test/e2e/packaged.spec.ts:376`, `:386`, `:455` — мост в копии (исполняемый, побайтно равен
  исходному), запуск из копии с временным `HOME`, путь после второго `install-stable.sh` (ставит во
  временную папку `mkdtemp`, не в `~/Applications/worfy-stable.app`). `test/contract/statusline-bridge.test.ts:104`
  — в исполняемых строках скрипта нет путей checkout-а; прежние случаи не менялись.

**Влито.** [PR #134](https://github.com/IDSAD-XL/worfy/pull/134) → squash-коммит `4bdfb5a` в `main`. Ревью —
VERIFIED с первого круга. Перед мержем: rebase на `cc1d342`, `GATE_SCOPE=all gate.sh full` — код 0, CI
зелёный. Первый прогон `gate full` у исполнителя упал только на нестабильном
`test/e2e/epic-frame.spec.ts:721` («long names»), повтор зелёный.

**Долг.** Из комментария VERIFIED в PR #134:
- [low] `scripts/statusline-bridge.sh:21` — «nothing else in worfy edits ~/.claude/settings.json» неточно:
  установка plugin-а через `claude plugin` пишет `extraKnownMarketplaces` (ADR-0040, п. 7), форма переноса
  убирает записи hooks (ADR-0047, п. 5 и 8). Предложенная формулировка: «apart from the plugin install
  (ADR-0040) and the migration form, worfy does not edit settings.json».
