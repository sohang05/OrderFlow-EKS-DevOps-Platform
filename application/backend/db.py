"""
db.py — SQLite database layer for OrderFlow.

Uses only Python's built-in sqlite3 module. The database is a single file
(orderflow.db) created automatically the first time the server starts, right
next to this file. No external database server required.
"""
import sqlite3
import os
import time
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orderflow.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    image TEXT,
    item_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    image TEXT,
    stock INTEGER DEFAULT 0,
    sku TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    customer_name TEXT,
    customer_email TEXT,
    address TEXT,
    city TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    total REAL NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER,
    name TEXT,
    price REAL,
    image TEXT,
    qty INTEGER
);
"""


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    fresh = not os.path.exists(DB_PATH)
    with get_conn() as conn:
        conn.executescript(SCHEMA)
    if fresh:
        seed()


def seed():
    from auth import hash_password  # local import to avoid circular import at module load

    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    with get_conn() as conn:
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) AS n FROM users")
        if cur.fetchone()["n"] > 0:
            return  # already seeded

        users = [
            ("Maya Ford", "maya@example.com", "password123", "customer", 0),
            ("Théo Laurent", "theo@example.com", "password123", "customer", 0),
            ("Priya Nair", "priya@example.com", "password123", "customer", 0),
            ("Sam Okoye", "sam@example.com", "password123", "customer", 1),
            ("Ren Ito", "ren@orderflow.app", "admin123", "admin", 0),
        ]
        user_ids = {}
        for name, email, pw, role, disabled in users:
            cur.execute(
                "INSERT INTO users (name, email, password_hash, role, disabled, created_at) VALUES (?,?,?,?,?,?)",
                (name, email, hash_password(pw), role, disabled, now),
            )
            user_ids[email] = cur.lastrowid

        categories = [
            ("Desk & Office", "desk-office", "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=600&q=80", 14),
            ("Kitchen", "kitchen", "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=600&q=80", 9),
            ("Lighting", "lighting", "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600&q=80", 11),
            ("Storage", "storage", "https://images.pexels.com/photos/4464887/pexels-photo-4464887.jpeg?w=600&q=80", 7),
        ]
        for name, slug, image, count in categories:
            cur.execute(
                "INSERT INTO categories (name, slug, image, item_count) VALUES (?,?,?,?)",
                (name, slug, image, count),
            )

        products = [
            ("Kessel Oak Desk", "Desk & Office", 349, "https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=800&q=80", 12, "DSK-2201"),
            ("Arc Task Lamp", "Lighting", 79, "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&q=80", 34, "LGT-0912"),
            ("Modular Shelf Unit", "Storage", 219, "https://images.unsplash.com/photo-1600121848594-d8644e57abab?w=800&q=80", 6, "STR-3390"),
            ("Ceramic Pour-Over Set", "Kitchen", 58, "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&q=80", 22, "KIT-1187"),
            ("Linen Desk Mat", "Desk & Office", 34, "https://images.pexels.com/photos/4464887/pexels-photo-4464887.jpeg?w=800&q=80", 41, "DSK-2214"),
            ("Brass Pendant Light", "Lighting", 132, "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=800&q=80", 9, "LGT-0930"),
            ("Stackable Crate Trio", "Storage", 96, "https://images.unsplash.com/photo-1600121848594-d8644e57abab?w=800&q=80", 17, "STR-3401"),
            ("Enamel Storage Canisters", "Kitchen", 44, "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&q=80", 28, "KIT-1194"),
        ]
        product_ids = {}
        for name, category, price, image, stock, sku in products:
            cur.execute(
                "INSERT INTO products (name, category, price, image, stock, sku) VALUES (?,?,?,?,?,?)",
                (name, category, price, image, stock, sku),
            )
            product_ids[sku] = cur.lastrowid

        def item(sku, qty):
            pid = product_ids[sku]
            cur.execute("SELECT name, price, image FROM products WHERE id=?", (pid,))
            p = cur.fetchone()
            return (pid, p["name"], p["price"], p["image"], qty)

        seed_orders = [
            ("ORD-8841", "maya@example.com", "shipped", [("DSK-2201", 1), ("DSK-2214", 2)]),
            ("ORD-8840", "theo@example.com", "pending", [("LGT-0912", 2)]),
            ("ORD-8839", "priya@example.com", "delivered", [("STR-3390", 1)]),
            ("ORD-8838", "sam@example.com", "cancelled", [("LGT-0930", 1), ("STR-3401", 1)]),
            ("ORD-8837", "maya@example.com", "delivered", [("KIT-1187", 1)]),
        ]
        for order_number, email, status, items in seed_orders:
            uid = user_ids[email]
            rows = [item(sku, qty) for sku, qty in items]
            total = sum(price * qty for (_pid, _name, price, _img, qty) in rows)
            cur.execute(
                "INSERT INTO orders (order_number, user_id, customer_name, customer_email, address, city, status, total, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (order_number, uid, email.split("@")[0].title(), email, "123 Demo St", "Springfield", status, total, now),
            )
            oid = cur.lastrowid
            for pid, name, price, image, qty in rows:
                cur.execute(
                    "INSERT INTO order_items (order_id, product_id, name, price, image, qty) VALUES (?,?,?,?,?,?)",
                    (oid, pid, name, price, image, qty),
                )
