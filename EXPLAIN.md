# What is all this — in simple words

## The big idea

**CHT** (Community Health Toolkit) is a free app made by a company called
Medic. Health workers use it in a browser to register people, fill forms and
see reports. We did not write CHT. We took it and changed a few files.

**Satoru EMR** is our use of it: screening camps, participants, and four
child/adult development tests — **DDST-II, DST, MoCA, VSMS**.

Think of it like a car:

- **cht-core** = the engine (the app itself)
- **satoruemr** = the fuel (our forms, labels, settings, Excel export)

The engine does nothing useful without the fuel, and the fuel is useless
without the engine.

---

## How CHT works

```
your browser
     │
     ▼
  nginx          the front door, handles https
     │
     ▼
  api            hands the browser the app (main.js) and talks to the database
     │
     ▼
  CouchDB        the database: every person, camp, report and setting lives here
```

Plus **sentinel** (does background jobs) and **haproxy / nouveau**
(helpers for the database). All of these run as **Docker containers** — little
boxes on your machine. Seven of them.

Two things to remember:

1. **The app you see is `main.js`.** It is one big file made ("built") from
   the code. The code files themselves are never used directly. Change code →
   you must build again and copy `main.js` into the api box, or nothing
   changes.
2. **Settings and labels live in the database**, not in the code. You put them
   there with the `cht` command ("upload"). That is how CHT knows a question is
   called "1. Cries, laughs" instead of `report.vineland.g_y0_1.item_1`.

---

## The two folders

```
~/work/EMRCHT/
  cht-core/      the engine
  satoruemr/     the fuel
```

### cht-core — the files we changed

Everything else in this folder is Medic's normal CHT. Only these are ours:

| File | What it does |
|---|---|
| `webapp/src/ts/services/format-data-record.service.ts` | Makes reports readable. Hides junk fields, turns `yes` into `Yes`, `P` into `Pass`, shows age as "1 year 1 month" |
| `webapp/src/ts/services/print-report.service.ts` | The **Print / Save as PDF** and **Print all scales for this participant** buttons |
| `webapp/src/ts/modules/reports/reports-content.component.ts` and `.html` | Puts that button on the report screen |
| `webapp/src/css/inbox.less` | How the button looks |
| `webapp/src/ts/services/exact-search.service.ts` | **New:** full-name / full-ID search (below) |
| `webapp/src/ts/services/search.service.ts` | One small change: calls the file above |
| `webapp/src/js/enketo/medic-xpath-extensions.js` | Fixes a CHT bug: times were saved one hour off for India |
| `webapp/src/ts/services/participant-access.service.ts` | **Intern privacy** (Varshini): interns see only people they registered in the last 24 h; others only after an exact search. Supervisors see everyone. Used by People, Reports, profiles and forms |

And some notes for people:

| File | For who |
|---|---|
| `EXPLAIN.md` | you — this file |
| `RUNBOOK.md` | anyone setting it up or fixing it |
| `AGENTS.md` | AI coding helpers |
| `SATORU.md` | short "what changed" summary |

### satoruemr — the important files

| File / folder | What it is |
|---|---|
| `forms/app/ddst.xml`, `dst.xml`, `moca_assessment.xml`, `vineland.xml` | The four tests. The questions and answer choices |
| `forms/contact/` | The forms to create a camp and a participant |
| `app_settings.json` | All settings, uploaded to the database. Includes `report_display` (how reports look) and `search_exact_match` (the new search rule) |
| `translations/messages-en.properties` | The English words for every label |
| `scripts/gen_report_config.py` | Reads the four test forms and writes the labels + `report_display` for you. Run it after changing a form |
| `scripts/scale_meta.py` | The brain behind the above — reads the form XML |
| `scripts/export_emr.py` | Makes the Excel files |
| `scripts/export_server.py` | The web page with "Download" buttons for Excel. Only CHT admins who are logged in can use it |
| `scripts/forms_panel.py` | The **Forms** page: upload an Excel form, it gets checked and tested, then you press Publish |
| `tests/forms/` | Scoring tests: fill each scale with known answers and check the scores |
| `SCORING_AUDIT.md` | Every scoring bug found, fixed or still open |
| `PRODUCTION.md` | What must be done before real patients use it |
| `deploy/` | Puts that Excel page inside the same Docker setup, at `/exports/` |
| `scripts/load_sample_data.py` | Fills the database with fake test people |
| `scripts/validate_*.py` / `.js` | Tests that check things still work |
| `SETUP.md` | Full setup steps |

---

## The new feature: full-name search only

**Before:** type `Ka`, press Enter → every Kamala, Kavya, Karthik shows up.

**Now:** a person only shows up if you type their **whole** name, **whole**
participant ID, or **whole** phone number.

| You type | You get |
|---|---|
| `Kamala` | nothing |
| `Kamala Devi` | Kamala Devi |
| `NIMS-797` | nothing |
| `NIMS-79704` | Kamala Devi |
| `9000010001` | Kamala Devi (full phone, with or without +91) |

Big or small letters and extra spaces don't matter. It works in both the
**People** and **Reports** search bars.

It is **switched on by a setting**: `"search_exact_match": true` in
`satoruemr/app_settings.json`. Remove it (or set `false`) and normal CHT
search comes back — no rebuild needed, just upload settings again and refresh.

How it works: CHT's normal search still runs and finds everyone who
*starts with* what you typed. Then our new file throws away anyone whose
full name / ID / phone isn't an exact match, before the list is shown.

---

## To make a change show up

| You changed | Do this |
|---|---|
| A file in `cht-core/webapp` | Build → `build api` → `up -d api` (RUNBOOK.md Step 1) |
| A form | Upload the .xlsx at `/exports/forms/` |
| A label or `app_settings.json` | `gen_report_config.py` → `cht ... upload-app-settings` → refresh the browser (RUNBOOK.md Step 2) |
| An Excel script | Rebuild the exports box: `docker compose ... build exports`, then `up -d` |

That table is the answer to almost every "why don't I see my change?".
