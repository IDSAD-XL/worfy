# 01 — Чтение Claude memory в main: путь как у runtime, записи, индекс и его размер в знаках

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 1; «Решения владельца», Q13; «Решено советником» («Путь к папке
worfy считает так же, как runtime», «Project из нескольких репозиториев», «Linked Machine», «Размер индекса»);
«Решения по реализации» («Модули» → main, «Контракт чтения», «Операции»); «Решения по test-ам», Seam 2; «Риски»
(«Runtime поменяет правило пути»); истории 1, 3, 4, 8, 10, 11, 19, 22; «Волны», Wave 1

Кто: агент.

## Что строить

1. **Путь к папке памяти репозитория** — в том же порядке, что у runtime (Q13):
   1. env `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE`;
   2. setting `autoMemoryDirectory`;
   3. иначе `<база>/projects/<имя>/memory/`:
      - база — env `CLAUDE_CODE_REMOTE_MEMORY_DIR`, иначе `CLAUDE_CONFIG_DIR`, иначе `~/.claude`;
      - имя — env `CLAUDE_CODE_PROJECT_DIR_NAME`, только при заданном `CLAUDE_CONFIG_DIR`. Иначе — путь канонического
        git root через ту же функцию, которой worfy уже называет папки transcript-ов: всё, кроме букв и цифр,
        становится `-`, имя длиннее 200 знаков обрезается, и к нему дописывается hash. Своего второго правила нет.
2. **Контракт чтения** на каждый репозиторий Project-а (у каждого репозитория своя папка памяти):
   - папка памяти;
   - индекс `MEMORY.md`: строки и знаки после trim, против предела 200 строк и 25 000 знаков. Знаки — как длина строки
     JS (UTF-16), а не байты UTF-8 (Q13);
   - записи: файл, name, description, type, originSessionId, modified, есть ли строка в индексе.
3. **Операция «прочитать файл»** записи целиком. Сохранение и удаление — Ticket 05.
4. Читается память той машины, на которой открыт worfy. Память другой Linked Machine — не в этом Epic-е.
5. Правило пути встаёт в список того, что проверяется при обновлении Claude Code (spec, «Решено советником» и «Риски»:
   иначе после обновления раздел молча покажет пустоту, история 19).

## Где в коде

- `src/main/claude-home/registry.ts` — `projectDirName`: функция, которой worfy называет папки transcript-ов (с обрезкой
  и hash длинных имён).
- `src/main/storage/paths.ts` — свой reader `~/.claude` у worfy, только чтение.

## Готово, когда

- [ ] Путь папки памяти считается в порядке runtime: override из env, `autoMemoryDirectory`, иначе
      `<база>/projects/<имя>/memory/`. Unit test-ы на fixture-папке — каждый вариант правила, включая базу из env
      (`CLAUDE_CODE_REMOTE_MEMORY_DIR`, `CLAUDE_CONFIG_DIR`) и имя длиннее 200 знаков с hash.
- [ ] Имя папки даёт `projectDirName`; второго правила кодирования пути в коде нет.
- [ ] Unit test: разбор frontmatter записи на fixture — name, description, type (user, feedback, project, reference),
      originSessionId; у записи есть modified и признак, есть ли её строка в индексе.
- [ ] Unit test: размер индекса — строки и знаки после trim; переход предела 200 строк или 25 000 знаков виден.
- [ ] Unit test: fixture-индекс на кириллице не считается переполненным раньше runtime (знаки UTF-16, не байты UTF-8).
- [ ] Project из двух репозиториев: чтение отдаёт папку и записи каждого репозитория отдельно.
- [ ] Правило пути стоит в списке того, что проверяется при обновлении Claude Code. Spec не называет файл этого
      списка — PR называет, куда записано.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
