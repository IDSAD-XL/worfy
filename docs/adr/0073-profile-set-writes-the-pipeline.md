# 0073 — Поле `workflow.pipeline` пишет отдельный узкий скрипт Harness `bin/profile-set`
Дата: 2026-10-19. Статус: принят.

**Контекст.** Pipeline Project-а — поле `workflow.pipeline` в `profile.json` его Profile-а, вне
репозитория: `~/.claude/worfy-harness/projects/<name>/` (ADR-0067). Ticket 08 Epic-а `worfy-pipeline`
добавляет редактор Pipeline в Settings worfy, и редактору нужен способ записать поле.

Что есть сейчас:

- `bin/profile` только читает: «profile only reads: it writes nothing anywhere»
  (`harness/bin/profile:25`). Тот же контракт записан в spec Epic-а: «`bin/profile` только читает»,
  команды записи Pipeline Epic не добавляет (`.scratch/worfy-pipeline/spec.md:165-166`).
- Правила Pipeline проверяет `bin/profile`: каталог видов, `queued` первым, `done` последним, каждый вид
  один раз (`pipelineOf`, `harness/bin/profile:374`); поле описано в схеме черновика Profile-а
  (`harness/profiles/draft.schema.json:112`).
- Единственный инструмент Harness, который пишет Profile, — `bin/project-connect`: проверяет черновик по
  схеме, пишет `profile.json` и делает commit в git папки Harness (`harness/bin/project-connect:443-467`).
  worfy зовёт его, а не пишет файл сам (`src/main/projects/connect.ts:22-24`).
- ADR-0002: worfy читает источники правды о работе и меняет состояние «только теми же инструментами»
  Harness. ADR-0005: собственное состояние worfy — только в `~/Library/Application Support/worfy/`;
  единственная запись вне него — регистрация Project в общем конфиге Gate.

Вопрос Q-f владельцу (2026-10-19): какой инструмент пишет `workflow.pipeline`.

**Решение** (владелец, 2026-10-19, ответ на Q-f — вариант (b)).

1. `workflow.pipeline` пишет новый скрипт Harness **`bin/profile-set`**, узкий: только это поле
   Profile-а одного Project-а. Других полей он не меняет.
2. Перед записью он проверяет новое значение теми же правилами, что `bin/profile`, — общим кодом, а не
   копией. Неверный Pipeline не пишется: код выхода 1 и причина, как у `bin/profile`.
3. Запись — commit в git папки Harness, так же, как у `bin/project-connect`.
4. Редактор Pipeline в Settings worfy (Ticket 08) зовёт `bin/profile-set` через IPC main process и сам
   `profile.json` не пишет.

**Последствия.**

- `bin/profile` остаётся только читающим; контракт spec-а и ADR-0002 не меняются.
- Ticket 08 Epic-а `worfy-pipeline` становится платформенным PR: он добавляет скрипт Harness (ADR-0056,
  пункт 2). Вердикт Windows — по ADR-0071: если PR не трогает Terminal, окна, e2e и упаковку, достаточно
  полного run-а на Windows-runner-е; до мержа Ticket-а 66 Epic-а `worfy-windows` — gate full на ПК
  (ADR-0071, «Последствия»).
- Список файлов Ticket-а 08 растёт: скрипт и его test, IPC в main, preload, общие типы IPC — кроме
  раздела Settings.
- Каждый мерж с правкой `harness/` кончается `pnpm install:stable` (ADR-0047): без пересборки Stable
  copy редактор позовёт старый plugin без `bin/profile-set`.

## Considered Options

- **(a) Команда записи в самом `bin/profile` (`bin/profile set workflow.pipeline …`).** Отвергнуто:
  ломает контракт «`bin/profile` только читает» (`harness/bin/profile:25`,
  `.scratch/worfy-pipeline/spec.md:165`): у скрипта, который читают все агенты и hook-и, появилась бы запись.
- **(b) Отдельный узкий скрипт `bin/profile-set`** (выбрано).
- **(c) worfy пишет `profile.json` сам.** Отвергнуто: противоречит ADR-0002 (состояние workflow worfy
  меняет только инструментами Harness) и ADR-0005 (запись worfy вне `Application Support` — только
  регистрация в конфиге Gate); без commit-а в git папки Harness правку не видно в истории Profile-а.
