// scripts/shopify-auth.mjs
// Exchange Shopify app client credentials for a short-lived Admin API access token.
//
// SECURITY:
//   - Credentials are read from ../.env (which is gitignored).
//   - The client secret is NEVER printed. A scrub() guard also redacts it from
//     any error text, and the access token is masked when logged.
//
// Usage:
//   node scripts/shopify-auth.mjs        # prints token metadata (masked)
//   import { getAccessToken } ...         # use programmatically

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

function loadEnv(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read ${path} — is the .env file present?`);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = loadEnv(ENV_PATH);
const CLIENT_ID = env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET;
// Optional custom-app Admin API token (shpat_...). If present, it is used
// directly and the client_credentials grant is skipped entirely.
const DIRECT_TOKEN = (env.SHOPIFY_ACCESS_TOKEN || '').trim();

// Normalize whatever is in SHOPIFY_STORE down to a bare host, e.g.
// "https://foo.myshopify.com/" -> "foo.myshopify.com"
export function getStore() {
  let store = (env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!store) throw new Error('SHOPIFY_STORE is not set in .env');
  if (!store.endsWith('.myshopify.com')) {
    console.warn(`⚠️  SHOPIFY_STORE="${store}" is not a *.myshopify.com domain; the OAuth endpoint may reject it.`);
  }
  return store;
}

// Redact any known secret (client secret or direct token) from a string so it
// can never leak into logs or errors.
function scrub(text) {
  let t = String(text);
  for (const secret of [CLIENT_SECRET, DIRECT_TOKEN]) {
    if (secret) t = t.split(secret).join('***REDACTED***');
  }
  return t;
}

export function maskToken(token) {
  if (!token || token.length < 12) return '***';
  return `${token.slice(0, 6)}…${token.slice(-4)} (${token.length} chars)`;
}

export async function getAccessToken() {
  // Preferred path for your own live store: a custom-app token from the admin.
  if (DIRECT_TOKEN) {
    return { access_token: DIRECT_TOKEN, scope: '(custom app token)', expires_in: null, source: 'direct' };
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('SHOPIFY_CLIENT_ID and/or SHOPIFY_CLIENT_SECRET missing from .env');
  }
  const store = getStore();
  const url = `https://${store}/admin/oauth/access_token`;

  // Body is form-encoded per the docs; using fetch keeps the secret off argv.
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
  } catch (e) {
    throw new Error(scrub(`Network error contacting ${url}: ${e.message}`));
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(scrub(`Token request failed (HTTP ${res.status}): ${text}`));
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(scrub(`Unexpected non-JSON response: ${text}`));
  }
  if (!json.access_token) {
    throw new Error(scrub(`No access_token in response: ${text}`));
  }
  return json; // { access_token, scope, expires_in }
}

// When run directly: print token metadata only (secret never shown, token masked).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  getAccessToken()
    .then((tok) => {
      const via = tok.source === 'direct' ? 'direct custom-app token (SHOPIFY_ACCESS_TOKEN)' : 'client_credentials grant';
      console.log(`✅ Access token obtained via ${via}`);
      console.log('   store      :', getStore());
      console.log('   token      :', maskToken(tok.access_token));
      console.log('   scope      :', tok.scope || '(none reported)');
      console.log('   expires_in :', tok.expires_in == null ? 'n/a (long-lived custom-app token)' : `${tok.expires_in} seconds (~${Math.round(tok.expires_in / 3600)}h)`);
    })
    .catch((err) => {
      console.error('❌', err.message);
      process.exit(1);
    });
}
