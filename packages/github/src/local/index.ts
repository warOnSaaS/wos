/** Client-side git operations used by the orchestrator. Phase 0 stubs. */
import { NotImplementedError, type ChangesetFile } from "@waronsaas/contracts";

export interface WorktreeHandle {
  path: string;
  repo: string;
  baseSha: string;
  branch: string;
}

/** Ensures a bare mirror under <workspaceRoot>/repos/<owner>/<name>.git, fetches `sha`, adds a detached worktree at it. */
export async function createWorktree(workspaceRoot: string, repo: string, sha: string, name: string): Promise<WorktreeHandle> {
  void workspaceRoot, repo, sha, name;
  throw new NotImplementedError("createWorktree");
}

/**
 * Captures the worktree's changes vs base as changeset files, reading bytes from disk with lstat:
 * symlinks, submodules, files outside the worktree and paths git ignores-but-exist are reported, never followed.
 */
export async function captureChanges(
  worktree: WorktreeHandle,
): Promise<{ files: ChangesetFile[]; rejected: Array<{ path: string; reason: string }> }> {
  void worktree;
  throw new NotImplementedError("captureChanges");
}

export async function removeWorktree(worktree: WorktreeHandle): Promise<void> {
  void worktree;
  throw new NotImplementedError("removeWorktree");
}
