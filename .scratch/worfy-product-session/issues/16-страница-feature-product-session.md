# 16 — Страница Feature `docs/features/product-session.md` и `ru/` копия

Type: task
Status: open
Blocked by: 09, 13, 14
Source: [spec.md](../spec.md), «Готово, когда»; [docs/features/README.md](../../../docs/features/README.md) (шаблон страницы и «Form of paths»)

Не платформенный Ticket. Глубина ревью — `low` и сверка каждого утверждения страницы с кодом.

## Что происходит

- Страницы Feature — `docs/features/*.md` (английский — основной), перевод — `docs/features/ru/`.
  `node scripts/check-feature-docs.mjs` проверяет, что пути на английских страницах существуют.
- Session-ы описывает `docs/features/sessions.md`; Product Session там нет.

## Что делаем

1. `docs/features/product-session.md` по шаблону README: что это, как открыть («New Product Session»), что она может и
   чего не может, папка `docs/product/<тема>/` и `mind-map.json`, экран (60 / 40, «дерево» и «граф», «скрыть
   отклонённые», чипы, руками — двигать и сворачивать), критик перед приёмкой spec-а, идеи, доля принятых, только
   Claude Code, сильнейшая модель. Пути — к коду Ticket-ов 01–14, без номеров строк.
2. `docs/features/ru/product-session.md` — перевод, термины латиницей.
3. Строка в списке страниц `docs/features/README.md`; абзац со ссылкой в `sessions.md` и `ru/sessions.md`.
4. Снимок экрана — только после проверки пикселей; без путей домашней папки и имён машин.

## Готово, когда

- [ ] Обе страницы есть; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] Каждое утверждение страницы сверено с кодом; список сверки — в «Итог».
- [ ] `node scripts/check-cyrillic.mjs` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- `scripts/check-feature-docs.mjs` (часть `pnpm lint`).

## Где в коде

- `docs/features/product-session.md` (новый)
- `docs/features/ru/product-session.md` (новый)
- `docs/features/README.md`
- `docs/features/sessions.md`
- `docs/features/ru/sessions.md`

Только читать: код Ticket-ов 01–14, `docs/features/cards.md` (образец страницы).
