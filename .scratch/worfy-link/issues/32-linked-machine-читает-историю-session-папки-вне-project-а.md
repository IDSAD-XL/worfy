# 32 — Linked machine может прочитать историю Claude Session папки вне Project-а

Type: bug
Status: claimed 2026-10-18T19:55Z
Branch: worfy-link/32
Blocked by: —
Source: ревью корректности Ticket-а worfy-windows 57, круг 2 (ПК владельца, 2026-10-18), чтение кода.
Дефект есть и до 57 (на `f7ea055f`); 57 его не создаёт и не чинит. Запуском не проверено.

Приоритет — high: это обход границы доступа Linked machine (ADR про доступ `project`: Linked machine
работает только внутри Project-ов этой Machine).

## Что происходит (гипотеза по коду)

- **Проверка «внутри Project-а» пропускает путь, которого нет.** `src/main/link/caller.ts:13-14`:
  несуществующий путь судится по ближайшей существующей папке. Linked machine присылает корнем
  `<Project>/evil` (папки `evil` нет) — ближайшая существующая папка — корень Project-а, и
  `insideProjects` (`caller.ts:65`) путь пропускает.
- **Имя папки Claude не однозначно.** `projectDirName('/p/A/evil')` = `-p-A-evil` — то же имя, что у
  папки `/p/A-evil`, которая лежит **вне** Project-а.
- **При точном совпадении имени cwd не проверяется.** `src/main/claude-home/registry.ts:67`
  (`dirMatch`): точное совпадение имени даёт `project`, и transcript-ы этой папки отдаются без проверки
  их `cwd`. Проверка cwd идёт только для `subfolder`.
- Итог: удалённая Machine читает историю Claude Session папки `/p/A-evil` — вне всех Project-ов.

## Что делаем

1. Красный test на сценарий: Project `/p/A`, рядом папка `/p/A-evil` с Session; remote-вызов
   Claude home с корнем `/p/A/evil` не должен вернуть ни одной Session `/p/A-evil`.
2. Закрыть с двух сторон (оба пункта, не один):
   - на remote-вызове корень Claude home должен существовать и быть корнем Project-а или его worktree,
     а не любым путём внутри (`insideProjects` для путей-файлов оставить как есть);
   - в `dirMatch` точное совпадение имени — не доказательство: если имя совпадает и с папкой вне
     корней, решает `cwd` transcript-а, как для `subfolder`.
3. Проверить других потребителей `insideProjects`, которые принимают корень, а не путь файла:
   `src/main/ipc/{bindings,pipeline,workflow,checks}.ts` — нет ли там того же приёма с
   несуществующим подкаталогом.

Пересечение: worfy-windows 57 правит Claude home (написание корня) — брать после его мержа.

## Готово, когда

- [ ] test на сценарий красный до правки и зелёный после; mutant без каждой из двух проверок пункта 2
      красный.
- [ ] Ревью high с линзой безопасности.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — `[gate] зелено (full)`.

## Итог

Заполняется при закрытии.

Заметка до мержа PR #508 (находка low ревью, мерж не держит): ни один test в репозитории не берёт
написание корня worktree, которое даёт git на Windows (`C:/…` из `git worktree list --porcelain`). Test на
ПК прошёл (комментарий 6255339725 в PR #508).
