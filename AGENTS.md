# AGENTS.md — context for an AI coding agent

Read this fully before acting. It is written to prevent the three failures
that have already cost days on this project.

---

## 0. The single most common mistake

**Cloning this repo changes nothing about a running CHT instance.**

CHT serves a *compiled* JavaScript bundle from inside the `api` Docker
container. It never reads this source tree at runtime. If someone clones
this repo and says "the Print button isn't showing" or "reports still show
raw codes", the cause is almost always that they cloned and stopped.

Three separate things must happen, and **neither works without the other**:

| # | Action | Without it |
|---|---|---|
| 1 | Build the webapp and copy it into the `api` container | No Print button. UI is stock CHT. |
| 2 | Upload the `satoruemr` config to CouchDB | Reports render raw keys like `report.ddst.g_lang.lang_18` |
| 3 | Hard-refresh the browser | Stale cached translations, looks like nothing changed |

Full procedure in §4 and §5.

---

## 1. What the two repos are

```
cht-core   (this repo)  the CHT platform + a 5-file patch     = the ENGINE
satoruemr               forms, labels, settings, exports      = the FUEL
```

- **This repo** is `medic/cht-core` at tag **5.3.0** plus a patch that makes
  DDST-II / DST / MoCA / VSMS assessment reports render readable labels and
  adds a Print / Save-as-PDF button.
- **The patch is config-gated and inert on its own.** It only activates for
  a form that has an entry in `settings.report_display`. That config does
  not live here — it is generated in the `satoruemr` repo from the form XML
  and uploaded to CouchDB.
- A form with no `report_display` entry renders exactly as stock CHT, so
  this patch is safe for any other deployment.

Config repo: https://github.com/donthireddysaivarshini/satoruemr
branch `feat/exports-and-deploy` — its `SETUP.md` is the companion to this
file. Clone the two side by side:

```
EMRCHT/
  cht-core/
  satoruemr/
```

This repo is **not a GitHub fork**. Its root commit is a parentless
snapshot of upstream tag 5.3.0 (the original clone was shallow and GitHub
rejects shallow pushes). Consequence: it shares **no history** with
`donthireddysaivarshini/cht-core`. `git merge-base` between them returns
nothing, rebasing conflicts across ~420 files, and GitHub will not offer a
PR between them. Move changes as `git format-patch` / `git am`, or copy
individual files with `git checkout <ref> -- <path>` (that works across
unrelated histories).

---

## 2. The 5 patched files

| File | Role |
|---|---|
| `webapp/src/ts/services/format-data-record.service.ts` | Hides internal/calc fields, resolves choice values via the form's own lists (`yes`→`Yes`, `P`→`Pass`), joins chronological-age helpers into one row, attaches per-item scores, formats dates, suppresses empty rows. Entry point: `getScaleDisplayFields()`, reached only when `settings.report_display[doc.form]` exists. |
| `webapp/src/ts/services/print-report.service.ts` | **New.** Renders the same formatted rows into `#report-print-view` and calls `window.print()`. Labels go through `TranslateService` for xml reports. |
| `webapp/src/ts/modules/reports/reports-content.component.ts` | `printReport(selection)` |
| `webapp/src/ts/modules/reports/reports-content.component.html` | The button, `test-id="report-print"` |
| `webapp/src/css/inbox.less` | `.report-print-btn`, hidden in `@media print` |

Scoring is never recalculated anywhere. Stored form results are displayed
as-is.

---

## 3. Hard constraints — do not violate these

### 3.1 Use CHT **5.3.0** Docker images, never 5.2.0

The webapp calls `POST /api/v1/report/summary`. The published 5.2.0 API
does not have that route. Against 5.2.0 it returns 404 and the **Reports
view hangs on a spinner forever**.

```
public.ecr.aws/medic/cht-api:5.3.0        (and cht-sentinel, cht-nginx,
public.ecr.aws/medic/cht-couchdb:5.3.0     cht-haproxy, cht-couchdb-nouveau)
```

### 3.2 Build with `--configuration=production`

`webapp/angular.json` has `defaultConfiguration: None`. A bare `ng build`
inlines "critical CSS" into `index.html`. That inlined copy of
`.bootstrap-layer{display:flex}` is **unlayered**, so it beats
`.bootstrapped .bootstrap-layer{display:none}` — the app renders fully but
stays hidden behind a permanent loading spinner.

The production configuration sets `inlineCritical:false` and
`deleteOutputPath:false`.

**Verification:** built `index.html` must be **~850 bytes**. If it is
~56 KB, critical CSS was inlined and the app will hang.

### 3.3 Generate `enketo.less` before building

`ng build` fails without it:

```bash
npx sass webapp/src/css/enketo/enketo.scss \
         api/build/static/webapp/enketo.less --no-source-map
```

### 3.4 Node 22.x

`package.json` requires `>=22.15.0`. Node 25 is untested here.

---

## 4. Build and deploy the webapp

```bash
cd cht-core
npx sass webapp/src/css/enketo/enketo.scss api/build/static/webapp/enketo.less --no-source-map
cd webapp && npm ci && npm run build -- --configuration=production && cd ..

# verify BEFORE deploying
test $(stat -c%s api/build/static/webapp/index.html) -lt 5000 || echo "CRITICAL CSS INLINED - rebuild with --configuration=production"
grep -c getScaleDisplayFields api/build/static/webapp/main.js   # expect >= 1

cd api/build/static/webapp
for f in main.js runtime.js polyfills.js scripts.js styles.css index.html; do
  docker cp $f <api-container>:/service/api/build/static/webapp/$f
done
docker restart <api-container>
```

`docker cp` writes to the container's writable layer. It **survives
`docker restart` but not `docker compose up --force-recreate`** — recreating
the api container silently reverts the webapp to stock. Redeploy after any
recreate.

The api regenerates its own service worker (workbox) on start. Do not
hand-write `service-worker.js`; a SW that calls `registration.unregister()`
makes the worker `redundant`, which rejects the bootstrapper promise and
hangs the app.

---

## 5. Upload the config (required, or reports stay raw)

```bash
cd satoruemr
python scripts/gen_report_config.py     # regenerate report_display + labels from forms/app/*.xml
cht --url=https://medic:PASSWORD@<HOST>:10443 --accept-self-signed-certs --force \
    upload-app-settings upload-app-forms upload-contact-forms upload-custom-translations
```

- `--force` is required. Without it `cht-conf` prompts before overwriting
  and dies in any non-interactive shell.
- Re-run `gen_report_config.py` after **any** change to `forms/app/*.xml`.
- **Hard-refresh the browser afterwards** (Ctrl+Shift+R). CHT caches
  translations client-side; without the refresh it looks like the upload
  did nothing.

---

## 6. Verifying — prefer the API over clicking

```bash
# report_display present?
curl -sk "https://medic:PASS@<HOST>:10443/api/v1/settings" | python3 -c \
  "import sys,json;print(list(json.load(sys.stdin).get('report_display',{}).keys()))"
# expect ['ddst','dst','moca_assessment','vineland']

# translations live?
curl -sk "https://medic:PASS@<HOST>:10443/medic/messages-en" | python3 -c \
  "import sys,json;d=json.load(sys.stdin);l={**(d.get('generic') or {}),**(d.get('custom') or {})};print(len([k for k in l if k.startswith('report.')]))"
# expect ~810

# patched bundle actually being served?
curl -sk https://<HOST>:10443/main.js | grep -c getScaleDisplayFields
```

Offline validators (no server needed), run from `satoruemr`:

```bash
python scripts/validate_exports.py      # 58 checks
node scripts/validate_report_patch.js   # 50 checks; needs ../cht-core/node_modules/typescript
```

> **Do not verify report rendering by clicking through the Reports list in
> an automated browser.** Doing so previously deleted two report documents
> from CouchDB. Read the DOM or query the API instead.

---

## 7. Symptom → cause

| Symptom | Cause | Fix |
|---|---|---|
| No Print button; UI looks stock | webapp never built/deployed | §4 |
| Reports show `report.dst.g_child.assessment_date` | config/translations not uploaded | §5 |
| Same raw keys after uploading | browser cached translations | hard-refresh |
| App stuck on a spinner forever | built without `--configuration=production`, **or** running 5.2.0 images | §3.2 / §3.1 |
| Print output shows raw keys but on-screen is fine | old `print-report.service.ts` that used `field.label` directly | this repo already has the fix |
| Everything reverted after a compose command | api container was recreated, not restarted | redeploy §4 |
| `ng build` fails on `enketo.less` | §3.3 not run | §3.3 |
| cht-conf exits at "overwrite?" | no TTY | add `--force` |
| `permission denied ... docker.sock` | user not in `docker` group | `sudo usermod -aG docker $USER`, re-login |

---

## 8. Excel exports

Separate from the report UI. Implemented in Python in `satoruemr/scripts/`,
read-only against CouchDB, and shipped as a container in the same Docker
stack (`satoruemr/deploy/cht-exports.yml`), served at
`https://<host>:10443/exports/`.

Scopes: `all-workbook` (everyone, every camp), `camp-workbook=<campId>`,
`participant-report=<participantId>`. See `satoruemr/scripts/EXPORTS.md`.

Labels come from the same form XML + translations the Reports UI uses
(`scale_meta.py`), so exports and on-screen reports can never disagree.


---

# Upstream CHT Core agent reference

*Everything below is CHT Core's own AGENTS.md from tag 5.3.0, unchanged.*

## CHT Core Quick Reference

## MCP Servers

AI agents should query these MCP servers for detailed project information:

- **CHT Docs MCP** (via Kapa.ai) - Full CHT documentation: setup instructions, architecture, code conventions, contributing guides
  - URL: `https://mcp-docs.dev.medicmobile.org/mcp`
- **OpenDeepWiki MCP** (for medic/cht-core) - Codebase navigation, repository structure, and code-level documentation
  - URL: `https://opendeepwiki.dev.medicmobile.org/api/mcp`

---

## Monorepo Structure

- **`api/`** — Node.js server providing REST APIs, security, and filtered CouchDB replication
- **`sentinel/`** — Node.js service that runs transitions (validations, scheduled messages, alerts) on every CouchDB document change
- **`webapp/`** — Angular + NgRx single-page app for care teams (the main CHT web UI)
- **`admin/`** — AngularJS single-page app for program administrators ("App Management")
- **`shared-libs/`** — npm workspaces containing shared libraries used across services (e.g. `cht-datasource`, `transitions`, `rules-engine`)
- **`config/default/`** — Default CHT app configuration used for testing
- **`tests/`** — Integration and e2e tests that run against a live CHT instance
- **`scripts/`** — Build, CI, and deployment helper scripts

---

## Architecture Overview

NGINX proxies requests to the API service, which connects to CouchDB via HAProxy. Sentinel runs as a background service processing every CouchDB document change. The Webapp uses PouchDB for offline-first sync with CouchDB.

For full architecture details, query the CHT Docs MCP or see https://docs.communityhealthtoolkit.org/technical-overview/architecture/cht-core/

---

## Dev Environment Setup

- **Node.js 22.x**, **npm 10.x**, **Docker**, `xsltproc`, `jq`, `git`, `make`, `g++`
- Set env vars: `COUCH_NODE_NAME=nonode@nohost` and `COUCH_URL=http://medic:password@localhost:5984/medic`
- Start CouchDB via Docker, then run 3 terminals: `npm run build-dev-watch`, `npm run dev-api`, `npm run dev-sentinel`

For full setup instructions, query the CHT Docs MCP or see https://docs.communityhealthtoolkit.org/community/contributing/code/core/dev-environment/

---

## Where to Put New Code

- **New service-level code** → `api/src/`, `sentinel/src/`, or `webapp/src/ts/`
- **New unit tests** mirror the source path: `api/src/foo.js` → `api/tests/mocha/foo.spec.js`
- **New shared functionality** used by multiple services → `shared-libs/`
- **New e2e tests** → `tests/e2e/default/`
- **New integration tests** → `tests/integration/`

---

## Code Style & Conventions

- TypeScript for `webapp/` and newer shared-libs; JavaScript (CommonJS) for `api/`, `sentinel/`, `admin/`
- 2-space indentation, single quotes, semicolons required
- `const`/`let` only (never `var`); strict equality (`===`) throughout
- `lowerCamelCase` for functions, `ALL_UPPERCASE` for constants, `snake_case` for CouchDB properties

For full style guide, query the CHT Docs MCP or see https://docs.communityhealthtoolkit.org/community/contributing/code/style-guide/

---

## npm Commands

### Build & Lint

```bash
npm run build-dev           # development build (webapp + shared-libs)
npm run build-dev-watch     # build + watch for changes
npm run lint                # ESLint + blank-link-check + shellcheck
npm run lint-translations   # check translation files
```

### Unit Tests

Unit tests run entirely in-process — no running CHT instance required.

```bash
npm run unit                # all unit tests: webapp + admin + shared-libs + api + sentinel

# Run individual service unit tests:
npm run unit-webapp         # Angular (Karma) + mocha timezone tests
npm run unit-admin          # Karma (AngularJS admin app)
npm run unit-api            # Mocha — files: api/tests/mocha/**/*.js
npm run unit-sentinel       # Mocha — files: sentinel/tests/**/*.js
npm run unit-shared-lib     # npm workspaces test across all shared-libs
```

### Integration Tests

Require a running CHT instance (typically started via Docker in CI).

```bash
npm run integration-api             # API integration tests (used by `npm test`)
npm run integration-sentinel-local  # build images + run sentinel integration tests locally
npm run integration-all-local       # build images + run all integration tests locally
npm run integration-cht-form        # WebdriverIO tests for cht-form component
```

### E2E Tests

Require a fully running CHT instance and Chrome. Run via WebdriverIO (`wdio`).

```bash
npm run ci-webdriver-default         # default e2e suite
npm run ci-webdriver-default-mobile  # mobile e2e suite
npm run upgrade-wdio                 # upgrade scenario e2e tests
```

### Full CI Test Command

```bash
npm test    # lint + unit tests + integration-api
```

### Default Config Tests

```bash
npm run test-config-default    # runs tests in config/default/
```

---

## Testing Conventions

- Mocha + Chai + Sinon for `api/` and `sentinel/` tests; Karma for `webapp/` and `admin/`
- WebdriverIO + Page Object pattern for e2e tests
- Test files named `*.spec.js` or `*.spec.ts`; call `sinon.restore()` in `afterEach`
- Unit tests must not require a running CouchDB or CHT instance (`UNIT_TEST_ENV=1` stubs external calls)

For full testing guide, query the CHT Docs MCP or see https://docs.communityhealthtoolkit.org/community/contributing/code/core/automated-tests/ and https://docs.communityhealthtoolkit.org/community/contributing/code/core/style-guide-automated-e2e-tests/

---

## Static Analysis

ESLint (flat config at `eslint.config.js`) and SonarCloud both gate PRs. Run `npm run lint` before every commit.

For details, query the CHT Docs MCP or see https://docs.communityhealthtoolkit.org/community/contributing/code/static-analysis/

---

## Commit Format

Conventional Commits are used and enforced by CI:
```
feat(#1234): short description
fix(#1234): short description
chore(#1234): short description
test(#1234): short description
```
The parenthetical must contain the issue number, not a component name.

### Branching

- Branch off `master`; open PRs against `master`
- Branch naming: `<issue-number>-short-description`

---

## CI

GitHub Actions runs on Node 22.15. The main CI pipeline runs:

1. `npm run lint`
2. `npm run unit`
3. `npm run integration-api`

E2e and full integration tests run on separate CI jobs (require Docker image builds).

---

## PR Workflow

- PR title must match the Conventional Commits format
- Squash and merge by default
- Use draft PRs for early collaboration
- Self-review before requesting reviewers

For full workflow details, query the CHT Docs MCP or see https://docs.communityhealthtoolkit.org/community/contributing/code/workflow/

---

## Key Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `COUCH_URL` | Yes | — | Full CouchDB URL e.g. `http://medic:password@localhost:5984/medic` |
| `COUCH_NODE_NAME` | Yes | — | CouchDB node name e.g. `nonode@nohost` |
| `API_PORT` | No | `5988` | Port the API listens on |
| `CHROME_BIN` | No | — | Path to Chrome binary (needed for some test environments) |
