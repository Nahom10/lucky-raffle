import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/http.ts';
import { signJwt } from '../_shared/crypto.ts';
import { verifyTelegramInitData } from '../_shared/telegram.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { initData } = await request.json();
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const jwtSecret = Deno.env.get('RAFFLE_JWT_SECRET');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!botToken || !jwtSecret || !url || !serviceKey) throw new Error('Server authentication is not configured');
    const telegram = await verifyTelegramInitData(initData, botToken);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: contact, error: contactError } = await admin.from('telegram_contacts').select('phone,name').eq('telegram_id', telegram.id).maybeSingle();
    if (contactError) throw contactError;
    let { data: profile, error } = await admin.from('profiles').select('*').eq('telegram_id', telegram.id).maybeSingle();
    if (error) throw error;
    if (!profile) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email: `telegram-${telegram.id}@lucky-raffle.invalid`, email_confirm: true,
        user_metadata: { telegram_id: telegram.id, name: telegram.first_name || telegram.username || `Player ${telegram.id}` },
      });
      if (createError || !created.user) throw createError || new Error('Could not create player');
      const { data, error: profileError } = await admin.from('profiles').insert({
        id: created.user.id, telegram_id: telegram.id, name: contact?.name || telegram.first_name || telegram.username || `Player ${telegram.id}`, phone: contact?.phone || null,
      }).select().single();
      if (profileError) throw profileError;
      profile = data;
    } else if (contact?.phone && profile.phone !== contact.phone) {
      const { data, error: profileError } = await admin.from('profiles').update({ phone: contact.phone, name: contact.name }).eq('id', profile.id).select().single();
      if (profileError) throw profileError;
      profile = data;
    }
    if (profile.is_banned) return json({ error: 'BANNED' }, 403);
    const now = Math.floor(Date.now() / 1000);
    const access_token = await signJwt({ aud: 'authenticated', role: 'authenticated', sub: profile.id, telegram_user_id: String(profile.telegram_id), app_role: profile.is_admin ? 'admin' : 'player', iat: now, exp: now + 60 * 60 * 12 }, jwtSecret);
    return json({ access_token, profile: { id: profile.id, name: profile.name, phone: profile.phone, isAdmin: profile.is_admin } });
  } catch (error) { return json({ error: 'AUTH_FAILED', message: error instanceof Error ? error.message : 'Authentication failed' }, 401); }
});
