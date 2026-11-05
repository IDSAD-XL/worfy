# 45 — Parity suite: Codex держит гарантии workflow, которые у Claude есть сейчас

Type: task
Status: done 2026-11-04T00:14Z
PR: #1313
Blocked by: 35, 36, 44
Source: [spec.md](../spec.md), «Гарантии workflow на Codex», «Решения владельца» (Q5 — parity suite на фейке app-server); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), «Гарантии workflow на Codex»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что делаем

Паритет — Codex держит ровно те гарантии workflow, что Claude держит сейчас, не строже (решение Orchestrator-а,
round 2 review spec-а). Поведение Claude не меняется; фейк Claude (`WORFY_AGENT=fake`) hook-и не исполняет, и
hook-runner-а для него нет.

`test/contract/codex-parity.test.ts`: сценарии идут на фейке app-server с hook-runner-ом и sandbox-ом (Ticket 44), с
Harness, установленным Ticket-ом 35 во временный `CODEX_HOME`. Итог каждого сценария сверяется с таблицей гарантий
(данные в начале test-а). Каждая строка называет test, который доказывает ту же гарантию у Claude:

| # | Гарантия | Сценарий на Codex | Test Claude |
|---|---|---|---|
| 1 | reviewer и scout не правят файлы tool-ом правки | `apply_patch` (item `fileChange`) от `worfy-reviewer` и `worfy-scout` — отказ, файл не изменён; shell-команда — выполняется, как `Bash` у reviewer-а Claude | `harness/bin/tests/agents-text.test.sh:190` (`tools` агентов: без `Edit` / `Write`, с `Bash`) |
| 2 | ход не заканчивается при красном gate | `Stop` при красном gate — ход продолжается с причиной; при зелёном — заканчивается | `harness/bin/tests/harness-home.test.sh:131` (`stop.mjs` — exit 2 при красном маркере), `harness/hooks/tests/gate-notverified.test.sh` |
| 3 | Subagent не заканчивает работу при красном gate | `SubagentStop` — так же | `harness/hooks/tests/rules-hooks.test.sh:576-577` (gate fast на `TaskCompleted` и `TeammateIdle`), `harness/hooks/tests/gate-verdict.test.sh` (красный gate — не exit 0) |
| 4 | guard Bash | запрещённая команда (`git reset --hard`, pipe, который теряет exit code) — отказ | `harness/hooks/tests/guard-silent.test.sh:102-104` |
| 5 | правило записи в `~/.claude` | TOML агентов `worfy-*` от Ticket-а 35 несёт то же правило, что текст агентов Claude | `harness/bin/tests/agents-text.test.sh:178` |
| 6 | verdict review в PR | reviewer оставляет verdict-комментарий через stand-in `gh` (`WORFY_GH`), `GH_TOKEN` проекта в env | `harness/hooks/tests/gh-token-env.test.sh`, `harness/bin/tests/max-review.test.sh` |
| 7 | правила Harness в начале Session и Subagent-а | `SessionStart`, `SubagentStart` дают текст правил | `harness/hooks/tests/rules-hooks.test.sh:93` |
| 8 | учёт Session | `SessionEnd` пишет учёт и укладывается в 3 s | `harness/hooks/tests/session-hooks.test.sh` |
| 9 | hook-и включены | без подтверждения hash фейк их не исполняет; test называет это явно (отказ старта Run — Ticket 39) | нет: у Claude hook-и plugin-а включены всегда |

Правила таблицы:

- Если названный test Claude не доказывает гарантию строки целиком, Ticket добавляет новый test стороны Claude в
  `harness/hooks/tests/` или `harness/bin/tests/` — только test, без правки поведения.
- Test проверяет, что каждый названный файл test-а Claude существует: переименование без правки таблицы — красный test.
- Новая гарантия Harness без строки в таблице — красный test (список гарантий берётся из README Harness, раздел
  «On Codex», Ticket 36).
- Строгость не выше Claude: сценарий, который требует от Codex больше, чем test Claude доказывает у Claude (например,
  отказ в shell-записи reviewer-у), в таблицу не входит.

Платформенный: test-ы скриптов Harness.

## Готово, когда

- [ ] Все строки 1–8 дают на фейке app-server итог из таблицы; строка 9 проверена; у каждой строки есть test Claude
      или он добавлен.
- [ ] Контрольный случай: выключенный deny в `guard.mjs` — suite красный (строка 4); убранный отказ `apply_patch` для
      `worfy-reviewer` — красный (строка 1).
- [ ] Test-ы Harness стороны Claude проходят без правок ожиданий; фейк Claude не изменён.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `test/contract/codex-parity.test.ts` (новый)
- `harness/hooks/tests/` или `harness/bin/tests/` — новый test стороны Claude, только для строки без доказательства

Только читать: `harness/README.md` (раздел «On Codex», Ticket 36), `test/fixtures/codex-app-server/hook-runner.mjs`.

## Итог

Решено без владельца, подтверждено владельцем 2026-11-05:

1. **Первым — предложение, не сделано: вынос rules в файл на Codex.** Сработает при полном слоте user rules: Harness
   отдаёт `common` вместе с user rules, обрезанными до 10 000 символов, а это около 2 510 токенов по bytes/4, больше
   `additionalContextLimit` Codex (2 500 по умолчанию). Codex тогда выносит context в файл, а модели даёт preview
   (живьём не проверено). Чинится одним из двух способов, оба вне этого ticket-а: здесь только test-ы.
   - `"additionalContextLimit": 0` у hook-ов `SessionStart` и `SubagentStart` в `harness/hooks/hooks.json`. Не
     проверено, примет ли это поле Claude Code.
   - Меньший предел user rules на Codex в `inject-rules.mjs`.
2. К строке 3 таблицы добавлен `harness/hooks/tests/gate-shim.test.sh`: `hooks.json` запускает gate через `gate.sh`, и
   его красный — тоже exit 2, как у `gate.mjs`.
3. Проверки test-ов Claude названы текстом, а не номером строки. Номера строк из таблицы ticket-а уже не совпадали с
   файлами (например, `rules-hooks.test.sh:576-577` теперь на 578–579).

- `test/contract/codex-parity.test.ts` (новый; 16 test-ов после раунда 2): таблица гарантий — данные в начале файла (`GUARANTEES`,
  строки 1–9), у каждой строки — гарантия, сценарий на Codex и test-ы Claude, которые её доказывают.
  - Таблица сверяется с README Harness: каждая строка таблицы раздела «On Codex» (`harness/README.md`) должна иметь
    строку в `GUARANTEES`, и каждая строка, которая называет гарантию README, называет существующую. Новая гарантия в
    README без строки — красный test.
  - Каждый test Claude назван файлом и текстом проверки, на которую строка опирается (строка файла по тексту, не по
    номеру: номера строк в таблице ticket-а уже разошлись с файлами). Переименованный файл или удалённая проверка —
    красный test.
  - Команды строки 4 берутся из самого test-а Claude (`guard-silent.test.sh`, `expect "full: …" deny …`), и сценарий
    обязан запускать те же команды; правило записи строки 5 (`WRITE_RULE`) и список агентов (`for a in implementer
    reviewer`) — тоже из `agents-text.test.sh`.
  - Последний test проверяет, что все 9 строк прошли свои сценарии.
- Сценарии идут на фейке app-server с hook-runner-ом и sandbox-ом (Ticket 44), по трём новым script-ам
  `test/fixtures/codex-scripts/parity-{guards,gate,verdict}.jsonl` (собраны из handshake `hooks.jsonl` и форм шагов
  `hooks.jsonl` / `sandbox.jsonl`; `codex-fake.test.ts` и `codex-compat.test.ts` их проверяют).
- Harness ставит во временный `CODEX_HOME` установщик Ticket-а 35 (`CodexHarness.plan` + `apply`) со stand-in-ом CLI
  `codex`: stand-in на `plugin add` из локального marketplace кладёт папку в `plugins/cache/<marketplace>/<plugin>/local`
  — туда, где plugin ищет hook-runner фейка (раскладка та же, что у `harness-codex-hooks.test.ts`). Агенты TOML пишет
  сам установщик. Hook-и подтверждаются, как в `/hooks` (`approvePluginHooks`). У каждого прогона свой реестр gate,
  состояние gate, `HARNESS_HOME`, `HOME`, `XDG_*` и stand-in `bin/profile`; переменные `CLAUDE_*`, `GATE_*`, `QMD_*`,
  `GH_TOKEN` машины в env фейка не попадают. В `~/.claude` и `~/.codex` ничего не пишется (проверено grep-ом после
  прогона).
- Строки:
  1. `apply_patch` от `worfy-reviewer` (add и update) и `worfy-scout` — deny с причиной, item не стартует, файлы не
     меняются; их `git diff` и `ls` выполняются; `apply_patch` главного агента записан (отказ — по агенту, а не по tool-у).
  2. Главный агент ломает `status.txt` (gate красный) → `Stop` — hook prompt с причиной gate, ход продолжается; агент
     чинит → `Stop` зелёный, `turn/completed` один и после исправления; последний verdict gate — green.
  3. То же для `SubagentStop` у `worfy-implementer`.
  4. `git reset --hard` и `pnpm test | tail -5` — deny у главного агента и у reviewer-а, с теми словами, что ждёт test
     Claude; та же pipe под `set -o pipefail` выполняется.
  5. `worfy-implementer.toml` и `worfy-reviewer.toml`, которые записал установщик, несут правило записи в `~/.claude`
     в начале пункта списка, как test Claude требует от `.md`. Scout в строку не входит: test Claude его не проверяет
     (не строже Claude).
  6. Session запускает настоящий `codexSessions` (src/main/vendors/codex/session.ts) с `ghToken` через `accountAuth` и
     stand-in `gh` (`gh auth token -u octo-org`). `worfy-reviewer` запускает `gh pr comment 7 --body VERIFIED`, guard
     пропускает, `GH_TOKEN` аккаунта — в env процесса app-server. Фейк команды не исполняет, поэтому test запускает ту же
     команду с env процесса, как это сделал бы shell Session-а. Stand-in `gh` получил токен аккаунта.
  7. `SessionStart` даёт части `orchestrator` и `common`, `SubagentStart` reviewer-а и scout-а — `common`, каждая
     ровно как ждёт test Claude: файл части с подставленным корнем plugin-а.
  8. `SessionEnd` при закрытии stdin пишет строку в `pending-retro.log` профиля; от закрытия до выхода фейка — меньше
     3 s.
  9. Без подтверждения hash фейк не запускает ни одного hook-а: правка reviewer-а записана, `git reset --hard` прошёл.
     Если plugin изменился после подтверждения, каждый hook падает с `plugin contents changed; hook approval required`
     и ничего не решает. Test так и называет: без подтверждения строки 1–8 не держатся, отказ старта Run — Ticket 39.
- Новый test стороны Claude: `harness/hooks/tests/stop-gate-cycle.test.sh`. Строку 2 названные test-ы доказывали
  только по частям: красный маркер держит ход (`harness-home.test.sh`, `gate-notverified.test.sh`), зелёный прогон
  снимает маркер (`gate-verdict.test.sh`). Новый test проходит один цикл в зарегистрированном worktree: красный gate →
  `Stop` под Claude — exit 2 с причиной; зелёный gate → `Stop` — exit 0 молча. Поведение не менялось.
- Не строки таблицы: deny интерактивного shell-а агенту Harness и запись reviewer-а через shell (строже Claude), а также
  известные пробелы README (tool-ы `mcp__*` и `spawn_agent` у read-only агентов). Suite на них не падает.
- Контрольные случаи «Готово, когда» (мутанты в worktree, потом `git checkout`):
  - `deny` в `guard.mjs` выключен (`process.exit(0)` в начале `deny`): suite exit 1 — красные строки 1 и 4.
  - отказ `apply_patch` для `worfy-reviewer` убран (`&& agent !== "worfy-reviewer"`): exit 1 — красная строка 1.
  - сверх ticket-а: `stop.mjs` не запускает gate под Codex — красные строки 2 и 3; лишняя гарантия в README и
    переименованный test Claude — красные test-ы таблицы.

## Раунд 1

Правки по review PR #1313 (`/tmp/worfy-mv-w14/review-45-refute.md`). База — origin/main `af731d59a`: после неё на main
были только docs.

- F1, строка 7. Codex выносит в файл `additionalContext` hook-а длиннее его `additionalContextLimit`. По умолчанию это
  2500 токенов (`null uses 2,500 tokens`, pinned schema `codex_app_server_protocol.v2.schemas.json:6393`), а
  `hooks.json` поле не задаёт. В suite добавлена проверка строки 7. `inject-rules.mjs` установленного plugin-а выдаёт
  context для `SessionStart orchestrator`, `SessionStart common`, `SubagentStart common` и для `common` с заполненным до
  отсечки слотом user rules (ASCII). Корень plugin-а — реалистичный, 74 символа: `CODEX_HOME` под типичным домом
  пользователя Windows. Каждый context должен быть не больше 2500 токенов. Мера приблизительная, bytes/4: оценщика Codex
  в репозитории нет.
  - Запас сейчас около 1 %: `orchestrator` — 2481, `common` — 1493.
  - В `harness/README.md` («On Codex») добавлен абзац про известный пробел. Вынос в файл живьём не проверен. Suite
    проверяет размер, а не сам вынос. Через предел перейдут user rules в письме с двумя и более байтами на символ и
    секции профиля `session-start.mjs`.
  - `hooks.json` и тексты правил не менялись.
- F2. Проверка test-а Claude теперь ищет строку только вне комментариев (`#`, `//`, `*` после пробелов).
- F4. В env фейка и установщика рядом с `HOME` добавлен `USERPROFILE` (`os.homedir()` на Windows).
- F7. Все ожидания сценария делят один deadline (`Watch`), так что ожидания больше не складываются. Ожидания падают
  сразу, если пришёл лишний hook prompt или фейк вышел до конца хода. `SETUP_MS` 180 → 90 s. Последний test теперь
  требует, чтобы прошли все проверки каждой строки (у строки 7 их две).
- Мутанты (копия → правка → восстановление из копии):
  - «держит ход при зелёном» (`stop.mjs` пишет красный маркер после каждого прогона gate под Codex): exit 1 за 3 s,
    ошибка «hook prompt 2 on thr_sub_3», строки 2 и 3 не прошли;
  - `orchestrator.md` длиннее на 200 байт: exit 1 за 4 s, красная проверка размера строки 7;
  - проверка, цитируемая строкой 2, осталась только в комментарии: exit 1 за 4 s, красный test таблицы.
- F3, F5, F6 — без правок, по вердикту review.

## Раунд 2

CI на PR #1313 был красный: job `linux-tests (3/4)`, run 41737832044. Не прошла проверка размера строки 7 для
`SubagentStart common` с полным слотом user rules: 2504.25 токена на Linux против 2499.25 на Mac.

- Причина зависимости от машины. `inject-rules.mjs` режет `common` вместе с user rules по 10 000 символов и держит
  целые строки. Его последняя строка называет файл user rules (`$HARNESS_HOME/user/rules.md`), а в test-е это
  временная папка runner-а: на Mac путь длинный (`/private/var/folders/…`), на Linux короткий (`/tmp/…`). При длинных
  строках-заполнителях (72 символа) сколько места остаётся пустым, зависело от длины этого пути: от 0 до 71 символа.
  Собственные context-ы Harness (`orchestrator`, `common` без user rules) путей машины не содержат и на обоих runner-ах
  одинаковые: 2481 и 1493.
- Измерение стало детерминированным. Заполнитель — строки из одного символа, так что пустым остаётся не больше двух
  символов, и путь на размер не влияет. Проверено прогоном с коротким `TMPDIR` (`/tmp/p.XXXX`, как на Linux): exit 0.
- Полный слот — настоящее переполнение, а не дефект test-а. 10 000 символов — это около 10 000 байт, а 20 многобайтных
  символов `common` дают ещё 40 байт: получается около 2 510 токенов при пределе 2 500. Это теперь не проверка строки 7, а
  отдельный test «known gap». Он измеряет размер и требует, чтобы тот был больше предела (пробел остаётся на виду), и
  требует, чтобы README «On Codex» его называл. Строгая проверка `≤ 2500` осталась для трёх context-ов Harness.
- В `harness/README.md` («On Codex») добавлено предложение: user rules могут вывести часть `common` за предел, и тогда
  она выносится в файл. Предложение владельцу (`additionalContextLimit 0` или меньший предел user rules на Codex)
  перенесено первым в «Решено без владельца, подтверждено владельцем 2026-11-05» в начале «Итог».
- Мутанты (копия → правка → восстановление из копии):
  - из README убрано это предложение: exit 1 за 4 s, красный test «known gap»;
  - `LIMIT` в `inject-rules.mjs` снижен до 9000, и пробел закрывается: exit 1 за 4 s, красный тот же test.
