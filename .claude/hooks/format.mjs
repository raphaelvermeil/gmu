// PostToolUse hook for Edit and Write.
// Runs Prettier on the file Claude just changed. It never blocks.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
if (!file || !root || !/\.(ts|tsx|js|mjs|cjs|json)$/.test(file)) process.exit(0);

const prettier = path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
if (!existsSync(prettier)) process.exit(0);

try {
  execFileSync(process.execPath, [prettier, '--write', '--log-level', 'silent', file], {
    cwd: root,
    stdio: 'ignore',
  });
} catch {
  // A file with a syntax error stays as it is. The typecheck hook reports it.
}
