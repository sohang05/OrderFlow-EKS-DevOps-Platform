/* =========================================================
   OrderFlow frontend — talks to the real backend API.
   No build step, no framework — plain JS + fetch().
   ========================================================= */

const API_BASE = ''; // same-origin: backend serves this file too

/* ---------- Icons (inline SVG, minimal line style) ---------- */
const ICONS = {
  bag:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  trash:'<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  arrowLeft:'<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  truck:'<path d="M1 3h13v13H1z"/><path d="M14 8h4l4 4v4h-8V8Z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  dollar:'<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  clock:'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  box:'<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  users:'<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/><circle cx="17" cy="9" r="3"/><path d="M17 21v-1a5.9 5.9 0 0 0-1-3.3"/>',
  tag:'<path d="M20 10 12 2H4v8l8 8 8-8Z"/><circle cx="7.5" cy="6.5" r="1.2"/>',
  dashboard:'<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="11" width="8" height="10" rx="1"/><rect x="3" y="14" width="8" height="7" rx="1"/>',
  shield:'<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5Z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
  searchX:'<circle cx="10" cy="10" r="7"/><path d="M21 21l-4.35-4.35"/><path d="M8 8l4 4M12 8l-4 4"/>',
  alert:'<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  packageIcon:'<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="M12 22V12"/><path d="M21 8l-9 5-9-5"/>',
};
function icon(name, cls){ return `<svg class="icon ${cls||''}" viewBox="0 0 24 24">${ICONS[name]||''}</svg>`; }

const STATUS_LABEL = { pending:'Pending', packed:'Packed', shipped:'Shipped', delivered:'Delivered', cancelled:'Cancelled' };
const STATUSES = Object.keys(STATUS_LABEL);
function badge(status){ return `<span class="badge badge-${status}" data-testid="status-badge-${status}"><span class="dot"></span>${STATUS_LABEL[status]||status}</span>`; }
function currency(n){ return '$' + Number(n).toFixed(2); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- Safe localStorage helpers (never throw / never blank the page) ---------- */
function safeGet(key){ try{ return localStorage.getItem(key); }catch(e){ return null; } }
function safeSet(key,val){ try{ localStorage.setItem(key,val); }catch(e){ /* ignore */ } }
function safeRemove(key){ try{ localStorage.removeItem(key); }catch(e){ /* ignore */ } }

/* ---------- API client ---------- */
class ApiClientError extends Error {}
async function api(method, path, body){
  const headers = { 'Content-Type': 'application/json' };
  const token = safeGet('orderflow_token');
  if(token) headers['Authorization'] = 'Bearer ' + token;
  let res;
  try{
    res = await fetch(API_BASE + path, { method, headers, body: body!==undefined ? JSON.stringify(body) : undefined });
  }catch(networkErr){
    throw new ApiClientError('Could not reach the server. Is the backend running?');
  }
  let data = {};
  try{ data = await res.json(); }catch(e){ /* empty/non-json body */ }
  if(!res.ok){
    throw new ApiClientError(data.detail || ('Request failed (' + res.status + ')'));
  }
  return data;
}
const apiGet = (path) => api('GET', path);
const apiPost = (path, body) => api('POST', path, body);
const apiPatch = (path, body) => api('PATCH', path, body);

/* ---------- App State ---------- */
const state = {
  route:'home', params:{},
  currentUser:null,
  products:[], categories:[],
  cart: [],
  adminModal: null,
  adminNotice: '',
  adminProductSearch: '',
  cache: {},        // per-route fetched data: orders, orderDetail, adminOrders, adminUsers
  authError:'',
  redirectAfterLogin:null, redirectAfterLoginParams:null,
  bootError:'',
};

function findProduct(id){ return state.products.find(p => p.id === Number(id)); }

/* Which cache keys must be refetched every time we navigate to a given route */
const ROUTE_CACHE_KEYS = {
  orders: ['orders'],
  order: ['orderDetail'],
  admin: ['adminOrders'],
  'admin-orders': ['adminOrders'],
  'admin-users': ['adminUsers'],
  'admin-manage': [],
  'admin-products': [],
  'admin-categories': [],
};

const PROTECTED_ROUTES = [
  'orders',
  'order',
  'checkout',
  'admin',
  'admin-orders',
  'admin-manage',
  'admin-products',
  'admin-categories',
  'admin-users'
];

const ADMIN_ROUTES = [
  'admin',
  'admin-orders',
  'admin-manage',
  'admin-products',
  'admin-categories',
  'admin-users'
];

function requireAuth(route){
  if(PROTECTED_ROUTES.includes(route) && !state.currentUser) return 'login';
  if(ADMIN_ROUTES.includes(route) && state.currentUser && state.currentUser.role !== 'admin') return 'unauthorized';
  return route;
}

function go(route, params={}){
  const target = requireAuth(route);
  if(target === 'login' && route !== 'login'){
    state.redirectAfterLogin = route;
    state.redirectAfterLoginParams = params;
  }
  const finalRoute = target;
  state.route = finalRoute;
  state.params = (finalRoute === route) ? params : {};
  state.authError = '';
  (ROUTE_CACHE_KEYS[finalRoute] || []).forEach(k => delete state.cache[k]);
  render();
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ---------- Cart (client-side only; submitted to server at checkout) ---------- */
function addToCart(id, qty=1){
  id = Number(id);
  const p = findProduct(id); if(!p) return;
  const found = state.cart.find(i=>i.id===id);
  if(found) found.qty += qty; else state.cart.push({...p, qty});
  render();
}
function updateQty(id, qty){ id = Number(id); const i = state.cart.find(x=>x.id===id); if(i) i.qty = Math.max(1, qty); render(); }
function removeFromCart(id){ id = Number(id); state.cart = state.cart.filter(i=>i.id!==id); render(); }
function clearCart(){ state.cart = []; }

/* ---------- Auth ---------- */
async function loginUser(email, password){
  state.authError = '';
  try{
    const data = await apiPost('/api/auth/login', { email, password });
    safeSet('orderflow_token', data.token);
    state.currentUser = data.user;
    const dest = state.redirectAfterLogin || 'home';
    const destParams = state.redirectAfterLoginParams || {};
    state.redirectAfterLogin = null; state.redirectAfterLoginParams = null;
    go(dest, destParams);
  }catch(err){
    state.authError = err.message || 'Login failed.';
    render();
  }
}
async function registerUser(form){
  state.authError = '';
  try{
    const data = await apiPost('/api/auth/register', form);
    safeSet('orderflow_token', data.token);
    state.currentUser = data.user;
    go('home');
  }catch(err){
    state.authError = err.message || 'Sign up failed.';
    render();
  }
}
function logoutUser(){
  state.currentUser = null;
  safeRemove('orderflow_token');
  state.cache = {};
  go('home');
}

/* ---------- Orders (server-backed) ---------- */
async function placeOrder(form){
  const items = state.cart.map(i => ({ id: i.id, qty: i.qty }));
  const data = await apiPost('/api/orders', { items, name: form.name, email: form.email, address: form.address, city: form.city });
  clearCart();
  return data.order;
}
async function setOrderStatus(orderId, status){
  await apiPatch(`/api/admin/orders/${encodeURIComponent(orderId)}/status`, { status });
  delete state.cache.adminOrders;
  render();
  loadCache('adminOrders', () => apiGet('/api/admin/orders').then(d=>d.orders), state.route);
}
async function toggleUserDisabled(userId){
  await apiPatch(`/api/admin/users/${userId}/toggle-disabled`);
  delete state.cache.adminUsers;
  render();
  loadCache('adminUsers', () => apiGet('/api/admin/users').then(d=>d.users), state.route);
}

/* ---------- Generic async cache loader ----------
   Pages call this; it kicks off a fetch (once) and re-renders when the
   data lands, but only if the user is still on the route that asked for it
   (avoids stale updates if they've since navigated elsewhere). */
function loadCache(key, fetchFn, routeAtCallTime){
  if(state.cache[key] !== undefined) return; // already loaded or loading
  state.cache[key] = null; // mark "loading"
  fetchFn().then(data => {
    if(state.route === routeAtCallTime){ state.cache[key] = data; render(); }
  }).catch(err => {
    if(state.route === routeAtCallTime){ state.cache[key] = { __error: err.message || 'Failed to load.' }; render(); }
  });
}
function loadingBlock(){
  return `<div class="loading-shell" style="min-height:40vh;"><div class="spinner"></div><div class="mono" style="font-size:12px;text-transform:uppercase;">Loading…</div></div>`;
}
function errorBlock(msg){
  return `<div class="container" style="padding:60px 24px;">${emptyHTML('alert', 'Something went wrong', esc(msg))}</div>`;
}

/* ---------- Shell ---------- */
function navHTML(){
  const cartCount = state.cart.reduce((a,i)=>a+i.qty,0);
  const links = [['home','Home'],['products','Shop'],['orders','My Orders']];
  return `
  <header class="nav">
    <div class="nav-inner">
      <button class="logo" onclick="go('home')" data-testid="nav-logo">
        <span class="logo-mark">O</span>OrderFlow
      </button>
      <nav class="nav-links">
        ${links.map(([k,l])=>`<button class="nav-link ${state.route===k?'active':''}" onclick="go('${k}')" data-testid="nav-link-${k}">${l}</button>`).join('')}
      </nav>
      <div class="nav-actions">
        ${state.currentUser ? `
          <span class="role-toggle" style="cursor:default;" data-testid="nav-current-user">
            ${icon(state.currentUser.role==='admin'?'shield':'user')} ${esc(state.currentUser.name.split(' ')[0])}
          </span>
          ${state.currentUser.role==='admin' ? `<button class="btn btn-outline btn-sm" onclick="go('admin')" data-testid="nav-admin-link">Admin</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="logoutUser()" data-testid="nav-logout-btn">Log out</button>
        ` : `
          <button class="btn btn-ghost btn-sm" onclick="go('login')" data-testid="nav-login-link">Log in</button>
          <button class="btn btn-outline btn-sm" onclick="go('register')" data-testid="nav-signup-link">Sign up</button>
        `}
        <button class="cart-btn" onclick="go('cart')" data-testid="nav-cart">
          ${icon('bag')}
          ${cartCount>0?`<span class="cart-count">${cartCount}</span>`:''}
        </button>
      </div>
    </div>
  </header>`;
}
function footerHTML(){
  return `
  <footer class="footer">
    <div class="footer-inner">
      <div class="logo" style="font-size:15px;"><span class="logo-mark" style="width:20px;height:20px;"></span>OrderFlow</div>
      <div class="mono" style="font-size:12px;">© 2026 OrderFlow — a small-batch goods co.</div>
    </div>
  </footer>`;
}
function emptyHTML(iconName, title, subtitle){
  return `<div class="empty">${icon(iconName,'')} <div class="display" style="font-size:18px;margin-top:10px;">${title}</div>${subtitle?`<div class="muted" style="font-size:14px;margin-top:6px;max-width:320px;">${subtitle}</div>`:''}</div>`;
}

/* ---------- Product Card ---------- */
function productCard(p){
  return `
  <div class="card hover" style="overflow:hidden;display:flex;flex-direction:column;" data-testid="product-card-${p.id}">
    <div style="height:180px;overflow:hidden;cursor:pointer;" onclick="go('product',{id:${p.id}})">
      <img src="${p.image}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover;">
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;flex:1;">
      <div class="mono muted" style="font-size:11px;text-transform:uppercase;margin-bottom:4px;">${esc(p.category)}</div>
      <div class="display" style="font-size:16px;cursor:pointer;" onclick="go('product',{id:${p.id}})">${esc(p.name)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:12px;">
        <span class="mono" style="font-weight:700;color:var(--brand);">${currency(p.price)}</span>
        <button class="btn btn-ghost btn-sm" onclick="addToCart(${p.id},1)" data-testid="add-to-cart-${p.id}">${icon('plus')} Add</button>
      </div>
    </div>
  </div>`;
}

/* ---------- Home ---------- */
function pageHome(){
  const featured = state.products.slice(0,4);
  return `
  <section class="container" style="padding:56px 24px 64px;display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;">
    <div>
      <div class="eyebrow">New season, small batches</div>
      <h1 class="display" style="font-size:52px;line-height:0.98;margin-bottom:20px;">Objects for a<br><span style="color:var(--brand);">calmer</span> desk.</h1>
      <p class="muted" style="font-size:18px;max-width:420px;margin-bottom:32px;">Considered furniture and everyday goods, made in limited runs and shipped from our own warehouse.</p>
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <button class="btn btn-accent btn-lg" onclick="go('products')" data-testid="home-shop-cta">Shop the collection</button>
        <button class="btn btn-outline btn-lg" onclick="go('orders')" data-testid="home-track-cta">Track an order</button>
      </div>
    </div>
    <div style="position:relative;">
      <img src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1000&q=80" alt="Studio interior" style="border-radius:12px;width:100%;height:420px;object-fit:cover;">
      <div class="card" style="position:absolute;bottom:-24px;left:-24px;padding:16px;">
        <div class="mono muted" style="font-size:11px;text-transform:uppercase;">This week</div>
        <div class="display" style="font-size:24px;color:var(--brand);">128 orders shipped</div>
      </div>
    </div>
  </section>

  <section class="container" style="padding:56px 24px;">
    <div class="eyebrow">Browse</div>
    <h2 class="display" style="font-size:30px;margin-bottom:28px;">Categories</h2>
    <div class="grid grid-4">
      ${state.categories.map((c,i)=>`
        <div class="card hover" style="overflow:hidden;cursor:pointer;" onclick="go('products',{category:'${esc(c.name)}'})" data-testid="category-card-${c.slug}">
          <div style="height:140px;overflow:hidden;"><img src="${c.image}" alt="${esc(c.name)}" style="width:100%;height:100%;object-fit:cover;"></div>
          <div style="padding:14px;">
            <div class="display" style="font-size:15px;">${esc(c.name)}</div>
            <div class="mono muted" style="font-size:11px;">${c.count} items</div>
          </div>
        </div>`).join('')}
    </div>
  </section>

  <section class="container" style="padding:56px 24px;">
    <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px;">
      <div><div class="eyebrow">Hand-picked</div><h2 class="display" style="font-size:30px;">Featured products</h2></div>
      <button class="btn btn-ghost btn-sm" onclick="go('products')" data-testid="home-view-all">View all →</button>
    </div>
    <div class="grid grid-4">${featured.map(productCard).join('')}</div>
  </section>`;
}

/* ---------- Products / Product Detail ---------- */
function pageProducts(){
  const cat = state.params.category || state._filterCat || 'All';
  const q = state._searchQ || '';
  const cats = ['All', ...state.categories.map(c=>c.name)];
  const filtered = state.products.filter(p => (cat==='All'||p.category===cat) && p.name.toLowerCase().includes(q.toLowerCase()));
  return `
  <div class="container" style="padding:48px 24px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:16px;margin-bottom:28px;">
      <div><div class="eyebrow">Catalog</div><h1 class="display" style="font-size:38px;">Shop</h1></div>
      <input class="input" style="width:280px;" placeholder="Search products…" value="${esc(q)}" oninput="onSearchInput(this.value)" data-testid="products-search">
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:28px;">
      ${cats.map(c=>`<button class="btn ${cat===c?'btn-primary':'btn-outline'} btn-sm" onclick="onFilterCat('${esc(c)}')" data-testid="filter-${c}">${esc(c)}</button>`).join('')}
    </div>
    ${filtered.length===0 ? emptyHTML('searchX','No products found','Try a different search term or category.')
      : `<div class="grid grid-4">${filtered.map(productCard).join('')}</div>`}
  </div>`;
}
function onFilterCat(c){ state._filterCat = c; state.params = {}; render(); }
function onSearchInput(v){ state._searchQ = v; render(); const el=document.querySelector('[data-testid="products-search"]'); if(el){ el.focus(); el.setSelectionRange(v.length,v.length); } }

function pageProductDetail(){
  const p = findProduct(state.params.id) || state.products[0];
  if(!p) return errorBlock('Product not found.');
  const qty = state._detailQty || 1;
  return `
  <div class="container" style="padding:48px 24px;max-width:940px;">
    <button class="btn btn-ghost btn-sm" onclick="go('products')" data-testid="back-to-products" style="margin-bottom:24px;padding-left:0;">${icon('arrowLeft')} Back to shop</button>
    <div class="grid grid-2" style="align-items:start;">
      <img src="${p.image}" alt="${esc(p.name)}" style="border-radius:12px;width:100%;height:420px;object-fit:cover;">
      <div>
        <div class="mono muted" style="font-size:11px;text-transform:uppercase;margin-bottom:8px;">${esc(p.category)} · SKU ${esc(p.sku)}</div>
        <h1 class="display" style="font-size:32px;margin-bottom:12px;">${esc(p.name)}</h1>
        <div class="mono" style="font-size:24px;font-weight:700;color:var(--brand);margin-bottom:20px;">${currency(p.price)}</div>
        <p class="muted" style="max-width:380px;margin-bottom:24px;">Solid construction, considered proportions, finished by hand in small batches. ${p.stock} in stock.</p>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <div style="display:flex;align-items:center;border:1px solid var(--line);border-radius:6px;">
            <button class="btn btn-ghost btn-sm" onclick="setDetailQty(${Math.max(1,qty-1)})" data-testid="qty-decrease">−</button>
            <span class="mono" style="padding:0 14px;">${qty}</span>
            <button class="btn btn-ghost btn-sm" onclick="setDetailQty(${qty+1})" data-testid="qty-increase">+</button>
          </div>
          <button class="btn btn-accent" onclick="addToCart(${p.id},${qty}); go('cart')" data-testid="product-add-to-cart">${icon('bag')} Add to cart</button>
        </div>
        <div class="mono" style="font-size:12px;color:var(--moss);display:flex;align-items:center;gap:6px;">${icon('truck')} Ships within 2 business days</div>
      </div>
    </div>
  </div>`;
}
function setDetailQty(q){ state._detailQty = q; render(); }

/* ---------- Cart / Checkout ---------- */
function pageCart(){
  if(state.cart.length===0){
    return `<div class="container" style="padding:80px 24px;max-width:640px;">
      ${emptyHTML('bag','Your cart is empty','Browse the shop to find something for your desk.')}
      <div style="display:flex;justify-content:center;"><button class="btn btn-accent" onclick="go('products')" data-testid="cart-empty-shop">Shop now</button></div>
    </div>`;
  }
  const subtotal = state.cart.reduce((a,i)=>a+i.price*i.qty,0);
  return `
  <div class="container" style="padding:48px 24px;max-width:880px;">
    <h1 class="display" style="font-size:38px;margin-bottom:28px;">Your cart</h1>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:28px;">
      ${state.cart.map(i=>`
        <div class="card" style="display:flex;align-items:center;gap:16px;padding:16px;" data-testid="cart-item-${i.id}">
          <img src="${i.image}" style="width:64px;height:64px;border-radius:6px;object-fit:cover;">
          <div style="flex:1;">
            <div class="display" style="font-size:15px;">${esc(i.name)}</div>
            <div class="mono muted" style="font-size:11px;">${currency(i.price)} each</div>
          </div>
          <div style="display:flex;align-items:center;border:1px solid var(--line);border-radius:6px;">
            <button class="btn btn-ghost btn-sm" onclick="updateQty(${i.id},${i.qty-1})">−</button>
            <span class="mono" style="padding:0 10px;font-size:14px;">${i.qty}</span>
            <button class="btn btn-ghost btn-sm" onclick="updateQty(${i.id},${i.qty+1})">+</button>
          </div>
          <div class="mono" style="width:70px;text-align:right;">${currency(i.price*i.qty)}</div>
          <button class="btn btn-ghost btn-sm" onclick="removeFromCart(${i.id})" data-testid="cart-remove-${i.id}" style="color:var(--coral);">${icon('trash')}</button>
        </div>`).join('')}
    </div>
    <div style="display:flex;justify-content:flex-end;">
      <div class="card" style="width:320px;padding:20px;">
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px;"><span class="muted">Subtotal</span><span class="mono">${currency(subtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:16px;"><span class="muted">Shipping</span><span class="mono" style="color:var(--moss);">Free</span></div>
        <div style="display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid var(--line);margin-bottom:20px;"><span class="display" style="font-size:18px;">Total</span><span class="display" style="font-size:18px;color:var(--brand);">${currency(subtotal)}</span></div>
        <button class="btn btn-accent" style="width:100%;" onclick="go('checkout')" data-testid="cart-checkout-btn">Checkout</button>
      </div>
    </div>
  </div>`;
}

function pageCheckout(){
  const subtotal = state.cart.reduce((a,i)=>a+i.price*i.qty,0);
  const f = state._checkoutForm || { name:(state.currentUser&&state.currentUser.name)||'', email:(state.currentUser&&state.currentUser.email)||'', address:'', city:'' };
  return `
  <div class="container" style="padding:48px 24px;max-width:880px;">
    <div class="grid" style="grid-template-columns:3fr 2fr;">
      <form onsubmit="return submitCheckout(event)">
        <h1 class="display" style="font-size:30px;margin-bottom:20px;">Checkout</h1>
        ${state.authError ? `<div class="field-error" data-testid="checkout-error">${esc(state.authError)}</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:14px;">
          <input class="input" placeholder="Full name" required value="${esc(f.name)}" oninput="updateCheckoutField('name',this.value)" data-testid="checkout-name">
          <input class="input" placeholder="Email" type="email" required value="${esc(f.email)}" oninput="updateCheckoutField('email',this.value)" data-testid="checkout-email">
          <input class="input" placeholder="Shipping address" required value="${esc(f.address)}" oninput="updateCheckoutField('address',this.value)" data-testid="checkout-address">
          <input class="input" placeholder="City" required value="${esc(f.city)}" oninput="updateCheckoutField('city',this.value)" data-testid="checkout-city">
          <button type="submit" class="btn btn-accent btn-lg" style="width:100%;" id="checkout-submit-button" data-testid="checkout-submit-button">Place order — ${currency(subtotal)}</button>
        </div>
      </form>
      <div>
        <div class="card" style="padding:20px;">
          <div class="display" style="margin-bottom:12px;">Order summary</div>
          ${state.cart.map(i=>`<div style="display:flex;justify-content:space-between;font-size:14px;padding:5px 0;"><span class="muted">${i.qty}× ${esc(i.name)}</span><span class="mono">${currency(i.price*i.qty)}</span></div>`).join('')}
          <div style="display:flex;justify-content:space-between;padding-top:12px;margin-top:8px;border-top:1px solid var(--line);"><span class="display" style="font-size:16px;">Total</span><span class="display" style="font-size:16px;color:var(--brand);">${currency(subtotal)}</span></div>
        </div>
      </div>
    </div>
  </div>`;
}
function updateCheckoutField(k,v){ state._checkoutForm = {...(state._checkoutForm||{name:'',email:'',address:'',city:''}), [k]:v}; }
async function submitCheckout(e){
  e.preventDefault();
  const form = state._checkoutForm || {};
  const btn = document.getElementById('checkout-submit-button');
  if(btn){ btn.disabled = true; btn.textContent = 'Placing order…'; }
  state.authError = '';
  try{
    const order = await placeOrder(form);
    state._checkoutForm = null;
    go('order', {id: order.id});
  }catch(err){
    state.authError = err.message || 'Could not place order.';
    render();
  }
  return false;
}

/* ---------- Orders (fetched from server) ---------- */
function pageOrders(){
  loadCache('orders', () => apiGet('/api/orders').then(d=>d.orders), 'orders');
  const data = state.cache.orders;
  if(data === undefined || data === null) return loadingBlock();
  if(data.__error) return errorBlock(data.__error);
  if(data.length===0) return `<div class="container" style="padding:80px 24px;max-width:640px;">${emptyHTML('packageIcon','No orders yet','Your placed orders will show up here.')}
    <div style="display:flex;justify-content:center;"><button class="btn btn-accent" onclick="go('products')" data-testid="orders-empty-shop">Shop now</button></div>
  </div>`;
  return `
  <div class="container" style="padding:48px 24px;max-width:880px;">
    <h1 class="display" style="font-size:38px;margin-bottom:28px;">My orders</h1>
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${data.map(o=>`
        <button class="card hover" style="width:100%;text-align:left;display:flex;align-items:center;justify-content:space-between;padding:16px;border:1px solid var(--line);background:var(--surface);" onclick="go('order',{id:'${o.id}'})" data-testid="order-row-${o.id}">
          <div>
            <div class="mono muted" style="font-size:13px;">${o.id} · ${o.date}</div>
            <div class="display" style="font-size:16px;">${currency(o.total)}</div>
          </div>
          ${badge(o.status)}
        </button>`).join('')}
    </div>
  </div>`;
}

function pageOrderDetail(){
  const orderId = state.params.id;
  loadCache('orderDetail', () => apiGet(`/api/orders/${encodeURIComponent(orderId)}`).then(d=>d.order), 'order');
  const o = state.cache.orderDetail;
  if(o === undefined || o === null) return loadingBlock();
  if(o.__error) return errorBlock(o.__error);
  return `
  <div class="container" style="padding:48px 24px;max-width:720px;">
    <button class="btn btn-ghost btn-sm" onclick="go('orders')" style="padding-left:0;margin-bottom:20px;">${icon('arrowLeft')} Back to orders</button>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
      <div><div class="mono muted" style="font-size:11px;text-transform:uppercase;">Order</div><h1 class="display mono" style="font-size:28px;">${o.id}</h1></div>
      ${badge(o.status)}
    </div>
    <div class="card" style="margin-bottom:24px;">
      ${o.items.map((i,idx)=>`
        <div style="display:flex;align-items:center;gap:16px;padding:16px;${idx>0?'border-top:1px solid var(--line);':''}">
          <img src="${i.image}" style="width:56px;height:56px;border-radius:6px;object-fit:cover;">
          <div style="flex:1;"><div class="display" style="font-size:15px;">${esc(i.name)}</div><div class="mono muted" style="font-size:11px;">Qty ${i.qty}</div></div>
          <div class="mono">${currency(i.price*i.qty)}</div>
        </div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;"><span class="display" style="font-size:18px;">Total</span><span class="display" style="font-size:18px;color:var(--brand);">${currency(o.total)}</span></div>
  </div>`;
}

/* ---------- Auth Pages ---------- */
function pageLogin(){
  const f = state._loginForm || { email:'', password:'' };
  const redirectNote = state.redirectAfterLogin && state.redirectAfterLogin !== 'home'
    ? `<div class="mono" style="font-size:12px;color:var(--sky-700);background:var(--sky-50);padding:10px 12px;border-radius:6px;margin-bottom:20px;">Please log in to continue.</div>` : '';
  return `
  <div class="container" style="padding:64px 24px;max-width:420px;">
    <div class="eyebrow">Welcome back</div>
    <h1 class="display" style="font-size:32px;margin-bottom:20px;">Log in</h1>
    ${redirectNote}
    ${state.authError ? `<div class="field-error" data-testid="login-error">${esc(state.authError)}</div>` : ''}
    <form onsubmit="return submitLogin(event)" style="display:flex;flex-direction:column;gap:14px;">
      <input class="input" type="email" placeholder="Email" required value="${esc(f.email)}" oninput="updateLoginField('email',this.value)" data-testid="login-email">
      <input class="input" type="password" placeholder="Password" required value="${esc(f.password)}" oninput="updateLoginField('password',this.value)" data-testid="login-password">
      <button type="submit" class="btn btn-accent btn-lg" style="width:100%;" id="login-submit-button" data-testid="login-submit-button">Log in</button>
    </form>
    <div class="muted" style="font-size:14px;margin-top:20px;">
      No account? <a href="#" onclick="go('register');return false;" style="color:var(--brand);font-weight:600;" data-testid="login-goto-signup">Sign up</a>
    </div>
    <div class="card" style="margin-top:28px;padding:14px 16px;">
      <div class="mono muted" style="font-size:11px;text-transform:uppercase;margin-bottom:6px;">Demo accounts</div>
      <div style="font-size:13px;line-height:1.7;">
        Customer: <span class="mono">maya@example.com</span> / <span class="mono">password123</span><br>
        Admin: <span class="mono">ren@orderflow.app</span> / <span class="mono">admin123</span>
      </div>
    </div>
  </div>`;
}
function updateLoginField(k,v){ state._loginForm = {...(state._loginForm||{email:'',password:''}), [k]:v}; }
async function submitLogin(e){
  e.preventDefault();
  const f = state._loginForm || {};
  const btn = document.getElementById('login-submit-button');
  if(btn){ btn.disabled = true; btn.textContent = 'Logging in…'; }
  await loginUser(f.email, f.password);
  return false;
}

function pageRegister(){
  const f = state._registerForm || { name:'', email:'', password:'' };
  return `
  <div class="container" style="padding:64px 24px;max-width:420px;">
    <div class="eyebrow">Join OrderFlow</div>
    <h1 class="display" style="font-size:32px;margin-bottom:20px;">Create an account</h1>
    ${state.authError ? `<div class="field-error" data-testid="register-error">${esc(state.authError)}</div>` : ''}
    <form onsubmit="return submitRegister(event)" style="display:flex;flex-direction:column;gap:14px;">
      <input class="input" placeholder="Full name" required value="${esc(f.name)}" oninput="updateRegisterField('name',this.value)" data-testid="register-name">
      <input class="input" type="email" placeholder="Email" required value="${esc(f.email)}" oninput="updateRegisterField('email',this.value)" data-testid="register-email">
      <input class="input" type="password" placeholder="Password (min. 6 characters)" required value="${esc(f.password)}" oninput="updateRegisterField('password',this.value)" data-testid="register-password">
      <button type="submit" class="btn btn-accent btn-lg" style="width:100%;" id="register-submit-button" data-testid="register-submit-button">Sign up</button>
    </form>
    <div class="muted" style="font-size:14px;margin-top:20px;">
      Already have an account? <a href="#" onclick="go('login');return false;" style="color:var(--brand);font-weight:600;" data-testid="register-goto-login">Log in</a>
    </div>
  </div>`;
}
function updateRegisterField(k,v){ state._registerForm = {...(state._registerForm||{name:'',email:'',password:''}), [k]:v}; }
async function submitRegister(e){
  e.preventDefault();
  const f = state._registerForm || {};
  const btn = document.getElementById('register-submit-button');
  if(btn){ btn.disabled = true; btn.textContent = 'Creating account…'; }
  await registerUser(f);
  return false;
}

function pageUnauthorized(){
  return `<div class="container" style="padding:80px 24px;">${emptyHTML('shield','Not authorized','This area is for admin accounts only.')}
    <div style="display:flex;justify-content:center;"><button class="btn btn-accent" onclick="go('home')" data-testid="unauthorized-home">Back to home</button></div>
  </div>`;
}

/* ---------- Admin ---------- */
/* ---------- Admin ---------- */

function adminLayout(active, inner){
  const items = [
    ['admin','Dashboard','dashboard'],
    ['admin-orders','Orders','packageIcon'],
    ['admin-manage','Manage','box'],
    ['admin-categories','Categories','tag'],
    ['admin-users','Users','users'],
  ];

  return `
  <div class="admin-wrap">
    <aside>
      <div class="mono muted"
           style="font-size:11px;text-transform:uppercase;margin-bottom:12px;padding:0 4px;">
        Admin
      </div>

      ${items.map(([k,l,ic]) => `
        <button
          class="admin-nav-item ${active===k?'active':''}"
          onclick="go('${k}')"
          data-testid="admin-nav-${k}">
          ${icon(ic)} ${l}
        </button>
      `).join('')}
    </aside>

    <div style="min-width:0;">
      ${inner}
    </div>
  </div>`;
}


/* ---------- Dashboard ---------- */

function kpi(label,value,iconName,bg,fg){
  return `
  <div class="kpi"
       data-testid="kpi-${label.toLowerCase().replace(/\s/g,'-')}">

    <div class="kpi-top">
      <span class="mono muted"
            style="font-size:11px;text-transform:uppercase;">
        ${label}
      </span>

      <span class="kpi-icon"
            style="background:${bg};color:${fg};">
        ${icon(iconName)}
      </span>
    </div>

    <div class="display" style="font-size:28px;">
      ${value}
    </div>
  </div>`;
}


function pageAdminDashboard(){

  loadCache(
    'adminOrders',
    () => apiGet('/api/admin/orders').then(d=>d.orders),
    'admin'
  );

  const orders = state.cache.adminOrders;

  if(orders === undefined || orders === null){
    return adminLayout('admin',loadingBlock());
  }

  if(orders.__error){
    return adminLayout('admin',errorBlock(orders.__error));
  }

  const revenue = orders.reduce(
    (total,o) => total + (o.status !== 'cancelled' ? Number(o.total) : 0),
    0
  );

  const pending = orders.filter(
    o => o.status === 'pending'
  ).length;

  const inner = `
    <div style="margin-bottom:24px;">
      <div class="mono muted"
           style="font-size:11px;text-transform:uppercase;">
        Overview
      </div>

      <h1 class="display" style="font-size:30px;">
        Dashboard
      </h1>
    </div>

    <div class="grid grid-4" style="margin-bottom:32px;">

      ${kpi(
        'Revenue',
        currency(revenue),
        'dollar',
        'var(--brand-50)',
        'var(--brand)'
      )}

      ${kpi(
        'Orders',
        orders.length,
        'packageIcon',
        'var(--sky-50)',
        'var(--sky-700)'
      )}

      ${kpi(
        'Pending',
        pending,
        'clock',
        'var(--amber-50)',
        'var(--amber-700)'
      )}

      ${kpi(
        'Products',
        state.products.length,
        'box',
        'var(--moss-50)',
        'var(--moss-700)'
      )}

    </div>

    <div class="card" style="overflow:hidden;">

      <div
        style="padding:16px 20px;border-bottom:1px solid var(--line);"
        class="display">
        Recent orders
      </div>

      <table data-testid="admin-dashboard-recent">
        <tbody>

          ${
            orders.slice(0,5).map(o => `
              <tr>

                <td
                  class="mono muted"
                  style="font-size:12px;">
                  ${esc(o.id)}
                </td>

                <td
                  class="display"
                  style="font-size:14px;">
                  ${esc(o.customer)}
                </td>

                <td class="mono">
                  ${currency(o.total)}
                </td>

                <td>
                  ${badge(o.status)}
                </td>

              </tr>
            `).join('')
          }

        </tbody>
      </table>

    </div>`;

  return adminLayout('admin',inner);
}


/* ---------- Admin Orders ---------- */

function pageAdminOrders(){

  loadCache(
    'adminOrders',
    () => apiGet('/api/admin/orders').then(d=>d.orders),
    'admin-orders'
  );

  const orders = state.cache.adminOrders;

  if(orders === undefined || orders === null){
    return adminLayout('admin-orders',loadingBlock());
  }

  if(orders.__error){
    return adminLayout(
      'admin-orders',
      errorBlock(orders.__error)
    );
  }

  const inner = `
    <div style="margin-bottom:24px;">

      <div class="mono muted"
           style="font-size:11px;text-transform:uppercase;">
        Fulfillment
      </div>

      <h1 class="display" style="font-size:30px;">
        Orders
      </h1>

    </div>

    <div class="card" style="overflow:hidden;">

      <table data-testid="admin-orders-table">

        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>

        <tbody>

          ${
            orders.map(o => `

              <tr data-testid="admin-order-row-${o.id}">

                <td
                  class="mono"
                  style="font-size:12px;">
                  ${esc(o.id)}
                </td>

                <td
                  class="display"
                  style="font-size:14px;">
                  ${esc(o.customer)}
                </td>

                <td class="mono">
                  ${currency(o.total)}
                </td>

                <td>
                  ${badge(o.status)}
                </td>

                <td style="text-align:right;">

                  <button
                    class="btn btn-ghost btn-sm"
                    onclick="toggleOrderMenu('${o.id}')">
                    Manage
                  </button>

                </td>

              </tr>

              ${
                state.openOrderMenu === o.id
                ? `

                  <tr>

                    <td
                      colspan="5"
                      style="background:#FBFAF7;padding:16px;">

                      <span
                        class="mono muted"
                        style="font-size:11px;text-transform:uppercase;margin-right:8px;">
                        Set status:
                      </span>

                      ${
                        STATUSES.map(st => `

                          <button
                            class="btn btn-sm"
                            style="
                              margin:2px;
                              border:1px solid ${
                                o.status===st
                                ? 'var(--ink)'
                                : 'var(--line)'
                              };
                              background:${
                                o.status===st
                                ? 'var(--ink)'
                                : 'transparent'
                              };
                              color:${
                                o.status===st
                                ? 'var(--paper)'
                                : 'var(--hazel)'
                              };
                            "
                            onclick="onSetOrderStatus('${o.id}','${st}')">
                            ${st}
                          </button>

                        `).join('')
                      }

                    </td>

                  </tr>

                `
                : ''
              }

            `).join('')
          }

        </tbody>

      </table>

    </div>`;

  return adminLayout('admin-orders',inner);
}


function toggleOrderMenu(id){
  state.openOrderMenu =
    state.openOrderMenu === id ? null : id;

  render();
}


async function onSetOrderStatus(id,status){
  await setOrderStatus(id,status);
}


/* =========================================================
   ADMIN MODAL HELPERS
   ========================================================= */

function adminField(
  label,
  name,
  value,
  type='text',
  extra=''
){

  return `
    <label
      style="display:block;margin-bottom:14px;">

      <span
        class="mono muted"
        style="
          display:block;
          font-size:11px;
          text-transform:uppercase;
          margin-bottom:6px;
        ">
        ${label}
      </span>

      <input
        class="input"
        name="${name}"
        type="${type}"
        value="${esc(value == null ? '' : value)}"
        ${extra}
      >

    </label>
  `;
}


function adminModal(title,content){

  return `
    <div
      style="
        position:fixed;
        inset:0;
        background:rgba(33,31,38,.38);
        z-index:100;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:20px;
      "
      onclick="closeAdminModal(event)"
    >

      <div
        class="card"
        style="
          width:min(560px,100%);
          max-height:90vh;
          overflow:auto;
          padding:24px;
          box-shadow:0 20px 60px rgba(33,31,38,.2);
        "
        onclick="event.stopPropagation()"
      >

        <div
          style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            margin-bottom:20px;
          "
        >

          <h2
            class="display"
            style="font-size:24px;">
            ${title}
          </h2>

          <button
            class="btn btn-ghost btn-sm"
            onclick="closeAdminModal()">
            ×
          </button>

        </div>

        ${content}

      </div>

    </div>
  `;
}


function closeAdminModal(){
  state.adminModal = null;
  render();
}


/* =========================================================
   REFRESH PRODUCTS + CATEGORIES
   ========================================================= */

async function refreshCatalog(){

  const [productsData,categoriesData] =
    await Promise.all([
      apiGet('/api/products'),
      apiGet('/api/categories')
    ]);

  state.products = productsData.products;
  state.categories = categoriesData.categories;
}


/* =========================================================
   PRODUCT MANAGEMENT
   ========================================================= */

function productFormHTML(product=null){

  const p = product || {
    name:'',
    category:state.categories[0]?.name || '',
    price:'',
    stock:'',
    sku:'',
    image:''
  };

  return `

    <form
      onsubmit="submitProductForm(event,${product ? product.id : 'null'})">

      ${adminField(
        'Product name',
        'name',
        p.name,
        'text',
        'required'
      )}

      <label
        style="display:block;margin-bottom:14px;">

        <span
          class="mono muted"
          style="
            display:block;
            font-size:11px;
            text-transform:uppercase;
            margin-bottom:6px;
          ">
          Category
        </span>

        <select
          class="input"
          name="category"
          required
        >

          ${
            state.categories.map(c => `
              <option
                value="${esc(c.name)}"
                ${c.name === p.category ? 'selected' : ''}>
                ${esc(c.name)}
              </option>
            `).join('')
          }

        </select>

      </label>

      <div
        class="grid grid-2"
        style="gap:12px;">

        ${adminField(
          'Price',
          'price',
          p.price,
          'number',
          'step="0.01" min="0" required'
        )}

        ${adminField(
          'Stock',
          'stock',
          p.stock,
          'number',
          'min="0" step="1" required'
        )}

      </div>

      <div
        class="grid grid-2"
        style="gap:12px;">

        ${adminField(
          'SKU',
          'sku',
          p.sku,
          'text',
          'required'
        )}

        ${adminField(
          'Image URL',
          'image',
          p.image,
          'url',
          'required'
        )}

      </div>

      <div
        style="
          display:flex;
          justify-content:flex-end;
          gap:8px;
          margin-top:8px;
        ">

        <button
          type="button"
          class="btn btn-outline"
          onclick="closeAdminModal()">
          Cancel
        </button>

        <button
          class="btn btn-accent"
          type="submit">
          ${product ? 'Save changes' : 'Add product'}
        </button>

      </div>

    </form>
  `;
}


function openProductModal(id=null){

  state.adminModal = {
    type:'product',
    id:id ? Number(id) : null
  };

  render();
}


async function submitProductForm(e,id){

  e.preventDefault();

  const form = new FormData(e.target);

  const body = Object.fromEntries(form.entries());

  body.price = Number(body.price);
  body.stock = Number(body.stock);

  if(
    !body.name ||
    !body.category ||
    !body.sku ||
    !body.image
  ){
    state.adminNotice =
      'Please fill in all product fields.';

    render();
    return;
  }

  if(body.price < 0){
    state.adminNotice =
      'Price cannot be negative.';

    render();
    return;
  }

  if(body.stock < 0){
    state.adminNotice =
      'Stock cannot be negative.';

    render();
    return;
  }

  try{

    if(id){

      await apiPatch(
        `/api/admin/products/${id}`,
        body
      );

      state.adminNotice =
        'Product updated successfully.';

    }else{

      await apiPost(
        '/api/admin/products',
        body
      );

      state.adminNotice =
        'Product added successfully.';
    }

    await refreshCatalog();

    state.adminModal = null;

    render();

  }catch(err){

    state.adminNotice =
      err.message || 'Could not save product.';

    render();
  }
}


async function deleteProduct(id){

  const product = findProduct(id);

  if(!product) return;

  const confirmed = window.confirm(
    `Delete "${product.name}"?\n\nExisting order history will be preserved.`
  );

  if(!confirmed) return;

  try{

    await apiDelete(
      `/api/admin/products/${id}`
    );

    await refreshCatalog();

    state.adminNotice =
      'Product deleted successfully.';

    render();

  }catch(err){

    state.adminNotice =
      err.message || 'Could not delete product.';

    render();
  }
}


/* =========================================================
   MANAGE / INVENTORY PAGE
   ========================================================= */

function pageAdminManage(){

  const query =
    (state.adminProductSearch || '')
      .trim()
      .toLowerCase();

  const products =
    state.products.filter(product => {

      if(!query) return true;

      return [
        product.name,
        product.sku,
        product.category
      ].some(value =>
        String(value || '')
          .toLowerCase()
          .includes(query)
      );
    });

  const inner = `

    <div
      style="
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:16px;
        margin-bottom:20px;
        flex-wrap:wrap;
      "
    >

      <div>

        <div
          class="mono muted"
          style="
            font-size:11px;
            text-transform:uppercase;
          ">
          Inventory
        </div>

        <h1
          class="display"
          style="font-size:30px;">
          Manage
        </h1>

      </div>

      <button
        class="btn btn-accent"
        onclick="openProductModal()">

        ${icon('plus')}
        Add product

      </button>

    </div>


    ${
      state.adminNotice
      ? `

        <div
          class="field-error"
          style="
            color:var(--moss-700);
            background:var(--moss-50);
            margin-bottom:16px;
          ">

          ${esc(state.adminNotice)}

          <button
            class="btn btn-ghost btn-sm"
            style="
              float:right;
              padding:0 4px;
            "
            onclick="state.adminNotice='';render();">
            ×
          </button>

        </div>

      `
      : ''
    }


    <div
      class="card"
      style="overflow:hidden;">

      <div
        style="
          padding:14px;
          border-bottom:1px solid var(--line);
        ">

        <input
          class="input"
          placeholder="Search products by name, SKU or category"
          value="${esc(state.adminProductSearch || '')}"
          oninput="
            state.adminProductSearch=this.value;
            render();
          "
        >

      </div>


      <div style="overflow-x:auto;">

        <table data-testid="admin-products-table">

          <thead>

            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th style="text-align:right;">
                Actions
              </th>
            </tr>

          </thead>

          <tbody>

            ${
              products.length

              ? products.map(product => `

                <tr>

                  <td
                    style="
                      display:flex;
                      align-items:center;
                      gap:10px;
                    ">

                    <img
                      src="${esc(product.image)}"
                      alt=""
                      style="
                        width:36px;
                        height:36px;
                        border-radius:4px;
                        object-fit:cover;
                      "
                    >

                    <span
                      class="display"
                      style="font-size:14px;">
                      ${esc(product.name)}
                    </span>

                  </td>

                  <td
                    class="mono muted"
                    style="font-size:12px;">
                    ${esc(product.sku)}
                  </td>

                  <td>
                    ${esc(product.category)}
                  </td>

                  <td class="mono">
                    ${currency(product.price)}
                  </td>

                  <td class="mono">

                    ${
                      Number(product.stock) < 10

                      ? `<span style="color:var(--coral);">
                           ${product.stock} low
                         </span>`

                      : product.stock
                    }

                  </td>

                  <td
                    style="
                      text-align:right;
                      white-space:nowrap;
                    ">

                    <button
                      class="btn btn-ghost btn-sm"
                      onclick="openProductModal(${product.id})">
                      Edit
                    </button>

                    <button
                      class="btn btn-danger btn-sm"
                      onclick="deleteProduct(${product.id})">
                      Delete
                    </button>

                  </td>

                </tr>

              `).join('')

              : `

                <tr>

                  <td colspan="6">

                    ${emptyHTML(
                      'box',
                      'No products found',
                      'Try another search or add a new product.'
                    )}

                  </td>

                </tr>

              `
            }

          </tbody>

        </table>

      </div>

    </div>
  `;

  let page =
    adminLayout('admin-manage',inner);

  if(
    state.adminModal &&
    state.adminModal.type === 'product'
  ){

    const product =
      state.adminModal.id
      ? findProduct(state.adminModal.id)
      : null;

    page += adminModal(
      state.adminModal.id
        ? 'Edit product'
        : 'Add product',
      productFormHTML(product)
    );
  }

  return page;
}


/* =========================================================
   CATEGORY MANAGEMENT
   ========================================================= */

function categoryFormHTML(category=null){

  const c = category || {
    name:'',
    slug:'',
    image:''
  };

  return `

    <form
      onsubmit="
        submitCategoryForm(
          event,
          ${category ? category.id : 'null'}
        )
      "
    >

      ${adminField(
        'Category name',
        'name',
        c.name,
        'text',
        'required'
      )}

      ${adminField(
        'Slug',
        'slug',
        c.slug,
        'text',
        'required'
      )}

      ${adminField(
        'Image URL',
        'image',
        c.image,
        'url',
        'required'
      )}

      <div
        style="
          display:flex;
          justify-content:flex-end;
          gap:8px;
          margin-top:8px;
        ">

        <button
          type="button"
          class="btn btn-outline"
          onclick="closeAdminModal()">
          Cancel
        </button>

        <button
          class="btn btn-accent"
          type="submit">
          ${category ? 'Save changes' : 'Add category'}
        </button>

      </div>

    </form>
  `;
}


function openCategoryModal(id=null){

  state.adminModal = {
    type:'category',
    id:id ? Number(id) : null
  };

  render();
}


async function submitCategoryForm(e,id){

  e.preventDefault();

  const form =
    new FormData(e.target);

  const body =
    Object.fromEntries(form.entries());

  if(
    !body.name ||
    !body.slug ||
    !body.image
  ){

    state.adminNotice =
      'Please fill in all category fields.';

    render();
    return;
  }

  try{

    if(id){

      await apiPatch(
        `/api/admin/categories/${id}`,
        body
      );

      state.adminNotice =
        'Category updated successfully.';

    }else{

      await apiPost(
        '/api/admin/categories',
        body
      );

      state.adminNotice =
        'Category added successfully.';
    }

    await refreshCatalog();

    state.adminModal = null;

    render();

  }catch(err){

    state.adminNotice =
      err.message || 'Could not save category.';

    render();
  }
}


async function deleteCategory(id){

  const category =
    state.categories.find(
      item => item.id === Number(id)
    );

  if(!category) return;

  const confirmed =
    window.confirm(
      `Delete category "${category.name}"?`
    );

  if(!confirmed) return;

  try{

    await apiDelete(
      `/api/admin/categories/${id}`
    );

    await refreshCatalog();

    state.adminNotice =
      'Category deleted successfully.';

    render();

  }catch(err){

    state.adminNotice =
      err.message ||
      'Could not delete category.';

    render();
  }
}


function pageAdminCategories(){

  const inner = `

    <div
      style="
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:16px;
        margin-bottom:20px;
        flex-wrap:wrap;
      "
    >

      <div>

        <div
          class="mono muted"
          style="
            font-size:11px;
            text-transform:uppercase;
          ">
          Taxonomy
        </div>

        <h1
          class="display"
          style="font-size:30px;">
          Categories
        </h1>

      </div>

      <button
        class="btn btn-accent"
        onclick="openCategoryModal()">

        ${icon('plus')}
        Add category

      </button>

    </div>


    ${
      state.adminNotice
      ? `

        <div
          class="field-error"
          style="
            color:var(--moss-700);
            background:var(--moss-50);
            margin-bottom:16px;
          ">

          ${esc(state.adminNotice)}

          <button
            class="btn btn-ghost btn-sm"
            style="
              float:right;
              padding:0 4px;
            "
            onclick="
              state.adminNotice='';
              render();
            ">
            ×
          </button>

        </div>

      `
      : ''
    }


    <div class="grid grid-2">

      ${
        state.categories.length

        ? state.categories.map(category => `

          <div
            class="card"
            style="
              display:flex;
              overflow:hidden;
            "
            data-testid="admin-category-${esc(category.slug)}">

            <img
              src="${esc(category.image)}"
              alt=""
              style="
                width:80px;
                height:80px;
                object-fit:cover;
              "
            >

            <div
              style="
                padding:14px;
                flex:1;
                min-width:0;
              ">

              <div
                class="display"
                style="font-size:15px;">
                ${esc(category.name)}
              </div>

              <div
                class="mono muted"
                style="font-size:11px;">

                /${esc(category.slug)}
                ·
                ${Number(category.count || category.item_count || 0)}
                items

              </div>

              <div style="margin-top:10px;">

                <button
                  class="btn btn-ghost btn-sm"
                  onclick="
                    openCategoryModal(${category.id})
                  ">
                  Edit
                </button>

                <button
                  class="btn btn-danger btn-sm"
                  onclick="
                    deleteCategory(${category.id})
                  ">
                  Delete
                </button>

              </div>

            </div>

          </div>

        `).join('')

        : `

          <div class="card">
            ${emptyHTML(
              'tag',
              'No categories',
              'Add your first category to organize products.'
            )}
          </div>

        `
      }

    </div>
  `;

  let page =
    adminLayout(
      'admin-categories',
      inner
    );

  if(
    state.adminModal &&
    state.adminModal.type === 'category'
  ){

    const category =
      state.adminModal.id
      ? state.categories.find(
          c => c.id === state.adminModal.id
        )
      : null;

    page += adminModal(
      state.adminModal.id
        ? 'Edit category'
        : 'Add category',
      categoryFormHTML(category)
    );
  }

  return page;
}


/* =========================================================
   USERS
   ========================================================= */

function pageAdminUsers(){

  loadCache(
    'adminUsers',
    () => apiGet('/api/admin/users').then(d=>d.users),
    'admin-users'
  );

  const users =
    state.cache.adminUsers;

  if(users === undefined || users === null){
    return adminLayout(
      'admin-users',
      loadingBlock()
    );
  }

  if(users.__error){
    return adminLayout(
      'admin-users',
      errorBlock(users.__error)
    );
  }

  const inner = `

    <div style="margin-bottom:24px;">

      <div
        class="mono muted"
        style="
          font-size:11px;
          text-transform:uppercase;
        ">
        Directory
      </div>

      <h1
        class="display"
        style="font-size:30px;">
        Users
      </h1>

    </div>

    <div
      class="card"
      style="overflow:hidden;">

      <table data-testid="admin-users-table">

        <thead>

          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th></th>
          </tr>

        </thead>

        <tbody>

          ${
            users.map(user => `

              <tr>

                <td
                  class="display"
                  style="font-size:14px;">
                  ${esc(user.name)}
                </td>

                <td
                  class="mono muted"
                  style="font-size:12px;">
                  ${esc(user.email)}
                </td>

                <td>

                  <span
                    class="mono"
                    style="
                      font-size:11px;
                      text-transform:uppercase;
                      padding:2px 8px;
                      border-radius:4px;
                      background:${
                        user.role === 'admin'
                        ? 'var(--brand-50)'
                        : 'var(--panel)'
                      };
                      color:${
                        user.role === 'admin'
                        ? 'var(--brand)'
                        : 'var(--hazel)'
                      };
                    ">

                    ${esc(user.role)}

                  </span>

                </td>

                <td>

                  ${
                    user.disabled

                    ? `<span style="color:var(--coral);">
                         Disabled
                       </span>`

                    : `<span style="color:var(--moss-700);">
                         Active
                       </span>`
                  }

                </td>

                <td style="text-align:right;">

                  ${
                    user.role !== 'admin'

                    ? `
                      <button
                        class="btn btn-ghost btn-sm"
                        onclick="onToggleUser(${user.id})">

                        ${
                          user.disabled
                          ? 'Enable'
                          : 'Disable'
                        }

                      </button>
                    `

                    : ''
                  }

                </td>

              </tr>

            `).join('')
          }

        </tbody>

      </table>

    </div>
  `;

  return adminLayout(
    'admin-users',
    inner
  );
}


async function onToggleUser(id){

  try{
    await toggleUserDisabled(id);
  }catch(err){
    state.adminNotice =
      err.message || 'Could not update user.';
    render();
  }
}


/* =========================================================
   ROUTER
   ========================================================= */

const PAGES = {

  home: pageHome,
  products: pageProducts,
  product: pageProductDetail,
  cart: pageCart,
  checkout: pageCheckout,
  orders: pageOrders,
  order: pageOrderDetail,

  admin: pageAdminDashboard,
  'admin-orders': pageAdminOrders,

  'admin-manage': pageAdminManage,
  'admin-products': pageAdminManage,

  'admin-categories': pageAdminCategories,
  'admin-users': pageAdminUsers,

  login: pageLogin,
  register: pageRegister,
  unauthorized: pageUnauthorized
};


function render(){

  const page =
    (PAGES[state.route] || pageHome)();

  const isAdmin =
    state.route.startsWith('admin');

  document.getElementById('app').innerHTML = `

    ${navHTML()}

    <main>
      ${page}
    </main>

    ${isAdmin ? '' : footerHTML()}

  `;
}


/* ---------- Bootstrap ---------- */

async function boot(){

  try{

    const [
      productsData,
      categoriesData
    ] = await Promise.all([

      apiGet('/api/products'),

      apiGet('/api/categories')

    ]);

    state.products =
      productsData.products;

    state.categories =
      categoriesData.categories;

  }catch(err){

    state.bootError =
      err.message ||
      'Could not load the app. Is the backend server running?';

    document.getElementById('app').innerHTML = `

      <div
        class="container"
        style="padding:80px 24px;">

        ${emptyHTML(
          'alert',
          'Could not connect to the server',
          esc(state.bootError)
        )}

      </div>
    `;

    return;
  }


  const token =
    safeGet('orderflow_token');

  if(token){

    try{

      const me =
        await apiGet('/api/auth/me');

      state.currentUser =
        me.user;

    }catch(err){

      safeRemove('orderflow_token');

    }
  }


  render();
}


boot();

/* ---------- Bootstrap ---------- */
async function boot(){
  try{
    const [productsData, categoriesData] = await Promise.all([
      apiGet('/api/products'),
      apiGet('/api/categories'),
    ]);
    state.products = productsData.products;
    state.categories = categoriesData.categories;
  }catch(err){
    state.bootError = err.message || 'Could not load the app. Is the backend server running?';
    document.getElementById('app').innerHTML = `<div class="container" style="padding:80px 24px;">${emptyHTML('alert','Could not connect to the server', esc(state.bootError))}</div>`;
    return;
  }

  const token = safeGet('orderflow_token');
  if(token){
    try{
      const me = await apiGet('/api/auth/me');
      state.currentUser = me.user;
    }catch(err){
      safeRemove('orderflow_token'); // expired/invalid token
    }
  }

  render();
}

boot();
