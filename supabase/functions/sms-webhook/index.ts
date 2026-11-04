import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (request.headers.get('x-raffle-webhook-secret') !== Deno.env.get('RAFFLE_SMS_WEBHOOK_SECRET')) return json({ error: 'UNAUTHORIZED' }, 401);
    const { raw, amount, txnId, code, phone } = await request.json();
    if (!raw || !txnId || !Number.isFinite(Number(amount))) return json({ error: 'INVALID_RECEIPT' }, 400);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data, error } = await client.rpc('process_sms', { p_raw: raw, p_amount: amount, p_txn: txnId, p_code: code || null, p_phone: phone || null });
    if (error) throw error;
    return json({ status: data });
  } catch (error) { return json({ error: 'SMS_PROCESSING_FAILED', message: error instanceof Error ? error.message : 'Unknown error' }, 400); }
});
