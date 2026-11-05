-- 4COREPAL phase 3: how the assistant's conversations are written (service role only; reads are by row-level security, each person sees only their own).
-- A conversation belongs to the person who started it, and a message can be added only to your own conversation. Each answer is audited with the tools it used,
-- never with the question or answer text (the audit log is not a second copy of the conversation).
create or replace function ai_start_conversation(p_actor uuid, p_title text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform require_permission(p_actor, 'ai.assistant.use');
  if not ai_enabled() then raise exception 'AI_DISABLED'; end if;
  insert into ai_conversations (user_id, title) values (p_actor, left(coalesce(nullif(btrim(p_title), ''), 'New conversation'), 200)) returning id into v_id;
  return v_id;
end $$;

create or replace function ai_add_message(p_actor uuid, p_conversation uuid, p_role text, p_content text, p_tool_calls jsonb default '[]'::jsonb, p_sources jsonb default '[]'::jsonb, p_model text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform require_permission(p_actor, 'ai.assistant.use');
  if not ai_enabled() then raise exception 'AI_DISABLED'; end if;
  if p_role not in ('user', 'assistant') then raise exception 'VALIDATION_ERROR' using detail = 'role'; end if;
  if not exists (select 1 from ai_conversations where id = p_conversation and user_id = p_actor) then raise exception 'NOT_FOUND'; end if;
  insert into ai_messages (conversation_id, role, content, tool_calls, sources, model)
  values (p_conversation, p_role, left(p_content, 20000), coalesce(p_tool_calls, '[]'::jsonb), coalesce(p_sources, '[]'::jsonb), p_model) returning id into v_id;
  update ai_conversations set updated_at = app_now() where id = p_conversation;
  if p_role = 'assistant' then
    perform write_audit(p_actor, 'AI_ANSWER', 'ai_conversation', p_conversation::text, null,
      jsonb_build_object('tools', (select coalesce(jsonb_agg(t->>'tool'), '[]'::jsonb) from jsonb_array_elements(coalesce(p_tool_calls, '[]'::jsonb)) t), 'sources', jsonb_array_length(coalesce(p_sources, '[]'::jsonb))));
  end if;
  return v_id;
end $$;

-- the title of a conversation is its first question, shortened
create or replace function ai_title_conversation(p_actor uuid, p_conversation uuid, p_title text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform require_permission(p_actor, 'ai.assistant.use');
  update ai_conversations set title = left(btrim(p_title), 200) where id = p_conversation and user_id = p_actor and title = 'New conversation';
end $$;
select lock_down_function_grants();
