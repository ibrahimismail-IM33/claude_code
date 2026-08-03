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

## If you ever restore for real

Order matters:

1. Create the new project
2. Load `epilibomba-public-*.sql`
3. Load `epilibomba-auth-*.sql` (accounts — people cannot log in without it)
4. Create the `signatures` bucket, set it **public**, upload `signatures/`
   keeping the same folder and file names
5. Run `sql/supabase-audit-setup.sql` to put the audit trigger back
6. Update `SUPABASE_URL` and `SUPABASE_KEY` in `index.html`, and the Supabase
   origins in `_headers` (CSP), to the new project, then publish

Step 4 is the one people forget. Without it every signed record points at a
link that no longer exists.
