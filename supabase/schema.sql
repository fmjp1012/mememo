create extension if not exists pgcrypto;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  type text not null check (type in ('contact', 'question_report')),
  subject text not null,
  message text not null,
  contact_email text,
  user_id uuid references auth.users(id) on delete set null,
  question_id text,
  question_pack_id text,
  question_exam_id text,
  question_number integer,
  question_prompt text,
  page_url text,
  user_agent text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed'))
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_subject_length') then
    alter table public.support_messages add constraint support_messages_subject_length
      check (char_length(subject) between 1 and 160) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_message_length') then
    alter table public.support_messages add constraint support_messages_message_length
      check (char_length(message) between 1 and 4000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_contact_email_length') then
    alter table public.support_messages add constraint support_messages_contact_email_length
      check (contact_email is null or char_length(contact_email) <= 254) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_question_prompt_length') then
    alter table public.support_messages add constraint support_messages_question_prompt_length
      check (question_prompt is null or char_length(question_prompt) <= 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_page_url_length') then
    alter table public.support_messages add constraint support_messages_page_url_length
      check (page_url is null or char_length(page_url) <= 1000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_messages_user_agent_length') then
    alter table public.support_messages add constraint support_messages_user_agent_length
      check (user_agent is null or char_length(user_agent) <= 500) not valid;
  end if;
end $$;

alter table public.support_messages enable row level security;

drop policy if exists "Anyone can create support messages" on public.support_messages;
revoke insert on public.support_messages from anon, authenticated;

drop policy if exists "Users can read own support messages" on public.support_messages;
create policy "Users can read own support messages"
  on public.support_messages
  for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists support_messages_created_at_idx on public.support_messages (created_at desc);
create index if not exists support_messages_question_id_idx on public.support_messages (question_id);

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'incomplete' check (
    status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
  ),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

drop policy if exists "Users can read own subscription" on public.subscriptions;
create policy "Users can read own subscription"
  on public.subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

create index if not exists subscriptions_customer_id_idx on public.subscriptions (stripe_customer_id);
create index if not exists subscriptions_subscription_id_idx on public.subscriptions (stripe_subscription_id);

create table if not exists public.user_learning_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  progress jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_learning_state enable row level security;
alter table public.user_learning_state force row level security;

drop policy if exists "Users can read own learning state" on public.user_learning_state;
create policy "Users can read own learning state"
  on public.user_learning_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own learning state" on public.user_learning_state;
create policy "Users can create own learning state"
  on public.user_learning_state
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own learning state" on public.user_learning_state;
create policy "Users can update own learning state"
  on public.user_learning_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_learning_state from anon;
grant select, insert, update on public.user_learning_state to authenticated;

create index if not exists user_learning_state_updated_at_idx
  on public.user_learning_state (updated_at desc);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 2000),
  link_url text,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.announcements enable row level security;
alter table public.announcements force row level security;

drop policy if exists "Anyone can read active announcements" on public.announcements;
create policy "Anyone can read active announcements"
  on public.announcements
  for select
  to anon, authenticated
  using (is_active = true);

revoke insert, update, delete on public.announcements from anon, authenticated;
grant select on public.announcements to anon, authenticated;

create index if not exists announcements_active_published_idx
  on public.announcements (is_active, published_at desc);
