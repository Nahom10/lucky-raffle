import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';

type ForwardedSms = Record<string, unknown>;

const text = (value: unknown) => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

function first(data: ForwardedSms, keys: string[]) {
  for (const key of keys) {
    const value = text(data[key]);
    if (value) return value;
  }
  return '';
}

function amountFrom(value: string) {
  const matches = [
    value.match(/(?:ETB|birr)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i),
    value.match(/([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:ETB|birr)/i),
    value.match(/(?:amount|paid|credited|received)\D{0,20}([0-9][0-9,]*(?:\.\d{1,2})?)/i),
  ];
  const matched = matches.find(Boolean)?.[1]?.replaceAll(',', '');
  const amount = Number(matched);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseForwardedSms(data: ForwardedSms) {
  const raw = first(data, ['raw', 'message', 'sms', 'body', 'content', 'text']);
  const suppliedAmount = Number(first(data, ['amount', 'value', 'payment_amount']));
  const amount = Number.isFinite(suppliedAmount) && suppliedAmount > 0 ? suppliedAmount : amountFrom(raw);
  const txnId = first(data, ['txnId', 'transactionId', 'transaction_id', 'reference', 'reference_id', 'txn', 'id']) ||
    (raw.match(/(?:transaction|trans(?:action)?\s*(?:id|no)|reference|txn(?:\s*(?:id|no)?))\s*[:#-]?\s*([A-Z0-9-]{6,})/i)?.[1] || '');
  const code = first(data, ['code', 'reference_code']) || raw.match(/\bLR\d{4}\b/i)?.[0] || '';
  const phone = first(data, ['phone', 'sender', 'from', 'originatingAddress']);
  return { raw, amount, txnId, code, phone };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const expectedSecret = Deno.env.get('RAFFLE_SMS_WEBHOOK_SECRET');
    const providedSecret = request.headers.get('x-raffle-webhook-secret') || new URL(request.url).searchParams.get('secret');
    if (!expectedSecret || providedSecret !== expectedSecret) return json({ error: 'UNAUTHORIZED' }, 401);
    const receipt = parseForwardedSms(await request.json() as ForwardedSms);
    if (!receipt.raw || !receipt.txnId || receipt.amount == null) return json({ error: 'INVALID_RECEIPT', message: 'Forward raw SMS text plus a transaction ID and amount, or use a supported Telebirr-style message.' }, 400);
    const serviceKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const client = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await client.rpc('process_sms', { p_raw: receipt.raw, p_amount: receipt.amount, p_txn: receipt.txnId, p_code: receipt.code || null, p_phone: receipt.phone || null });
    if (error) throw error;
    return json({ status: data });
  } catch (error) { return json({ error: 'SMS_PROCESSING_FAILED', message: error instanceof Error ? error.message : 'Unknown error' }, 400); }
});
