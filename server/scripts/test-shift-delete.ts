/**
 * Integration smoke test: open shift → delete shift.
 * Run: npx tsx scripts/test-shift-delete.ts
 */
import 'dotenv/config';

const BASE = `http://localhost:${process.env.PORT ?? 4001}`;
const EMAIL = process.env.TEST_OWNER_EMAIL ?? 'owner@example.com';
const PASSWORD = process.env.TEST_OWNER_PASSWORD ?? 'changeme123';

async function json<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(url, init);
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, body };
}

async function main() {
  const login = await json<{ token?: string; error?: string }>(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status !== 200 || !login.body.token) {
    throw new Error(`Login failed (${login.status}): ${login.body.error ?? 'no token'}`);
  }
  const headers = {
    Authorization: `Bearer ${login.body.token}`,
    'Content-Type': 'application/json',
  };

  const staffRes = await json<{ items: Array<{ id: string; name: string; isActive: boolean }> }>(
    `${BASE}/api/settings/staff?visibility=active`,
    { headers },
  );
  const staff = staffRes.body.items.find((s) => s.isActive);
  if (!staff) throw new Error('No active staff');

  const missing = await json<{ error?: string }>(`${BASE}/api/shifts/00000000-0000-0000-0000-000000000099`, {
    method: 'DELETE',
    headers,
  });
  if (missing.status !== 404) {
    throw new Error(`Expected 404 for missing shift, got ${missing.status}`);
  }
  console.log('✓ 404 for missing shift');

  const opened = await json<{ shift: { id: string } }>(`${BASE}/api/shifts/open`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ staffMemberId: staff.id }),
  });
  if (opened.status !== 201) {
    throw new Error(`Open shift failed (${opened.status}): ${JSON.stringify(opened.body)}`);
  }
  const shiftId = opened.body.shift.id;
  console.log(`✓ Created shift ${shiftId}`);

  const deleted = await json<{ ok: boolean }>(`${BASE}/api/shifts/${shiftId}`, {
    method: 'DELETE',
    headers,
  });
  if (deleted.status !== 200 || !deleted.body.ok) {
    throw new Error(`Delete failed (${deleted.status}): ${JSON.stringify(deleted.body)}`);
  }
  console.log('✓ Deleted shift');

  const again = await json<{ error?: string }>(`${BASE}/api/shifts/${shiftId}`, {
    method: 'DELETE',
    headers,
  });
  if (again.status !== 404) {
    throw new Error(`Expected 404 after delete, got ${again.status}`);
  }
  console.log('✓ 404 after delete — all shift-delete integration checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
