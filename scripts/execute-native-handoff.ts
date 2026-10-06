#!/usr/bin/env node
import {
  executeNativeHandoff,
  nativeExecutorFingerprint,
} from "../packages/bitrix-adapter/handoff.ts";
async function main() {
  if (process.argv.slice(2).join(" ") === "--fingerprint") {
    process.stdout.write(
      JSON.stringify({ executor_sha256: await nativeExecutorFingerprint() }) +
        "\n",
    );
    return;
  }
  const flags: Record<string, string> = {},
    allowed = new Set([
      "profile",
      "profile-sha256",
      "request-id",
      "request-sha256",
    ]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (
      !args[i]?.startsWith("--") ||
      !allowed.has(name) ||
      flags[name] !== undefined ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error("HANDOFF_EXACT_FLAGS_REQUIRED");
    flags[name] = args[i + 1];
  }
  if (Object.keys(flags).length !== 4)
    throw Error("HANDOFF_EXACT_FLAGS_REQUIRED");
  const result = await executeNativeHandoff({
    profilePath: flags.profile,
    profileSha256: flags["profile-sha256"],
    requestId: flags["request-id"],
    requestSha256: flags["request-sha256"],
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (["UNKNOWN", "INCOMPLETE"].includes(result.receipt.status))
    process.exitCode = 3;
}
main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      status: "FAILED",
      code:
        error instanceof Error && /^HANDOFF_[A-Z_]+$/.test(error.message)
          ? error.message
          : "HANDOFF_EXECUTION_FAILED",
    }) + "\n",
  );
  process.exitCode = 5;
});
