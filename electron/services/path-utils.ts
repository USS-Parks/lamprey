import { isAbsolute, resolve } from 'path'

/**
 * Resolve a possibly-relative path against an explicit workspace root.
 * Absolute paths are normalised (drive-letter, `..` flattening, trailing-
 * slash trimming); relative paths are resolved against `workspaceRoot`.
 *
 * This is the shared anchor used by every workspace-relative native tool
 * (shell, apply_patch, workspace_context, view_image, image edit/variation,
 * and so on). Without it, a bare relative input like "assets/foo.png" or
 * "src/index.ts" would silently target the process cwd of the Electron
 * main process — the folder Lamprey was launched from — rather than the
 * folder the user picked.
 *
 * No boundary enforcement: callers that need to reject escapes layer that
 * check on top of the returned absolute path (see `resolveCwdWithinWorkspace`
 * in shell-tool.ts and `resolvePathWithinWorkspace` in apply-patch-tool.ts
 * for the bounded variants).
 */
export function resolveWorkspaceRelative(p: string, workspaceRoot: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(workspaceRoot, p)
}
