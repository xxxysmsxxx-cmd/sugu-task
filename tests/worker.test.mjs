import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/worker.js';

const secret = 'test-secret-at-least-thirty-two-characters';
function auth(sub) {
  const payload = Buffer.from(JSON.stringify({ sub, email: `${sub}@example.com`, name: sub, exp: Date.now() + 60000 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `sugu_session=${payload}.${signature}`;
}
function mockDB() {
  const rows = [];
  return { prepare(sql) { let args; return { bind(...values) { args = values; return this; },
    async all() { return { results: rows.filter(row => row.user_id === args[0]).map(({ user_id, ...rest }) => rest) }; },
    async first() { const row = rows.find(row => row.id === args[0] && row.user_id === args[1]); if (!row) return null; const { user_id, ...rest } = row; return rest; },
    async run() {
      if (sql.startsWith('INSERT')) { const [id,user_id,title,note,status,due_date,created_at,updated_at] = args; rows.push({id,user_id,title,note,status,due_date,created_at,updated_at}); return { meta: { changes: 1 } }; }
      if (sql.startsWith('UPDATE')) { const row=rows.find(row => row.id===args[2] && row.user_id===args[3]); if (!row) return {meta:{changes:0}}; row.status=args[0];row.updated_at=args[1];return {meta:{changes:1}}; }
      if (sql.startsWith('DELETE')) { const index=rows.findIndex(row => row.id===args[0] && row.user_id===args[1]); if(index<0)return {meta:{changes:0}};rows.splice(index,1);return {meta:{changes:1}}; }
    }
  }; } };
}

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

test('task CRUD enforces owner and same-origin writes', async () => {
  const env = { SESSION_SECRET: secret, DB: mockDB() };
  const req = (path, method, sub, body, origin = 'https://example.com') => new Request(`https://example.com${path}`, { method, headers: { cookie: auth(sub), origin, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let response = await worker.fetch(req('/api/tasks','POST','alice',{title:'  会議資料を確認  '}),env);
  assert.equal(response.status,201); const task=await response.json(); assert.equal(task.title,'会議資料を確認');
  response = await worker.fetch(req('/api/tasks','GET','bob'),env); assert.deepEqual(await response.json(),[]);
  response = await worker.fetch(req(`/api/tasks/${task.id}`,'PATCH','bob',{status:'done'}),env); assert.equal(response.status,404);
  response = await worker.fetch(req(`/api/tasks/${task.id}`,'PATCH','alice',{status:'doing'},'https://evil.example'),env); assert.equal(response.status,403);
  response = await worker.fetch(req(`/api/tasks/${task.id}`,'PATCH','alice',{status:'doing'}),env); assert.equal((await response.json()).status,'doing');
  response = await worker.fetch(req(`/api/tasks/${task.id}`,'DELETE','alice'),env); assert.equal(response.status,200);
  response = await worker.fetch(req('/api/tasks','GET','alice'),env); assert.deepEqual(await response.json(),[]);
});
