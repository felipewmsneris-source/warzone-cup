-- =====================================================================
-- WARZONE CUP — esquema do banco (Supabase / PostgreSQL)
--
-- GLOSSÁRIO (regra absoluta do campeonato)
--   scoring_baixas = valor da coluna BAIXAS do placar do Warzone.
--   A coluna ELIMINAÇÕES do jogo NUNCA entra na pontuação.
--   Por isso este banco não possui nenhuma coluna chamada "kills".
--
-- PERMISSÕES
--   Leitura: controlada por RLS (políticas no fim deste arquivo).
--   Escrita: nenhuma política de insert/update/delete existe para os
--   papéis "anon" e "authenticated". Toda gravação passa pelo servidor
--   da aplicação (chave service_role), que confere o perfil do usuário
--   antes de gravar. Um capitão não consegue alterar nada direto no banco.
-- =====================================================================


-- ---------- tipos ----------
create type public.user_role as enum ('ADMIN', 'CAPTAIN');
create type public.championship_status as enum ('RASCUNHO', 'ATIVO', 'ENCERRADO');
create type public.match_status as enum ('NAO_LIBERADA', 'ABERTA', 'FECHADA');
create type public.report_status as enum (
  'RASCUNHO',     -- IA já leu as prints, capitão ainda não confirmou
  'REABERTO',     -- admin reabriu / autorizou envio: capitão pode reenviar
  'ENVIADA',      -- confirmado pelo capitão, aguardando validação manual
  'EM_ANALISE',   -- leitura sem segurança suficiente: admin confere
  'VALIDADA',     -- conta na classificação
  'DIVERGENCIA',  -- conflito detectado ou apontado pelo capitão
  'REJEITADA'
);
create type public.image_kind as enum ('PLACEMENT', 'STATS', 'UNKNOWN');

-- ---------- usuários ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role public.user_role not null default 'CAPTAIN',
  created_at timestamptz not null default now()
);

-- ---------- cadastro base (reaproveitado entre campeonatos) ----------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  clan_tag text,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text not null,
  created_at timestamptz not null default now()
);

-- Apelidos extras aceitos na leitura das prints (ex.: nick antigo do jogador)
create table public.team_aliases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid references public.players (id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now()
);

-- ---------- campeonatos ----------
create table public.championships (
  id uuid primary key default gen_random_uuid(),
  number serial not null unique,
  name text not null,
  event_date date,
  status public.championship_status not null default 'RASCUNHO',
  is_public boolean not null default false,
  -- true: report sem nenhum alerta é validado sozinho; false: tudo passa pelo admin
  auto_validate boolean not null default true,
  -- ordem dos critérios de desempate (configurável no painel)
  tiebreak_order text[] not null default '{victories,baixas,last_placement}',
  created_at timestamptz not null default now(),
  constraint tiebreak_valid check (tiebreak_order <@ array['victories','baixas','last_placement'])
);

create table public.championship_teams (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete restrict,
  team_number int not null check (team_number between 1 and 99),
  captain_user_id uuid references public.profiles (id) on delete set null,
  captain_player_id uuid references public.players (id) on delete set null,
  -- último critério de desempate: decisão do administrador (menor = melhor)
  tiebreak_manual int,
  unique (championship_id, team_number),
  unique (championship_id, team_id)
);
create index on public.championship_teams (captain_user_id);

create table public.team_players (
  id uuid primary key default gen_random_uuid(),
  championship_team_id uuid not null references public.championship_teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete restrict,
  slot int not null check (slot between 1 and 3),
  unique (championship_team_id, slot),
  unique (championship_team_id, player_id)
);

create table public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  placement_from int not null check (placement_from >= 1),
  placement_to int not null,
  multiplier numeric(4,2) not null check (multiplier >= 0),
  bonus numeric(6,2) not null default 0,
  check (placement_to >= placement_from)
);
create index on public.scoring_rules (championship_id);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships (id) on delete cascade,
  match_number int not null check (match_number between 1 and 20),
  status public.match_status not null default 'NAO_LIBERADA',
  deadline timestamptz,
  unique (championship_id, match_number)
);

-- ---------- reports ----------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  championship_team_id uuid not null references public.championship_teams (id) on delete cascade,
  status public.report_status not null default 'RASCUNHO',
  placement int check (placement between 1 and 200),
  victory boolean not null default false,
  -- soma das BAIXAS dos 3 jogadores (coluna BAIXAS do Warzone)
  total_scoring_baixas int check (total_scoring_baixas >= 0),
  -- linha TOTAL DO ESQUADRÃO, coluna BAIXAS, como lida na print
  squad_total_baixas_detected int,
  totals_match boolean,
  ai_confidence numeric(4,3),
  ai_raw jsonb,
  flags text[] not null default '{}',
  captain_note text,
  admin_note text,
  late_allowed boolean not null default false,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  validated_by uuid references public.profiles (id) on delete set null,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, championship_team_id)
);
create index on public.reports (championship_team_id);

create table public.report_images (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  championship_id uuid not null references public.championships (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  championship_team_id uuid not null references public.championship_teams (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null,
  kind public.image_kind not null default 'UNKNOWN',
  -- false = print substituída por um reenvio; continua guardada para histórico
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.report_images (report_id);

create table public.image_hashes (
  id uuid primary key default gen_random_uuid(),
  report_image_id uuid not null unique references public.report_images (id) on delete cascade,
  championship_id uuid not null references public.championships (id) on delete cascade,
  sha256 text not null,
  phash text not null, -- hash perceptual (dHash 64 bits, hexadecimal)
  created_at timestamptz not null default now()
);
create index on public.image_hashes (sha256);
create index on public.image_hashes (championship_id);

create table public.player_baixas (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  detected_name text,
  scoring_baixas int check (scoring_baixas >= 0), -- coluna BAIXAS; null = não lido com segurança
  read_confidence numeric(4,3),
  name_match_score numeric(4,3)
);
create index on public.player_baixas (report_id);

-- Resultado oficial: existe somente enquanto o report está VALIDADO.
create table public.match_results (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports (id) on delete cascade,
  match_id uuid not null references public.matches (id) on delete cascade,
  championship_id uuid not null references public.championships (id) on delete cascade,
  championship_team_id uuid not null references public.championship_teams (id) on delete cascade,
  placement int not null,
  victory boolean not null,
  scoring_baixas int not null,
  multiplier numeric(4,2) not null,
  bonus numeric(6,2) not null,
  points numeric(8,2) not null,
  created_at timestamptz not null default now(),
  -- 16 times: nunca duas colocações iguais na mesma partida (logo, um só vencedor)
  unique (match_id, placement),
  unique (match_id, championship_team_id),
  check (victory = (placement = 1))
);
create index on public.match_results (championship_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  username text,
  action text not null,
  entity text not null,
  entity_id uuid,
  championship_id uuid references public.championships (id) on delete cascade,
  field text,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (created_at desc);
create index on public.audit_logs (entity_id);

-- =====================================================================
-- PONTUAÇÃO — única fonte de verdade, sempre em numeric (sem erro de float)
--   pontos = (BAIXAS da partida × multiplicador da colocação) + bônus
-- =====================================================================
create function public.calc_points(p_championship_id uuid, p_placement int, p_scoring_baixas int)
returns table (multiplier numeric, bonus numeric, points numeric)
language sql stable
set search_path = public
as $$
  select r.multiplier, r.bonus,
         round(p_scoring_baixas * r.multiplier + r.bonus, 2) as points
  from scoring_rules r
  where r.championship_id = p_championship_id
    and p_placement between r.placement_from and r.placement_to
  order by r.placement_from
  limit 1
$$;

-- Valida um report: grava o resultado oficial e muda o status, tudo ou nada.
create function public.apply_validation(p_report_id uuid, p_user_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  r reports%rowtype;
  v_champ uuid;
  v_mult numeric;
  v_bonus numeric;
  v_points numeric;
begin
  select * into r from reports where id = p_report_id for update;
  if not found then raise exception 'REPORT_NAO_ENCONTRADO'; end if;
  if r.placement is null or r.total_scoring_baixas is null then
    raise exception 'REPORT_INCOMPLETO';
  end if;
  if exists (select 1 from player_baixas where report_id = r.id and scoring_baixas is null) then
    raise exception 'REPORT_INCOMPLETO';
  end if;

  select championship_id into v_champ from matches where id = r.match_id;
  select c.multiplier, c.bonus, c.points into v_mult, v_bonus, v_points
  from calc_points(v_champ, r.placement, r.total_scoring_baixas) c;
  if v_points is null then raise exception 'SEM_REGRA_PARA_COLOCACAO'; end if;

  insert into match_results (report_id, match_id, championship_id, championship_team_id,
                             placement, victory, scoring_baixas, multiplier, bonus, points)
  values (r.id, r.match_id, v_champ, r.championship_team_id,
          r.placement, r.placement = 1, r.total_scoring_baixas, v_mult, v_bonus, v_points)
  on conflict (report_id) do update
    set placement = excluded.placement, victory = excluded.victory,
        scoring_baixas = excluded.scoring_baixas, multiplier = excluded.multiplier,
        bonus = excluded.bonus, points = excluded.points;

  update reports
     set status = 'VALIDADA', victory = (r.placement = 1),
         validated_by = p_user_id, validated_at = now(), updated_at = now()
   where id = r.id;
end $$;

-- Recalcula os pontos de um campeonato (usar depois de alterar as regras).
create function public.recalc_championship(p_championship_id uuid)
returns int
language plpgsql
set search_path = public
as $$
declare n int;
begin
  update match_results mr
     set multiplier = c.multiplier, bonus = c.bonus, points = c.points
    from match_results m2
    cross join lateral calc_points(p_championship_id, m2.placement, m2.scoring_baixas) c
   where mr.id = m2.id and m2.championship_id = p_championship_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.apply_validation(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.recalc_championship(uuid) from public, anon, authenticated;
grant execute on function public.apply_validation(uuid, uuid) to service_role;
grant execute on function public.recalc_championship(uuid) to service_role;

-- =====================================================================
-- CLASSIFICAÇÃO
-- =====================================================================
create view public.standings with (security_invoker = true) as
select
  ct.id as championship_team_id,
  ct.championship_id,
  ct.team_number,
  ct.tiebreak_manual,
  t.name as team_name,
  t.clan_tag,
  coalesce(sum(mr.points), 0)::numeric(10,2) as total_points,
  coalesce(sum(mr.scoring_baixas), 0)::int as total_baixas,
  (count(mr.id) filter (where mr.victory))::int as victories,
  count(mr.id)::int as matches_played,
  coalesce(jsonb_object_agg(m.match_number, mr.points) filter (where mr.id is not null), '{}'::jsonb) as points_by_match,
  (select mr2.placement
     from match_results mr2 join matches m2 on m2.id = mr2.match_id
    where mr2.championship_team_id = ct.id
    order by m2.match_number desc limit 1) as last_placement
from championship_teams ct
join teams t on t.id = ct.team_id
left join match_results mr on mr.championship_team_id = ct.id
left join matches m on m.id = mr.match_id
group by ct.id, t.id;

-- =====================================================================
-- RLS
-- =====================================================================
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'ADMIN') $$;

create function public.is_my_team(p_championship_team_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from championship_teams
                      where id = p_championship_team_id and captain_user_id = auth.uid()) $$;

create function public.can_see_championship(p_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from championships c where c.id = p_id and c.is_public)
      or public.is_admin()
      or exists (select 1 from championship_teams ct
                  where ct.championship_id = p_id and ct.captain_user_id = auth.uid())
$$;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.team_aliases enable row level security;
alter table public.championships enable row level security;
alter table public.championship_teams enable row level security;
alter table public.team_players enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.matches enable row level security;
alter table public.reports enable row level security;
alter table public.report_images enable row level security;
alter table public.image_hashes enable row level security;
alter table public.player_baixas enable row level security;
alter table public.match_results enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Público: somente classificação e resultados de campeonatos publicados
create policy read_public on public.championships for select using (public.can_see_championship(id));
create policy read_public on public.championship_teams for select using (public.can_see_championship(championship_id));
create policy read_public on public.matches for select using (public.can_see_championship(championship_id));
create policy read_public on public.scoring_rules for select using (public.can_see_championship(championship_id));
create policy read_public on public.match_results for select using (public.can_see_championship(championship_id));
create policy read_public on public.team_players for select using (
  exists (select 1 from public.championship_teams ct
           where ct.id = championship_team_id and public.can_see_championship(ct.championship_id)));
create policy read_public on public.teams for select using (true);
create policy read_public on public.players for select using (true);

-- Capitão: somente o próprio time. Admin: tudo.
create policy read_own on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy read_own on public.reports for select using (public.is_admin() or public.is_my_team(championship_team_id));
create policy read_own on public.report_images for select using (public.is_admin() or public.is_my_team(championship_team_id));
create policy read_own on public.player_baixas for select using (
  public.is_admin() or exists (select 1 from public.reports r
                                where r.id = report_id and public.is_my_team(r.championship_team_id)));
create policy read_own on public.notifications for select using (user_id = auth.uid());

-- Somente admin
create policy read_admin on public.team_aliases for select using (public.is_admin());
create policy read_admin on public.image_hashes for select using (public.is_admin());
create policy read_admin on public.audit_logs for select using (public.is_admin());

-- Privilégios de tabela: leitura para todos (filtrada pelo RLS), escrita só service_role
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.calc_points(uuid, int, int) to anon, authenticated, service_role;

-- =====================================================================
-- Armazenamento das prints (bucket privado; acesso só por URL assinada)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prints', 'prints', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- =====================================================================
-- Tempo real (classificação, painel e transmissão atualizam sozinhos)
-- =====================================================================
alter publication supabase_realtime add table public.match_results;
alter publication supabase_realtime add table public.reports;
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.notifications;
