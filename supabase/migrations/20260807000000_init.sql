-- VERIFY: tabella token OAuth (unica tabella del progetto)
create table if not exists verify_accounts (
  profile text not null,
  provider text not null check (provider in ('google','spotify')),
  refresh_token text not null,
  updated_at timestamptz default now(),
  primary key (profile, provider)
);

-- Nessuna policy pubblica: ci accede solo la service role key dalle edge functions
alter table verify_accounts enable row level security;
