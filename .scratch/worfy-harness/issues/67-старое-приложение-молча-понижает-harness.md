# 67 — Старая сборка worfy молча ставит свой, более старый Harness поверх нового

Type: bug
Status: claimed 2026-10-29T16:10Z
Branch: worfy-harness/67
Blocked by: —
Source: случай у владельца 2026-10-21 (время Mac 14:08–14:09).

## Что происходит

Владелец открыл `/Users/worfy-test/Applications/worfy-stable.app` — копию от 2026-10-14 в папке тестового пользователя
macOS (Spotlight нашёл её первой). Через минуту эта сборка положила свой Harness в `~/.claude/worfy-harness/plugin`
поверх более нового: пропали, например, `gate.mjs` и другие файлы.

`src/main/harness/install.ts` копирует `<harnessHome>/plugin/` и зовёт `claude plugin update`, когда версия установленного
Harness просто другая (`copy` — `:89`, «it carries another version, or none»). Какая из версий новее, не сравнивается.

## Что делаем

1. Красный test: установленный Harness новее версии сборки — копия не делается, `plugin update` не зовётся.
2. Сравнивать версию (и commit, если версии равны) сборки и установленного Harness. Понижение — отказ с понятной
   причиной в Health и в log; ставить старую версию — только явным действием человека.

## Готово, когда

- [ ] Test красный на main, зелёный с правкой; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/main/harness/install.ts` (план установки, `:84-89`; чтение версии `:203-206`)

## Риски

- Формат версии Harness (`0.3.0+<commit>`): порядок по commit не определён — при равной версии нужно правило.

## Итог

Installer (`src/main/harness/install.ts`) сравнивает версию Harness сборки с версией установленной копии
(`<harnessHome>/plugin/.claude-plugin/plugin.json`) и с версией, которую называет `claude plugin list`, функцией
`compareHarnessVersions`. Формат версии — `<semver>+<short SHA>[.dirty]` (`scripts/build-version.ts`, пишет
`electron.vite.config.ts`); порядок есть только у semver. Обе версии проверяются каждый раз: они расходятся, когда
копия легла, а её `plugin update` упал. Без папки `plugin/` в счёт идёт копия, которую прерванная замена отложила в
`.plugin-old-*` (следующая копия возвращает её первой); после этого возврата проверка идёт ещё раз.

Правила:

- **Копия в папке или версия в списке Claude Code — semver выше, чем у сборки** — отказ: ни копии, ни `plugin update`, ни команд зависимости, диалог не
  открывается. Состояние — `error` шага `copy` с причиной в одну строку («the installed Harness X is newer than this
  build's Y, so worfy does not replace it: open the worfy build that installed it instead, or … remove <pluginDir>,
  then Install»); её показывают Health (строка Harness plugin) и toolbar. В log — `console.warn('[harness] …')`: при
  чтении состояния один раз на причину, при каждой попытке установки — каждый раз.
- **Версия установленной копии — не версия сборки** (`banana`, `0.4.0-beta+…`) — такой же отказ, причина называет
  эту версию. Версии нет вовсе (нет поля, нет файла) — как сейчас: ставится.
- **Semver ниже, или копии нет** — ставится как раньше, через диалог «Update X → Y» (X — та из двух версий, что
  отличается от сборки). Если папку удалили руками, а Claude Code перечисляет версию новее, диалог говорит об этом
  прямо: «Install this build's older Harness Y in place of X?».
- **Хотя бы одна из двух версий — тот же semver, другой commit (или один из двух `.dirty`)** — ставится, но только
  через тот же диалог согласия, и его текст другой: кнопка `Replace`, вопрос «Replace the worfy Harness X with Y?»,
  первая строка — обе версии `0.3.0`, отличаются только commit-ом, worfy не может сказать, какая новее; заменить,
  только если эта сборка новее, иначе Cancel. Состояние `outdated` несёт `sameVersion`, и Health и toolbar при нём
  тоже говорят Replace без стрелки: Health — «X, this build Y» и кнопка Replace, toolbar — кнопка «Replace Harness». Других путей установки без диалога нет: `install()` зовут только `harness.install` (диалог в
  `src/main/ipc/harness.ts`) и first-run (`src/main/first-run/actions.ts`, тот же `confirmationText`); test
  «the same semver from another commit…» закрепляет, что Cancel ничего не пишет.

Почему так. Случай владельца 2026-10-21 — сборка от 2026-10-14 с версией `0.2.0+…` поверх `0.3.0+…` (semver стал
0.3.0 в #323, 2026-10-15) — ловит правило «semver выше». Равный semver упорядочить нельзя: short SHA не имеет
порядка, а semver меняется раз в эпик, так что отказ на равном semver остановил бы каждое обычное обновление Stable.
Упорядочить commit-ы позже можно штампом времени commit-а при сборке — в отдельном файле копии Harness, не в
`plugin.json`, чтобы не задеть проверку manifest-а Claude Code. Защита действует только в сборках с этой правкой:
сборка от 2026-10-14 и любая другая старая сборка по-прежнему ставит свой Harness молча.

Явного действия «поставить старую версию» в Health нет, и новый UI тикет не строит: причина отказа говорит, что делать
(удалить названную папку руками, потом Install). Без папки отказа нет — test «the way out the reason names…».

Форма переноса старого Harness (`src/main/ipc/harness-migration.ts`) читает состояние общим installer-ом приложения
(`appInstaller()`), а не новым на каждое чтение: так запись об отказе в log не повторяется при каждом чтении.

Mutation testing (`test/contract/harness-install.test.ts`, блок «a Harness newer than the build…»; каждый mutant —
отдельный run, exit 1):

| Mutant | Что сломано | Какие test-ы покраснели |
| --- | --- | --- |
| M1 | более высокий semver не отказывает | «a newer Harness installed…», «reading the state again…» |
| M2 | нечитаемая версия не отказывает | «an installed version worfy cannot read…» |
| M3 | диалог равного semver — прежний «Update» | «the same semver from another commit…» |
| M4 | причина не попадает в состояние (Health) | «a newer Harness installed…» |
| M5 | нет записи в log | «a newer Harness installed…», «reading the state again…» |
| M6 | отказ только в состоянии, install() копирует | «a newer Harness installed…», «an installed version worfy cannot read…» |
| M7 | порядок semver перевёрнут | 6 строк таблицы `compareHarnessVersions`, «a newer Harness installed…», «reading the state again…» |

Второй круг (после ревью PR #1011; те же правила, плюс `test/contract/first-run-checks.test.ts` и
`test/unit/harness-status.test.tsx`):

| Mutant | Что сломано | Какие test-ы покраснели |
| --- | --- | --- |
| H | отказ не смотрит на копию в папке | «the folder newer than the version Claude Code lists…», «a newer copy set aside after the plan was made…» |
| I | отказ не смотрит на версию в списке Claude Code | «the version Claude Code lists newer than the folder…» |
| K2 | при недостающей зависимости отказа нет | «a newer Harness installed and its dependency missing…» |
| S1 | диалог смотрит только на версию в списке | «the folder carries another commit… no record…», «a copy whose `plugin update` failed…» |
| S2 (состояние) | `outdated` не смотрит на копию в папке | «a copy whose `plugin update` failed…» |
| S2 (план) | план не несёт версию папки | «the folder carries another commit…», «a copy whose `plugin update` failed…» |
| старая версия руками | диалог без папки — прежний «Update» | «the way out the reason names…» |
| `.plugin-old-*` | отложенная копия не в счёт | «a newer copy an interrupted swap set aside…» |
| повторная проверка | после возврата отложенной копии нет проверки | «a newer copy set aside after the plan was made…» |
| Health | строка Health при равном semver — прежний Update | «the Harness of the same version from another commit warns with Replace…» (first-run-checks) |
| toolbar | toolbar при равном semver — прежний Update | «the same version from another commit: "Replace Harness"…» (harness-status) |

Test-ы: красные на main (16 из 17 нового блока), зелёные с правкой; `pnpm lint && pnpm typecheck && pnpm test` —
exit 0. В существующих test-ах `V2` стал `0.3.0+bbbbbbb` (обновление — это более высокий semver), а повторная
установка в test-е «the new copy in place but the previous one cannot be removed…» идёт с `0.4.0`, не со старой
версией.
