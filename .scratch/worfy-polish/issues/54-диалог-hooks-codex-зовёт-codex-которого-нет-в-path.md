# 54 — Диалог «Approve the Harness hooks in Codex» велит запустить `codex`, которого нет в PATH

Type: bug
Status: claimed 2026-11-04T09:54Z
Blocked by:
Source: владелец 2026-11-04 через Session-мост, приёмка worfy-multi-vendor 43 п. 1 (Install Harness into Codex)
на Mac Stable `b09dfab0`; на ПК то же

## Что происходит

Диалог одобрения hook-ов Harness в Codex (`src/renderer/harness/CodexHooksStep.tsx:107`, ticket worfy-multi-vendor
39) в шаге 1 пишет «Open Codex in a terminal: `codex`». Но worfy запускает только свой встроенный binary Codex
(`src/main/vendors/codex/binary.ts`: `<Resources>/app.asar.unpacked/node_modules/@openai/codex-<platform>-<arch>/
vendor/<target>/bin/codex`). Отдельно Codex у пользователя может быть не установлен: на Mac владельца
`which -a codex` ничего не находит, Codex.app нет; на ПК тоже. Встроенный binary читает тот же `~/.codex`
(`CODEX_HOME` не переопределяется), так что `/hooks`, запущенный из него, одобряет то же доверие — но пользователь
не знает его пути.

Ещё два факта с приёмки на Mac (Stable `b09dfab0`):

- Первый запуск встроенного binary по полному пути сразу упал: «Error: No such file or directory (os error 2)».
  После `cd ~` тот же binary без правки PATH запустился и показал «Hooks need review — 13 hooks are new or
  changed» для `hooks.json` Harness в `~/.codex/plugins/cache/…`. Значит, дело не в PATH (`codex-path/rg`).
  Вероятная причина — текущая папка shell-а, которой уже нет (например, удалённый worktree); не подтверждено.
- Codex пишет «clamping SessionEnd hook timeout to 3s» для обоих hook-ов `SessionEnd` Harness
  (`harness/hooks/hooks.json`: `session-end.mjs` — 10 s, `bin/worktree-lock release` — 5 s). На Codex они
  получают 3 s.

## Что делаем

0. Проверить причину «os error 2»: запуск из несуществующей текущей папки (test с временной папкой, которую
   удаляют до запуска; отдельный `CODEX_HOME` во временной папке, никогда не `~/.codex`). Кнопка или команда
   диалога запускает Codex в домашней папке пользователя. Если в протоколе app-server есть метод доверия
   hook-ам — рассмотреть одобрение прямо из worfy по нажатию пользователя, без terminal.
0a. Hook-и `SessionEnd` на Codex: успевают ли `session-end.mjs` и `worktree-lock release` за 3 s (замер); если
    нет — что теряется, и как это исправить (быстрее, фоном, или отдельный timeout для Codex в установке
    Harness). Записать в «Итог».
1. Шаг 1 диалога показывает путь встроенного binary этой сборки (тот же, что находит `binary.ts`) с кнопкой Copy;
   на Windows — в кавычках для PowerShell (`& "C:\…\codex.exe"`). Если в PATH есть свой `codex` — можно упомянуть
   и его, но команда по умолчанию — встроенная.
2. Или кнопка «Open in Terminal», которая открывает Terminal worfy (или системный) с этим binary; выбрать одно из
   двух и записать почему в «Итог».
3. То же исправить в docs, где описан этот шаг (`docs/features/vendors.md`, `docs/features/ru/vendors.md`,
   `docs/features/harness.md`), если там написано «run `codex`».

Глубина review — `medium`. Платформенный: путь и кавычки разные на macOS и Windows.

## Готово, когда

- [ ] Unit test `CodexHooksStep`: шаг 1 показывает путь из main-процесса, Copy кладёт его в буфер; Windows-вид
      в кавычках.
- [ ] Contract test IPC, который отдаёт путь встроенного binary (или его отсутствие — тогда понятный текст).
- [ ] Все unit и contract test-ы `src/renderer/harness/` и `src/main/vendors/codex/`, `pnpm typecheck`,
      `pnpm lint` — exit 0.

## Итог

**Что сделано.** Шаг 1 диалога «Approve the Harness hooks in Codex» больше не говорит `codex`. Main отвечает новым
каналом `harness.codexBinary` (`src/shared/ipc/harness.ts`, `src/main/ipc/harness.ts`): путь того же binary, которым
worfy ставит Harness в Codex (`codexInstallBinary` — `WORFY_CODEX_CLI`, иначе binary сборки из `binary.ts`), и флаг
Windows. Диалог (`src/renderer/harness/CodexHooksStep.tsx`) показывает команду с кнопкой Copy: на macOS и Linux
`cd ~ && '<path>'` (апостроф в пути — `'\''`), на Windows для PowerShell `cd ~; & "<path>"` (`` ` ``, `$` и `"`
экранируются backtick-ом). Нет binary — шаг 1 так и пишет: «worfy could not find the Codex of this build…». Страницы
`docs/features/harness.md` и `docs/features/autopilot.md` исправлены; `vendors.md` и русские страницы этот шаг не
описывают. Снимки: [светлая](../evidence/54/54-codex-hooks-step-command-light.png),
[тёмная](../evidence/54/54-codex-hooks-step-command-dark.png) (путь — временная папка stand-in-а e2e, не реальный).

**П. 0, причина «os error 2».** Подтверждено по исходникам Codex `rust-v0.166.0` и опытом без Codex, live-проверка —
за владельцем. Interactive `codex` без `--cd` первым делом зовёт `AbsolutePathBuf::current_dir()`
(`codex-rs/tui/src/lib.rs:960` → `codex-rs/utils/absolute-path/src/lib.rs:81`, `std::env::current_dir()?`); ошибка
идёт без `.context()` до `fn main() -> anyhow::Result<()>` (`codex-rs/cli/src/main.rs:1039`), и anyhow печатает ровно
`Error: No such file or directory (os error 2)`. В shell-е, чья папка удалена, `getcwd` отдаёт ENOENT любому процессу:
`/bin/pwd`, `node` (`uv_cwd`) и `python3` (`[Errno 2]`) падают так же, после `cd ~` — нет (скрипт в scratchpad, не в
репозитории). Поэтому команда начинается с `cd ~`. Метода одобрения hook-ов в протоколе app-server нет (есть только
`hooks/list`); TUI Codex одобряет их записью `hooks.state.<key>.trusted_hash` через `config/batchWrite`
(`codex-rs/tui/src/hooks_rpc.rs:64`). Одобрение из worfy этим путём не делал: это запись в `~/.codex/config.toml` в
обход экрана, где пользователь видит, что одобряет, а куда пишется `trusted_content_hash` для plugin-hook-ов, не
выяснено — решено без владельца, подтвердить; возможный отдельный ticket.

**П. 0a, SessionEnd за 3 s.** Codex даёт SessionEnd 1 s по умолчанию и не больше 3 s
(`codex-rs/hooks/src/events/session_end.rs:20,23`), после срока убивает группу процессов hook-а. Замер на Mac
владельца (5 запусков, временный git-проект, `HARNESS_HOME` во временной папке; `session-end.mjs` с настоящим
`bin/profile` зарегистрированного проекта через обёртку, которая уводит запись `pending-retro.log` во временную
папку): `session-end.mjs` 154–294 ms (с лишним запуском node обёртки), с незарегистрированным проектом 120–180 ms,
голый `bin/profile --json` 133 ms; `worktree-lock release` 70–111 ms. Оба укладываются в 3 s с запасом в 10 раз, ничего
не теряется; правка hook-ов не нужна. Зависший `bin/profile` session-end.mjs уже обрезает на 2 s под Codex
(worfy-multi-vendor 36, test «ends inside the 3 s of Codex» в `test/contract/harness-codex-hooks.test.ts`).
Предупреждение «clamping … to 3s» остаётся: `timeout` в `hooks.json` общий с Claude Code.

**П. 2, «Open in Terminal» не делал** — решено без владельца, подтвердить. Одна команда для копирования работает в
любом terminal-е обеих систем; кнопка потребовала бы разного кода для Terminal.app (AppleScript и разрешение
Automation), Windows Terminal или conhost, или Terminal Node на холсте, у которого может не быть открытого Project.
Свой `codex` из PATH диалог не упоминает: worfy его не ищет и не знает, читает ли он тот же `CODEX_HOME`.

**Попутно.** В e2e под полной нагрузкой gate упал test «a check that fails says so; Escape closes the step»: Escape
приходил раньше, чем React перевешивал listener после ответа. Listener теперь читает ref, который ставится там, где
проверка начинается и кончается.
