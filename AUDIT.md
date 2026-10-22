# Technical Audit & System Architecture Defense (`AUDIT.md`)

**System:** Fertilizer Distribution & Subsidy Management System (FDS)  
**Architecture:** Laravel 13 RESTful API + MySQL 8 (InnoDB Row-Level Locking) + React 19 / TypeScript Mobile-First Client  
**Walkthrough Video (Loom):** [https://www.loom.com/share/be4c0368cf074e61b84e463ef9b7b693](https://www.loom.com/share/be4c0368cf074e61b84e463ef9b7b693)  
**Repository:** [https://github.com/bm0629/fertilizer-distribution-system](https://github.com/bm0629/fertilizer-distribution-system)  

---

## Part 1: Approach to Module 4 — Cryptographic Security & Concurrency Analysis

### 1.1 Tamper-Proofing & Cryptographic QR Protocol (`CryptographicQrService`)
To prevent client-side payload manipulation or MITM alteration during offline/in-store QR presentation, the Merchant POS never trusts raw client amounts or unverified identifiers.

1. **Composite Security Context (`BeneficiaryID|UUID|Timestamp`)**:
   Every generated POS transaction constructs a deterministic composite reference string:
   ```text
   RSBSA-03-2026-00142|9d8e2c14-4d3b-4f88-9c1a-7b3c2d1e0f9a|1792660800
   ```
2. **HMAC-SHA256 Canonical Signing**:
   The server signs the canonical string `BeneficiaryID|UUID|Timestamp|MerchantID|NormalizedTotalAmount` using a server-only secret key (`QR_HMAC_SECRET`):
   $$\text{Signature} = \text{HMAC-SHA256}\Big(\text{BeneficiaryID} \;\|\; \text{UUID} \;\|\; \text{Timestamp} \;\|\; \text{MerchantID} \;\|\; \text{TotalAmount},\; K_{\text{secret}}\Big)$$
3. **Constant-Time Verification (`hash_equals`)**:
   When the Farmer scans the QR code (`POST /api/farmer/qr/scan`), the server:
   - Reconstructs the composite reference string from the payload's `beneficiary_id`, `transaction_uuid`, and `timestamp`, comparing it against `reference_string` using `hash_equals()`.
   - Recomputes the HMAC-SHA256 signature using the payload's `total_amount` and `beneficiary_id` and compares it in constant time against both the payload's `signature` and the immutable `qr_signature` stored in the database.
   - If `total_amount` (e.g., altered from `2960.00` to `50.00`) or `beneficiary_id` is manually modified, signature verification fails immediately with `HTTP 422 SIGNATURE_MISMATCH_TAMPERED_PAYLOAD` or `TAMPERED_COMPOSITE_REFERENCE`.
4. **15-Minute Time-To-Live (TTL) Window**:
   The payload carries a Unix `timestamp` and ISO-8601 `expires_at` (`timestamp + 900 seconds`). Both the QR scan endpoint and the settlement service reject any token where `now - timestamp > 900` seconds (`QR_TOKEN_EXPIRED`), mitigating replay attacks of photographed QR codes.

---

### 1.2 Pessimistic Concurrency & Deadlock-Free Row Locking (`SubsidySettlementService`)
To eliminate race conditions, double-spending of farmer subsidies, and inventory overselling during simultaneous checkouts, `SubsidySettlementService::settleTransaction()` executes inside a single ACID database transaction (`DB::transaction()`) using InnoDB pessimistic row-level locks (`SELECT ... FOR UPDATE` via Eloquent `->lockForUpdate()`):

1. **Deterministic Lock Acquisition Order (Deadlock Prevention)**:
   - First, lock `payment_logs` by `event_id` to check idempotency.
   - Second, lock the target `transactions` row (`WHERE uuid = ? FOR UPDATE`).
   - Third, lock the `users` rows (`farmer_id` and `merchant_id`) sorted in **ascending primary key order (`ORDER BY id ASC FOR UPDATE`)** so two concurrent transactions involving the same merchant and farmer can never deadlock.
   - Fourth, lock all affected `products` rows sorted in **ascending `id` order (`ORDER BY id ASC FOR UPDATE`)**.
2. **Atomic Verification & State Transition**:
   While holding these exclusive row locks, the service verifies:
   - The transaction is still `pending` and within its 15-minute TTL.
   - The farmer's seasonal high-nitrogen fertilizer quota (`<= 5 bags`) is not exceeded.
   - The farmer's `subsidy_balance >= total_amount`.
   - Every product's `stock_quantity >= item.quantity`.
   It then decrements `products.stock_quantity`, deducts `users.subsidy_balance` (Farmer), credits `users.wallet_balance` (Merchant), marks `transactions.status = 'paid'`, and writes an immutable row to `payment_logs`.

---

### 1.3 Idempotency & Immutable Audit Logging (`payment_logs`)
Webhook delivery networks operate on an *at-least-once* guarantee, meaning retries occur on network timeouts. Furthermore, dual-path settlement means both the asynchronous webhook and client-side polling sync may attempt to settle the same transaction.
- `payment_logs.event_id` has a database-level `UNIQUE` index.
- If a retried webhook arrives with an existing `event_id`, `SubsidySettlementService` detects the existing `PaymentLog` under lock and returns `idempotent_replay: true` without touching inventory or balances.
- If the transaction was already marked `paid` by Path A (Webhook) when Path B (Client-Side Polling Sync) arrives with a different `event_id`, the service records an `idempotent_noop` audit entry and returns the settled transaction state without re-decrementing stock or balances.

---

## Part 2: Module 6 — Technical Defense & System Architecture Viva

### Question 1: Privacy Protection
> **Why enforce exact-match queries for Beneficiary ID verification instead of search/autocomplete?**

1. **Prevention of Unauthorized Data Harvesting & Enumeration (OWASP Broken Object Level Authorization / Excessive Data Exposure)**:
   The National Farmer Registry contains sensitive Personally Identifiable Information (PII) and financial data (farmer full names, geographic regions, and allocated government subsidy balances). If the Merchant POS endpoint (`/api/merchant/beneficiaries/verify`) supported prefix search (`LIKE 'RSBSA-03%'`) or autocomplete, a malicious or compromised merchant terminal could systematically enumerate all registered farmers in a region, harvest their identities, and target high-balance beneficiaries.
2. **Zero-Knowledge Possession Proof at the Counter**:
   Requiring an exact, full-string match (`WHERE role = 'farmer' AND beneficiary_id = ?`) ensures the merchant can only query a farmer who is physically present at the POS terminal and has presented their official RSBSA Beneficiary ID card. Partial inputs return `HTTP 404 BENEFICIARY_NOT_FOUND`, leaking zero information about nearby IDs.
3. **Database Index Performance**:
   Exact-match lookups utilize a `UNIQUE` B-Tree index on `users.beneficiary_id` in $O(\log N)$ time without full-table or range scans.

---

### Question 2: Gateway Abstraction
> **How is the payment integration decoupled from core business logic?**

1. **Contract-Driven Dependency Inversion (`PaymentGatewayInterface`)**:
   All payment provider operations (session creation, webhook HMAC verification, and remote session status inspection) are defined in a strict PHP interface: `App\Contracts\PaymentGatewayInterface`.
2. **Service Container Binding (`AppServiceProvider`)**:
   Laravel's IoC container binds `PaymentGatewayInterface::class` to the concrete implementation `HostedSubsidyGatewayService::class` inside `AppServiceProvider::register()`. Controllers (`FarmerCheckoutController`, `PaymentWebhookController`) type-hint only the interface. Swapping the payment provider (e.g., to PayMongo, Maya Business, or Stripe) requires only writing a new adapter class and updating a single line in `AppServiceProvider`.
3. **Separation of Transport from Settlement Domain Logic**:
   The payment gateway adapter never mutates database balances or product stock directly. Instead, both the webhook controller and the polling sync endpoint delegate state transitions to `SubsidySettlementService::settleTransaction()`, keeping financial accounting, pessimistic locking, and subsidy quota enforcement 100% isolated from gateway transport details.

---

### Question 3: Connectivity Tolerance
> **How does dual reconciliation ensure settlement if network connectivity drops during the redirect back from the payment page?**

In rural agricultural environments, mobile data connectivity frequently drops while a farmer's browser is redirecting back from the hosted payment gateway page. Relying solely on a synchronous browser redirect callback would leave transactions stuck in `pending` even after payment authorization.

Our architecture implements **Dual-Path Reconciliation** converged on an **idempotent settlement core**:

1. **Path A — Server-to-Server Asynchronous Webhook (`POST /api/webhooks/payment`)**:
   Even if the farmer's mobile phone loses signal or closes the browser tab immediately after authorizing payment on the gateway, the payment gateway's backend independently dispatches an asynchronous HTTP POST webhook directly to our server. `PaymentWebhookController` verifies the `X-Gateway-Signature` header and invokes `SubsidySettlementService::settleTransaction()`, atomically settling the transaction, decrementing stock, updating balances, and logging the event.
2. **Path B — Client-Side Polling & Reconnect Sync (`GET /api/farmer/transactions/{uuid}/poll?reconcile_gateway=true`)**:
   While on the checkout/review screen, the Farmer mobile client runs a lightweight 3-second polling loop (`FarmerCheckoutView.tsx`) and also exposes an explicit reconnect reconciliation trigger. When the farmer's device regains connectivity:
   - If **Path A (Webhook)** already arrived first, the poll immediately sees `status: "paid"` (or `idempotent_replay: true`) and transitions the UI to the settled receipt state without duplicating deductions.
   - If **Path A (Webhook)** was delayed by gateway queue lag, **Path B (Polling Sync)** reconciles the session directly via `SubsidySettlementService::settleTransaction()`. When the delayed webhook eventually arrives later, the `payment_logs` idempotency guard (`event_id` + `transaction.status === 'paid'` check under `SELECT ... FOR UPDATE`) safely absorbs it as a no-op.
