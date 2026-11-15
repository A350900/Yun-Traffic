// Loads local settings (e.g. OpenSky credentials) from .env before any other
// module reads process.env. Imported first by server/index.ts. .env is never committed.
import { join } from 'node:path'

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'))
} catch {
  /* no .env file: fine */
}
