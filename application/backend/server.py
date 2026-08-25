"""
server.py — OrderFlow backend.

A REST API + static file server built entirely on Python's standard library
(http.server), plus SQLite for storage and PyJWT for signed session tokens.

Run with:  python3 server.py [port]
Then open the printed URL in your browser.
"""
import json
import os
import re
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from db import init_db, get_conn
from auth import hash_password, verify_password, create_token, decode_token

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

STATIC_MIME = {
    ".html": "text/html; charset=UTF-8",
    ".js": "text/javascript; charset=UTF-8",
    ".css": "text/css; charset=UTF-8",
    ".json": "application/json; charset=UTF-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def row_to_user(row, include_email=True):
    d = {"id": row["id"], "name": row["name"], "role": row["role"], "disabled": bool(row["disabled"])}
    if include_email:
        d["email"] = row["email"]
    return d


def row_to_product(row):
    return {
        "id": row["id"], "name": row["name"], "category": row["category"],
        "price": row["price"], "image": row["image"], "stock": row["stock"], "sku": row["sku"],
    }


def row_to_category(row):
    return {"id": row["id"], "name": row["name"], "slug": row["slug"], "image": row["image"], "count": row["item_count"]}


def row_to_order(row, items=None):
    d = {
        "id": row["order_number"], "date": row["created_at"][:10], "customer": row["customer_name"],
        "email": row["customer_email"], "address": row["address"], "city": row["city"],
        "status": row["status"], "total": row["total"], "userId": row["user_id"],
    }
    if items is not None:
        d["items"] = items
    return d


class Handler(BaseHTTPRequestHandler):
    server_version = "OrderFlow/1.0"

    # ---------- low level helpers ----------
    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=UTF-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            raise ApiError(400, "Malformed JSON body.")

    def current_user_row(self, conn, required=True, admin_only=False):
        auth_header = self.headers.get("Authorization", "")
        token = auth_header[7:] if auth_header.startswith("Bearer ") else None
        if not token:
            if required:
                raise ApiError(401, "Authentication required. Please log in.")
            return None
        user_id = decode_token(token)
        if user_id is None:
            if required:
                raise ApiError(401, "Your session has expired. Please log in again.")
            return None
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if row is None or row["disabled"]:
            if required:
                raise ApiError(401, "Account not found or disabled.")
            return None
        if admin_only and row["role"] != "admin":
            raise ApiError(403, "Admin access required.")
        return row

    # ---------- routing ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PATCH(self):
        self.route("PATCH")

    def do_PUT(self):
        self.route("PUT")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if not path.startswith("/api/"):
            if method == "GET":
                self.serve_static(path)
            else:
                self.send_json(404, {"detail": "Not found"})
            return

        try:
            with get_conn() as conn:
                result = self.dispatch_api(method, path, query, conn)
                self.send_json(200, result)
        except ApiError as e:
            self.send_json(e.status, {"detail": e.message})
        except Exception:
            traceback.print_exc()
            self.send_json(500, {"detail": "Internal server error."})

    def dispatch_api(self, method, path, query, conn):
        # ----- auth -----
        if method == "POST" and path == "/api/auth/register":
            return self.api_register(conn)
        if method == "POST" and path == "/api/auth/login":
            return self.api_login(conn)
        if method == "GET" and path == "/api/auth/me":
            user = self.current_user_row(conn)
            return {"user": row_to_user(user)}

        # ----- public catalog -----
        if method == "GET" and path == "/api/products":
            rows = conn.execute("SELECT * FROM products ORDER BY id").fetchall()
            return {"products": [row_to_product(r) for r in rows]}
        m = re.match(r"^/api/products/(\d+)$", path)
        if method == "GET" and m:
            row = conn.execute("SELECT * FROM products WHERE id=?", (int(m.group(1)),)).fetchone()
            if not row:
                raise ApiError(404, "Product not found.")
            return {"product": row_to_product(row)}
        if method == "GET" and path == "/api/categories":
            rows = conn.execute("SELECT * FROM categories ORDER BY id").fetchall()
            return {"categories": [row_to_category(r) for r in rows]}

        # ----- customer orders -----
        if method == "POST" and path == "/api/orders":
            return self.api_create_order(conn)
        if method == "GET" and path == "/api/orders":
            user = self.current_user_row(conn)
            rows = conn.execute("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC", (user["id"],)).fetchall()
            return {"orders": [row_to_order(r) for r in rows]}
        m = re.match(r"^/api/orders/([\w-]+)$", path)
        if method == "GET" and m:
            user = self.current_user_row(conn)
            order = conn.execute("SELECT * FROM orders WHERE order_number=?", (m.group(1),)).fetchone()
            if not order:
                raise ApiError(404, "Order not found.")
            if order["user_id"] != user["id"] and user["role"] != "admin":
                raise ApiError(403, "You don't have access to this order.")
            items = conn.execute("SELECT * FROM order_items WHERE order_id=?", (order["id"],)).fetchall()
            item_list = [{"id": i["product_id"], "name": i["name"], "price": i["price"], "image": i["image"], "qty": i["qty"]} for i in items]
            return {"order": row_to_order(order, item_list)}

        # ----- admin product/category management -----
        if method == "POST" and path == "/api/admin/products":
            self.current_user_row(conn, admin_only=True)
            return self.api_create_product(conn)
        m = re.match(r"^/api/admin/products/(\d+)$", path)
        if method == "PATCH" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_update_product(conn, int(m.group(1)))
        if method == "PUT" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_update_product(conn, int(m.group(1)))
        if method == "DELETE" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_delete_product(conn, int(m.group(1)))

        if method == "POST" and path == "/api/admin/categories":
            self.current_user_row(conn, admin_only=True)
            return self.api_create_category(conn)
        m = re.match(r"^/api/admin/categories/(\d+)$", path)
        if method == "PATCH" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_update_category(conn, int(m.group(1)))
        if method == "PUT" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_update_category(conn, int(m.group(1)))
        if method == "DELETE" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_delete_category(conn, int(m.group(1)))

        if method == "GET" and path == "/api/admin/orders":
            self.current_user_row(conn, admin_only=True)
            rows = conn.execute("SELECT * FROM orders ORDER BY id DESC").fetchall()
            return {"orders": [row_to_order(r) for r in rows]}
        m = re.match(r"^/api/admin/orders/([\w-]+)/status$", path)
        if method == "PATCH" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_set_order_status(conn, m.group(1))
        if method == "GET" and path == "/api/admin/users":
            self.current_user_row(conn, admin_only=True)
            rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
            return {"users": [row_to_user(r) for r in rows]}
        m = re.match(r"^/api/admin/users/(\d+)/toggle-disabled$", path)
        if method == "PATCH" and m:
            self.current_user_row(conn, admin_only=True)
            return self.api_toggle_user(conn, int(m.group(1)))

        raise ApiError(404, "Not found.")

    # ---------- handlers ----------
    def api_register(self, conn):
        body = self.read_json_body()
        name = (body.get("name") or "").strip()
        email = (body.get("email") or "").strip().lower()
        password = body.get("password") or ""
        if not name or not email or not password:
            raise ApiError(400, "Please fill in all fields.")
        if len(password) < 6:
            raise ApiError(400, "Password must be at least 6 characters.")
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ApiError(400, "Please enter a valid email address.")
        existing = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
        if existing:
            raise ApiError(409, "An account with that email already exists.")
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (name, email, password_hash, role, disabled, created_at) VALUES (?,?,?,?,0,?)",
            (name, email, hash_password(password), "customer", now),
        )
        user_id = cur.lastrowid
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return {"token": create_token(user_id), "user": row_to_user(row)}

    def api_login(self, conn):
        body = self.read_json_body()
        email = (body.get("email") or "").strip().lower()
        password = body.get("password") or ""
        row = conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if not row:
            raise ApiError(401, "No account found with that email.")
        if row["disabled"]:
            raise ApiError(403, "This account has been disabled. Contact an admin.")
        if not verify_password(password, row["password_hash"]):
            raise ApiError(401, "Incorrect password.")
        return {"token": create_token(row["id"]), "user": row_to_user(row)}

    def api_create_order(self, conn):
        user = self.current_user_row(conn)
        body = self.read_json_body()
        items = body.get("items") or []
        if not items:
            raise ApiError(400, "Your cart is empty.")
        name = (body.get("name") or user["name"]).strip()
        email = (body.get("email") or user["email"]).strip()
        address = (body.get("address") or "").strip()
        city = (body.get("city") or "").strip()

        resolved = []
        total = 0.0
        for it in items:
            pid = it.get("id")
            qty = int(it.get("qty") or 1)
            if qty < 1:
                continue
            prod = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
            if not prod:
                raise ApiError(400, f"Product {pid} no longer exists.")
            if prod["stock"] < qty:
                raise ApiError(400, f"Only {prod['stock']} unit(s) of {prod['name']} are available.")
            resolved.append((prod["id"], prod["name"], prod["price"], prod["image"], qty))
            total += prod["price"] * qty

        if not resolved:
            raise ApiError(400, "Your cart is empty.")

        cur = conn.cursor()
        seq_row = cur.execute("SELECT COUNT(*) AS n FROM orders").fetchone()
        order_number = f"ORD-{8842 + seq_row['n']}"
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        cur.execute(
            "INSERT INTO orders (order_number, user_id, customer_name, customer_email, address, city, status, total, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (order_number, user["id"], name, email, address, city, "pending", total, now),
        )
        order_id = cur.lastrowid
        for pid, pname, price, image, qty in resolved:
            cur.execute(
                "INSERT INTO order_items (order_id, product_id, name, price, image, qty) VALUES (?,?,?,?,?,?)",
                (order_id, pid, pname, price, image, qty),
            )
            cur.execute("UPDATE products SET stock=stock-? WHERE id=?", (qty, pid))
        self.refresh_category_counts(conn)
        order_row = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        item_list = [{"id": pid, "name": n, "price": p, "image": img, "qty": q} for pid, n, p, img, q in resolved]
        return {"order": row_to_order(order_row, item_list)}

    def _validate_product_payload(self, conn, body, existing=None):
        name = (body.get("name") if "name" in body else (existing["name"] if existing else "")) or ""
        name = str(name).strip()
        category = (body.get("category") if "category" in body else (existing["category"] if existing else "")) or ""
        category = str(category).strip()
        image = (body.get("image") if "image" in body else (existing["image"] if existing else "")) or ""
        image = str(image).strip()
        sku = (body.get("sku") if "sku" in body else (existing["sku"] if existing else "")) or ""
        sku = str(sku).strip()
        try:
            price = float(body.get("price") if "price" in body else existing["price"])
        except (TypeError, ValueError):
            raise ApiError(400, "Price must be a valid number.")
        try:
            stock = int(body.get("stock") if "stock" in body else existing["stock"])
        except (TypeError, ValueError):
            raise ApiError(400, "Stock must be a whole number.")
        if not name:
            raise ApiError(400, "Product name is required.")
        if not category:
            raise ApiError(400, "Category is required.")
        if price < 0:
            raise ApiError(400, "Price cannot be negative.")
        if stock < 0:
            raise ApiError(400, "Stock cannot be negative.")
        category_row = conn.execute("SELECT id FROM categories WHERE name=?", (category,)).fetchone()
        if not category_row:
            raise ApiError(400, "Selected category does not exist.")
        if not sku:
            raise ApiError(400, "SKU is required.")
        duplicate = conn.execute("SELECT id FROM products WHERE sku=? AND id!=?", (sku, existing["id"] if existing else -1)).fetchone()
        if duplicate:
            raise ApiError(409, "A product with that SKU already exists.")
        return name, category, price, image, stock, sku

    def refresh_category_counts(self, conn):
        conn.execute("UPDATE categories SET item_count=(SELECT COUNT(*) FROM products WHERE products.category=categories.name)")

    def api_create_product(self, conn):
        body = self.read_json_body()
        name, category, price, image, stock, sku = self._validate_product_payload(conn, body)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO products (name, category, price, image, stock, sku) VALUES (?,?,?,?,?,?)",
            (name, category, price, image, stock, sku),
        )
        self.refresh_category_counts(conn)
        row = conn.execute("SELECT * FROM products WHERE id=?", (cur.lastrowid,)).fetchone()
        return {"product": row_to_product(row)}

    def api_update_product(self, conn, product_id):
        row = conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
        if not row:
            raise ApiError(404, "Product not found.")
        body = self.read_json_body()
        name, category, price, image, stock, sku = self._validate_product_payload(conn, body, row)
        conn.execute(
            "UPDATE products SET name=?, category=?, price=?, image=?, stock=?, sku=? WHERE id=?",
            (name, category, price, image, stock, sku, product_id),
        )
        self.refresh_category_counts(conn)
        updated = conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
        return {"product": row_to_product(updated)}

    def api_delete_product(self, conn, product_id):
        row = conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone()
        if not row:
            raise ApiError(404, "Product not found.")
        # Preserve historical order items while removing the live catalog product.
        conn.execute("UPDATE order_items SET product_id=NULL WHERE product_id=?", (product_id,))
        conn.execute("DELETE FROM products WHERE id=?", (product_id,))
        self.refresh_category_counts(conn)
        return {"deleted": product_id}

    def _slugify(self, value):
        slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
        return slug

    def api_create_category(self, conn):
        body = self.read_json_body()
        name = str(body.get("name") or "").strip()
        slug = str(body.get("slug") or self._slugify(name)).strip().lower()
        image = str(body.get("image") or "").strip()
        if not name:
            raise ApiError(400, "Category name is required.")
        if not slug:
            raise ApiError(400, "Category slug is required.")
        if conn.execute("SELECT id FROM categories WHERE name=?", (name,)).fetchone():
            raise ApiError(409, "A category with that name already exists.")
        if conn.execute("SELECT id FROM categories WHERE slug=?", (slug,)).fetchone():
            raise ApiError(409, "A category with that slug already exists.")
        cur = conn.cursor()
        cur.execute("INSERT INTO categories (name, slug, image, item_count) VALUES (?,?,?,0)", (name, slug, image, 0))
        row = conn.execute("SELECT * FROM categories WHERE id=?", (cur.lastrowid,)).fetchone()
        return {"category": row_to_category(row)}

    def api_update_category(self, conn, category_id):
        row = conn.execute("SELECT * FROM categories WHERE id=?", (category_id,)).fetchone()
        if not row:
            raise ApiError(404, "Category not found.")
        body = self.read_json_body()
        name = str(body.get("name") if "name" in body else row["name"] or "").strip()
        slug = str(body.get("slug") if "slug" in body else row["slug"] or "").strip().lower()
        image = str(body.get("image") if "image" in body else row["image"] or "").strip()
        if not name or not slug:
            raise ApiError(400, "Category name and slug are required.")
        if conn.execute("SELECT id FROM categories WHERE name=? AND id!=?", (name, category_id)).fetchone():
            raise ApiError(409, "A category with that name already exists.")
        if conn.execute("SELECT id FROM categories WHERE slug=? AND id!=?", (slug, category_id)).fetchone():
            raise ApiError(409, "A category with that slug already exists.")
        conn.execute("UPDATE categories SET name=?, slug=?, image=? WHERE id=?", (name, slug, image, category_id))
        # Products store category by name, so move existing products with the renamed category.
        conn.execute("UPDATE products SET category=? WHERE category=?", (name, row["name"]))
        self.refresh_category_counts(conn)
        updated = conn.execute("SELECT * FROM categories WHERE id=?", (category_id,)).fetchone()
        return {"category": row_to_category(updated)}

    def api_delete_category(self, conn, category_id):
        row = conn.execute("SELECT * FROM categories WHERE id=?", (category_id,)).fetchone()
        if not row:
            raise ApiError(404, "Category not found.")
        product_count = conn.execute("SELECT COUNT(*) AS n FROM products WHERE category=?", (row["name"],)).fetchone()["n"]
        if product_count:
            raise ApiError(409, "Cannot delete a category while products are assigned to it. Move or delete those products first.")
        conn.execute("DELETE FROM categories WHERE id=?", (category_id,))
        return {"deleted": category_id}

    def api_set_order_status(self, conn, order_number):
        body = self.read_json_body()
        status = body.get("status")
        valid = {"pending", "packed", "shipped", "delivered", "cancelled"}
        if status not in valid:
            raise ApiError(400, f"Status must be one of: {', '.join(sorted(valid))}")
        row = conn.execute("SELECT * FROM orders WHERE order_number=?", (order_number,)).fetchone()
        if not row:
            raise ApiError(404, "Order not found.")
        conn.execute("UPDATE orders SET status=? WHERE order_number=?", (status, order_number))
        updated = conn.execute("SELECT * FROM orders WHERE order_number=?", (order_number,)).fetchone()
        return {"order": row_to_order(updated)}

    def api_toggle_user(self, conn, user_id):
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise ApiError(404, "User not found.")
        new_val = 0 if row["disabled"] else 1
        conn.execute("UPDATE users SET disabled=? WHERE id=?", (new_val, user_id))
        updated = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return {"user": row_to_user(updated)}

    # ---------- static files ----------
    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        safe_path = os.path.normpath(path).lstrip(os.sep)
        file_path = os.path.join(FRONTEND_DIR, safe_path)
        if not os.path.abspath(file_path).startswith(os.path.abspath(FRONTEND_DIR)):
            self.send_response(403)
            self.end_headers()
            return
        if not os.path.isfile(file_path):
            file_path = os.path.join(FRONTEND_DIR, "index.html")  # SPA fallback for client-side routes
        with open(file_path, "rb") as f:
            data = f.read()
        ext = os.path.splitext(file_path)[1].lower()
        self.send_response(200)
        self.send_header("Content-Type", STATIC_MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"\n  OrderFlow is running:\n  →  http://localhost:{port}\n\n  Press Ctrl+C to stop the server.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()