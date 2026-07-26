/**
 * lib/git-commit.ts
 * Centralised simple-git helper for GitOps persona and compliance file edits.
 * Every persona/mandate file write must go through commitFile so edits are
 * auditable git commits — never silent overwrites.
 */
import { writeFile } from "fs/promises";
import simpleGit from "simple-git";

const git = simpleGit(process.cwd());

/**
 * Write `content` to `filePath` and commit it with the supplied `message`.
 * If the file content is identical to what was already on disk (no diff),
 * the function returns silently without creating an empty commit.
 *
 * @param filePath  Absolute or repo-relative path to the file
 * @param content   Full file content to write
 * @param message   Git commit message — describe WHAT changed and WHY
 */
export async function commitFile(
  filePath: string,
  content: string,
  message: string
): Promise<void> {
  await writeFile(filePath, content, "utf-8");
  await git.add(filePath);

  // Check whether anything is actually staged before committing.
  // git.add on an unchanged file leaves the index clean; committing an
  // empty index throws "nothing to commit" which would 500 the API route.
  const status = await git.status();
  if (status.staged.length === 0) {
    // File was written but content was identical — no commit needed.
    console.log(`[git-commit] no changes staged for ${filePath} — skipping commit`);
    return;
  }

  await git.commit(message);
  console.log(`[git-commit] committed: ${message}`);
}

/**
 * Remove `filePath` from disk and commit the deletion with the supplied `message`.
 * This is used for persona deletion — the file is removed from the working tree
 * and the removal is recorded as an auditable git commit.
 *
 * @param filePath  Absolute or repo-relative path to the file
 * @param message   Git commit message — describe WHAT changed and WHY
 */
export async function deleteFile(
  filePath: string,
  message: string
): Promise<void> {
  await git.rm(filePath);
  await git.commit(message);
  console.log(`[git-commit] committed deletion: ${message}`);
}
