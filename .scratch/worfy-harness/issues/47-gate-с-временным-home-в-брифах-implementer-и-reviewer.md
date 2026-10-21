# 47 — Брифы implementer и reviewer: gate и test-ы с временным HOME — реестр Gate и пустые rc-файлы zsh

Type: task
Status: done 2026-10-21T03:14Z
PR: #643
Blocked by:
Source: решение владельца 2026-10-15 по Wave-ам Epic-а `worfy-polish` (Ticket-ы 01–13): implementer-ы
и verifier-ы гоняли test-ы и gate с временным HOME ([`worfy-polish` 03](../../worfy-polish/issues/03-contract-test-ы-без-настоящего-claude-home.md), раздел
«Gate оркестратора (2026-10-15)»: «Verifier сам, всё с временным HOME»). Факты владельца: gate с
временным HOME отдаёт код 3; приглашение zsh для нового пользователя вешает contract test-ы. Код
перечитан по main `524ed20`. Пересечение — [Ticket 45](45-e2e-и-login-shell-разработчика.md).

## Что происходит

Бриф Wave (шаблон — `harness/skills/epic-wave/SKILL.md:218-235`) может велеть агенту гонять test-ы с
временным HOME, чтобы не писать в настоящий `~/.claude`. Как это сделать, брифы не говорят. Отсюда
две поломки.

- **Gate с временным HOME — код 3.** Реестр Gate ищется так: `CLAUDE_GATE_CONFIG`, иначе
  `$HARNESS_HOME/gate/config.json`, иначе `<HOME>/.claude/worfy-harness/gate/config.json`
  (`harness/hooks/gate-paths.mjs:17-29`). С временным HOME и без этих переменных реестра нет: Project
  «не зарегистрирован», gate пишет «ПРОВЕРИТЬ НЕ УДАЛОСЬ» и выходит с кодом 3
  (`harness/hooks/gate.mjs:950-962`). Это «не проверено», не зелено.
- **Команда gate в брифах — без окружения.** `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast
  </dev/null; echo "EXIT=$?"` — в шаге 5 implementer-а (`harness/agents/implementer.md:136-150`) и в
  проверке verifier-а (`harness/skills/epic-wave/SKILL.md:264`). Про HOME там ни слова.
- **zsh во временном HOME ждёт ввода.** worfy и contract test-ы снимают окружение login shell:
  `$SHELL -ilc` (`src/main/agent/env.ts:94`, `:111`). Если в HOME нет `.zshenv`, `.zprofile`,
  `.zshrc`, zsh показывает приглашение для нового пользователя и ждёт клавиатуру. Test висит до
  timeout-а. Contract test-ы, которые задают или читают `SHELL`, есть в нескольких файлах
  `test/contract` (например, `terminal.test.ts`, `harness-script-env.test.ts`).
- **Reviewer** гоняет `<commands.verify>` сам (`harness/agents/reviewer.md:160-162`) — с временным
  HOME то же зависание.

### Что уже покрывает Ticket 45

Ticket 45 — про e2e: `launchApp` (`test/e2e/helpers.ts`) отдаёт приложению `SHELL` и `HOME`
разработчика, и каждый старт worfy запускает `$SHELL -ilc` с его rc-файлами. Ticket 45 даёт
`launchApp` свой `SHELL` по умолчанию. Это код test-ов worfy, не брифы Harness. Contract test-ы,
команду gate и реестр он не трогает. Конкретных spec-ов `projects-connect` и `select` и node из nvm
Ticket 45 не называет. Этот Ticket это не дублирует: e2e и login shell — в 45, здесь — только брифы.

## Что делаем

1. **Строка брифа «временный HOME».** В шаблон брифа implementer-а (`SKILL.md:218-235`) и verifier-а
   (раздел 3) — строка, например `Temporary HOME: yes | no`. Пояснение под шаблоном (`:237-244`):
   когда её ставить.
2. **Готовый рецепт в брифе.** Если временный HOME — да, агент делает так (пути нейтральные, без
   личных, как требует Ticket 33):
   ```bash
   REAL_HOME="$HOME"; T="$(mktemp -d)"
   : > "$T/.zshenv"; : > "$T/.zprofile"; : > "$T/.zshrc"   # иначе zsh ждёт ввода нового пользователя
   HOME="$T" HARNESS_HOME="$REAL_HOME/.claude/worfy-harness" \
     CLAUDE_GATE_CONFIG="$REAL_HOME/.claude/worfy-harness/gate/config.json" \
     node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"
   ```
   Те же три пустых файла — для `<commands.verify>` с временным HOME.
3. **implementer.md, шаг 5** и **reviewer.md** (`:160-162`, `:164-167`): ссылка на строку брифа и
   рецепт; код 3 с временным HOME без этих переменных — ошибка окружения, не кода.
4. **Запись Gate.** С `HARNESS_HOME` на настоящий каталог gate пишет вердикт и маркеры туда
   (`gateStateDir`, `gate-paths.mjs:32-34`) — как без временного HOME. Это каталог Harness, не
   `~/.claude/projects`; строка брифа «Write to ~/.claude» (`SKILL.md:233`) этого не запрещает —
   написать прямо.
5. **Shell-test-ы текста.** `harness/bin/tests/agents-text.test.sh` (рядом с проверкой команды gate,
   `:46-47`) и `harness/bin/tests/epic-wave-ship-ticket.test.sh` (`:51`): тексты содержат рецепт и
   строку брифа. Тот же `epic-wave-ship-ticket.test.sh` пускает `~/.claude` в тексты skills только
   как `~/.claude/projects`, `~/.claude/worfy-harness` и «Write to ~/.claude» (`:46-47`): рецепт
   пишет `$REAL_HOME/.claude/…`, не `~/.claude`.

## Готово, когда

- [ ] Брифы и агенты содержат строку «временный HOME» и рецепт; `bash harness/bin/tests/agents-text.test.sh`
      и `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0; мутант «рецепт удалён» —
      exit 1.
- [ ] Рецепт проверен в worktree worfy (вывод в «Итог»): с переменными — exit 0 и
      `[gate] зелено (fast)`; без них — exit 3 и «ПРОВЕРИТЬ НЕ УДАЛОСЬ».
- [ ] `zsh -ilc 'echo ok' </dev/null` с `HOME="$T"`: без трёх файлов — приглашение или зависание (с
      пределом времени), с ними — `ok` (вывод в «Итог»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.
- [ ] (вручную, владелец) После влития — `pnpm install:stable`: плагин в Stable copy ставит владелец.
      До этого новые брифы не действуют.

## Где в коде

- `harness/skills/epic-wave/SKILL.md:218-244`, `:260-266`.
- `harness/agents/implementer.md:136-150`.
- `harness/agents/reviewer.md:160-167`.
- `harness/bin/tests/agents-text.test.sh:46-47`.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh:46-51`.

Только читать: `harness/hooks/gate-paths.mjs:17-34`, `harness/hooks/gate.mjs:950-962`,
`src/main/agent/env.ts:94`, `:111`.

## Вне скоупа

- e2e и login shell разработчика (`launchApp`, `SHELL` по умолчанию) — [Ticket 45](45-e2e-и-login-shell-разработчика.md).
- Код worfy и test-ов worfy: этот Ticket правит только тексты Harness.
- `rules.md` Profile-а worfy на машине владельца — правки Profile только по слову владельца.
- Кейсы eval по изменённым правилам — [Ticket 29](29-кейсы-eval-по-изменённым-файлам-правил.md).

## Итог

PR [#643](https://github.com/IDSAD-XL/worfy/pull/643), merge 98325043. Gate full на main+PR зелёный; plugin-neutral 26/0;
check/windows с PC — epic-wave-ship-ticket 336/0, TMPDIR после прогона пустой. Платформенный PR.

- **Что изменилось.** `harness/skills/epic-wave/SKILL.md` (раздел 2): строка брифа `Temporary HOME: yes | no`, когда её
  ставить, рецепт; бриф verifier-а несёт ту же строку; раздел 3 — exit 3 под временным HOME без переменных рецепта —
  ошибка окружения, не verdict gate. `harness/agents/implementer.md` (шаг 5) и `reviewer.md` — тот же рецепт слово в
  слово и два правила: exit 3 под временным HOME без `HARNESS_HOME` — gate запускается заново по рецепту; запись
  verdict, marker-ов и cache в настоящий Harness home через `HARNESS_HOME` разрешена.
- **Рецепт** (после ревью) не называет путей: `H` берётся из `node "${CLAUDE_PLUGIN_ROOT}/hooks/eval-env.cjs" harness-home`
  до смены HOME (так учитываются `EVAL_HARNESS_HOME` и Windows); временный HOME с тремя пустыми rc-файлами zsh;
  `USERPROFILE` — через `pwd -W` в Git Bash; gate получает `HARNESS_HOME="$H"`. `CLAUDE_GATE_CONFIG` убран: он отключал
  запасной путь к старому реестру.
- **Проверка рецепта** на подставном Harness home (настоящий не трогали): с переменными — exit 0 и зелёная строка
  gate, verdict записан в подставной home; без них — gate «не проверено» (resolver реестра exit 4). Зависание zsh
  для нового пользователя на macOS (zsh 5.9) не воспроизвелось; пустые rc-файлы оставлены — они дёшевы.
- **Test-ы:** `agents-text.test.sh` и `epic-wave-ship-ticket.test.sh` сверяют строку брифа, рецепт целиком и оба
  правила; новый test запускает сам рецепт (bash и zsh, подставной реестр, случай только с `EVAL_HARNESS_HOME`), его
  временные папки остаются внутри дерева test-а. Прогоны на финальном head: 362/201/26 — exit 0; оба guard test-а — 0.
- **Ревью:** три круга. Круг 1 (high): correctness BLOCK — 2 med (рецепт сам вычислял Harness home; на Windows не
  ставился `USERPROFILE`); tests — PASS с low. Круги 2 и 3 (medium) — только low, исправлены.
- **Шаг владельца:** `pnpm install:stable` — до него новые брифы в Stable copy не действуют.
