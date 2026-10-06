# Stage1 server development — 2026-10-01

Authoritative development workspace: root@148.135.208.53:/opt/upgrade/stage1-design . Source archive SHA ac8cacc3b0737b72e3103c9031057d082e2da5edba65f4e201c258ac4d064eb7. Existing /opt/upgrade/current r18 and Bitrix target unchanged. 56GB free at bootstrap.

Runtime /opt/upgrade/runtime/node-v24.20.0-linux-x64/bin/node; app runs as upgrade. Copied new stage1 specs and pinned UI UX Pro Max skill. node_modules symlink pins existing r18 dependencies; browser cache /opt/upgrade/shared/browser-cache. New mutable data directory private0700. API key transferred via host-key-verified SSH to /opt/upgrade/private/stage1-openai.env, root0600, never in source archive or browser.

Actual server preflight HTTP200/EXIT0, model list verified, no paid calls; receipt /opt/upgrade/stage1-design/var/stage1-design/preflight/67202b6f-2601-475f-bd80-39f4f5fa7bf7/result.json.

Local stage1-design sources are initial transfer copy; synchronize explicit changed files from server before further local edits. Public web interface/worker not yet deployed. Next: implement durable job service and interface in this server workspace, then expose through separately protected route after verification. Do not redirect existing demo before ready.
