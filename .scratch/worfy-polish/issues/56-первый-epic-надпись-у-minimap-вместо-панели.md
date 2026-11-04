# 56 — Первый Epic: небольшая надпись у Minimap вместо панели посреди Canvas

Type: change
Status: done 2026-11-04T13:01Z
PR: #1363
Blocked by:
Source: владелец 2026-11-04 в чате Orchestrator-а: «убираем табличку plan your first epic. делаем небольшую надпись
возле карты без подложки»; уточнено: возле Minimap, надпись кликабельная

## Что происходит

На Canvas Project-а без Epic-ов посреди экрана стоит панель с подложкой (`src/renderer/canvas/overlays/FirstEpic.tsx`,
worfy-harness 24): заголовок, текст «Tell the Orchestrator what you want to build…» и кнопка «Plan first epic».
Владельцу она мешает.

## Что делаем

1. Панель посреди Canvas убрать. Вместо неё — одна небольшая надпись-ссылка без подложки, рамки и тени, рядом с
   Minimap (`MiniMapOverlay.tsx`, правый нижний угол), например «Plan your first epic →». Нажатие делает то же, что
   кнопка сейчас (`plan()`): Orchestrator получает просьбу спланировать первый Epic.
2. Состояния, которые были у панели, остаются: занято (надпись неактивна), ошибка (короткий текст под надписью), Canvas
   только для чтения (worfy-link 25 — надпись неактивна, подсказка в tooltip), первый Epic убирает надпись.
3. Minimap скрыт (View ▸ Show Minimap выключен) — надпись стоит в том же углу. Надпись не перекрывает Minimap и
   закреплённые Node-ы (`pinning.ts`, `setMinimapCorner`) и не мешает pan/zoom Canvas (класс `nodrag nopan`).
4. Читается в обеих темах: цвет текста из токенов темы (например, `--text-secondary`, при наведении `--accent`).

Глубина review — `low`.

## Готово, когда

- [ ] Unit test `FirstEpic`: надпись вместо панели, клик вызывает план, занято/ошибка/только чтение.
  - evidence: test-run pass · `pnpm test test/unit/first-epic.test.tsx` exit 0 · mac - · 8d38f26b63465991f57c3b3465e333197c0b8a0c
- [ ] e2e: на пустом Project-е надпись у Minimap, без подложки, клик отправляет просьбу Orchestrator-у; снимки в обеих
      темах в `.scratch/worfy-polish/evidence/56/` со строками `ticket evidence`.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/projects-connect.spec.ts test/e2e/snapping.spec.ts` exit 0 · mac dev · 8d38f26b63465991f57c3b3465e333197c0b8a0c
  - evidence: screenshot pass · `../evidence/56/56-first-epic-light.png` · mac dev · 8d38f26b63465991f57c3b3465e333197c0b8a0c · scrub: 2026-11-04
  - evidence: screenshot pass · `../evidence/56/56-first-epic-dark.png` · mac dev · 8d38f26b63465991f57c3b3465e333197c0b8a0c · scrub: 2026-11-04
- [ ] Все unit и contract test-ы `src/renderer/canvas/`, `pnpm typecheck`, `pnpm lint` — exit 0.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · 8d38f26b63465991f57c3b3465e333197c0b8a0c
  - evidence: test-run pass · `pnpm typecheck` exit 0 · mac - · 8d38f26b63465991f57c3b3465e333197c0b8a0c
  - evidence: test-run pass · `pnpm lint` exit 0 · mac - · 8d38f26b63465991f57c3b3465e333197c0b8a0c
  - evidence: gate pass · `gate fast` exit 0 · mac - · 8d38f26b63465991f57c3b3465e333197c0b8a0c

## Итог

**Что сделано.** Панели «No epics yet» посреди Canvas больше нет. На Canvas Project-а без Epic-ов над Minimap, по
правому краю, стоит надпись-кнопка «Plan your first epic →» (`src/renderer/canvas/overlays/FirstEpic.tsx`,
`first-epic.css`): только текст 12 px без подложки, рамки и тени, цвет `--text-secondary`, при наведении и фокусе
`--accent`, неактивная — `--text-muted`. Minimap скрыт — надпись стоит в том же углу, в 15 px от краёв. Клик делает то
же, что кнопка: `orchestrator.open`, Orchestrator-у ничего не отправляется. Пока Orchestrator открывается, надпись
неактивна; ошибка — короткий текст под надписью; на экране только для чтения (worfy-link 25) надпись неактивна, причина
— в tooltip (`title`); первый Epic убирает надпись. Класс `nodrag nopan nowheel` — pan/zoom Canvas надпись не трогает.

Надпись держит свой прямоугольник в правом нижнем углу (`pinning.ts`, новый `holdCorner`; `setMinimapCorner` теперь
его обёртка): закреплённые Node-ы обходят угол, который охватывает и Minimap, и надпись. Размер надписи меряет
`useElementSize`. Состояние видимости Minimap и его размеры перенесены из `MiniMapOverlay.tsx` в
`overlays/minimap-view.ts`, чтобы их читала и надпись (lint `react-refresh/only-export-components` не даёт
экспортировать их из файла компонента). Страница `docs/features/workflow.md` исправлена.

Снимки: [светлая](../evidence/56/56-first-epic-light.png), [тёмная](../evidence/56/56-first-epic-dark.png).

**Решено без владельца, подтверждено владельцем 2026-11-04.**
- Надпись — над Minimap, выровнена по его правому краю, с зазором 8 px, а не слева от него: так она занимает меньше
  места в углу, который обходят закреплённые Node-ы.
- Текст — «Plan your first epic →» (пример из тикета), размер 12 px.
- Пока надпись видна, угол, который обходят закреплённые Node-ы, выше на высоту надписи (с Minimap 232 × ~206 вместо
  232 × 182); закреплённый Node, стоявший вплотную над Minimap, на пустом Project-е сдвигается вверх.
- `test/e2e/snapping.spec.ts` по-прежнему строит Project с одним Epic-ом (надпись там не нужна); поправлен только
  комментарий о причине.
