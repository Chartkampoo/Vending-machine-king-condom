const http = require('http');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'vending_machine',
  waitForConnections: true,
  connectionLimit: 5,
  decimalNumbers: true
};

const CATALOG_CACHE_MS = 30 * 1000;
let catalogCache = { data: null, fetchedAt: 0 };

function mapProductRow(row) {
  return {
    id: row.slot_code,
    slot: row.slot_code,
    nameTh: row.name_th,
    nameEn: row.name_en,
    brand: row.brand,
    size: row.size_label,
    type: row.product_type,
    category: row.category,
    color: row.color,
    boxColor: row.box_color,
    accentColor: row.accent_color,
    img: row.image_url,
    price: Number(row.price_thb),
    stock: row.stock_qty,
    maxStock: row.max_stock_qty,
    descTh: row.description_th,
    descEn: row.description_en,
    badgeTh: row.badge_th,
    badgeEn: row.badge_en
  };
}

let _pool = null;
function getPool() {
  if (!_pool) _pool = mysql.createPool(DB_CONFIG);
  return _pool;
}

async function fetchCatalogFromDb() {
  const [rows] = await getPool().query(
    `SELECT slot_code, name_th, name_en, brand, category, size_label, product_type,
            description_th, description_en, badge_th, badge_en,
            color, box_color, accent_color, image_url,
            price_thb, stock_qty, max_stock_qty
       FROM products
      WHERE is_active = 1
      ORDER BY slot_code`
  );
  catalogCache = { data: rows.map(mapProductRow), fetchedAt: Date.now() };
  return catalogCache.data;
}

async function getCatalog() {
  const fresh = catalogCache.data && (Date.now() - catalogCache.fetchedAt) < CATALOG_CACHE_MS;
  if (fresh) return catalogCache.data;
  try {
    return await fetchCatalogFromDb();
  } catch (err) {
    console.error('[db] catalog fetch failed:', err.code || err.message);
    return catalogCache.data;
  }
}

const PORT = process.env.PORT || 8080;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '  .svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function generateTxnCode(conn) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `TXN${stamp}`;
  const [[row]] = await conn.query(
    'SELECT txn_code FROM transactions WHERE txn_code LIKE ? ORDER BY txn_code DESC LIMIT 1',
    [prefix + '%']
  );
  const n = row ? parseInt(row.txn_code.slice(prefix.length), 10) + 1 : 1;
  if (n > 999) throw new Error('txn counter overflow for today');
  return `${prefix}${String(n).padStart(3, '0')}`;
}

const PRODUCT_CATEGORIES = ['condom_49', 'condom_52', 'condom_54', 'condom_56', 'lubricant'];
const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];
const TXN_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'cancelled'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const isDbDown = err => ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(err.code);

function crudError(err) {
  const status = isDbDown(err) ? 503 : (err.code === 'ER_DUP_ENTRY' ? 409 : 400);
  let msg = err.message;
  if (err.code === 'ER_DUP_ENTRY') msg = 'Duplicate value: slot code, member code, phone or email already exists.';
  else if (err.code === 'ER_ROW_IS_REFERENCED_2') msg = 'Row is still referenced by other records and cannot be deleted.';
  else if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') msg = 'Value violates a table CHECK constraint.';
  return { status, msg };
}

function productPayload(body, creating) {
  const out = {};
  const fail = msg => { throw new Error(msg); };
  const setStr = (k, max, required) => {
    if (!(k in body)) { if (required && creating) fail(`'${k}' is required`); return; }
    const v = String(body[k] ?? '').trim();
    if (!v) { if (required) fail(`'${k}' is required`); out[k] = null; return; }
    if (v.length > max) fail(`'${k}' is too long (max ${max} chars)`);
    out[k] = v;
  };
  const setEnum = (k, values, required) => {
    if (!(k in body)) { if (required && creating) fail(`'${k}' is required`); return; }
    const v = String(body[k] ?? '').trim();
    if (!v) { if (required) fail(`'${k}' is required`); out[k] = null; return; }
    if (!values.includes(v)) fail(`'${k}' must be one of: ${values.join(', ')}`);
    out[k] = v;
  };
  const setNum = (k, { int = false, required = false, min = 0 } = {}) => {
    if (!(k in body)) { if (required && creating) fail(`'${k}' is required`); return; }
    const v = Number(body[k]);
    if (body[k] === null || body[k] === '' || !Number.isFinite(v)) fail(`'${k}' must be a number`);
    if (int && !Number.isInteger(v)) fail(`'${k}' must be a whole number`);
    if (v < min) fail(`'${k}' must be at least ${min}`);
    out[k] = v;
  };
  const setColor = (k, def) => {
    if (!(k in body)) { if (creating) out[k] = def; return; }
    const v = String(body[k] ?? '').trim();
    if (!v) { out[k] = def; return; }
    if (!HEX_COLOR.test(v)) fail(`'${k}' must be a hex color like #475d73`);
    out[k] = v;
  };
  const setFlag = (k, def) => {
    if (!(k in body)) { if (creating) out[k] = def; return; }
    out[k] = (body[k] === true || body[k] === 1 || body[k] === '1' || body[k] === 'true') ? 1 : 0;
  };

  setStr('slot_code', 2, true);
  if (out.slot_code) {
    out.slot_code = out.slot_code.toUpperCase();
    if (!/^[A-D][1-4]$/.test(out.slot_code)) fail('slot_code must be one of A1..D4');
  }
  setStr('name_th', 120, true);
  setStr('name_en', 120, true);
  setStr('brand', 60, true);
  setEnum('category', PRODUCT_CATEGORIES, true);
  setStr('size_label', 20, true);
  setStr('product_type', 80, true);
  setStr('description_th', 2000, false);
  setStr('description_en', 2000, false);
  setStr('badge_th', 40, false);
  setStr('badge_en', 40, false);
  setStr('image_url', 500, false);
  setColor('color', '#475d73');
  setColor('box_color', '#2b3a4a');
  setColor('accent_color', '#475d73');
  setNum('price_thb', { required: true });
  setNum('stock_qty', { int: true });
  setNum('max_stock_qty', { int: true });
  setFlag('is_active', 1);
  if (creating) {
    if (out.stock_qty === undefined) out.stock_qty = 0;
    if (out.max_stock_qty === undefined) out.max_stock_qty = 8;
  }
  return out;
}

function customerPayload(body, creating) {
  const out = {};
  const setStr = (k, max) => {
    if (!(k in body)) return;
    const v = String(body[k] ?? '').trim();
    if (v.length > max) throw new Error(`'${k}' is too long (max ${max} chars)`);
    out[k] = v || null;
  };
  setStr('member_code', 20);
  setStr('phone', 20);
  setStr('email', 255);
  setStr('full_name', 120);
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error('email address looks invalid');
  if ('birth_date' in body) {
    const v = String(body.birth_date ?? '').trim();
    if (v) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('birth_date must be YYYY-MM-DD');
      out.birth_date = v;
    } else {
      out.birth_date = null;
    }
  }
  if ('gender' in body) {
    const v = String(body.gender ?? '').trim();
    if (v && !GENDERS.includes(v)) throw new Error('gender must be one of: ' + GENDERS.join(', '));
    out.gender = v || null;
  }
  if ('marketing_opt_in' in body) {
    out.marketing_opt_in = (body.marketing_opt_in === true || body.marketing_opt_in === 1 || body.marketing_opt_in === '1') ? 1 : 0;
  }
  if (creating) {
    if (out.marketing_opt_in === undefined) out.marketing_opt_in = 0;
    if (!out.member_code && !out.phone && !out.email && !out.full_name) {
      throw new Error('customer needs a full name, phone, email or member code');
    }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);

  if (reqPath === '/api/products') {
    const products = await getCatalog();
    if (products) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, source: 'db', products }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'database unavailable' }));
    }
    return;
  }

  if (reqPath === '/api/restock' && req.method === 'POST') {
    try {
      const { slot } = await readJsonBody(req);
      if (!slot || !/^[A-D][1-4]$/.test(slot)) throw new Error('invalid slot');
      const pool = getPool();
      const [[prod]] = await pool.query(
        'SELECT id, stock_qty, max_stock_qty FROM products WHERE slot_code = ?', [slot]
      );
      if (prod && prod.stock_qty < prod.max_stock_qty) {
        await pool.query(
          `UPDATE products
              SET stock_qty = max_stock_qty, restocked_at = NOW()
            WHERE slot_code = ?`,
          [slot]
        );
        await pool.query(
          `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_after, note)
           VALUES (?, 'restock', ?, ?, 'Kiosk restock via admin panel')`,
          [prod.id, prod.max_stock_qty - prod.stock_qty, prod.max_stock_qty]
        );
      }
      catalogCache.fetchedAt = 0;
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return;
  }

  if (reqPath === '/api/transactions' && req.method === 'POST') {
    let conn;
    try {
      const body = await readJsonBody(req);
      const { slot, paymentMethod } = body;
      const PM = { cash: 'cash', qr: 'promptpay_qr', card: 'credit_card' };
      const dbMethod = PM[paymentMethod];

      if (!slot || !/^[A-D][1-4]$/.test(slot)) throw new Error('invalid slot');
      if (!dbMethod) throw new Error('invalid paymentMethod');

      conn = await getPool().getConnection();
      await conn.beginTransaction();

      const [[prod]] = await conn.query(
        'SELECT id, slot_code, price_thb, stock_qty FROM products WHERE slot_code = ? FOR UPDATE',
        [slot]
      );
      if (!prod) throw new Error('slot not found');
      if (prod.stock_qty <= 0) throw new Error('out of stock');

      const cashInserted = paymentMethod === 'cash' ? Number(body.cashInserted) || 0 : null;
      const changeDue = paymentMethod === 'cash' ? Number(body.changeDue) || 0 : null;
      const txnCode = await generateTxnCode(conn);

      const [result] = await conn.query(
        `INSERT INTO transactions
           (txn_code, machine_id, product_id, quantity, unit_price_thb, total_amount_thb,
            payment_method, payment_status, cash_inserted_thb, change_due_thb,
            dispensed, collected, slot_code, created_at, paid_at, dispensed_at)
         VALUES (?, 'KING-01', ?, 1, ?, ?, ?, 'paid', ?, ?, 1, 0, ?, NOW(), NOW(), NOW())`,
        [txnCode, prod.id, prod.price_thb, prod.price_thb,
         dbMethod, cashInserted, changeDue, prod.slot_code]
      );

      await conn.query(
        `INSERT INTO payment_events (transaction_id, event_type, amount_thb, reference)
         VALUES (?, 'payment_confirmed', ?, ?)`,
        [result.insertId, prod.price_thb, dbMethod === 'cash' ? 'CASH-ACCEPTOR' : dbMethod === 'promptpay_qr' ? 'PROMPTPAY-SIM' : 'CARD-READER-SIM']
      );

      await conn.query(
        'UPDATE products SET stock_qty = stock_qty - 1 WHERE id = ? AND stock_qty > 0',
        [prod.id]
      );
      const [[after]] = await conn.query(
        'SELECT stock_qty FROM products WHERE id = ?', [prod.id]
      );
      await conn.query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_after, transaction_id, note)
         VALUES (?, 'sale', -1, ?, ?, ?)`,
        [prod.id, after.stock_qty, result.insertId, `Sale ${txnCode}`]
      );

      await conn.commit();
      catalogCache.fetchedAt = 0;
      sendJson(res, 201, {
        ok: true,
        txnCode,
        price: Number(prod.price_thb),
        remainingStock: after.stock_qty
      });
    } catch (err) {
      if (conn) {
        try { await conn.rollback(); } catch (_) {  }
      }
      const isDbDown = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(err.code);
      sendJson(res, isDbDown ? 503 : 400, { ok: false, error: err.message });
    } finally {
      if (conn) conn.release();
    }
    return;
  }

  if (reqPath === '/api/transactions/collect' && req.method === 'POST') {
    try {
      const { txnCode } = await readJsonBody(req);
      if (!txnCode || !/^TXN\d{11}$/.test(txnCode)) throw new Error('invalid txnCode');
      const [result] = await getPool().query(
        `UPDATE transactions
            SET collected = 1
          WHERE txn_code = ? AND payment_status = 'paid' AND dispensed = 1 AND collected = 0`,
        [txnCode]
      );
      if (result.affectedRows === 0) throw new Error('no collectable transaction with that code');
      sendJson(res, 200, { ok: true, txnCode });
    } catch (err) {
      const isDbDown = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(err.code);
      sendJson(res, isDbDown ? 503 : 400, { ok: false, error: err.message });
    }
    return;
  }

  if (reqPath === '/api/db/summary' && req.method === 'GET') {
    try {
      const pool = getPool();
      const [counts] = await pool.query(
        `SELECT 'products' AS tbl, COUNT(*) AS n FROM products
         UNION ALL SELECT 'customers', COUNT(*) FROM customers
         UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
         UNION ALL SELECT 'payment_events', COUNT(*) FROM payment_events
         UNION ALL SELECT 'stock_movements', COUNT(*) FROM stock_movements`
      );
      const [[rev]] = await pool.query(
        `SELECT COALESCE(SUM(total_amount_thb),0) AS revenue, COUNT(*) AS paid_txns
           FROM transactions WHERE payment_status = 'paid'`
      );
      const [[stock]] = await pool.query(
        `SELECT COALESCE(SUM(stock_qty),0) AS units_left, COALESCE(SUM(stock_qty = 0),0) AS empty_slots
           FROM products WHERE is_active = 1`
      );
      sendJson(res, 200, { ok: true, counts, revenue: rev, stock });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (reqPath === '/api/db/transactions' && req.method === 'GET') {
    try {
      const limit = Math.min(parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '25', 10) || 25, 100);
      const [rows] = await getPool().query(
        `SELECT t.id, t.txn_code, t.slot_code, p.name_en AS product, t.payment_method,
                t.payment_status, t.total_amount_thb, t.cash_inserted_thb, t.change_due_thb,
                t.dispensed, t.collected, t.created_at,
                c.full_name AS customer,
                (SELECT COUNT(*) FROM payment_events e WHERE e.transaction_id = t.id) AS event_count
           FROM transactions t
           JOIN products p ON p.id = t.product_id
           LEFT JOIN customers c ON c.id = t.customer_id
          ORDER BY t.created_at DESC, t.id DESC
          LIMIT ?`, [limit]
      );
      sendJson(res, 200, { ok: true, transactions: rows });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (reqPath === '/api/db/payment-events' && req.method === 'GET') {
    try {
      const txn = new URL(req.url, 'http://x').searchParams.get('txn');
      if (!txn) throw new Error('missing ?txn=TXNCODE');
      const [rows] = await getPool().query(
        `SELECT e.event_type, e.amount_thb, COALESCE(e.reference, '') AS reference,
                e.created_at, t.txn_code, t.payment_status
           FROM payment_events e
           JOIN transactions t ON t.id = e.transaction_id
          WHERE t.txn_code = ?
          ORDER BY e.created_at, e.id`, [txn]
      );
      sendJson(res, 200, { ok: true, events: rows });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return;
  }

  const mProd = /^\/api\/db\/products\/(\d+)$/.exec(reqPath);
  const mCust = /^\/api\/db\/customers\/(\d+)$/.exec(reqPath);
  const mTxn  = /^\/api\/db\/transactions\/(\d+)$/.exec(reqPath);

  if (reqPath === '/api/db/products' && req.method === 'GET') {
    try {
      const [rows] = await getPool().query('SELECT * FROM products ORDER BY slot_code');
      sendJson(res, 200, { ok: true, products: rows });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (reqPath === '/api/db/products' && req.method === 'POST') {
    let conn;
    try {
      const fields = productPayload(await readJsonBody(req), true);
      if (fields.stock_qty > fields.max_stock_qty) throw new Error('stock_qty cannot exceed max_stock_qty');
      conn = await getPool().getConnection();
      await conn.beginTransaction();
      const [r] = await conn.query('INSERT INTO products SET ?', [fields]);
      if (fields.stock_qty > 0) {
        await conn.query(
          `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_after, note)
           VALUES (?, 'restock', ?, ?, 'Initial stock via DB viewer')`,
          [r.insertId, fields.stock_qty, fields.stock_qty]);
      }
      await conn.commit();
      catalogCache.fetchedAt = 0;
      sendJson(res, 201, { ok: true, id: r.insertId });
    } catch (err) {
      if (conn) { try { await conn.rollback(); } catch (_) {  } }
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    } finally {
      if (conn) conn.release();
    }
    return;
  }

  if (mProd && (req.method === 'PUT' || req.method === 'PATCH')) {
    try {
      const id = Number(mProd[1]);
      const pool = getPool();
      const [[cur]] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
      if (!cur) throw new Error('product not found');
      const fields = productPayload(await readJsonBody(req), false);
      if (!Object.keys(fields).length) throw new Error('no fields to update');
      const effMax = 'max_stock_qty' in fields ? fields.max_stock_qty : cur.max_stock_qty;
      const effStock = 'stock_qty' in fields ? fields.stock_qty : cur.stock_qty;
      if (effStock > effMax) throw new Error(`stock_qty (${effStock}) cannot exceed max_stock_qty (${effMax})`);
      await pool.query('UPDATE products SET ? WHERE id = ?', [fields, id]);
      if ('stock_qty' in fields && fields.stock_qty !== cur.stock_qty) {
        await pool.query(
          `INSERT INTO stock_movements (product_id, movement_type, quantity_delta, stock_after, note)
           VALUES (?, 'manual_adjust', ?, ?, 'Manual stock edit via DB viewer')`,
          [id, fields.stock_qty - cur.stock_qty, fields.stock_qty]);
      }
      catalogCache.fetchedAt = 0;
      sendJson(res, 200, { ok: true, id });
    } catch (err) {
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    }
    return;
  }

  if (mProd && req.method === 'DELETE') {
    try {
      const id = Number(mProd[1]);
      const hard = new URL(req.url, 'http://x').searchParams.get('hard') === '1';
      if (hard) {
        const [r] = await getPool().query('DELETE FROM products WHERE id = ?', [id]);
        if (r.affectedRows === 0) throw new Error('product not found');
      } else {
        const [r] = await getPool().query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
        if (r.affectedRows === 0) throw new Error('product not found');
      }
      catalogCache.fetchedAt = 0;
      sendJson(res, 200, { ok: true, mode: hard ? 'hard' : 'soft' });
    } catch (err) {
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    }
    return;
  }

  if (reqPath === '/api/db/customers' && req.method === 'GET') {
    try {
      const [rows] = await getPool().query(
        `SELECT c.id, c.member_code, c.full_name, c.phone, c.email, c.gender,
                DATE_FORMAT(c.birth_date, '%Y-%m-%d') AS birth_date,
                c.marketing_opt_in, c.created_at,
                (SELECT COUNT(*) FROM transactions t
                  WHERE t.customer_id = c.id AND t.payment_status = 'paid') AS paid_txns,
                (SELECT COALESCE(SUM(t.total_amount_thb), 0) FROM transactions t
                  WHERE t.customer_id = c.id AND t.payment_status = 'paid') AS paid_total
           FROM customers c
          ORDER BY c.id`);
      sendJson(res, 200, { ok: true, customers: rows });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (reqPath === '/api/db/customers' && req.method === 'POST') {
    try {
      const fields = customerPayload(await readJsonBody(req), true);
      const [r] = await getPool().query('INSERT INTO customers SET ?', [fields]);
      sendJson(res, 201, { ok: true, id: r.insertId });
    } catch (err) {
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    }
    return;
  }

  if (mCust && (req.method === 'PUT' || req.method === 'PATCH')) {
    try {
      const id = Number(mCust[1]);
      const fields = customerPayload(await readJsonBody(req), false);
      if (!Object.keys(fields).length) throw new Error('no fields to update');
      const [r] = await getPool().query('UPDATE customers SET ? WHERE id = ?', [fields, id]);
      if (r.affectedRows === 0) throw new Error('customer not found');
      sendJson(res, 200, { ok: true, id });
    } catch (err) {
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    }
    return;
  }

  if (mCust && req.method === 'DELETE') {
    try {
      const [r] = await getPool().query('DELETE FROM customers WHERE id = ?', [Number(mCust[1])]);
      if (r.affectedRows === 0) throw new Error('customer not found');
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    }
    return;
  }

  if (mTxn && (req.method === 'PUT' || req.method === 'PATCH')) {
    try {
      const id = Number(mTxn[1]);
      const pool = getPool();
      const [[cur]] = await pool.query('SELECT * FROM transactions WHERE id = ?', [id]);
      if (!cur) throw new Error('transaction not found');
      const body = await readJsonBody(req);
      const fields = {};
      if ('payment_status' in body) {
        if (!TXN_STATUSES.includes(body.payment_status)) {
          throw new Error('payment_status must be one of: ' + TXN_STATUSES.join(', '));
        }
        fields.payment_status = body.payment_status;
        if (body.payment_status === 'paid' && !cur.paid_at) fields.paid_at = new Date();
        if (body.payment_status === 'cancelled') fields.cancelled_at = new Date();
      }
      if ('dispensed' in body) fields.dispensed = body.dispensed ? 1 : 0;
      if ('collected' in body) fields.collected = body.collected ? 1 : 0;
      if (!Object.keys(fields).length) throw new Error('nothing to update');
      await pool.query('UPDATE transactions SET ? WHERE id = ?', [fields, id]);
      if (fields.payment_status === 'refunded' && cur.payment_status !== 'refunded') {
        await pool.query(
          `INSERT INTO payment_events (transaction_id, event_type, amount_thb, reference)
           VALUES (?, 'refund', ?, 'MANUAL-REFUND')`,
          [id, cur.total_amount_thb]);
      }
      sendJson(res, 200, { ok: true, id });
    } catch (err) {
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    }
    return;
  }

  if (mTxn && req.method === 'DELETE') {
    try {
      const [r] = await getPool().query('DELETE FROM transactions WHERE id = ?', [Number(mTxn[1])]);
      if (r.affectedRows === 0) throw new Error('transaction not found');
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const e = crudError(err);
      sendJson(res, e.status, { ok: false, error: e.msg });
    }
    return;
  }

  let filePath = path.join(__dirname, reqPath === '/' ? 'index.html' : reqPath);

  const rel = path.relative(__dirname, path.resolve(filePath));
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Server Error');
      }
    } else {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
