/**
 * scripts/verify-git.ts
 * One-off script: confirms simple-git works against the repo root.
 * Run with: npx tsx scripts/verify-git.ts
 */
import simpleGit from "simple-git";

async function main() {
  const git = simpleGit(process.cwd());

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    console.error("ERROR: Current directory is not a git repository.");
    process.exit(1);
  }

  const log = await git.log({ maxCount: 5 });

  console.log(`simple-git OK — ${log.total} commits total, showing last ${log.all.length}:\n`);
  for (const entry of log.all) {
    console.log(`  ${entry.hash.slice(0, 7)}  ${entry.date.slice(0, 10)}  ${entry.message}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("simple-git verification failed:", err);
  process.exit(1);
});
