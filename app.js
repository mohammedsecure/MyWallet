/**
 * My Wallet v1.1 (محفظتي) - Clean Slate Hybrid Financial Architecture
 * Zero Pre-stored Data | Standalone CSS Classes | DeepSeek Chat API
 */

const STORAGE_KEYS = {
  LEGACY_V1: 'my_wallet_state_v1',
  STATE: 'my_wallet_state_v1_1',
  API_KEY: 'my_wallet_deepseek_api_key',
  API_URL: 'my_wallet_deepseek_api_url',
  THEME: 'my_wallet_theme_mode'
};

const DEFAULT_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * Clean Empty Initial State (Zero Pre-Populated Demo Data)
 */
function getInitialCleanState() {
  return {
    fx_rate: 15000,
    wallets: {},
    projects: {},
    debts: [],
    logs: [],
    archive: {
      projects: {},
      debts: []
    }
  };
}

let appState = getInitialCleanState();
let currentTab = 'wallets';
let pendingAIProposal = null;
let currentHybridContext = null;

function safeGetStorage(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw !== null ? raw : fallback;
  } catch (err) {
    return fallback;
  }
}

function safeSetStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    // Ignore storage errors in restricted webviews
  }
}

function safeRemoveStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    // Ignore storage errors
  }
}

function formatTimestamp(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatNumber(num, currency = '') {
  const cleanNum = Number(num) || 0;
  const formatted = cleanNum.toLocaleString('en-US', {
    minimumFractionDigits: currency === 'USD' && cleanNum % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2
  });
  if (currency === 'USD') return `$${formatted}`;
  if (currency === 'SYP') return `${formatted} SYP`;
  return formatted;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Initialize Application & Purge Legacy v1.0 Demo Data
 */
function initApp() {
  // Remove legacy v1.0 pre-populated demo state automatically
  safeRemoveStorage(STORAGE_KEYS.LEGACY_V1);

  const savedTheme = safeGetStorage(STORAGE_KEYS.THEME, 'light');
  applyThemeMode(savedTheme);

  const rawState = safeGetStorage(STORAGE_KEYS.STATE, null);
  if (rawState) {
    try {
      appState = normalizeStateSchema(JSON.parse(rawState));
    } catch (e) {
      appState = getInitialCleanState();
    }
  } else {
    appState = getInitialCleanState();
    saveStateToStorage();
  }

  renderUI();
}

function normalizeStateSchema(raw) {
  const clean = getInitialCleanState();
  if (!raw || typeof raw !== 'object') return clean;

  return {
    fx_rate: Number(raw.fx_rate) > 0 ? Number(raw.fx_rate) : clean.fx_rate,
    wallets: raw.wallets && typeof raw.wallets === 'object' ? raw.wallets : {},
    projects: raw.projects && typeof raw.projects === 'object' ? raw.projects : {},
    debts: Array.isArray(raw.debts) ? raw.debts : [],
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    archive: {
      projects: raw.archive && raw.archive.projects && typeof raw.archive.projects === 'object' ? raw.archive.projects : {},
      debts: raw.archive && Array.isArray(raw.archive.debts) ? raw.archive.debts : []
    }
  };
}

function saveStateToStorage() {
  safeSetStorage(STORAGE_KEYS.STATE, JSON.stringify(appState));
}

function appendLog(text) {
  if (!Array.isArray(appState.logs)) appState.logs = [];
  appState.logs.unshift({
    date: formatTimestamp(),
    text: text
  });
}

let toastTimeoutId = null;
function showToast(message) {
  const banner = document.getElementById('toast-banner');
  const msgEl = document.getElementById('toast-message');
  if (!banner || !msgEl) return;

  msgEl.textContent = message;
  banner.classList.remove('hidden');
  banner.style.display = 'inline-flex';

  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    banner.classList.add('hidden');
    banner.style.display = 'none';
  }, 3000);
}

/**
 * Theme Management (Light vs Dark OLED)
 */
function applyThemeMode(mode) {
  const root = document.documentElement;
  const sunIcon = document.getElementById('icon-sun');
  const moonIcon = document.getElementById('icon-moon');

  if (mode === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    if (sunIcon) sunIcon.classList.remove('hidden');
    if (moonIcon) moonIcon.classList.add('hidden');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
    if (sunIcon) sunIcon.classList.add('hidden');
    if (moonIcon) moonIcon.classList.remove('hidden');
  }
  safeSetStorage(STORAGE_KEYS.THEME, mode);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyThemeMode(isDark ? 'light' : 'dark');
}

/**
 * Navigation Tab Switching
 */
function switchTab(tabName) {
  currentTab = tabName;
  const walletsPanel = document.getElementById('panel-wallets');
  const projectsPanel = document.getElementById('panel-projects');
  const subProjects = document.getElementById('subpanel-projects-container');
  const subDebts = document.getElementById('subpanel-debts-container');

  const btnWallets = document.getElementById('tab-btn-wallets');
  const btnProjects = document.getElementById('tab-btn-projects');
  const btnDebts = document.getElementById('tab-btn-debts');

  [btnWallets, btnProjects, btnDebts].forEach((b) => {
    if (b) b.classList.remove('active');
  });

  if (tabName === 'wallets') {
    walletsPanel.classList.remove('hidden');
    projectsPanel.classList.add('hidden');
    if (btnWallets) btnWallets.classList.add('active');
  } else if (tabName === 'projects') {
    walletsPanel.classList.add('hidden');
    projectsPanel.classList.remove('hidden');
    subProjects.classList.remove('hidden');
    subDebts.classList.remove('hidden');
    if (btnProjects) btnProjects.classList.add('active');
  } else if (tabName === 'debts') {
    walletsPanel.classList.add('hidden');
    projectsPanel.classList.remove('hidden');
    subProjects.classList.add('hidden');
    subDebts.classList.remove('hidden');
    if (btnDebts) btnDebts.classList.add('active');
  }
}

/**
 * State Pruning & Auto-Archiving (`archiveClosedItems`)
 */
function archiveClosedItems(targetState = appState) {
  if (!targetState.archive) {
    targetState.archive = { projects: {}, debts: [] };
  }
  if (!targetState.archive.projects) targetState.archive.projects = {};
  if (!Array.isArray(targetState.archive.debts)) targetState.archive.debts = [];

  if (Array.isArray(targetState.debts)) {
    const remainingDebts = [];
    targetState.debts.forEach((debt) => {
      const amt = Number(debt.amount) || 0;
      if (amt <= 0 || debt.settled === true) {
        targetState.archive.debts.unshift({
          ...debt,
          amount: amt,
          archivedAt: formatTimestamp()
        });
      } else {
        remainingDebts.push(debt);
      }
    });
    targetState.debts = remainingDebts;
  }

  if (targetState.projects && typeof targetState.projects === 'object') {
    Object.keys(targetState.projects).forEach((projName) => {
      const proj = targetState.projects[projName];
      if (proj && (proj.archived === true || proj.closed === true)) {
        targetState.archive.projects[projName] = {
          ...proj,
          archivedAt: formatTimestamp()
        };
        delete targetState.projects[projName];
      }
    });
  }
}

/**
 * Context Window Pruning for DeepSeek AI (Active State + Last 3 Logs only, No Archive)
 */
function buildPrunedContextForAI(sourceState = appState) {
  const recentThreeLogs = Array.isArray(sourceState.logs)
    ? sourceState.logs.slice(0, 3)
    : [];

  return {
    fx_rate: Number(sourceState.fx_rate) || 15000,
    wallets: JSON.parse(JSON.stringify(sourceState.wallets || {})),
    projects: JSON.parse(JSON.stringify(sourceState.projects || {})),
    debts: JSON.parse(JSON.stringify(sourceState.debts || [])),
    logs: JSON.parse(JSON.stringify(recentThreeLogs))
  };
}

function buildSystemPrompt(sourceState = appState) {
  const prunedState = buildPrunedContextForAI(sourceState);
  return `أنت محاسب مالي ذكي تدير نظام 'الورقة البيضاء المطلقة'. لديك الحالة المالية الحالية التالية للمستخدم (متضمنة آخر 3 حركات للسياق):
${JSON.stringify(prunedState, null, 2)}

اقرأ طلب المستخدم، وقم بإجراء كافة الحسابات المطلوبة ذهنياً (تعديل أرصدة، إضافة، تصفير، أو إنشاء محافظ/مشاريع/ديون جديدة، وتحديد سعر الصرف).
أرجع كائن JSON صالحاً فقط يحتوي على مفتاحين:
1. "reply": شرح نصي قصير وواضح باللغة العربية للعمليات التي قمت بها.
2. "updated_state": كائن الحالة الجديد بالكامل بعد تعديلاتك.`;
}

/**
 * State Diffing & Validation (`validateState`)
 */
function validateState(currentState, updatedState) {
  const warnings = [];
  const changes = [];

  if (!updatedState || typeof updatedState !== 'object') {
    return {
      valid: false,
      requiresConfirmation: false,
      error: 'كائن الحالة القادم من الذكاء الاصطناعي غير صالح.',
      warnings: [],
      changes: []
    };
  }

  const curWallets = currentState.wallets || {};
  const newWallets = updatedState.wallets || {};

  Object.keys(curWallets).forEach((walletName) => {
    if (!Object.prototype.hasOwnProperty.call(newWallets, walletName)) {
      warnings.push(`تنبيه: هذا الإجراء سيحذف محفظة [${walletName}] بالكامل، هل أنت متأكد؟`);
    } else {
      const oldAmt = Number(curWallets[walletName].amount) || 0;
      const newAmt = Number(newWallets[walletName].amount) || 0;
      if (oldAmt !== newAmt) {
        const cur = newWallets[walletName].currency || curWallets[walletName].currency || 'SYP';
        changes.push(`تحديث محفظة "${walletName}": من ${formatNumber(oldAmt, cur)} إلى ${formatNumber(newAmt, cur)}`);
      }
    }
  });

  Object.keys(newWallets).forEach((walletName) => {
    if (!Object.prototype.hasOwnProperty.call(curWallets, walletName)) {
      const cur = newWallets[walletName].currency || 'SYP';
      changes.push(`إنشاء محفظة جديدة "${walletName}" برصيد ${formatNumber(newWallets[walletName].amount, cur)}`);
    }
  });

  const curProjects = currentState.projects || {};
  const newProjects = updatedState.projects || {};
  Object.keys(curProjects).forEach((projName) => {
    if (!Object.prototype.hasOwnProperty.call(newProjects, projName)) {
      warnings.push(`تنبيه: هذا الإجراء سيحذف مشروع [${projName}] بالكامل، هل أنت متأكد؟`);
    } else {
      const oldSyp = Number(curProjects[projName].netSYP) || 0;
      const newSyp = Number(newProjects[projName].netSYP) || 0;
      const oldUsd = Number(curProjects[projName].netUSD) || 0;
      const newUsd = Number(newProjects[projName].netUSD) || 0;
      if (oldSyp !== newSyp || oldUsd !== newUsd) {
        changes.push(`تحديث مشروع "${projName}"`);
      }
    }
  });

  Object.keys(newProjects).forEach((projName) => {
    if (!Object.prototype.hasOwnProperty.call(curProjects, projName)) {
      changes.push(`إضافة مشروع جديد "${projName}"`);
    }
  });

  const curDebts = Array.isArray(currentState.debts) ? currentState.debts : [];
  const newDebts = Array.isArray(updatedState.debts) ? updatedState.debts : [];
  curDebts.forEach((oldDebt) => {
    const match = newDebts.find((d) =>
      (d.id !== undefined && d.id === oldDebt.id) ||
      (d.person && d.person === oldDebt.person)
    );
    if (!match) {
      warnings.push(`تنبيه: هذا الإجراء سيحذف سجل الدين الخاص بـ [${oldDebt.person}] بالكامل، هل أنت متأكد؟`);
    }
  });

  if (Number(updatedState.fx_rate) && Number(updatedState.fx_rate) !== Number(currentState.fx_rate)) {
    changes.push(`تحديث سعر الصرف إلى ${formatNumber(updatedState.fx_rate)} ل.س/$`);
  }

  return {
    valid: true,
    requiresConfirmation: warnings.length > 0,
    warnings,
    changes
  };
}

/**
 * Render Complete UI with Standalone CSS Classes
 */
function renderUI() {
  const fx = Number(appState.fx_rate) || 15000;

  const fxEl = document.getElementById('header-fx-value');
  if (fxEl) fxEl.textContent = formatNumber(fx);

  const logsBadge = document.getElementById('logs-count-badge');
  if (logsBadge) logsBadge.textContent = String((appState.logs || []).length);

  let totalWalletsSYP = 0;
  let totalWalletsUSD = 0;
  Object.values(appState.wallets || {}).forEach((w) => {
    const amt = Number(w.amount) || 0;
    if ((w.currency || 'SYP').toUpperCase() === 'USD') {
      totalWalletsUSD += amt;
    } else {
      totalWalletsSYP += amt;
    }
  });

  let totalProjectsSYP = 0;
  Object.values(appState.projects || {}).forEach((p) => {
    totalProjectsSYP += (Number(p.netSYP) || 0) + ((Number(p.netUSD) || 0) * fx);
  });

  let netDebtsUSD = 0;
  const activeDebts = appState.debts || [];
  activeDebts.forEach((d) => {
    const rawAmt = Number(d.amount) || 0;
    const inUsd = (d.currency || 'USD').toUpperCase() === 'SYP' ? rawAmt / fx : rawAmt;
    if (d.type === 'لنا') {
      netDebtsUSD += inUsd;
    } else {
      netDebtsUSD -= inUsd;
    }
  });

  const sumSypEl = document.getElementById('summary-wallets-syp');
  const sumUsdEl = document.getElementById('summary-wallets-usd');
  const sumProjEl = document.getElementById('summary-projects-net');
  const sumDebtsCountEl = document.getElementById('summary-debts-count');
  const sumDebtsNetEl = document.getElementById('summary-debts-net');

  if (sumSypEl) sumSypEl.textContent = `${formatNumber(totalWalletsSYP)} ل.س`;
  if (sumUsdEl) sumUsdEl.textContent = formatNumber(totalWalletsUSD, 'USD');
  if (sumProjEl) sumProjEl.textContent = `${formatNumber(Math.round(totalProjectsSYP))} ل.س`;
  if (sumDebtsCountEl) sumDebtsCountEl.textContent = `${activeDebts.length}`;
  if (sumDebtsNetEl) {
    const sign = netDebtsUSD > 0 ? '+' : '';
    sumDebtsNetEl.textContent = `${sign}${formatNumber(netDebtsUSD, 'USD')}`;
  }

  renderWalletsSection(fx);
  renderProjectsSection(fx);
  renderDebtsSection();
  renderContextLogsStrip();
}

function renderWalletsSection(fx) {
  const grid = document.getElementById('wallets-grid');
  if (!grid) return;

  const entries = Object.entries(appState.wallets || {});
  if (entries.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1;">
        <svg style="width:1.75rem; height:1.75rem; color:var(--emerald-primary); opacity:0.8;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
          <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
        </svg>
        <div>لا توجد محافظ مضافة حالياً. اضغط على <strong>"إضافة محفظة"</strong> أو استخدم المساعد الذكي لإنشاء محفظتك الأولى.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = entries.map(([name, data]) => {
    const amount = Number(data.amount) || 0;
    const currency = (data.currency || 'SYP').toUpperCase();
    const equivalent = currency === 'USD'
      ? `يعادل ${formatNumber(Math.round(amount * fx))} ل.س`
      : `يعادل ${formatNumber(amount / fx, 'USD')}`;
    const safeName = escapeHtml(name);

    return `
      <article class="item-card">
        <div class="card-top-row">
          <div style="display:flex; align-items:center; gap:0.65rem;">
            <div class="wallet-icon-box">
              <svg style="width:1.1rem; height:1.1rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
                <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
              </svg>
            </div>
            <div>
              <h3 class="card-title">${safeName}</h3>
              <span class="card-subtext">${equivalent}</span>
            </div>
          </div>
          <span class="badge-pill">${currency}</span>
        </div>

        <div class="card-balance num-ltr">${formatNumber(amount, currency)}</div>

        <div class="wallet-actions-row">
          <button type="button" onclick="openWalletAdjustModal('${safeName}', 'deposit')" class="btn-wallet-deposit" title="إيداع مبلغ">
            <svg style="width:0.9rem; height:0.9rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v12"/>
              <path d="m7 10 5 5 5-5"/>
              <path d="M5 21h14"/>
            </svg>
            <span>إيداع</span>
          </button>

          <button type="button" onclick="openWalletAdjustModal('${safeName}', 'withdraw')" class="btn-wallet-withdraw" title="سحب مبلغ">
            <svg style="width:0.9rem; height:0.9rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 15V3"/>
              <path d="m7 8 5-5 5 5"/>
              <path d="M5 21h14"/>
            </svg>
            <span>سحب</span>
          </button>

          <button type="button" onclick="openWalletAdjustModal('${safeName}', 'set')" class="btn-wallet-icon" title="تعديل الرصيد المباشر" aria-label="تعديل الرصيد">
            <svg style="width:0.9rem; height:0.9rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </button>

          <button type="button" onclick="deleteWalletLocally('${safeName}')" class="btn-wallet-icon danger" title="حذف المحفظة" aria-label="حذف المحفظة">
            <svg style="width:0.9rem; height:0.9rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderProjectsSection(fx) {
  const grid = document.getElementById('projects-grid');
  if (!grid) return;

  const entries = Object.entries(appState.projects || {});
  if (entries.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box">
        <span>لا توجد مشاريع نشطة حالياً. يمكنك إضافة مشروع جديد لمتابعة أرباحه ومصاريفه.</span>
      </div>
    `;
    return;
  }

  grid.innerHTML = entries.map(([name, proj]) => {
    const netSYP = Number(proj.netSYP) || 0;
    const netUSD = Number(proj.netUSD) || 0;
    const summary = escapeHtml(proj.summary || 'مشروع نشط');
    const safeName = escapeHtml(name);
    const totalInSYP = netSYP + (netUSD * fx);

    return `
      <article class="item-card">
        <div class="card-top-row">
          <div>
            <h3 class="card-title">${safeName}</h3>
            <p class="card-subtext">${summary}</p>
          </div>
          <span class="badge-pill num-ltr">${formatNumber(Math.round(totalInSYP))} ل.س</span>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:1rem; font-size:0.78rem; color:var(--text-muted);">
          <div>صافي الليرة: <strong class="num-ltr" style="color:var(--text-main);">${formatNumber(netSYP)} SYP</strong></div>
          <div>صافي الدولار: <strong class="num-ltr" style="color:var(--text-main);">${formatNumber(netUSD, 'USD')}</strong></div>
        </div>

        <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.45rem; padding-top:0.65rem; border-top:1px solid var(--border-hairline);">
          <button type="button" onclick="openProjectEditModal('${safeName}')" class="btn-secondary">تعديل</button>
          <button type="button" onclick="settleAndArchiveProject('${safeName}')" class="btn-emerald">إغلاق وأرشفة</button>
          <button type="button" onclick="deleteProjectLocally('${safeName}')" class="btn-wallet-icon danger" title="حذف المشروع">
            <svg style="width:0.9rem; height:0.9rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderDebtsSection() {
  const listEl = document.getElementById('debts-list');
  if (!listEl) return;

  const debts = Array.isArray(appState.debts) ? appState.debts : [];
  if (debts.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state-box">
        <span>لا توجد ديون أو ذمم مسجلة حالياً.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = debts.map((debt) => {
    const isLana = debt.type === 'لنا';
    const safePerson = escapeHtml(debt.person || 'غير مسمى');
    const safeNote = escapeHtml(debt.note || '');
    const currency = (debt.currency || 'USD').toUpperCase();

    return `
      <article class="item-card">
        <div class="card-top-row">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span class="badge-pill ${isLana ? '' : 'amber'}">${escapeHtml(debt.type || 'علينا')}</span>
            <div>
              <h3 class="card-title">${safePerson}</h3>
              ${safeNote ? `<p class="card-subtext">${safeNote}</p>` : ''}
            </div>
          </div>
          <span class="num-ltr" style="font-size:1rem; font-weight:700; color:var(--emerald-primary);">${formatNumber(debt.amount, currency)}</span>
        </div>

        <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.45rem; padding-top:0.65rem; border-top:1px solid var(--border-hairline);">
          <button type="button" onclick="openDebtEditModal(${Number(debt.id)})" class="btn-secondary">تعديل</button>
          <button type="button" onclick="settleDebtLocally(${Number(debt.id)})" class="btn-emerald">تسوية وأرشفة</button>
          <button type="button" onclick="deleteDebtLocally(${Number(debt.id)})" class="btn-wallet-icon danger" title="حذف الذمة">
            <svg style="width:0.9rem; height:0.9rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function renderContextLogsStrip() {
  const container = document.getElementById('context-logs-preview');
  if (!container) return;

  const recentThree = (appState.logs || []).slice(0, 3);
  if (recentThree.length === 0) {
    container.innerHTML = `<div style="font-size:0.74rem; color:var(--text-muted); text-align:center; padding:0.4rem 0;">لا توجد حركات مسجلة بعد.</div>`;
    return;
  }

  container.innerHTML = recentThree.map((item) => `
    <div class="log-row">
      <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.text)}</span>
      <span class="num-ltr" style="font-size:0.66rem; color:var(--text-muted); flex-shrink:0;">${escapeHtml(item.date)}</span>
    </div>
  `).join('');
}

/**
 * ============================================================================
 * HYBRID LOCAL OPERATIONS (Direct Frontend Execution)
 * ============================================================================
 */

function openFxModal() {
  currentHybridContext = { type: 'fx' };
  document.getElementById('hybrid-modal-title').textContent = 'تعديل سعر الصرف الحي (SYP / USD)';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div>
      <label class="field-label">سعر صرف الدولار الواحد بالليرة السورية:</label>
      <input id="hybrid-fx-input" type="number" step="any" min="1" required value="${Number(appState.fx_rate) || 15000}" class="num-ltr" />
    </div>
  `;
  showHybridModal();
}

function openWalletModal() {
  currentHybridContext = { type: 'new_wallet' };
  document.getElementById('hybrid-modal-title').textContent = 'إضافة محفظة نقدية جديدة';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div>
      <label class="field-label">اسم المحفظة:</label>
      <input id="hybrid-wallet-name" type="text" required placeholder="مثال: كاش سوري أو محفظة الدولار" />
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">العملة:</label>
        <select id="hybrid-wallet-currency">
          <option value="SYP">SYP (ليرة سورية)</option>
          <option value="USD">USD (دولار أمريكي)</option>
        </select>
      </div>
      <div>
        <label class="field-label">الرصيد الافتتاحي:</label>
        <input id="hybrid-wallet-amount" type="number" step="any" required value="0" class="num-ltr" />
      </div>
    </div>
  `;
  showHybridModal();
}

function openWalletAdjustModal(walletName, mode) {
  const wallet = appState.wallets[walletName];
  if (!wallet) return;

  currentHybridContext = { type: 'adjust_wallet', walletName, mode };
  const modeLabels = {
    deposit: `إيداع في "${walletName}"`,
    withdraw: `سحب من "${walletName}"`,
    set: `تعديل رصيد "${walletName}"`
  };
  document.getElementById('hybrid-modal-title').textContent = modeLabels[mode] || 'تعديل المحفظة';

  const defaultVal = mode === 'set' ? Number(wallet.amount) || 0 : '';
  const amountLabel = mode === 'set'
    ? `الرصيد الجديد (${wallet.currency}):`
    : `المبلغ (${wallet.currency}):`;

  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div class="log-row">
      <span>الرصيد الحالي:</span>
      <strong class="num-ltr" style="color:var(--emerald-primary);">${formatNumber(wallet.amount, wallet.currency)}</strong>
    </div>
    <div>
      <label class="field-label">${amountLabel}</label>
      <input id="hybrid-adjust-amount" type="number" step="any" required value="${defaultVal}" placeholder="0" class="num-ltr" />
    </div>
    <div>
      <label class="field-label">ملاحظة للسجل (اختياري):</label>
      <input id="hybrid-adjust-note" type="text" placeholder="بيان العملية" />
    </div>
  `;
  showHybridModal();
}

function deleteWalletLocally(walletName) {
  if (!appState.wallets[walletName]) return;
  delete appState.wallets[walletName];
  appendLog(`حذف محفظة "${walletName}" يدوياً`);
  saveStateToStorage();
  renderUI();
  showToast(`تم حذف محفظة ${walletName}`);
}

function openProjectModal() {
  currentHybridContext = { type: 'new_project' };
  document.getElementById('hybrid-modal-title').textContent = 'إضافة مشروع جديد';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div>
      <label class="field-label">اسم المشروع:</label>
      <input id="hybrid-proj-name" type="text" required placeholder="اسم المشروع" />
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">صافي SYP:</label>
        <input id="hybrid-proj-syp" type="number" step="any" value="0" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">صافي USD:</label>
        <input id="hybrid-proj-usd" type="number" step="any" value="0" class="num-ltr" />
      </div>
    </div>
    <div>
      <label class="field-label">وصف مختصر:</label>
      <input id="hybrid-proj-summary" type="text" placeholder="ملخص المشروع" />
    </div>
  `;
  showHybridModal();
}

function openProjectEditModal(projName) {
  const proj = appState.projects[projName];
  if (!proj) return;

  currentHybridContext = { type: 'edit_project', projName };
  document.getElementById('hybrid-modal-title').textContent = `تعديل مشروع "${projName}"`;
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">صافي SYP:</label>
        <input id="hybrid-proj-syp" type="number" step="any" required value="${Number(proj.netSYP) || 0}" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">صافي USD:</label>
        <input id="hybrid-proj-usd" type="number" step="any" required value="${Number(proj.netUSD) || 0}" class="num-ltr" />
      </div>
    </div>
    <div>
      <label class="field-label">وصف المشروع:</label>
      <input id="hybrid-proj-summary" type="text" value="${escapeHtml(proj.summary || '')}" />
    </div>
  `;
  showHybridModal();
}

function deleteProjectLocally(projName) {
  if (!appState.projects[projName]) return;
  delete appState.projects[projName];
  appendLog(`حذف مشروع "${projName}" يدوياً`);
  saveStateToStorage();
  renderUI();
  showToast(`تم حذف مشروع ${projName}`);
}

function openDebtModal() {
  currentHybridContext = { type: 'new_debt' };
  document.getElementById('hybrid-modal-title').textContent = 'إضافة دين أو ذمة مالية';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">الاسم / الجهة:</label>
        <input id="hybrid-debt-person" type="text" required placeholder="اسم الطرف" />
      </div>
      <div>
        <label class="field-label">نوع الذمة:</label>
        <select id="hybrid-debt-type">
          <option value="علينا">علينا (التزام للدفع)</option>
          <option value="لنا">لنا (مستحق للقبض)</option>
        </select>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">المبلغ:</label>
        <input id="hybrid-debt-amount" type="number" step="any" min="0.01" required placeholder="0" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">العملة:</label>
        <select id="hybrid-debt-currency">
          <option value="USD">USD</option>
          <option value="SYP">SYP</option>
        </select>
      </div>
    </div>
    <div>
      <label class="field-label">ملاحظة:</label>
      <input id="hybrid-debt-note" type="text" placeholder="تفاصيل إضافية" />
    </div>
  `;
  showHybridModal();
}

function openDebtEditModal(debtId) {
  const debt = (appState.debts || []).find((d) => Number(d.id) === Number(debtId));
  if (!debt) return;

  currentHybridContext = { type: 'edit_debt', debtId: Number(debtId) };
  document.getElementById('hybrid-modal-title').textContent = `تعديل ذمة "${debt.person}"`;
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">المبلغ المتبقي:</label>
        <input id="hybrid-debt-amount" type="number" step="any" required value="${Number(debt.amount) || 0}" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">نوع الذمة:</label>
        <select id="hybrid-debt-type">
          <option value="علينا" ${debt.type === 'علينا' ? 'selected' : ''}>علينا</option>
          <option value="لنا" ${debt.type === 'لنا' ? 'selected' : ''}>لنا</option>
        </select>
      </div>
    </div>
    <div>
      <label class="field-label">ملاحظة:</label>
      <input id="hybrid-debt-note" type="text" value="${escapeHtml(debt.note || '')}" />
    </div>
  `;
  showHybridModal();
}

function deleteDebtLocally(debtId) {
  const idx = (appState.debts || []).findIndex((d) => Number(d.id) === Number(debtId));
  if (idx === -1) return;
  const removed = appState.debts.splice(idx, 1)[0];
  appendLog(`حذف سجل دين "${removed.person}" يدوياً`);
  saveStateToStorage();
  renderUI();
  showToast('تم حذف سجل الدين');
}

function showHybridModal() {
  const modal = document.getElementById('hybrid-action-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeHybridModal() {
  const modal = document.getElementById('hybrid-action-modal');
  if (modal) modal.classList.add('hidden');
  currentHybridContext = null;
}

function submitHybridModal(event) {
  event.preventDefault();
  if (!currentHybridContext) return;
  const ctx = currentHybridContext;

  if (ctx.type === 'fx') {
    const newFx = Number(document.getElementById('hybrid-fx-input').value);
    if (newFx > 0) {
      appState.fx_rate = newFx;
      appendLog(`تحديث سعر الصرف إلى ${formatNumber(newFx)} ل.س/$`);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث سعر الصرف');
    }
  } else if (ctx.type === 'new_wallet') {
    const name = document.getElementById('hybrid-wallet-name').value.trim();
    const currency = document.getElementById('hybrid-wallet-currency').value;
    const amount = Number(document.getElementById('hybrid-wallet-amount').value) || 0;
    if (name) {
      appState.wallets[name] = { amount, currency };
      appendLog(`إنشاء محفظة "${name}" برصيد ${formatNumber(amount, currency)}`);
      saveStateToStorage();
      renderUI();
      showToast(`تمت إضافة محفظة ${name}`);
    }
  } else if (ctx.type === 'adjust_wallet') {
    const wallet = appState.wallets[ctx.walletName];
    const val = Number(document.getElementById('hybrid-adjust-amount').value) || 0;
    const note = document.getElementById('hybrid-adjust-note').value.trim();
    if (wallet) {
      const oldAmt = Number(wallet.amount) || 0;
      let newAmt = oldAmt;
      if (ctx.mode === 'deposit') newAmt = oldAmt + val;
      if (ctx.mode === 'withdraw') newAmt = oldAmt - val;
      if (ctx.mode === 'set') newAmt = val;

      wallet.amount = newAmt;
      const actionLabel = ctx.mode === 'deposit' ? 'إيداع في' : ctx.mode === 'withdraw' ? 'سحب من' : 'تعديل رصيد';
      appendLog(`${actionLabel} "${ctx.walletName}" (${formatNumber(val, wallet.currency)})${note ? ' - ' + note : ''}`);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث رصيد المحفظة');
    }
  } else if (ctx.type === 'new_project') {
    const name = document.getElementById('hybrid-proj-name').value.trim();
    const netSYP = Number(document.getElementById('hybrid-proj-syp').value) || 0;
    const netUSD = Number(document.getElementById('hybrid-proj-usd').value) || 0;
    const summary = document.getElementById('hybrid-proj-summary').value.trim() || 'مشروع نشط';
    if (name) {
      appState.projects[name] = { netSYP, netUSD, summary };
      appendLog(`إضافة مشروع "${name}"`);
      saveStateToStorage();
      renderUI();
      showToast(`تمت إضافة مشروع ${name}`);
    }
  } else if (ctx.type === 'edit_project') {
    const proj = appState.projects[ctx.projName];
    if (proj) {
      proj.netSYP = Number(document.getElementById('hybrid-proj-syp').value) || 0;
      proj.netUSD = Number(document.getElementById('hybrid-proj-usd').value) || 0;
      proj.summary = document.getElementById('hybrid-proj-summary').value.trim() || proj.summary;
      appendLog(`تعديل عوائد مشروع "${ctx.projName}"`);
      archiveClosedItems(appState);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث المشروع');
    }
  } else if (ctx.type === 'new_debt') {
    const person = document.getElementById('hybrid-debt-person').value.trim();
    const type = document.getElementById('hybrid-debt-type').value;
    const amount = Number(document.getElementById('hybrid-debt-amount').value) || 0;
    const currency = document.getElementById('hybrid-debt-currency').value;
    const note = document.getElementById('hybrid-debt-note').value.trim();
    if (person && amount > 0) {
      const nextId = (appState.debts || []).reduce((max, d) => Math.max(max, Number(d.id) || 0), 0) + 1;
      appState.debts.push({ id: nextId, person, amount, currency, type, note });
      appendLog(`تسجيل ذمة (${type}) لـ "${person}" بقيمة ${formatNumber(amount, currency)}`);
      saveStateToStorage();
      renderUI();
      showToast('تم تسجيل الذمة');
    }
  } else if (ctx.type === 'edit_debt') {
    const debt = (appState.debts || []).find((d) => Number(d.id) === Number(ctx.debtId));
    if (debt) {
      debt.amount = Number(document.getElementById('hybrid-debt-amount').value) || 0;
      debt.type = document.getElementById('hybrid-debt-type').value;
      debt.note = document.getElementById('hybrid-debt-note').value.trim();
      appendLog(`تعديل ذمة "${debt.person}" إلى ${formatNumber(debt.amount, debt.currency)}`);
      archiveClosedItems(appState);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث الذمة');
    }
  }

  closeHybridModal();
}

function settleDebtLocally(debtId) {
  const idx = (appState.debts || []).findIndex((d) => Number(d.id) === Number(debtId));
  if (idx === -1) return;

  const debt = appState.debts[idx];
  debt.settled = true;
  debt.settledAmount = debt.amount;
  debt.amount = 0;

  appendLog(`تسوية وإغلاق ذمة "${debt.person}" (${formatNumber(debt.settledAmount, debt.currency)})`);
  archiveClosedItems(appState);
  saveStateToStorage();
  renderUI();
  showToast(`تمت تسوية ذمة ${debt.person} وأرشفتها`);
}

function settleAndArchiveProject(projName) {
  const proj = appState.projects[projName];
  if (!proj) return;

  proj.closed = true;
  appendLog(`إغلاق وأرشفة مشروع "${projName}"`);
  archiveClosedItems(appState);
  saveStateToStorage();
  renderUI();
  showToast(`تم إغلاق مشروع ${projName} وأرشفته`);
}

/**
 * ============================================================================
 * AI ASSISTANT BOTTOM SHEET & DEEPSEEK API
 * ============================================================================
 */

function openAIBottomSheet() {
  const sheet = document.getElementById('ai-bottom-sheet');
  if (sheet) sheet.classList.remove('hidden');
}

function closeAIBottomSheet() {
  const sheet = document.getElementById('ai-bottom-sheet');
  if (sheet) sheet.classList.add('hidden');
}

async function sendCommandToAI() {
  const inputEl = document.getElementById('ai-command-input');
  const commandText = inputEl ? inputEl.value.trim() : '';
  if (!commandText) {
    showToast('يرجى كتابة الأمر المحاسبي أولاً');
    return;
  }

  const apiKey = safeGetStorage(STORAGE_KEYS.API_KEY, '').trim();
  const apiUrl = safeGetStorage(STORAGE_KEYS.API_URL, DEFAULT_API_URL).trim() || DEFAULT_API_URL;

  if (!apiKey) {
    closeAIBottomSheet();
    openSettingsModal();
    showToast('يرجى إدخال مفتاح DeepSeek API في الإعدادات أولاً');
    return;
  }

  const loadingEl = document.getElementById('ai-loading-state');
  const replyContainer = document.getElementById('ai-reply-container');
  loadingEl.classList.remove('hidden');
  replyContainer.classList.add('hidden');

  try {
    const systemPrompt = buildSystemPrompt(appState);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: commandText }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`خطأ من خادم DeepSeek (${response.status}): ${errText.slice(0, 100)}`);
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content || '{}';
    const cleaned = String(rawContent)
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const aiResult = JSON.parse(cleaned);

    if (!aiResult || !aiResult.updated_state) {
      throw new Error('لم يُرجع الذكاء الاصطناعي كائن updated_state صالحاً.');
    }

    presentAIProposal(commandText, aiResult);
  } catch (err) {
    showToast(err.message || 'تعذر الاتصال بخدمة DeepSeek API');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function presentAIProposal(commandText, aiResult) {
  const validation = validateState(appState, aiResult.updated_state);
  pendingAIProposal = {
    commandText,
    reply: aiResult.reply || 'تمت معالجة العملية المحاسبية.',
    updated_state: aiResult.updated_state,
    validation
  };

  const replyContainer = document.getElementById('ai-reply-container');
  const replyTextEl = document.getElementById('ai-reply-text');
  const diffPreviewEl = document.getElementById('ai-diff-preview');
  const badgeEl = document.getElementById('ai-validation-badge');

  replyTextEl.textContent = pendingAIProposal.reply;

  if (validation.requiresConfirmation) {
    badgeEl.textContent = 'يتطلب تأكيد الحماية';
    badgeEl.className = 'badge-pill amber';
  } else {
    badgeEl.textContent = 'تم التحقق بأمان';
    badgeEl.className = 'badge-pill';
  }

  const allNotes = [...validation.warnings, ...validation.changes];
  if (allNotes.length === 0) {
    diffPreviewEl.innerHTML = `<div style="color:var(--text-muted);">لا توجد تغييرات في الأرصدة عن الحالة الحالية.</div>`;
  } else {
    diffPreviewEl.innerHTML = allNotes.map((line) => {
      const isWarn = line.startsWith('تنبيه:');
      return `<div style="${isWarn ? 'color:var(--amber-text); font-weight:700;' : 'color:var(--text-main);'}">• ${escapeHtml(line)}</div>`;
    }).join('');
  }

  replyContainer.classList.remove('hidden');
}

function discardAIReply() {
  pendingAIProposal = null;
  const replyContainer = document.getElementById('ai-reply-container');
  if (replyContainer) replyContainer.classList.add('hidden');
}

function approveAndApplyAIState() {
  if (!pendingAIProposal) return;

  const { validation } = pendingAIProposal;
  if (!validation.valid) {
    showToast(validation.error || 'بيانات غير صالحة');
    return;
  }

  if (validation.requiresConfirmation) {
    openValidationModal(validation.warnings);
    return;
  }

  commitValidatedAIState();
}

function openValidationModal(warnings) {
  const modal = document.getElementById('validation-confirm-modal');
  const listEl = document.getElementById('validation-warnings-list');
  if (!modal || !listEl) return;

  listEl.innerHTML = warnings.map((w) => `<div>• ${escapeHtml(w)}</div>`).join('');
  modal.classList.remove('hidden');
}

function closeValidationModal() {
  const modal = document.getElementById('validation-confirm-modal');
  if (modal) modal.classList.add('hidden');
}

function confirmApplyValidatedState() {
  closeValidationModal();
  commitValidatedAIState();
}

function commitValidatedAIState() {
  if (!pendingAIProposal) return;

  const incoming = pendingAIProposal.updated_state;
  const preservedArchive = appState.archive || { projects: {}, debts: [] };
  const preservedLogs = Array.isArray(appState.logs) ? [...appState.logs] : [];

  appState = normalizeStateSchema({
    ...incoming,
    logs: preservedLogs,
    archive: preservedArchive
  });

  appendLog(`${pendingAIProposal.commandText} — ${pendingAIProposal.reply}`);
  archiveClosedItems(appState);
  saveStateToStorage();
  renderUI();

  const inputEl = document.getElementById('ai-command-input');
  if (inputEl) inputEl.value = '';
  discardAIReply();
  closeAIBottomSheet();
  showToast('تم اعتماد التعديلات وحفظها');
}

/**
 * ============================================================================
 * LOGS & ARCHIVE MODAL
 * ============================================================================
 */

function openLogsModal() {
  const modal = document.getElementById('logs-archive-modal');
  if (!modal) return;
  renderLogsAndArchiveModal();
  modal.classList.remove('hidden');
}

function closeLogsModal() {
  const modal = document.getElementById('logs-archive-modal');
  if (modal) modal.classList.add('hidden');
}

function switchLogsModalTab(tab) {
  const logsView = document.getElementById('modal-view-logs');
  const archiveView = document.getElementById('modal-view-archive');
  const btnLogs = document.getElementById('modal-tab-logs');
  const btnArchive = document.getElementById('modal-tab-archive');

  if (tab === 'logs') {
    logsView.classList.remove('hidden');
    archiveView.classList.add('hidden');
    btnLogs.classList.add('active');
    btnArchive.classList.remove('active');
  } else {
    logsView.classList.add('hidden');
    archiveView.classList.remove('hidden');
    btnArchive.classList.add('active');
    btnLogs.classList.remove('active');
  }
}

function renderLogsAndArchiveModal() {
  const logsContainer = document.getElementById('modal-view-logs');
  const archProjContainer = document.getElementById('archive-projects-list');
  const archDebtsContainer = document.getElementById('archive-debts-list');

  const logs = appState.logs || [];
  if (logs.length === 0) {
    logsContainer.innerHTML = `<div class="empty-state-box">لا توجد عمليات مسجلة في السجل حتى الآن.</div>`;
  } else {
    logsContainer.innerHTML = logs.map((item, idx) => {
      const inContextWindow = idx < 3;
      return `
        <div class="log-row" style="flex-direction:column; align-items:stretch; gap:0.25rem;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
            <span style="font-weight:600; color:var(--text-main);">${escapeHtml(item.text)}</span>
            ${inContextWindow ? `<span class="badge-pill">سياق AI</span>` : ''}
          </div>
          <span class="num-ltr" style="font-size:0.65rem; color:var(--text-muted);">${escapeHtml(item.date)}</span>
        </div>
      `;
    }).join('');
  }

  const archProjects = Object.entries(appState.archive?.projects || {});
  if (archProjects.length === 0) {
    archProjContainer.innerHTML = `<div class="empty-state-box" style="padding:0.85rem;">لا توجد مشاريع مؤرشفة.</div>`;
  } else {
    archProjContainer.innerHTML = archProjects.map(([name, p]) => `
      <div class="log-row">
        <div>
          <div style="font-weight:700;">${escapeHtml(name)}</div>
          <div style="font-size:0.68rem; color:var(--text-muted);">${escapeHtml(p.summary || '')} | أُرشف: ${escapeHtml(p.archivedAt || '-')}</div>
        </div>
        <button type="button" onclick="restoreArchivedProject('${escapeHtml(name)}')" class="btn-secondary" style="font-size:0.68rem; padding:0.3rem 0.55rem;">استعادة</button>
      </div>
    `).join('');
  }

  const archDebts = appState.archive?.debts || [];
  if (archDebts.length === 0) {
    archDebtsContainer.innerHTML = `<div class="empty-state-box" style="padding:0.85rem;">لا توجد ديون مسددة في الأرشيف.</div>`;
  } else {
    archDebtsContainer.innerHTML = archDebts.map((d) => `
      <div class="log-row">
        <div>
          <div style="font-weight:700;">${escapeHtml(d.person)} (${escapeHtml(d.type || 'علينا')})</div>
          <div style="font-size:0.68rem; color:var(--text-muted);">المسدد: ${formatNumber(d.settledAmount || d.amount, d.currency || 'USD')} | ${escapeHtml(d.archivedAt || '-')}</div>
        </div>
      </div>
    `).join('');
  }
}

function restoreArchivedProject(projName) {
  const archived = appState.archive?.projects?.[projName];
  if (!archived) return;
  const restored = { ...archived };
  delete restored.closed;
  delete restored.archived;
  delete restored.archivedAt;
  appState.projects[projName] = restored;
  delete appState.archive.projects[projName];
  appendLog(`استعادة مشروع "${projName}" من الأرشيف`);
  saveStateToStorage();
  renderUI();
  renderLogsAndArchiveModal();
  showToast(`تمت استعادة مشروع ${projName}`);
}

function clearLogsAndArchiveLocally() {
  appState.logs = [];
  appState.archive = { projects: {}, debts: [] };
  saveStateToStorage();
  renderUI();
  renderLogsAndArchiveModal();
  showToast('تم مسح السجلات والأرشيف');
}

/**
 * ============================================================================
 * SETTINGS & PERMANENT FACTORY DATA WIPE
 * ============================================================================
 */

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  const keyInput = document.getElementById('input-api-key');
  const urlInput = document.getElementById('input-api-url');
  if (!modal) return;

  if (keyInput) keyInput.value = safeGetStorage(STORAGE_KEYS.API_KEY, '');
  if (urlInput) urlInput.value = safeGetStorage(STORAGE_KEYS.API_URL, DEFAULT_API_URL);

  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (modal) modal.classList.add('hidden');
}

function saveSettings() {
  const keyInput = document.getElementById('input-api-key');
  const urlInput = document.getElementById('input-api-url');

  if (keyInput) safeSetStorage(STORAGE_KEYS.API_KEY, keyInput.value.trim());
  if (urlInput) safeSetStorage(STORAGE_KEYS.API_URL, urlInput.value.trim() || DEFAULT_API_URL);

  closeSettingsModal();
  showToast('تم حفظ إعدادات الاتصال');
}

function openWipeConfirmModal() {
  closeSettingsModal();
  const modal = document.getElementById('wipe-confirm-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeWipeConfirmModal() {
  const modal = document.getElementById('wipe-confirm-modal');
  if (modal) modal.classList.add('hidden');
}

function executePermanentDataWipe() {
  safeRemoveStorage(STORAGE_KEYS.LEGACY_V1);
  safeRemoveStorage(STORAGE_KEYS.STATE);
  appState = getInitialCleanState();
  saveStateToStorage();
  renderUI();
  closeWipeConfirmModal();
  showToast('تم حذف وتصفير كافة البيانات نهائياً');
}

Object.assign(window, {
  initApp,
  toggleTheme,
  switchTab,
  openFxModal,
  openWalletModal,
  openWalletAdjustModal,
  deleteWalletLocally,
  openProjectModal,
  openProjectEditModal,
  deleteProjectLocally,
  openDebtModal,
  openDebtEditModal,
  deleteDebtLocally,
  closeHybridModal,
  submitHybridModal,
  settleDebtLocally,
  settleAndArchiveProject,
  openAIBottomSheet,
  closeAIBottomSheet,
  sendCommandToAI,
  discardAIReply,
  approveAndApplyAIState,
  closeValidationModal,
  confirmApplyValidatedState,
  openLogsModal,
  closeLogsModal,
  switchLogsModalTab,
  restoreArchivedProject,
  clearLogsAndArchiveLocally,
  openSettingsModal,
  closeSettingsModal,
  saveSettings,
  openWipeConfirmModal,
  closeWipeConfirmModal,
  executePermanentDataWipe
});

window.addEventListener('DOMContentLoaded', initApp);
