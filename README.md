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
