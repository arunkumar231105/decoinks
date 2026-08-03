# Frontend end-to-end tests (Playwright)

Browser tests for the Decoinks frontend, the counterpart to the Jest suite in
`backend/tests`.

## Safety

**These tests never create, edit or delete business data.** They log in, open
pages and read what is on screen. The only write is a draft value in
`localStorage`, which the test clears afterwards.

They run against `http://localhost:8093` — the frontend container's own port on
the server. That bypasses the Authentik SSO proxy that sits in front of the
public hostname, so the ordinary email/password login works.

## One-time setup

```bash
cd e2e
npm install
npx playwright install chromium
cp .env.example .env      # then fill in the credentials yourself
```

`.env` is git-ignored. Use an account you are happy to automate with:

```
BASE_URL=http://localhost:8093
TEST_EMAIL=you@example.com
TEST_PASSWORD=...
```

## Running

```bash
npm test              # everything
npm run test:smoke    # every page loads without crashing
npm run test:regression   # bugs that have bitten us before
npm run report        # open the HTML report of the last run
```

## What is covered

| File | Covers |
|---|---|
| `07-smoke.spec.ts` | All 21 sidebar screens and create forms load with no ErrorBoundary and no uncaught exception |
| `09-regression.spec.ts` | Invoice preview shows the bank details · Payments KPIs render · a form draft survives a reload · orders and POs list newest first |
| `01-auth` … `06-invoice-preview` | Login, leads, invoices, customers, quotes and the invoice preview |
| `08-screenshots.spec.ts` | Captures screenshots of the main screens for eyeballing |

The smoke suite is the one that matters day to day: a stale chunk after a
redeploy, or a page that crashes on render, both surface as the ErrorBoundary,
and that is exactly what it asserts is absent.

## After a deploy

```bash
cd e2e && npm run test:smoke
```

Roughly a minute, and it tells you whether every screen still opens.
