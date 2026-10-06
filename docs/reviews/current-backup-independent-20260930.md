# Current runtime backup: independent review, 2026-09-30

Task `current-backup-independent-20260930`, input `art-46d747e4-37ec-4507-a021-5abe8702f51a`, reviewer `backup-independent`, fence 1. Scope: this report and ignored local evidence only. No author code, server, target database, content Store or Git was changed. The review follows `upgrade-qa`; authoritative task/status mutation remains with root.

**V1 verdict: REJECT.** One reproducible completeness defect prevents acceptance for a native backup. Native backup and current private-state restore remain **NOT_RUN** by this reviewer. Existing historical recovery is separate evidence.

## Reviewed pins

| File | SHA256 |
| --- | --- |
| `scripts/current-runtime-backup.py` | `ecdda8d74d2f70312b5c6780a79b75011181b652b6d80c2e17ebd798de102708` |
| `tests/unit/current-runtime-backup.test.ts` | `42f334af3c77f6a38bcb67f0087f6862441fba3ab85d11e782b566a68f1327d3` |

Both pins matched before testing. Also read the author report, native adapter transport lock, Gateway lock, and current requirements matrix. An accepted profile is a trusted local operator attestation; this review does not claim protection against a malicious privileged operator changing root-private state.

## B1 — P2: suppressed directory enumeration errors can produce a falsely complete backup

`tree()` at `scripts/current-runtime-backup.py:393` uses `os.walk(root, followlinks=False)` without `onerror`. Python suppresses directory scanning errors by default. If a nested directory consistently fails `scandir` with EIO or a permission error, the parent directory is inventoried but its children are omitted. The preflight, archive inventory and final comparison all repeat the same omission, so their equality does not establish completeness.

Independent reproduction creates a real `cms/nested/private-important.php` and injects `OSError(5, 'fixture I/O failure')` only when scanning `cms/nested`. No file content is mocked. `Executor.execute()` returns an `INTEGRITY_VERIFIED` backup, publishes a manifest with `exclusions: []`, and archives the empty directory while omitting the existing file. The required negative assertion fails on both Windows Python and WSL Linux Python. The source file remains intact; this is a backup omission rather than source mutation.

Required correction: propagate every directory-enumeration error, including root and nested scans, before claiming full inventory or publishing a receipt. Add a persisted regression for the complete `execute()` path and verify that runtime is restored but no successful backup receipt is published. A missing/deleted directory during traversal must likewise fail rather than count as an intentional exclusion. No need to weaken limits, introduce exclusions or change historical restore containment.

## Commands and actual results

```text
node --test tests/unit/current-runtime-backup.test.ts
<bundled-python> -I var/evidence/current-backup-independent-20260930/probes.py scripts/current-runtime-backup.py
wsl -u root python3 -I /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/current-backup-independent-20260930/author-harness.py /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/current-runtime-backup.py
wsl -u root python3 -I /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/current-backup-independent-20260930/probes.py /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/current-runtime-backup.py
```

- Author Node wrapper: PASS, 1 wrapper / 39 Python checks, zero failures/skips, 13.574 s total.
- Extracted unchanged author Python harness in WSL: **39/39 PASS**, 3.019 s. Real local POSIX flock and SQLite lock-conflict branches ran; Docker/DB are contract doubles.
- Independent adversarial cases: **7 PASS / 1 FAIL**, both Windows (2.300 s) and WSL (0.499 s). The single failure is B1.
- Additional passing cases cover changed container configuration before resume; unknown start observed running without duplicate start; durable unknown stop later observed stopped with recovery only and no copy; exclusive destination creation race without foreign writes; file added during archive with failure and runtime restoration; originally stopped roles remaining stopped; and rejecting a forged database action before mutation.

## Evidence

Files are under `var/evidence/current-backup-independent-20260930/` and contain only synthetic fixture data and local test output.

| File | SHA256 |
| --- | --- |
| `probes.py` | `184bcfea71fc8ec2193a821235707bc41ce8fbd41a2a907d42cba3c0785f83d0` |
| `probes-windows.log` | `438e7853a9d6546040347663e0909434018438a925acae3878bc999b5442c263` |
| `probes-wsl.log` | `f698611dc72eafdc6c5c84181320dee4e4b327d24f1ee769cc9486f530e53ed7` |
| `author-wsl.log` | `b42e95af07c6dfcfaa1534daf81392636ab6ae9a39f61f343b0953ea2fd6770d` |

## Accepted boundaries, pending corrected review

Static review and local tests support plan-only default; exact pinned container/config/network identities; existing native SQLite and Gateway locks; only owned nginx/PHP stop/start; unknown-result reconciliation before a second mutation; refusal of foreign/existing destinations; root-private intents/SQL/archives; exact byte readback; all private state and target-specific native journal included when traversal succeeds; and no automatic retry of copying after failure. Credentials stay out of command arguments/stdout. A changed identity prevents a restart of another container.

The consistency boundary still requires the sole-writer policy, stopped PHP and disabled DB events: no unrelated privileged filesystem/SQL writer may bypass the locks. This does not provide a global database read lock. Command/static pin review is not proof of target downtime, a real SQL dump, actual server crash recovery or restoration of current sessions.

The external backup destination is intentionally incompatible with historical `recovery-target.py` receipt containment. **Direct historical restore remains NOT_SUPPORTED**, not an acceptance shortcut. A later current-state restore needs its own reviewed binding/remapping/session test. Next step: author fix B1 under a new attempt, freeze new pins, rerun unchanged independent witness, then root decides whether to execute the native backup.
