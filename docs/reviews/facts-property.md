# Lossless internal UG_FACTS storage codec

Task `bitrix-facts-codec-v1`, owner `facts-codec`, fence 1. Root supplied an actual native import failure: a large canonical homepage facts JSON was truncated by the Bitrix string property at 65535 bytes, causing `POST_WRITE_RECONCILE_FAILED`; the diagnostic Add was rolled back. This task implements only the own pure codec, its PHP tests and this note. No server, Store, target database, vendor files, property schema or Git operation was performed.

## Contract

`Upgrade\Core\FactsProperty::encode(string $raw): string` and `decode(string $stored): string` operate on bytes. Valid raw JSON of at most **60000 bytes** is newly stored and returned exactly unchanged, including Unicode, whitespace and legacy formatting. Decode also accepts exact unprefixed legacy JSON through the original native **65535-byte** limit, so previously valid properties remain readable; encoding such a value above 60000 bytes uses the new compressed format. All input must be valid JSON; empty input, invalid UTF-8/JSON and raw payloads above **16777216 bytes (16 MiB)** fail before writing. JSON depth is bounded at 512.

Larger JSON uses `gzencode` and canonical strict base64 in this internal envelope:

```text
UPGRADE_FACTS:{"version":1,"encoding":"gzip+base64","raw_bytes":N,"raw_sha256":"64-lowercase-hex","data":"canonical-base64"}
```

The prefix cannot be confused with raw JSON: no valid JSON text begins with unquoted `UPGRADE_FACTS:`. A JSON string containing that text remains ordinary legacy JSON. Envelope fields, types, order, version, encoding, canonical JSON representation, byte count, lowercase SHA and canonical base64 are checked. Duplicate keys, extra fields, unknown versions, truncated envelopes and malformed compressed data fail closed; there is no raw-JSON fallback for a recognised prefix. Raw JSON itself is never reserialized by this codec.

The entire encoded property, including envelope overhead, must fit **60000 bytes**. Incompressible data that cannot fit is rejected before a target write. Decode rejects encoded envelopes above that cap and unprefixed legacy JSON above 65535 bytes. Decompression is bounded by declared `raw_bytes + 1`, where declared length must be between 60001 and 16 MiB. Exact decoded length and SHA-256 must match; decoded JSON is then validated. The additional byte permits detection of a dishonest too-small declaration while keeping allocation bounded. Errors identify the failure category without including source facts or secrets.

## Required integration owned by root

The current module autoload table originally registers only Gateway and Router. Root must register `Upgrade\Core\FactsProperty => lib/factsproperty.php` in the own module and/or load `require_once __DIR__ . '/factsproperty.php'` from Gateway so its standalone pure tests also work. This task deliberately does not edit those files.

Root should encode UG_FACTS in the write/preflight path before Add/update and decode the stored property before reconciliation/current-state comparison. Managed hashes and canonical model facts remain based on **raw JSON**, never the compressed representation. An encode/decode error must propagate and prevent writes/reconciliation acceptance. No public rendering endpoint or exposure of compressed metadata is added. Existing malformed/truncated stored values are not repaired silently.

## Actual local verification

```powershell
$env:UPGRADE_PHP_BIN = (Resolve-Path var/tools/php-8.3.35/php.exe).Path
& $env:UPGRADE_PHP_BIN -n -l bitrix/module/upgrade.core/lib/factsproperty.php
node --disable-warning=ExperimentalWarning --test tests/integration/facts-property.test.ts
npm run check
```

Actual PHP 8.3.35 runs with `-n`, using its built-in zlib, without CMS bootstrap or database access. Tests cover legacy JSON byte preservation at exactly 60000 bytes; a large Unicode roundtrip exceeding 65535 bytes; deterministic encoding and identical raw SHA; corrupted hash/length/base64, whitespace in base64, duplicate/extra keys, truncation, unknown version/encoding, decompressed invalid JSON; incompressible random bytes; stored/raw limits; and bounded expansion with a dishonest length. Without `UPGRADE_PHP_BIN`, PHP tests explicitly SKIP rather than claim verification.

An additional regression reads unchanged 62002-byte Unicode legacy JSON and the exact 65535-byte legacy boundary, verifies new compression preserves the former, and rejects 65536-byte raw legacy storage. Root requested this compatibility correction during review before final freeze.

Final local results: PHP lint **PASS**, actual PHP tests **5/5 PASS, 0 SKIP**, TypeScript **PASS**. Gateway wiring, actual import/update/reconciliation and real property storage are root's separate integration checks; this codec test alone does not establish Bitrix import PASS or DEMO_READY.
