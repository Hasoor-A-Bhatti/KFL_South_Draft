// Loads .env.local / .env into process.env (without overriding real env vars).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(root) {
  for (const name of ['.env.local', '.env']) {
    const file = resolve(root, name);
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '');
      if (process.env[m[1]] === undefined || process.env[m[1]] === '') process.env[m[1]] = value;
    }
  }
}
