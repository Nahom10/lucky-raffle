const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signJwt(payload: Record<string, unknown>, secret: string) {
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  return `${header}.${body}.${base64url(await hmacSha256(secret, `${header}.${body}`))}`;
}

export async function verifyJwt(token: string, secret: string) {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) throw new Error('Malformed token');
  const actual = fromBase64url(signature);
  const expected = await hmacSha256(secret, `${header}.${body}`);
  if (actual.length !== expected.length || !actual.every((byte, index) => byte === expected[index])) throw new Error('Invalid token');
  const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired token');
  return payload as { sub: string; telegram_user_id: string; app_role: string };
}
