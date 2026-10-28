# Nova Retail CRM

A complete CRM Lite workspace for an Indonesian smartphone retailer. The UI combines a Dynamics-style workspace, a HubSpot-inspired relationship workflow, and a Lightning-style executive overview.

## Start with one command

Install **Docker Desktop** (Windows/macOS, using Linux containers) or **Docker Engine with Compose v2** (Linux). Start Docker, open a terminal in this directory, and run:

```bash
docker compose up -d
```

Open **http://localhost:8080**.

The first launch builds both applications, waits for PostgreSQL, applies the included Prisma migrations, initializes demo data, and starts the web application. Allow a few minutes for the initial image downloads and build. No local Node.js, npm, or PostgreSQL installation is required.

```bash
docker compose ps
docker compose logs -f backend
```

All three services should become healthy. The frontend is started only after the backend is healthy.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@nova.example` | `AdminDemo2026!` |
| Manager | `manager@nova.example` | `ManagerDemo2026!` |
| Sales | `sales@nova.example` | `SalesDemo2026!` |

The demo login screen has buttons that fill these credentials. Two additional demo salespeople, `nadia@nova.example` and `andi@nova.example`, use the Sales password.

**These are public demo credentials, not production credentials.** Use this default configuration only for local evaluation.

## Features

- **Executive dashboard:** customer, lead, and opportunity counts; current/previous month revenue; three-month revenue and weekly sales charts; branch performance; customer lifecycle; opportunity outcomes; activity channels; lead sources; pipeline stages; top products; top salespeople; recent activities.
- **Customers and contacts:** complete CRUD, segments, ownership, contact details, and notes.
- **Leads:** source tracking, product interest, ownership, status filtering, and optional customer links.
- **Opportunities:** customer relationships, deal values, stages, win probabilities, and expected closing dates.
- **Activities:** calls, emails, meetings, tasks, and follow-ups, with due dates and customer/opportunity links.
- **Products:** SKU, brand, specifications, IDR price, available stock, and active/inactive status.
- **Sales transactions:** multi-product invoices, server-calculated totals, historical price snapshots, and atomic inventory movements.
- **Team administration:** create/edit/disable users, assign roles, and set passwords.
- **Responsive interface:** mobile navigation, accessible Radix-based dialogs, loading/error/empty states, search, pagination, status filters, and CSV export of the current page.
- **Transaction filters:** combine city/branch, salesperson, and sale period with search and status. Periods use `soldAt` in WIB (`Asia/Jakarta`): Monday–Sunday weeks, calendar months, and calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec), including the full selected period. Default: all time. Changing a filter resets pagination; counts and current-page CSV exports use the filtered results. City refers to the transaction branch, not the customer's address. Sale timestamps display in WIB in the table and details; CSV retains the original ISO 8601 timestamps.
- `GET /transactions` accepts optional `branch` (branch enum), `salespersonId` (user ID), and `period=all|week|month|quarter`. Invalid filters return HTTP 400. `GET /transactions/filter-options` returns only IDs/names of salespeople with visible transactions, including inactive users with historical sales. Filters never expand Sales ownership access. The sidebar promotional card has been removed; the header help button still opens the workspace guide.
- **AI Copilot:** floating launcher opens a dedicated full-screen workspace in a new tab, Indonesian-only responses and Copilot controls, eleven tasks including grounded charts/process diagrams and directly calculated salesperson rankings, scoped record search, source links, cancellation and explicit Azure configuration/error states.

### Role permissions

This is a **single-company workspace with Sales ownership isolation**. Admins and Managers can access company-wide CRM data. Sales users can access only their own records, including dashboard metrics, searches, exports, lookup options and AI Copilot.

| Action | Sales | Manager | Admin |
|---|:---:|:---:|:---:|
| View dashboard and CRM records | Own records only | Company-wide | Company-wide |
| Create/edit customers, contacts, leads, opportunities, activities, transactions | Own records only | Yes | Yes |
| Delete CRM records and transactions | No | Yes | Yes |
| View products | Yes | Yes | Yes |
| Team assignment options | Self only | All | All |
| AI Copilot | Own records only | Company-wide | Company-wide |
| Create/edit/delete products | No | Yes | Yes |
| List/manage user accounts | No | No | Yes |

Permissions are enforced in the API, not only in the UI. Users cannot delete or disable their own administrator account. Referenced users cannot be deleted; reassign their records or disable their accounts instead.

Customers, leads, opportunities and activities use `ownerId`; contacts inherit their customer's owner; transactions use `salespersonId`. Sales cannot assign to someone else or link another user's customer/opportunity. **Existing cross-owner relationships are not rewritten**: rows linked to a foreign-owned customer/opportunity are hidden from Sales, even if the primary row is assigned to them, so nested details cannot disclose another person's records. Admins/Managers must align ownership before handing over such records. Deletion remains restricted to Admin/Manager; products remain a shared catalogue.

## Excel reports

Every resource-page export (Customers, Contacts, Leads, Opportunities,
Activities, Products, Sales transactions and Team management) downloads a real
`.xlsx` workbook using the **Export Excel (page)** button. Reports share a
navy-and-gold Nova cover header, preparation timestamp/name, access scope,
active filters, exported/matching record counts, alternating row fills and
status colors. Column headings and the first column stay frozen; Excel filters,
column widths, wrapping and landscape print settings are included.

Exports contain **only the currently displayed page**, not all matching records.
Currency, stock and probability remain numeric with Excel formatting. Dates
use WIB (UTC+7), explicitly labeled in the workbook. Rupiah columns include a
page subtotal that updates when filtering rows in Excel; opportunity values
and pending/cancelled transaction amounts are not relabeled as realized revenue.
Phone numbers, SKU codes and formula-looking user text remain plain text.
Only the configured report columns and secondary display field are exported,
never passwords, tokens or unrestricted raw API objects. The Excel library
loads on demand when exporting rather than on initial navigation.

## Existing Linux VM deployment

Lead and Opportunity forms use a searchable **Product interest** selector
from the Products catalog. New choices must be active catalog products;
existing inactive choices can be kept when editing. The selected product
is saved as a product reference and carried from a lead into its converted
opportunity. Choosing a product does not change stock or automatically set
the opportunity value. Legacy lead interest text is preserved; the migration
links only unique exact catalog-name matches, leaving ambiguous/unmatched
text unchanged. Product selection remains optional.

For a shared demo VM, use the normal Compose file together with
`docker-compose.vm.yml`. This keeps the PostgreSQL and API ports private, adds
per-service memory/CPU limits and rotating logs, and provides a Caddy HTTPS
gateway with persistent certificate storage.

Set these additional values in the private `.env` on the VM:

```dotenv
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=18080
NOVA_DOMAIN=your-hostname.example.com
```

Use unique random database and account passwords and a JWT secret, not the
local demo defaults. Point the hostname to the VM public IP and allow inbound
TCP 80 and 443 for HTTPS issuance/renewal and HTTP redirects. Do not expose
PostgreSQL or the backend API separately.

```bash
docker compose -p novacrm -f docker-compose.yml -f docker-compose.vm.yml build
docker compose -p novacrm -f docker-compose.yml -f docker-compose.vm.yml up -d --wait
docker compose -p novacrm -f docker-compose.yml -f docker-compose.vm.yml ps
```

The deployed demo uses `https://sisagent.indonesiacentral.cloudapp.azure.com`
and `/opt/apps/novacrm` on the existing VM. Credentials remain in the VM's
private `.env`; a private local login copy is kept in
`.runtime/novacrm-vm-login.txt` and is ignored by Git. Never publish either
file. Deployment starts a separate `novacrm` project and does not stop or
modify existing ERPNext containers.

The gateway reserves ports 80/443. Additional applications must use unique
Compose project names, volumes and private host ports; extend the existing
gateway with their domain routing rather than binding another gateway to
80/443. The limits are per service, not a guarantee that five applications
will fit in a 4 GB VM under load. Monitor actual usage before adding more.
Persistent volumes are not backups: retain database dumps off the VM and
never run `down -v` on data you want to keep.

## Azure OpenAI Copilot

### Guided deployment on Windows

Run the interactive wizard from the project root in a normal PowerShell terminal:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-azure-openai.ps1
```

This execution-policy setting applies only to that PowerShell process. The wizard:

1. Detects Azure CLI; if missing, asks for `INSTALL` before running the official `Microsoft.AzureCLI` winget package. Windows or winget may ask for installation/license approval. Nothing is installed silently by this project.
2. Opens device-code login, lists enabled subscriptions and asks which to use. Every subsequent Azure command explicitly targets your selection; the script does not change your CLI default subscription.
3. Offers **reuse an existing deployment** or **create a new resource/deployment**. It supports GPT-4.1-mini and GPT-4o-mini chat deployments; model versions and Standard/GlobalStandard SKUs are read from Azure's regional catalogue, not hardcoded. If no compatible model exists, choose another region on a new run or provision via Foundry.
4. Shows subscription, region, resource group/name, model/version, SKU and minimum capacity. **No resource creation, provider registration, key retrieval or local configuration changes occur until you type `DEPLOY` or `CONNECT`.** Login itself stores Azure CLI credentials as usual.
5. After consent, provisions if requested, retrieves the resource key without printing it, runs one small **billable synthetic chat test**, and atomically updates only the three Azure values in `.env`. No CRM records are sent by the test. A failed test leaves the previous `.env` unchanged.

Azure charges are separate from Copilot subscriptions. Capacity is throughput quota, **not a spending cap**. Check [Azure pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/) and configure Cost Management budgets/alerts. Catalogue availability does not guarantee subscription quota or regional capacity. GlobalStandard may process inference outside the chosen resource region; review your data-residency policy. The new-resource workflow uses a key-authenticated public endpoint for local evaluation, not a private-network production deployment.

The wizard never modifies existing deployments, rotates keys, or automatically deletes resources. Failed provisioning can leave a newly created resource/group; inspect it in Azure Portal, correct quota/permissions, then rerun using the existing-deployment option. Deleting a resource can affect other applications, so cleanup is deliberately manual. Do not run secret-bearing setup with PowerShell transcription, shell tracing or Azure CLI debug logging enabled. Keep `.env` private.

For open-ended CRM questions, the backend can let Azure OpenAI choose between two read-only function tools: `crm_analyze` for validated, bounded aggregates and `crm_search` for a small set of safe record fields. The server validates every argument, applies the same Sales ownership filters as the CRM API, and runs fixed Prisma queries; the model has no SQL or write access. Tool use is bounded to four model rounds, six calls, ten records per search, and 24 KB per tool result. Unsupported filters are reported rather than silently ignored. Catalog searches and aggregates use `all_time`; sales performance by product should query the `sales` area, not catalog stock. Record searches add permission-checked source references for the normal Copilot source controls. These tools augment existing prepared tasks and do not give the Copilot general internet or knowledge-base access.

For a no-login/no-cloud prerequisite check and offline wizard tests:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-azure-openai.ps1 -CheckPrerequisites
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-azure-setup.ps1
```

The local preview started through `backend/start.mjs` re-reads **only Azure settings** from the root `.env` on each Copilot status/chat request. After the wizard succeeds, select **Periksa lagi** in the Copilot tab; no API restart is needed. Database, JWT and other running settings are not reloaded. Any nonempty Azure process variable takes precedence as a complete group: partial process configuration does not borrow a key from the file. Other local launch methods can opt in by setting `AZURE_OPENAI_ENV_FILE` to the absolute `.env` path before starting the backend. Docker still uses Compose-injected environment variables and must recreate the backend after changes.

### Manual configuration

Copy `.env.example` to `.env` and set these **backend-only** variables:

```dotenv
AZURE_OPENAI_ENDPOINT=https://YOUR-RESOURCE.openai.azure.com
AZURE_OPENAI_KEY=YOUR_AZURE_RESOURCE_KEY
AZURE_OPENAI_DEPLOYMENT=YOUR_CHAT_MODEL_DEPLOYMENT_NAME
```

Use your deployment name, not merely a model family name. A small chat model such as a deployed GPT-4.1-mini or GPT-4o-mini is suitable. The integration uses Azure OpenAI's GA **v1 chat completions** endpoint; a root resource URL or a URL ending in `/openai/v1/` is accepted. No dated API-version setting is needed. Endpoint URLs must use HTTPS and cannot contain credentials, query parameters, or other paths. Azure must permit outbound access from the backend and have sufficient model quota.

After configuration or source changes:

```bash
docker compose up -d --build
docker compose restart frontend
```

Keep the PostgreSQL/auth volumes. Restarting frontend refreshes Nginx's backend address if Compose replaces the API container. For other standalone local launch methods, set these variables in the backend shell or opt in to `AZURE_OPENAI_ENV_FILE` as described above.

Select **Copilot** at bottom-right on any CRM page to open `/copilot` full-screen in a **new browser tab**, leaving the original page unchanged. This replaces the previous right-side panel/expand toggle. Select a task and, when requested, search for a permitted customer, lead or opportunity. Source chips also open exact records in new tabs through the normal permission-checked API, keeping the conversation visible. The page includes **Kembali ke CRM**, **Percakapan baru** and **Keluar dari Copilot** controls and works at mobile widths. Copilot controls, status messages, timestamps and chart labels use Indonesian; the system prompt requires Indonesian responses even to English questions or requests to switch language. Proper names and product brands are preserved. Other CRM pages retain their existing language. Sign-in is required before any CRM data or AI features are available; unauthenticated visitors can sign in and return directly to Copilot.

The browser copies the launching tab's existing `sessionStorage` login into each newly opened workspace tab; the opener is immediately detached. Tokens are never put in URLs or localStorage. Authentication remains tab-scoped: signing out in one tab does not sign out other tabs, so sign out or close each signed-in tab on shared devices. Directly opening the Copilot URL in an unrelated tab may require sign-in. If the browser blocks a new tab, a visible notification explains how to allow pop-ups.

Supported tasks:

| Task | PostgreSQL evidence |
|---|---|
| Customer summary | Lifecycle, segment, branch, lifetime completed sales, last purchase, contact/activity/deal counts |
| Lead summary | Source, status, branch, age/update timestamps, linked-customer presence |
| Opportunity summary | Stage, value, probability, expected close, realized sales, activity-status totals, overdue count, earliest permitted upcoming follow-up and four recent activity examples |
| Customer 360 | Customer summary plus lead stages, recent activities, largest open opportunities and top three purchased products |
| Pipeline review | Open deal aggregates by stage and five largest permitted deals |
| Sales forecast | Three monthly completed-revenue aggregates, month-end run rate, next-30-day probability-weighted pipeline |
| Risk analysis | Overdue/stale/low-probability deals, overdue activities, inactive customers, recently updated lost deals |
| Executive summary | Customer lifecycle, lead sources, open pipeline, three-month revenue, overdue activities and top three products |
| Latest leads | Up to ten permitted leads ordered by creation time descending, with creation/update timestamps, source, status and branch |
| Grafik dan diagram | Server-calculated, permission-scoped aggregates rendered as bar, line, pie charts or an illustrative sales-process diagram |

Every lead has server-managed `createdAt` and `updatedAt` timestamps, including existing historical leads. The Leads list and record details show both date and time in **WIB (Asia/Jakarta, UTC+07:00)**; CSV exports include the original ISO UTC timestamps. Creating a lead sets its timestamps automatically; editing it preserves its original creation time and advances the update time. Historical dates are not replaced with the current time.

Select **Lead terbaru**, or ask **"10 lead terakhir"**, **"10 lead terbaru"** or **"latest 10 leads"** from **Ringkasan eksekutif** (or another task without a selected record). These phrases use a fixed latest-leads query, not model-generated SQL. "Latest" means **newest created**, not most recently edited; equal timestamps are ordered by ID ascending, matching the Leads list. The query returns at most ten records and reports the actual count when fewer are available. It does not apply additional date/status filters from free text. For a selected-record task, the selected record remains the scope. Names and exact timestamps also appear in clickable source cards; names are not sent to Azure. Sales sees only owned, permitted leads; Admin/Manager sees company-wide leads.

### Executive-style answers

**Salesperson questions are not product questions.** Prompts such as `berikan informasi sales paling banyak jualan bulan ini` (including the typo `palinb`) automatically select **Peringkat sales** from a non-record task. The explicit `salesperson_ranking` task is also available. Default ordering is **completed-transaction revenue**, as agreed with the user; explicitly requesting transactions or units selects that metric. Answers include names, revenue, completed transaction counts, and recorded item quantities, calculated directly from PostgreSQL with no model call or staff names sent to Azure. They are marked **Dihitung langsung dari CRM**.

Rankings use the beginning of the current month in **WIB** through the query timestamp, not a full future month. This intentionally differs from the older dashboard/chart UTC calendar and can differ near month boundaries. Only completed transactions count; invoice revenue/counts are not multiplied by their line items. Equal metrics share a rank, with stable ID ordering for display. Default output is five names (explicit top 1–10 supported), with the total number of eligible sellers disclosed. Inactive users with historical sales remain eligible. Users without completed transactions are omitted. Missing line items are disclosed rather than inferred. Sales users get only their permitted own totals and are explicitly told this is **not a company ranking**.

Other periods, branch/product filters, and charts per salesperson are not currently supported by this ranking task; recognized requests for them receive an explicit error instead of being silently answered with a different period or entity. General model instructions also prohibit substituting top products when salesperson evidence is missing. This is a targeted intent handler, not unrestricted natural-language SQL.

Copilot renders safe Markdown with clear headings, emphasized numbers/dates, readable paragraphs and lists, responsive tables, and an insight callout. A professional Indonesian briefing starts with **Inti keputusan**, then **Fakta utama**, **Yang perlu diperhatikan**, and **Langkah berikutnya**, with a concise **Fokus keputusan** when useful. Simple lists/charts stay concise rather than forcing every section. Generated links are displayed as text; images, raw HTML and executable content are not rendered. Permission-checked source buttons remain the way to open CRM records.

The view scrolls to the opening of a newly completed briefing so the conclusion is visible first. The backend checks `[S1]`-style citations against the retrieved source list. An invented citation triggers at most one automatic regeneration using the same scoped facts and an explicit allowed-reference reminder. Invalid text is never published or merely stripped of its citations. If the regenerated answer is still invalid, a visible retryable error remains; provider errors and cancellation are not retried. Aggregate-only answers have no individual-record citations.

Executive product questions receive separate top-three rankings by recorded units and item revenue, using completed transactions in the current partial UTC month. "Produk paling banyak terjual" uses the units ranking, not the revenue shortlist; equal values are tied. The exact reporting period and missing-item limitation are supplied to the model. These are scoped aggregates, so product answers must not invent `[S...]` references.

The prompt requires evidence-based interpretation, explicit uncertainties and concrete next actions rather than generic bullets. In particular:

- A 60% CRM probability is an estimate, **not proof of a 40% failure risk**; weighted value is not realized revenue.
- No completed sales alone does **not** justify high risk or imply the opportunity is in negotiation. Its stored stage remains authoritative.
- Activity `dueAt` is its **scheduled date**, not proof of when a completed activity actually occurred or that a customer responded. The schema does not record `completedAt`.
- Opportunity follow-up advice uses the earliest future planned activity in the user's scope, even if it is absent from the four recent examples. Past planned activities are counted separately as overdue. Counts, dates, closed stages and missing evidence must inform advice.
- Executive growth/decline comparisons and pipeline totals are calculated by the server, not left to model arithmetic. Only the two completed UTC months support the supplied growth comparison; a zero baseline gives no percentage. Partial current-month revenue cannot prove continuing growth or decline. Reporting boundaries and forecast assumptions must remain explicit.
- Lead-source counts alone cannot establish marketing effectiveness or justify increased advertising spend; the assistant should recommend verifying conversion/cost evidence instead of inventing it.

Analytical answers target roughly 180-350 words (at most 400); output capacity is **1,200 tokens**, increased from 700 to allow a complete briefing. This can modestly increase output cost, while the 6 KB database-context limit and request-rate limits are unchanged. Existing plain-text responses are still readable; send a new question to obtain the richer structure.

### Grafik dan diagram in chat

Select **Grafik dan diagram**, then choose the visual type and dataset. These controls are authoritative for that task. Alternatively, ask directly from **Ringkasan eksekutif**:

- `Buat grafik garis pendapatan`
- `Buat grafik batang penjualan per cabang`
- `Buat diagram lingkaran sumber lead`
- `Buat grafik tren lead bulanan`
- `Buat diagram alur proses penjualan`

Supported datasets and **fixed reporting periods**:

| Dataset | Period and calculation |
|---|---|
| Revenue trend | Current UTC month plus two previous months; completed sales totals by sale date; current month is partial |
| New lead trend | Same three UTC months; counts by lead creation date, including zero months |
| Lead sources / statuses | Counts over all permitted leads created by query time |
| Branch revenue | Current UTC month, completed sales only; missing branch shown explicitly |
| Top products | Five highest-revenue products in completed transactions this UTC month, using historical item subtotals; not the entire catalogue |
| Opportunity stages | Current count at each stage across permitted opportunities; includes won/lost |
| Sales process | Fixed illustrative flow with current stage counts; combines QUALIFIED/QUALIFICATION; **not historical transitions, an enforced workflow, or conversion rates** |

Bar, line and pie charts render the supported CRM datasets above; the flow diagram uses the sales-process dataset only. Natural requests such as "buat grafik batang penjualan bulanan" are resolved to a supported dataset. The server reads permission-scoped PostgreSQL values, returns the chart data and a deterministic summary, and the React/Recharts frontend renders the visual; a model response is not required for a chart to appear. Each visual includes its reporting scope/period, units and an accessible exact-value table. Empty/zero data shows a clear message instead of inventing a chart. The frontend does not execute AI-generated HTML, JavaScript, SVG or Mermaid. No external rendering service is used.

Natural-language routing recognizes supported topics, not arbitrary analytics. One visual is returned per request. Arbitrary custom date ranges, branch filters and other text filters are **not applied**; the visual explicitly states its actual period and the explanation must disclose unsupported filters. For a different supported metric/type, choose the controls or ask again from Ringkasan eksekutif. Unknown topics and requests to chart a selected individual record produce an explicit error. Earlier messages are not retained as model context, so restate the subject rather than saying only "turn that into a chart."

### Data boundaries and cost controls

- Every request authenticates the current active account and queries PostgreSQL **before** calling Azure. Fixed Prisma/parameterized SQL queries enforce permissions independently of prompts; the model cannot generate/execute SQL, invoke tools, change owners or write CRM records.
- Never sends the database, full lookups or entire conversation. Context is capped at **6,000 UTF-8 bytes**, with at most **10 individual record examples** (for example, ten latest leads, or five deals, four activities and one selected customer). Aggregates are computed in PostgreSQL. Record suggestions show at most eight matches.
- Customer/contact names, email, phone, street address, notes, user identifiers and credentials are omitted from automatically retrieved model context. Relevant record aliases (`S1`, etc.) replace identities; source names remain in the authenticated browser response. Public product names may be included. Your **current question is sent to Azure**, so do not type secrets or unnecessary personal information.
- Questions are limited to **600 characters**, output to **1,200 completion tokens**, Azure time to **20 seconds**, and retrieval transactions to **10 seconds**. The proxy timeout is 45 seconds. One in-flight request per user and 12 requests/minute limit accidental spend; limits are per API process, so production multi-replica deployments need a shared rate-limit store.
- Chat is memory-only in its dedicated tab and stays available while you work in the original CRM tab or open source records in other tabs. It clears on logout/account change in that tab, page refresh, or navigation away from the Copilot page. Each question re-queries the chosen task; earlier messages are deliberately not sent. Use explicit follow-up questions rather than references to earlier replies.
- Read-only suggestions are not audited business facts. Verify important conclusions. Samples are explicitly limited; a missing record gives 404 without model invocation, and oversized context fails rather than silently omitting evidence.
- Missing, partial or malformed Azure configuration does **not** prevent CRM startup. The Copilot page displays setup instructions and disables sending. Provider failures, quota limits, refusals, cancellation and timeouts surface explicitly; there is no fabricated offline AI answer.

Forecasts are estimates, not guaranteed sales: month-end run rate = completed month-to-date revenue / elapsed UTC days * calendar days in the month (unavailable before one full day). Next-30-day weighted pipeline = sum of open opportunity value * probability / 100 with close dates in that future window; overdue deals are reported separately. These estimates are **not added together** and do not adjust for seasonality. Current-month MTD is not directly comparable to a complete previous month. Risk criteria are explicit: open deals overdue, unchanged for 30 days, or probability <=20%; recent lost counts use update timestamps because the schema has no loss-event date.

Authenticated API endpoints:

- `GET /copilot/status`: configuration availability, permission scope and supported actions; never exposes keys.
- `GET /copilot/records?entity=customers|leads|opportunities&search=...`: eight permitted ID/name suggestions.
- `POST /copilot/chat`: `{ "action": "customer_360", "recordId": "...", "prompt": "Ringkas pelanggan ini" }`. Actions: `customer_summary`, `lead_summary`, `opportunity_summary`, `customer_360`, `pipeline_review`, `sales_forecast`, `risk_analysis`, `executive_summary`, `latest_leads`, `visualization`, `salesperson_ranking`. Only the first four accept/require `recordId`. The visualization action accepts `visualization: { type, metric }`, where type is `bar|line|pie|flow` and metric is `revenue_monthly|leads_monthly|lead_sources|lead_statuses|sales_branch|top_products|pipeline_stages|sales_process`. Flow and sales_process must be paired. Unknown properties/overrides are rejected. Returns the resolved `action`, `answer`, `answerSource` (`database` for salesperson rankings, otherwise `ai`), `truncated`, `sources`, `scope`, `asOf`, and `contextBytes`; latest-lead sources also include ISO `createdAt`/`updatedAt`. Visual responses additionally contain server-owned `visualization: { type, metric, title, description, unit, points: [{ label, value }] }`; no model-generated chart payload is accepted. In the browser, use the `/api` prefix.

## Architecture

```text
Browser :8080
    |
    v
Frontend: Nginx (unprivileged)
    |-- /        React + TypeScript + Vite + Tailwind CSS
    |            shadcn/ui-style components + Radix UI + Recharts
    |
    +-- /api/* -> Express :3000
                      |-- JWT authentication + role authorization
                      |-- Zod input validation
                      |-- Prisma ORM
                      v
                 PostgreSQL 17
```

Only the frontend port is published. PostgreSQL and the backend are accessible on the private Compose network. Vite proxies `/api` during local development; Nginx provides the same routing in Docker.

### Project layout

```text
backend/
  Dockerfile
  start.mjs                 Migration -> seed -> API startup
  prisma/
    schema.prisma           Relational data model
    migrations/             Versioned PostgreSQL migration
    seed.ts                 Account bootstrap and historical seed runner
    historical-seed.sql     Atomic, additive PostgreSQL historical generator
    historical.ts           Shared SQL runner with transaction timeout
  src/
    auth.ts                 JWT login and session validation
    resources.ts            Customer/contact/lead/opportunity/activity/product CRUD
    transactions.ts         Pricing and inventory reconciliation
    users.ts                Admin-only account management
    dashboard.ts            Live aggregate metrics
    access.ts               Shared ownership and relationship access predicates
    copilot.ts              Authenticated Copilot routes and rate limits
    copilot-context.ts      Bounded PostgreSQL retrieval and computed forecasts
    azure.ts                Server-side Azure OpenAI v1 transport
  test/
    unit.test.ts            Input validation and calendar boundaries
    integration.test.ts     Real PostgreSQL/API tests
    historical.test.ts      Historical counts, chronology, trends, preservation
frontend/
  Dockerfile
  nginx.conf
  components.json           shadcn/ui configuration
  src/
    components/ui/          Local UI primitives
    pages/                  Login, dashboard, and CRUD screens
    lib/                    Typed API helpers and form definitions
docker-compose.yml
.env.example
```

### Data model

Prisma models map to these PostgreSQL tables:

| Model | Table | Key relationships |
|---|---|---|
| User | `users` | Assigned customers, leads, opportunities, activities, and sales |
| Customer | `customers` | Owner, contacts, leads, opportunities, activities, transactions |
| Contact | `contacts` | Customer |
| Lead | `leads` | Owner and optional customer |
| Opportunity | `opportunities` | Customer, owner, related activities |
| Activity | `activities` | Owner and optional customer/opportunity |
| Product | `products` | Sales line items |
| SalesTransaction | `sales_transactions` | Customer, salesperson, line items |
| SalesTransactionItem | `sales_transaction_items` | Product, quantity, immutable-on-edit unit price |
| SeedBatch | `seed_batches` | Seed version, frozen reporting period, generated counts |

The additional line-item table supports multi-product transactions without duplicating sales headers. Prices and totals use PostgreSQL `DECIMAL(18,2)`, not floating-point columns. Foreign keys, unique email/SKU/invoice constraints, and relationship indexes are included.

### Lead to opportunity conversion

On the Leads page, **Convert to Opportunity** is available in the list and detail view for **Qualified** leads. Qualify New/Contacted leads first; Lost leads must be reopened and qualified explicitly. Direct **New Opportunity** remains available for existing-customer deals.

1. Choose an existing customer with the same owner as the lead, or create a customer from the lead's name, email, phone, branch, owner and notes. Confirm the new customer's city; the branch city is only a suggestion. Existing customer profiles are not modified.
2. Confirm the suggested opportunity name, enter the deal value, probability and expected closing time (the input uses the device's timezone).
3. Save. A serializable database transaction creates/reuses the customer, creates a **Qualified** opportunity with the lead's owner/branch/notes, and marks the lead **Converted** with its conversion timestamp and linked opportunity. The UI opens the opportunity and shows a link back to the source lead.

Safety and history:

- Conversion is allowed once per lead. Concurrent/repeated requests cannot create duplicate opportunities. A stale lead snapshot returns HTTP 409 and must be reloaded. A failure rolls back every write.
- Sales can convert only their permitted leads. Even Admin/Manager conversion uses the lead's active owner, not the signed-in user. Existing customers must have that same owner so the assigned Sales user can access the resulting deal.
- New customer creation rejects existing email or normalized phone matches. For Indonesian numbers, punctuation is ignored and `08...` is compared with `+628...`. This is a conversion-time check, not a global uniqueness rule for every customer API.
- Source lead creation dates and acquisition sources are preserved. No historical records are automatically converted or matched by the migration.
- Historical leads already marked **Converted** but without a conversion link display **Konversi lead lama**. The user must explicitly confirm that they checked for an existing opportunity before creating a new one. This action does not attach an existing opportunity.
- Converted is no longer manually selectable for new/unconverted leads. Converted status cannot be reopened manually. Completed conversions keep the source lead's owner/customer fixed; notes and other descriptive fields remain editable. Sales-stage changes happen on the opportunity.
- Converted source leads and their linked opportunities cannot be deleted through the CRM, preserving the conversion trail. Use opportunity Won/Lost to finish a deal. Links and names are shown only when the user can read the related record.
- Conversion creates no transaction, stock movement, revenue or contact record.

API:

- `GET /leads/:id/conversion-customers?search=...&page=1&pageSize=5` — paginated customer selection scoped to the lead's owner and caller.
- `POST /leads/:id/convert` — authenticated conversion, returning HTTP 201 with `{ lead, opportunity, customerId }`.

```json
{
  "expectedUpdatedAt": "2026-10-27T10:00:00.000Z",
  "confirmLegacy": false,
  "customer": { "mode": "existing", "customerId": "<customer-id>" },
  "opportunity": {
    "name": "iPhone 16 - Customer name",
    "value": 15000000,
    "probability": 45,
    "expectedCloseDate": "2026-11-15T10:00:00+07:00"
  }
}
```

For a new customer, replace `customer` with `{ "mode": "new", "city": "Bandung" }`. `expectedUpdatedAt` must be the lead's current server timestamp. `confirmLegacy: true` is required only for historical Converted leads without a conversion link. Invalid fields return 400; inaccessible records return 404; invalid transitions, duplicates or stale data return 409.

The additive migration is applied automatically by the existing Docker backend startup migration step. It does not reseed or change existing lead statuses.

### Historical sample data

With `ENABLE_DEMO_DATA=true`, startup first applies migrations and then runs [historical-seed.sql](backend/prisma/historical-seed.sql). The SQL runs **after PostgreSQL is healthy and its tables exist**, rather than in PostgreSQL's pre-migration initialization directory.

The batch covers **the current month to date plus the previous two calendar months**, using UTC dates. For an initialization on 27 October 2026, the period is **1 August through 27 October 2026**.

| Entity | Added by the historical batch |
|---|---:|
| Customers | 300 |
| Contacts | 500 |
| Leads | 250 |
| Opportunities | 150 |
| Activities | 3,000 |
| Sales transactions | 1,000 |

On a fresh workspace, five demo accounts are created. On an existing workspace, **all accounts and existing CRM records are retained**, and only the missing historical batch is added. For the original 24-customer/105-sale demo, this produces **324 customers, 510 contacts, 282 leads, 168 opportunities, 3,020 activities, and 1,105 transactions**.

The catalogue includes the original ten smartphone models plus Samsung Galaxy A16, Infinix Hot 50, Apple iPhone 16 Pro Max, and Samsung Galaxy S24 Ultra. Existing SKU records, prices, activation flags, and stock balances are not overwritten. Both generated invoice totals and line-item unit prices are within **IDR 2,000,000 to IDR 25,000,000**.

Business distribution:

- Five branches: **Jakarta, Bandung, Surabaya, Medan, and Semarang**, with a higher share in Jakarta.
- Repeat family buyers, VIP customers, and corporate procurement accounts, with primary and secondary contacts.
- **60 inactive customers** with no generated purchase or completed activity in the preceding 45 days.
- **60 won, 35 lost, and 55 open opportunities**. Won deals link to completed invoices with matching customers, amounts, and dates. Lost deals include specific reasons such as price, financing rejection, unavailable colour, deferred budgets, or repair instead of replacement.
- Activity mix emphasizes WhatsApp, calls, and follow-ups, with email, meetings, and store visits. There are **2,760 completed, 150 planned, and 90 cancelled activities**. Planned follow-ups can be due during the next seven days, but their creation timestamps stay within the historical period.
- Lead acquisition covers Walk In, Website, Instagram, Facebook, Referral, Marketplace, and TikTok.
- Sales use uneven daily weights: weekends, payday periods, and double-date campaigns peak; mid-month periods soften. The second month has a stronger campaign, followed by a cooler current-month run rate. Monthly quotas account for elapsed days in the current month rather than pretending it is complete.
- Historical invoice timestamps, customer registration, lead creation, opportunity progression, and activity links are chronologically consistent. Completed, cancelled, and recent pending orders are included.

Historical imports represent already-reconciled opening inventory: they **do not replay old stock deductions against today's balances**. Newly introduced products receive an opening balance. New sales and subsequent edits/cancellations still use the normal inventory transaction logic.

The SQL is a single atomic PostgreSQL `DO` block protected by an advisory transaction lock. A `retail-history-v1` marker is inserted into `seed_batches` only after all count checks pass. Repeated or simultaneous runs do not duplicate records, reset the period, overwrite edits, or recreate deleted sample records. Dates are frozen on the first successful load; restarting in a later month does not add another batch.

#### Run or inspect the seed

Automatic initialization:

```bash
docker compose up -d --build
```

Re-run safely against the configured Docker database:

```bash
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backend/prisma/historical-seed.sql
```

The command above uses Bash input redirection. In PowerShell, pipe `Get-Content -Raw backend\prisma\historical-seed.sql` into the same `docker compose exec -T db ...` command.

For local development with `DATABASE_URL` and `ENABLE_DEMO_DATA=true` in the shell:

```bash
npm run db:deploy
npm run db:seed
```

The PostgreSQL script can also be run directly after migrations and account bootstrap:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/prisma/historical-seed.sql
```

Direct SQL execution explicitly loads samples regardless of the Node bootstrap flag. It requires at least one active Sales user, or an active Manager/Admin as an assignment fallback.

```sql
SELECT id, "periodStart", "periodEnd", counts FROM seed_batches;
SELECT date_trunc('month', "soldAt") AS month,
       count(*) AS orders,
       sum(total) FILTER (WHERE status = 'COMPLETED') AS revenue
FROM sales_transactions
WHERE id LIKE 'hist-v1-sale-%'
GROUP BY 1 ORDER BY 1;
```

All people, companies, contact details, and transactions are fictional. Prices are illustrative, not live retail quotations. Do not remove the seed marker to regenerate data; first plan an explicit reset or a separately versioned additive batch.

## Business rules

### Sales and inventory

- Clients submit product IDs and quantities, **never totals or unit prices**.
- New line items use the current product price. Existing items retain their recorded price when a transaction is edited.
- Only `COMPLETED` sales reduce available stock and count toward revenue.
- `PENDING` sales do not reserve stock; `CANCELLED` sales do not consume stock.
- Editing a completed sale restores its old stock movement before applying the new one, within a single database transaction.
- Deleting a completed sale restores its quantities.
- Checkout uses serializable transactions, bounded conflict retries, and guarded stock decrements. Concurrent checkouts cannot oversell the last unit.
- If any product lacks stock, the entire operation rolls back.
- Products already used by transactions cannot be deleted. Deactivate them instead.
- Customers with sales or opportunities cannot be deleted. Deleting an otherwise eligible customer cascades to its contacts and clears optional customer links.
- Changing an opportunity to `WON` does not automatically create a sale. Record the actual purchase in Sales transactions.
- Changing a lead to `CONVERTED` does not automatically create a customer/opportunity. Create or link those records explicitly.
- Product stock is an available-stock balance. Managers can make manual stock adjustments; this lite platform does not include purchase orders, stock-ledger auditing, returns, taxes, or payment processing.

### Dashboard semantics

- All revenue is in **IDR**, including historical product prices.
- Revenue periods use **UTC calendar months** and include completed transactions only. The UI identifies the reporting timezone.
- Three-month charts include the current month to date. Weekly sales are zero-filled, and the first/last reporting weeks may be partial.
- Branch revenue covers the same three-month window. Older records without branch metadata remain explicitly **Unassigned**; they are not silently assigned to Jakarta.
- Customer lifecycle and opportunity outcomes cover all workspace records. Activity channels cover activities created in the three-month window.
- The revenue comparison is explicitly labelled **MTD vs full last month**, not a like-for-like daily growth rate.
- Pipeline value is the unweighted sum of opportunities excluding `WON` and `LOST`.
- Top products and salespeople are ranked by this month's completed revenue.
- Lead source counts cover all leads.
- Recent activities are the five most recently updated activities.
- Forms use the browser's local timezone and send ISO-8601 timestamps with timezone information.

## API reference

The Express routes are `/dashboard`, `/customers`, etc. Through the public frontend, use the `/api` prefix, for example `http://localhost:8080/api/customers`.

### Authentication

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Database-backed backend health check |
| GET | `/auth/config` | Whether demo login controls should be shown |
| POST | `/auth/login` | Email/password -> token and public user |
| GET | `/auth/me` | Current authenticated user |
| GET | `/lookups` | Lightweight customers, users, products, and opportunities for forms |
| GET | `/dashboard` | Dashboard metrics and chart datasets |

All routes except health, login, and auth configuration require:

```http
Authorization: Bearer <JWT>
```

Tokens expire after eight hours. Passwords are bcrypt-hashed. Password/account/role changes invalidate existing tokens. The browser keeps the token in tab-scoped `sessionStorage`; signing out removes the local token. There is no server-side token blacklist or password-reset email service.

### CRUD endpoints

For **each** resource below:

| Method | Route | Result |
|---|---|---|
| GET | `/<resource>` | Paginated list |
| GET | `/<resource>/:id` | Single record |
| POST | `/<resource>` | Create, returns HTTP 201 |
| PUT | `/<resource>/:id` | Update with all required fields |
| DELETE | `/<resource>/:id` | Delete, returns HTTP 204 |

Resources: `customers`, `contacts`, `leads`, `opportunities`, `activities`, `products`, `transactions`, `users`.

`users` is Admin-only. Other write/delete permissions follow the role matrix above.

#### List parameters

```text
?page=1&pageSize=10&search=iphone
```

- `page`: positive integer; default `1`.
- `pageSize`: `1` to `100`; default `10`.
- `search`: case-insensitive, up to 200 characters.
- `status`: supported by leads, activities, transactions, and opportunities (where it filters `stage`).
- Default ordering is newest-created first.

Example response:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 10,
  "totalPages": 0
}
```

#### Request fields

Required fields are shown without `?`. Use `null` to clear optional text or relationships.

| Resource | Create/update fields |
|---|---|
| Customers | `name`, `phone`, `city`, `ownerId`, `email?`, `address?`, `segment?`, `status?`, `branch?`, `notes?` |
| Contacts | `name`, `phone`, `customerId`, `email?`, `title?` |
| Leads | `name`, `phone`, `source`, `status`, `ownerId`, `email?`, `interest?`, `notes?`, `customerId?`, `branch?` |
| Opportunities | `name`, `stage`, `value`, `probability`, `expectedCloseDate`, `customerId`, `ownerId`, `branch?`, `lostReason?`, `notes?` |
| Activities | `subject`, `type`, `status`, `dueAt`, `ownerId`, `customerId?`, `opportunityId?`, `branch?`, `notes?` |
| Products | `name`, `sku`, `brand`, `price`, `stock`, `category?`, `active?`, `description?` |
| Transactions | `customerId`, `salespersonId`, `status`, `soldAt`, `items`, `branch?`, `opportunityId?`, `notes?` |
| Users | `name`, `email`, `role`, `password` (optional on update), `active?` |

Amounts and quantities must be JSON numbers. Dates must be ISO-8601 datetime strings with timezone information. Passwords must contain at least 12 characters and no more than 72 UTF-8 bytes. `probability` is an integer from 0 to 100. Duplicate products within a transaction are rejected.

Enums:

```text
Role:               ADMIN, MANAGER, SALES
Customer segment:   REGULAR, VIP, CORPORATE
Customer status:    ACTIVE, INACTIVE
Branch:             JAKARTA, BANDUNG, SURABAYA, MEDAN, SEMARANG (or null)
Lead status:        NEW, CONTACTED, QUALIFIED, CONVERTED, LOST
Lead source:        WALK_IN, WEBSITE, INSTAGRAM, FACEBOOK, REFERRAL, MARKETPLACE, TIKTOK
Opportunity stage:  PROSPECTING, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST
Activity type:      CALL, EMAIL, WHATSAPP, MEETING, STORE_VISIT, FOLLOW_UP
Activity status:    PLANNED, COMPLETED, CANCELLED
Transaction status: PENDING, COMPLETED, CANCELLED
```

Legacy values `SOCIAL_MEDIA`, `EVENT`, `QUALIFICATION`, `NEEDS_ANALYSIS`, and `TASK` remain accepted so existing records and integrations keep working. Customer lists support `status=ACTIVE` or `status=INACTIVE`. A transaction's optional opportunity must belong to its customer.

#### Example requests

```bash
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nova.example","password":"AdminDemo2026!"}'
```

Copy the returned token and obtain customer/user/product IDs from the list or lookup endpoints:

```bash
curl http://localhost:8080/api/lookups \
  -H "Authorization: Bearer YOUR_TOKEN"

curl -X POST http://localhost:8080/api/transactions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUSTOMER_ID",
    "salespersonId": "USER_ID",
    "status": "COMPLETED",
    "soldAt": "2026-10-27T09:00:00+07:00",
    "items": [{"productId": "PRODUCT_ID", "quantity": 1}],
    "notes": "In-store purchase"
  }'
```

These are Bash examples; Windows PowerShell users can use `Invoke-RestMethod` with a hashtable converted using `ConvertTo-Json`.

#### Errors

Errors return `{ "message": "..." }`. Validation errors additionally return `errors.fieldErrors` and `errors.formErrors`.

| Status | Meaning |
|---|---|
| 400 | Invalid fields, invalid relationship, or disallowed account change |
| 401 | Missing/expired/invalid token or invalid login |
| 403 | Role does not allow the operation |
| 404 | Unknown record/route |
| 409 | Duplicate key, linked-record conflict, insufficient stock, or concurrent update conflict |
| 413 | Request exceeds the 256 KB body limit |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error; details logged by the backend |

## Configuration and persistence

To customize settings, copy `.env.example` to `.env` **before the first launch**, then edit it. No copy is needed for the default demo.

| Variable | Default | Purpose |
|---|---|---|
| `APP_PORT` | `8080` | Published web port |
| `POSTGRES_DB` | `nova_crm` | Database name |
| `POSTGRES_USER` | `nova` | Database user |
| `POSTGRES_PASSWORD` | `local-crm-change-me` | Local demo database password |
| `JWT_SECRET` | Empty | Optional explicit secret, minimum 32 characters |
| `ENABLE_DEMO_DATA` | `true` | Add the historical sample batch once, preserving existing records |
| `ADMIN_EMAIL` | `admin@nova.example` | Initial administrator email |
| `ADMIN_PASSWORD` | `AdminDemo2026!` | Initial administrator password |
| `MANAGER_PASSWORD` | `ManagerDemo2026!` | Initial demo manager password |
| `SALES_PASSWORD` | `SalesDemo2026!` | Initial demo salespeople passwords |

If `JWT_SECRET` is empty, the backend generates a cryptographically random key and stores it in the `auth_data` volume. Tokens remain valid across container restarts. An explicit secret is useful when running multiple backend instances outside this Compose setup.

Persistent volumes:

- `postgres_data`: PostgreSQL data.
- `auth_data`: generated signing secret.

```bash
# Stop containers without losing data
docker compose down

# Rebuild after application changes, retaining data
docker compose up -d --build

# Inspect service logs
docker compose logs --tail=100 backend frontend db
```

Removing the named volumes permanently removes the corresponding data/secret. Do not remove them unless you explicitly intend to reset the workspace.

Changing bootstrap environment variables does **not** change existing account passwords, delete demo data, or update PostgreSQL's password in an already-initialized database. Use Team management for account updates and plan database credential rotation separately.

### Before deploying beyond local evaluation

1. Start with an empty database, set `ENABLE_DEMO_DATA=false`, and configure a unique admin email/password and database password. This creates only the administrator.
2. Terminate HTTPS at your infrastructure proxy; plain HTTP defaults are for local use.
3. Keep the API/database private. Do not publish backend port 3000 or PostgreSQL port 5432.
4. Configure backups, secret management, network access restrictions, monitoring, and an appropriate retention policy.
5. Review the ownership policy and align linked-record ownership before handovers. Sales isolation is enforced by application queries, not PostgreSQL RLS; direct database access bypasses it. This application is single-company, not multi-tenant.
6. Understand that JWT logout is client-side; changing an account/password invalidates its tokens.
7. Rebuild/restart the frontend after replacing the backend container so Nginx refreshes its upstream address.

## Local development (optional)

For development without Docker, install Node.js 22+ and PostgreSQL 17. Create a database and set backend environment variables in your shell:

```text
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/nova_crm
ADMIN_PASSWORD=YOUR_12_OR_MORE_CHARACTER_PASSWORD
ENABLE_DEMO_DATA=false
```

For a demo seed, set `ENABLE_DEMO_DATA=true`, `ADMIN_PASSWORD=AdminDemo2026!`, `MANAGER_PASSWORD=ManagerDemo2026!`, and `SALES_PASSWORD=SalesDemo2026!`.

From the project root:

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev:backend
```

In another terminal:

```bash
npm run dev:frontend
```

Open http://localhost:5173. Shell environment variables must be set in the backend terminal. Standalone commands do not load all Compose `.env` values. To enable live Azure-only configuration, set `AZURE_OPENAI_ENV_FILE` to the absolute root `.env` path before starting the backend; `backend/start.mjs` sets this path automatically.

## Validation and tests

```bash
npm ci
npm run build
npm test
npm audit
```

The root build generates Prisma Client and type-checks both workspaces before producing the frontend assets and backend JavaScript.

Integration tests require a **dedicated, migrated PostgreSQL database whose name ends in `_test`**:

```bash
# Set these using your shell's environment-variable syntax:
# DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/nova_crm_test
# ALLOW_INTEGRATION_TESTS=true
npm run db:deploy
npm run test:integration
```

Integration tests create uniquely prefixed fixtures and clean up their own records. Do not point them at your real CRM database.

Coverage includes:

- Authentication, invalid tokens, role restrictions, and credential redaction.
- CRUD for all eight resources, search, pagination, uniqueness, and foreign keys.
- Account self-protection and session invalidation.
- Server-calculated totals and historical price retention.
- Sale edits, cancellations, deletion, stock restoration, multi-item rollback, and simultaneous last-unit checkouts.
- UTC calendar boundaries, completed-only revenue, open-only pipeline totals, and ranking output shapes.
- Exact historical batch counts, all requested branches/channels/stages, IDR price bounds, multi-item totals, parent/child chronology, dormant customers, and won/lost deal consistency.
- Growth and cooling periods, concurrent/idempotent seeding, existing-record preservation, UTC reporting on a non-UTC PostgreSQL server, and first-day/year-rollover boundaries.
- Two-Sales-user isolation for lists, searches, individual records, writes, nested links, lookup options, dashboards and all ten Copilot tasks, including exact latest-lead ordering, ties, timestamps and empty results; exact chart totals, cross-owner exclusions, empty series, UTC month boundaries, completed-only sales, and flow metadata.
- Azure request shape, context/output limits, missing configuration, provider failures/refusals, cancellation, timeouts and secret-safe error messages using synthetic mocked transport. No live CRM records are sent to Azure during tests.

During implementation, production builds, unit tests, real PostgreSQL integration tests, the Compose configuration check, and browser checks for customer/sales CRUD and role-aware mobile navigation were run. **Container image builds and `docker compose up -d` could not be executed in the authoring environment because no Docker Engine was installed.**

The lockfile is included for reproducible builds. Root overrides keep Vite's peer dependency aligned and patch Prisma 6's configuration dependencies; revisit these when upgrading the toolchain.

Real Azure inference requires your own configured deployment and credentials; mocked transport verification does not establish that a particular Azure deployment is reachable or has available quota.

## Troubleshooting

- **Port 8080 is occupied:** set `APP_PORT=8081` in `.env`, rerun Compose, and open the new port.
- **Backend is unhealthy:** inspect `docker compose logs backend db`. Check database connectivity, migration errors, password constraints, and signing-secret permissions.
- **Cannot sign in after changing `.env`:** seed settings only affect the first initialization. Use the existing administrator to update accounts.
- **A record cannot be deleted:** read the API/UI error. Products with sales, customers with sales/opportunities, and users with assigned records have protected dependencies.
- **Sale rejected for stock:** refresh the product list. Another checkout may have consumed the remaining stock; no partial sale is saved.
- **Blank/failed dashboard:** use the visible retry action and check `/api/health` and backend logs.
- **Prisma `EPERM` during a Windows development build:** stop the locally running backend before regenerating Prisma Client; Windows locks the loaded query-engine DLL.
- **Browser gets 502 after manually replacing the API container:** restart the frontend to refresh Nginx's resolved backend address.
- **Copilot shows setup required:** run the setup wizard or set all three Azure variables. For the local `backend/start.mjs` preview, save `.env` and click **Periksa lagi**; for Docker, recreate the backend and restart frontend. Nonempty Azure process variables override the file as a complete group. Never put keys in frontend `VITE_` variables.
- **Copilot rejects configuration or returns no usable answer:** verify deployment name, chat-completions support, key permissions and quota. Prefer a small non-reasoning chat model; reasoning models can exhaust the deliberately small completion budget without producing visible text.
- **Sales cannot see an assigned deal/activity/sale:** its customer and optional opportunity must also be owned by that Sales user. Ask an Admin/Manager to align ownership; old records are never silently reassigned.
