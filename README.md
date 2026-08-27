# OrderFlow

A real 3-tier order management web app: browse products, add to cart, check
out, track orders, sign up / log in / log out — plus an admin dashboard to
manage order statuses, products, categories, and users.

## Architecture

| Tier | Technology | Where |
|---|---|---|
| **Presentation** | Plain HTML/CSS/JS (no build step, no framework) | `frontend/` |
| **Application / API** | Python's built-in `http.server` + a small REST API, JWT auth | `backend/server.py`, `backend/auth.py` |
| **Data** | SQLite (a real embedded database — a single file on disk) | `backend/orderflow.db` (created on first run) |

The frontend never touches the database directly — every page loads its data
by calling the backend's REST API (`/api/...`) over HTTP, and the backend is
the only thing that talks to the database. That's what makes this a genuine
3-tier application, unlike a client-only demo.

**Why SQLite instead of MongoDB/Postgres?** SQLite is a real, production-grade
relational database — it just doesn't require you to install and run a
separate database server. The whole database is one file
(`backend/orderflow.db`). This means you can get the full 3-tier app running
with a single `pip install` and no Docker, no database server setup, and no
connection strings to configure. If you'd like a version wired up to
MongoDB or Postgres instead (closer to a typical production setup), that's a
very doable next step — just ask.

---

## What's in this folder

```
orderflow-app/
├── backend/
│   ├── server.py          ← REST API + web server (run this)
│   ├── db.py               ← database schema + seed data
│   ├── auth.py              ← password hashing + JWT tokens
│   └── requirements.txt     ← one dependency: PyJWT
├── frontend/
│   ├── index.html            ← page shell + styles
│   └── app.js                  ← all UI logic, calls the API via fetch()
└── README.md
```

---

## Requirements

- **Python 3.8+**. Check with:
  ```
  python3 --version
  ```
  If you don't have it, install from https://www.python.org/downloads/.

That's it — no Node.js, no Docker, no database server to install.

---

## Step-by-step setup

### 1. Unzip the project
Unzip `orderflow-app.zip` anywhere on your computer.

### 2. Open a terminal in the `backend` folder
```
cd path/to/orderflow-app/backend
```

### 3. (Recommended) Create a virtual environment
This keeps the one dependency this project needs isolated from the rest of
your system's Python packages.

```
python3 -m venv venv
```

Activate it:
- **macOS / Linux:**
  ```
  source venv/bin/activate
  ```
- **Windows (Command Prompt):**
  ```
  venv\Scripts\activate.bat
  ```
- **Windows (PowerShell):**
  ```
  venv\Scripts\Activate.ps1
  ```

You'll know it worked because your terminal prompt now starts with `(venv)`.

### 4. Install the one dependency
```
pip install -r requirements.txt
```

### 5. Start the server
```
python3 server.py
```

You should see:
```
  OrderFlow is running:
  →  http://localhost:8000

  Press Ctrl+C to stop the server.
```

The first time you run this, it automatically creates `orderflow.db` (the
SQLite database file) and fills it with demo products, categories, and user
accounts. On every run after that, it reuses the same file, so your data
(new signups, orders, status changes) persists between restarts.

### 6. Open the app
Go to **http://localhost:8000** in your browser. Frontend and backend are
served from the same address, so there's nothing else to configure.

### 7. Stop the server
Back in the terminal, press `Ctrl + C`.

Next time, you just need steps 5–6 (activate the venv first if you made
one: `source venv/bin/activate`).

---

## Using the app

### Demo accounts
| Role     | Email               | Password    |
|----------|---------------------|-------------|
| Customer | maya@example.com    | password123 |
| Admin    | ren@orderflow.app   | admin123    |

These are also shown right on the login page.

### As a customer
- Browse the shop, filter by category, search for products.
- Add items to your cart, adjust quantities, and check out — this creates a
  real order in the database via the API.
- **Sign up** for a new account, or log in with the demo account above.
- Visiting "My Orders" or "Checkout" while logged out sends you to the login
  page first, then back to where you were headed once you log in.
- "My Orders" only shows orders that belong to your account.
- Your session (a signed JWT token) is saved in the browser, so refreshing
  the page keeps you logged in. **Log out** is in the top-right of the nav.

### As an admin
- Log in with the admin demo account.
- An **Admin** link appears in the nav once you're logged in as an admin.
- From there: dashboard KPIs (pulled live from the database), order status
  management, and product/category/user browsing — including
  enabling/disabling accounts.
- A customer account that tries to visit an admin page directly is redirected
  to an "Unauthorized" screen — this is enforced by the backend on every
  request, not just hidden in the UI.

---

## How data flows (for the curious)

1. Your browser loads `index.html` + `app.js` from the server.
2. `app.js` calls `GET /api/products` and `GET /api/categories` to populate
   the shop — this data comes straight from `orderflow.db`.
3. Logging in calls `POST /api/auth/login`, which checks your password
   against a securely hashed copy in the database and returns a signed JWT.
4. That token is stored in `localStorage` and sent as an
   `Authorization: Bearer <token>` header on every subsequent request, so the
   server knows who you are (and whether you're an admin) without you having
   to log in again on every page.
5. Checking out calls `POST /api/orders`. The **server** — not the browser —
   looks up each product's real price and stock and computes the total, so a
   user can't tamper with prices from the browser console.

---

## Troubleshooting

- **`python3: command not found`.** Install Python 3 from
  https://www.python.org/downloads/, then re-open your terminal.
- **`ModuleNotFoundError: No module named 'jwt'`.** You skipped
  `pip install -r requirements.txt`, or you're not in the virtual environment
  you installed it into. Re-run step 3–4.
- **"Could not reach the server" in the app.** The backend isn't running, or
  you opened `frontend/index.html` directly instead of going to
  `http://localhost:8000`. This app *must* be accessed through the server
  (step 6) — opening the HTML file directly won't work, since it needs to
  talk to the API on the same origin.
- **Port 8000 already in use.** Run `python3 server.py 8080` (or any other
  port) and open `http://localhost:8080` instead.
- **Want to start over with fresh demo data?** Stop the server and delete
  `backend/orderflow.db`, then start the server again — it will be
  recreated and re-seeded automatically.
- **Product images don't load.** They're pulled from Unsplash/Pexels over the
  internet — you'll need an active connection for those specific images.
  Everything else works fully offline once the server is running.
