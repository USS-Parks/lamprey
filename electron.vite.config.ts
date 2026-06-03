import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'

// Tiny inline .env loader — avoids pulling dotenv as a direct dependency
// just for build-time env loading. Only populates keys that aren't already
// set (real shell env wins). Keys with the LAMPREY_ prefix are exposed to
// the main bundle via the `define` block below; nothing here ever reaches
// the renderer process.
function loadDotEnv(): void {
  const envPath = resolve(__dirname, '.env')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // Bundled GitHub OAuth App credentials. Read from the build environment
    // and replaced into the main bundle as string literals. When unset
    // (local dev without the env vars, or a fork building without the
    // GitHub Actions secrets configured) they become empty strings, which
    // the github-service falls back from to user-saved BYO credentials.
    // Renderer is NOT given these — the main bundle is the only place that
    // ever touches the secret.
    define: {
      'process.env.LAMPREY_GITHUB_CLIENT_ID': JSON.stringify(
        process.env.LAMPREY_GITHUB_CLIENT_ID ?? ''
      ),
      'process.env.LAMPREY_GITHUB_CLIENT_SECRET': JSON.stringify(
        process.env.LAMPREY_GITHUB_CLIENT_SECRET ?? ''
      )
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts')
        },
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: {
      alias: {
        '@': resolve('src'),
        '@assets': resolve('ASSETS')
      }
    },
    server: {
      fs: {
        allow: [resolve(__dirname)]
      }
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html')
        }
      }
    }
  }
})
