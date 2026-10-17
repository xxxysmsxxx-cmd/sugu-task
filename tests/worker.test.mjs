import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('anonymous session is not authenticated', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/session'), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
});

test('task API rejects unauthenticated reads and writes', async () => {
  for (const method of ['GET', 'POST']) {
    const response = await worker.fetch(new Request('https://example.com/api/tasks', { method }), {});
    assert.equal(response.status, 401);
  }
});

test('Google login requires configured credentials', async () => {
  const response = await worker.fetch(new Request('https://example.com/auth/google'), {});
  assert.equal(response.status, 503);
});

test('Google callback rejects missing state', async () => {
  const response = await worker.fetch(new Request('https://example.com/auth/callback?code=abc&state=xyz'), {});
  assert.equal(response.status, 400);
});
