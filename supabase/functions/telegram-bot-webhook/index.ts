import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';

type TelegramUser = { id: number; first_name?: string; username?: string };

const botApi = (token: string, method: string, body: unknown) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function askForContact(token: string, chatId: number, name: string) {
  await botApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Welcome${name ? `, ${name}` : ''}! Please share the phone number registered to your wallet to join Lucky Raffle.`,
    reply_markup: { keyboard: [[{ text: 'Share my phone number', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

async function openAppButton(token: string, chatId: number, appUrl: string) {
  await botApi(token, 'sendMessage', {
    chat_id: chatId, text: 'Registration complete. Open Lucky Raffle.',
    reply_markup: { keyboard: [[{ text: 'Open Lucky Raffle', web_app: { url: appUrl } }]], resize_keyboard: true },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const webhookSecret = Deno.env.get('RAFFLE_TELEGRAM_WEBHOOK_SECRET');
    if (!webhookSecret || request.headers.get('x-telegram-bot-api-secret-token') !== webhookSecret) return json({ error: 'UNAUTHORIZED' }, 401);
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const appUrl = Deno.env.get('RAFFLE_MINI_APP_URL');
    const serviceKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!token || !appUrl || !serviceKey) throw new Error('Bot is not configured');
    const update = await request.json();
    const message = update.message;
    const sender: TelegramUser | undefined = message?.from;
    if (!message || !sender || message.chat?.type !== 'private') return json({ ok: true });
    if (message.text === '/start') { await askForContact(token, message.chat.id, sender.first_name || ''); return json({ ok: true }); }
    const contact = message.contact;
    if (!contact) return json({ ok: true });
    if (contact.user_id !== sender.id) { await askForContact(token, message.chat.id, sender.first_name || ''); return json({ ok: true }); }
    const name = sender.first_name || sender.username || `Player ${sender.id}`;
    const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
    const { error: contactError } = await db.from('telegram_contacts').upsert({ telegram_id: sender.id, phone: contact.phone_number, name, username: sender.username || null, shared_at: new Date().toISOString() });
    if (contactError) throw contactError;
    const { error: profileError } = await db.from('profiles').update({ phone: contact.phone_number, name }).eq('telegram_id', sender.id);
    if (profileError) throw profileError;
    await openAppButton(token, message.chat.id, appUrl);
    return json({ ok: true });
  } catch (error) { console.error(error); return json({ error: 'WEBHOOK_FAILED' }, 500); }
});
