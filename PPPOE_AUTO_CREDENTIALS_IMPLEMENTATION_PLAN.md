# Implementation Plan: PPPoE Automatic Username & Password Generation

**Document Version:** 1.0  
**Target Module:** PPPoE Customer Management (`backend` + `frontend`)  
**Created:** 2026-10-05  

---

## 1. Overview & Objectives

Provide automated PPPoE username and password credential generation when registering a new PPPoE subscriber. 

### Key Specifications:
- **Format:** `KHPPOE` prefix followed by a 5-digit zero-padded sequence (e.g., `KHPPOE00001`, `KHPPOE00002`, ..., `KHPPOE12345`).
- **Scalability:** Automatically expands to 6+ digits if the sequence exceeds `99999` (e.g., `KHPPOE100000`).
- **Password Scheme:** Matches the auto-generated username by default (e.g., Username: `KHPPOE00001`, Password: `KHPPOE00001`).
- **Configurability:** Default prefix is `KHPPOE`, configurable via environment variable `PPPOE_USERNAME_PREFIX=KHPPOE` in `.env`.
- **Sequence Calculation:** Evaluated dynamically using `MAX(number) + 1` from existing records in the database starting from sequence `1` (`00001`).
- **UI Flexibility:** Pre-filled automatically upon opening the Create Subscriber modal, with a refresh/re-generate button, while still allowing operators to manually edit/override.
- **Backend Safety:** Auto-generates credentials on the backend if left blank during API submission, with database transaction locking to prevent race conditions or duplicate credentials.

---

## 2. Technical Architecture & Design

```
+-----------------------------------------------------------------------+
| Frontend (React + TypeScript)                                         |
| [PppoeCustomers.tsx]                                                  |
|   - On openCreate() -> calls GET /api/pppoe/customers/next-credentials|
|   - Pre-fills form.username & form.password                           |
|   - Refresh button next to username field to re-fetch next number     |
+-----------------------------------┬-----------------------------------+
                                    │ HTTP GET / POST
                                    ▼
+-----------------------------------------------------------------------+
| Backend (Laravel 11)                                                  |
|                                                                       |
| 1. Route:                                                             |
|    GET /api/pppoe/customers/next-credentials                          |
|                                                                       |
| 2. PppoeCustomerController:                                           |
|    - nextCredentials(Request $request): JsonResponse                  |
|    - store(Request $request): supports nullable username/password     |
|                                                                       |
| 3. PppoeCustomerService:                                              |
|    - generateNextCredentials(?string $prefix = null): array           |
|    - Safely queries max numeric suffix matching prefix                |
|    - Validates uniqueness against pppoe_customers AND vouchers        |
|    - Locks/generates within DB transaction during create()            |
+-----------------------------------------------------------------------+
```

---

## 3. Detailed Implementation Steps

### Phase 1: Backend Implementation

#### 1.1 Config & Environment Setup
- Add `PPPOE_USERNAME_PREFIX` to `.env.example` and backend config:
  ```env
  PPPOE_USERNAME_PREFIX=KHPPOE
  ```
- In `backend/config/services.php` (or dedicated config):
  ```php
  'pppoe' => [
      'username_prefix' => env('PPPOE_USERNAME_PREFIX', 'KHPPOE'),
  ],
  ```

#### 1.2 Service Logic (`backend/app/Services/PppoeCustomerService.php`)
- Add method `generateNextCredentials(?string $prefix = null): array`:
  1. Determine prefix: `$prefix = $prefix ?: config('services.pppoe.username_prefix', 'KHPPOE');`
  2. Query `pppoe_customers` where `username LIKE '{$prefix}%'`:
     - Extract highest numeric portion using regex or string extraction:
       ```sql
       SELECT MAX(CAST(SUBSTRING(username, LENGTH(?) + 1) AS UNSIGNED)) AS max_seq
       FROM pppoe_customers
       WHERE username REGEXP ?
       ```
       Regex pattern: `^KHPPOE[0-9]+$`
  3. Determine next sequence: `$nextSeq = ($maxSeq ?? 0) + 1;`
  4. Format username: `$username = sprintf('%s%05d', $prefix, $nextSeq);`
  5. Collision verification:
     - Check if `$username` already exists in `pppoe_customers` or active `vouchers`.
     - If exists (e.g. gap or manually entered voucher), increment `$nextSeq` until an available unique code is found.
  6. Return `['username' => $username, 'password' => $username]`.
- Update `create(User $actor, array $data)`:
  - If `empty($data['username'])`:
    - Automatically call internal sequential generator with exclusive row lock (`lockForUpdate()`) to guarantee concurrency safety.
  - If `empty($data['password'])`:
    - Default password to match `$data['username']`.

#### 1.3 Controller & Routing (`PppoeCustomerController.php` & `api.php`)
- In `backend/routes/api.php`:
  ```php
  Route::get('/pppoe/customers/next-credentials', [PppoeCustomerController::class, 'nextCredentials'])
      ->middleware('permission:view_pppoe,create_pppoe_customer');
  ```
- In `PppoeCustomerController.php`:
  - Implement `nextCredentials()`:
    ```php
    public function nextCredentials(Request $request): JsonResponse
    {
        $credentials = $this->customerService->generateNextCredentials();
        return $this->ok($credentials);
    }
    ```
  - In `store(Request $request)`:
    - Change validation for `username` and `password` from `'required'` to `'nullable'`.

---

### Phase 2: Frontend Implementation

#### 2.1 API Integration (`frontend/src/api/pppoe.ts` or inline api)
- Add method to query `/pppoe/customers/next-credentials`.

#### 2.2 Modal Experience (`frontend/src/pages/PppoeCustomers.tsx`)
1. **Auto-fetch on modal open**:
   - In `openCreate()`:
     - Trigger background call to fetch `nextCredentials`.
     - Populate `form.username` and `form.password`.
2. **Refresh / Re-generate Button**:
   - Beside the Username label or input, add a quick action button:
     - Icon: `ArrowPathIcon` (spin animation on click).
     - Action: Re-fetches the latest available credentials and sets both `username` and `password`.
3. **Password Sync**:
   - If the operator edits the username before having modified the password, automatically keep the password in sync unless the operator deliberately customizes the password field.
4. **Form Labels & Title Case**:
   - Ensure all labels adhere to repository guidelines (Title Case: *Username / Login ID*, *PPPoE Password*).

---

## 4. Edge Cases & Concurrency Handling

1. **Concurrent Creations**:
   - In the unlikely event two operators open the modal at the exact same moment and submit without changing the pre-filled username, the second submission will hit the backend transaction lock.
   - The backend checks uniqueness; if a collision occurs on commit, it can increment and allocate the next safe sequence or return a clear validation error.
2. **Manual Sequence Ingestion**:
   - If an operator manually creates `KHPPOE00010`, the next auto-generated sequence will be `KHPPOE00011`.
3. **Numbers Exceeding 99,999**:
   - `sprintf('%05d', 100000)` produces `100000` (6 digits), gracefully scaling past 100k subscribers without code changes or database migrations.
4. **Reseller Scope / Multi-tenancy**:
   - If future requirements dictate reseller-specific prefixes (e.g., `KH-RES1-00001`), the architecture is decoupled so prefix can be passed optionally to `generateNextCredentials($resellerPrefix)`.

---

## 5. Verification & Testing Checklist

- [ ] **Unit / API Test**: `GET /api/pppoe/customers/next-credentials` returns `{ username: "KHPPOE00001", password: "KHPPOE00001" }` on empty DB.
- [ ] **Increment Test**: After creating `KHPPOE00001`, next request yields `KHPPOE00002`.
- [ ] **Manual Override Test**: Entering custom username (e.g. `user_custom`) persists properly without affecting subsequent `KHPPOE` sequences.
- [ ] **Backend Fallback Test**: Submitting `POST /api/pppoe/customers` with empty `username` and `password` auto-fills them correctly.
- [ ] **Frontend UI Test**: Opening Create Subscriber modal immediately shows pre-filled `KHPPOE0000X`, refresh button updates it, and dark mode renders cleanly.
