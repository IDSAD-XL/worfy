# Code story — worfy-harness-eval 19: Spike: SCBench (SlopCodeBench) как источник задач пилота

Kind: pr · Epic: worfy-harness-eval · Ticket: 19 · PR: - · Language: ru

## 1. Что было не так

Владелец предложил SCBench как источник задач пилота, но никто не проверял, годится ли он: загрузит ли агент
`claude_code` runner-а plugin worfy, можно ли брать и публиковать задачи, не штрафуют ли метрики качества за test-ы
агента, нужна ли сеть, пойдёт ли runner на подписке и сколько стоит проба. Код продукта PR не меняет: он несёт
ответы с источниками в «Итог» Ticket-а.

- Требование: [Вопросы](../issues/19-spike-scbench-как-источник-задач-пилота.md#вопросы)

## 2. Plugin worfy подключается флагом и монтированием, без правки runner-а

Code: `.scratch/worfy-harness-eval/issues/19-spike-scbench-как-источник-задач-пилота.md:81-89` · key lines: 84, 86, 88

```md
   - Агент собирает командную строку сам: `claude --output-format stream-json --verbose [--model] [--max-turns]
     [--allowedTools] [--disallowedTools] [--permission-mode] <extra_args> --print -- <prompt>`
     (`scb/src/slop_code/agent_runner/agents/claude_code/agent.py:947-989`). Поле конфига `extra_args` (`:120`)
     дописывается в конец (`:986`). Поэтому ветка worfy — свой конфиг агента с `extra_args: ["--plugin-dir",
     "/opt/worfy-plugin"]`.
   - Папку plugin-а в container кладёт поле `extra_mounts` конфига окружения
     (`scb/src/slop_code/execution/docker_runtime/models.py:67`). Монтируется только на чтение и не внутрь
     `/workspace` (`scb/src/slop_code/execution/docker_runtime/exec.py:136-149`). Значит, файлы plugin-а не попадают
     в snapshot и в метрики.
```

- Что делает: отвечает на вопрос 1. Две ветки пилота отличаются только `extra_args` с `--plugin-dir` и
  монтированием папки plugin-а на чтение вне рабочей папки.
- Почему здесь: Ticket требует ответы в «Итог» со ссылкой на файл и строку репозитория SCBench на commit-е (раздел
  «Test-ы»).
- Без него: Ticket 10 не знал бы, нужен ли fork runner-а, чтобы сравнить ветки.
- Требование: [Вопросы, п. 1](../issues/19-spike-scbench-как-источник-задач-пилота.md#вопросы)
- Риски и пробелы test-ов: прочитано, не запущено — без модели и входа запуск агента запрещён. `step_limit: 100`
  по умолчанию режет ветку worfy раньше; это записано рядом, в той же строке «Итог».

## 3. Test-ы агента входят в erosion и verbosity

Code: `.scratch/worfy-harness-eval/issues/19-spike-scbench-как-источник-задач-пилота.md:115-130` · key lines: 116, 118, 121, 127, 129

```md
3. **Да: test-ы, которые пишет сам агент, входят в verbosity и erosion.**
   - Runner считает обе метрики командой `uvx scb-check==0.1.3 check --report --include-all <snapshot>`
     (`scb/src/slop_code/metrics/checkpoint/driver.py:28`, `:76-83`).
   - `scb-check` берёт каждый `.py` под snapshot-ом. Исключены только папки окружений и кэшей: `.venv`, `venv`,
     `build`, `dist`, `__pycache__` и подобные (`scb_check/walker.py:11-28`). Папки `tests` и файлов `test_*.py` в
     списке нет.
   - Snapshot runner-а убирает только скрытые test-ы оценки `.evaluation_tests/*` и `tests/assets`
     (`scb/src/slop_code/execution/models.py:128`, `:318`). Test-ы агента в нём остаются.
   - `--include-all` отключает даже подавления в коде (`scb_check/commands/check.py:172-177`).
   - Статья этого не обсуждает: в разделе 2.3 erosion — по «all callables», verbosity — по LOC, без фильтра файлов.
   - Вывод: ветка, которая пишет больше test-ов, получает больше LOC и функций в знаменателе и больше клонов и
     ast-grep находок в числителе. Знак сдвига заранее не известен, но сдвиг есть.
   - Есть лазейка. `scb-check` читает исключения из `scb-check.toml` или `[tool.ruff] exclude` в `pyproject.toml`
     snapshot-а (`scb_check/config.py:37-46`, `:98-105`): агент может сам вывести свои test-ы из счёта.
   - Для пилота: считать `scb-check` дважды — как runner (сравнимо с leaderboard) и на копии без test-файлов агента
     и без его конфигов `scb-check`/ruff.
```

- Что делает: отвечает на вопрос 3. Сами метрики считает отдельный пакет `scb-check`, а не runner, поэтому
  прочитан и он; итог — двойной подсчёт в пилоте.
- Почему здесь: вопрос 3 Ticket-а прямо спрашивает, штрафуется ли ветка worfy за test-ы.
- Без него: разница веток по erosion и verbosity смешала бы качество кода с количеством test-ов.
- Требование: [Вопросы, п. 3](../issues/19-spike-scbench-как-источник-задач-пилота.md#вопросы)
- Риски и пробелы test-ов: направление сдвига не измерено — для этого нужен платный run.

## 4. Предложение владельцу

Code: `.scratch/worfy-harness-eval/issues/19-spike-scbench-как-источник-задач-пилота.md:191-205` · key lines: 191, 200, 202, 203

```md
**Предложение: пятое семейство, малое; не замена.**
- Почему не замена. Четыре нынешних семейства меряют то, что владелец поставил в заголовок пилота (Q15): ложное
  «готово», правку test-ов, дефекты на ревью и опасные действия. SCBench их не меряет. Он меряет рост кода при смене
  требований, а этого нет ни в одном семействе.
- Почему малое:
  - test-ы агента идут в метрики (вопрос 3), и это требует двойного подсчёта;
  - Autopilot-ветка не ложится (вопрос 1);
  - доля решённых загрязнена (вопрос 8);
  - полный набор стоит около 1 160 USD на три run-а двух веток (вопрос 6).
- Состав: 4 задачи выше, только ветки «worfy, обычная работа» и «Claude Code без plugin-а», `step_limit: 0` в
  обеих. В отчёте — ложное «готово», доля checkpoint-ов, erosion и verbosity в двух подсчётах.
- Цена платной пробы — около 36–45 USD по ценам API за один run на ветку, потолок 100 USD.
- Если владелец не хочет менять Ticket 08 под задачи из нескольких checkpoint-ов, — «не берём».

Решает владелец (пункт «вручную» выше), запись — в «Решения» Ticket-а 10.
```

- Что делает: выбирает одно из трёх решений, которые просит Ticket, с причиной и ценой пробы.
- Почему здесь: второй пункт «Готово, когда».
- Без него: владелец получил бы факты без варианта решения, и Ticket 10 ждал бы ещё один круг.
- Требование: [Готово, когда](../issues/19-spike-scbench-как-источник-задач-пилота.md#готово-когда)
- Риски и пробелы test-ов: цена — по средней leaderboard (0,99 USD за checkpoint у Opus 5.5 Medium). Надбавка ветки
  worfy в полтора раза — оценка, не замер.

## 5. Что сознательно не меняли

Ни runner пилота (Ticket 08), ни scorer `scripts/eval-outcome-score.mjs`: Ticket разрешает их только читать. Образ
Docker SCBench не собирался, агент не запускался: на вопросы хватило чтения кода.

## 6. Как проверено

`pnpm lint` — exit 0. Ссылки «файл:строка» перечитаны в клонах перед записью. Клоны, пакеты и временный HOME
удалены; container-ов этот Ticket не запускал.

## Проверить себя

1. Почему файлы plugin-а worfy не исказят erosion и verbosity ветки worfy, а test-ы агента исказят?
   - Ответ: plugin монтируется на чтение вне `/workspace` и в snapshot не попадает; test-ы агента лежат в рабочей
     папке, а `scb-check` берёт каждый `.py` под snapshot-ом.
   - Строки: `.scratch/worfy-harness-eval/issues/19-spike-scbench-как-источник-задач-пилота.md:87`, `.scratch/worfy-harness-eval/issues/19-spike-scbench-как-источник-задач-пилота.md:118`
2. Почему для SCBench не нужны несколько prompt-ов в одной Session?
   - Ответ: runner сбрасывает контекст на каждом checkpoint-е и переносит только рабочую папку; второй prompt в той
     же Session бывает только при повторе после ошибки.
   - Строки: `.scratch/worfy-harness-eval/issues/19-spike-scbench-как-источник-задач-пилота.md:163`, `.scratch/worfy-harness-eval/issues/19-spike-scbench-как-источник-задач-пилота.md:165`
