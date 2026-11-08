# 0102 — Частные skills Project-а — в папке Profile-а, в Session через `additionalDirectories`
Дата: 2026-11-08. Статус: принят. Epic `worfy-human-review`, Ticket 05; spec — `.scratch/worfy-human-review/spec.md`
(«Решения владельца 2026-11-07», п. 8, 9, 11; «Как работает» → «Частная папка», «Загрузка в Session»; «Сгенерированное и
решения без владельца», п. 4, 8; «Вопросы владельцу», Q1, Q2; «Риски», п. 1).

**Контекст.** Генератор `/worfy:human-review-setup` пишет skill ревью голосом команды Project-а. В нём слова коллег, поэтому
владелец решил (решение 8): skill лежит только на машине пользователя, в папке Profile-а Project-а, и никогда — в
репозитории проекта или в репозитории worfy. Ticket-ы 06, 07 и 09 уже кладут его в `<папка Profile-а>/state/human-review/`
(Q2 (а)), в `.claude/skills/human-review/SKILL.md`. Папку называет `_resolved.dir` в `bin/profile` (то же печатает
`bin/profile --dir`). Каталог `state/` вне истории git папки Harness home. До этого ADR Session-ы worfy папку Profile-а не
читали, и skill в них не попадал.

**Решение.**

1. **Где лежат.** Частные skills Project-а лежат в `<папка Profile-а>/state/human-review/.claude/skills/`. Это та же папка,
   которую раздел «Team reviewer» в Project settings показывает и удаляет (`src/main/projects/review-offer.ts`,
   `privateFolder`, `reviewerSkill`).
2. **Как попадают в Session.** При каждом старте Session в Project-е worfy читает `_resolved.dir` через
   `bin/profile -C <cwd> --field _resolved.dir` (`readProfileFolder`, `src/main/workflow/profile.ts`). Если в частной
   папке есть `.claude/skills/human-review/SKILL.md`, папка `state/human-review/` идёт в `additionalDirectories`
   (флаг `--add-dir` Claude Code) вторым элементом, после папки карточек (`src/main/vendors/claude/options.ts`,
   `src/main/vendors/claude/query.ts`). Claude Code грузит `.claude/skills/` из такого каталога так же, как из каталога
   проекта. Skill называется `/human-review` (Q1 (а)).
   Проверено на Claude Code 2.1.289 (SDK 0.3.289): в `system/init` skill `hr-probe` из `--add-dir` есть в `skills` и в
   `slash_commands`, без `--add-dir` его нет; путь с пробелом работает; flag settings списка `skills.allowed` его не
   убирают. Вызов skill-а моделью живым запуском не проверен: запуск шёл без входа в аккаунт и без токенов
   (Ticket 05, «Итог»).
3. **Кто получает.** Session-ы, которые ведёт человек: Orchestrator, «New session», «Ship ticket», Product Session.
4. **Кто не получает.**
   - Session без человека (`unattended`, Autopilot, `bypassPermissions`). Там некому сказать «да» черновику ревью
     (решение 9). Папка Profile-а для неё даже не читается.
   - Одноразовая Session черновика Profile-а (`projects.connect.draft`, `draftSessionOptions`). Это чтение папки при
     подключении, а не Session человека.
   - Session вне Project-а, и Session, к которой не подключился Canvas. Как и списки Profile-а, папка читается только для
     Session в Project-е.
   - Session Codex (spec, п. 8): этот ADR меняет только опции Claude Code.
5. **Без папки — как раньше.** Нет Profile-а, нет `SKILL.md`, ошибка `bin/profile` — опции Session не меняются. Ошибка
   `bin/profile` или не абсолютный путь даёт одну строку в log. Session стартует в любом случае.
6. **`skills.allowed` (ADR-0084) не трогает частную папку.** `skillOverrides` называет только skills из
   `~/.claude/skills`, `enabledPlugins` — только plugin-ы. Исключение — совпадение имён: skill `human-review` в
   `~/.claude/skills`, которого нет в списке, выключит по имени и частный.

**Почему не репозиторий и не `~/.claude/skills`.**

- Репозиторий проекта — нельзя по решению 8 и по ADR-0005 (worfy ничего не пишет в репозитории проектов). Skill в
  `.claude/skills/` проекта ушёл бы коллегам при первом push.
- `~/.claude/skills` — общий для всех проектов пользователя. Skill одной команды был бы виден в Session-ах любого
  проекта, и его выключал бы `skills.allowed` других Profile-ов. Кроме того, worfy не пишет в `~/.claude` (ADR-0005).
- Папка Profile-а — своя у каждого Project-а, вне истории git, и «Delete» стирает её одним действием.

## Considered Options

- **(а) Частная папка в `additionalDirectories`, рядом с папкой карточек.** Принято (Q1 (а), владелец 2026-11-07). Одна
  строка в опциях, без второго manifest-а.
- **(б) Частная папка как второй локальный plugin в `options.plugins`, как Harness.** Skill назывался бы
  `/<имя plugin-а>:human-review`, нужен свой `plugin.json`. Запасной путь, если бы (а) не грузил skills. Проверка
  показала, что грузит.
- **(в) Копия в `.claude/skills/` проекта.** Нельзя по решению 8.
- **Папку получает и Session без человека.** Отвергнуто: Autopilot идёт в `bypassPermissions`, и черновик ревью для
  коллег никто не прочитал бы до отправки.
- **Читать папку для любой Session, даже без Canvas.** Отвергнуто: лишний запуск `bin/profile` на каждом старте Session
  вне Project-а. Списки Profile-а тоже читаются только в Project-е.
