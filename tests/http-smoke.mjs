import assert from 'node:assert/strict';

const base = process.env.JCHURCH_URL ?? 'http://localhost:7071/api/v1';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Synthetic smoke tests only run against localhost.');

async function api(path, method = 'GET', body, expected = 200, etag) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(etag ? { 'If-Match': etag } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const value = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}

assert.equal((await api('/health')).status, 'ok');
const church = await api('/churches', 'POST', { name: 'Synthetic smoke church' }, 201);
const other = await api('/churches', 'POST', { name: 'Synthetic second church' }, 201);
const root = `/churches/${church.id}`;
const group = await api(`${root}/groups`, 'POST', { name: 'Adults' }, 201);
const subgroup = await api(`${root}/groups`, 'POST', { name: 'Class', parentGroupId: group.id }, 201);
await api(`${root}/groups`, 'POST', { name: 'Invalid depth', parentGroupId: subgroup.id }, 400);
const field = await api(`${root}/custom-fields`, 'POST', { name: 'Volunteer', fieldType: 'boolean' }, 201);
const memberInput = { firstName: 'Synthetic', lastName: 'Member', groupIds: [group.id, subgroup.id], customFields: { [field.id]: true } };
const member = await api(`${root}/members`, 'POST', memberInput, 201);
await api(`${root}/members`, 'POST', { ...memberInput, customFields: { [field.id]: 'wrong type' } }, 400);
await api(`/churches/${other.id}/members`, 'POST', memberInput, 404);
await api(`${root}/members/${member.id}`, 'PUT', memberInput, 428);
const updated = await api(`${root}/members/${member.id}`, 'PUT', { ...memberInput, school: 'Synthetic School' }, 200, member._etag);
await api(`${root}/members/${member.id}`, 'PUT', memberInput, 412, member._etag);
assert.notEqual(updated._etag, member._etag);

const now = new Date();
const localStart = new Date(now.getTime() + 10 * 60000).toISOString().replace('Z', '');
const event = await api(`${root}/events`, 'POST', { name: 'Synthetic service', localStart, timeZone: 'UTC', durationMinutes: 60 }, 201);
const generated = await api(`${root}/events/${event.id}/occurrences`, 'POST');
assert.ok(generated.occurrence);
assert.equal((await api(`${root}/events/${event.id}/occurrences`, 'POST')).occurrence, null);
const occurrence = generated.occurrence;
const checkInPath = `${root}/occurrences/${occurrence.id}/check-ins`;
const responses = await Promise.all(Array.from({ length: 100 }, async () => {
  const response = await fetch(`${base}${checkInPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: member.id }), signal: AbortSignal.timeout(30000) });
  assert.ok(response.status === 200 || response.status === 201, `Check-in returned ${response.status}`);
  return { status: response.status, receipt: await response.json() };
}));
assert.equal(responses.filter(response => response.status === 201).length, 1);
assert.equal(new Set(responses.map(response => response.receipt.id)).size, 1);
assert.equal((await api(`${checkInPath}/${member.id}`)).checkedIn, true);
assert.deepEqual((await api(`${root}/events/${event.id}/occurrence-check-in-counts`)).items, [{ occurrenceId: occurrence.id, checkedInCount: 1 }]);
assert.equal((await api(`${checkInPath}/${member.id}`, 'DELETE')).undone, true);
assert.equal((await api(`${checkInPath}/${member.id}`)).checkedIn, false);
assert.deepEqual((await api(`${root}/events/${event.id}/occurrence-check-in-counts`)).items, []);
assert.equal((await api(checkInPath, 'POST', { memberId: member.id }, 201)).memberId, member.id);
assert.deepEqual((await api(`${root}/events/${event.id}/occurrence-check-in-counts`)).items, [{ occurrenceId: occurrence.id, checkedInCount: 1 }]);
await api(`/churches/${other.id}/occurrences/${occurrence.id}/check-ins`, 'POST', { memberId: member.id }, 404);
await api(`${root}/members/${member.id}`, 'PUT', { ...memberInput, groupIds: [] }, 200, updated._etag);
const report = await api(`${root}/attendance?groupId=${group.id}&includeSubgroups=true`);
assert.equal(report.items.length, 1);
assert.deepEqual(new Set(report.items[0].groupIds), new Set([group.id, subgroup.id]));
assert.equal((await api(`${root}/attendance?memberId=${member.id}&eventId=${event.id}`)).items.length, 1);
await api(`${root}/attendance?from=2020-01-01&to=2026-01-01`, 'GET', undefined, 400);
const first = await api(`${root}/groups?pageSize=1`);
const second = await api(`${root}/groups?pageSize=1&continuationToken=${encodeURIComponent(first.continuationToken)}`);
assert.notEqual(first.items[0].id, second.items[0].id);
await api(`${root}/groups/${group.id}`, 'DELETE', undefined, 409, group._etag);
await api(`${root}/groups/${subgroup.id}`, 'DELETE', undefined, 204, subgroup._etag);
await api(`${root}/groups/${group.id}`, 'DELETE', undefined, 204, group._etag);
assert.equal((await api(`${root}/attendance?groupId=${group.id}&includeSubgroups=true`)).items.length, 1);
assert.equal((await api('/openapi.json')).openapi, '3.0.3');
const scanInput = { firstName: 'Synthetic', lastName: 'Scanner', scanCode: '0000-scan-original', scanCodeFormat: 'qr' };
let scanMember = await api(`${root}/members`, 'POST', scanInput, 201);
assert.equal(scanMember.scanCode, '0000-SCAN-ORIGINAL');
assert.equal((await api(`${root}/members`)).items.find(item => item.id === scanMember.id).scanCode, null);
await api(`${root}/members`, 'POST', { ...scanInput, lastName: 'Collision' }, 409);
const futureStart = new Date(Date.now() + 86400000).toISOString().replace('Z', '');
const futureEvent = await api(`${root}/events`, 'POST', { name: 'Synthetic scan future', localStart: futureStart, timeZone: 'UTC', durationMinutes: 60 }, 201);
await api(`${root}/events/${futureEvent.id}/occurrences`, 'POST');
const futureOccurrence = (await api(`${root}/events/${futureEvent.id}/occurrences`)).items[0];
const scanPath = `${root}/occurrences/${futureOccurrence.id}/scan-check-ins`;
const firstScan = await api(scanPath, 'POST', { scanCode: ' 0000-scan-original\r\n' }, 201);
assert.equal(firstScan.member.id, scanMember.id);
assert.equal((await api(scanPath, 'POST', { scanCode: scanInput.scanCode })).already, true);
assert.equal((await api(`${scanPath}/status`, 'POST', { scanCode: scanInput.scanCode })).checkedIn, true);
assert.equal((await api(`${root}/occurrences/${futureOccurrence.id}/check-ins`, 'POST', { memberId: scanMember.id })).id, firstScan.receipt.id);
scanMember = await api(`${root}/members/${scanMember.id}`, 'PUT', { firstName: 'Legacy', lastName: 'Edit' }, 200, scanMember._etag);
assert.equal(scanMember.scanCode, '0000-SCAN-ORIGINAL');
const staleTag = scanMember._etag;
scanMember = await api(`${root}/members/${scanMember.id}`, 'PUT', { ...scanInput, scanCode: '0000-scan-replaced', scanCodeFormat: 'code128' }, 200, scanMember._etag);
await api(`${root}/members/${scanMember.id}`, 'PUT', { ...scanInput, scanCode: '0000-scan-stale' }, 412, staleTag);
await api(scanPath, 'POST', { scanCode: scanInput.scanCode }, 404);
await api(scanPath, 'POST', { scanCode: '0000-scan-stale' }, 404);
assert.equal((await api(scanPath, 'POST', { scanCode: scanMember.scanCode })).receipt.id, firstScan.receipt.id);
await api(`/churches/${other.id}/occurrences/${futureOccurrence.id}/scan-check-ins`, 'POST', { scanCode: scanMember.scanCode }, 404);
await api(`${root}/occurrences/${futureOccurrence.id}`, 'PUT', { startsAt: futureOccurrence.startsAt, endsAt: futureOccurrence.endsAt, cancelled: true, archived: false }, 200, futureOccurrence._etag);
const cancelledMember = await api(`${root}/members`, 'POST', { ...scanInput, scanCode: '0000-scan-cancelled' }, 201);
await api(scanPath, 'POST', { scanCode: cancelledMember.scanCode }, 409);
await api(scanPath, 'POST', { scanCode: 'https://invalid' }, 400);
scanMember = await api(`${root}/members/${scanMember.id}`, 'PUT', { ...scanInput, scanCode: null }, 200, scanMember._etag);
assert.equal(scanMember.scanCode, null);
await api(scanPath, 'POST', { scanCode: '0000-scan-replaced' }, 404);
await api(root, 'DELETE', undefined, 204, church._etag);
await api(`/churches/${other.id}`, 'DELETE', undefined, 204, other._etag);
console.log('HTTP smoke passed: directory, ETags, isolation, 100 duplicate check-ins, scan assignment/reissue, legacy updates, scan receipts/status, cancellation, reporting, archival, and OpenAPI.');