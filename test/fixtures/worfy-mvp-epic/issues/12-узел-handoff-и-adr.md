# 12 — Узел HANDOFF и список ADR: живой markdown из репозитория, только для чтения

Type: task
Status: open
Blocked by: 05, 33
Source: [CONTEXT.md](../../../CONTEXT.md), термин «HANDOFF»; [BRIEF.md](../../../docs/design/BRIEF.md), Screen 1 пункт 4 и sidebar «ADR»

## Что делаем

- Если в корне Проекта есть `HANDOFF.md`, на Холсте появляется Узел HANDOFF с `locked` (05) и
  отрендеренным markdown. Правка файла (руками или агентом) обновляет Узел за ≤ 1 с. Узел можно
  сдвинуть и изменить размер, удалить — нет; если файла нет, Узла нет.
- Рендер — общий `src/renderer/markdown/Markdown.tsx` из тикета 33 (сырой HTML не исполняется,
  ссылки — через канал `shell` из 11). Здесь он не меняется.
- Sidebar, раздел «ADR»: `docs/adr/NNNN-*.md` Проекта — номер, заголовок (H1), статус (строка
  `Статус: …`), число в заголовке раздела. Щелчок открывает ADR в панели только для чтения
  поверх Холста; Esc закрывает.
- `src/main/docs/watch.ts` следит за `HANDOFF.md` и `docs/adr/`; канал `docs.read` отдаёт текст
  файла только из этих двух мест (путь проверяется после `realpath`, выйти за корень Проекта
  нельзя).
- worfy эти файлы не пишет.

## Готово, когда

- [ ] На репозитории worfy виден Узел HANDOFF; правка `HANDOFF.md` видна за ≤ 1 с.
- [ ] Список ADR в sidebar совпадает с `docs/adr/`; щелчок открывает текст ADR.
- [ ] `docs.read` с путём `../../etc/passwd` или симлинком наружу отклоняется.
- [ ] После открытия Проекта `git status --porcelain` пуст.

## Тесты

- `test/contract/docs.test.ts` — `docs.read` и проверка пути (новый).
- `test/e2e/handoff.spec.ts` — Узел появляется и обновляется после правки файла (новый).
- Сначала падающий test: `docs.test.ts` на выход за корень Проекта.

## Где в коде

- `src/renderer/canvas/nodes/HandoffNode.tsx`
- `src/renderer/shell/sidebar/AdrSection.tsx`
- `src/main/docs/watch.ts`
- `src/main/ipc/docs.ts`, `src/shared/ipc/docs.ts`
