# Crawl persistence and recovery

The crawler owns a local `source/crawl-state/` journal while holding the existing process lock `source/crawl.lock`. It does not write the project SQLite database. The core remains the owner of project artifacts and run state.

`crawl.json` retains the exact `CrawlResult` schema for existing callers. It is an atomic compatibility projection at a successful crawler return, including PAUSED returns. After a crash, it may be older than the journal. `crawlSite()` loads and validates the journal before considering source requests, limits, robots rules or access acknowledgements. Editing a modern projection does not override journal state.

An old directory containing only `crawl.json` and snapshots migrates on its first durable save. Project/source/policy identity, original counters, start time, access gates and snapshot hashes remain checked. Restore rewrites physical paths from content hashes into the selected new `snapshots/` directory and checkpoints that relocation. Never copy only `crawl.json` from an interrupted modern crawl and call that a current backup: copy the whole quiescent source directory.

## Format and bounds

- `head.json` atomically selects one generation, checkpoint byte size/SHA256, sequence and chain hash.
- `checkpoint-<generation>.json` stores the complete metadata state and any unsettled request group.
- `journal-<generation>.jsonl` appends numbered, hash-chained changes. Each row has a SHA256 checksum; page/asset changes carry their original array index and exact URL spelling. Metadata changes are separate from unchanged registries.
- `reservation.json` is a fixed 4096-byte checksummed watermark, flushed before network after the corresponding journal prefix. It binds the last authorized sequence/hash and request/byte reservation. Even truncating whole valid journal rows below that watermark fails closed. Checkpoints retain the watermark binding when they retire an older prefix. A partially overwritten watermark fails closed rather than falling back to an older authorization.
- Full checkpoints occur after journal growth proportional to the current checkpoint, with a 4 MB minimum and 128 MB maximum trigger. New files and the new head are flushed before the old selected generation is removed. A failed compaction's orphan files are retained for diagnosis; they are not adopted as authority.
- Checkpoints/projections are limited to 512 MB, journal reads to 256 MB, one journal mutation to 16 MB, metadata registries to one million rows each, and the journal directory to 128 regular files / 2 GB. Hitting a limit fails closed; records are not silently dropped.

URL lookup uses in-memory maps; status counts update from changed rows. Metadata remains O(known URLs + resources) in memory. Response bodies are handled one bounded request at a time and persisted by content hash; this change is not a streaming database for arbitrarily large metadata.

## Durability and unknown results

Before each HTTP request, the crawler appends its request/byte reservation, flushes the journal prefix with `fsync`, then writes and flushes the reservation watermark. Metadata/observed-response changes may append without a separate flush; the next reservation flushes that prefix before allowing any further network request. A PAUSED/COMPLETE return flushes the journal and atomically replaces the compatibility projection. Snapshot files are flushed before their hashes are committed; POSIX directories are also flushed.

The unsettled request group is cleared together with the durable logical result (robots policy, sitemap outcome, page/asset outcome, or recorded access block). A process killed before that boundary retains the reservation. On restart it returns PAUSED with `REQUEST_OUTCOME_UNKNOWN`, keeps all charged requests/bytes and performs **no automatic GET**. A completed receipt is not invented from a filename. The present interface has no command to acknowledge or erase this uncertainty: retain the directory and obtain an explicit reconciliation/research decision. Starting a new snapshot does not authorize silently resetting the governing project budget.

Checksum mismatch, missing selected checkpoint, missing middle rows, wrong ordering and incomplete final append are fatal before network activity. A torn final row is never silently truncated. Preserve the directory and error receipt for review; do not delete a lock/journal, rewrite counters, or substitute an older projection as a recovery shortcut. The lock's existing stale-process check is still used for a genuinely dead process.

These are integrity and crash-recovery checks over trusted local application state, not a signature against a malicious filesystem owner or protection against rolling back an entire coordinated backup, including its watermark. Windows lacks the POSIX directory-fsync primitive; local process-kill recovery is tested, but sudden power loss on every storage/filesystem combination is not certified. Full-site source consistency, server deployment, native Bitrix import and final readiness are independent gates.

## Reproduce

```text
npm run check
node --disable-warning=ExperimentalWarning --test tests/unit/crawl-persistence.test.ts tests/integration/crawl-persistence.test.ts tests/integration/discovery.test.ts tests/integration/access-challenge.test.ts
node --disable-warning=ExperimentalWarning scripts/measure-crawl-scale.ts --output NEW_DIRECTORY --pages 250 --assets 1250 --seconds 120
```

The measurement requires a new output directory. It starts its own approved loopback fixture; it neither contacts a customer source nor changes a target. The fixture has distinct resource URLs containing identical small raster bytes. Its page/resource counts measure crawler/discovery/persistence scaling, not unique-media volume, browser rendering, source-owner exports, full pipeline or native CMS performance. Read the generated profile/receipt and exact `source_served` counts before making a completion claim.
