# Renovo Surface Solutions — Estimates/Work Orders/Invoicing Build Prompts

Three phases, each meant to be handed to Claude Code as its own prompt when you're ready to start that phase. Phase 2 assumes Phase 1 is done; Phase 3 assumes Phase 1 + 2 are done.

---

## Phase 1 Prompt — Estimates + Work Orders + E-Signatures (no payments)

```
Build Phase 1 of an in-house estimates/work-orders system for the Renovo Surface
Solutions website (this repo, deployed on Netlify, publish directory `public/`).
No third-party invoicing/CRM tools — build this custom, on our own infrastructure.

Stack:
- Netlify Functions for backend logic
- Netlify DB (Postgres) for data storage
- Netlify Blobs for generated PDFs
- A transactional email API (recommend Resend) for sending emails — I'll create
  the account and give you the API key
- Plain HTML/CSS/JS for any new pages, matching the existing site's design system
  (css/style.css tokens: navy #0D1F38, electric blue #1B7FE8, Montserrat/Inter)

Data model needed:
- clients (name, email, phone, company, property address, notes)
- estimates (client, line items as JSON or a line_items table, notes, valid-until
  date, status: draft/sent/viewed/approved/declined, created/updated timestamps)
- work_orders (linked to an approved estimate, terms text, status: pending/signed)
- signatures (work_order, signature data, signer name, timestamp, IP address,
  consent-to-electronic-signature confirmation — needed for ESIGN Act compliance)

Build:
1. A private, password-protected admin area (only I can log in) to:
   - Create/edit a new estimate: client info, line items (description/qty/price),
     notes, valid-until date
   - Save as draft, or "Send" — sending generates a unique unguessable token and
     emails the client a link to view it (no login required for the client)
   - See a dashboard listing all estimates/work orders with their status
2. A client-facing estimate page at a token-based URL (e.g. /estimate/{token}):
   - Clean, branded view of the estimate
   - "Approve" and "Request Changes" buttons (no login needed)
   - I get notified (email) the moment they view it and the moment they approve it
3. One-click "Convert to Work Order" once an estimate is approved
4. A client-facing work-order signing page:
   - Terms/scope text
   - A signature pad (draw with mouse/touch) AND a typed-name option
   - An explicit "I consent to sign electronically" checkbox (required for legal
     validity under the ESIGN Act)
   - On submit: record signature, signer name, timestamp, and IP address as an
     audit trail; lock the document from further edits
   - Email a copy of the signed work order to both the client and me
5. Nothing about invoicing or payments yet — that's Phase 2

Ask me for anything you need along the way (Resend API key, confirming copy/
wording, etc.) rather than guessing on business-facing text.
```

---

## Phase 2 Prompt — Payments via Stripe

```
Build Phase 2 of the Renovo Surface Solutions estimates/invoicing system
(Phase 1 — estimates, work orders, e-signatures — is already built in this repo).

Add:
1. Invoices: generate an itemized invoice from a signed work order (or standalone
   for one-off billing), with sequential invoice numbers
2. Stripe integration for online payment:
   - Use Stripe Checkout or Payment Elements — card details must never touch our
     server or database, only Stripe's hosted components (avoids PCI compliance
     burden entirely)
   - I'll provide Stripe API keys (test mode first, then live) once you tell me
     exactly which keys/webhook secret you need
   - A Netlify Function to receive Stripe webhook events (verify the webhook
     signature), and on a successful payment event: mark the invoice Paid,
     auto-generate a receipt, and email it to the client and me
3. Update the admin dashboard to show: outstanding balance per client, paid vs.
   unpaid invoices, and total revenue at a glance
4. Client-facing invoice page (token-based URL, same pattern as estimates) with
   a "Pay Now" button

Don't store or log raw card numbers anywhere in our system at any point.
```

---

## Phase 3 Prompt — Recurring Billing + Automation

```
Build Phase 3 of the Renovo Surface Solutions estimates/invoicing system
(Phases 1 and 2 are already built: estimates, work orders, e-signatures, and
Stripe-powered invoice payments).

Add:
1. Recurring contracts: a record tied to a client with a fixed billing amount
   and a day-of-month to bill (for standing monthly janitorial/service contracts)
2. A Netlify Scheduled Function that runs daily:
   - Checks for contracts due to bill today, auto-generates and sends the invoice
   - Checks for unpaid invoices past their due date, sends an overdue reminder
     email (reasonable escalation, e.g. day 3, day 7, day 14 overdue)
3. Admin dashboard additions:
   - List of all recurring contracts, with the ability to pause or cancel one
   - A simple forecast view: expected recurring revenue for the upcoming month
4. Optional (ask me before building — needs explicit client consent captured
   during signup): let recurring clients save a payment method via Stripe so
   their invoice auto-charges instead of requiring them to click "Pay Now"
   every month
```

---

## Before starting any phase

- Confirm Netlify CLI is logged in (`netlify login`) so Claude can provision Netlify DB/Functions
- Have Resend (or chosen email API) account + API key ready before Phase 1
- Have a Stripe account created (business info verified) before Phase 2
