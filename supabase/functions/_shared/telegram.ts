import { hmacSha256 } from './crypto.ts';

function hex(bytes: Uint8Array) { return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

export async function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Telegram signature missing');
  params.delete('hash');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) throw new Error('Telegram session expired');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = await hmacSha256('WebAppData', botToken);
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const actual = hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(dataCheckString))));
  if (actual.length !== hash.length || !actual.split('').every((char, index) => char === hash[index])) throw new Error('Invalid Telegram signature');
  const user = params.get('user');
  if (!user) throw new Error('Telegram user missing');
  return JSON.parse(user) as { id: number; first_name?: string; username?: string; language_code?: string };
}
