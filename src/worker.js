const enc = new TextEncoder();
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const bad = (message, status = 400) => json({ error: message }, status);
const cookie = (request, name) => request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const secureCookie = (name, value, age, path = '/') => `${name}=${value}; Max-Age=${age}; Path=${path}; HttpOnly; Secure; SameSite=Lax`;
const required = (env) => env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
async function session(request, env) {
  const raw = cookie(request, 'sugu_session'); if (!raw || !env.SESSION_SECRET) return null;
  const [payload, signature] = raw.split('.'); if (!payload || !signature || signature !== await hmac(env.SESSION_SECRET, payload)) return null;
  try { const data = JSON.parse(new TextDecoder().decode(unb64(payload))); return data.exp > Date.now() && typeof data.sub === 'string' ? data : null; } catch { return null; }
}
async function signSession(user, secret) {
  const payload = b64(enc.encode(JSON.stringify({ sub: user.sub, email: user.email, name: user.name, exp: Date.now() + 30 * 86400_000 })));
  return `${payload}.${await hmac(secret, payload)}`;
}
async function verifyGoogleToken(token, clientId, nonce) {
  const [head, body, signature] = token.split('.'); if (!signature) throw Error('Invalid ID token');
  const header = JSON.parse(new TextDecoder().decode(unb64(head)));
  const claims = JSON.parse(new TextDecoder().decode(unb64(body)));
  if (header.alg !== 'RS256' || !header.kid || claims.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.exp * 1000 <= Date.now() || claims.nonce !== nonce || !claims.sub || !claims.email_verified) throw Error('Invalid ID token claims');
  const keysResponse = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!keysResponse.ok) throw Error('Google keys unavailable');
  const { keys } = await keysResponse.json(); const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA'); if (!jwk) throw Error('Google key unavailable');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(signature), enc.encode(`${head}.${body}`));
  if (!valid) throw Error('Invalid ID token signature');
  return { sub: claims.sub, email: claims.email, name: claims.name || claims.email };
}
async function googleStart(request, env) {
  if (!required(env)) return bad('Googleログインの設定が未完了です', 503);
  const state = random(), nonce = random(), verifier = random();
  const challenge = b64(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
  const url = new URL(request.url); const redirect = `${url.origin}/auth/callback`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  const response = new Response(null, { status: 302, headers: { location: auth.toString() } });
  response.headers.append('set-cookie', secureCookie('sugu_oauth', `${state}.${nonce}.${verifier}`, 600, '/auth'));
  return response;
}
async function googleCallback(request, env) {
  const url = new URL(request.url); const [state, nonce, verifier] = (cookie(request, 'sugu_oauth') || '').split('.');
  if (!state || url.searchParams.get('state') !== state || !nonce || !verifier || !url.searchParams.get('code')) return bad('ログインを確認できませんでした', 400);
  const tokensResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/auth/callback`, grant_type: 'authorization_code', code_verifier: verifier }) });
  if (!tokensResponse.ok) return bad('Googleログインに失敗しました', 401);
  const tokens = await tokensResponse.json(); const user = await verifyGoogleToken(tokens.id_token, env.GOOGLE_CLIENT_ID, nonce);
  const response = new Response(null, { status: 302, headers: { location: url.origin } });
  response.headers.append('set-cookie', secureCookie('sugu_session', await signSession(user, env.SESSION_SECRET), 30 * 86400));
  response.headers.append('set-cookie', secureCookie('sugu_oauth', '', 0, '/auth'));
  return response;
}
function cleanTitle(value) { return typeof value === 'string' ? value.trim().slice(0, 180) : ''; }
function cleanDue(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) ? value : null; }
async function readBody(request) { if (Number(request.headers.get('content-length') || 0) > 10_000) throw Error('入力が長すぎます'); return request.json(); }
async function taskRoutes(request, env, user, path) {
  if (!env.DB) return bad('データベースが設定されていません', 503);
  const id = path.match(/^\/api\/tasks\/([a-f0-9-]{36})$/)?.[1];
  if (path === '/api/tasks' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT id,title,note,status,due_date,created_at,updated_at FROM tasks WHERE user_id=? ORDER BY updated_at DESC LIMIT 500').bind(user.sub).all(); return json(result.results);
  }
  if (path === '/api/tasks' && request.method === 'POST') {
    const body = await readBody(request); const title = cleanTitle(body.title); if (!title) return bad('タスクを入力してください');
    const now = new Date().toISOString(), task = { id: crypto.randomUUID(), title, note: '', status: 'inbox', due_date: cleanDue(body.due_date), created_at: now, updated_at: now };
    await env.DB.prepare('INSERT INTO tasks(id,user_id,title,note,status,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(task.id,user.sub,task.title,task.note,task.status,task.due_date,now,now).run(); return json(task, 201);
  }
  if (id && request.method === 'PATCH') {
    const body = await readBody(request); if (!['inbox','doing','done'].includes(body.status)) return bad('無効な状態です');
    const now = new Date().toISOString(); const result = await env.DB.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=? AND user_id=?').bind(body.status,now,id,user.sub).run();
    if (!result.meta.changes) return bad('タスクが見つかりません',404);
    return json(await env.DB.prepare('SELECT id,title,note,status,due_date,created_at,updated_at FROM tasks WHERE id=? AND user_id=?').bind(id,user.sub).first());
  }
  if (id && request.method === 'DELETE') { const result=await env.DB.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').bind(id,user.sub).run();return result.meta.changes ? json({ok:true}) : bad('タスクが見つかりません',404); }
  return bad('見つかりません',404);
}
async function aiParse(request, env) {
  if (!env.AI) return bad('AIが設定されていません', 503);
  const body = await readBody(request), text = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
  if (!text) return bad('文章を入力してください');
  const today = new Date().toISOString().slice(0,10);
  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', { messages: [
    { role: 'system', content: `Extract actionable tasks from Japanese text. Today is ${today} UTC. Return only JSON with shape {"tasks":[{"title":"...","due_date":"YYYY-MM-DD or null"}]}. Maximum 8 tasks. Preserve intent. No explanations.` },
    { role: 'user', content: text }
  ], max_tokens: 500 });
  const output = typeof result.response === 'string' ? result.response : JSON.stringify(result);
  const match = output.match(/\{[\s\S]*\}/); if (!match) return bad('タスクを読み取れませんでした', 502);
  let parsed; try { parsed = JSON.parse(match[0]); } catch { return bad('タスクを読み取れませんでした', 502); }
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0,8).map(t => ({ title: cleanTitle(t.title), due_date: cleanDue(t.due_date) })).filter(t => t.title) : [];
  return tasks.length ? json({tasks}) : bad('タスクが見つかりませんでした', 422);
}
export default { async fetch(request, env) {
  try {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/auth/google' && request.method === 'GET') return await googleStart(request,env);
    if (path === '/auth/callback' && request.method === 'GET') return await googleCallback(request,env);
    if (path === '/auth/logout' && request.method === 'GET') { const r=new Response(null,{status:302,headers:{location:url.origin}});r.headers.append('set-cookie',secureCookie('sugu_session','',0));return r; }
    if (path === '/api/session' && request.method === 'GET') { const user=await session(request,env);return json(user ? {authenticated:true,user:{name:user.name,email:user.email}} : {authenticated:false}); }
    if (path.startsWith('/api/')) {
      const user=await session(request,env); if (!user) return bad('ログインが必要です',401);
      if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return bad('許可されていない操作です',403);
      if (path.startsWith('/api/tasks')) return taskRoutes(request,env,user,path);
      if (path === '/api/ai/parse' && request.method === 'POST') return aiParse(request,env);
      return bad('見つかりません',404);
    }
    return env.ASSETS.fetch(request);
  } catch(e) { console.error(e); return bad(e.message === '入力が長すぎます' ? e.message : '処理に失敗しました', 500); }
} };
