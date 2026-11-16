// PreToolUse hook for Edit and Write.
// Refuses a change to a migration file that is already committed.
// A migration that is new in the working tree can still be edited.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
if (!file || !root) process.exit(0);

const rel = path.relative(root, file).split(path.sep).join('/');
if (!/(^|\/)migrations\/.+\.sql$/.test(rel)) process.exit(0);

try {
  // Succeeds only when the file exists in the last commit.
  execFileSync('git', ['cat-file', '-e', `HEAD:${rel}`], { cwd: root, stdio: 'ignore' });
} catch {
  process.exit(0);
}

console.error(
  `Blocked: ${rel} is a committed migration. Migrations are forward-only. Add a new migration file instead.`,
);
process.exit(2);
