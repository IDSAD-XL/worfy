# 07 — Режим расширенного ревью перед рискованным merge: две линзы по всей ветке, по желанию на двух моделях

Type: task
Status: claimed — 2026-10-15
Blocked by: 01, 02
Source: решение владельца 2026-10-09 («Хорошие идеи, сохрани их и добавь в планы к имплементации»), пункт «режим max review» из таблицы, низкий приоритет; [исследование](../../../docs/research/2026-10-09-ponytail-pstack-thermos.md), разделы о Thermos (plugin Cursor: два reviewer-а и сводка ведущего агента) и о skill `interrogate` из pstack (один reviewer на модель, один prompt; разнообразие даёт модель, а не роль); [spec.md](../spec.md)

## Что происходит

- **Обычное ревью смотрит на Ticket.** В Wave diff проверяет один verifier (reviewer с линзой «отчёт
  Implementer-а», `harness/skills/epic-wave/SKILL.md`, раздел 3). Агенты-скептики (по одному
  `worfy:reviewer` на находку, задача — опровергнуть) работают только в узком круге доработки
  (`:305-314`): у Ticket-а на критическом пути (≥3 зависимых Ticket-а не в `done`) второй круг дал
  подтверждённые находки не уровня `high`. У Ticket-а без зависимых узкий круг — только по решению
  владельца. В остальных случаях находки второго круга никто отдельно не перепроверяет.
- **Линзы Profile работают в двух местах** (spec, «Как устроено», пункт «Где работают линзы»):
  ship-ticket, шаг 7, и правило Orchestrator-а Phase 2 — ревью перед каждым отчётом
  (`harness/hooks/rules/orchestrator.md:105-111`). В Gate Wave их нет. В Phase 2 линзу выбирает
  Orchestrator, и ревью идёт по diff-у, о котором он отчитывается, а не по всей ветке Ticket-а перед
  merge.
- **Для рискованного merge этого мало.** Пример — ветка, которая трогает Gate, Autopilot или формат
  файлов, которые читает worfy. Ошибка там бьёт по всем следующим Wave.
- **Все reviewer-ы идут на одной модели.** В `harness/agents/reviewer.md` стоит `model: inherit`.
  Инструмент запуска Subagent-а принимает поле `model` (`opus`, `sonnet`, `haiku`, `fable`). Значит,
  ту же линзу можно запустить на двух моделях Claude без новых агентов.
- **Ticket 01** вводит четыре группы находок (Act on, Consider, Noted, Dismissed). **Ticket 02** —
  линзу «упрощение». Этот режим использует обе.

## Что делаем

1. **Новый skill `harness/skills/max-review/SKILL.md`** (`/worfy:max-review`), по-английски:
   - вход — ветка и база; ревью всей ветки (`git diff <база>...HEAD`), а не одного круга доработки;
   - линзы: «корректность» и «упрощение»;
   - по желанию каждая линза — на двух моделях (поле `model` при запуске `worfy:reviewer`); один и тот
     же бриф;
   - сводка: находка у двух моделей или двух линз весит больше; потом скептики, как в epic-wave,
     раздел 3; потом четыре группы Ticket-а 01;
   - режим ничего не правит и не делает merge: его итог — отчёт и вердикт (пункт 3).
2. **Когда запускается:**
   - по просьбе владельца — командой skill-а;
   - в epic-wave, раздел 4 (merge), перед merge Ticket-а с пометкой о риске. Вид пометки — открытый
     вопрос ниже. К этому моменту Gate (раздел 3) уже дал Ticket-у `VERIFIED`.
3. **Вердикт и где он записан.** Первая строка отчёта — `MAX-REVIEW: VERIFIED` или
   `MAX-REVIEW: REJECTED: <находки группы Act on>`. `REJECTED` — когда после скептиков в группе
   Act on осталась хотя бы одна находка. Вердикт пишется туда же, куда epic-wave, раздел 3, пишет
   вердикты Gate, но с префиксом `MAX-REVIEW:`:
   - с PR — комментарий в PR;
   - `local-green` (merge без PR) — пустой commit `gate: MAX-REVIEW: …` на ветке Ticket-а;
   - Silent mode — строка `gate: MAX-REVIEW: …` в конце файла Ticket-а.

   Префикс отделяет вердикт max-review от кругов доработки Gate — как `NARROW:` у узкого круга
   (ADR-0046):
   - круги доработки epic-wave считает по комментариям, которые начинаются с `REJECTED`
     (`harness/skills/epic-wave/SKILL.md:262`), и по строкам `^gate: REJECTED` (`:270`, `:280`).
     `MAX-REVIEW: REJECTED` в этот счёт не входит;
   - worfy берёт вердикт PR из последнего комментария, первая строка которого начинается с
     `VERIFIED` / `REJECTED` или `NARROW: VERIFIED` / `NARROW: REJECTED` (`src/main/github/prs.ts:164-176`).
     `MAX-REVIEW: …` под это правило не подходит, и worfy по-прежнему показывает вердикт Gate.
4. **Что делает `REJECTED`.** Нового круга доработки нет: Ticket уже прошёл свои круги в разделе 3.
   - Ticket не вливается: `ticket block` с причиной «max-review REJECTED» и номером PR, строка
     `blocked` в отчёте Wave — так же, как после второго `REJECTED` Gate. Находки Act on — в отчёт и
     в «Итог» Ticket-а. Доработку или merge решает владелец.
   - Без человека (Autopilot) — то же, без вопроса и без ожидания. Плюс строка в списке «Ждёт
     владельца» файла состояния: max-review REJECTED — решение владельца. В skill-е эта строка — только
     по-английски, без русского примера. Иначе её пришлось бы вносить в `ALLOWED`
     `epic-wave-ship-ticket.test.sh`, а этот test в той же Wave 3 правит Ticket 04.
   - `MAX-REVIEW: VERIFIED` — merge в обычном порядке раздела 4.
   - Возобновление после перерыва: у Ticket-а с пометкой о риске нет `MAX-REVIEW:` — max-review до
     merge; иначе вердиктом считается последний `MAX-REVIEW: …`. Это правило пишется и в раздел
     epic-wave «How to resume a wave» — рядом со строками о `NARROW:`, для PR и для `local-green`.
     С `local-green` тот раздел читает состояние Ticket-а по commit-ам `gate:` на его ветке («no
     last `gate: VERIFIED` — run the gate»). Commit `gate: MAX-REVIEW: …` после `gate: VERIFIED` не
     должен запускать Gate заново.
   - По просьбе владельца вне Wave вердикт тоже пишется с префиксом (если PR есть — комментарием) и
     ничего не блокирует: решает владелец.
5. **Стоимость в тексте skill-а:** режим стоит в 2–4 раза больше обычного ревью. Без пометки и без
   просьбы он не запускается.
6. **Строка в `harness/README.md`**, таблица skills: `max-review`.
7. **Список skills в contract test-е.** Новая папка `harness/skills/max-review/` роняет
   `test/contract/harness-migrate.test.ts:241`: он сравнивает список папок `harness/skills/` с
   `[...HARNESS_SKILLS, 'connect-project']`. В эту строку добавить `'max-review'` рядом с
   `'connect-project'`. `HARNESS_SKILLS` в `src/main/harness/migrate/plan.ts:20` не трогать: это
   skills старого Harness, которые перенос предлагает удалить (Q19).

## Готово, когда

- [x] Новый test `harness/bin/tests/max-review.test.sh`:
  - skill есть, в нём обе линзы, поле `model`, скептики и четыре группы;
  - в epic-wave, раздел 4, есть вызов `/worfy:max-review` для Ticket-а с пометкой о риске;
  - в skill-е и в epic-wave, раздел 4, — префикс `MAX-REVIEW:`, три места записи вердикта и правило
    «`MAX-REVIEW: REJECTED` → `ticket block`, без круга доработки»;
  - в разделе epic-wave «How to resume a wave» — правило о `MAX-REVIEW:`;
  - кириллица — только в разрешённых строках (названия линз из Profile).
  Код 0. Сначала test красный: skill-а нет.
- [x] `test/contract/harness-migrate.test.ts` — код 0 (`pnpm test`): в списке `:241` есть
  `max-review`, `HARNESS_SKILLS` не изменён. Сначала test красный: папка skill-а есть, имени в списке
  нет.
- [x] `harness/bin/tests/epic-wave-ship-ticket.test.sh` без правок — код 0: новые строки epic-wave
  по-английски.
- [ ] Ручной прогон на одной влитой ветке с двумя моделями: число находок у каждой модели, общих, и
  время прогона — в «Итог». Это и есть замер стоимости.
- [x] Источник назван (spec, «Решения владельца», пункт 1). В `max-review/SKILL.md` — строки `Source:`
  для Thermos и pstack (`interrogate`) с путём к файлу и SHA коммита. Дословно взятый текст — ещё и
  пометка MIT: строка copyright владельца источника и полный
  текст лицензии из его `LICENSE` на том же коммите.
- [x] `gate.sh fast` — код 0 и строка `[gate] зелено (fast)`.

## Где в коде

- `harness/skills/max-review/SKILL.md` — новый
- `harness/skills/epic-wave/SKILL.md` — раздел 4 и раздел «How to resume a wave»
- `harness/README.md` — таблица skills
- `harness/bin/tests/max-review.test.sh` — новый
- `test/contract/harness-migrate.test.ts` — строка 241, список skills

## Вне скоупа

- Модели другого семейства (не Claude): нужен внешний CLI.
- Запуск этого режима в ship-ticket вне Wave: владелец вызывает skill сам.
- Автоматическая пометка риска по diff-у.
- Показ вердикта max-review в worfy: worfy читает только вердикты Gate и `NARROW:`
  (`src/main/github/prs.ts:164`).

## Риски

- **Стоимость и время.** 4 reviewer-а вместо одного verifier-а и скептики сверху. Поэтому режим только
  по пометке или просьбе.
- **Разногласия моделей.** Без групп Ticket-а 01 сводка станет нечитаемой; поэтому 01 — блокер.
- **Открытый вопрос: как пометить Ticket рискованным.** Новая строка шапки (`Risk: high`) — проверить,
  что `epic-status` и `src/main/workflow/reader.ts` её пропускают. Или слово в «Готово, когда». Решает
  исполнитель, итог — в «Итог».
- **Открытый вопрос: какие две модели.** Предложено: модель Orchestrator-а и `sonnet`. Решает
  исполнитель по замеру.
- **Общий файл с worfy-windows/13 и 17.** 13 правит `harness-migrate.test.ts`, а 17 добавляет skill
  `gate-queue` и тоже упирается в строку `:241`. Кто вливается вторым — rebase, обе папки в списке и
  все проверки заново: CI на Linux и `GATE_SCOPE=all` gate full на Mac, в нём и `pnpm test` (spec,
  раздел «Порядок относительно worfy-windows и worfy-harness»).

## Итог

Сделано в ветке `worfy-review/07`.

- **Skill `harness/skills/max-review/SKILL.md`** (`/worfy:max-review <branch> [<base>]`): ревью всей
  ветки (`git diff <base>...<branch>`), линзы `correctness` (`корректность`) и `simplification`
  (`упрощение`), каждая по умолчанию на двух моделях — четыре `worfy:reviewer` с одним брифом на
  линзу, у каждого свой worktree. Затем сводка (находка у двух моделей или двух линз весит больше,
  карта согласия), скептики по одному на находку `high`/`med` (находку одной модели опровергает
  другая модель), четыре группы Ticket-а 01 и вердикт `MAX-REVIEW: VERIFIED` /
  `MAX-REVIEW: REJECTED: <Act on>`. Три места записи: комментарий PR, пустой commit
  `gate: MAX-REVIEW: …` (`local-green`), строка в файле Ticket-а (Silent mode). `REJECTED` в Wave —
  `ticket block` без круга доработки; без человека — ещё строка «max-review REJECTED — the owner's
  decision» в списке ожидания владельца (только по-английски). Вне Wave вердикт ничего не блокирует.
  Цена названа: в 2–4 раза дороже обычного ревью, без пометки и просьбы режим не запускается.
- **epic-wave**: раздел 4 — абзац «Max review of a risky ticket» перед «Local merge»; «How to resume
  a wave» — правило для PR и для `local-green` и блок, который печатает последний вердикт Gate
  (`GATE=`) мимо commit-ов `gate: MAX-REVIEW:` и последний вердикт max-review (`MAX-REVIEW=`). Так
  commit `gate: MAX-REVIEW: …` после `gate: VERIFIED` не запускает Gate заново.
- **Test** `harness/bin/tests/max-review.test.sh` (72 проверки): текст skill-а и epic-wave, плюс
  три поведения на настоящих данных — вердикт с префиксом не попадает в счёт кругов (`jq`
  `startswith("REJECTED")`, `grep '^gate: REJECTED'`) и не подходит под regex `VERDICT` из
  `src/main/github/prs.ts`; блок возобновления из epic-wave, вырезанный из текста, на git-ветке
  с `gate: VERIFIED` и затем `gate: MAX-REVIEW: REJECTED` печатает `GATE=gate: VERIFIED`;
  `epic-status --json` с `Risk: high` в шапке выдаёт тот же JSON, что без неё. Сначала test был
  красным (skill-а не было, код 1). Мутанты на копиях — каждый красный: убрана строка о `opus`,
  убран `printf` Silent mode, убран `grep -v '^gate: MAX-REVIEW:'` из блока возобновления, убран
  абзац раздела 4, regex `VERDICT` расширен на `MAX-REVIEW:`.
- **Contract test** `test/contract/harness-migrate.test.ts`: строка со списком skills — `:81`, а не
  `:241`; в список добавлен `'max-review'`, `HARNESS_SKILLS` не изменён. Сначала красный (код 1:
  в списке папок лишний `max-review`), потом код 0.
- **`harness/README.md`**: `max-review` в таблице skills.
- Манифест plugin-а не правился: `harness/.claude-plugin/plugin.json` не перечисляет skills, они
  берутся из папки `skills/`.
- Источник: строки `Source:` для Thermos (`thermos/skills/thermos/SKILL.md`) и pstack
  (`pstack/skills/interrogate/SKILL.md`), коммит `ccb5507cec1546dc88135c1139c811e6c59115ba`
  `cursor/plugins`, с copyright (Cursor; Lauren Tan) — файлы и строки copyright сверены через GitHub
  API на этом коммите. Дословного текста нет — правила пересказаны, поэтому полного текста лицензии
  в skill-е нет.

- **Gate:** `node harness/hooks/gate.mjs fast` своего дерева — код 0, `[gate] зелено (fast):
  worfy/.:lint worfy/.:typecheck worfy/.:test`. Затем Gate Stable-копии
  (`worfy-stable.app/.../harness/hooks/gate.mjs fast`) на commit-е — код 0, но с пометкой «(кэш)»,
  поэтому отдельно: `pnpm lint` — код 0, `pnpm typecheck` — код 0, `pnpm test` — код 0 (245 файлов,
  5196 test-ов). `GATE_SCOPE=all gate full` не запускался — шаг Orchestrator-а.

Решения:

- **Пометка риска — строка шапки `Risk: high`** (рядом со `Status:` и `Blocked by:`). `epic-status`
  её пропускает: проверено в test-е, JSON совпадает байт в байт; worfy читает Ticket-ы через
  `epic-status --json` (`src/main/workflow/reader.ts`). Решено без владельца, подтвердить.
- **Две модели — модель Orchestrator-а и `sonnet`**; если Orchestrator сам на `sonnet`, вторая —
  `opus`. Решено без владельца, подтвердить.
- **Две модели — по умолчанию**, одна модель на линзу — только по слову владельца: так режим
  совпадает со ступенью `max` шкалы глубины ревью в `rules.md` («двумя линзами на двух моделях»).
  Решено без владельца, подтвердить.
- **Платформа:** PR не платформенный — текст skill-ов, test по тексту и contract test, без
  скриптов в `harness/bin/` и `harness/hooks/`. Решено без владельца, подтвердить.

Не проверено:

- не проверено: прогон настоящих моделей — шаг Orchestrator-а или владельца; запись в ~/.claude
  агентам запрещена. Число находок у каждой модели, общих, и время прогона (замер стоимости) —
  после такого прогона.
