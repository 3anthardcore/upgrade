# Independent network guard review — 30.09.2026

Task `network-guard-review-v3-20260930`, reviewer discovery, fence1. Initial input `art-64122ede-f9e7-4324-8a2e-d6a08bd487a0`; root explicitly persisted and authorized the V4 revision in the same task after the optimization finding below. Only this document was written in the repository. All executable proof files are in an OS temporary directory. No server, Docker network, host firewall or database commands were executed against a live system.

**Verdict: ACCEPT V4 within the reviewed local policy/code boundary.** The original G1 is closed by marker ownership + exact predecessor rules. V4 also prevents the tested inherited Python optimization/import-path bypass. **Live iptables/Docker packet isolation remains NOT_RUN by this reviewer; root must separately apply/check and run live probes before CMS.** No AT-28, production recovery or DEMO_READY assertion follows from this review.

## Pinned inputs and history

| Revision | `infra/provisioning/isolate-network.sh` SHA256 | Result |
|---|---|---|
| V2, prior independent review | `b730822b14ec08a7fa1626351829c47ae1e9cec45fb13ae1ab15f13f709eddba` | REJECT G1: managed-looking predecessor name could hide unconditional ACCEPT |
| V3, initial current input | `cb4203a65fd2a64cd67c615c59747d7b278641627baacaebeab23e231a8da480` | 24 normal-runtime cases PASS; optimization-dependent safety checks remained |
| V4, final accepted local scope | `cdf9202d3096d85940848b20ede7a421b49c9cbb1f700f66aa3ad423acb0514d` | 24 cases PASS under actual isolated Python with poisoned environment; shell syntax PASS |

The prior G1 report is actually `docs/reviews/demo-http-integration-independent-20260930.md`, section «Повторная приёмка v2». A separate filename containing `-v2-` does not exist. Its historical REJECT was read and remains unchanged.

V4 differs from pinned V3 only by seven `python3 -` → `python3 -I -` replacements, one for every embedded Python block. This was verified by byte comparison: reversing those seven invocations reconstructs the exact V3 SHA. No guard policy/chain-body changes occurred between these revisions.

## Findings and closure

**G1 closed in V3/V4.** Every managed-looking predecessor in the accepted leading prefix now resolves its suffix through SHA256(project) and a matching ownership marker. Marker directory and files must be root-owned, have no group/other permissions, and be actual directories/regular files according to lstat; symlinks fail. Marker filename/project/network/bridge/subnet bindings and bounded file size are checked. Newly created paths use directory0700/file0600. Existing stricter owner-only modes may pass; the predicate is private permissions, not literal mode equality.

The verifier reads each predecessor chain's actual modeled `iptables -S` response and requires the exact normalized rules. Forward guards must contain only the two scoped REJECT rules in the expected order. INPUT guards require the exact bridge jump plus established/related ACCEPT and terminal REJECT. Unconditional forward ACCEPT/RETURN, partial rules, reordered rules and an arbitrary input ACCEPT all failed. Automatic iptables ordering of conntrack states and the standard implicit REJECT suffix were exercised by fixtures and normalized correctly.

**Additional conditional defect closed in V4.** V3 called plain Python and used `assert` for these security checks. Executing the exact block with optimization2 removed assertions and accepted a preceding unconditional ACCEPT. This was a local executable witness, not evidence of that condition on the actual server. A separate real child confirmed `PYTHONOPTIMIZE=2` enables optimization without isolation. Another real child imported a deliberately failing `json.py` from the injected PYTHONPATH, proving the test poison was active.

V4's actual `python3 -I` child ran with both those hostile environment values still present. It reported `sys.flags.isolated=1`, `sys.flags.optimize=0`, `PYTHONOPTIMIZE` text still `2`; imported the normal library; and passed all24 policy cases. Thus the fix enforces the runtime assumption rather than weakening the checks. The probe does not model compromise of the root-owned interpreter/system libraries or an administrator with equivalent firewall privileges.

## Behavioral checks

The harness compiles and executes the final Python block copied directly from the pinned production shell file, without editing its body. Only `subprocess.check_output/check_call` for iptables are replaced by a bounded stateful rule model. Ownership checks use **real Linux temporary files**, actual root UID, chmod/chown and symlink operations. Fixture directories are removed after each case. This tests policy decisions and exact emitted mutation order; it does not invoke the kernel firewall.

24 cases passed, including:

- Two legitimate projects alpha/beta sharing the managed prefix: both checks succeed and read both predecessor bodies.
- Applying beta after alpha inserts protection before existing jumps, preserves alpha/unrelated rules byte-for-byte, then both project checks and idempotent reapply succeed.
- Check rejects duplicate own jumps. Apply first inserts the own protective jump, then removes only exact own duplicates in descending position order; no foreign jump/body is deleted.
- Managed-looking forged chain name with no marker fails check and apply.
- Public marker directory, public marker file, non-root owner, symlink marker, wrong filename/project binding, wrong network name, wrong bridge and nonprivate subnet fail.
- Previous forward unconditional ACCEPT/RETURN, incomplete or reordered guard, and arbitrary INPUT ACCEPT fail.
- A foreign leading INPUT ACCEPT or forward RETURN fails check.
- Apply may move the current project's jump before an ordinary foreign leading rule, preserving that rule and all other jumps. This repairs only the current project. It does not claim that an already invalid predecessor after a foreign rule is repaired; each active project still needs its own successful check.
- A separate ten-assertion boolean model of the exact scoped REJECT predicates confirms alpha/beta crossing and external crossing are rejected while traffic involving neither bridge retains its original fallthrough. This is explicitly a rule-expression model, not packet capture.

The raw receipt lists every case, acceptance/refusal reason, every chain read and each modeled iptables mutation. A check invocation produced no modeled rule writes.

## Apply/check order and neighboring projects

Full-shell reading confirms the host-local flock serializes this helper's own mutations. Existing network identity, internal setting, bridge/subnet/project label, ownership and own chain contents are checked; absent-network creation performs route/Docker overlap checks first. Own existing rule bodies must be an exact prefix of the expected policy during apply, or complete during check; unexpected owned-chain rules are not silently replaced. Apply appends only missing own rules. Global jump insertion precedes deletion of exact own duplicate jumps.

Several correctly owned guards may now remain ahead of unrelated INPUT/DOCKER-USER rules. Their individual bodies affect only their own bridge (plus established/related return traffic in INPUT). Installing a second legitimate guard therefore preserves the first guard and unrelated rule contents/order relative to one another. Cross-bridge traffic is rejected by the relevant scoped rule. No shared chain flush, broad foreign deletion or unrelated network reconfiguration occurs in this code.

An apply failure can leave a new own network/marker/chain or one inserted own jump before a later refusal. It is not transactional rollback and must not be treated as readiness. Existing neighbor bodies remain untouched; the caller must honor the nonzero result and never bootstrap CMS before successful apply/check and live probes. The recovery executor's separate gate is not itself re-reviewed here.

## Actual commands and preserved evidence

Local WSL Ubuntu, UID0, Python stdlib; no installation performed. Syntax check:

```text
wsl.exe -d Ubuntu -- bash -n /mnt/c/Users/root/Documents/ChatGPT/upgrade/infra/provisioning/isolate-network.sh
# exit0
```

The preserved driver runs pinned V3 history, then launches real isolated V4 under PYTHONOPTIMIZE/PYTHONPATH injection, validates controls and repeats shell syntax:

```text
wsl.exe -d Ubuntu --user root -- python3 -B \
  /mnt/c/Users/root/AppData/Local/Temp/upgrade-network-guard-review-t0iJ3r/driver.py \
  /mnt/c/Users/root/AppData/Local/Temp/upgrade-network-guard-review-t0iJ3r \
  /mnt/c/Users/root/Documents/ChatGPT/upgrade/infra/provisioning/isolate-network.sh
# exit0; V3 normal24 PASS; V4 isolated24 PASS; all environment controls PASS
```

Temporary evidence directory:

`C:/Users/root/AppData/Local/Temp/upgrade-network-guard-review-t0iJ3r/`

- `harness.py`: exact V3 block tests and separate optimization diagnostic.
- `guard-v3.sh`: byte-identical pinned V3 reconstructed from the seven known V4 invocation changes; SHA validated by driver.
- `harness-v4.py`: exact V4 block tests; requires actual isolated interpreter with optimization0.
- `driver.py`: launches subprocess controls and both harnesses; checks input pins and the seven-change-only delta.
- `raw.stdout.json`: full successful result, SHA256 `7488a7f8504e8630d76092302017cb5a6c175034365be372f8b120a5a9edd58d`.
- `raw.stderr.txt`: empty successful execution stderr.

These files are outside the repository as authorized. Root can ingest them as immutable task artifacts before OS temp cleanup. No fresh guard source or repository tests were written by this reviewer.

```json
[
  {"id":"network-guard-v4-pin","status":"PASS","details":"cdf9202d3096d85940848b20ede7a421b49c9cbb1f700f66aa3ad423acb0514d; exactly seven isolated-Python invocation changes from pinned V3."},
  {"id":"network-guard-two-project-policy","status":"PASS","details":"24 cases against exact production Python block; real Linux ownership files, modeled iptables only."},
  {"id":"network-guard-python-isolation","status":"PASS","details":"Actual child python3 -I ignores proven PYTHONOPTIMIZE/PYTHONPATH poison; isolated1/optimize0; all24 cases pass."},
  {"id":"network-guard-shell-syntax","status":"PASS","details":"Actual local bash -n exit0."},
  {"id":"network-guard-live-isolation","status":"NOT_RUN","details":"No Docker/firewall mutation or packet capture by reviewer. Root must apply/check both active projects and run live isolated-runtime probes."}
]
```
