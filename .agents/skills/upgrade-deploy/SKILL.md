---
name: upgrade-deploy
description: Подготовить изолированное размещение Upgrade или пакет демо Битрикс, проверить backup и предпосылки внедрения. Использовать для deployment runbook; не считать текущий blocked deploy готовым исполнителем production.
---

# Размещение и восстановление

Различай хост приложения Upgrade и целевой хост Битрикс. Прочитай `docs/compatibility.md`; проверь свободное место, Node 24, Docker daemon, PHP/БД и auth Codex там, где они потребуются. Не переносить настройки личного Codex автоматически и не устанавливать большие runtime/images при недостатке диска.

Для резервной копии **состояния Upgrade**, в отдельный несуществующий каталог:

```bash
npm run upgrade -- backup --project ID --to /private/backups/new-snapshot
npm run upgrade -- restore --from /private/backups/new-snapshot --to /private/restored-copy
```

Сверь manifest и артефакты; это не копия БД/файлов Битрикс. Состояние run после восстановления может требовать resume; не продолжай старые worker PID без сверки.

Демо-профиль: `infra/compose/compose.yaml`, `infra/provisioning/preflight.sh`, `infra/nginx/demo.conf`. Образы требуют фактических digest; секреты задаются путями вне Git. Preflight конфигурации не подтверждает live egress isolation. Сетевые ограничения должны действовать до запуска клона.

`deploy --project ID --environment production --release RELEASE_ID` проверяет существование release и возвращает BLOCKED: производственный исполнитель ещё не включён. Не изображай deployment успешным. Для внедрения нужны согласованный профиль, фактическая QA-приёмка Битрикс, backup/restore, дельта новых данных, план переключения и действующее разрешение на конкретное назначение. До этого продолжай локальные части и перечисли недостающие входы.
