// scripts/shopify-shop.mjs
// Fetch the shop's name (and a few basic details) using a short-lived
// Admin API token obtained via the client_credentials grant.
//
// Usage: node scripts/shopify-shop.mjs

import { getAccessToken, getStore, maskToken } from './shopify-auth.mjs';

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

async function main() {
  const { access_token, scope, expires_in } = await getAccessToken();
  console.log('🔑 Token acquired:', maskToken(access_token), '| scope:', scope || '(none)', '| expires_in:', `${expires_in}s`);

  const store = getStore();
  const url = `https://${store}/admin/api/${API_VERSION}/graphql.json`;
  const query = `{ shop { name myshopifyDomain primaryDomain { url } plan { displayName } } }`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': access_token,
      Accept: 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Shop query failed (HTTP ${res.status}): ${text}`);

  const json = JSON.parse(text);
  if (json.errors) throw new Error('GraphQL errors: ' + JSON.stringify(json.errors, null, 2));

  const shop = json.data && json.data.shop;
  if (!shop) throw new Error('No shop data returned: ' + text);

  console.log('\n🏬 Shop details:');
  console.log('   name            :', shop.name);
  console.log('   myshopifyDomain :', shop.myshopifyDomain);
  console.log('   primaryDomain   :', shop.primaryDomain && shop.primaryDomain.url);
  console.log('   plan            :', shop.plan && shop.plan.displayName);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
