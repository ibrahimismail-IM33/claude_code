# Pemulihan / Restore drill — e-Pili Bomba Kunak

A backup nobody has restored is not a backup. Run this once now, then once
every six months, so the day you need it is not the first time you try.

Takes about 15 minutes. **Never restore into the live project.**

---

## What a backup contains

Each nightly run produces one artifact under
**Actions → Backup Supabase → (a run) → Artifacts**:

| File | What |
|---|---|
| `epilibomba-public-YYYY-MM-DD.sql.gz` | Structure + all data of the `public` schema |
| `epilibomba-auth-YYYY-MM-DD.sql.gz` | The user accounts (`auth.users`) |
| `hydrants-*.csv`, `hydrant_records-*.csv`, `profiles-*.csv` | Readable copies you can open in Excel |
| `storage-objects.csv` | Which signature file belongs to which record |
| `signatures/` | **The signature images themselves** |

> Before 2026-08-03 the signature images were **not** in the backup. Any
> artifact older than that restores records whose signature links are dead.
>
> The bucket became **private** on 2026-08-03, so backing up the images now
> needs a `SUPABASE_SERVICE_KEY` secret. Until that secret exists the backup
> fails loudly and the images are not captured.

---

## The drill

**1. Get a backup**

Actions → **Backup Supabase** → newest green run → download the artifact →
unzip it.

**2. Make somewhere to restore into**

supabase.com → **New project** (Free plan is enough). Call it
`epilibomba-restore-test`. Wait for it to finish setting up.

Take its connection string: **Connect → Session pooler → URI**, and put your
password in place of `[YOUR-PASSWORD]`.

**3. Load the database**

```sh
gunzip epilibomba-public-*.sql.gz
psql "<the URI from step 2>" -f epilibomba-public-*.sql
```

**4. Check what came back**

```sh
psql "<the URI>" -c "
  select (select count(*) from hydrants)        as hydrants,
         (select count(*) from hydrant_records) as records,
         (select count(*) from hydrant_records where signed) as signed,
         (select count(*) from jadual_pemeriksaan) as jadual;"
```

Compare against `hydrants-*.csv` (subtract 1 for the header row). **They must
match.** If hydrants is under 100, the backup was incomplete — stop and
investigate.

**5. Check the signatures — the part that matters**

```sh
ls signatures/ | wc -l          # how many images the backup holds
psql "<the URI>" -c "select count(*) from hydrant_records where signed and coalesce(signature,'')<>'';"
```

**These two numbers must be equal.** A signed record whose image is missing
is a record you cannot prove.

Open two or three images and confirm they are real signatures, not blank or
truncated files.

**6. Write down the result and delete the test project**

supabase.com → the test project → Settings → General → **Delete project**.

Record in `CLAUDE.md` §8: the date, the artifact you used, and whether the
counts matched.

---

## Automated weekly check

`.github/workflows/restore-test.yml` does the data half of this drill every
Monday 07:30 MYT: it downloads the newest backup, restores it into a
throwaway Postgres, and checks the counts and the signature images. It opens
an issue labelled `restore-failure` if anything is wrong.

Last verified: **2026-08-03** — 188 pili, 31 rekod, 8 bertandatangan,
8 signature images, all valid.

> **What that check does NOT cover, proven by the same run:** 16 statements
> fail when the dump is loaded into a bare PostgreSQL —
> `role "authenticated" does not exist` (×14) and `relation "auth.users"
> does not exist`. That is every RLS policy and the `profiles → auth.users`
> link. **The data comes back; the access control does not.** Restoring the
> dump alone would leave every record readable and writable by anyone signed
> in. Step 5 below is not optional.

## If you ever restore for real

Order matters:

1. Create the new project
2. Load `epilibomba-public-*.sql`
3. Load `epilibomba-auth-*.sql` (accounts — people cannot log in without it)
4. Create the `signatures` bucket, leave it **private**, upload `signatures/`
   keeping the same folder and file names, then add the read policy:
   ```sql
   create policy "signatures read" on storage.objects
     for select to authenticated using (bucket_id = 'signatures');
   create policy "signatures write" on storage.objects
     for insert to authenticated with check (bucket_id = 'signatures' and public.is_admin());
   ```
   Without the read policy the app cannot create signed links and every
   signature shows blank.
5. **Re-run every script in `sql/`** — `supabase-setup.sql`, then
   `-records-`, then `-jadual-`, then `-audit-`. This is what rebuilds the
   RLS policies, `is_admin()`, and the signed-row protection, none of which
   survive in the dump. Skipping this leaves the data wide open.
6. Update `SUPABASE_URL` and `SUPABASE_KEY` in `index.html`, and the Supabase
   origins in `_headers` (CSP), to the new project, then publish

Step 4 is the one people forget. Without it every signed record points at a
link that no longer exists.
