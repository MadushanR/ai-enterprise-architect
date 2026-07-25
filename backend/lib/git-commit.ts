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
 *
 * @param filePath  Repo-relative path to the file (e.g. "personas/agents/sa.md")
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
  await git.commit(message);
}
