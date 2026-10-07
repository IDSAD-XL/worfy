# 0040 — Доставка Harness: plugin `worfy` из копии `harness/` в `~/.claude/worfy-harness/`, версия `<semver>+<SHA>`
Дата: 2026-10-07. Статус: принят.

**Контекст.** ADR-0019 (Harness — plugin Claude Code из `harness/` репозитория worfy, его ставит
worfy) решил, что Harness ставится в область пользователя командой `claude plugin install` и
меняется только вместе с приложением. Открытыми остались пять вопросов: откуда Claude Code берёт
plugin, как plugin называется, как выглядит его версия, где лежит состояние Harness на машине и
какой Claude Code нужен. Их закрывают решения владельца 2026-10-07 по вопросам Q1, Q2, Q4, Q12 и
Q20 Session проектирования Epic-а E3 `worfy-harness` («Harness как часть worfy»).

Что известно о plugin-ах Claude Code из документации (plugins-reference, plugins/loading,
agent-sdk/plugins):

- установленный plugin Claude Code копирует в `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`,
  и путь меняется с каждой версией. Plugin, который лежит по относительному пути в marketplace из
  локального каталога, грузится на месте, без копии;
- `version` из `.claude-plugin/plugin.json` фиксирует копию до смены строки. Без `version` берётся
  SHA git, у локального каталога без git — `unknown`;
- `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`) переживает обновления plugin, но по
  умолчанию удаляется при uninstall;
- `claude plugin marketplace add` пишет `extraKnownMarketplaces` в `~/.claude/settings.json`;
- всё, что несёт plugin, живёт в его namespace: skill — `/<plugin>:epic-wave`, Subagent —
  `<plugin>:implementer`.

Spike 2026-10-07 (Agent SDK 0.3.289 и встроенный в него Claude Code 2.1.289) проверил опытом:

- Session SDK с `settingSources`, в которых есть `'user'`, грузит plugin-ы из области
  пользователя — да;
- `plugins: [{type: 'local', path}]` с тем же именем молча заменяет установленный plugin
  (id `<name>@inline`) — да;
- скрипты из `bin/` plugin лежат в PATH у Bash главной Session и у Subagent-а — да;
- `${CLAUDE_PLUGIN_ROOT}` подставляется в текст SKILL.md — да;
- встроенный бинарь SDK знает `claude plugin install | enable | marketplace …` — да
  (`plugin --help`);
- skill plugin вызывается только с префиксом (`/worfy:epic-wave`), голое имя не работает (по
  документации agent-sdk/plugins, без опыта).

Не проверено: как встроенный `claude` ставит plugin из локального marketplace — коды выхода,
повторный запуск, обновление при смене `version`. Это проверяет Ticket 01 Epic-а (spike; итог —
ADR-0048).

Сегодня worfy зовёт скрипты Harness по пути `<claudeHome>/bin/…` (`epicStatusPath`,
`src/main/workflow/reader.ts:63`; `profilePath`, `src/main/workflow/profile.ts:41`), знает skills по
голым именам (`src/shared/projects/action-templates.ts:33-34`, `src/shared/binding/resolve.ts`), а
версия приложения в `package.json` — `0.0.0`.

**Решение.**

1. **Доставка (Q1).** `.app` несёт `harness/` своей версии. worfy при запуске копирует его в
   `~/.claude/worfy-harness/plugin/`, регистрирует эту папку как локальный marketplace
   (`claude plugin marketplace add`) и ставит plugin в область пользователя
   (`claude plugin install … --scope user`). Команды выполняет бинарь Claude Code из пакета SDK
   (ADR-0008), а не `claude` из PATH пользователя. Plugin из локального marketplace грузится на
   месте, поэтому Session-ы пользователя в терминале читают Harness прямо из этой папки.
   Session-ы worfy — по пункту 2.
2. **Session-ы worfy идут на своей версии.** Session-ы, которые запускает worfy, дополнительно
   получают `plugins: [{type: 'local', path}]` — Harness той же версии, что приложение. По spike
   такой plugin молча заменяет установленный с тем же именем: worfy работает на своём Harness,
   даже если в области пользователя стоит другая версия.
3. **Имя (Q2).** Plugin называется `worfy`: `/worfy:epic-wave`, `/worfy:ship-ticket`, Subagent
   `worfy:implementer`. Skills и agents зовут скрипты Harness через `${CLAUDE_PLUGIN_ROOT}`.
   worfy понимает и старые имена без префикса: они остаются в старых транскриптах (Ticket 10 —
   префикс `worfy:` в Binding-е, показе Subagent-ов и шаблонах действий).
4. **Версия (Q12).** semver приложения в `package.json` поднимается в конце каждого Epic-а:
   Ticket 04 ставит `0.2.0`, после E3 будет `0.3.0`. Сборка пишет в поле `version` файла
   `harness/.claude-plugin/plugin.json` строку `<semver>+<короткий SHA>`. worfy сравнивает её со
   строкой установленного plugin и переустанавливает plugin, когда они разные. Версия Harness видна
   в UI.
5. **Состояние Harness на машине (Q4)** — папка `~/.claude/worfy-harness/`. Она одна на машину,
   постоянная, переживает переустановку plugin и worfy и сама является локальным
   git-репозиторием. В ней лежат копия plugin (`plugin/`), реестр Gate (`gate/config.json`) и
   маркеры Gate (`gate/state/`), Profile-ы Project-ов (`projects/<project>/`, ADR-0042), замки
   worktree и резервные копии переноса (ADR-0047).
6. **Минимальная версия Claude Code (Q20)** — та, что встроена в эту сборку worfy. Первый запуск
   сравнивает с ней `claude --version` из терминала пользователя. Если терминальный `claude`
   старше, worfy предупреждает и показывает команду обновления; работу он не блокирует.
7. **Исключение из ADR-0005** (worfy ничего не пишет вне своей папки данных, кроме регистрации
   Project в Gate). Установщик пишет в `~/.claude`: сам — в `~/.claude/worfy-harness/` (копия
   plugin, состояние Harness), через команды `claude plugin` — в настройки Claude Code
   (`extraKnownMarketplaces` в `~/.claude/settings.json`) и в его записи об установленных
   plugin-ах. Каждая установка и каждое обновление идут после подтверждения пользователя. Перенос
   разрозненных файлов владельца из `~/.claude` — второе такое исключение; его правила — в
   ADR-0047. Test-ы установщика идут в песочнице (`HOME` и `CLAUDE_CONFIG_DIR` во временной
   папке), а не на настоящем `~/.claude`. В репозитории Project-ов worfy по-прежнему не пишет
   ничего.

**Что меняется в прежних ADR.**

- ADR-0019 уточняется: источник установки — локальный marketplace в
  `~/.claude/worfy-harness/plugin/`, не каталог внутри `.app` и не GitHub; Session-ы worfy
  вдобавок получают plugin inline. Остальное в ADR-0019 в силе.
- ADR-0005 и ADR-0023 (раздельные папки данных dev и packaged; повторяет правило ADR-0005):
  запись worfy вне папки данных больше не одна, к регистрации в Gate добавляется пункт 7. Реестр
  Gate переезжает из `~/.claude/gate/config.json` в `~/.claude/worfy-harness/gate/config.json`.
- ADR-0002 (worfy — вид на workflow): «скрипты Harness» — это скрипты plugin. worfy находит их в
  папке plugin, а не в `<claudeHome>/bin` (Ticket 12). Правило «агенты работают с конфигурацией
  пользователя» остаётся; Session-ы worfy добавляют к ней plugin своей версии.

**Последствия.**

- Путь к Harness не зависит от того, где лежит `.app`: Stable copy, dev-сборка и будущая
  подписанная сборка E4 ставят его в одну папку.
- На машине владельца две сборки worfy (Stable copy и dev-запуск, ADR-0023) с разными SHA. Это
  решение не говорит, какая из них ставит plugin в область пользователя. По ADR-0047 урок
  начинает действовать после `pnpm install:stable`, то есть ставит Stable copy; как dev-запуск не
  переустанавливает plugin поверх неё — вопрос Ticket-а 13 (установщик).
- worfy вызывает `epic-status` и `profile` из папки plugin; skills уходят с префиксом `worfy:`;
  Binding и шаблоны действий понимают оба вида имён (Ticket-ы 10 и 12).
- `~/.claude/worfy-harness/` не удаляется ни при uninstall plugin, ни при удалении worfy:
  Profile-ы, реестр Gate и резервные копии остаются, пока пользователь не удалит папку сам.
- Старый `claude` в терминале не блокируется: о том, что часть Harness на нём может не
  сработать, пользователь узнаёт из предупреждения, а не из отказа.
- Пока Ticket 01 не проверил установку встроенным `claude` (коды выхода, повтор, обновление по
  `version`), пункты 1 и 4 опираются на документацию. Если опыт разойдётся с ней, ADR-0048
  говорит, что меняется.

## Considered Options

- **Копия `harness/` в `~/.claude/worfy-harness/plugin/` как локальный marketplace, плюс inline у
  Session-ов worfy** (выбрано). Работает без сети; путь постоянный и не зависит от места `.app`;
  установленный Harness — той версии, что у поставившего его приложения.
- **Marketplace на GitHub (репозиторий worfy), `version` = версия приложения.** Отвергнуто: нужны
  сеть и доступ к private-репозиторию, а HEAD marketplace уходит вперёд установленного `.app`.
- **Локальный marketplace прямо в `.app/Contents/Resources/harness`.** Отвергнуто: путь меняется
  вместе с `.app` — у Stable copy, у dev-сборки, при App Translocation в E4.
- **Только установка в область пользователя, без inline.** Отвергнуто: если у пользователя стоит
  другая версия plugin `worfy`, Session-ы worfy шли бы на ней, а worfy читает вывод скриптов и
  формат Ticket-ов своей версии (ADR-0019).
- **Имя `harness`.** Отвергнуто: общее слово, легко столкнуться с чужим plugin.
- **Имя `worfy-harness`.** Отвергнуто: длинно, а имя стоит в каждом вызове skill и Subagent-а.
- **Состояние в `${CLAUDE_PLUGIN_DATA}`.** Отвергнуто: по умолчанию удаляется при uninstall plugin,
  а с ним — Profile-ы и реестр Gate.
- **Состояние в папке данных worfy.** Отвергнуто: она разная у dev-запуска и Stable copy
  (ADR-0023), а `claude` в терминале про неё не знает.
- **Версия — только SHA.** Отвергнуто: по SHA человек не видит, какая версия новее; для показа в
  UI и для E4 («Для других людей») нужна semver приложения.
- **Блокировать работу при старом `claude` в терминале.** Отвергнуто: Session-ы worfy идут на
  встроенном бинаре, и терминальный `claude` им не мешает; блок остановил бы worfy из-за
  программы, которой worfy не пользуется.
