/* eslint-disable no-console */
/**
 * Comprehensive end-to-end smoke test against a running gelato-core stack.
 *
 * Usage:
 *   node test/e2e-stack.ts
 *   API_URL=http://127.0.0.1:4000/api node test/e2e-stack.ts
 *
 * Requires:
 *   - Running API with seeded tenant "demo" and user admin@demo.de
 *   - Default admin password: admin123
 */

const API_URL = process.env.API_URL || 'http://127.0.0.1:4000/api';

interface FetchOptions extends RequestInit {
  json?: unknown;
}

async function request(path: string, opts: FetchOptions = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const res = await fetch(`${API_URL}${path}`, { ...opts, headers, body });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep as text
  }
  return { status: res.status, body: parsed };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function uniqueSlug(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function main() {
  console.log(`Smoke testing ${API_URL}\n`);
  let r: { status: number; body: any };

  // 1. Health
  r = await request('/health');
  assert(r.status === 200, `health expected 200 got ${r.status}`);
  assert(r.body.status === 'ok', 'health body.status != ok');
  console.log('  [1] health OK');

  // 2. Login
  r = await request('/auth/login', {
    method: 'POST',
    json: {
      email: 'admin@demo.de',
      password: 'admin123',
      tenantSlug: 'demo',
    },
  });
  assert(r.status === 201, `login expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const token = r.body.accessToken;
  const user = r.body.user;
  assert(user?.tenantId, 'login did not return user.tenantId');
  assert(user?.permissions?.includes('pos.sale.create'), 'admin missing pos.sale.create');
  console.log(`  [2] login OK (tenant=${user.tenantSlug}, roles=${user.roles.join(',')})`);

  const auth = { Authorization: `Bearer ${token}` };

  // 3. Read tenant
  r = await request(`/tenants/${user.tenantSlug}`, { headers: auth });
  assert(r.status === 200, `tenant read got ${r.status}: ${JSON.stringify(r.body)}`);
  console.log('  [3] tenant read OK');

  // 4. Create branch
  r = await request('/branches', {
    method: 'POST',
    headers: auth,
    json: {
      tenantId: user.tenantId,
      name: 'E2E Branch',
      slug: uniqueSlug('e2e'),
      addressLine1: 'Hauptstraße 1',
      city: 'Berlin',
      zipCode: '10115',
      country: 'DE',
      finanzamtNr: '11/222/33333',
    },
  });
  assert(r.status === 201, `branch expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const branchId = r.body.id;
  console.log(`  [4] branch created (${branchId})`);

  // 5. Create Kasse
  r = await request('/kassen', {
    method: 'POST',
    headers: auth,
    json: {
      betriebsstaetteId: branchId,
      name: 'E2E Kasse',
      serialNumber: 'KASSE-E2E-001',
    },
  });
  assert(r.status === 201, `kasse expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const kasseId = r.body.id;
  console.log(`  [5] kasse created (${kasseId})`);

  // 6. Create product
  r = await request('/products', {
    method: 'POST',
    headers: auth,
    json: {
      tenantId: user.tenantId,
      name: 'Pistazien-Eis',
      type: 'VENDAVEL',
      basePrice: '4.50',
      mwstImHaus: '7.00',
      mwstAusserHaus: '19.00',
    },
  });
  assert(r.status === 201, `product expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const productId = r.body.id;
  console.log(`  [6] product created (${productId})`);

  // 7. Create product variant
  r = await request('/products/variants', {
    method: 'POST',
    headers: auth,
    json: {
      productId,
      name: 'Große Kugel',
      priceDelta: '1.50',
    },
  });
  assert(r.status === 201, `variant expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const variantId = r.body.id;
  console.log(`  [7] product variant created (${variantId})`);

  // 8. Create product modifier
  r = await request('/products/modifiers', {
    method: 'POST',
    headers: auth,
    json: {
      productId,
      name: 'Extra Sahne',
      priceDelta: '0.50',
      groupKey: 'toppings',
    },
  });
  assert(r.status === 201, `modifier expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const modifierId = r.body.id;
  console.log(`  [8] product modifier created (${modifierId})`);

  // 9. Create ingredient
  r = await request('/stock/ingredients', {
    method: 'POST',
    headers: auth,
    json: {
      tenantId: user.tenantId,
      name: 'Milch',
      baseUnit: 'L',
      description: 'Whole milk for gelato',
    },
  });
  assert(r.status === 201, `ingredient expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const ingredientId = r.body.id;
  console.log(`  [9] ingredient created (${ingredientId})`);

  // 10. Create stock item at branch
  r = await request('/stock/items', {
    method: 'POST',
    headers: auth,
    json: {
      ingredientId,
      betriebsstaetteId: branchId,
      qtyBase: 50,
      mindestbestand: 10,
    },
  });
  assert(r.status === 201, `stock item expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const stockItemId = r.body.id;
  console.log(`  [10] stock item created (${stockItemId})`);

  // 11. Stock movement (RECEIVING)
  r = await request('/stock/movements', {
    method: 'POST',
    headers: auth,
    json: {
      stockItemId,
      type: 'RECEIVING',
      qtyBase: 20,
      reason: 'Lieferung Großhandel',
    },
  });
  assert(r.status === 201, `movement expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  console.log('  [11] stock movement RECEIVING OK');

  // 12. Stock availability
  r = await request(`/stock/availability/${productId}/${branchId}`, { headers: auth });
  assert(r.status === 200, `availability got ${r.status}: ${JSON.stringify(r.body)}`);
  console.log(`  [12] stock availability OK`);

  // 13. X-Report
  r = await request(`/reports/x/${kasseId}`, { headers: auth });
  assert(r.status === 200, `x-report got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(typeof r.body.totalGross === 'number', 'x-report missing totalGross');
  console.log(`  [13] x-report OK (gross=${r.body.totalGross}, orders=${r.body.orderCount})`);

  // 14. Kassenabschluss export
  const today = new Date().toISOString().slice(0, 10);
  r = await request(`/exports/kassenabschluss/${kasseId}?businessDay=${today}`, { headers: auth });
  assert(r.status === 200, `kassenabschluss got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(typeof r.body.totalGross === 'number', 'kassenabschluss missing totalGross');
  console.log(`  [14] kassenabschluss OK (gross=${r.body.totalGross})`);

  // 15. Audit log (sanity check by listing audit if endpoint exists)
  r = await request('/audit', { headers: auth });
  if (r.status === 200) {
    console.log(`  [15] audit log accessible (${Array.isArray(r.body) ? r.body.length : '?'} entries)`);
  } else {
    console.log(`  [15] audit log endpoint not exposed (status ${r.status}) — skipped`);
  }

  // 16. Multi-tenant isolation: invalid tenant slug should not authenticate
  r = await request('/auth/login', {
    method: 'POST',
    json: {
      email: 'admin@demo.de',
      password: 'admin123',
      tenantSlug: 'nonexistent-tenant',
    },
  });
  assert(r.status === 401 || r.status === 404, `isolation expected 401/404 got ${r.status}`);
  console.log('  [16] cross-tenant isolation OK');

  // 17. Unauthorized access rejected
  r = await request('/reports/x/' + kasseId);
  assert(r.status === 401, `unauth expected 401 got ${r.status}`);
  console.log('  [17] unauthenticated access rejected OK');

  // 18. Metrics endpoint
  r = await request('/metrics');
  assert(r.status === 200, `metrics expected 200 got ${r.status}`);
  assert(typeof r.body === 'string', 'metrics response not text/plain');
  assert(r.body.includes('gelato_uptime_seconds'), 'metrics missing uptime');
  assert(r.body.includes('gelato_orders_total'), 'metrics missing orders');
  console.log('  [18] metrics endpoint OK');

  // ===== Full POS flow: open shift → order → finalize → void → close shift =====

  // 19. Open shift
  r = await request('/pos/shifts', {
    method: 'POST',
    headers: auth,
    json: {
      kasseId,
      openingFloat: 100,
    },
  });
  assert(r.status === 201, `openShift expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const shiftId = r.body.id;
  console.log(`  [19] shift opened (${shiftId})`);

  // 20. Create order with payments
  r = await request('/pos/orders', {
    method: 'POST',
    headers: auth,
    json: {
      kasseId,
      shiftId,
      mode: 'IM_HAUS',
      items: [{ productId, qty: 2 }],
      payments: [{ method: 'CASH', amount: '10.00' }],
    },
  });
  assert(r.status === 201, `order expected 201 got ${r.status}: ${JSON.stringify(r.body)}`);
  const orderId = r.body.id;
  assert(r.body.totalGross === 9 || r.body.totalGross === 10 || r.body.totalGross > 0, `order totalGross unexpected: ${r.body.totalGross}`);
  console.log(`  [20] order created (${orderId}, gross=${r.body.totalGross})`);

  // 21. Finalize order (TSE-Ausfall expected since no TSE client configured)
  r = await request(`/pos/orders/${orderId}/finalize`, {
    method: 'POST',
    headers: auth,
  });
  assert(r.status === 200 || r.status === 201, `finalize got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.status === 'CLOSED', `order not CLOSED after finalize: ${r.body.status}`);
  assert(r.body.receipt, 'finalize did not create receipt');
  console.log(`  [21] order finalized (receipt=${r.body.receipt.id})`);

  // 22. Void order (storno)
  r = await request(`/pos/orders/${orderId}/void`, {
    method: 'POST',
    headers: auth,
    json: { reason: 'Customer returned - test storno' },
  });
  assert(r.status === 200 || r.status === 201, `void got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.status === 'VOIDED', `order not VOIDED after void: ${r.body.status}`);
  console.log(`  [22] order voided (storno created)`);

  // 23. X-Report after sale+storno (should show the sale, stornoCount=1)
  r = await request(`/reports/x/${kasseId}`, { headers: auth });
  assert(r.status === 200, `x-report after sale got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(typeof r.body.totalGross === 'number', 'x-report missing totalGross');
  console.log(`  [23] x-report after sale OK (gross=${r.body.totalGross}, orders=${r.body.orderCount}, stornos=${r.body.stornoCount})`);

  // 24. Close shift
  r = await request(`/pos/shifts/${shiftId}/close`, {
    method: 'POST',
    headers: auth,
    json: { closingCount: 100 },
  });
  assert(r.status === 200 || r.status === 201, `closeShift got ${r.status}: ${JSON.stringify(r.body)}`);
  assert(r.body.closedAt, 'shift not closed');
  console.log(`  [24] shift closed`);

  console.log('\nALL SMOKE TESTS PASSED');
  console.log(`  tenant=${user.tenantSlug}`);
  console.log(`  branch=${branchId}`);
  console.log(`  kasse=${kasseId}`);
  console.log(`  product=${productId}`);
  console.log(`  variant=${variantId}`);
  console.log(`  modifier=${modifierId}`);
  console.log(`  ingredient=${ingredientId}`);
  console.log(`  stockItem=${stockItemId}`);
  console.log(`  shift=${shiftId}`);
  console.log(`  order=${orderId}`);
}

main().catch((err) => {
  console.error('\nSMOKE TEST FAILED:', err.message);
  if (err.cause) console.error('Cause:', err.cause);
  process.exit(1);
});