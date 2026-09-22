# Satoru EMR — Complete Handoff Guide
### CHT Core + Satoru Config — Reports, PDF & Excel Exports (DDST-II / DST / MoCA / VSMS)

> For: colleague taking over this machine / fresh clone  
> Workspace on this machine: `C:\Projects\EMRCHT\` (Windows + WSL Ubuntu)  
> Last updated: Sep 2026 — branch `main` (satoru-config) + patched `cht-core` (`main`, CHT 5.3.0)

> **Read this first (added when this guide was merged, Sep 2026).** This is
> Varshini's handoff guide, kept for its history and Windows/WSL notes. Where it
> disagrees with [RUNBOOK.md](RUNBOOK.md), RUNBOOK wins. In particular:
> - The published `cht-*:5.3.0` images do **not** contain our patches. The
>   webapp must be built and deployed as the `satoru-cht-api:5.3.0` image
>   (RUNBOOK Step 1) — "no rebuild needed" below is wrong.
> - The "Print Form" button and `Print\Form` translations were removed (they
>   did nothing); use **Print / Save as PDF** and **Print all scales**.
> - Excel exports are also a web page at `/exports/`, and forms can be uploaded
>   at `/exports/forms/` (see the config repo's SETUP.md).
> - The one-off `upload_*.py` / `verify_*.py` / `check_*.py` scripts it mentions
>   were removed, as its own to-do list asked; use `cht` to upload.

---

## 0) What this project IS

| Repo | What it is | Do you edit it? |
|---|---|---|
 | **cht-core** | CHT platform (API, Sentinel, Webapp, CouchDB, NGINX/HAProxy). `cht-core v5.3.0` (published Docker images). Source: `defaultname-ayan/cht-core-satoru-reports`. | **Patched** — 4 files + 2 new files for report rendering & Print/PDF. Uses published images — no rebuild needed. |
| **satoru-config** | CHT **app config** compiled & uploaded *onto* a running cht-core instance via `cht` CLI. Contains forms, settings, translations, contact-summary, tasks, targets, export scripts. | Yes — this is where all form/label/export work lives. |

```
CHT instance = cht-core (Docker)  +  satoru-config (uploaded into CouchDB)
```

Report PDF / Excel do **not** recalculate scores. They render stored `fields` + calculated results from the form.

---

## 1) Where the folder MUST live

The two repos must be **siblings** under same Windows folder. Docker bind-mounts rely on WSL path `/mnt/c/Projects/...`.

```
C:\Projects\EMRCHT\          <-- create this exact folder (or D:\Projects\EMRCHT\ — keep siblings)
  cht-core\                  <-- git clone medic/cht-core
  satoru-config\             <-- git clone satoru-config
  HANDOFF_GUIDE.md           <-- this file
```

On **WSL Ubuntu** this appears as `/mnt/c/Projects/EMRCHT/`. All Docker commands **must run inside WSL Ubuntu**, not PowerShell Docker context, otherwise CouchDB data volume is lost.

---

## 2) Full folder structure (what matters)

```
satoru-config/
  app_settings.json                 <- COMPILED output (upload target). Generated from app_settings/base_settings.json + forms
  app_settings/base_settings.json   <- SOURCE of truth for roles, contact_types, report_display, etc.
  forms/
    app/                            <- 10 app forms (scale forms): ddst, dst, moca_assessment, vineland (+ 6 others)
      ddst.{xlsx,xml,properties.json}
      dst.{xlsx,xml,properties.json}
      moca_assessment.{xlsx,xml,properties.json} + moca_assessment-media/
      vineland.{xlsx,xml,properties.json}
    contact/
      screening_camp-{create,edit}.xlsx   <- Camp
      participant-{create,edit}.xlsx      <- Participant (child / beneficiary)
  translations/messages-en.properties <- Report labels: report.ddst.*, report.vineland.*, report.scale.chronological_age, etc.
  contact-summary.templated.js        <- Participant profile card (CR No, age, workflow cards)
  tasks.js / targets.js / nools-extras.js
  scripts/
    gen_report_config.py              <- Regenerates report_display + translations from form XML (SOURCE = forms/app/*.xml)
    scale_meta.py                     <- Parses XML -> labels, choice_maps, groups, results (NO hard-coded clinical text)
    scale_export.py                   <- Excel row/section builders used by both export scopes
    export_emr.py                     <- Standalone read-only CouchDB -> Excel (see section 6)
    emr_common.py

cht-core/
  webapp/src/ts/services/format-data-record.service.ts  <- PATCHED: human-readable report rendering
  webapp/src/ts/services/print-report.service.ts        <- NEW: Print / Save as PDF for Reports view
  webapp/src/ts/modules/reports/reports-content.*       <- PATCHED: Print button injected
  webapp/src/css/inbox.less                             <- PATCHED: .report-print-btn style
  webapp/web-components/cht-form/src/app.component.html <- PATCHED: Print Form button in form
  api/resources/translations/messages-*.properties       <- PATCHED: Print\Form key (10 locales)
  scripts/docker-helper/cht-docker-compose.sh           <- Creates ~/.medic/cht-docker/<project>/compose files
  satoruemr.env                                         <- GENERATED env (NGINX ports, COUCH creds, project name) — DO NOT COMMIT MANUALLY
```

---

## 3) Prerequisites

| Tool | Version on this machine | Install / check |
|---|---|---|
| Windows 10/11 + WSL2 Ubuntu | Ubuntu 22.04 | `wsl --install -d Ubuntu` |
| Docker Desktop | latest, WSL2 backend | https://docs.docker.com/desktop/ |
| Node.js | **>=22.15.0** (cht-core v5.2 requirement) | `nvm install 22` or https://nodejs.org |
| Yarn | 1.x | `npm i -g yarn` |
| Python | 3.10+ | `python --version` (WSL + Windows) |
| Python deps | openpyxl, requests | `pip install openpyxl requests` |
| cht CLI (cht-conf) | ^6.3.0 (`cht --version`) | `npm i -g cht-conf`  (`cht` is alias to `cht-conf`) |

Verify after install (in WSL Ubuntu):

```bash
node --version   # v22.x
yarn --version   # 1.22.x
python3 --version
cht --version
docker --version
wsl --version
```

---

## 4) Clone — from scratch on a new machine

```powershell
# PowerShell — create workspace
mkdir C:\Projects\EMRCHT
cd C:\Projects\EMRCHT

# cht-core (Ayan's fork with report patches, CHT 5.3.0)
git clone https://github.com/defaultname-ayan/cht-core-satoru-reports.git cht-core
cd cht-core
git checkout main

# satoru-config (use your GitHub URL)
git clone https://github.com/donthireddysaivarshini/satoruemr.git
# or copy this folder via USB / zip if no remote yet

# Verify siblings
dir
# should show: cht-core  satoru-config
```

---

## 5) Running the CHT stack (Docker)

> **Project name on this machine:** `satoruemr`  
> Compose files live at: `C:\Users\<you>\.medic\cht-docker\satoruemr-dir\compose\` (WSL: `~/.medic/cht-docker/satoruemr-dir/compose/`)  
> Env file: `C:\Projects\EMRCHT\cht-core\satoruemr.env`

### 5a) First-time init (only once per machine)

In **WSL Ubuntu** terminal:

```bash
cd /mnt/c/Projects/EMRCHT/cht-core

# Create the Docker project (generates compose files + .env)
# If .env already exists at ~/.medic/cht-docker/satoruemr-dir/compose/.env, skip this
./scripts/docker-helper/cht-docker-compose.sh satoruemr.env

# Start stack
docker compose -f ~/.medic/cht-docker/satoruemr-dir/compose/cht-core.yml up -d

# Wait 60-90s, then check
docker ps
# Expect: satoruemr-couchdb-1, satoruemr-haproxy-1, satoruemr-api-1, satoruemr-sentinel-1, satoruemr-nginx-1, satoruemr-nouveau-1

# Check NGINX cert
curl -k https://172-27-250-199.local-ip.medicmobile.org:10443/medic/_info 2>&1 | head
```

Get your **LAN IP** (changes per Wi-Fi):

```bash
hostname -I | awk '{print $1}'        # e.g. 172.27.250.199
# Dashed form for local-ip URL: 172-27-250-199
echo <your-ip> | tr '.' '-'
```

### 5b) Everyday start / stop / restart

**STOP** (PowerShell — always via WSL, never `docker stop` from PowerShell directly):

```powershell
# Pause
wsl -d Ubuntu bash -lc "docker stop satoruemr-nginx-1 satoruemr-api-1 satoruemr-sentinel-1 satoruemr-haproxy-1 satoruemr-nouveau-1 satoruemr-dir-cht-upgrade-service-1 satoruemr-couchdb-1"

# Full WSL shutdown if Docker Desktop shows "WSL integration unexpectedly stopped"
wsl --shutdown
```

**START** (PowerShell):

```powershell
# Resume — order matters (couchdb first)
wsl -d Ubuntu bash -lc "docker start satoruemr-dir-cht-upgrade-service-1 satoruemr-nouveau-1 satoruemr-couchdb-1 satoruemr-haproxy-1 satoruemr-api-1 satoruemr-sentinel-1 satoruemr-nginx-1"

# If People page shows blank after restart
wsl -d Ubuntu bash -lc "docker restart satoruemr-couchdb-1"
# Wait 20s

# If docker command not found inside Ubuntu
# Docker Desktop -> Settings -> Resources -> WSL Integration -> Ubuntu = ON -> Apply & Restart
# Then: wsl --shutdown  -> reopen Docker Desktop
```

**If you see `DockerDesktop/Wsl/ExecError` or `Exec format error`:**

```powershell
wsl --update
wsl --shutdown
# Restart Docker Desktop, re-enable Ubuntu integration, then start stack again
```

### 5c) URLs & credentials

| Service | URL | User / Pass |
|---|---|---|
| **CHT Webapp** | `https://<LAN-IP-DASHED>.local-ip.medicmobile.org:10443/` <br> e.g. `https://172-27-250-199.local-ip.medicmobile.org:10443/` | `medic` / `password` (from `satoruemr.env` → `COUCHDB_USER` / `COUCHDB_PASSWORD`) |
| Fauxton (CouchDB UI) | `https://<LAN-IP-DASHED>.local-ip.medicmobile.org:10443/_utils/` | same |
| Fauxton DB | `.../_utils/#database/medic/_all_docs` |  |
| API | `https://<LAN-IP-DASHED>.local-ip.medicmobile.org:10443/api/v2/...` |  |
| Direct Couch (exports) | `http://medic:password@localhost:5984/medic` <br> or `https://medic:password@<LAN-IP-DASHED>.local-ip.medicmobile.org:10443/medic` |  |
| Host ports | `10080` (HTTP→301) , `10443` (HTTPS) | see `satoruemr.env` |

> On this machine `satoruemr.env` already exists. Copy it if cloning to new machine (or re-generate via `cht-docker-compose.sh`).

---

## 6) Deploying satoru-config onto the running CHT instance

### 6a) Regenerate report labels (required after any form XLSX change)

```bash
# WSL Ubuntu, from satoru-config root
cd /mnt/c/Projects/EMRCHT/satoru-config
python3 scripts/gen_report_config.py
# Writes: app_settings.json, app_settings/base_settings.json, translations/messages-en.properties
git diff --stat   # should show those 3 files if forms changed
```

### 6b) Upload config to CHT

```bash
cd /mnt/c/Projects/EMRCHT/satoru-config

# Upload everything (first time or after form change)
cht --url=https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443 \
    --accept-self-signed-certs \
    upload-app-settings upload-app-forms upload-contact-forms upload-resources upload-custom-translations

# Or, if only report labels changed (fast):
cht --url=https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443 \
    --accept-self-signed-certs \
    upload-app-settings upload-custom-translations

# Replace 172-27-250-199 with YOUR current LAN IP dashed form
```

Equivalent Windows PowerShell (if WSL path issues):

```powershell
wsl -d Ubuntu bash -lc "cd /mnt/c/Projects/EMRCHT/satoru-config && cht --url=https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443 --accept-self-signed-certs upload-app-settings upload-custom-translations"
```

After upload: **hard-refresh browser** `Ctrl+Shift+R` (or log out/in). CHT caches translations.

### 6c) Rebuild CHT webapp (NOT needed — using published 5.3.0 images)

The patches from Ayan's repo (`defaultname-ayan/cht-core-satoru-reports`) are **already included in the published Docker images** (`public.ecr.aws/medic/cht-*:5.3.0`). No local webapp rebuild or image rebuild is needed — just `docker compose pull && docker compose up -d`.

If you need to modify webapp code locally (for development), use dev mode:

```bash
cd /mnt/c/Projects/EMRCHT/cht-core
npm run dev-api          # terminal 1
npm run dev-sentinel     # terminal 2
npm run build-dev-watch  # terminal 3 (webapp watch)
```

---

## 7) End-to-end workflow — Camp → Participant → Assessment → Report

### Step 1: Create Camp (Place)

1. Open CHT: `https://<ip>.local-ip.medicmobile.org:10443/` → Login `medic / password`
2. Left nav → **People** → Click **`+ New Screening Camp`** (top right)
3. Fill: Camp name (e.g. `NIMS`), place_id, address, contact phone → **Submit**
4. Result: Contact doc `type=contact`, `contact_type=screening_camp`, `_id = <campId>`

### Step 2: Create Participant (Person under Camp)

1. Click into the **Camp** you just created → **People** tab inside camp → **`+ New Participant`**
2. Fill: Name (e.g. `Kamala`), CR No / Participant ID (e.g. `79704`), age, gender, phone, address, education, referred_by, consent → **Submit**
3. Result: Contact doc `type=contact`, `contact_type=participant`, `parent._id = <campId>`

> Participants can also be bulk-imported via CSV if needed (People → Import).

### Step 3: Open Participant → Choose Scale

1. Click **Participant name** → profile page loads `contact-summary` cards.
2. Look for **`+`** (New Report) floating button or **Assessment** card → available forms list:
   - **DDST-II** (`ddst`) — Denver Developmental Screening Test II
   - **DST** (`dst`) — Developmental Screening Test
   - **MoCA** (`moca_assessment`) — Montreal Cognitive Assessment
   - **VSMS** (`vineland`) — Vineland Social Maturity Scale
   - (+ `stage1_screening`, `stage2_assessment`, `assessment_visit`, etc.)
3. Click the scale form → Enketo form renders (`<cht-form>`).

> All 4 scale forms have `context: { expression: "!contact || summary.is_participant" }` — they **only** appear on Participant profiles, not on Camps.

### Step 4: Fill & Submit Assessment

- Follow form order: Disclaimers → Child DOB / CA calculation → Age-banded/domain questions → Clinical notes → Uploads.
- Stored values: `yes/no`, `pass/fail/not_assessed`, `P/F/NO/R` etc. — **raw**. Human labels live in form XML choice lists.
- Submit → doc `type=data_record`, `form=<formId>` (e.g. `vineland`), `contact={ submitter user contact }`, `fields.patient_uuid = <participant _id>` (subject), `fields.patient_name`, scored fields `item_N_score`, `raw_score`, `social_quotient_*`, etc. are **calculated in the form binds**.

### Step 5: View Report

1. Left nav → **Reports** → filter by place/participant/form if needed.
2. Click a report row → **Reports → Reports Content** panel expands.
3. **Expected human-readable report** (after fix is deployed + webapp rebuilt):
   - Title: `Vineland-style Social Maturity Scale (VSMS)` (not `vineland`)
   - `Chronological Age: 1 year 1 month` (not `report.vineland.g_child.ca_months_floor = 13`)
   - Per question: `1. Cries, laughs` / `Answer: Yes` (not `yes`) / `Score: 1`
   - Scoring summary, notes, supporting docs sections
   - **`Print / Save as PDF` button** at top of detail (triggers browser print → Save as PDF, same data as on-screen).

### Step 6: Export

See Section 8 below. Preferred is **Python exports** (standalone, read-only CouchDB → Excel), not the built-in CHT "Export Reports" CSV.

---

## 8) What we changed (so you know what to test / what to push)

### satoru-config (commit `main` — already pushed / ready to push)

| File | Change type | What |
|---|---|---|
| `scripts/scale_meta.py` | **NEW** | Parses `forms/app/*.xml` → labels, choice_maps, groups, results. **Single source of truth** — no hard-coded clinical text. |
| `scripts/scale_export.py` | **NEW** | Excel builders: `scale_headers()`, `scale_row()`, `scale_sections()` — shared by both export scopes. Reads `messages-en.properties` + `scale_meta`. Mirrors `format-data-record` logic (hide_fields, choice_map, join CA, per-item scores). |
| `scripts/export_emr.py` | **EXTENDED** | Added `camp-workbook=<campId>` and `participant-report=<id>` scopes. `subject_id_of()` now uses `fields.patient_uuid` (not `contact`). Camp report loop via `scale_reports_by_participant()`. |
| `scripts/gen_report_config.py` | **NEW** | Generates `report_display` block in `app_settings*.json` + `report.<form>.*` keys in `translations/messages-en.properties` from form XML. Idempotent. |
| `translations/messages-en.properties` | EXTENDED | +160 keys: `report.ddst._title`, `report.vineland.g_y0_1.item_1=1. Cries, laughs`, ..., `report.scale.chronological_age` |
| `app_settings.json` + `app_settings/base_settings.json` | EXTENDED | `report_display: { ddst, dst, moca_assessment, vineland }` each with `title_key, hide_fields, choice_map, score_fields, join_fields, date_fields, notes_fields, result_fields, suppress_empty, keep_empty` |
| `forms/app/ddst.xml`, `moca_assessment.xml`, `vineland.xml` | (scoring fixes — earlier PR) | DDST PS/FM/LANG/GM age thresholds, MoCA education adjustment, VSMS SQ bands |

### cht-core (branch `master` — local patches, **needs push to your fork**)

| File | Change type | What |
|---|---|---|
| `webapp/src/ts/services/format-data-record.service.ts` | PATCHED | `getScaleDisplayFields()` — when `settings.report_display[form]` exists: hide internal fields (`ca_months_floor`, `item_N_score`, `band_N_*`, `_delayed`, etc.), resolve `choice_map` values `yes→Yes`, `P→Pass`, `pass→Pass`, `not_assessed→Not Assessed`, `dk→Don't know`, join CA (`years_months_parts` / `days_to_years_months`), attach `score` to question row, suppress empty, format dates via `formatDateService`. Falls back to stock rendering if no config. |
| `webapp/src/ts/services/print-report.service.ts` | **NEW** | `PrintReportService.printSelection()` — renders same `selection.formatted.fields` rows into `#report-print-view` + `window.print()` (Save as PDF). Groups = section heads, scores = `— Score: X`. |
| `webapp/src/ts/modules/reports/reports-content.component.ts` | PATCHED | Injected `PrintReportService`, added `printReport(selection)` (resolves title via `TitlePipe` logic `form.title`). |
| `webapp/src/ts/modules/reports/reports-content.component.html` | PATCHED | Button: `<button (click)="printReport(selection)">Print / Save as PDF</button>` at top of `.details` when `selection.expanded`. Hidden in `@media print`. |
| `webapp/src/css/inbox.less` | PATCHED | `.report-print-btn { margin-bottom:10px; @media print{display:none}}` |
| `webapp/web-components/cht-form/src/app.component.html` | PATCHED | `Print Form` button in form footer (`{{'PRINT_FORM'|translate}}`). Requires `Print\Form` key. |
| `api/resources/translations/messages-*.properties` (10 locales) | PATCHED | `Print\Form = Print Form` added to `ar,bm,en,es,fr,hi,id,ne,pt,sw` |

**What was NOT changed:** Scoring formulas (form `calculate` binds), workflow, contact hierarchy, task/target rules — report layer **consumes** stored results.

---

## 9) Where we are NOW — and why you still see bugs

You reported:

```
report.vineland.g_child.ca_months_floor = 13
report.vineland.item_1_score = 1
yes (lowercase, not "Yes")
No Print / Save as PDF button
Export -> id, rev, name, patient_id sheet (same for camp/participant, no scale sheets)
```

**Root cause on THIS machine:** The `app_settings.json` with `report_display` and the `format-data-record.service.ts` patch **are present locally but not yet deployed/rebuilt to the running Docker instance** you're testing. So the live CHT is still using the stock formatter → shows `report.<form>.<field>` keys + raw values.

**Checklist to make it live (do in order):**

| # | Command (WSL Ubuntu) | Verifies |
|---|---|---|
| 1 | `cd /mnt/c/Projects/EMRCHT/satoru-config && python3 scripts/gen_report_config.py && git diff --stat` | Config regenerated |
| 2 | `python3 scripts/upload_app_settings.py` + `python3 scripts/upload_translations.py --url=https://<IP>:10443 --file=translations/messages-en.properties` | Settings live in CouchDB (direct upload) |
| 3 | `curl -k https://medic:password@<IP>:10443/api/v1/settings 2>/dev/null \| python3 -c "import sys,json; d=json.load(sys.stdin); print('report_display' in d)"` | Config in API |
| 4 | Docker images already at 5.3.0 — no rebuild needed | Published images include patches |
| 5 | Browser hard refresh `Ctrl+Shift+R`, open Reports → Vineland → expand | Should show human-readable labels |

Until step 2+4 are done, your live Reports will still show `report.vineland.*`.

**Export confusion:**

- The **CHT UI Export** (Reports → Export) → `GET /api/v2/export/reports` → always produces 1 flat CSV `Contacts|Reports` with `id,rev,name,patient_id...` — **not** the new Excel. This is stock CHT export, not our Python export.
- The **new Excel** (`camp-workbook`, `participant-report`) is **only** via `python scripts/export_emr.py --scope=...` against CouchDB. It produces `Participants | DDST-II | DST | MoCA | VSMS` sheets. Admin still sees old UI export, but the Python export is the correct one to use.

---

## 10) How to test (what to verify, per scale)

Open **one real report per scale** after deploy+rebuild.

| Scale | Open report (Reports filter by form) | Verify |
|---|---|---|
| **Vineland** | `form = vineland` (e.g. Kamala `79704`) | `0–1 Years` / `1–2 Years` group headers present. `1. Cries, laughs` → `Answer: Yes` (not `yes`) → `Score: 1` inline. CA shows `Chronological Age: 1 year 1 month`. Scoring summary shows `Raw Score: 22`, `Social Age`, `SQ: 164`, `SQ Interpretation: Very Superior` (per stored bands). No `report.vineland.*`, no `item_N_score` rows, no `ca_months_floor`. `Notes` / `Supporting documents` when present. |
| **DST** | `form = dst` | `Birth to 3 months` … `132–144 months` bands. `Pass` / `Fail` / `Not assessed` (not `pass`/`fail`). No `band_N_passed_count` rows. Results: `Developmental Age`, `DQ`. |
| **DDST-II** | `form = ddst` | Domains `Personal-Social`, `Fine Motor`, `Language`, `Gross Motor` in order. Values `Pass` / `Fail` / `No Opportunity` / `Refusal` (not `P/F/NO/R`). No `_delayed` flags. Results: `d_ps_status`, `overall` mapping `Normal / Caution / Suspect` etc. |
| **MoCA** | `form = moca_assessment` | Sections `Visuospatial`, `Naming`, `Attention`, `Language`, `Abstraction`, `Delayed Recall`, `Orientation` (in form order). `Correct`/`Incorrect`/`Don't know`, `Serial 7s 0-3` labels, `Recalled with cue`. Results: `moca_*_total`, `moca_raw_total`, `moca_total_score`, `moca_interpretation`. No `patient_sex`, `_inst` dup rows. |

**General:**
- `Participant` header resolves to `report.<form>._title` human title.
- `Print / Save as PDF` button visible in expanded report detail; click → print preview → `Save as PDF` produces same rows.
- Run Python exports on same camp/participant and compare headers/values match on-screen report.

---

## 11) Python exports — exact commands

All from **`satoru-config/scripts/`** directory. Read-only (GET only).

```bash
cd /mnt/c/Projects/EMRCHT/satoru-config/scripts

# ---- Camp workbook (ONE file, one sheet per scale) ----
python3 export_emr.py \
  --url "https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443/medic" \
  --scope="camp-workbook=019fa39d-a66c-7bbc-8e8f-918d9fe3c0fc" \
  --out ./out
# ^ campId is the UUID of the screening_camp contact (see People -> Camp URL)
# Output: satoru-emr-camp-NIMS-scales-<stamp>.xlsx
# Sheets: Participants (5 rows if 5 participants), DDST-II (2 rows if 2 did DDST), DST (3), MoCA (4), VSMS (1)

# ---- Participant report (ONE file per participant, sectioned) ----
python3 export_emr.py \
  --url "https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443/medic" \
  --scope="participant-report=01a04761-7b5d-7aa1-afc9-4d2216690a64" \
  --out ./out
# Output: satoru-emr-participant-Kamala-report-<stamp>.xlsx
# Sheets: Participant (Field|Value), then one sheet per completed scale:
#   Vineland sheet: Assessment information -> 0-1 Years -> 1-2 Years -> ... -> Scoring results -> Notes

# ---- Also still available (old legacy, not scale-split) ----
python3 export_emr.py --url ".../medic" --scope="all" --out ./out
python3 export_emr.py --url ".../medic" --scope="camp=019fa39d-..." --out ./out
python3 export_emr.py --url ".../medic" --scope="participant=01a04761-..." --out ./out

# Verify output
ls -lh out/*.xlsx
python3 -c "import openpyxl; wb=openpyxl.load_workbook('out/<file>.xlsx'); print(wb.sheetnames)"
```

> **Camp/participant IDs**: copy from CHT People URL: `https://<ip>:10443/#/contacts/<ID>` or from Fauxton `medic` DB `_id`.  
> For camp ID: open Camp → URL ends with camp UUID.  
> For participant ID: open Participant → URL ends with participant UUID.

---

## 12) What your colleague SHOULD do — todo list

| # | Task | Done? |
|---|---|---|
| 1 | Clone both repos to `C:\Projects\EMRCHT\` as siblings (section 4). cht-core uses `defaultname-ayan/cht-core-satoru-reports` `main` branch. | ☐ |
| 2 | Install Node 22, Yarn, Python 3.10, Docker Desktop (WSL2), `cht` CLI | ☐ |
| 3 | Run `python3 scripts/gen_report_config.py` in satoru-config and verify `report_display` + translations generated | ☐ |
| 4 | Start stack via WSL (`cht-docker-compose` / `docker start ...`) and confirm URLs load | ☐ |
| 5 | **Deploy config:** `python3 scripts/upload_app_settings.py` + `python3 scripts/upload_translations.py` (section 6b) — **THIS fixes `report.vineland.*`**. | ☐ |
| 6 | Docker images are published 5.3.0 — no webapp rebuild needed | ☐ |
| 7 | Browser hard refresh, test Vineland/DST/DDST/MoCA reports per section 10 | ☐ |
| 8 | Test `Print / Save as PDF` button in Reports detail | ☐ |
| 9 | Run `camp-workbook` + `participant-report` Python exports on a real camp (NIMS) and verify sheets | ☐ |
| 10 | Commit + push both repos: `satoru-config` → `main`, `cht-core` → `defaultname-ayan/cht-core-satoru-reports` `main`. Do NOT commit `.env`, `node_modules`, `*.xlsx` outputs. | ☐ |
| 11 | Clean up temp files (`check_*.py`, `verify_*.py`, `upload_*.py` if any remain — now gitignored) | ☐ |

**Git push guide:**

```bash
# satoru-config
cd /mnt/c/Projects/EMRCHT/satoru-config
git status
git add scripts/scale_meta.py scripts/scale_export.py scripts/gen_report_config.py scripts/export_emr.py translations/messages-en.properties app_settings.json app_settings/base_settings.json
git commit -m "feat(reports): human-readable labels, Print/PDF, camp+participant Excel (DDST/DST/MoCA/VSMS)"
git push origin main

# cht-core (push to YOUR fork, not upstream medic)
cd /mnt/c/Projects/EMRCHT/cht-core
git remote -v
# origin should point to defaultname-ayan/cht-core-satoru-reports
git status
git add webapp/src/ts/services/format-data-record.service.ts webapp/src/ts/services/print-report.service.ts webapp/src/ts/modules/reports/reports-content.* webapp/src/css/inbox.less webapp/web-components/cht-form/src/app.component.html api/resources/translations/messages-*.properties
git commit -m "feat(reports): human-readable scale reports, Print/Save as PDF, choice resolution"
git push origin HEAD
```

---

## 13) Commands cheat sheet (copy-paste)

```bash
# --- WSL Ubuntu — start / stop ---
wsl -d Ubuntu bash -lc "docker start satoruemr-dir-cht-upgrade-service-1 satoruemr-nouveau-1 satoruemr-couchdb-1 satoruemr-haproxy-1 satoruemr-api-1 satoruemr-sentinel-1 satoruemr-nginx-1"
wsl -d Ubuntu bash -lc "docker stop  satoruemr-nginx-1 satoruemr-api-1 satoruemr-sentinel-1 satoruemr-haproxy-1 satoruemr-nouveau-1 satoruemr-dir-cht-upgrade-service-1 satoruemr-couchdb-1"

# --- Regen + upload config ---
cd /mnt/c/Projects/EMRCHT/satoru-config
python3 scripts/gen_report_config.py
python3 scripts/upload_app_settings.py
python3 scripts/upload_translations.py --url=https://172-27-250-199.local-ip.medicmobile.org:10443 --file=translations/messages-en.properties

# --- Exports ---
cd /mnt/c/Projects/EMRCHT/satoru-config/scripts
python3 export_emr.py --url "https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443/medic" --scope="camp-workbook=<CAMP_ID>" --out ./out
python3 export_emr.py --url "https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443/medic" --scope="participant-report=<PART_ID>" --out ./out

# --- Verify translations live ---
curl -k https://medic:password@172-27-250-199.local-ip.medicmobile.org:10443/medic/_design/medic 2>/dev/null | python3 -m json.tool | grep -A2 report_display | head
```

> Replace `172-27-250-199` with your current `hostname -I` dashed IP every time Wi-Fi changes.

---

## 14) Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `report.vineland.item_N_score` still visible | `app_settings.json` not uploaded | Re-run `cht upload-app-settings` (section 6b) + hard refresh |
| Values show `yes` / `p` / `pass` lowercase | Same — `choice_map` lives in `report_display` | Same fix |
| No `Print / Save as PDF` button | Webapp bundle stale | `yarn build` + rebuild images + restart api |
| WSL integration unexpectedly stopped | Docker Desktop WSL crash | `wsl --shutdown` → reopen Docker Desktop → re-enable Ubuntu integration → `docker start ...` |
| `docker` not found in Ubuntu | Integration off | Docker Desktop → Settings → Resources → WSL Integration → Ubuntu = ON |
| `Exec format error` from docker-desktop-user-distro | WSL kernel old / corrupted socket | `wsl --update` then `sudo rm /var/run/docker.sock` → restart Docker Desktop |
| CHT page blank after restart | CouchDB not ready | `docker restart satoruemr-couchdb-1` , wait 20s |
| Python `ModuleNotFoundError: openpyxl` | Deps missing | `pip install openpyxl requests` |
| Export XLSX has only `Participants` sheet | No reports for that camp / wrong campId | Check Reports filtered by camp, copy correct camp UUID from People URL |

---

## 15) What to tell your colleague in one paragraph

> The Satoru app runs as two sibling folders under `C:\Projects\EMRCHT\`: `cht-core` (platform) and `satoru-config` (our forms/settings). Docker runs the platform via `cht-docker-compose` inside WSL Ubuntu (project `satoruemr`, ports `10443/10080`), and `satoru-config` is compiled & uploaded into it with `cht upload-app-settings`. All human-readable report work is driven by `scripts/gen_report_config.py` which parses the 4 form XMLs (`ddst/dst/moca_assessment/vineland`) → generates `report_display` in `app_settings.json` + `report.*` keys in `translations/messages-en.properties` → consumed by the patched `format-data-record.service.ts` (Reports UI) and `scripts/scale_export.py` (Excel). The `report.vineland.*` bug you see means `app_settings.json` hasn't been re-uploaded and/or the webapp Docker image hasn't been rebuilt — follow sections 6b+6c, then hard-refresh. Python exports are run directly against CouchDB (`scripts/export_emr.py --scope=camp-workbook=<campId>`) and are the correct way to get per-scale sheets; the CHT UI Export button still produces the old flat CSV.

---

*Keep this file at `C:\Projects\EMRCHT\HANDOFF_GUIDE.md` and commit `satoru-config` + `cht-core` patches before handing over. Do NOT commit `satoruemr.env`, `node_modules/`, or `out/*.xlsx`.*
