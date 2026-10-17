# 09 — Gate пишет вердикт JSON-файлом, worfy читает его, а не слово «зелено»

Type: task
Status: done 2026-10-07
PR: #114
Blocked by: 08
Source: решения владельца 2026-10-07: Q6 (Harness на английском; машинные строки — английские константы или JSON, старые русские читаются) и «Машинный контракт Gate» (Gate пишет вердикт JSON-файлом, worfy читает его); [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness на английском, язык из Profile, машинный контракт без языка); [spec.md](../spec.md)

## Что происходит

- Gate (`gate.sh`, проверка готовности изменений) сообщает вердикт двумя способами, и оба — не
  данные для машины:
  - строка `[gate] зелено | красно | ничего не прогналось | ПРОВЕРИТЬ НЕ УДАЛОСЬ` в выводе
    (`~/.claude/hooks/gate.sh:258`, `:288`, `:335`, `:348`, `:361-365`, `:368`; после Ticket-а 02 —
    импорт Harness в репозиторий — это `harness/hooks/gate.sh`);
  - маркеры `red-<key>-<tag>` и `unverified-<key>-<tag>` в папке состояния Gate (`:156-157`,
    `:333`, `:346`). Зелёный прогон маркеры удаляет (`:356`); файла «зелено» нет.
- Код выхода вердикт не различает: 0 — это и «зелено», и «ничего не прогналось», и «проверить не
  удалось — окружение недоступно» (`gate.sh:18-21`).
- worfy берёт вердикт worktree так (`src/main/gate/state.ts:1-14`, `:353-372`): маркер; без
  маркера — последняя строка `[gate] …` в транскриптах Session-ов этого worktree. Строки
  узнаются по русским словам (`src/main/gate/state.ts:97-104`). Зелёное worfy видит только в
  транскрипте: Gate, который запустил hook в Session без транскрипта в этом worktree, для worfy —
  «нет данных».
- Откуда вердикт, говорит `GateState.source`: `marker`, `transcript` или `none`
  (`src/shared/ipc/checks.ts:33-39`). Renderer поле `source` не показывает.
- Ticket 08 (перевод `bin/` и скриптов `hooks/`, состояние в `HARNESS_HOME`) переводит и
  переносит `gate.sh`. Машинный вердикт по плану Epic-а — этот Ticket.
- Test-ы `harness/{bin,hooks}/tests/*.test.sh` после Ticket-а 02 идут в `pnpm test` и в CI: их
  находит и запускает `test/contract/harness-scripts.test.ts`, с `HOME` во временной пустой папке.

## Что делаем

1. **Файл вердикта** (Q6, «Машинный контракт Gate»). Каждый прогон `harness/hooks/gate.sh` в
   git-worktree пишет `verdict-<tag>.json` в папку состояния Gate — туда же, где маркеры (`$STATE`
   в `gate.sh`; после Ticket-а 08 — внутри `HARNESS_HOME`). `tag` — тот же, что у маркеров:
   первые 8 hex SHA-1 пути worktree (`gate.sh:86`). Файл перезаписывается каждым прогоном и
   говорит об итоге последнего. Ключи и значения — английские:
   - `version` — `1`;
   - `outcome` — `green` | `red` | `unverified` | `none`;
   - `profile` — `fast` | `full`;
   - `worktree` — корень worktree (`$repo`, `git rev-parse --show-toplevel`);
   - `key` — ключ записи реестра Gate или `null`, если Project не определён;
   - `head` — SHA `HEAD` или `null`;
   - `exit` — код выхода этого прогона;
   - `at` — время UTC в ISO 8601;
   - `reason` — одна строка по-английски для `unverified` и `none`, иначе `null`.

   Какой путь `gate.sh` что пишет:

   | Путь в `gate.sh` (нынешние строки) | `outcome` | `exit` |
   |---|---|---|
   | зелёный прогон или кэш (`:352-366`) | `green` | 0 |
   | красный прогон (`:332-340`) | `red` | 2 |
   | окружение недоступно (`:343-351`) | `unverified` | 0 |
   | нет node, упал резолвер реестра, Project не в реестре (`not_verified`, `:98-125`) | `unverified` | 3 |
   | упал резолвер плана (`:268-270`) | `unverified` | 3 |
   | ничего не прогналось (`:258-259`, `:288-289`, `:368`) | `none` | 0 |
   | каталог вне git (`:78-80`) | файла нет | 0 |

2. **Запись целиком или никак.** Файл пишется во временный файл в той же папке и переносится
   `mv`: worfy не читает недописанный JSON. Пишет bash без node — node может не быть, и это один
   из случаев `unverified`. Строки в JSON экранируются: путь worktree с пробелом или кавычкой
   даёт разбираемый файл.
3. **Маркеры, строки `[gate] …` и коды выхода — как были.** Их читают `stop.sh` (держит ход на
   красном), skills и agents. Текст строк этот Ticket не меняет.
4. **worfy читает файл** (`src/main/gate/state.ts`). Порядок для worktree: маркер `red` → маркер
   `unverified` → файл вердикта → строка `[gate] …` в транскриптах. Маркер стоит раньше файла:
   после красного прогона прогон «ничего не прогналось» пишет в файл `none`, а worktree остаётся
   красным, пока маркер есть (`gate.sh:15-16`: красное снимает только прогон, который что-то
   проверил) — как сейчас.
   - Файл берётся, только если его `worktree` совпадает с путём worktree на диске (защита от
     совпадения 8 знаков `tag`) и JSON проходит схему. Иначе — следующий источник, причина —
     одна строка в лог.
   - `GateState.source` получает значение `file`, `at` — время из файла.
   - Строки транскрипта — запасной путь: старые транскрипты и Gate без файла вердикта (до
     Ticket-а 16 — перехода машины владельца на plugin — Session-ы идут на старом Harness в
     `~/.claude`). Разбор узнаёт русские слова и, если Ticket 08 перевёл строки `[gate] …`,
     английские: точный текст исполнитель берёт из `harness/hooks/gate.sh` на момент работы.
5. **worfy ничего не пишет** — ни в папку состояния Gate, ни в транскрипты (ADR-0005 — worfy
   пишет только в свою папку данных).

ADR не нужен: вердикт Gate как JSON решён в ADR-0044; этот Ticket его выполняет.

**Не входит:** в какой папке worfy ищет состояние Gate (`<claudeHome>/gate/` или
`~/.claude/worfy-harness/gate/`) — Ticket 12; как вердикт читают skills и agents — как их оставили
Ticket-ы 05–07; перевод строк `[gate] …` — Ticket 08.

## Готово, когда

- [x] `bash harness/hooks/tests/gate-verdict.test.sh` — код 0. На временных репозитории, реестре и папке состояния каждый путь таблицы пункта 1 оставляет `verdict-<tag>.json` с нужными `outcome`, `exit`, `profile`, `key` и `worktree`; в каталоге вне git файла нет.
- [x] Тот же test: worktree с пробелом и кавычкой в пути — `jq -e .` по файлу даёт код 0, `worktree` равен пути.
- [x] Тот же test: второй прогон перезаписывает файл итогом второго; после прогона в папке состояния нет временных файлов Gate.
- [x] `bash harness/hooks/tests/gate-notverified.test.sh` и `bash harness/hooks/tests/gate-unregistered.test.sh` — код 0 без правок ожиданий: маркеры, строки и коды выхода не изменились.
- [x] Unit (`test/unit/gate-state.test.ts`): файл `green` при транскрипте без строк Gate — `{ outcome: 'green', source: 'file', at: <время из файла> }`; маркер `red` и файл `none` — `red` из маркера; файл есть, а в транскрипте строка новее — вердикт из файла; файл с чужим `worktree` и битый файл — вердикт из транскрипта; файла нет — как до Ticket-а (прежние test-ы без правок ожиданий).
- [x] Unit: строки транскрипта с русскими словами дают вердикт, как раньше; если `harness/hooks/gate.sh` после Ticket-а 08 печатает строки по-английски — они тоже.
- [x] Unit: test «writes nothing» (`test/unit/gate-state.test.ts:338`) с файлом вердикта в папке состояния — списки файлов Claude home и Project-а до и после чтения одинаковы.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (`pnpm test` включает `test/contract/harness-scripts.test.ts`, то есть новый test Gate с пустым `HOME`); CI на PR зелёный.
- [x] `GATE_SCOPE=all bash ~/.claude/hooks/gate.sh full` на ветке после rebase — код 0 и строка `[gate] зелено` (e2e бейджей `test/e2e/checks-badges.spec.ts` идёт здесь).

## Тесты

Сначала падающий test — `harness/hooks/tests/gate-verdict.test.sh`, случай «зелёный прогон
оставляет `verdict-<tag>.json` с `outcome: green`». На нынешнем main файла нет — test красный. В
«Итог» — как он падал.

- `harness/hooks/tests/gate-verdict.test.sh` — новый, по образцу `gate-notverified.test.sh`:
  `gate.sh` ищется рядом с test-ом, как у остальных test-ов после Ticket-а 02; временные
  репозитории, реестр и папка состояния — через переменные для test-ов (сейчас
  `CLAUDE_GATE_CONFIG`, `CLAUDE_GATE_STATE`; если Ticket 08 их переименовал — те, что он оставил);
  скрипты профиля Gate — `true` и `false`. Без node на `PATH` — случай `unverified`, код 3.
- `test/unit/gate-state.test.ts` — источник `file`, порядок источников, проверка `worktree`,
  битый файл, английские строки.

## Где в коде

- `harness/hooks/gate.sh` (из `~/.claude/hooks/gate.sh`)
- `harness/hooks/tests/gate-verdict.test.sh` — новый
- `src/main/gate/state.ts`
- `src/shared/ipc/checks.ts`
- `test/unit/gate-state.test.ts`

Формат файла описан в шапке `gate.sh` и схемой zod в `state.ts`. Новый test Gate в CI вписывать
не нужно: его находит `test/contract/harness-scripts.test.ts`. Общие файлы с Ticket-ом 12 (worfy
ищет Harness в папке plugin) — `src/main/gate/state.ts` и `test/unit/gate-state.test.ts`: в одну
Wave они не попадут, второй делает rebase. Файл вердикта лежит рядом с маркерами, и worfy читает
его из той же папки, что и маркеры, — какая это папка, решает Ticket 12.

## Итог

- `harness/hooks/gate.sh` пишет `verdict-<tag>.json` в папку состояния Gate на каждом пути таблицы пункта 1; формат описан в шапке скрипта. Запись — `mktemp` в той же папке и `mv`; экранирование строк JSON — посимвольно на bash, без node и без `${s//…}` (замена с обратной косой чертой ведёт себя по-разному в bash 3.2 и 5.2). Маркеры, строки `[gate] …` и коды выхода не менялись: `gate-notverified.test.sh` (32 проверки) и `gate-unregistered.test.sh` (10) зелёные без правок.
- Падающий test первым: `harness/hooks/tests/gate-verdict.test.sh` на main — «passed 3, failed 14», каждый путь падал с «no …/state/verdict-<tag>.json» (зелёный прогон: `FAIL green run -> outcome green, exit 0, profile fast, key t, head (no …/verdict-e41243ab.json; rc=0 …)`). После правки — «passed 20, failed 0».
- worfy (`src/main/gate/state.ts`) читает файл после маркеров `red` и `unverified` и до транскриптов; `GateState.source` получил значение `file`, `at` — время из файла. Файл с чужим `worktree`, битый JSON или не та схема — следующий источник и одна строка в лог на файл, пока причина та же.
- Строки `[gate] …` Ticket 08 не перевёл — они по-прежнему русские, поэтому разбор транскрипта узнаёт только русские слова. Unit test «knows every verdict word harness/hooks/gate.sh prints» берёт слова прямо из `gate.sh` и покраснеет, если их переведут без правки `GATE_LINE`.
- Решено без владельца, подтверждено владельцем 2026-10-12:
  - тексты `reason` для `unverified` и `none` — свои английские формулировки (в тикете их нет);
  - прогон, который не записал файл (не сработал `mktemp`, `printf` или `mv` — например, диск полон — или прогон вышел раньше записи), удаляет файл прошлого прогона через `trap … EXIT`: иначе worfy показал бы прошлое зелёное поверх нынешнего «красно» (находка ревью круга 1; test — случай 9 в `gate-verdict.test.sh`, с `mktemp`, который падает);
  - worfy не берёт файл, если его `head` не совпадает с HEAD worktree из `git worktree list` (worktree удалён и создан заново по тому же пути); тогда — транскрипт и строка в лог;
  - файл worfy ищет там же, где маркеры, — `<claudeHome>/gate/state`. Gate из `harness/` пишет в `$HARNESS_HOME/gate/state`, замороженный `~/.claude` файла не пишет, так что в работе приложение получит вердикт из файла только после Ticket-ов 12 и 16.

**Влито.** [PR #114](https://github.com/IDSAD-XL/worfy/pull/114) → squash-коммит `8b9eacb` в `main`. Ревью —
REJECTED → VERIFIED, один круг доработки. В первом круге найден ложный зелёный: если `mktemp` падал, файл
вердикта прошлого прогона оставался, и worfy показывал прошлое «зелено» поверх нынешнего «ПРОВЕРИТЬ НЕ
УДАЛОСЬ». Исправлено `trap … EXIT` (`gate.sh:119-121`): прогон, который не записал свой файл, удаляет прежний.
Ревьюер повторил сценарий с падающим `mktemp` — exit 2, `[gate] красно`, файла нет. Прогоны во втором круге:
`gate-verdict` 20/0, `gate-notverified` 32/0, `gate-unregistered` 10/0, vitest 78 passed, `gate fast` exit 0.
Перед мержем: rebase на `aea94e3`, head `6900040`, `GATE_SCOPE=all gate full` — exit 0, CI зелёный,
`mergeStateStatus` CLEAN. На head `6900040` было два прогона CI: run 37645629910 отменён, run 37645630325 —
success. Скрипт мержа взял отменённый, получил код 1 и всё равно влил PR (урок процесса — в HANDOFF). Что head
прошёл CI, проверено после мержа; push-прогон `8b9eacb` в `main` (run 37647843579) — тоже success.

**Долг.**
- [low] `src/main/gate/state.ts:127-129` — комментарий объясняет сверку `head` файла с HEAD worktree тем, что
  worktree удалили и создали заново по тому же пути. Сверка срабатывает и после обычного «gate, потом коммит»
  (`state.ts:148`): worfy уходит к транскрипту и пишет предупреждение раз на новый HEAD. Поведение то же, что у
  ключа кэша Gate; неверен только комментарий (и пункт «Решено без владельца» выше).
- [low] SIGKILL (hook убит по timeout) не запускает `trap … EXIT`: файл вердикта прошлого прогона остаётся.
  Было и до Ticket-а.
- Решение без владельца — файл вердикта в живом приложении появится только после Ticket-ов 12 (worfy находит
  Harness в папке plugin) и 16 (переход машины владельца на plugin) — в HANDOFF, «Ждёт владельца».

### Долги из HANDOFF (2026-10-08)

- Урок процесса (закрыт): скрипт мержа Orchestrator-а влил PR #114 при красном итоге проверки CI. На head
  `6900040` было два прогона CI: run 37645629910 отменён, run 37645630325 — success. Скрипт взял
  отменённый, получил код 1 и всё равно влил PR: проверки кода выхода CI в нём не было. Head прошёл CI во
  втором прогоне (проверено после мержа), push-прогон влитого `8b9eacb` (run 37647843579) — тоже success.
  Скрипт исправлен: отменённые прогоны пропускаются, красный CI останавливает мерж.
