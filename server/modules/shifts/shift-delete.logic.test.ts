/**
 * Run: npm run test:shift-delete
 */
import assert from 'node:assert/strict';
import { assessShiftDeletion } from './shift-delete.logic';

console.log('shift-delete.logic tests');

{
  const r = assessShiftDeletion({ sessionCount: 0 });
  assert.equal(r.canDelete, true);
  assert.equal(r.detachSessions, 0);
  assert.deepEqual(r.blockers, []);
}

{
  const r = assessShiftDeletion({ sessionCount: 3 });
  assert.equal(r.canDelete, true);
  assert.equal(r.detachSessions, 3);
}

console.log('All shift-delete.logic tests passed.');
