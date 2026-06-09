# Lamprey Harness — Project Domain Architecture

## What a Project Is

A **Project** is a first-class persisted workspace container that groups conversations, tracks activity, and optionally binds to a filesystem path. Projects are the top-level organizational unit above conversations/sessions.

## What a Project Is Not

- **Not a folder shortcut.** A project may or may not have a `path`; pathless projects are valid.
- **Not a GitHub repository.** GitHub repos are linked via `project_github_repos` — a separate join table.
- **Not auto-discovered.** This phase does NOT scan the filesystem for projects. Folder scanning, Git import, and automatic workspace indexing are deferred.
- **Not a template.** There is no project templating system.

## Data Model

### Renderer Type (`src/lib/types.ts:110-121`)
```ts
interface Project {
  id: string
  name: string
  slug: string              // URL-safe, auto-generated from name
  path: string | null        // optional filesystem root
  description?: string | null
  pinned: boolean
  archived: boolean
  createdAt: number          // epoch ms
  updatedAt: number
  lastActivityAt: number     // touched on conversation activity
  lastOpenedAt?: number | null  // set by selectProject
}
```

### SQLite Table (`projects`)
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  path TEXT,
  description TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0,
  last_activity_at INTEGER NOT NULL,
  last_opened_at INTEGER
);
```

### Conversation Association
- `conversations.project_id TEXT` — nullable FK, indexed with `(project_id, updated_at DESC)`
- Global sessions (pre-project) have `project_id = NULL`
- New sessions auto-assign when created from a project context

### GitHub Repo Linking
- `project_github_repos` join table with `ON DELETE CASCADE` from projects
- Managed by `electron/services/github-repo-store.ts`
- Wired through `EnvironmentPanel` in the workspace surface

## Persistence

- **Storage:** better-sqlite3, WAL mode
- **Schema init:** `electron/services/schema-init.ts:146-159` (fresh DBs)
- **Migrations:** `electron/services/db-migrations.ts` — v15 adds `slug`, `description`, `updated_at`, `last_opened_at`
- **Current version:** v15 (LATEST_VERSION)
- **Service:** `electron/services/projects-store.ts` (217 lines)

## IPC Surface

All channels registered in `electron/ipc/projects.ts`, exposed via `electron/preload.ts:702-720`:

| Channel | Purpose |
|---------|---------|
| `projects:list` | List all (optionally include archived) |
| `projects:get` | Get single project by ID |
| `projects:create` | Create project (name required, path/description optional) |
| `projects:rename` | Rename project (recomputes slug) |
| `projects:setPinned` | Toggle pinned state |
| `projects:setArchived` | Toggle archived state |
| `projects:delete` | Delete (detaches conversations first) |
| `projects:openFolder` | Open project path in OS file manager |
| `projects:copyPath` | Copy project path to clipboard |
| `projects:assignConversation` | Assign/unassign conversation to/from project |
| `projects:ensureForPath` | Get-or-create project by filesystem path |
| `projects:select` | Select project (updates lastOpenedAt) |
| `projects:update` | Patch project name/description/path |

All use `{ success: true, data } | { success: false, error }` shape.

## Renderer Store

`src/stores/projects-store.ts` — Zustand store (~140 lines):

**State:** `projects[]`, `activeProjectId`, `loading`, `isCreating`, `projectError`

**Actions:** `loadProjects`, `createProject`, `renameProject`, `pinProject`, `archiveProject`, `deleteProject`, `openFolder`, `copyPath`, `assignConversation`, `selectProject`, `updateProject`, `clearProjectError`

Guards `window.api.projects` for browser-dev-mode safety.

## Sidebar Flow

### "Projects" Section (`src/components/layout/Sidebar.tsx`)
1. Section header with "PROJECTS" label + "+" button + "worktrees" button
2. "+" button opens `NewProjectModal` (replaced `window.prompt()` in PRJ-6)
3. Project groups rendered via `ProjectSection` component — collapsible rows with chevron, folder icon, pin badge, conversation count, three-dot context menu
4. Active project highlighted with `text-[var(--text-primary)] bg-[var(--bg-tertiary)] font-semibold`
5. Clicking a project calls `selectProject(id)` → updates `activeProjectId` and opens `ProjectHome`

### New Project Modal (`src/components/projects/NewProjectModal.tsx`)
- Collects name (required), description, local path
- Validates against empty name, whitespace, duplicates (case-insensitive), >128 chars
- Keyboard accessible: autofocus name field, Escape closes, Enter submits
- Loading state during creation, error display on failure
- Success toast on creation

## Project Landing View

`src/components/projects/ProjectHome.tsx` — modal-style overlay:
- Shows project name, description, path, timestamps, session count
- Lists project-scoped conversations with click-to-navigate
- "Start new session" button creates a new conversation assigned to the project
- Opened by `useUiStore.openProjectView(id)`, closed by `closeProjectView()`

## Error Handling

- **Duplicate project:** Validated client-side before IPC call via `validateCreateProjectInput`
- **IPC failure:** Generic toast with error message from server
- **Missing project:** "Project not found" view in ProjectHome
- **API unavailable:** Store guards `window.api.projects` — returns null/void silently (no crash)

## Accessibility

- "+" button: `<button>` with `aria-label="New project"`
- NewProjectModal: `role="dialog"`, `aria-modal="true"`, autofocus name field, Escape closes
- ProjectHome: `role="dialog"`, `aria-modal="true"`, Escape closes
- Project rows: `aria-expanded` for collapsible state, `aria-controls` for conversation list

## Extension Points

### Adding Project Settings
Extend the `Project` type with new fields, add migration column(s), update `updateProject` to accept the patch, and add UI controls in ProjectHome.

### Adding Workspace Binding Later
The `path` field already exists. A future phase can add folder picker integration, workspace scanning, or automatic workspace context binding.

### Adding Project Templates
Define a template schema, add a `template_id` or `template` field to the `projects` table, and add a template selection step to `NewProjectModal`.

### Avoiding Unverified Claims
- Do not tell users to "create a folder and Lamprey will discover it" — there is no folder scanning.
- Do not claim Git import, cloud sync, or automatic workspace indexing — these are not implemented.
- All user-facing copy in this phase references verified code paths.

## Related Files

| File | Role |
|------|------|
| `src/lib/types.ts:110-121` | Renderer Project type |
| `src/lib/projects.ts` | Validation helpers, slug generation |
| `src/lib/projects.test.ts` | 22 unit tests for validation/slug |
| `electron/services/projects-store.ts` | Main-process CRUD + touch/ensure |
| `electron/ipc/projects.ts` | 14 IPC channel handlers |
| `electron/preload.ts:702-720` | API surface for renderer |
| `electron/services/db-migrations.ts` | Migration v15 (project column adds) |
| `electron/services/schema-init.ts:146-159` | Table creation for fresh DBs |
| `src/stores/projects-store.ts` | Zustand renderer store |
| `src/components/projects/NewProjectModal.tsx` | Project creation dialog |
| `src/components/projects/ProjectHome.tsx` | Project landing view |
| `src/components/layout/Sidebar.tsx` | Sidebar "Projects" section + "+" button |
| `src/stores/ui-store.ts` | `projectViewId`, `openProjectView`, `closeProjectView` |
| `src/App.tsx` | ProjectHome integration |
| `electron/services/conversation-store.ts` | `setConversationProject`, `touchProject` |
| `electron/services/github-repo-store.ts` | GitHub↔project linking |
| `ARCHITECTURE/PROJECTS.md` | This document |
