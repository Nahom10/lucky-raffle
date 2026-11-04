-- Lucky Raffle operational controls and client-view grants.
grant select on balances, ticket_public to authenticated;

-- Only the server-side admin function may call this. Rejecting a request returns
-- its held funds exactly once; paying it keeps the withdrawal hold in place.
create function review_withdrawal(p_withdrawal uuid, p_status wd_status, p_paid_ref text default null) returns void
language plpgsql security definer set search_path = public as $$
declare w withdrawals;
begin
  if p_status not in ('approved', 'paid', 'rejected') then raise exception 'invalid_status'; end if;
  select * into w from withdrawals where id = p_withdrawal for update;
  if w.id is null then raise exception 'not_found'; end if;
  if w.status not in ('requested', 'approved') then raise exception 'already_reviewed'; end if;
  if p_status = 'paid' and nullif(trim(coalesce(p_paid_ref, '')), '') is null then raise exception 'paid_ref_required'; end if;
  if p_status = 'rejected' then
    insert into ledger(user_id, kind, amount, ref_type, ref_id, idem_key)
      values (w.user_id, 'withdrawal_release', w.amount, 'withdrawal', w.id, 'wd-release:' || w.id);
  end if;
  update withdrawals set status = p_status, paid_ref = case when p_status = 'paid' then trim(p_paid_ref) else paid_ref end
    where id = w.id;
  insert into audit_log(actor, action, detail)
    values (auth.uid(), 'withdrawal_review', jsonb_build_object('withdrawal', w.id, 'status', p_status));
end $$;

revoke all on function review_withdrawal from public, anon, authenticated;
grant execute on function review_withdrawal to service_role;
