---
name: upgrade-run
description: Создать или продолжить проект Upgrade по URL через сохранённое состояние и CLI. Применять для общего запуска исследования и сборки; готовность Битрикс проверяется отдельно.
---

# Запуск Upgrade

Работай из корня репозитория. Сначала прочитай `AGENTS.md`, `docs/PROGRESS.md` и `docs/requirements-tests.md`; для существующего проекта выполни `npm run upgrade -- status --project ID`. Не выводи состояние из истории чата.

Для нового проекта:

```bash
npm run upgrade -- doctor
npm run upgrade -- init --source 'https://example.org/' --id example
npm run upgrade -- plan --project example --max-tasks 100 --max-seconds 3600
npm run upgrade -- run --project example --until demo-ready
```

Подставляй фактический URL и уникальный ID; пример не является пилотом. `--data-dir PATH` выбирает корень состояния, иначе `UPGRADE_DATA_DIR` или `var/projects`. После `pause`/`BLOCKED` сначала изучи причины и артефакты, затем `resume --project ID`; `resume` возобновляет статус, а `run` продолжает операции. Не повторяй принятые этапы без изменившихся входов.

Коды CLI: 0 — команда выполнена; 2 — конфигурация; 3 — неполнота/блокер; 4 — доступ или неподготовленный apply/deploy; 5 — проверка; 70 — внутренняя ошибка. Код 0 сборки или dry-run не означает DEMO_READY. Заверши `report --project ID`; покажи фактические пути отчёта, ограничения и следующий шаг. Без проверенного Битрикс результат остаётся NOT_READY.
