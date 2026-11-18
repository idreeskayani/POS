# Restaurant POS (multi-branch)

NestJS + PostgreSQL + Socket.IO backend, React + Vite + Redux Toolkit frontend.

## Run
```bash
docker compose up -d            # Postgres + Redis
cd backend && cp .env.example .env
npm install && npm run start:dev   # http://localhost:3000
```

## Flow to try
1. `POST /auth/register` `{orgName, branchName, branchCode, name, email, password}` -> tokens (creates org, first branch, OWNER)
2. `GET /branches` -> grab the branch id
3. `POST /menu/categories`, `POST /menu/items`
4. `POST /branches/:id/tables`
5. `POST /branches/:id/orders` `{tableId, items:[{menuItemId, quantity}]}` (optional client `id` UUID = idempotent / offline-safe)
6. `PATCH /branches/:id/orders/:orderId/status` `{status}` (kitchen: PREPARING -> READY, waiter: SERVED)
7. `POST /branches/:id/orders/:orderId/pay` `{method, amount}` (split payments supported)

## Realtime
`io('http://localhost:3000/ws', { auth: { token } })`
- Events: `order:new` (kitchen room), `order:updated` (branch room)
- Branch users auto-join their branch; owner/admin emit `join:branch {branchId}`

## Design notes
- Every operational row is scoped by `branchId`; org-wide roles (OWNER/ADMIN) have `branchId = null` in the JWT
- Menu is shared per org; `PUT /menu/branches/:b/items/:i` sets a branch price override or marks an item unavailable
- Prices and totals are always computed server-side; order numbers are per branch (`BR1-0001`)
- `synchronize: true` in dev only: switch to TypeORM migrations before production

## Frontend
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (API expected at http://<same host>:3000, override with VITE_API_URL)
```
Screens: Login/Register, Cashier (menu, cart, tables, kitchen slip on send, pay with cash-received/change, bill slip), Kitchen display (live, order ready), Admin (menu, tables, staff, branches).

Thermal slips use the browser print dialog (80mm or 58mm). For one-click printing without the dialog, start Chrome/Edge with `--kiosk-printing` and set the thermal printer as Windows default.

## Flow and roles
Customer orders -> **cashier** takes the order and taps *Send to kitchen* (kitchen slip prints) -> kitchen just receives the slip -> cashier taps *Bill & pay*, takes the cash/card, change is shown, bill slip prints.

Roles: **OWNER**, **ADMIN** (all branches, dashboard, admin), **CASHIER** and **WAITER** (one branch). Waiters can take orders but not take payments. There are no kitchen or manager roles.

Kitchen printer: if the printer is on the cashier PC, tick "Print the kitchen slip on this PC" in Print settings. If it is on another PC, log in there with any staff account and leave the **Kitchen printer** page open.

Upgrading an older database: if you created any MANAGER or KITCHEN users, run this once before starting the backend:
`UPDATE users SET role='CASHIER' WHERE role IN ('MANAGER','KITCHEN');`
(Also, for the dashboard: `ALTER TABLE orders ALTER COLUMN "createdAt" TYPE timestamptz, ALTER COLUMN "updatedAt" TYPE timestamptz; ALTER TABLE payments ALTER COLUMN "createdAt" TYPE timestamptz;` if not done yet.)

## Dashboard (Owner/Admin)
Everything is clickable: KPI cards, chart bars, donut slices, ranked items, table rows and live statuses open a side panel with the orders behind that number (click an order for its full detail and bill reprint).
KPIs with period-over-period change, sales by day/hour, peak hours, order types, top items, categories, payment methods, staff, branch comparison, live status, searchable order history with CSV export and bill reprint.
