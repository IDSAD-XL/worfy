# 0049 — Session-ы worfy без inline plugin-а, пока на машине старый Harness
Дата: 2026-10-07. Статус: принят.

Уточняет [ADR-0040](0040-harness-delivery-local-marketplace.md), пункт 2 («Session-ы worfy идут на
своей версии»). Остальное в ADR-0040 — где лежат plugin и состояние Harness, имя `worfy`, версия —
остаётся как есть; Ticket 12 Epic-а `worfy-harness` его выполняет.

**Контекст.** ADR-0040, пункт 2: каждая Session, которую запускает worfy, получает
`plugins: [{ type: 'local', path }]` — копию Harness той же сборки (`src/main/harness/bundled.ts`,
Ticket 04: `<resourcesPath>/harness` в `.app`, `out/harness` без упаковки). Spike 2026-10-07
(ADR-0048) показал: такой plugin молча заменяет установленный с тем же именем.

Но до перехода машины владельца (Ticket 16, ADR-0047) Harness живёт по-старому: скрипты в
`~/.claude/bin/`, hooks записаны в `~/.claude/settings.json`, Stable copy ведёт Wave-ы на нём.
Session worfy грузит настройки пользователя (`settingSources` с `'user'`, ADR-0002), значит
получает старые hooks. Plugin `worfy` несёт те же hooks (ADR-0041). Если дать ему ещё и plugin
inline, каждый hook сработает дважды: два gate, два guard, двойные записи в состояние (spec.md
Epic-а, «Риски и открытые технические вопросы», пункт 3). Старые записи убирает только перенос
(Ticket 14) на шаге владельца (Ticket 16).

worfy определяет, какой Harness на машине (`src/main/harness/locate.ts`), при каждом старте
Session:

- `legacy` — есть `<claudeHome>/bin/epic-status` (на машине старый Harness, с plugin-ом рядом или
  без него);
- `plugin` — старого нет, есть `<harnessHome>/plugin/` с манифестом `name: worfy` и
  `bin/epic-status`;
- `none` — нет ни того, ни другого.

**Решение.**

1. При `legacy` Session-ы worfy стартуют **без** поля `plugins`: Harness приходит к ним из
   `~/.claude`, как до Epic-а. Это отступление от ADR-0040, пункт 2.
2. При `plugin` и `none` — как решил ADR-0040: `plugins: [{ type: 'local', path: <копия этой сборки> }]`.
   При `none` своя копия — единственный Harness Session-а.
3. Если на машине есть оба Harness, побеждает `legacy`: старые hooks уже записаны в
   `settings.json`, и plugin запускал бы их второй раз.
4. Шаблоны действий «Ship ticket» и «Run wave» идут за тем же выбором: при `legacy` — голые имена
   skills (`/ship-ticket`, `/epic-wave Ticket-ы … эпика …`), при `plugin` и `none` — с префиксом
   (`/worfy:ship-ticket`, `/worfy:epic-wave tickets … of epic …`). Иначе Session с inline plugin-ом
   получила бы имя skill-а, которого у неё нет, а Session на старом Harness — имя с префиксом.

**Когда отступление кончается.** Когда перенос (Ticket 14) на шаге владельца (Ticket 16) убирает
старые файлы из `~/.claude` — `bin/epic-status` в первую очередь. Со следующего старта Session worfy
находит `plugin` и передаёт свою копию inline, как требует ADR-0040, без перезапуска приложения и без
правки кода. Ветку `legacy` в `locate.ts` и шаблоны старого Harness можно убрать после того, как
на машине владельца не останется старого Harness.

## Considered Options

- **Всегда inline, как в ADR-0040, пункт 2.** Отвергнуто: до Ticket-а 16 на машине владельца каждый
  hook срабатывал бы дважды, и Stable copy, которая ведёт Wave-ы, перестала бы работать как сейчас.
- **Inline при `legacy`, но с отключением старых hooks из worfy.** Отвергнуто: worfy пришлось бы
  писать в `~/.claude/settings.json` или передавать Session-у свой `settings`, в обход настроек
  пользователя. ADR-0005 запрещает worfy писать вне своей папки данных, ADR-0002 требует, чтобы
  Session шла на настройках пользователя.
- **Без inline, пока на машине старый Harness; при plugin и none — inline (выбрано).** Stable copy
  до Ticket-а 16 работает как сейчас. Переход машины worfy видит сам, при следующем старте Session.
- **Без inline вообще до Ticket-а 16, по флагу в настройках.** Отвергнуто: флаг пришлось бы
  переключать руками на каждой машине, а признак «старый Harness на месте» уже лежит на диске.
