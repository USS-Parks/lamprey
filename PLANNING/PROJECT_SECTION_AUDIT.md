# Project Section Audit — PRJ-0

**Date:** 2026-06-08  
**Status:** Complete (read-only — no code changes)

---

## 1. Current "+" Implementation

### Location
`src/components/layout/Sidebar.tsx`, lines 1048–1056 — inside the "PROJECTS" section header bar of the expanded left sidebar.

### Element
```tsx
<button
  type="button"
  onClick={handleAddProject}
  title="New project"
  aria-label="New project"
  className="rounded px-1 py-0.5 text-[14px] leading-none text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
>
  +
</button>
```

**Element type:** `<button>` (not icon, SVG, image, link, placeholder, or overlay).  
**Visual:** Plain text character `+` in 14px, muted color.  
**Accessibility:** `aria-label="New project"`, `title="New project"` — adequate for screen readers.  
**Focus/Hover:** Transitions on hover/focus via Tailwind classes.

### Event Handler (lines 603–607)
```ts
const handleAddProject = async () => {
  const name = prompt('Project name')
  if (!name?.trim()) return
  await createProject(name.trim())
}
```

**Behavior chain:**
1. Opens a browser-native `window.prompt('Project name')` dialog.
2. If user enters non-empty name → calls `createProject(name.trim())` from `useProjectsStore`.
3. If user cancels or enters whitespace → returns silently.
4. `createProject` calls `window.api.projects.create({ name, path: null })` via IPC.

### Root-Cause Analysis
The "+" IS wired and functional. The button is:
- ✅ A `<button>` element (keyboard-accessible by default)
- ✅ Has `onClick` handler
- ✅ Has `aria-label`
- ✅ Has hover/focus styles
- ❌ Uses `window.prompt()` — a minimal, unstyled browser-native dialog
- ❌ Falls back to silent no-op if IPC/API is unavailable (`handleAddProject` doesn't check `window.api`)
- ❌ `window.prompt()` may be suppressed in some Electron configurations or feel "broken" to users expecting a styled modal

**The user-reported "pressing '+' does nothing" is most likely caused by `window.prompt()` being suppressed or invisible in the Electron shell rendering context.**

---

## 2. Existing Project/Workspace Code — Comprehensive Inventory

The project system is **mature and fully wired.** It is NOT missing or unimplemented. Here is the complete inventory:

### 2.1 Database Schema
**Table `projects`** — `electron/services/schema-init.ts:146–154`:
```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_archived_activity ON projects(archived, last_activity_at DESC);
```

**FK column `conversations.project_id`** — `schema-init.ts:334` (Batch A legacy migration):
```sql
ALTER TABLE conversations ADD COLUMN project_id TEXT;
```
Index: `idx_conversations_project ON conversations(project_id, updated_at DESC)` — line 428–429.

**Join table `project_github_repos`** — `schema-init.ts:432–446`:
```sql
CREATE TABLE IF NOT EXISTS project_github_repos (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  html_url TEXT NOT NULL,
  clone_url TEXT NOT NULL,
  local_path TEXT,
  linked_at INTEGER NOT NULL
);
```

### 2.2 Main Process Services
| File | Key Functions |
|------|--------------|
| `electron/services/projects-store.ts` (163 lines) | `listProjects`, `getProject`, `findProjectByPath`, `createProject`, `renameProject`, `setProjectPinned`, `setProjectArchived`, `deleteProject`, `touchProject`, `ensureProjectForPath` |
| `electron/services/conversation-store.ts` (757 lines) | `setConversationProject(id, projectId)` — line 513; calls `touchProject` on activity |
| `electron/services/github-repo-store.ts` | `getRepoLinkForProject`, `findProjectIdForRepo`, `upsertRepoLink`, `unlinkRepoFromProject` |

### 2.3 IPC Channels (12 total)
All registered in `electron/ipc/projects.ts` (119 lines), exposed via `electron/preload.ts:702–718`:

| Channel | Handler | Preload |
|---------|---------|---------|
| `projects:list` | `listProjects(includeArchived?)` | line 703 |
| `projects:get` | `getProject(id)` | line 704 |
| `projects:create` | `createProject({name, path})` | line 705–706 |
| `projects:rename` | `renameProject(id, name)` | line 707 |
| `projects:setPinned` | `setProjectPinned(id, pinned)` | line 708–709 |
| `projects:setArchived` | `setProjectArchived(id, archived)` | line 710–711 |
| `projects:delete` | `deleteProject(id)` | line 712 |
| `projects:openFolder` | `shell.openPath` if project has path | line 713 |
| `projects:copyPath` | `clipboard.writeText` if project has path | line 714 |
| `projects:assignConversation` | `setConversationProject(cid, pid)` | line 715–716 |
| `projects:ensureForPath` | `ensureProjectForPath(path, name?)` | line 717–718 |

All use the standard `{ success: true, data } | { success: false, error }` shape.

### 2.4 Renderer Store
`src/stores/projects-store.ts` (102 lines) — Zustand store with:
- **State:** `projects[]`, `loading`
- **Actions:** `loadProjects`, `createProject`, `renameProject`, `pinProject`, `archiveProject`, `deleteProject`, `openFolder`, `copyPath`, `assignConversation`
- Calls `window.api.projects.*` with guard `if (!window.api?.projects) return`

### 2.5 TypeScript Types
**Renderer** — `src/lib/types.ts:110–118`:
```ts
export interface Project {
  id: string
  name: string
  path: string | null
  pinned: boolean
  archived: boolean
  createdAt: number
  lastActivityAt: number
}
```

**Main process** — `electron/services/projects-store.ts:15–23` (identical shape, but uses `number` for timestamps).

With `rowToProject()` converter for SQLite integer booleans.

### 2.6 UI Surfaces
| Component | File | What It Does |
|-----------|------|-------------|
| Sidebar "Projects" section | `Sidebar.tsx:1043–1138` | Section header with "+" + "worktrees" buttons; lists project groups with collapsible sections; per-project context menu (New chat, Rename, Pin/Unpin, Open folder, Copy path, Archive) |
| `ProjectSection` subcomponent | `Sidebar.tsx:293–450` | Collapsible project row with chevron, folder icon, pin badge, conversation count, three-dot menu |
| `SessionsSidebar` | `SessionsSidebar.tsx:99–110` | Groups sessions by `projectId`; unassigned sessions shown under "Unassigned" |
| `EnvironmentPanel` | `EnvironmentPanel.tsx:175–213` | Reads `projectId` from active conversation; fetches GitHub repo link; auto-ensures project for cwd |
| `ChatInput` | `ChatInput.tsx:765` | Uses `workspaceRoot` (not `projectId`) for `@file` mentions |

### 2.7 Event System
Events emitted for `project.created`, `project.pinned`, `project.archived`, `project.deleted` — `electron/services/projects-store.ts:117–136`. Event presentation in `src/lib/event-presentation.ts:43–46, 151–158`. Tests in `spine-events-prompt4-misc.test.ts:125–165`.

### 2.8 Conversation Integration
- `Conversation.projectId?: string | null` — type-level optional FK
- New conversations can be assigned to a project via `setConversationProject` → `handleNewChatInProject` (Sidebar.tsx:594)
- `touchProject(id)` updates `last_activity_at` on any conversation activity
- `ensureProjectForPath` auto-creates projects for floating/worktree conversations

### 2.9 GitHub Integration
Full bidirectional project↔repo linking via `project_github_repos` table. `EnvironmentPanel` wires GitHub repo picker to projectId.

---

## 3. Storage Decision

| Decision | Chosen Path | Reason |
|----------|------------|--------|
| Project storage | **SQLite `projects` table** — already exists | Already built, indexed, FK'd to conversations, event-logged |
| No change needed | Stay with existing SQLite table | Migration v14 currently active; any schema changes go via `db-migrations.ts` |

---

## 4. Renderer State Decision

| Decision | Chosen Path | Reason |
|----------|------------|--------|
| Project renderer state | **`src/stores/projects-store.ts`** (Zustand) — already exists | Single source of truth, guards `window.api` absence, all CRUD wired |
| No new store needed | Extend existing store | Avoid fragmenting project state |

---

## 5. Routing Decision

| Decision | Chosen Path | Reason |
|----------|------------|--------|
| App routing | **No URL router** — single-page conditional rendering driven by Zustand | No react-router/wouter in the app; all navigation is store-driven |
| Project landing view | **Panel approach** — conditionally render a `ProjectHome` component when a project is "active" | Follows existing patterns (SettingsDialog, CustomizeView, RightPanelHome) |
| Active project mechanism | **`useUiStore` or sidebar store** — add `activeProjectId` to trigger view | Consistent with `activeTool`, `settingsOpen`, `artifactOpen` patterns |

---

## 6. Session/Chat Association Findings

| Finding | Detail |
|---------|--------|
| `projectId` on conversations | Already exists — `conversations.project_id TEXT` column, FK-indexed |
| New session assignment | `setConversationProject(id, projectId)` — fully operational |
| Old sessions | Load correctly with `projectId = null` (nullable column) |
| Auto-bucketing | `ensureProjectForPath` creates projects from worktree paths automatically |
| No migration needed | Column already exists; zero-impact |

---

## 7. Accessibility Findings

| Element | Status |
|---------|--------|
| "+" button | ✅ `<button>` element — keyboard accessible by default |
| `aria-label` | ✅ `"New project"` |
| `title` | ✅ `"New project"` |
| Visual affordance | ⚠️ Plain text `+` character — small hit target (approx 18×20px) |
| Focus management | ❌ `window.prompt()` hijacks focus without proper modal trapping |
| Error communication | ❌ Silent failure if `window.api` unavailable; generic toasts for IPC errors |
| Dialog role | ❌ `window.prompt()` is not an accessible modal dialog |

---

## 8. Implementation Decisions

| Decision | Chosen Path | Reason | Deferred Alternatives |
|----------|------------|--------|---------------------|
| Project storage | SQLite `projects` table (exists) | Already built, indexed, FK'd, event-logged | JSON config, app settings |
| Project renderer state | `useProjectsStore` (Zustand, exists) | Single source of truth, full CRUD | Local component state, new store |
| Sidebar integration file | `src/components/layout/Sidebar.tsx` | Already contains "Projects" section + "+" button | N/A |
| Project landing route | Panel/dialog approach (no URL router) | App has no react-router; all navigation is Zustand-driven | Add react-router for URL-based routing (deferred) |
| Session association strategy | Already implemented — `conversations.project_id` | Column exists, services wired, FK-indexed | Defer full scoping |
| Workspace scanning | Already partially implemented via `ensureProjectForPath` | Auto-creates projects from worktree paths | Future phase |
| **New Project modal** | Replace `window.prompt()` with a styled `<dialog>`/modal | Resolves the reported UX gap; adds validation, accessibility, error states | Keep `prompt()` but fix Electron suppression |
| Project model extension | Add `slug`, `description`, `updatedAt` via migration | Enables richer project views and future features | Keep current minimal model |
| `activeProjectId` state | Add to sidebar store or uiStore | Enables project landing view/selection tracking | Local state only |

---

## 9. Gap Analysis: Plan vs. Reality

The original plan (LAMPREY_PROJECT_SECTION_PLAN.md) was drafted under the assumption that "the sidebar '+' performs no observable action" and "the Project domain is undefined or not wired end-to-end." This audit disproves both assumptions.

### What Already Exists (should not be rebuilt)
- ✅ `projects` SQLite table with indexes
- ✅ Main-process CRUD services (list, get, create, rename, pin, archive, delete, touch, ensureForPath)
- ✅ Renderer Zustand store with full IPC integration
- ✅ 12 IPC channels with standard success/error shape
- ✅ Sidebar "Projects" section with collapsible project groups
- ✅ Per-project context menu (rename, pin, archive, new chat, open folder, copy path)
- ✅ Conversation↔project FK assignment
- ✅ GitHub↔project repo linking
- ✅ Event audit trail for project lifecycle
- ✅ Session bucketing by project in SessionsSidebar
- ✅ Auto-project-creation for worktree paths
- ✅ `touchProject` liveness tracking

### What Is Missing (actual gaps to close)
| Gap | Severity | Current behavior | Target behavior |
|-----|----------|-----------------|-----------------|
| No styled New Project modal | High | `window.prompt()` | Proper modal with name validation, focus trap, error states |
| No project validation UX | High | Bare `prompt()` with no checks beyond empty | Validation for empty, whitespace-only, duplicates |
| No visible failure when API unavailable | High | Silent no-op | Toast/error message |
| No `activeProjectId` in state | Medium | Selection tracked only in sidebar expansion/localStorage | Central `activeProjectId` enabling project landing view |
| No project landing/hero view | Medium | No dedicated view for project context | View showing project details, sessions, actions |
| No `slug`, `description`, `updatedAt` on model | Low | Minimal Project type | Richer model for display/URL slugs |
| Small "+" hit target | Low | ~18×20px text button | Could be larger or icon-based |

### Adjusted Prompt Strategy
The plan's 14 prompts remain useful but must be re-scoped:
- **PRJ-0:** ✅ This audit (done — reveals existing system)
- **PRJ-1:** Focus on ADDING fields (`slug`, `description`, `updatedAt`) to existing Project type + validation helpers
- **PRJ-2:** Add migration for new columns (if needed) — minimal, additive
- **PRJ-3:** Extend existing IPC/service (not rebuild) to support new fields
- **PRJ-4:** Extend existing Zustand store (not rebuild) for new fields + `activeProjectId`
- **PRJ-5:** Build the New Project modal — THIS is the core UX fix
- **PRJ-6:** Wire sidebar "+" to modal (replace `window.prompt()` call)
- **PRJ-7:** Sidebar already renders projects — enhance with active styling, truncation, tooltips
- **PRJ-8:** Add project landing view (panel, not route)
- **PRJ-9:** Already implemented — `projectId` on conversations exists; add query helpers if needed
- **PRJ-10:** Add regression tests for modal, "+" behavior, persistence
- **PRJ-11:** Polish — error copy, visual integration, empty states
- **PRJ-12:** Architecture documentation for existing + new code
- **PRJ-13:** Phase wrap

---

## 10. Risk Register Update

| Risk | Audit Finding | Mitigation |
|------|--------------|------------|
| "+" may be wired to incomplete flow | ✅ Fully wired — `prompt()` → `createProject` → IPC → SQLite → store → sidebar refresh | N/A (flow works) |
| May already have workspace/project concepts | ✅ Mature project system exists under `projects` table + `Project` type | Integrate, don't rebuild |
| Wrong storage choice | ✅ SQLite confirmed — working, indexed, FK'd | Stay with SQLite |
| Type crossing boundaries | ✅ Types exist in both `lib/types.ts` and `services/projects-store.ts` | Add new fields to both |
| No react-router | ✅ Confirmed — no URL router; all navigation is Zustand-driven | Use panel/dialog approach |
| Session FK migration needed | ✅ Already exists — `conversations.project_id` | Zero migration needed for PRJ-9 |
| better-sqlite3 test mismatch | ✅ Known issue — 122 tests skip under native-binding guard | Follow established skip convention |
| Path validation not renderer-safe | ✅ `ensureProjectForPath` validates paths server-side | Client validates format only |
