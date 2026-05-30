import { BrowserWindow, WebContentsView, app } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'

// In dev, vendor lives under <repo>/resources/vendor relative to the app path.
// In production, electron-builder's extraResources mapping (from: resources/vendor → to: vendor)
// places it directly under process.resourcesPath/vendor.
const VENDOR_DIR = app.isPackaged
  ? join(process.resourcesPath, 'vendor')
  : join(app.getAppPath(), 'resources', 'vendor')

function vendorFileUrl(filename: string): string {
  return `file:///${VENDOR_DIR.replace(/\\/g, '/')}/${filename}`
}

const CSP = "default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'self' data:;"

function buildHtmlDoc(type: string, content: string): string {
  switch (type) {
    case 'html': {
      if (content.includes('<head>')) {
        return content.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`)
      }
      if (content.includes('<html')) {
        return content.replace(/<html([^>]*)>/, `<html$1><head><meta http-equiv="Content-Security-Policy" content="${CSP}"></head>`)
      }
      return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>body{margin:0;background:#1a1a2e;color:#e8e8e8;font-family:system-ui,sans-serif}</style></head><body>${content}</body></html>`
    }

    case 'svg':
      return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a2e}svg{max-width:100%;max-height:100vh}</style></head><body>${content}</body></html>`

    case 'mermaid':
      return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'self' data:;">
<style>body{margin:0;padding:16px;background:#1a1a2e;color:#e8e8e8;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 32px)}</style>
</head><body>
<pre class="mermaid">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
<script src="${vendorFileUrl('mermaid.min.js')}"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'dark'});</script>
</body></html>`

    case 'jsx': {
      const escaped = content.replace(/<\/script>/gi, '<\\/script>')
      return `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'self' data:;">
<style>body{margin:0;background:#1a1a2e;color:#e8e8e8;font-family:system-ui,sans-serif}#root{padding:16px}</style>
</head><body>
<div id="root"></div>
<script src="${vendorFileUrl('react-shim.js')}"></script>
<script src="${vendorFileUrl('babel.standalone.min.js')}"></script>
<script type="text/babel" data-type="module">
${escaped}

// Auto-render: find the default export or last component
try {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  if (typeof App !== 'undefined') root.render(React.createElement(App));
  else if (typeof default_1 !== 'undefined') root.render(React.createElement(default_1));
} catch(e) { document.getElementById('root').textContent = e.message; }
</script>
</body></html>`
    }

    default:
      return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>body{margin:0;padding:16px;background:#1a1a2e;color:#e8e8e8;font-family:monospace;white-space:pre-wrap}</style></head><body>${content.replace(/</g, '&lt;')}</body></html>`
  }
}

let view: WebContentsView | null = null
let currentSource = ''
let currentType = ''

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

export function render(type: string, content: string): void {
  const win = getMainWindow()
  if (!win) return

  currentSource = content
  currentType = type

  const htmlDoc = buildHtmlDoc(type, content)
  const tempPath = join(app.getPath('temp'), 'lamprey-artifact.html')
  writeFileSync(tempPath, htmlDoc, 'utf-8')

  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        allowRunningInsecureContent: false,
        webSecurity: true,
      },
    })
    win.contentView.addChildView(view)
  }

  view.webContents.loadFile(tempPath)
}

export function setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  if (!view) return
  view.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  })
}

export function show(): void {
  if (!view) return
  view.setVisible(true)
}

export function hide(): void {
  if (view) {
    view.setVisible(false)
  }
}

export function destroy(): void {
  if (view) {
    const win = getMainWindow()
    if (win) {
      win.contentView.removeChildView(view)
    }
    view.webContents.close()
    view = null
  }
  currentSource = ''
  currentType = ''
}

export function openInWindow(type: string, content: string): void {
  const htmlDoc = buildHtmlDoc(type, content)
  const tempPath = join(app.getPath('temp'), 'lamprey-artifact-window.html')
  writeFileSync(tempPath, htmlDoc, 'utf-8')

  const artifactWin = new BrowserWindow({
    width: 800,
    height: 600,
    title: `Artifact — ${type}`,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
  })
  artifactWin.loadFile(tempPath)
}

export function getSource(): string {
  return currentSource
}

export function getType(): string {
  return currentType
}

export function isVisible(): boolean {
  return view !== null
}
