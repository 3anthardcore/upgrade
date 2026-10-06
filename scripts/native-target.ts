/** Privileged transport entrypoint. Its private journal is separate from SQLite. */
import { executeNativeTarget } from "../packages/bitrix-adapter/native.ts";
const [action, profilePath, profileSha256, packageDir, manifestSha256, journalDir] = process.argv.slice(2);
if (!["validate","dry-run","reconcile","apply"].includes(action??"") || !journalDir) throw Error("Usage: native-target.ts ACTION PROFILE PROFILE_SHA PACKAGE MANIFEST_SHA PRIVATE_JOURNAL");
const result=await executeNativeTarget({action:action as "validate"|"dry-run"|"reconcile"|"apply",profilePath,profileSha256,packageDir,manifestSha256,journalDir});
console.log(JSON.stringify(result,null,2));
if(result.status==="RECONCILED_INCOMPLETE")process.exitCode=5;
