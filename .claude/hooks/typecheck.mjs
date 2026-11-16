// Stop hook.
// Claude may not end its turn while the typecheck fails.
// Exit code 2 sends the errors back to Claude, which keeps working.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const run = (command) =>
  execSync(command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Nothing to check before the workspace exists.
if (!existsSync(path.join(root, 'package.json'))) process.exit(0);

// Skip when no TypeScript file differs from the last commit.
try {
  const changed = run('git status --porcelain --untracked-files=all -- "*.ts" "*.tsx"');
  if (!changed.trim()) process.exit(0);
} catch {
  process.exit(0);
}

try {
  run('pnpm -s typecheck');
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  const tail = output.split('\n').slice(-40).join('\n');
  console.error(`The typecheck failed. Fix these errors before finishing:\n${tail}`);
  process.exit(2);
}
