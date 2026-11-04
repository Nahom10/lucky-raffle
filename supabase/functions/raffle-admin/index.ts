import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';
import { sha256, verifyJwt } from '../_shared/crypto.ts';

async function entropy() {
  const response = await fetch('https://api.drand.sh/public/latest');
  if (!response.ok) throw new Error('Public randomness beacon unavailable');
  const payload = await response.json();
  return `${payload.round}:${payload.randomness}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const secret = Deno.env.get('RAFFLE_JWT_SECRET');
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!secret || !token) return json({ error: 'UNAUTHORIZED' }, 401);
    const session = await verifyJwt(token, secret);
    const serviceKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
    const { data: profile } = await db.from('profiles').select('is_admin').eq('id', session.sub).single();
    if (!profile?.is_admin && session.app_role !== 'admin') return json({ error: 'FORBIDDEN' }, 403);
    const body = await request.json();
    if (body.action === 'create') {
      const raffle = body.raffle;
      if (!raffle?.title || !Number.isInteger(raffle.total_numbers) || raffle.total_numbers < 2 || !Number(raffle.price)) return json({ error: 'INVALID_RAFFLE' }, 400);
      const seed = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const { data, error } = await db.from('raffles').insert({ ...raffle, status: 'draft', seed_hash: await sha256(seed) }).select().single();
      if (error) throw error;
      const { error: seedError } = await db.from('raffle_secrets').insert({ raffle_id: data.id, seed_secret: seed });
      if (seedError) throw seedError;
      return json({ raffle: data });
    }
    if (body.action === 'set-status') {
      const { error } = await db.from('raffles').update({ status: body.status }).eq('id', body.raffleId);
      if (error) throw error;
      return json({ ok: true });
    }
    if (body.action === 'draw') {
      const { data, error } = await db.rpc('run_draw', { p_raffle: body.raffleId, p_entropy: body.entropy || await entropy() });
      if (error) throw error;
      return json({ results: data });
    }
    if (body.action === 'review-withdrawal') {
      const { error } = await db.rpc('review_withdrawal', { p_withdrawal: body.withdrawalId, p_status: body.status, p_paid_ref: body.paidRef || null });
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) { return json({ error: 'ADMIN_ACTION_FAILED', message: error instanceof Error ? error.message : 'Unknown error' }, 400); }
});
