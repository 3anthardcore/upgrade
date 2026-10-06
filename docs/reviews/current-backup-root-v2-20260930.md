# Current backup — root independent acceptance of attempt 2

2026-09-30. Implementation ACCEPT; native execution and current-state restore remain separate checks.

Reviewed runner SHA256 `38f46b290f1cd2c64585e613c2fae35d8e150e99c859322e51517f6941915389` and tests `6f49d3863efb6379ca83666d76b329427a8f94a1faeb8567e2cd6cf3e7e3a5cc`. The bounded production delta supplies `os.walk` with an error callback which raises `TREE_ENUMERATION_FAILED`; every inventory goes through this function. No new exclusions, relaxed pins, resume behavior or source/target write scope were introduced.

Root repeated the **unchanged independent witness**, including the previous false-success case, against attempt 2:

```text
<bundled-python> -I var/evidence/current-backup-independent-20260930/probes.py scripts/current-runtime-backup.py
wsl -u root python3 -I /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/current-backup-independent-20260930/probes.py /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/current-runtime-backup.py
```

Both results **8/8 PASS** (Windows 2.167s, WSL 0.256s). Logs: ignored `var/evidence/continuation-20260930/backup-independent-root-v2{,-wsl}.log`. Author separately reports 42/42 Windows and 42/42 WSL after adding three traversal-error regressions. Historical REJECT and the original witness are retained in the independent review and immutable Store artifacts.

The native profile is root-private, pins existing containers/network/tools/pointer and selects a new backup destination outside all three source trees. Plan acceptance still precedes downtime. Execution must follow the sole native writer policy and run separately from browser/HTTP scenario tests. This acceptance does not assert a native SQL dump or successful restoration of private sessions; those require the subsequent actual run and an independent restored copy.
