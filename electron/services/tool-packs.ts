// Side-effect bootstrap for the bundled native tool packs.
//
// Each `./xxx-tool-pack` import has no exports — it runs `toolRegistry.registerNative(...)`
// as a top-level side effect to publish its descriptor + handler. Those
// registrations have to happen after `tool-registry.ts` has finished
// evaluating (specifically: after `export const toolRegistry = new ToolRegistry()`
// has assigned the binding).
//
// Keeping the imports in a separate module — rather than at the bottom of
// `tool-registry.ts` — guarantees the bundler cannot hoist them above the
// registry construction. With them inside `tool-registry.ts`, an
// ES-module bundler can emit the side-effect imports before the
// `new ToolRegistry()` line and crash on startup with
// "ReferenceError: Cannot access 'toolRegistry' before initialization".
//
// Imported by `electron/ipc/index.ts` so the packs are loaded once before
// chat dispatch can expose tools. Keep this module limited to descriptor
// registration; startup work that touches app-ready Electron APIs or starts
// child processes belongs in explicit app-ready calls from main.ts.

import './apply-patch-tool-pack'
import './native-dev-tool-pack'
import './workspace-context-tool-pack'
import './verify-workspace-tool-pack'
import './browser-tool-pack'
import './frontend-qa-tool-pack'
import './web-tool-pack'
import './current-info-tool-pack'
import './image-generation-tool-pack'
import './multi-agent-run-tool-pack'
import './spawn-task-tool-pack'
import './loop-tool-pack'
import './notifications-tool-pack'
