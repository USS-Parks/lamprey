# Lamprey Project Section Plan — Sequential Prompt Roster (P-SPR)

> \*\*Status: draft for review.\*\* This P-SPR was drafted on 2026-06-08 from the current Lamprey Harness planning context and the user-reported product defect: the left-sidebar "+" affordance appears to mean "Add Project" but currently performs no observable action. Once approved, this file becomes the single canonical plan for the Project Section phase. Execute PRJ-0 → PRJ-13 without stopping.

**Goal:** Add a true first-class Project section to Lamprey Harness so the left-sidebar "+" control opens a real project creation flow, creates a persisted project record, updates the sidebar immediately, selects the new project, and routes the user into a useful project landing view. When finished, "Project" is no longer an undefined UI promise. It is a typed, persisted, test-covered workspace container that can later own sessions, chat history, local workspace bindings, permissions, tool/plugin settings, and project-specific environment state.

**Research basis:** The product assessment established that the current failure is not merely a dead click handler. The "+" affordance implies a domain object that Lamprey Harness has not yet fully defined. The plan therefore closes gaps in dependency order: audit → domain model → persistence → store → modal → sidebar → routing → session binding → settings surface → tests → docs → wrap.

**Primary sources:**

* Current Lamprey Harness repo state
* `CLAUDE.md`
* Prior shipped Lamprey phase plans under `PLANNING/`
* User-reported behavior: pressing the sidebar "+" does nothing
* Project-section requirements developed in this P-SPR

**Current Lamprey substrate this phase builds on:**

* Lamprey Harness is an Electron desktop multi-agent coding harness using React 19, TypeScript, electron-vite, Zustand stores, IPC services, and better-sqlite3.
* Main process service logic lives under `electron/services/`.
* IPC handlers live under `electron/ipc/`.
* Renderer UI lives under `src/`.
* App state already uses renderer stores, including `src/stores/agent-store.ts`.
* Database persistence already exists at `userData/lamprey.db`.
* UI surfaces already include a left sidebar, right panel, settings surfaces, chat input, agent run banners, and multiple completed phase surfaces.
* The left sidebar already contains a visible "+" affordance, but the current implementation must be audited before any behavior is assumed.
* Existing shipped plans are reference-only. This P-SPR becomes the active source of truth only after user approval.

**Why a new phase is still needed:** A project is one of the natural organizing structures for an LLM harness. Without a real Project domain, sessions, file context, tool permissions, plugins, environment state, and workspace bindings remain loosely associated with the global app. This phase creates the missing project spine while avoiding premature features such as automatic workspace scanning, GitHub import, project templates, or cloud sync.

\---

## 0\. Session Bootstrap — Read This First

You are a fresh coding session handed this document. Before doing anything else:

### Step 1 – Confirm environment

Verify:

* Working directory is `C:\\\\Users\\\\17076\\\\Documents\\\\Claude\\\\Lamprey Harness` or a worktree thereof.
* Current branch is not `main`. Create a branch such as `codex/project-section` off `main` if needed.
* `git status --short --branch` is inspected before editing. Do not revert unrelated user changes.
* Read `CLAUDE.md` and `DEVLOG.md` before implementation.
* Baseline checks pass before PRJ-0 starts:

  * `npm run lint`
  * `npx tsc --noEmit -p tsconfig.node.json`
  * `npx tsc --noEmit -p tsconfig.web.json`
  * `npm test`
  * `npm run build`
* If any baseline check fails, halt and report the exact failure. Do not start implementation on a broken baseline.

### Step 2 – Execute PRJ-0 → PRJ-13 without stopping

1. Do not ask further questions unless a prompt requires a product decision only the user can make.
2. For each prompt, in order:

   * Read the listed files and nearby code before editing.
   * Implement only that prompt's scope.
   * Run the prompt's verify gate.
   * If verify fails: fix and retry up to 2 times. On the third failure, halt, write a blocked DEVLOG entry, and report.
   * If verify passes: mark the prompt `\[x]` in this document, append a DEVLOG entry, then commit. Do not push.
3. One commit per prompt. No batching, no early phase wrap.
4. When all prompts complete: run the phase completion gate, write the phase-complete DEVLOG entry, and report final status.

### Step 3 – DEVLOG entry format

```markdown
## \[Project Section – Prompt PRJ-N] <Title> - <YYYY-MM-DD>

\*\*Files changed:\*\* <list>
\*\*Verify gate:\*\*
- lint OK
- tsc node OK
- tsc web OK
- vitest <subset or all> OK
- build/smoke/user-verification-needed: <result>

\*\*Project behavior:\*\* <created/selected/routed/persisted behavior verified or "not applicable">
\*\*Notes:\*\* <anything surprising, deferred, or worth knowing>

\*\*Commit:\*\* <SHA>
```

### Step 4 – Commit discipline

* One commit per prompt.
* Never use `--no-verify`. If a hook fails, fix the underlying issue.
* Never add a `Co-Authored-By` trailer.
* Use the project's commit-message style, e.g.:

  * `docs(projects): PRJ-0 audit project surface`
  * `feat(projects): PRJ-1 add project domain model`
  * `feat(projects): PRJ-3 project persistence service`
  * `feat(projects): PRJ-6 wire sidebar project creation`
  * `test(projects): PRJ-10 project flow regression suite`

\---

## 1\. Audit Summary — Current Gaps

|#|Gap|Current evidence|Owner prompt|
|-|-|-|-|
|1|The sidebar "+" affordance performs no observable action and may be an unimplemented placeholder, broken handler, dead route, or hidden modal trigger.|User-reported behavior: pressing "+" does nothing. The actual implementation must be inspected before making claims.|PRJ-0|
|2|The Project domain is undefined or not wired end-to-end. A project cannot yet be treated as a typed workspace container across UI, state, persistence, and routing.|Existing product behavior does not expose creation, listing, selection, or a landing view for projects.|PRJ-1|
|3|No verified project persistence path exists for user-created projects.|Lamprey has better-sqlite3 and app settings persistence, but the correct project storage layer must be confirmed before implementation.|PRJ-2, PRJ-3|
|4|No single renderer state source for projects is established.|Existing Zustand stores may support related app state, but project state must be audited and either extended or added cleanly.|PRJ-4|
|5|No New Project modal or creation surface is available to users.|The "+" affordance currently has no visible creation outcome.|PRJ-5, PRJ-6|
|6|The sidebar does not yet render persisted projects as a real Project section with empty, active, loading, and error states.|A visible project list cannot be assumed until code confirms it.|PRJ-7|
|7|A newly created or selected project has no guaranteed destination view.|Without a project route or active view, creation can succeed while leaving the user in a dead state.|PRJ-8|
|8|Existing sessions/chats may not carry a `projectId` relationship.|Project-scoped session behavior is needed for the feature to become more than a label list.|PRJ-9|
|9|Project creation and selection may lack regression coverage.|The current dead "+" behavior shows that UI affordances can regress silently without tests.|PRJ-10|
|10|Keyboard accessibility and user-visible error handling may be absent from the current "+" implementation.|Silent no-op behavior is currently possible.|PRJ-5, PRJ-6, PRJ-10|
|11|No architecture document explains what a Lamprey Project is or how future phases should extend it.|Future phases need a clear boundary for workspace binding, session scope, plugin settings, and permissions.|PRJ-12|
|12|Phase is not wrapped: no final gate run, no DEVLOG summary, no plan completion marker.|This plan is draft.|PRJ-13|

\---

## 2\. Architectural Invariants — Locked

1. **Project is a first-class domain object.** It is not merely a folder shortcut, visual label, or sidebar decoration.
2. **The "+" button must never fail silently.** It must either open the New Project flow or show a specific user-visible error.
3. **Project creation is explicit.** This phase does not rely on automatic workspace scanning unless the audit proves such a system already exists and the implementation intentionally wires into it.
4. **Persistence precedes UI confidence.** A project is not created until it is persisted through the selected storage layer.
5. **The sidebar reflects persisted state.** Created projects appear immediately after creation and remain visible after app reload.
6. **Project state has one renderer source of truth.** The UI must not maintain separate, conflicting project lists.
7. **Project selection is explicit.** Selecting or creating a project updates `activeProjectId` and records `lastOpenedAt`.
8. **Routing or active-view behavior must be useful.** A created project must land somewhere meaningful, not on a blank screen.
9. **Session association is additive and migration-safe.** Existing chats/sessions continue working. Project-scoped session behavior must not break old rows.
10. **Project records are minimal but extensible.** The first schema should support future workspace paths, settings, repository links, and project-specific controls without forcing those features now.
11. **No unverified project-discovery claims.** The implementation and documentation must not tell users to create folders manually unless that behavior is code-confirmed or runtime-tested.
12. **Error handling is visible.** Validation, duplicate names, persistence failures, route failures, and path issues must surface in the UI.
13. **Accessibility is required.** The "+" control and modal must support keyboard use, focus management, labels, and escape/cancel behavior.
14. **Tests lock the path.** A regression test must prove that pressing "+" opens project creation and that the created project persists.
15. **Future features are intentionally deferred.** Git import, workspace scanning, templates, cloud sync, multi-user project sharing, and automatic project indexing are not part of this phase.
16. **Docs reflect real code paths.** Any architecture or user-facing documentation added in this phase must reference actual files, routes, and services created by the prompts.

\---

## 3\. Prompt Sequence

|#|Prompt|One-liner|Files (net new / modified)|Verify|Status|
|-|-|-|-|-|-|
|PRJ-0|**Project surface and sidebar audit**|Read-only audit of the current sidebar "+", existing project code, persistence patterns, routes, stores, and session model.|New `PLANNING/PROJECT\_SECTION\_AUDIT.md`; read-only inspection of `src/components/`, `src/stores/`, `electron/services/`, `electron/ipc/`, routes, DB/store files|Audit document complete; includes Implementation Decisions table; baseline checks unchanged|\[ ]|
|PRJ-1|**Project domain model and validation contract**|Define `Project`, `CreateProjectInput`, validation helpers, slug generation, and timestamp helpers.|New or modified shared type files; new `src/lib/projects.ts` or equivalent; tests|Project type and helpers compile; validation rejects invalid input; lint; tsc web/node as applicable; tests|\[ ]|
|PRJ-2|**Project storage decision and migration**|Select the project persistence layer and add migration/schema support without wiring UI.|`electron/services/` persistence files, DB migration files, tests|Schema/migration applies cleanly; old DBs unaffected; lint; tsc node; migration tests|\[ ]|
|PRJ-3|**Project persistence service and IPC**|Add create/list/update/select project service methods and typed IPC/preload surface.|New `electron/services/project-store.ts` or equivalent; `electron/ipc/projects.ts`; `electron/preload.ts`; renderer API types; tests|Projects create, persist, reload, select; IPC returns standard `{ success, data/error }`; lint; tsc node/web; tests|\[ ]|
|PRJ-4|**Renderer project store**|Expose project records to UI through a single Zustand store or existing app-store extension.|New or modified `src/stores/project-store.ts`; renderer types; tests|Store loads, creates, selects, updates, handles errors; lint; tsc web; store tests|\[ ]|
|PRJ-5|**New Project modal**|Create the modal/dialog for named project creation with validation, focus behavior, loading, cancel, and errors.|New `src/components/projects/NewProjectModal.tsx`; tests|Modal validates name, blocks duplicates, handles errors, manages focus; lint; tsc web; component tests|\[ ]|
|PRJ-6|**Wire sidebar "+" to project creation**|Replace the inert "+" behavior with a real accessible action opening the New Project modal.|Existing sidebar files; modal integration; tests|Mouse and keyboard open modal; no silent failure; lint; tsc web; component/integration tests|\[ ]|
|PRJ-7|**Render Project section in sidebar**|Display persisted projects, empty state, active styling, sorting, selection, and error/loading states.|Sidebar components; project store usage; tests|Projects appear after creation and reload; active state works; lint; tsc web; tests|\[ ]|
|PRJ-8|**Project landing route/view**|Add `/projects/:projectId` or equivalent active project view with useful empty state and actions.|Route files; new `src/components/projects/ProjectHome.tsx`; tests|Creating/selecting project lands on a useful view; invalid ID handled; lint; tsc web; route tests|\[ ]|
|PRJ-9|**Project-scoped sessions foundation**|Add optional `projectId` relationship for new sessions/chats without breaking existing history.|Conversation/session store files, DB migration if needed, IPC/chat wiring, tests|New sessions can be project-associated; old sessions still load; lint; tsc node/web; tests|\[ ]|
|PRJ-10|**Project flow regression test suite**|Add end-to-end-style tests covering "+", modal, persistence, reload, selection, route, and no-op prevention.|New and modified test files|Full project creation path covered; current bug cannot recur silently; lint; tsc node/web; tests|\[ ]|
|PRJ-11|**Project polish and product guardrails**|Add empty-state copy, duplicate handling, loading states, failure receipts, and no-claim product guidance safeguards.|UI copy files, project components, tests|Errors are specific; empty states clear; no unverified workspace-scanning guidance; lint; tsc web; tests|\[ ]|
|PRJ-12|**Project architecture documentation**|Write the maintainer document for the Project domain, data flow, extension points, and non-goals.|New `ARCHITECTURE/PROJECTS.md`; possible README/CLAUDE note update|Document references real files and current behavior; lint/tsc unaffected|\[ ]|
|PRJ-13|**Phase wrap**|Run full gate, mark all prompts complete, write DEVLOG summary, and close the phase.|`DEVLOG.md`, this plan file|Full gate passes; all prompts `\[x]`; phase summary written; no known silent project gaps remain|\[ ]|

\---

## 4\. Prompt Details

### PRJ-0 — Project surface and sidebar audit

**Goal.** Produce a read-only audit document that captures the current state of the sidebar "+", any existing Project-related code, existing persistence patterns, route structure, state stores, and session/chat storage. This prompt must determine the real integration points before any implementation begins.

**Work.**

* Inspect the left sidebar implementation and locate the exact component rendering the "+" affordance.
* Determine whether the "+" is:

  * a button,
  * an icon-only control,
  * a route link,
  * a placeholder,
  * disabled,
  * covered by an overlay,
  * missing an event handler,
  * wired to a missing modal,
  * or failing because of state, IPC, or route errors.
* Search the repo for existing Project-related code:

  * `Project`
  * `projectId`
  * `workspace`
  * `workspaceId`
  * `recentProjects`
  * `activeProject`
  * `projects`
  * `workspaceRoot`
  * `session.project`
* Inspect existing storage patterns:

  * better-sqlite3 migration style
  * settings persistence
  * conversation/session persistence
  * renderer store persistence
  * preload/IPC conventions
* Inspect routing or view composition to determine where a project landing page belongs.
* Inspect chat/session creation flow to determine how `projectId` can be added later without breaking old data.
* Write `PLANNING/PROJECT\_SECTION\_AUDIT.md` with these sections:

  * **Current "+" implementation**
  * **Existing Project/workspace code**
  * **Storage decision candidates**
  * **Renderer state decision candidates**
  * **Routing decision candidates**
  * **Session/chat association findings**
  * **Accessibility findings**
  * **Implementation Decisions**
* Add an "Implementation Decisions" table:

|Decision|Chosen path|Reason|Deferred alternatives|
|-|-|-|-|
|Project storage|*Discovered in audit*|*Per audit*|JSON config, alternate table, app settings|
|Project renderer state|*Discovered in audit*|*Per audit*|Local component state, existing app store only|
|Sidebar integration file|*Discovered in audit*|*Per audit*|N/A|
|Project landing route|*Discovered in audit*|*Per audit*|Global active-project panel|
|Session association strategy|*Discovered in audit*|*Per audit*|Defer full scoping|
|Workspace scanning|Disabled unless existing code proves support|Avoid unverified product behavior|Future phase|

* Make no code changes.

**Acceptance.**

* `PLANNING/PROJECT\_SECTION\_AUDIT.md` exists.
* The current "+" behavior is proven from code inspection.
* Existing Project/workspace code is confirmed or ruled out.
* Storage, store, route, and session association decisions are documented.
* No implementation files are changed.
* Baseline checks remain unchanged.

\---

### PRJ-1 — Project domain model and validation contract

**Goal.** Define the Project domain in shared TypeScript code so UI, IPC, services, tests, and future phases use one contract.

**Work.**

* Add a shared Project type in the location discovered by PRJ-0. If no better location exists, create `src/lib/projects.ts` and mirror or share types to the Electron side through the repo's established type pattern.
* Define:

```ts
export interface Project {
  id: string
  name: string
  slug: string
  description?: string | null
  localPath?: string | null
  repoUrl?: string | null
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string | null
  settings?: ProjectSettings | null
}

export interface CreateProjectInput {
  name: string
  description?: string | null
  localPath?: string | null
  repoUrl?: string | null
}

export interface ProjectSettings {
  defaultModelId?: string | null
  defaultAgentMode?: string | null
}
```

* Add helper functions:

  * `normalizeProjectName(name: string): string`
  * `slugifyProjectName(name: string): string`
  * `validateCreateProjectInput(input: CreateProjectInput, existingProjects: Project\[]): ProjectValidationResult`
  * `createProjectId(): string`
  * `nowIso(): string`
* Validation must reject:

  * empty names,
  * whitespace-only names,
  * duplicate active project names,
  * duplicate slugs,
  * path input that is known-invalid by existing validators, if such validators exist.
* Do not implement workspace scanning, Git import, or repository validation beyond basic URL shape if an existing helper already exists.
* Write tests for slug generation and validation.

**Acceptance.**

* The Project contract compiles.
* Helper functions are deterministic and tested.
* Duplicate and empty-name validation works.
* No UI behavior is changed yet.
* Lint, relevant tsc checks, and unit tests pass.

\---

### PRJ-2 — Project storage decision and migration

**Goal.** Add the persistence schema or storage foundation selected in PRJ-0 without wiring user-facing UI yet.

**Work.**

* Implement the selected persistence layer. Prefer the app's existing better-sqlite3/migration pattern if PRJ-0 confirms it is appropriate.
* If using SQLite, add a `projects` table:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  local\_path TEXT,
  repo\_url TEXT,
  settings\_json TEXT,
  created\_at TEXT NOT NULL,
  updated\_at TEXT NOT NULL,
  last\_opened\_at TEXT
);
```

* Add indexes as appropriate:

```sql
CREATE INDEX IF NOT EXISTS idx\_projects\_last\_opened\_at ON projects(last\_opened\_at);
CREATE INDEX IF NOT EXISTS idx\_projects\_updated\_at ON projects(updated\_at);
```

* If using app settings or a JSON config file instead, document the reason in the DEVLOG and implement equivalent durability.
* Ensure migration is safe for existing installs.
* Do not add UI yet.
* Write migration/storage tests if the repo has a matching pattern.

**Acceptance.**

* Project storage schema or equivalent durable storage exists.
* Existing databases/settings load without destructive migration.
* No user-facing behavior is changed.
* Lint, tsc node, and storage/migration tests pass.

\---

### PRJ-3 — Project persistence service and IPC

**Goal.** Add the service and IPC surface required to list, create, update, and select projects using the storage layer from PRJ-2.

**Work.**

* Add a project service such as `electron/services/project-store.ts` or the equivalent path chosen in PRJ-0.
* Implement:

  * `listProjects(): Promise<Project\[]> | Project\[]`
  * `getProject(projectId: string): Promise<Project | null> | Project | null`
  * `createProject(input: CreateProjectInput): Promise<Project> | Project`
  * `updateProject(projectId: string, patch: UpdateProjectInput): Promise<Project> | Project`
  * `selectProject(projectId: string): Promise<Project> | Project`
  * `getActiveProjectId(): Promise<string | null> | string | null`
* Store active project selection in the existing settings/preferences layer unless PRJ-0 selected another pattern.
* Add IPC handlers:

  * `projects:list`
  * `projects:create`
  * `projects:update`
  * `projects:select`
  * `projects:getActive`
* Update `electron/preload.ts` and renderer API types.
* Follow the app convention:

```ts
{ success: true, data: T } | { success: false, error: string }
```

* Errors must be typed or at least specific:

  * duplicate project,
  * invalid input,
  * storage failure,
  * missing project.
* Write service and IPC tests where possible.

**Acceptance.**

* Projects can be created, persisted, listed, updated, selected, and reloaded from service code.
* IPC uses the app's standard success/error shape.
* Active project selection persists.
* Lint, tsc node, tsc web, and tests pass.

\---

### PRJ-4 — Renderer project store

**Goal.** Expose project records to the renderer through a single state source.

**Work.**

* Add a Zustand project store or extend the existing store pattern identified in PRJ-0.
* State must include:

```ts
projects: Project\[]
activeProjectId: string | null
isLoadingProjects: boolean
isCreatingProject: boolean
projectError: string | null
```

* Actions must include:

```ts
loadProjects()
createProject(input: CreateProjectInput)
selectProject(projectId: string)
updateProject(projectId: string, patch: UpdateProjectInput)
clearProjectError()
```

* Store behavior:

  * `loadProjects()` hydrates from IPC.
  * `createProject()` calls IPC, updates state only after service success, selects the created project, and records errors.
  * `selectProject()` updates active project state only after service success.
  * Sorting should follow the project service or apply consistently in the store: `lastOpenedAt` descending, then `updatedAt` descending.
  * The store must handle `window.api` absence safely if existing renderer code supports browser dev mode.
* Write store tests.

**Acceptance.**

* The renderer has one project state source.
* State updates only after successful IPC.
* Errors are visible to components.
* Browser dev mode does not crash.
* Lint, tsc web, and tests pass.

\---

### PRJ-5 — New Project modal

**Goal.** Create the user-facing modal that collects project data and calls the renderer project store.

**Work.**

* Add `src/components/projects/NewProjectModal.tsx` or the equivalent component path selected in PRJ-0.
* Fields:

  * Project name, required.
  * Description, optional.
  * Local folder/path, optional.
  * Repository URL, optional.
* Required behaviors:

  * Autofocus project name on open.
  * Escape closes modal if not submitting.
  * Cancel closes modal.
  * Create button disabled until name is valid.
  * Duplicate names are blocked before submit when known from store state.
  * Submit shows loading state.
  * Submit failure keeps modal open and displays the specific error.
  * Submit success closes modal.
* Accessibility requirements:

  * Dialog role or app-standard modal pattern.
  * Label for every field.
  * Focus trap if existing modal utilities support it.
  * `aria-describedby` for error text when present.
* Do not wire the sidebar "+" yet unless PRJ-0 showed an existing modal trigger that must be replaced here.
* Write component tests.

**Acceptance.**

* Modal renders and validates correctly.
* Keyboard and focus behavior work.
* Error display is visible and specific.
* No sidebar behavior changed yet unless required by existing modal pattern.
* Lint, tsc web, and tests pass.

\---

### PRJ-6 — Wire sidebar "+" to project creation

**Goal.** Replace the current inert "+" behavior with a reliable, accessible action that opens the New Project modal.

**Work.**

* Modify the sidebar component identified in PRJ-0.
* Convert the "+" element into a proper button if it is not already one.
* Add:

  * `aria-label="Create new project"`
  * click handler opening `NewProjectModal`
  * keyboard activation through normal button semantics
  * hover/focus states matching the Lamprey sidebar design
  * disabled/loading state only if project data is loading and the app standard requires it
* Ensure the button is not hidden behind overlays, event propagation traps, stale state, or dead routes.
* If project creation cannot open because IPC/API is unavailable, show a visible error rather than doing nothing.
* Write a test that fails against the old bug:

  * render sidebar,
  * click "+",
  * assert New Project modal is visible.

**Acceptance.**

* Pressing "+" opens New Project modal by mouse.
* Pressing Enter/Space while focused opens New Project modal.
* The action never fails silently.
* The old bug is covered by a regression test.
* Lint, tsc web, and tests pass.

\---

### PRJ-7 — Render Project section in sidebar

**Goal.** Display persisted projects in the left sidebar as a real Project section.

**Work.**

* Add or update the Project section in the sidebar.
* Render all projects from the renderer project store.
* Show:

  * section label: `Projects`
  * empty state: `No projects yet.`
  * loading state
  * error state
  * active project styling
  * project names with safe truncation
  * optional tooltip/title with full name if app pattern supports it
* Click behavior:

  * selecting a project calls `selectProject(projectId)`,
  * updates `activeProjectId`,
  * updates `lastOpenedAt`,
  * navigates to the project landing route if PRJ-8 route is already available, or stores active selection for PRJ-8 if not.
* Sort projects by `lastOpenedAt` descending, then `updatedAt` descending.
* Do not add hardcoded demo projects.
* Write tests:

  * empty state,
  * created project appears,
  * active project styling,
  * select project action.

**Acceptance.**

* Created projects appear immediately.
* Projects remain visible after reload.
* Active project state is clear.
* Empty/loading/error states exist.
* Lint, tsc web, and tests pass.

\---

### PRJ-8 — Project landing route/view

**Goal.** Add a useful destination for created and selected projects.

**Work.**

* Add route or active-view behavior according to PRJ-0. Preferred route if compatible with current app structure:

```text
/projects/:projectId
```

* Add `ProjectHome` view displaying:

  * project name,
  * description if present,
  * local path if present,
  * repository URL if present,
  * created date,
  * last opened date,
  * session count if available,
  * empty session state.
* Empty state copy:

```text
No sessions yet.
Start a new session in this project to begin working.
```

* Add primary action:

```text
Start new session
```

* If session creation already exists and can accept project context, pass `projectId`.
* If not, route to existing new-session behavior and leave project-scoped session wiring to PRJ-9.
* Invalid project ID behavior:

  * show `Project not found`,
  * offer to return to the main chat or Projects list.
* After successful project creation in PRJ-4/PRJ-5, navigate to the new route if routing is available.
* Write route/view tests.

**Acceptance.**

* Creating a project lands on a useful project view.
* Selecting a project opens the project view.
* Invalid project IDs do not crash the app.
* The project view has a clear empty state.
* Lint, tsc web, and tests pass.

\---

### PRJ-9 — Project-scoped sessions foundation

**Goal.** Add the foundation for associating new sessions/chats with a project while preserving existing global history.

**Work.**

* Audit current conversation/session data structures again before editing.
* Add optional `projectId` to new session/chat records using the least disruptive migration pattern.
* If using SQLite, add a nullable column such as:

```sql
ALTER TABLE conversations ADD COLUMN project\_id TEXT;
```

or the actual table discovered in PRJ-0.

* Add an index if useful:

```sql
CREATE INDEX IF NOT EXISTS idx\_conversations\_project\_id ON conversations(project\_id);
```

* New session behavior:

  * if `activeProjectId` exists, new sessions created from the project view or active project context receive that ID;
  * if no active project exists, new sessions remain global/unassigned.
* Existing sessions:

  * continue loading with `projectId = null`;
  * are not force-migrated.
* Add ProjectHome recent sessions if current query patterns make that safe.
* Add tests:

  * old rows still load,
  * new project-scoped sessions save with `projectId`,
  * global sessions still work.

**Acceptance.**

* Project-scoped session association exists for new sessions.
* Old history is not broken.
* ProjectHome can show recent project sessions if supported.
* Lint, tsc node, tsc web, and tests pass.

\---

### PRJ-10 — Project flow regression test suite

**Goal.** Add targeted tests that prevent this exact failure from returning.

**Work.**

* Add or expand tests covering:

  * sidebar "+" opens New Project modal,
  * modal blocks empty name,
  * modal blocks duplicate name,
  * successful create calls IPC/store,
  * created project appears in sidebar,
  * project persists after reload/store rehydrate,
  * project becomes active,
  * project route opens,
  * invalid project route does not crash,
  * persistence failure shows error and keeps modal open,
  * keyboard activation of "+",
  * Escape/cancel behavior,
  * old sessions still load after project migration.
* Add a product-guidance regression fixture:

  * setup: project creation path was broken or unverified;
  * prohibited answer: "Create a folder under the workspace root and Lamprey will discover it" without code citation or runtime receipt;
  * expected behavior: any user-facing guidance must either cite verified code/runtime behavior or explicitly state uncertainty.
* Ensure mocks follow existing testing conventions.
* Do not reduce existing test coverage.

**Acceptance.**

* The old no-op "+" bug has a direct failing-then-passing test.
* Project creation, persistence, selection, and routing are covered.
* Product guidance cannot ship an unverified workspace-scanning claim.
* Existing suite still passes.
* Lint, tsc node, tsc web, and tests pass.

\---

### PRJ-11 — Project polish and product guardrails

**Goal.** Tighten the user-facing experience and ensure product language matches verified behavior.

**Work.**

* Review the UI flow end-to-end:

  * first-run with no projects,
  * click "+",
  * validation error,
  * successful create,
  * persistence failure,
  * select existing project,
  * invalid project route,
  * reload app.
* Improve copy where needed:

  * no projects,
  * no sessions,
  * duplicate project,
  * storage failure,
  * project not found,
  * path unsupported or not validated.
* Ensure there is no product copy claiming:

  * automatic project discovery,
  * folder scanning,
  * Git import,
  * workspace indexing,
  * cloud sync,
  * template creation,

  unless the behavior is actually implemented in this phase.

* Check visual integration with the current Lamprey panel/sidebar design.
* Check light/dark mode if the app has both.
* Add missing small tests for changed copy or states.

  **Acceptance.**

* The Project section reads as intentional, not bolted on.
* All user-visible failures are specific.
* No unverified product behavior claims remain.
* Light/dark mode remains usable.
* Lint, tsc web, and tests pass.

  \---

  ### PRJ-12 — Project architecture documentation

  **Goal.** Write the maintainer-facing documentation for the Project domain and its extension points.

  **Work.**

* Create `ARCHITECTURE/PROJECTS.md`.
* Include:

  * What a Project is.
  * What a Project is not.
  * Current data model.
  * Persistence location and migration notes.
  * IPC surface.
  * Renderer store.
  * Sidebar flow.
  * Project route/view.
  * Session association.
  * Error handling.
  * Accessibility expectations.
  * How to add future project settings.
  * How to add workspace binding later.
  * How to add project templates later.
  * How to avoid unverified project-discovery claims.
* Reference actual files created by PRJ-1 through PRJ-11.
* Optionally add a short note to `CLAUDE.md` if it is appropriate to inform future coding sessions that this plan is now shipped or active.

  **Acceptance.**

* `ARCHITECTURE/PROJECTS.md` exists.
* The document references real code paths.
* Future maintainers can extend projects without rediscovering the design.
* Lint/tsc are unaffected or still pass.

  \---

  ### PRJ-13 — Phase wrap

  **Goal.** Run the full verification gate, mark the plan complete, and write the phase summary.

  **Work.**

* Run:

  * `npm run lint`
  * `npx tsc --noEmit -p tsconfig.node.json`
  * `npx tsc --noEmit -p tsconfig.web.json`
  * `npm test`
  * `npm run build`
* Manually verify in the app:

  * sidebar "+" opens modal,
  * project name validation works,
  * project creation succeeds,
  * created project appears in sidebar,
  * project is active,
  * project route opens,
  * reload preserves project,
  * old sessions still load,
  * failure states are visible.
* Mark all prompts `\[x]` in this document.
* Append phase-complete entry to `DEVLOG.md`.
* Include:

  * files changed,
  * final verify gate,
  * manual smoke notes,
  * known limitations,
  * deferred follow-up phases.
* Commit the wrap.

  **Acceptance.**

* Full gate passes.
* All prompts are marked `\[x]`.
* DEVLOG phase summary exists.
* User can create and return to projects reliably.
* The left-sidebar "+" is no longer inert.

  \---

  ## 5\. Phase Completion Criteria

  The Project Section phase is complete only when all of the following are true:

* Pressing the left-sidebar "+" opens the New Project modal.
* The "+" control is accessible by keyboard and labeled for assistive technology.
* A user can create a named project.
* Invalid and duplicate project names are rejected.
* Project records persist across app reload.
* Created projects appear in the left sidebar immediately.
* Selecting a project updates active project state.
* A project landing route or equivalent active project view exists.
* The project view shows useful project information and an empty session state.
* New sessions can be associated with the active project, or the foundation for that association is in place without breaking old sessions.
* Existing conversations/sessions continue loading.
* Project errors are visible and specific.
* Tests cover the creation path, sidebar path, persistence path, active selection path, and route/view path.
* Documentation explains the Project domain and future extension points.
* No user-facing copy claims unverified workspace scanning, folder discovery, Git import, cloud sync, or project templates.

  \---

  ## 6\. Non-Goals

  Do not include these in this phase unless the audit proves they already exist and they are required for the minimal Project section:

* Automatic workspace scanning.
* GitHub import.
* Git repository cloning.
* Cloud project sync.
* Multi-user collaboration.
* Project templates.
* Plugin-specific project profiles.
* Complex permission inheritance.
* Repository indexing.
* AI-generated project setup.
* Full project delete/archive UX.
* Drag-and-drop project folders.
* Project sharing.
* Remote project registry.
* Cross-device project sync.
* Migration of every old conversation into inferred projects.

  These are later phases. The first responsibility is to make Project creation real, persisted, visible, selectable, and tested.

  \---

  ## 7\. Risk / Unknown Register

|#|Risk / Unknown|Why it matters|Resolution prompt|
|-|-|-|-|
|1|The sidebar "+" may already be wired to an incomplete or hidden flow.|Avoid duplicate modals or conflicting state paths.|PRJ-0|
|2|There may already be workspace/project concepts under different names.|Avoid creating a parallel Project model that fights existing architecture.|PRJ-0|
|3|The correct storage layer may be SQLite, settings JSON, or another established store.|Wrong persistence choice creates future migration cost.|PRJ-0, PRJ-2|
|4|Project types may need to cross Electron/renderer boundaries cleanly.|Bad type placement causes drift between IPC and UI.|PRJ-1, PRJ-3|
|5|Existing routing may not support `/projects/:projectId` cleanly.|The plan may need an active-view approach instead of a route.|PRJ-0, PRJ-8|
|6|Session/chats may not have an obvious migration point for `projectId`.|Project-scoped sessions must not break old history.|PRJ-0, PRJ-9|
|7|better-sqlite3 test environment may have the existing Electron/Node native binding mismatch noted in prior phases.|Some DB tests may need the repo's established skip/smoke convention.|PRJ-2, PRJ-3, PRJ-9|
|8|Project local path validation may not be available in renderer-safe form.|Do not fake path validation; warn or defer if needed.|PRJ-1, PRJ-5, PRJ-11|
|9|Modal/focus utilities may already exist and should be reused.|Avoid inconsistent UI behavior.|PRJ-5|
|10|Product copy may accidentally imply workspace scanning or project discovery.|This repeats the earlier product-guidance failure mode.|PRJ-10, PRJ-11, PRJ-12|
|11|Project deletion/archive may become tempting during implementation.|Keep first phase narrow and reliable.|All prompts|
|12|A project may be confused with a local workspace folder.|Docs and UI must distinguish current behavior from future workspace binding.|PRJ-11, PRJ-12|



