async function loadCatalogFromApi() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.ok || !Array.isArray(body.products)) throw new Error('bad payload');
    PRODUCTS.length = 0;
    PRODUCTS.push(...body.products);
    console.log(`[catalog] loaded ${PRODUCTS.length} products from database`);
    return true;
  } catch (err) {
    console.warn(`[catalog] DB load failed (${err.message}), using built-in catalog`);
    return false;
  }
}

let currentLang = 'th';
let currentCategory = 'all';
let currentPage = 1;
const PRODUCTS_PER_PAGE = 4;
let currentProduct = null;
let currentPaymentMethod = null;
let insertedMoney = 0;
let coinReturnBalance = 0;
let dispensedItemWaiting = null;
let lastReceipt = null;

const shelvesContainer = document.getElementById('shelves-container');
const kioskGrid = document.getElementById('kiosk-product-grid');
const kioskInteractiveView = document.getElementById('kiosk-interactive-view');
const categoryTabsBar = document.getElementById('category-tabs-bar');
const screenPromptText = document.getElementById('screen-prompt-text');
const liveClockEl = document.getElementById('live-clock');
const deliveryFlap = document.getElementById('delivery-flap');
const coinReturnCup = document.getElementById('coin-return-cup');
const coinReturnCount = document.getElementById('coin-return-count');

const pickupModal = document.getElementById('pickup-modal');
const adminModal = document.getElementById('admin-modal');
const btnClosePickup = document.getElementById('btn-close-pickup');
const btnPickupConfirm = document.getElementById('btn-pickup-confirm');
const btnCloseAdmin = document.getElementById('btn-close-admin');
const btnAdminCloseBottom = document.getElementById('btn-admin-close');
const btnOpenAdmin = document.getElementById('btn-open-admin');
const btnRestockAll = document.getElementById('btn-restock-all');
const adminTableBody = document.getElementById('admin-table-body');
const btnToggleLang = document.getElementById('btn-toggle-lang');
const btnHardwareRefund = document.getElementById('btn-hardware-refund');
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const themeToggleIcon = document.getElementById('theme-toggle-icon');
const themeToggleLabel = document.getElementById('theme-toggle-label');

function getStoredTheme() {
  const saved = localStorage.getItem('kc-theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('kc-theme', theme);
  updateThemeToggleUI();
}

function updateThemeToggleUI() {
  if (!themeToggleIcon || !themeToggleLabel) return;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  const t = TRANSLATIONS[currentLang];
  themeToggleIcon.textContent = dark ? '☀️' : '🌙';
  themeToggleLabel.textContent = dark ? t.themeLightMode : t.themeDarkMode;
}

btnToggleTheme.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyTheme(dark ? 'light' : 'dark');
});

document.addEventListener('DOMContentLoaded', async () => {
  startClock();
  applyTheme(getStoredTheme());
  setupEventListeners();
  updateLanguageUI();

  renderShelves();
  renderKioskCatalog();
  const loadedFromDb = await loadCatalogFromApi();
  if (loadedFromDb) {
    currentPage = 1;
    renderShelves();
    renderKioskCatalog();
  }
});

function startClock() {
  const update = () => {
    const now = new Date();
    liveClockEl.textContent = now.toTimeString().split(' ')[0];
  };
  update();
  setInterval(update, 1000);
}

function renderShelves() {
  shelvesContainer.innerHTML = '';
  const rows = ['A', 'B', 'C', 'D'];

  rows.forEach(rowLetter => {
    const rowDiv = document.createElement('div');
    rowDiv.className = 'shelf-row';

    const slotsDiv = document.createElement('div');
    slotsDiv.className = 'shelf-slots';

    for (let i = 1; i <= 4; i++) {
      const slotCode = `${rowLetter}${i}`;
      const product = PRODUCTS.find(p => p.slot === slotCode);

      const slotEl = document.createElement('div');
      slotEl.className = 'shelf-slot';
      slotEl.id = `shelf-slot-${slotCode}`;

      const coilSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      coilSvg.setAttribute('viewBox', '0 0 70 80');
      coilSvg.setAttribute('class', 'spiral-coil');
      coilSvg.id = `coil-${slotCode}`;
      coilSvg.innerHTML = `      <path class="coil-a" d="M 10 70 C 5 55, 65 55, 60 40 C 55 25, 15 25, 10 10"
              fill="none" stroke="#d4d4d4" stroke-width="4.5" stroke-linecap="round"/>
        <path class="coil-b" d="M 60 70 C 65 55, 5 55, 10 40 C 15 25, 55 25, 60 10"
              fill="none" stroke="#e5e5e5" stroke-width="3" stroke-linecap="round"/>
      `;

      if (product) {
        const boxEl = document.createElement('div');
        boxEl.className = `showcase-product-box ${product.stock <= 0 ? 'out-of-stock' : ''} ${product.img ? 'has-img' : ''}`;
        boxEl.id = `showcase-box-${slotCode}`;
        boxEl.style.background = product.boxColor;

        boxEl.innerHTML = product.img
          ? `<img class="box-img" src="${product.img}" alt="${product.brand}" loading="lazy" draggable="false">
             <div class="size-tag">${product.size}</div>`
          : `<div class="brand-tag">${product.brand}</div>
             <div class="size-tag">${product.size}</div>
             <div class="type-tag">${currentLang === 'th' ? product.badgeTh : product.badgeEn}</div>`;

        slotEl.appendChild(coilSvg);
        slotEl.appendChild(boxEl);
      } else {
        slotEl.appendChild(coilSvg);
      }

      slotsDiv.appendChild(slotEl);
    }

    const beamDiv = document.createElement('div');
    beamDiv.className = 'shelf-beam';
    for (let i = 1; i <= 4; i++) {
      const slotCode = `${rowLetter}${i}`;
      const label = document.createElement('div');
      label.className = 'slot-code-label';
      label.textContent = slotCode;
      beamDiv.appendChild(label);
    }

    rowDiv.appendChild(slotsDiv);
    rowDiv.appendChild(beamDiv);
    shelvesContainer.appendChild(rowDiv);
  });
}

function renderKioskCatalog() {
  kioskGrid.innerHTML = '';
  kioskInteractiveView.style.display = 'none';
  kioskGrid.style.display = 'grid';
  categoryTabsBar.style.display = 'flex';

  screenPromptText.textContent = TRANSLATIONS[currentLang].statusStandby;

  const filtered = PRODUCTS.filter(p => {
    if (currentCategory === 'all') return true;
    if (currentCategory === '49') return p.size.includes('49');
    if (currentCategory === '52') return p.size.includes('52');
    if (currentCategory === '54') return p.size.includes('54');
    if (currentCategory === '56') return p.size.includes('56');
    if (currentCategory === 'gel') return p.slot.startsWith('D');
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PRODUCTS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const pageItems = filtered.slice((currentPage - 1) * PRODUCTS_PER_PAGE, currentPage * PRODUCTS_PER_PAGE);

  pageItems.forEach(product => {
    const card = document.createElement('div');
    card.className = `kiosk-product-card ${product.stock <= 0 ? 'sold-out' : ''}`;

    const isSoldOut = product.stock <= 0;
    const name = currentLang === 'th' ? product.nameTh : product.nameEn;
    const badge = currentLang === 'th' ? product.badgeTh : product.badgeEn;
    const stockText = isSoldOut
      ? TRANSLATIONS[currentLang].outOfStock
      : `${TRANSLATIONS[currentLang].stockLabel}: ${product.stock}`;

    card.innerHTML = `
      <div class="kiosk-card-header">
        <span class="card-slot-badge">${product.slot}</span>
        <span class="card-size-badge">${product.size}</span>
      </div>
      <div class="kiosk-card-body">
        <div class="card-mini-box ${product.img ? 'has-img' : ''}" style="background: ${product.boxColor};">
          ${product.img
        ? `<img class="card-mini-img" src="${product.img}" alt="${product.brand}" loading="lazy" draggable="false">`
        : `<span>${product.brand}</span>`}
        </div>
        <div class="card-info">
          <div class="card-title" title="${name}">${name}</div>
          <div class="card-type">${badge}</div>
          <div class="card-stock ${product.stock <= 2 && !isSoldOut ? 'low' : ''}">${stockText}</div>
        </div>
      </div>
      <div class="kiosk-card-footer">
        <span class="card-price">${product.price} ${TRANSLATIONS[currentLang].baht}</span>
        <button class="card-select-btn" ${isSoldOut ? 'disabled' : ''}>
          ${isSoldOut ? TRANSLATIONS[currentLang].outOfStock : TRANSLATIONS[currentLang].buyNow}
        </button>
      </div>
    `;

    if (!isSoldOut) {
      card.addEventListener('click', () => {
        openProductDetail(product);
      });
    }

    kioskGrid.appendChild(card);
  });

  updateKioskPager(totalPages);
}

function updateKioskPager(totalPages) {
  const pager = document.getElementById('kiosk-pager');
  if (!pager) return;
  if (totalPages <= 1) {
    pager.style.display = 'none';
    pager.innerHTML = '';
    return;
  }
  pager.style.display = 'flex';
  pager.innerHTML = `
    <button class="pager-btn" onclick="kioskChangePage(-1)" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>
    <span class="pager-indicator">${currentPage} / ${totalPages}</span>
    <button class="pager-btn" onclick="kioskChangePage(1)" ${currentPage >= totalPages ? 'disabled' : ''}>›</button>
  `;
}

window.kioskChangePage = function (dir) {
  currentPage += dir;
  renderKioskCatalog();
};

function openProductDetail(product) {
  currentProduct = product;
  currentPaymentMethod = null;
  insertedMoney = 0;

  kioskGrid.style.display = 'none';
  categoryTabsBar.style.display = 'none';
  const pagerEl = document.getElementById('kiosk-pager');
  if (pagerEl) pagerEl.style.display = 'none';
  kioskInteractiveView.style.display = 'block';

  screenPromptText.textContent = TRANSLATIONS[currentLang].statusPaymentPrompt;
  renderPaymentView();
}

function renderPaymentView() {
  const p = currentProduct;
  const name = currentLang === 'th' ? p.nameTh : p.nameEn;
  const desc = currentLang === 'th' ? p.descTh : p.descEn;
  const badge = currentLang === 'th' ? p.badgeTh : p.badgeEn;
  const t = TRANSLATIONS[currentLang];

  kioskInteractiveView.innerHTML = `
    <div class="kiosk-subview">
      <!-- Product Summary Card -->
      <div class="detail-view-card">
        <div class="detail-box-preview ${p.img ? 'has-img' : ''}" style="background: ${p.boxColor};">
          ${p.img
      ? `<img class="detail-img" src="${p.img}" alt="${p.brand}" loading="lazy" draggable="false">`
      : `<span style="font-size: 10px; font-weight: 800;">${p.brand}</span>
               <span style="font-size: 16px; font-weight: 800; align-self: center;">${p.size}</span>
               <span style="font-size: 9px; text-align: center;">${badge}</span>`}
        </div>
        <div class="detail-specs">
          <div class="detail-title">${name} (${p.slot})</div>
          <div class="detail-badge-row">
            <span class="detail-badge">${p.size}</span>
            <span class="detail-badge">${badge}</span>
            <span class="detail-badge" style="color: #16a34a;">${t.stockLabel}: ${p.stock}</span>
          </div>
          <div class="detail-desc">${desc}</div>
          <div class="detail-price-tag">${p.price} ${t.baht}</div>
        </div>
      </div>

      <!-- Payment Method Selection Tabs (Cash & PromptPay QR) -->
      <div class="payment-methods-grid">
        <div class="payment-method-card ${currentPaymentMethod === 'cash' ? 'active' : ''}" onclick="selectPaymentMethod('cash')">
          <span class="method-icon">💵</span>
          <span class="method-name">${t.payCash}</span>
        </div>
        <div class="payment-method-card ${currentPaymentMethod === 'qr' ? 'active' : ''}" onclick="selectPaymentMethod('qr')">
          <span class="method-icon">📱</span>
          <span class="method-name">${t.payQR}</span>
        </div>
      </div>

      <!-- Active Payment Method Content -->
      <div class="active-payment-container" id="active-payment-container">
        ${renderActivePaymentPane()}
      </div>

      <!-- Action Buttons Bar -->
      <div class="kiosk-actions-bar">
        <button class="kiosk-btn btn-secondary" onclick="backToCatalog()">
          <span>←</span> ${t.backToCatalog}
        </button>
        <button class="kiosk-btn btn-danger" onclick="cancelAndRefund()">
          <span>✕</span> ${t.cancelAndRefund}
        </button>
      </div>
    </div>
  `;
}

function selectPaymentMethod(method) {
  currentPaymentMethod = method;
  const t = TRANSLATIONS[currentLang];
  if (method === 'cash') {
    screenPromptText.textContent = t.statusPayingCash;
  } else if (method === 'qr') {
    screenPromptText.textContent = t.statusPayingQR;
  } else if (method === 'card') {
    screenPromptText.textContent = t.statusPayingCard;
  }
  renderPaymentView();
}

function renderActivePaymentPane() {
  const t = TRANSLATIONS[currentLang];
  if (!currentProduct) return '';

  if (!currentPaymentMethod) {
    return `
      <div style="text-align: center; color: var(--text-subtle); padding: 24px 10px;">
        <div style="font-size: 32px; margin-bottom: 8px;">👆</div>
        <div>${t.statusPaymentPrompt}</div>
        <div style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">(แตะเลือก เงินสด, QR พร้อมเพย์ หรือ แตะบัตร)</div>
      </div>
    `;
  }

  if (currentPaymentMethod === 'cash') {
    const remaining = Math.max(0, currentProduct.price - insertedMoney);
    const change = Math.max(0, insertedMoney - currentProduct.price);

    return `
      <div class="cash-payment-wrapper">
        <div class="cash-summary-row">
          <span>${t.totalAmount}:</span>
          <strong>${currentProduct.price} ${t.baht}</strong>
        </div>
        <div class="cash-summary-row">
          <span>${t.insertedAmount}:</span>
          <strong style="color: var(--text);">${insertedMoney} ${t.baht}</strong>
        </div>
        <div class="cash-summary-row ${remaining > 0 ? 'due' : 'change'}">
          <span>${remaining > 0 ? t.remainingAmount : t.changeAmount}:</span>
          <strong>${remaining > 0 ? remaining : change} ${t.baht}</strong>
        </div>

        <div style="font-size: 11px; color: #a3a3a3; text-align: center; margin-top: 4px;">
          ${t.simulateCoinTitle}
        </div>
        <div class="screen-cash-buttons">
          <button class="screen-cash-btn" onclick="insertCash(1)">+1฿</button>
          <button class="screen-cash-btn" onclick="insertCash(5)">+5฿</button>
          <button class="screen-cash-btn" onclick="insertCash(10)">+10฿</button>
          <button class="screen-cash-btn" onclick="insertCash(20)">+20฿</button>
          <button class="screen-cash-btn" onclick="insertCash(50)">+50฿</button>
          <button class="screen-cash-btn" onclick="insertCash(100)">+100฿</button>
        </div>

        ${insertedMoney >= currentProduct.price ? `
          <button class="kiosk-btn btn-success" style="margin-top: 8px; width: 100%;" onclick="executeDispense('Cash')">
            ✓ ยืนยันชำระเงินและรับสินค้า
          </button>
        ` : ''}
      </div>
    `;
  }

  if (currentPaymentMethod === 'qr') {
    return `
      <div class="qr-payment-wrapper">
        <div class="promptpay-header">
          <span style="color: #171717; font-weight: 800;">PromptPay</span> QR Payment
        </div>
        <div class="qr-box-code">
          <div class="qr-scan-line"></div>
          <!-- Stylized QR Code SVG -->
          <svg width="110" height="110" viewBox="0 0 110 110">
            <rect width="110" height="110" fill="white" />
            <!-- Corners -->
            <rect x="10" y="10" width="30" height="30" fill="#000" />
            <rect x="15" y="15" width="20" height="20" fill="#fff" />
            <rect x="20" y="20" width="10" height="10" fill="#000" />

            <rect x="70" y="10" width="30" height="30" fill="#000" />
            <rect x="75" y="15" width="20" height="20" fill="#fff" />
            <rect x="80" y="20" width="10" height="10" fill="#000" />

            <rect x="10" y="70" width="30" height="30" fill="#000" />
            <rect x="15" y="75" width="20" height="20" fill="#fff" />
            <rect x="20" y="80" width="10" height="10" fill="#000" />

            <!-- Pattern Dots -->
            <rect x="45" y="15" width="8" height="8" fill="#000" />
            <rect x="57" y="25" width="8" height="8" fill="#000" />
            <rect x="48" y="45" width="15" height="15" fill="#171717" />
            <rect x="70" y="55" width="10" height="10" fill="#000" />
            <rect x="85" y="70" width="15" height="10" fill="#000" />
            <rect x="45" y="75" width="10" height="15" fill="#000" />
            <rect x="70" y="85" width="8" height="8" fill="#000" />
            <circle cx="55" cy="52" r="4" fill="#fff" />
          </svg>
        </div>
        <div style="font-size: 11px; color: #a3a3a3; text-align: center;">${t.qrScanHint}</div>
        <div style="font-size: 15px; font-weight: 800; color: var(--text);">${currentProduct.price} ${t.baht}</div>
        <button class="kiosk-btn btn-success" style="width: 100%; margin-top: 4px;" onclick="executeDispense('PromptPay QR')">
          📱 ${t.simulateQRScan}
        </button>
      </div>
    `;
  }

  if (currentPaymentMethod === 'card') {
    return `
      <div class="card-tap-wrapper">
        <div class="card-sensor-visual">
          📶
        </div>
        <div style="font-size: 12px; color: #737373; text-align: center;">
          ${t.cardTapHint}
        </div>
        <div style="font-size: 16px; font-weight: 800; color: var(--text);">
          ${currentProduct.price} ${t.baht}
        </div>
        <button class="kiosk-btn btn-success" style="width: 100%; margin-top: 8px;" onclick="executeDispense('Contactless Card')">
          💳 ${t.simulateCardTap}
        </button>
      </div>
    `;
  }
}

function insertCash(amount) {
  if (!currentProduct) return;
  insertedMoney += amount;
  renderPaymentView();
}

window.insertHardwareMoney = function (amount) {
  if (currentProduct && currentPaymentMethod === 'cash') {
    insertCash(amount);
  } else if (currentProduct && !currentPaymentMethod) {
    selectPaymentMethod('cash');
    insertCash(amount);
  } else {
    coinReturnBalance += amount;
    updateCoinReturnDisplay();
  }
};

function cancelAndRefund() {
  const t = TRANSLATIONS[currentLang];
  if (insertedMoney > 0) {
    coinReturnBalance += insertedMoney;
    updateCoinReturnDisplay();
    insertedMoney = 0;
  }
  screenPromptText.textContent = t.statusCancelled;
  setTimeout(() => {
    backToCatalog();
  }, 1200);
}

function updateCoinReturnDisplay() {
  coinReturnCount.textContent = `${coinReturnBalance}฿`;
  if (coinReturnBalance > 0) {
    coinReturnCup.classList.add('has-coins');
  } else {
    coinReturnCup.classList.remove('has-coins');
  }
}

coinReturnCup.addEventListener('click', () => {
  if (coinReturnBalance > 0) {
    alert(currentLang === 'th'
      ? `คุณหยิบเงินทอน/เงินคืนจำนวน ${coinReturnBalance} บาท เรียบร้อยแล้ว`
      : `You collected ${coinReturnBalance} THB from the change return tray.`);
    coinReturnBalance = 0;
    updateCoinReturnDisplay();
  }
});

btnHardwareRefund.addEventListener('click', () => {
  cancelAndRefund();
});

function backToCatalog() {
  currentProduct = null;
  currentPaymentMethod = null;
  insertedMoney = 0;
  renderKioskCatalog();
}

async function recordSale(product, change) {
  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slot: product.slot,
        paymentMethod: currentPaymentMethod,
        cashInserted: insertedMoney,
        changeDue: change
      })
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 503) return { ok: false, dbDown: true };
    if (!res.ok || !body.ok) return { ok: false, error: body.error || `HTTP ${res.status}` };
    return { ok: true, txnCode: body.txnCode, remainingStock: body.remainingStock };
  } catch (err) {
    return { ok: false, dbDown: true };
  }
}

async function executeDispense(paymentMethodName) {
  const p = currentProduct;
  const t = TRANSLATIONS[currentLang];
  if (!p || p.stock <= 0) return;

  const change = Math.max(0, insertedMoney - p.price);
  if (change > 0) {
    coinReturnBalance += change;
    updateCoinReturnDisplay();
  }

  const sale = await recordSale(p, change);
  if (!sale.ok && !sale.dbDown) {
    if (insertedMoney > change) {
      coinReturnBalance += insertedMoney - change;
      updateCoinReturnDisplay();
    }
    screenPromptText.textContent = `${t.outOfStock} (${sale.error})`;
    setTimeout(() => backToCatalog(), 1500);
    return;
  }

  lastReceipt = {
    productName: currentLang === 'th' ? p.nameTh : p.nameEn,
    productDesc: currentLang === 'th' ? p.descTh : p.descEn,
    slot: p.slot,
    brand: p.brand,
    size: p.size,
    price: p.price,
    method: paymentMethodName,
    change: change,
    boxColor: p.boxColor,
    accentColor: p.accentColor,
    badge: currentLang === 'th' ? p.badgeTh : p.badgeEn,
    img: p.img || null,
    txnCode: sale.ok ? sale.txnCode : null
  };

  p.stock = sale.ok ? sale.remainingStock : p.stock - 1;

  screenPromptText.textContent = t.statusDispensing;
  kioskInteractiveView.innerHTML = `
    <div class="dispensing-view">
      ${p.img ? `<img class="dispense-img" src="${p.img}" alt="" draggable="false">` : ''}
      <div class="dispense-spinner"></div>
      <div style="font-size: 16px; font-weight: 700; color: var(--text);">${t.statusDispensing}</div>
      <div style="font-size: 12px; color: var(--text-subtle);">${p.slot}: ${currentLang === 'th' ? p.nameTh : p.nameEn}</div>
    </div>
  `;

  const coilEl = document.getElementById(`coil-${p.slot}`);
  const boxEl = document.getElementById(`showcase-box-${p.slot}`);

  if (coilEl) {
    coilEl.classList.remove('rotating');
    void coilEl.offsetWidth;
    coilEl.classList.add('rotating');
  }

  if (boxEl) {
    boxEl.classList.add('dispensing-push');
  }

  setTimeout(() => {
    animateProductDrop(p);
  }, 420);

  setTimeout(() => {
    if (coilEl) {
      coilEl.classList.remove('rotating');
    }

    if (boxEl) {
      boxEl.classList.remove('dispensing-push');
      if (p.stock <= 0) {
        boxEl.classList.add('out-of-stock');
        boxEl.style.opacity = '';
      } else {
        boxEl.style.opacity = '1';
        boxEl.classList.add('restocked-slide');
        setTimeout(() => boxEl.classList.remove('restocked-slide'), 450);
      }
    }

    dispensedItemWaiting = lastReceipt;
    deliveryFlap.classList.add('active-glow');
    screenPromptText.textContent = t.statusSuccess;

    kioskInteractiveView.innerHTML = `
      <div class="dispensing-view">
        <div style="font-size: 40px;">⬇️</div>
        <div style="font-size: 15px; font-weight: 700; color: var(--success);">${t.statusSuccess}</div>
        <div style="font-size: 12px; color: var(--text-muted);">${t.pickupPrompt}</div>
        <button class="kiosk-btn btn-primary" style="margin-top: 10px;" onclick="backToCatalog()">
          ${t.backToCatalog}
        </button>
      </div>
    `;
  }, 1400);
}

function animateProductDrop(product) {
  const showcaseFrame = document.getElementById('showcase-frame');
  const sourceBox = document.getElementById(`showcase-box-${product.slot}`);
  const deliveryChute = document.querySelector('.delivery-chute-container');

  if (!sourceBox || !showcaseFrame || !deliveryChute) return;

  const frameRect = showcaseFrame.getBoundingClientRect();
  const sourceRect = sourceBox.getBoundingClientRect();
  const chuteRect = deliveryChute.getBoundingClientRect();

  const proxy = document.createElement('div');
  proxy.className = `falling-item-proxy ${product.img ? 'has-img' : ''}`;
  proxy.style.width = `${sourceRect.width}px`;
  proxy.style.height = `${sourceRect.height}px`;
  proxy.style.background = product.boxColor;
  proxy.style.left = `${sourceRect.left - frameRect.left}px`;
  proxy.style.top = `${sourceRect.top - frameRect.top}px`;

  proxy.innerHTML = product.img
    ? `<img class="box-img" src="${product.img}" alt="${product.brand}" draggable="false">
       <div class="size-tag">${product.size}</div>`
    : `<div class="brand-tag">${product.brand}</div>
       <div class="size-tag">${product.size}</div>
       <div class="type-tag">${currentLang === 'th' ? product.badgeTh : product.badgeEn}</div>`;

  showcaseFrame.appendChild(proxy);
  sourceBox.style.opacity = '0';

  const targetY = (chuteRect.top - frameRect.top + (chuteRect.height / 2) - (sourceRect.height / 2)) - (sourceRect.top - frameRect.top);
  const driftX = (Math.random() - 0.5) * 14;
  const rotDirection = Math.random() > 0.5 ? 1 : -1;
  const finalRot = rotDirection * (9 + Math.random() * 7);

  const anim = proxy.animate([
    {
      transform: 'translate3d(0, 0, 0) scale(1.02) rotate(0deg)',
      opacity: 1,
      offset: 0,
      easing: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)'
    },
    {
      transform: `translate3d(${driftX * 0.25}px, ${targetY * 0.12}px, 0) scale(1.04) rotate(${finalRot * 0.3}deg)`,
      opacity: 1,
      offset: 0.18,
      easing: 'cubic-bezier(0.5, 0, 0.75, 0.7)'
    },
    {
      transform: `translate3d(${driftX * 0.7}px, ${targetY * 0.55}px, 0) scale(0.98) rotate(${finalRot * 0.75}deg)`,
      opacity: 1,
      offset: 0.55,
      easing: 'ease-in'
    },
    {
      transform: `translate3d(${driftX}px, ${targetY}px, 0) scale(0.95, 0.88) rotate(${finalRot}deg)`,
      opacity: 1,
      offset: 0.82,
      easing: 'cubic-bezier(0.25, 1, 0.5, 1)'
    },
    {
      transform: `translate3d(${driftX}px, ${targetY - 12}px, 0) scale(0.93, 0.95) rotate(${finalRot * 0.9}deg)`,
      opacity: 0.95,
      offset: 0.90,
      easing: 'ease-in'
    },
    {
      transform: `translate3d(${driftX}px, ${targetY + 4}px, 0) scale(0.88) rotate(${finalRot}deg)`,
      opacity: 0,
      offset: 1
    }
  ], {
    duration: 760,
    fill: 'forwards'
  });

  setTimeout(() => {
    deliveryFlap.classList.remove('chute-hit');
    void deliveryFlap.offsetWidth;
    deliveryFlap.classList.add('chute-hit');
    setTimeout(() => {
      deliveryFlap.classList.remove('chute-hit');
    }, 360);
  }, 760 * 0.80);

  anim.onfinish = () => {
    if (proxy && proxy.parentNode) {
      proxy.parentNode.removeChild(proxy);
    }
  };
}

deliveryFlap.addEventListener('click', () => {
  deliveryFlap.classList.add('flap-open');
  setTimeout(() => {
    deliveryFlap.classList.remove('flap-open');
  }, 400);

  if (dispensedItemWaiting) {
    deliveryFlap.classList.remove('active-glow');
    showPickupModal(dispensedItemWaiting);
    if (dispensedItemWaiting.txnCode) {
      fetch('/api/transactions/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txnCode: dispensedItemWaiting.txnCode })
      }).catch(() => { });
    }
    dispensedItemWaiting = null;
  } else {
    alert(currentLang === 'th' ? "ยังไม่มีสินค้าในช่องรับของ" : "No item in delivery chute.");
  }
});

function showPickupModal(item) {
  const t = TRANSLATIONS[currentLang];
  document.getElementById('pickup-modal-title').textContent = currentLang === 'th' ? "🎉 รับสินค้าสำเร็จ" : "🎉 Dispensed Successfully";
  document.getElementById('pickup-product-name').textContent = item.productName;
  document.getElementById('pickup-product-desc').textContent = item.productDesc;
  document.getElementById('receipt-slot').textContent = item.slot;
  document.getElementById('receipt-txn').textContent = item.txnCode || '—';
  document.getElementById('receipt-method').textContent = item.method;
  document.getElementById('receipt-price').textContent = `${item.price} ${t.baht}`;
  document.getElementById('receipt-change').textContent = `${item.change} ${t.baht}`;

  const boxDisplay = document.getElementById('pickup-box-display');
  boxDisplay.style.background = item.boxColor;
  if (item.img) {
    boxDisplay.classList.add('has-img');
    boxDisplay.innerHTML = `<img class="detail-img" src="${item.img}" alt="${item.brand}" draggable="false">`;
  } else {
    boxDisplay.classList.remove('has-img');
    boxDisplay.innerHTML = `
      <span style="font-size: 12px; font-weight: 800;">${item.brand}</span>
      <span style="font-size: 20px; font-weight: 800; align-self: center;">${item.size}</span>
      <span style="font-size: 11px; text-align: center;">${item.badge}</span>
    `;
  }

  pickupModal.classList.add('open');
}

btnClosePickup.addEventListener('click', () => pickupModal.classList.remove('open'));
btnPickupConfirm.addEventListener('click', () => pickupModal.classList.remove('open'));

btnOpenAdmin.addEventListener('click', () => {
  renderAdminTable();
  adminModal.classList.add('open');
});

btnCloseAdmin.addEventListener('click', () => adminModal.classList.remove('open'));
btnAdminCloseBottom.addEventListener('click', () => adminModal.classList.remove('open'));

function renderAdminTable() {
  adminTableBody.innerHTML = '';
  PRODUCTS.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${p.slot}</strong></td>
      <td>${currentLang === 'th' ? p.nameTh : p.nameEn} (${p.size})</td>
      <td>${p.price} ฿</td>
      <td>
        <span style="color: ${p.stock <= 2 ? 'var(--danger)' : 'var(--success)'}; font-weight: bold;">
          ${p.stock}
        </span> / ${p.maxStock}
      </td>
      <td>
        <button class="restock-slot-btn" onclick="restockSlot('${p.slot}')">
          + เติมเต็ม (${p.maxStock})
        </button>
      </td>
    `;
    adminTableBody.appendChild(tr);
  });
}

window.restockSlot = function (slotCode) {
  const p = PRODUCTS.find(x => x.slot === slotCode);
  if (p) {
    p.stock = p.maxStock;
    renderAdminTable();
    renderShelves();
    if (kioskGrid.style.display !== 'none') {
      renderKioskCatalog();
    }
  }
  fetch('/api/restock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot: slotCode })
  }).catch(() => { });
};

btnRestockAll.addEventListener('click', () => {
  PRODUCTS.forEach(p => {
    p.stock = p.maxStock;
  });
  renderAdminTable();
  renderShelves();
  if (kioskGrid.style.display !== 'none') {
    renderKioskCatalog();
  }
  alert(currentLang === 'th' ? "เติมสต็อกสินค้าเต็มทุกช่องเรียบร้อยแล้ว!" : "All slots restocked to full capacity!");
  PRODUCTS.forEach(p => {
    fetch('/api/restock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: p.slot })
    }).catch(() => { });
  });
});

btnToggleLang.addEventListener('click', () => {
  currentLang = currentLang === 'th' ? 'en' : 'th';
  updateLanguageUI();
});

function updateLanguageUI() {
  const t = TRANSLATIONS[currentLang];
  document.getElementById('lang-current-label').textContent = currentLang === 'th' ? 'ไทย / EN' : 'EN / ไทย';
  document.getElementById('nav-brand-title').textContent = t.machineBrand;
  const kioskLogoEl = document.getElementById('kiosk-logo-text');
  if (kioskLogoEl) kioskLogoEl.textContent = t.machineBrand;
  document.getElementById('text-admin-btn').textContent = currentLang === 'th' ? 'จัดการสต็อก (Restock)' : 'Stock & Restock';
  document.getElementById('inst-title').textContent = t.instructionsTitle;
  document.getElementById('inst-s1').textContent = t.step1;
  document.getElementById('inst-s2').textContent = t.step2;
  document.getElementById('inst-s3').textContent = t.step3;
  document.getElementById('inst-s4').textContent = t.step4;
  document.getElementById('hw-coin-label').textContent = t.coinSlotLabel;
  document.getElementById('hw-bill-label').textContent = t.billSlotLabel;
  const hwCardLabel = document.getElementById('hw-card-label');
  if (hwCardLabel) hwCardLabel.textContent = t.cardReaderLabel;
  document.getElementById('hw-refund-label').textContent = t.cancelAndRefund;
  document.getElementById('hw-insert-title').textContent = t.simulateCoinTitle;
  document.getElementById('flap-text').textContent = t.pushLabel;
  document.getElementById('safe-footer-tag').textContent = `• ${t.safeConfidential}`;

  const catButtons = categoryTabsBar.querySelectorAll('.cat-tab-btn');
  catButtons[0].textContent = t.allCategories;
  catButtons[1].textContent = t.cat49;
  catButtons[2].textContent = t.cat52;
  catButtons[3].textContent = t.cat54;
  catButtons[4].textContent = t.cat56;
  catButtons[5].textContent = t.catGel;

  renderShelves();
  if (kioskGrid.style.display !== 'none') {
    renderKioskCatalog();
  } else if (currentProduct) {
    renderPaymentView();
  }
}

function setupEventListeners() {
  categoryTabsBar.addEventListener('click', (e) => {
    if (e.target.classList.contains('cat-tab-btn')) {
      categoryTabsBar.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentCategory = e.target.dataset.cat;
      currentPage = 1;
      renderKioskCatalog();
    }
  });

  pickupModal.addEventListener('click', (e) => {
    if (e.target === pickupModal) pickupModal.classList.remove('open');
  });
  adminModal.addEventListener('click', (e) => {
    if (e.target === adminModal) adminModal.classList.remove('open');
  });
}
