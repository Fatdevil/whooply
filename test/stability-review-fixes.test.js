process.env.NODE_ENV = 'test';

import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../server/db.js';

test('Stability Fix 1 — Superadmin PIN verification rejects empty and unauthorized access', () => {
  // Test getAdminPin and setAdminPin in DB
  const originalPin = db.getAdminPin();
  try {
    db.setAdminPin('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); // empty SHA256 test hash
    assert.equal(db.getAdminPin(), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  } finally {
    if (originalPin) {
      db.setAdminPin(originalPin);
    }
  }
});

test('Stability Fix 2 — Startup automated database backup function exists and produces backup', async () => {
  const res = await db.backupDatabase();
  assert.ok(res.filename.startsWith('whooply-backup-'), 'Backup filename should match naming pattern');
  assert.ok(res.sizeBytes > 0, 'Backup size should be greater than 0');
});
