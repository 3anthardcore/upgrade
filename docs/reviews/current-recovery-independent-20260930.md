# Independent review: current private runtime recovery V1

2026-09-30. Task `review-current-state-recovery-20260930`, owner `restore-independent`, fence 1. Input `art-ddd99d9a-349f-475d-bf33-86974b1e739f`; frozen author artifact `art-07d50a3a-04fe-4667-a778-4157125b85cf`.

**Verdict: REJECT V1 for the native retained-receipt scenario.** One concrete P2 compatibility defect is reproduced independently. Other reviewed boundaries below have no blocking finding in this bounded review. This is not acceptance of a native current-state restore; no server, source site, target database, Docker daemon or authoritative Store was accessed. Production code and author tests were not changed.

## Reviewed pins

| File | SHA-256 |
|---|---|
| `scripts/recovery-current-runtime.py` | `78ef9223d31decb135732702d725f2755bb00c9ef490c708e1b582314cc07944` |
| `tests/unit/current-runtime-recovery.test.ts` | `f7e4da685bc4e49ce7b23f6ec50ad2a1952b7f897417ecdb18fc67126a1c57e7` |
| Author `docs/reviews/current-runtime-recovery-20260930.md` | `41cf168276886c4428f47dc49dbc283279524982817b9127a20e635a76919917` |
| Required `scripts/recovery-target.py` | `b1c95c5150d668417b268b708c7f49e81c7fe4d346b6c346d5dc386dc7a2ade6` |
| Required `scripts/current-runtime-backup.py` | `38f46b290f1cd2c64585e613c2fae35d8e150e99c859322e51517f6941915389` |

The frozen author source/test pins were verified again after the local probes.

## P2: a harmless vendor PHP session cookie falsely fails an exact restored receipt

`Executor.http_receipt`, lines 490–492, requires that the entire response contain no `Set-Cookie` header. That rejects an otherwise valid HTTP 200 receipt with exactly the pinned body, private headers and unchanged existing Upgrade session whenever Bitrix emits its vendor `PHPSESSID`. The request sends only the existing `upgrade_demo_session`; there is no cookie jar and no POST.

Root separately reported this precise native response: correct retained receipt, `no-store`/`noindex`, vendor `PHPSESSID`, and no replacement of the own Upgrade cookie. That native observation is root-supplied context, not an independently repeated server request. Static inspection confirms `infra/nginx/interactive-demo.conf` hides `X-Powered-By`, not all vendor cookies. The established demo verifier already treats ignored vendor cookies separately from its own session cookie.

The independent fixture starts a real localhost HTTP server, calls the frozen `http_receipt`, returns the pinned literal body and exactly one `PHPSESSID=fixture_vendor_value; path=/; HttpOnly; SameSite=Lax`, and checks that the existing session file is unchanged. The runner raises `RETAINED_RECEIPT_HTTP_BOUNDARY`. Both Windows Python and WSL/root Python reproduce the same failure. The identical fixture without this vendor header passes. Replacing `upgrade_demo_session` or actually changing the session file correctly fails and must continue to fail.

Required narrow correction: inspect every raw `Set-Cookie` header; allow only the explicitly supported, bounded, well-formed vendor `PHPSESSID` as discard-only data. Do not persist, return or replay it. Reject any own-session replacement, unknown name, duplicate/ambiguous/combined or malformed cookie header. Preserve exact body and session SHA checks and GET-only behavior. Do not solve this by changing native CMS/Nginx behavior or weakening the own-cookie requirement.

The current dictionary conversion collapses duplicate header names. A fix must not merely change the condition on that dictionary: an own cookie in an earlier header followed by a permitted vendor cookie could otherwise be hidden. Include both header orders in regression tests.

## Checks executed

```powershell
node --test tests/unit/current-runtime-recovery.test.ts
& C:/Users/root/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -I var/evidence/current-recovery-independent-20260930/independent.py scripts/recovery-current-runtime.py
wsl -u root python3 -I /mnt/c/Users/root/Documents/ChatGPT/upgrade/var/evidence/current-recovery-independent-20260930/independent.py /mnt/c/Users/root/Documents/ChatGPT/upgrade/scripts/recovery-current-runtime.py
```

- Author suite independently repeated: **41/41 actual Python checks PASS**, Node wrapper 1/1 PASS, zero skipped. Python 67.620 seconds; wrapper 67.848 seconds. Its Docker/SQL/CMS orchestration remains explicit doubles, not native execution.
- New independent probes: **10 PASS and 1 ERROR out of 11** on Windows (2.672 seconds), and the same **10 PASS and 1 ERROR** on WSL/root (1.873 seconds). The single error is the expected-valid vendor-cookie receipt above. The suite deliberately returns nonzero; it is not reported as a successful acceptance run.
- The independent suite constructs its own small pinned bundle and archives; it does not import the author's test fixture or fake Docker executor. It uses real file extraction/readback, a real loopback HTTP listener and a real timed-out Python subprocess. WSL tests exercise POSIX metadata checks with root-owned temporary files. No source/CMS JavaScript or PHP from an archive is executed.

Independent successful cases establish:

1. Nested archive bytes containing an `UNKNOWN` operation remain exact and inert; input archive hash stays unchanged, and an existing extraction destination is refused.
2. Missing/extra ledger membership, altered bytes, missing parent directories, setuid-style modes and traversal aliases fail closed. A deep unlisted file and an actual injected nested `scandir` error fail readback rather than produce an incomplete success.
3. A manually assembled fully pinned bundle passes without changing any input bytes. `UNKNOWN`, `COPYING`, or non-restored runtime status fails. Re-pinning a manifest cannot turn an omitted private-state tree or declared exclusions into a complete backup.
4. The retained response uses exact envelope/body/response checksums and does not rewrite the file. Cookie pin drift and a re-signed response claiming a real message was sent are rejected.
5. Actual HTTP sends one GET to the exact own receipt path with the existing own cookie. No POST or vendor replay occurs. A replacement own cookie and session bytes changed by the fixture are rejected.
6. A real child process runs once, writes one dispatch marker, then exceeds its timeout. The durable event log records `STARTED` and `UNKNOWN_TIMEOUT`. A cold executor refuses the existing destination, does not repeat the process, and cannot publish a result after its ownership intent changes.

## Source inspection and review boundaries

The runner imports only the two exact pinned helper files. CLI planning is the default; execution requires the reviewed plan SHA, Linux/root and exclusive project/destination ownership. Existing/failed destinations are not adopted. Backup receipt, intent, runtime completion, full manifest scope, ledgers, archive bytes and the three trees are bound and checked before bootstrap. Partial extraction failures leave private evidence and do not dispatch the guard/database/PHP sequence.

The Compose projection is a whitelist with new Docker project, volume, subnet, bridge and network. Bind mounts point under the new clone root. The original application project/target identity is retained for private pointer/session compatibility; it does not reuse source Docker resources. The restored native journal is placed under `source-journal-audit`, not mounted or activated. Its exact tree is checked again after smoke tests. This runner dispatches no importer or journal replay.

Execution attests source identities, images, configuration/mounts and network before destination claim and rechecks the source afterward. Source operations are Docker read-only inspection plus an explicit positive TCP connection to the attested DB port; no source SQL, stop, start or restart is dispatched. SQL is sent over stdin through the clone Compose prefix. The only settings change is the previously reviewed inert literal DB-host derivation within the new clone.

Guard apply/check precedes clone DB start. The pre-CMS own PHP probe checks the pinned prepend, disabled functions, own DB reachability, blocked source DB and failed external DNS before web services start. The author's orchestration doubles exercised order/failure cases and were independently rerun. This review does not execute or attest a real firewall, Docker container, SQL import or CMS bootstrap.

HTTP remains GET-only and does not follow redirects. Its socket timeout is an inactivity timeout, not a whole-operation wall deadline; this review does not claim an absolute end-to-end HTTP duration. The body limit and native process timeouts must not be described as such a deadline. Cookie/auth values are not logged by the reviewed receipt path; only their relevant pinned hashes and non-secret operation identifiers are recorded.

A current isolated restore, if later verified, covers its pinned backup/snapshot and selected retained receipt. It cannot extend the historical r12/103 restore to current private sessions, prove full source coverage or promote the pilot to `DEMO_READY`. Current native restore, packet capture and production recovery remain **NOT_RUN** in this review.

## Evidence pins and next step

| File under `var/evidence/current-recovery-independent-20260930/` | SHA-256 |
|---|---|
| `independent.py` | `168e9083c81fc1c5c9d9182fc3cb43702d8e2a4e27ef64b752d188a1f5826b76` |
| `independent-v1.log` | `0bf0de62d6604056f5d0f2485bc4610cd0de314b3fa3d5907ec611717ee1831e` |
| `independent-v1-wsl.log` | `e84df97428101229a4910f374ce4dcdecb0538f14cc69d449489b0e8dc233d07` |
| `author-tests.log` | `1d60dea8f47bd99a63095f46a36aeb6a6948b0faa67a413821db01093ef27ba2` |

```json
[
  {"id":"current-recovery-complete-pins-archive-and-state","status":"PASS","details":"Bounded code review plus independently repeated 41 author checks and independent archive/bundle/session probes; native Docker/SQL excluded."},
  {"id":"current-recovery-unknown-no-adoption-or-replay","status":"PASS","details":"Real local subprocess timeout, durable UNKNOWN event, exact ownership and cold existing-destination refusal."},
  {"id":"current-recovery-retained-native-receipt-compatibility","status":"FAIL","details":"HTTP200 exact retained body/session with vendor PHPSESSID is falsely rejected; own-cookie and state-mutation guards must remain strict."},
  {"id":"current-recovery-native-execution","status":"NOT_RUN","details":"No server/DB/Store access; root native observation is attributed, not independently rerun."}
]
```

Next: retain this V1 rejection, persist a revised author task, make the narrow cookie-header correction with duplicate/order regressions, freeze new pins and independently repeat the affected tests before native execution.
