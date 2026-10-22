# Fertilizer Distribution & Subsidy Management System (FDS)

A full-stack, multi-role agricultural commerce and government subsidy distribution platform built with **Laravel 13 (PHP 8.4)**, **React 19 (TypeScript + Vite + Tailwind CSS v4)**, and **MySQL 8 (InnoDB Pessimistic Locking)**.

> **🎥 Walkthrough Demonstration Video (Loom):**  
> **[https://www.loom.com/share/be4c0368cf074e61b84e463ef9b7b693](https://www.loom.com/share/be4c0368cf074e61b84e463ef9b7b693)**
>
> **📄 Technical Defense & Security Audit Report:**  
> See [`AUDIT.md`](./AUDIT.md) for the complete Module 4 & Module 6 architectural write-up.

---

## 1. Architecture & Assessment Modules Implemented

- **Module 1: System Initialization & Data Seeding**
  - Core relational schema (`users`, `products`, `transactions`, `transaction_items`, `payment_logs`, `withdrawals`).
  - Seeded **Accredited Merchant** (`merchant@fds.gov.ph`) with 6 active fertilizer products (High-Nitrogen Urea 46-0-0, Ammonium Sulfate 21-0-0, Complete NPK 14-14-14, DAP 18-46-0, MOP 0-0-60, Organic Vermicompost).
  - Seeded **Registry-Verified Farmers** (`farmer@fds.gov.ph` with `RSBSA-03-2026-00142` and `farmer2@fds.gov.ph` with `RSBSA-03-2026-00889`).
  - Role-based authentication tokens (`Laravel Sanctum`) and custom role middleware guard (`EnsureUserRole` / `role:merchant`, `role:farmer`).
- **Module 2: UI/UX Design System & Interface Usability**
  - Cohesive nature/agricultural emerald, harvest-amber, and stone palette with safe-area insets and high-contrast typography.
  - **Debounced Beneficiary ID Verification**: Real-time state machine (`idle` ➔ `checking` ➔ `valid` ➔ `invalid`) using `AbortController` and `420ms` debounce without flickering or redundant API calls.
  - **Boundary-Constrained Cart Steppers**: Increment/decrement buttons dynamically disable at `0` and `stock_quantity`.
  - **QR Scanner UI**: Centered targeting frame, animated laser scanline, dimmed mask overlay, instructional labels, optical QR image upload fallback (`jsQR`), 1-click POS handoff, and built-in **Cryptographic Tamper Simulator**.
  - **Checkout Summaries**: Itemized breakdowns, total calculations, and dynamic status badges (`pending`, `paid`, `failed`, `cancelled`).
- **Module 3: End-to-End Multi-Role Transaction Workflow**
  - Complete lifecycle from Merchant POS cart & signed QR generation ➔ Farmer QR scan & verification ➔ Hosted Gateway Checkout Session ➔ Dual-Path Atomic Reconciliation & Settlement.
- **Module 4: Cryptographic Security & Concurrency Analysis**
  - **HMAC-SHA256 Tamper-Proofing**: Server signs `BeneficiaryID|UUID|Timestamp|MerchantID|TotalAmount`. Rejects any manual alteration of `total_amount` or `beneficiary_id`.
  - **Security Context**: Enforces 15-minute Time-To-Live (`TTL`) and composite reference string (`BeneficiaryID|UUID|Timestamp`).
  - **Pessimistic Concurrency**: Uses `SELECT ... FOR UPDATE` (`lockForUpdate()`) in deterministic ID order across `payment_logs`, `transactions`, `users`, and `products`.
  - **Idempotency**: Deduplicates `event_id` and `paid` state in `payment_logs` to prevent double deductions from retried webhooks or concurrent polling sync.
- **Module 5: Practical Feature Modification Challenges (ALL 3 OPTIONS IMPLEMENTED)**
  - **Option A — Subsidy Quota**: Restricts each farmer to a maximum quota of **5 bags of high-nitrogen fertilizer** per cropping season (`2026-WET`).
  - **Option B — Automated Test Suite**: Comprehensive PHPUnit feature & integration test suite (`tests/Feature/FdsComprehensiveIntegrationTest.php`) covering POS creation, wrong-farmer scan rejection, single-decrement stock verification, tamper rejection, quota enforcement, and payout validation.
  - **Option C — Payout Validator**: Strict bank account (`BDO` 12 digits, `BPI` 10 digits, `LANDBANK` 10 digits, `METROBANK` 13 digits) and mobile e-wallet (`GCASH` / `MAYA` `09XXXXXXXXX`) formatting and validation rules on the Merchant Withdrawal interface.
- **Module 6: Technical Defense & System Architecture Viva**
  - Detailed architectural analysis provided in [`AUDIT.md`](./AUDIT.md).

---

## 2. Prerequisites

Ensure the following are installed on your machine:
- **PHP**: `>= 8.2` (tested on `PHP 8.4` with `pdo_mysql`, `mbstring`, `openssl`, `bcmath` enabled)
- **Composer**: `>= 2.x`
- **Node.js & npm**: `Node.js >= 20.x` (tested on `v22.18.0`) & `npm >= 10.x`
- **Database**: **MySQL `>= 8.0`** running on `127.0.0.1:3306`
- *(Optional)* **Docker & Docker Compose** for containerized execution.

---

## 3. Environment Variables Configuration

### Backend (`backend/.env`)
Copy `backend/.env.example` to `backend/.env` and configure your MySQL credentials and cryptographic secrets:

```bash
cd backend
cp .env.example .env
```

Key variables in `backend/.env`:
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `DB_CONNECTION` | Database driver | `mysql` |
| `DB_HOST` | MySQL host | `127.0.0.1` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_DATABASE` | Primary database name | `fds_db` |
| `DB_USERNAME` | Database user | `root` |
| `DB_PASSWORD` | Database password | `root` |
| `QR_HMAC_SECRET` | Secret key used for HMAC-SHA256 QR payload signing | `fds_super_secret_hmac_signing_key_2026_gov_subsidy` |
| `QR_TTL_MINUTES` | Time-To-Live (TTL) in minutes for dynamic QR payloads | `15` |
| `PAYMENT_GATEWAY_SECRET` | Webhook HMAC secret for payment gateway verification | `whsec_paygateway_live_secret_2026` |
| `SUBSIDY_HIGH_NITROGEN_MAX_BAGS` | Max bags of High-Nitrogen fertilizer per farmer per season | `5` |
| `FRONTEND_URL` | Frontend client URL for gateway redirects | `http://localhost:5173` |

### Frontend (`frontend/.env`)
Copy `frontend/.env.example` to `frontend/.env` (optional when running with Vite's built-in `/api` proxy):

```bash
cd ../frontend
cp .env.example .env
```

---

## 4. Step-by-Step Setup Commands (Fresh Clone)

### Option 1: Local Native Setup (Recommended for Fast Development)

1. **Create the MySQL Databases (`fds_db` and `fds_test`)**:
   ```bash
   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS fds_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE DATABASE IF NOT EXISTS fds_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   ```

2. **Install Backend Dependencies, Generate App Key, Run Migrations & Seed Data**:
   ```bash
   cd backend
   composer install
   cp -n .env.example .env
   php artisan key:generate
   php artisan migrate:fresh --seed
   ```

3. **Install Frontend Dependencies**:
   ```bash
   cd ../frontend
   npm install
   ```

### Option 2: Docker Compose Setup

```bash
docker-compose up --build
```
This spins up `fds_mysql` (`:3306`), `fds_backend` (`:8000` with auto-migration and seeding), and `fds_frontend` (`:5173`).

---

## 5. Run Commands (Development Servers & Automated Tests)

### Start Backend API Server (Terminal 1)
```bash
cd backend
php artisan serve --host=127.0.0.1 --port=8000
```
The Laravel REST API will be available at `http://127.0.0.1:8000/api`.

### Start Frontend React Development Server (Terminal 2)
```bash
cd frontend
npm run dev
```
Open **`http://localhost:5173`** in your browser.

### Run Automated Integration Test Suite (Module 5 Option B)
```bash
cd backend
php artisan test
```

---

## 6. Seeded Demo Credentials & Beneficiary IDs

| Role | Name | Email | Password | Beneficiary ID | Initial Balance |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Accredited Merchant** | Maria Clara Agro-Supply | `merchant@fds.gov.ph` | `password123` | *N/A* | Wallet: **₱25,000.00** |
| **Verified Farmer #1** | Juan Dela Cruz | `farmer@fds.gov.ph` | `password123` | `RSBSA-03-2026-00142` | Subsidy: **₱15,000.00** |
| **Verified Farmer #2** | Pedro Penduko | `farmer2@fds.gov.ph` | `password123` | `RSBSA-03-2026-00889` | Subsidy: **₱12,500.00** |

---

## 7. Demonstration Video Walkthrough Guide (5–8 Minutes)

The UI includes a built-in **"Side-by-Side Walkthrough"** toggle in the top header bar so you can record the entire Merchant POS and Farmer Checkout flow on a single screen:
1. **Debounced Beneficiary ID & Steppers**: Log in as **Merchant POS**, type an invalid ID (`RSBSA-INVALID-999`) to show `idle ➔ checking ➔ invalid`, then select `RSBSA-03-2026-00142` to show `checking ➔ valid`. Show the `-` button disabled at `0` and `+` disabled at max stock.
2. **Option A (5-Bag High-Nitrogen Quota)**: Try adding 6 bags of *Granular Prilled Urea (46-0-0)* and click **Generate Signed Payment QR** to show the quota rejection message, then reduce to 2 bags and generate the signed QR.
3. **Tampered QR / Wrong Farmer Rejection**: Switch to **Farmer 2 (Pedro)** and scan Juan's QR to show `403 UNAUTHORIZED_FARMER_SCAN`. Next, switch to **Farmer 1 (Juan)**, open the **Cryptographic Payload Inspector & Tamper Simulator**, click **Simulate Tampered Amount (₱50.00)**, and show `422 SIGNATURE_MISMATCH_TAMPERED_PAYLOAD`.
4. **Successful Payment & Dual Reconciliation**: Click **Scan Active Merchant POS QR**, review the itemized breakdown and `pending` badge, click **Proceed to Hosted Payment Gateway**, and click **Complete Payment (Async Webhook)**. Show the status transition to `paid`, stock decremented, farmer balance deducted, merchant wallet credited, and click **Replay Exact Same Webhook Event ID** to demonstrate idempotency.
5. **Option C (Merchant Payout Validator)**: Open **Payout Withdrawal (Option C)** in the Merchant view, test an invalid BDO/GCash number to show real-time and server-side rejection, then submit a valid 12-digit BDO account (`004589123045`).
