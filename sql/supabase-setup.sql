-- ============================================================================
--  e-Pili Bomba Kunak  ·  BBP Kunak, Sabah
--  FILE 1 of 2 — accounts, roles, and the hydrants table
--
--  HOW TO USE
--    Supabase dashboard > SQL Editor > New query > paste all > Run.
--    Run THIS FILE FIRST, then run supabase-records-setup.sql.
--    Safe to re-run: it will not duplicate or destroy existing data.
--
--  WHAT THIS SETS UP
--    profiles ....... one row per login account, holding its role
--    is_admin() ..... helper used by every security rule
--    hydrants ....... the 187 fire hydrants (label, coordinates,
--                     Awam/Swasta category, and address)
--
--  SECURITY MODEL
--    Any signed-in user may READ.  Only an 'admin' may WRITE.
--    New accounts default to 'viewer'; you promote people manually
--    (see the note at the very bottom of this file).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Accounts and roles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'viewer' check (role in ('admin','viewer')),
  -- The officer's own signature, held as a STORAGE PATH inside the private
  -- `signatures` bucket (file 2 creates it) — never an image, never a public
  -- URL, for the same reason as hydrant_records.signature: a public URL stops
  -- working the moment the bucket is locked down.
  --
  -- THIS IS A STENCIL, NOT EVIDENCE. It is COPIED at signing time into the
  -- row's own object; a filed row never points at it. So replacing it here is
  -- allowed and changes nothing already filed — which is the exact opposite of
  -- the rule on hydrant_records, and deliberately so. See docs/KAD-REKOD.md.
  signature  text,
  created_at timestamptz default now()
);

-- Present since 2026-08-09; added here too so an existing database is topped up
-- rather than needing a fresh install.
alter table public.profiles add column if not exists signature text;

alter table public.profiles enable row level security;

-- Is the CURRENT signed-in user an admin?
-- SECURITY DEFINER lets this read profiles without tripping the policies
-- below, which would otherwise recurse infinitely.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Every function in `public` is published by PostgREST as an RPC endpoint, and
-- is created with EXECUTE granted to PUBLIC — so without this revoke anyone who
-- can reach the API can call it, signed in or not.
--
-- `authenticated` KEEPS the grant, and must. An RLS policy expression runs as
-- the calling role, so every policy below that calls is_admin() would fail with
-- "permission denied for function is_admin" and no officer could save anything.
-- Verified against a real Postgres; do not tighten this without doing the same.
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

drop policy if exists "read own profile"       on public.profiles;
drop policy if exists "admins manage profiles" on public.profiles;

create policy "read own profile" on public.profiles
  for select to authenticated
  using (auth.uid() = id or public.is_admin());

-- This ALREADY covers an admin setting their own `signature`, which is why the
-- Profile signature needed no new policy — and why the feature is admin-only:
-- a viewer has no update path to profiles at all, by design. Do NOT add a
-- self-update policy to widen it. `for all` here would let one write both
-- `signature` and `role` in the same statement, so a self-update rule scoped to
-- `auth.uid() = id` would hand every viewer the ability to promote themselves.
create policy "admins manage profiles" on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- When you add a user in Authentication > Users, give them a profile
-- automatically. Everyone starts as 'viewer' — this is deliberate.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Same reasoning as is_admin() above. This one returns trigger, so Postgres
-- would refuse to run it over RPC anyway — but the endpoint should not exist.
-- The trigger below still fires: it runs as the function's owner.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 2. The hydrants table
-- ---------------------------------------------------------------------------
create table if not exists public.hydrants (
  id         bigint primary key,
  label      text not null,               -- No. Pili Bomba, e.g. A01
  lat        double precision not null,
  lng        double precision not null,
  status     text not null default 'kerajaan',  -- 'kerajaan' = Awam, or 'swasta'
  location   text,                        -- Alamat Pili Bomba
  updated_at timestamptz default now()
);

-- If the table already existed without the address column, add it.
alter table public.hydrants add column if not exists location text;

alter table public.hydrants enable row level security;

-- Remove any earlier, wide-open rules before applying the role-based ones.
drop policy if exists "anyone can read"       on public.hydrants;
drop policy if exists "anyone can write"      on public.hydrants;
drop policy if exists "anyone can update"     on public.hydrants;
drop policy if exists "anyone can delete"     on public.hydrants;
drop policy if exists "auth read hydrants"    on public.hydrants;
drop policy if exists "admin insert hydrants" on public.hydrants;
drop policy if exists "admin update hydrants" on public.hydrants;
drop policy if exists "admin delete hydrants" on public.hydrants;

create policy "auth read hydrants" on public.hydrants
  for select to authenticated using (true);

create policy "admin insert hydrants" on public.hydrants
  for insert to authenticated with check (public.is_admin());

create policy "admin update hydrants" on public.hydrants
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admin delete hydrants" on public.hydrants
  for delete to authenticated using (public.is_admin());


-- ---------------------------------------------------------------------------
-- 3. The 187 hydrants from the BBP Kunak register
--    170 Awam ('kerajaan') + 17 Swasta ('swasta' = A26 and A92-A107)
-- ---------------------------------------------------------------------------
insert into public.hydrants (id,label,lat,lng,status,location) values
  (1,'A01',4.6853294,118.2457346,'kerajaan','Balai Bomba Kunak'),
  (2,'A02',4.6859643,118.2457903,'kerajaan','Balai Bomba Kunak'),
  (3,'A03',4.687217,118.2448,'kerajaan','S.E.S.B Kunak'),
  (4,'A04',4.687067,118.244267,'kerajaan','S.E.S.B Kunak'),
  (5,'A05',4.687017,118.243767,'kerajaan','S.E.S.B Kunak'),
  (6,'A06',4.686583,118.2447,'kerajaan','S.E.S.B Kunak'),
  (7,'A07',4.68655,118.24445,'kerajaan','S.E.S.B Kunak'),
  (8,'A08',4.686533,118.24405,'kerajaan','S.E.S.B Kunak'),
  (9,'A09',4.6858,118.242,'kerajaan','Kg. Kunak Kecil'),
  (10,'A10',4.685767,118.238667,'kerajaan','Kg. Kunak Kecil'),
  (11,'A11',4.691583,118.23835,'kerajaan','Kg. Kunak Jaya'),
  (12,'A12',4.7012,118.229,'kerajaan','S.K Kunak 2'),
  (13,'A13',4.692417,118.2383,'kerajaan','Kg. Kunak Jaya'),
  (14,'A14',4.694869,118.2384,'kerajaan','Jalan Kunak Jaya'),
  (15,'A15',4.699017,118.239383,'kerajaan','Kg. Kunak Jaya'),
  (16,'A16',4.695533,118.238833,'kerajaan','S.K Kunak Jaya'),
  (17,'A17',4.69585,118.23925,'kerajaan','Kg. Kunak Jaya'),
  (18,'A18',4.6948,118.23925,'kerajaan','Berhadapan dengan kilang T.S.H Willmar'),
  (19,'A19',4.696633,118.23825,'kerajaan','S.K Kunak Jaya'),
  (20,'A20',4.690183,118.23735,'kerajaan','Perumahan T.S.H Willmar'),
  (21,'A21',4.691583,118.237833,'kerajaan','Perumahan T.S.H Willmar'),
  (22,'A22',4.690883,118.237733,'kerajaan','Perumahan T.S.H Willmar'),
  (23,'A23',4.697417,118.23965,'kerajaan','Kg. Kunak Jaya'),
  (24,'A24',4.697467,118.239567,'kerajaan','Kg. Kunak Jaya'),
  (25,'A25',4.698717,118.242567,'kerajaan','Kg. Kunak Jaya'),
  (26,'A26',4.694517,118.239533,'swasta','T.S.H Willmar'),
  (27,'A27',4.696967,118.228767,'kerajaan','Kg. Kabog'),
  (28,'A28',4.697867,118.22725,'kerajaan','Kg. Kabog'),
  (29,'A29',4.697183,118.224083,'kerajaan','Kg. Kabog'),
  (30,'A30',4.697967,118.221267,'kerajaan','Kg. Kabog'),
  (31,'A31',4.681367,118.233667,'kerajaan','Kg. Kunak Tiga'),
  (32,'A32',4.69353,118.228283,'kerajaan','Kg. Kunak Tiga'),
  (33,'A33',4.700367,118.22995,'kerajaan','Kg. Kunak Tiga'),
  (34,'A34',4.7013,118.229617,'kerajaan','Kg. Kunak Tiga'),
  (35,'A35',4.696717,118.228883,'kerajaan','Kg. Kunak Tiga'),
  (36,'A36',4.684967,118.2481,'kerajaan','Kawasan Pekan Kunak'),
  (37,'A37',4.684917,118.246983,'kerajaan','Kawasan Pekan Kunak'),
  (38,'A38',4.684,118.24725,'kerajaan','Kawasan Pekan Kunak'),
  (39,'A39',4.684283,118.248283,'kerajaan','Kawasan Pekan Kunak'),
  (40,'A40',4.685083,118.249033,'kerajaan','Kawasan Pekan Kunak'),
  (41,'A41',4.6846,118.249167,'kerajaan','Kawasan Pekan Kunak'),
  (42,'A42',4.686183,118.249183,'kerajaan','Jalan Rumah Kerajaan'),
  (43,'A43',4.686217,118.250067,'kerajaan','Jalan Rumah Kerajaan'),
  (44,'A44',4.687967,118.249967,'kerajaan','Jalan Rumah Kerajaan'),
  (45,'A45',4.687767,118.250017,'kerajaan','Pejabat Kesihatan Kunak'),
  (46,'A46',4.68708,118.250133,'kerajaan','Pejabat Kesihatan Kunak'),
  (47,'A47',4.6876,118.250567,'kerajaan','Pejabat Kesihatan Kunak'),
  (48,'A48',4.68765,118.25005,'kerajaan','Pejabat Kesihatan Kunak'),
  (49,'A49',4.6859,118.250767,'kerajaan','Masjid Kunak'),
  (50,'A50',4.685617,118.250633,'kerajaan','Masjid Kunak'),
  (51,'A51',4.68665,118.2506,'kerajaan','Kompleks Sapang'),
  (52,'A52',4.686667,118.251583,'kerajaan','Kompleks Sapang'),
  (53,'A53',4.686867,118.250883,'kerajaan','Kompleks Sapang'),
  (54,'A54',4.687417,118.251183,'kerajaan','Kompleks Sapang'),
  (55,'A55',4.6851,118.247367,'kerajaan','Kawasan Pekan'),
  (56,'A56',4.68635,118.25155,'kerajaan','Kompleks Sapang'),
  (57,'A57',4.686417,118.252017,'kerajaan','Balai Polis Kunak'),
  (58,'A58',4.685283,118.251867,'kerajaan','Balai Polis Kunak'),
  (59,'A59',4.6862,118.251933,'kerajaan','Di hadapan Kuarters'),
  (60,'A60',4.686917,118.251883,'kerajaan','Balai Polis Kunak'),
  (61,'A61',4.685717,118.255317,'kerajaan','Kg. Pangkalan Kunak'),
  (62,'A62',4.687267,118.245305,'kerajaan','Kg. Pangkalan Kunak'),
  (63,'A63',4.682967,118.24545,'kerajaan','S.R.J.K (C) Pai Sheng'),
  (64,'A64',4.6832147,118.2446684,'kerajaan','S.R.J.K (C) Pai Sheng'),
  (65,'A65',4.682867,118.246033,'kerajaan','S.K. Pekan'),
  (66,'A66',4.683583,118.247333,'kerajaan','Kompleks Fajar'),
  (67,'A67',4.683133,118.2473,'kerajaan','Kompleks Fajar'),
  (68,'A68',4.679683,118.24845,'kerajaan','S.M.K Agama Kunak'),
  (69,'A69',4.679633,118.24805,'kerajaan','S.M.K Agama Kunak'),
  (70,'A70',4.67955,118.247767,'kerajaan','S.M.K Agama Kunak'),
  (71,'A71',4.680033,118.247683,'kerajaan','S.M.K Agama Kunak'),
  (72,'A72',4.680883,118.24795,'kerajaan','S.M.K Agama Kunak'),
  (73,'A73',4.681733,118.24855,'kerajaan','Kawasan Pekan'),
  (74,'A74',4.680817,118.2448,'kerajaan','S.M.K Kunak'),
  (75,'A75',4.6795,118.2453,'kerajaan','S.M.K Kunak'),
  (76,'A76',4.680467,118.2455,'kerajaan','S.M.K Kunak'),
  (77,'A77',4.682567,118.25045,'kerajaan','Kg. Jaya Baru'),
  (78,'A78',4.680983,118.249983,'kerajaan','Kg. Jaya Baru'),
  (79,'A79',4.680233,118.250983,'kerajaan','Kg. Jaya Baru'),
  (80,'A80',4.678983,118.25185,'kerajaan','Kg. Jaya Baru'),
  (81,'A81',4.679633,118.252467,'kerajaan','Kg. Jaya Baru'),
  (82,'A82',4.679617,118.24995,'kerajaan','S.M.K. Kunak Jaya'),
  (83,'A83',4.678633,118.24985,'kerajaan','S.M.K. Kunak Jaya'),
  (84,'A84',4.68115,118.245717,'kerajaan','S.M.K. Kunak'),
  (85,'A85',4.687033,118.245383,'kerajaan','Kg. Bagiang'),
  (86,'A86',4.684583,118.244683,'kerajaan','Kg. Bagiang'),
  (87,'A87',4.683667,118.244433,'kerajaan','Kawasan Pekan'),
  (88,'A88',4.682433,118.246167,'kerajaan','S.K. Pekan Kunak'),
  (89,'A89',4.681967,118.246117,'kerajaan','S.K. Pekan Kunak'),
  (90,'A90',4.683033,118.248217,'kerajaan','Kawasan Pekan'),
  (91,'A91',4.6846,118.243017,'kerajaan','Perumahan JKR'),
  (92,'A92',4.694267,118.240267,'swasta','Kilang T.S.H Wilmar'),
  (93,'A93',4.694033,118.240967,'swasta','Kilang T.S.H Wilmar'),
  (94,'A94',4.693733,118.24165,'swasta','Kilang T.S.H Wilmar'),
  (95,'A95',4.693917,118.242,'swasta','Kilang T.S.H Wilmar'),
  (96,'A96',4.694517,118.2421,'swasta','Kilang T.S.H Wilmar'),
  (97,'A97',4.6949,118.242283,'swasta','Kilang T.S.H Wilmar'),
  (98,'A98',4.69525,118.24265,'swasta','Kilang T.S.H Wilmar'),
  (99,'A99',4.695917,118.2427,'swasta','Kilang T.S.H Wilmar'),
  (100,'A100',4.69595,118.242067,'swasta','Kilang T.S.H Wilmar'),
  (101,'A101',4.6956,118.2416,'swasta','Kilang T.S.H Wilmar'),
  (102,'A102',4.694733,118.241567,'swasta','Kilang T.S.H Wilmar'),
  (103,'A103',4.69535,118.24105,'swasta','Kilang T.S.H Wilmar'),
  (104,'A104',4.696183,118.240717,'swasta','Kilang T.S.H Wilmar'),
  (105,'A105',4.69625,118.240533,'swasta','Kilang T.S.H Wilmar'),
  (106,'A106',4.694733,118.241567,'swasta','Kilang T.S.H Wilmar'),
  (107,'A107',4.695767,118.239517,'swasta','Kilang T.S.H Wilmar'),
  (108,'A108',4.683167,118.250133,'kerajaan','Kawasan Pekan'),
  (109,'A109',4.699614,118.239652,'kerajaan','Kg. Kunak Jaya Laut'),
  (110,'A110',4.700444,118.239798,'kerajaan','Kg. Buang Sayang'),
  (111,'A111',4.691542,118.227833,'kerajaan','Guineensis Park Kg. Kunak Tiga'),
  (112,'A112',4.691588,118.227126,'kerajaan','Guineensis Park Kg. Kunak Tiga'),
  (113,'A113',4.691066,118.227835,'kerajaan','Guineensis Park Kg. Kunak Tiga'),
  (114,'A114',4.690946,118.227172,'kerajaan','Guineensis Park Kg. Kunak Tiga'),
  (115,'B01',4.677317,118.2482,'kerajaan','Kg. Getah'),
  (116,'B02',4.67455,118.244483,'kerajaan','Kg. Getah'),
  (117,'B03',4.67545,118.244933,'kerajaan','Taman Kunak Kaya'),
  (118,'B04',4.67507,118.2449,'kerajaan','Taman Kunak Kaya'),
  (119,'B05',4.67455,118.244483,'kerajaan','Taman Kunak Kaya'),
  (120,'B06',4.67545,118.246083,'kerajaan','Taman Kunak Kaya'),
  (121,'B07',4.675017,118.246117,'kerajaan','Taman Kunak Kaya'),
  (122,'B08',4.674967,118.24675,'kerajaan','Taman Kunak Kaya'),
  (123,'B09',4.66875,118.253417,'kerajaan','Kg. Sungai Atas'),
  (124,'B10',4.6729,118.2491,'kerajaan','Kg. Sungai Atas'),
  (125,'B11',4.672434,118.251592,'kerajaan','Kg. Sungai Atas'),
  (126,'B12',4.6778,118.2491,'kerajaan','S.K. Kg Selamat'),
  (127,'B13',4.6778,118.24835,'kerajaan','S.K. Kg Selamat'),
  (128,'B14',4.678317,118.248517,'kerajaan','S.K. Kg Selamat'),
  (129,'B15',4.675867,118.233833,'kerajaan','Kg. Sri Langgas'),
  (130,'B16',4.677583,118.23063,'kerajaan','Hospital Kunak'),
  (131,'B17',4.677267,118.23125,'kerajaan','Hospital Kunak'),
  (132,'B18',4.677167,118.231567,'kerajaan','Hospital Kunak'),
  (133,'B19',4.676567,118.231567,'kerajaan','Hospital Kunak'),
  (134,'B20',4.676267,118.232,'kerajaan','Hospital Kunak'),
  (135,'B21',4.676383,118.23245,'kerajaan','Hospital Kunak'),
  (136,'B22',4.6765,118.233083,'kerajaan','Hospital Kunak'),
  (137,'B23',4.677133,118.233217,'kerajaan','Hospital Kunak'),
  (138,'B24',4.67765,118.2323,'kerajaan','Hospital Kunak'),
  (139,'B25',4.6777,118.231667,'kerajaan','Hospital Kunak'),
  (140,'B26',4.676933,118.23235,'kerajaan','Hospital Kunak'),
  (141,'B27',4.674951,118.244394,'kerajaan','Kg. Getah'),
  (142,'C01',4.659433,118.278633,'kerajaan','Kg. Hampilan'),
  (143,'C02',4.623367,118.22175,'kerajaan','Skim Kokos'),
  (144,'C03',4.674683,118.2143,'kerajaan','Taman Idaman'),
  (145,'C04',4.673817,118.214683,'kerajaan','Taman Idaman'),
  (146,'C05',4.675317,118.213217,'kerajaan','Taman Idaman'),
  (147,'C06',4.674217,118.213217,'kerajaan','Taman Idaman'),
  (148,'C07',4.683167,118.213483,'kerajaan','Taman Idaman'),
  (149,'C08',4.674667,118.213767,'kerajaan','Taman Idaman'),
  (150,'C09',4.67575,118.2155,'kerajaan','Kedai Simpang Empat'),
  (151,'C10',4.672967,118.21495,'kerajaan','Kedai Simpang Empat'),
  (152,'C11',4.674017,118.214867,'kerajaan','Kedai Simpang Empat'),
  (153,'C12',4.678733,118.214533,'kerajaan','Kg. Simpang Empat'),
  (154,'C13',4.6792,118.2147,'kerajaan','Kg. Simpang Empat'),
  (155,'C14',4.627845,118.212967,'kerajaan','Kg. Simpang Empat'),
  (156,'C15',4.68015,118.214367,'kerajaan','Kg. Simpang Empat'),
  (157,'C16',4.679633,118.214367,'kerajaan','Kg. Simpang Empat'),
  (158,'C17',4.660233,118.280167,'kerajaan','Kg. Hampilan'),
  (159,'C18',4.665433,118.198717,'kerajaan','Kg. Sri Bahagia'),
  (160,'C19',4.6785,118.215617,'kerajaan','Kg. Simpang Empat'),
  (161,'C20',4.665652,118.210067,'kerajaan','Kg. Kadazan'),
  (162,'C21',4.664746,118.207493,'kerajaan','Kg. Kadazan'),
  (163,'D01',4.710583,118.206367,'kerajaan','Kg. Dasar Lama'),
  (164,'D02',4.705867,118.206367,'kerajaan','Kg. Dasar Baru'),
  (165,'D03',4.724933,118.1841,'kerajaan','S.M.K. Madai'),
  (166,'D04',4.724017,118.187383,'kerajaan','S.M.K. Madai'),
  (167,'D05',4.724067,118.186683,'kerajaan','S.M.K. Madai'),
  (168,'D06',4.724,118.185917,'kerajaan','S.M.K. Madai'),
  (169,'D07',4.724683,118.185983,'kerajaan','S.M.K. Madai'),
  (170,'D08',4.724567,118.184867,'kerajaan','S.M.K. Madai'),
  (171,'D09',4.725115,118.184167,'kerajaan','S.M.K. Madai'),
  (172,'D10',4.724883,118.186767,'kerajaan','S.M.K. Madai'),
  (173,'D11',4.726083,118.1858,'kerajaan','S.K. Madai'),
  (174,'D12',4.70265,118.20375,'kerajaan','Kg. Lormalong'),
  (175,'D13',4.705083,118.20345,'kerajaan','Kg. Lormalong'),
  (176,'E01',4.65653,118.274117,'kerajaan','Kg. Pangi'),
  (177,'E02',4.660283,118.282933,'kerajaan','S.K. Pangi'),
  (178,'E03',4.66035,118.283583,'kerajaan','S.K. Pangi'),
  (179,'E04',4.655467,118.26395,'kerajaan','Kg. Telagah Tujuh'),
  (180,'E05',4.653467,118.259633,'kerajaan','Kg. Telagah Tujuh'),
  (181,'E06',4.655983,118.29375,'kerajaan','Kawasan Pangi'),
  (182,'E07',4.658517,118.2867,'kerajaan','Kg. Pangi'),
  (183,'E08',4.6593,118.288367,'kerajaan','Kg. Pangi'),
  (184,'E09',4.6532,118.290367,'kerajaan','Kg. Pangi'),
  (185,'E10',4.655983,118.29375,'kerajaan','Kg. Pangi'),
  (186,'E11',4.6538,118.289067,'kerajaan','Kg. Pangi'),
  (187,'E12',4.658283,118.278417,'kerajaan','Kg. Hampilan')
on conflict (id) do update set
  label    = excluded.label,
  lat      = excluded.lat,
  lng      = excluded.lng,
  status   = excluded.status,
  location = excluded.location;


-- ---------------------------------------------------------------------------
-- 4. Check it worked — expect 187 / 170 / 17 / 0, and profile_signature_col t
-- ---------------------------------------------------------------------------
select count(*)                                   as total_hydrants,
       count(*) filter (where status='kerajaan')   as awam,
       count(*) filter (where status='swasta')     as swasta,
       count(*) filter (where location is null)    as missing_address,
       -- Selected rather than assumed: a column that failed to be added is
       -- invisible until an officer's Profile silently refuses to save (§7 —
       -- a verification query must select the thing it is verifying).
       (select exists (select 1 from information_schema.columns
          where table_schema='public' and table_name='profiles'
            and column_name='signature'))          as profile_signature_col
from public.hydrants;


-- ============================================================================
--  NEXT STEPS
--
--  1) Run supabase-records-setup.sql (file 2 of 2).
--
--  2) Create each person's account:
--       Authentication > Users > Add user
--       Enter email + password, and TICK "Auto Confirm User".
--
--  3) Everyone starts as a viewer (read-only). To let someone edit:
--       update public.profiles set role = 'admin' where email = 'their@email.com';
--
--     Give each person their own account rather than sharing one —
--     signatures record who signed, which is meaningless on a shared login.
-- ============================================================================
