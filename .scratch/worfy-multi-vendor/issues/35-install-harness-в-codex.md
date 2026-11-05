# 35 — Install Harness в Codex

Type: task
Status: done 2026-11-03T16:27Z
PR: #1298
Blocked by: —
Source: [spec.md](../spec.md), «Windows» (Harness на Codex), «Решения владельца» (Q4, Q5); решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Как доставить и версионировать»); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Install Harness ставит копию `harness/` как локальный marketplace командами `claude plugin`
  (`src/main/harness/install.ts:6-24`, `:50-60`, папка — `:403`), с зависимостью `mattpocock-skills`
  (`harness/.claude-plugin/plugin.json`).
- Codex читает plugin-ы формата Claude: `codex plugin marketplace add <папка>`, `upgrade`, `list`; агентов plugin не
  несёт — их TOML лежат в `~/.codex/agents/` или `.codex/agents/` проекта. Зависимостей plugin-ов у Codex нет.

## Что делаем

1. `src/main/harness/codex-install.ts`: при входе в Codex Install Harness ставит ту же папку и в Codex
   (`codex plugin marketplace add`, при новой версии — `upgrade`); бинарник — закреплённый Codex (Ticket 17).
2. Зависимость `mattpocock-skills` ставится в Codex тем же installer-ом отдельным plugin-ом: у Codex нет поля
   зависимостей, а skills должны быть те же, что у Claude (решение Q5 — полный паритет).
3. Проверка версии — аналог `claude plugin list` у Codex; расхождение версий показывает тот же статус Harness.
4. `src/main/harness/codex-agents.ts`: из `harness/agents/implementer.md`, `reviewer.md`, `scout.md` — TOML агентов
   Codex (`name`, `description`, `developer_instructions`, `model`, `model_reasoning_effort`) с именами
   `worfy-implementer`, `worfy-reviewer`, `worfy-scout`. Только в `~/.codex/agents/` пользователя; в папку Project-а
   worfy не пишет (ADR-0005: своё состояние worfy держит вне репозитория). Пишет только installer; лишние файлы
   `worfy-*.toml` прежних версий он удаляет, чужие не трогает.
5. После установки или обновления installer сообщает, что hook-и нужно подтвердить в Codex (шаг — Ticket 39).
6. Ошибки команды Codex — тот же отчёт, что у установки в Claude Code; повтор на Windows — `retriedOnWindows`
   (`install.ts:164`).

Платформенный: пути установки и повтор на Windows.

## Готово, когда

- [x] Contract test (stand-in `codex` через env, как test-ы установки Claude): первая установка, обновление, версия,
      plugin зависимости; TOML агентов `worfy-*` совпадают с fixture и лежат только в `~/.codex/agents/` временного
      `CODEX_HOME`; в папке Project-а ничего не появилось.
- [x] Test-ы установки в Claude Code проходят без правок ожиданий.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [x] `pnpm typecheck`, `pnpm lint`, test-ы `src/main/harness` — exit 0.

## Где в коде

- `src/main/harness/codex-install.ts`, `src/main/harness/codex-agents.ts` (новые)
- `src/main/harness/install.ts` — `:6-24`, `:164`, `:403`
- `src/main/ipc/harness.ts`
- `test/contract/harness-codex-install.test.ts` (новый)

Только читать: `harness/agents/implementer.md`, `reviewer.md`, `scout.md`, `harness/.claude-plugin/plugin.json`.

## Итог

- `src/main/harness/codex-install.ts` (`CodexHarness`): тот же installer Install Harness после части Claude Code ставит
  ту же папку `<harnessHome>/plugin` и в Codex: `codex plugin marketplace add <папка>` (если marketplace ещё не
  известен), `codex plugin add worfy@worfy-harness`; зависимость — отдельным plugin-ом:
  `codex plugin marketplace add anthropics/claude-plugins-official`, `codex plugin add mattpocock-skills@claude-plugins-official`.
  Версия — `codex plugin list --json`. Диалог согласия называет и команды Codex, и файлы агентов, и подтверждение hook-ов
  в `/hooks`. Ошибка команды Codex — тот же текст, что у Claude Code (`runTool` в `install.ts`, общий для обоих):
  `codex <args> exited with N:` и хвост вывода.
- `src/main/harness/codex-agents.ts`: `worfy-implementer.toml`, `worfy-reviewer.toml`, `worfy-scout.toml` из
  `harness/agents/*.md` (`name`, `description`, `developer_instructions`, `model`, `model_reasoning_effort`) — только в
  `<CODEX_HOME>/agents/`. Запись — через временный файл и rename, на Windows rename и удаление повторяются
  (`retriedOnWindows`).
- Статус Harness получил поле `codex` (`src/shared/ipc/harness.ts`): `not-installed` / `installed` / `outdated` /
  `error` и `hooksToApprove`. Toolbar показывает часть Codex после версии (`· Codex 0.1.0`, `· Codex: not installed`,
  `· Codex error: plugin add`, `· Codex: approve hooks`) с той же кнопкой Install / Update / Retry.
- Test-ы: `test/contract/harness-codex-install.test.ts` (stand-in `codex` и `claude`, временные `CODEX_HOME`, Harness home и
  папка данных; первая установка, повторная, обновление, расхождение версий, версия `local`, ошибка команды, отказ в
  диалоге, Codex без `CODEX_HOME`, повтор rename на Windows; TOML совпадают с `test/fixtures/codex-agents/expected/`);
  `test/unit/harness-status.test.tsx` — часть Codex в toolbar. Test-ы установки в Claude Code прошли без правок.
  Раунд 1 добавил случаи: файлы папки агентов, которые не принадлежат worfy (пометка не в первой строке, `worfy-x.txt`
  с пометкой, папка `worfy-dir.toml`, нечитаемый файл, symlink-и), файл пользователя под именем агента, папка агентов —
  файл, зависший `codex plugin list` (stand-in, который не отвечает и игнорирует SIGTERM) и остановка этой команды.
  Каждый случай краснеет на своём mutant-е (11 mutant-ов).
- Решено без владельца, подтверждено владельцем 2026-11-05:
  1. Обновление в Codex — снова `codex plugin add worfy@worfy-harness`, а не `codex plugin marketplace upgrade`: справка
     закреплённого Codex 0.166.0 говорит, что `upgrade` обновляет Git marketplace-ы, а локальный marketplace — сама папка,
     которую часть Claude Code уже заменила. Проверит приёмка 43 на настоящем Codex.
  2. Codex «есть», когда в сборке есть его бинарник и существует `CODEX_HOME` (Codex запускался на этой машине). Без
     этого Install Harness Codex не трогает и `~/.codex` не создаёт.
  3. Если Codex показывает plugin локального marketplace без версии сборки (`local`), версией считается та, что worfy
     записал после своей установки в Codex: `<WORFY_DATA_DIR>/harness-codex.json` (своё состояние worfy, ADR-0005). Иначе
     Install обновлял бы Codex каждый раз.
  4. `model` агентов Claude (`inherit`, `sonnet`…) у Codex не существует: поле `model` не пишется, агент берёт модель
     родителя; `effort` переходит в `model_reasoning_effort` как есть. Scout на Codex поэтому не дешевле родителя по
     модели, только по effort `medium`.
  5. `${CLAUDE_PLUGIN_ROOT}` в тексте агентов заменяется на `<harnessHome>/plugin`: в TOML агента Codex переменную не
     подставляет, а скрипты Harness лежат в этой папке.
  6. Файл `worfy-*.toml` считается файлом worfy, только если это обычный файл и его первая строка — пометка
     installer-а. Всё остальное — файл пользователя: без пометки, с пометкой не в первой строке, нечитаемый, symlink
     (даже на файл с пометкой), папка. Installer его не удаляет и не переписывает (раунд 1, решено без владельца,
     подтверждено владельцем 2026-11-05).
  7. Порядок: сначала Claude Code, потом Codex. Ошибка в части Claude Code — Codex не трогается; ошибка в Codex —
     Claude Code остаётся установленным, статус Codex — `error` с шагом. Toolbar показывает часть Codex, только когда
     у Claude Code Harness этой сборки.
  8. `hooksToApprove` — флаг в памяти процесса после установки или обновления plugin-а в Codex: настоящее чтение доверия
     к hook-ам — Ticket 39.
  9. Stand-in `codex` для test-ов — переменная `WORFY_CODEX_CLI`; под `WORFY_CODEX=fake|absent` и под vitest бинарника
     Codex для установки нет.
  10. Файл пользователя под именем агента этой сборки (`worfy-implementer.toml`, `worfy-reviewer.toml`,
      `worfy-scout.toml`) installer не переписывает и не делает копию: этот агент пропускается. Диалог называет файл и
      говорит «переименуйте или удалите его, потом Install»; статус несёт `skippedAgents`, toolbar показывает
      `· Codex: 1 agent not written` с тем же текстом в tooltip. Статус при этом `installed`, а не вечный `outdated`:
      worfy здесь делать нечего. Выбран вариант без перезаписи как наименее неожиданный (раунд 1, решено без владельца,
      подтверждено владельцем 2026-11-05).
  11. Статус читает Codex не дольше 10 s (`CODEX_STATUS_TIMEOUT_MS`): потом часть Codex — `error` шага `plugin list`
      («did not answer in 10 s»), команда останавливается, поздний ответ отбрасывается. Части Claude Code и Codex
      читаются параллельно, так что зависший Codex держит любое чтение статуса не дольше 10 s, а не 120 s. Чтение для
      плана установки (`plan()`) осталось с общим пределом команды 120 s (раунд 1, решено без владельца, подтверждено владельцем 2026-11-05).
  12. `<CODEX_HOME>/agents`, который оказался файлом, — ошибка шага `agents` в части Codex; статус и установка Claude
      Code идут дальше (раунд 1).
- Не проверено запуском: формат `codex plugin list --json` и `codex plugin marketplace list --json` закреплённого Codex
  (читается терпимо: список, `{ plugins }` или `{ marketplaces: [{ name, plugins }] }`, версия — `localVersion` или
  `version`), спрашивает ли `codex plugin add` подтверждение без TTY. Это — приёмка 43.
- Устаревшие строки для Ticket-а 42: `docs/features/vendors.md:84` («has no Harness»), `docs/features/harness.md:12`
  (ставится только как plugin Claude Code), `:28-34` (таблица состояний toolbar без части Codex), `:42-58` («What an
  install does» без команд Codex и агентов).

### Долги gate (Wave 12, PR #1298)

Раунд 1 — REJECTED (3 med: test-ы удаления файлов агентов, перезапись немаркированного файла пользователя, статус Codex до 120 s), раунд 2 — VERIFIED.

- [low] `src/main/harness/codex-agents.ts:~142`: ошибка `lstat`, кроме ENOENT, считается файлом пользователя (верно), но test-а нет; проверяется на POSIX не под root с папкой агентов `0o444`.
- [low] `src/main/harness/codex-install.ts`, `boundedRead`: без `clearTimeout(timer)` test-ы зелёные (остаётся таймер на 10 s).
- [low] `src/main/harness/install.ts:461`, `runTool`: команде по timeout посылается только SIGTERM; Codex, который его игнорирует, останется жив.
- Для Ticket-а 42: устарели `docs/features/vendors.md:84`, `docs/features/harness.md:12`, `:28-34`, `:42-58`.
