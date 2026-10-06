import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const query = process.argv.slice(2).join(' ').trim();
if (!query || query.length > 300) {
  console.error('Usage: node stage1-design/design-guidance.mjs "background task progress feedback"');
  process.exit(2);
}
const bundled = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const python = process.env.UPGRADE_PYTHON || (existsSync(bundled) ? bundled : 'python3');
// Local data search: no API keys or arbitrary shell arguments passed to the tool.
const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
env.PYTHONIOENCODING = 'utf-8';
env.PYTHONDONTWRITEBYTECODE = '1';
const result = spawnSync(python, [path.join(root, '.agents/skills/ui-ux-pro-max/scripts/search.py'), query, '--domain', 'ux', '-n', '3'], { cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1000000, windowsHide: true, shell: false });
if (result.error) { console.error('Local design guidance unavailable. Check UPGRADE_PYTHON.'); process.exit(1); }
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exitCode = result.status ?? 1;
