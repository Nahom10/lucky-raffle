const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const configured = Boolean(url && anon);

async function call(path, { token, method = 'GET', body } = {}) {
  if (!configured) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect Lucky Raffle.');
  const response = await fetch(`${url}${path}`, { method, headers: { apikey: anon, authorization: `Bearer ${token || anon}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || 'Request failed');
  return data;
}

export const raffleApi = {
  configured,
  signIn: (initData) => call('/functions/v1/telegram-auth', { method: 'POST', body: { initData } }),
  updateProfile: (token, userId, profile) => call(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, { token, method: 'PATCH', body: profile }),
  raffles: (token, includeDrafts = false) => call(`/rest/v1/raffles?select=*&${includeDrafts ? '' : 'status=in.(open,closed,drawn)&'}order=created_at.desc`, { token }),
  balance: (token, userId) => call(`/rest/v1/balances?user_id=eq.${encodeURIComponent(userId)}&select=balance`, { token }),
  tickets: (token, raffleId) => call(`/rest/v1/ticket_public?raffle_id=eq.${encodeURIComponent(raffleId)}&select=number,name,is_house,phone_masked,mine&order=number.asc`, { token }),
  myTickets: (token) => call('/rest/v1/tickets?select=raffle_id,number,created_at&order=created_at.desc', { token }),
  deposits: (token) => call('/rest/v1/deposits?select=*&order=created_at.desc', { token }),
  paymentSettings: () => call('/rest/v1/settings?key=eq.merchant_payment&select=value'),
  withdrawals: (token) => call('/rest/v1/withdrawals?select=*&order=created_at.desc', { token }),
  draws: (raffleId) => call(`/rest/v1/draws?raffle_id=eq.${encodeURIComponent(raffleId)}&select=*`),
  rpc: (token, name, args) => call(`/rest/v1/rpc/${name}`, { token, method: 'POST', body: args }),
  admin: (token, body) => call('/functions/v1/raffle-admin', { token, method: 'POST', body }),
};
