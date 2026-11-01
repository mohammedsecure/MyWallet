/**
 * My Wallet (محفظتي) - Hybrid State & AI Financial Architecture
 * Vanilla JavaScript Module for Browser & Capacitor.js Android Native APK
 */

const STORAGE_KEYS = {
  STATE: 'my_wallet_state_v1',
  API_KEY: 'my_wallet_deepseek_api_key',
  API_URL: 'my_wallet_deepseek_api_url',
  THEME: 'my_wallet_theme_mode'
};

const DEFAULT_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * Initial Default State matching Section 4 of My Wallet Architecture Guide
 */
function getInitialDefaultState() {
  return {
    fx_rate: 14500,
    wallets: {
      "كاش سوري": { amount: 150000, currency: "SYP" },
      "كاش دولار": { amount: 100, currency: "USD" }
    },
    projects: {
      "أعمال الأكريليك": { netSYP: 50000, netUSD: 0, summary: "أرباح الشهر" }
    },
    debts: [
      { id: 1, person: "العطار", amount: 50, currency: "USD", type: "علينا", note: "أمانة وساطة" }
    ],
    logs: [
      { date: "2026-10-16 14:30", text: "استلام أمانة العطار وخصم أجور الشحن" },
      { date: "2026-10-15 10:00", text: "عملية سابقة" }
    ],
    archive: {
      projects: {},
      debts: []
    }
  };
}

let appState = getInitialDefaultState();
let currentTab = 'wallets';
let pendingAIProposal = null;
let currentHybridContext = null;

/**
 * Safe LocalStorage Wrappers (Compatible with Sandboxed WebViews & Capacitor)
 */
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
    // Fallback in restricted memory mode
  }
}

/**
 * Format Current Date/Time as YYYY-MM-DD HH:mm
 */
function formatTimestamp(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Format Numeric Values Cleanly
 */
function formatNumber(num, currency = '') {
  const cleanNum = Number(num) || 0;
  const formatted = cleanNum.toLocaleString('en-US', {
    minimumFractionDigits: currency === 'USD' && cleanNum % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2
  });
  if (currency === 'USD') {
    return `$${formatted}`;
  }
  if (currency === 'SYP') {
    return `${formatted} SYP`;
  }
  return formatted;
}

/**
 * Escape HTML to prevent XSS when rendering user strings
 */
function escapeHtml(text) {
  const str = String(text ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Initialize State & Theme from LocalStorage
 */
function initApp() {
  const savedTheme = safeGetStorage(STORAGE_KEYS.THEME, 'light');
  applyThemeMode(savedTheme);

  const rawState = safeGetStorage(STORAGE_KEYS.STATE, null);
  if (rawState) {
    try {
      const parsed = JSON.parse(rawState);
      appState = normalizeStateSchema(parsed);
    } catch (e) {
      appState = getInitialDefaultState();
    }
  } else {
    appState = getInitialDefaultState();
    saveStateToStorage();
  }

  renderUI();
}

/**
 * Ensure State Schema Integrity
 */
function normalizeStateSchema(raw) {
  const fallback = getInitialDefaultState();
  if (!raw || typeof raw !== 'object') return fallback;

  return {
    fx_rate: Number(raw.fx_rate) > 0 ? Number(raw.fx_rate) : fallback.fx_rate,
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

/**
 * Persist State to LocalStorage
 */
function saveStateToStorage() {
  safeSetStorage(STORAGE_KEYS.STATE, JSON.stringify(appState));
}

/**
 * Add Operation Log Locally
 */
function appendLog(text) {
  if (!Array.isArray(appState.logs)) {
    appState.logs = [];
  }
  appState.logs.unshift({
    date: formatTimestamp(),
    text: text
  });
}

/**
 * Show Toast Notification
 */
let toastTimeoutId = null;
function showToast(message) {
  const banner = document.getElementById('toast-banner');
  const msgEl = document.getElementById('toast-message');
  if (!banner || !msgEl) return;

  msgEl.textContent = message;
  banner.classList.remove('hidden');
  banner.classList.add('flex');

  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    banner.classList.add('hidden');
    banner.classList.remove('flex');
  }, 3200);
}

/**
 * Theme Management (Light vs Dark OLED)
 */
function applyThemeMode(mode) {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
  safeSetStorage(STORAGE_KEYS.THEME, mode);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyThemeMode(isDark ? 'light' : 'dark');
}

/**
 * Switch Active View Tab
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

  const activeClasses = ['bg-[#065F46]', 'text-white', 'dark:bg-[#10B981]', 'dark:text-[#0A0F0D]', 'shadow-sm'];
  const inactiveClasses = ['text-slate-600', 'dark:text-slate-400'];

  [btnWallets, btnProjects, btnDebts].forEach((btn) => {
    if (!btn) return;
    btn.classList.remove(...activeClasses);
    btn.classList.add(...inactiveClasses);
  });

  if (tabName === 'wallets') {
    walletsPanel.classList.remove('hidden');
    projectsPanel.classList.add('hidden');
    btnWallets.classList.add(...activeClasses);
    btnWallets.classList.remove(...inactiveClasses);
  } else if (tabName === 'projects') {
    walletsPanel.classList.add('hidden');
    projectsPanel.classList.remove('hidden');
    subProjects.classList.remove('hidden');
    subDebts.classList.remove('hidden');
    btnProjects.classList.add(...activeClasses);
    btnProjects.classList.remove(...inactiveClasses);
  } else if (tabName === 'debts') {
    walletsPanel.classList.add('hidden');
    projectsPanel.classList.remove('hidden');
    subProjects.classList.add('hidden');
    subDebts.classList.remove('hidden');
    btnDebts.classList.add(...activeClasses);
    btnDebts.classList.remove(...inactiveClasses);
  }
}

/**
 * State Pruning & Auto-Archiving (archiveClosedItems)
 * Moves settled debts (amount <= 0 or settled: true) and closed projects to `archive`
 * so they are isolated from future AI API requests.
 */
function archiveClosedItems(targetState = appState) {
  if (!targetState.archive) {
    targetState.archive = { projects: {}, debts: [] };
  }
  if (!targetState.archive.projects) targetState.archive.projects = {};
  if (!Array.isArray(targetState.archive.debts)) targetState.archive.debts = [];

  const archivedItemsLog = [];

  // 1. Archive debts with amount <= 0 or settled === true
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
        archivedItemsLog.push(`أرشفة دين مسدد: ${debt.person}`);
      } else {
        remainingDebts.push(debt);
      }
    });
    targetState.debts = remainingDebts;
  }

  // 2. Archive projects explicitly flagged closed/archived or zeroed out after settlement
  if (targetState.projects && typeof targetState.projects === 'object') {
    Object.keys(targetState.projects).forEach((projName) => {
      const proj = targetState.projects[projName];
      if (proj && (proj.archived === true || proj.closed === true)) {
        targetState.archive.projects[projName] = {
          ...proj,
          archivedAt: formatTimestamp()
        };
        delete targetState.projects[projName];
        archivedItemsLog.push(`أرشفة مشروع مغلق: ${projName}`);
      }
    });
  }

  return archivedItemsLog;
}

/**
 * Build Pruned Context Object for DeepSeek AI
 * Rules:
 * 1. Exclude `archive` completely.
 * 2. Slice `logs` to ONLY the last 3 entries.
 */
function buildPrunedContextForAI(sourceState = appState) {
  const recentThreeLogs = Array.isArray(sourceState.logs)
    ? sourceState.logs.slice(0, 3)
    : [];

  return {
    fx_rate: Number(sourceState.fx_rate) || 14500,
    wallets: JSON.parse(JSON.stringify(sourceState.wallets || {})),
    projects: JSON.parse(JSON.stringify(sourceState.projects || {})),
    debts: JSON.parse(JSON.stringify(sourceState.debts || [])),
    logs: JSON.parse(JSON.stringify(recentThreeLogs))
  };
}

/**
 * Construct Strict System Prompt per Section 6 of Architecture Guide
 */
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
 * Validation & State Diffing Layer (validateState)
 * Inspects `updated_state` vs `currentState` to detect deleted wallets, projects, or debts.
 */
function validateState(currentState, updatedState) {
  const warnings = [];
  const changes = [];

  if (!updatedState || typeof updatedState !== 'object') {
    return {
      valid: false,
      requiresConfirmation: false,
      error: 'كائن updated_state القادم من الذكاء الاصطناعي غير صالح.',
      warnings: [],
      changes: []
    };
  }

  const curWallets = currentState.wallets || {};
  const newWallets = updatedState.wallets || {};

  // Check for deleted wallets (Exact alert message required by specification)
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

  // Check for deleted projects
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
        changes.push(`تحديث عوائد مشروع "${projName}": SYP (${formatNumber(oldSyp)} -> ${formatNumber(newSyp)}) | USD (${formatNumber(oldUsd, 'USD')} -> ${formatNumber(newUsd, 'USD')})`);
      }
    }
  });

  Object.keys(newProjects).forEach((projName) => {
    if (!Object.prototype.hasOwnProperty.call(curProjects, projName)) {
      changes.push(`إضافة مشروع جديد "${projName}"`);
    }
  });

  // Check for deleted debts
  const curDebts = Array.isArray(currentState.debts) ? currentState.debts : [];
  const newDebts = Array.isArray(updatedState.debts) ? updatedState.debts : [];
  curDebts.forEach((oldDebt) => {
    const match = newDebts.find((d) =>
      (d.id !== undefined && d.id === oldDebt.id) ||
      (d.person && d.person === oldDebt.person)
    );
    if (!match) {
      warnings.push(`تنبيه: هذا الإجراء سيحذف سجل الدين الخاص بـ [${oldDebt.person}] بالكامل، هل أنت متأكد؟`);
    } else if (Number(match.amount) !== Number(oldDebt.amount)) {
      changes.push(`تعديل ذمة "${oldDebt.person}": من ${formatNumber(oldDebt.amount, oldDebt.currency)} إلى ${formatNumber(match.amount, match.currency || oldDebt.currency)}`);
    }
  });

  newDebts.forEach((newDebt) => {
    const existed = curDebts.find((d) =>
      (d.id !== undefined && d.id === newDebt.id) ||
      (d.person && d.person === newDebt.person)
    );
    if (!existed) {
      changes.push(`إضافة ذمة جديدة (${newDebt.type || 'علينا'}): ${newDebt.person} بقيمة ${formatNumber(newDebt.amount, newDebt.currency || 'USD')}`);
    }
  });

  // Check FX Rate change
  if (Number(updatedState.fx_rate) && Number(updatedState.fx_rate) !== Number(currentState.fx_rate)) {
    changes.push(`تعديل سعر الصرف: من ${formatNumber(currentState.fx_rate)} إلى ${formatNumber(updatedState.fx_rate)} ل.س/$`);
  }

  return {
    valid: true,
    requiresConfirmation: warnings.length > 0,
    warnings,
    changes
  };
}

/**
 * Render Complete UI
 */
function renderUI() {
  const fx = Number(appState.fx_rate) || 14500;

  // 1. Update Header FX Rate & Logs Badge
  const fxEl = document.getElementById('header-fx-value');
  if (fxEl) fxEl.textContent = formatNumber(fx);

  const logsBadge = document.getElementById('logs-count-badge');
  if (logsBadge) logsBadge.textContent = String((appState.logs || []).length);

  // 2. Calculate & Render Top Financial Overview
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
  if (sumDebtsCountEl) sumDebtsCountEl.textContent = `${activeDebts.length} ذمم`;
  if (sumDebtsNetEl) {
    const sign = netDebtsUSD > 0 ? '+' : '';
    sumDebtsNetEl.textContent = `${sign}${formatNumber(netDebtsUSD, 'USD')}`;
  }

  // 3. Render Wallets Cards
  renderWalletsSection(fx);

  // 4. Render Projects & Debts Cards
  renderProjectsSection(fx);
  renderDebtsSection();

  // 5. Render Active Context Window Strip (Last 3 Logs)
  renderContextLogsStrip();
}

function renderWalletsSection(fx) {
  const grid = document.getElementById('wallets-grid');
  if (!grid) return;

  const entries = Object.entries(appState.wallets || {});
  if (entries.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full p-6 rounded-xl bg-white dark:bg-[#121A16] hairline-border text-center text-xs text-slate-500 dark:text-slate-400">
        لا توجد محافظ نشطة حالياً. يمكنك إضافة محفظة يدوياً أو عبر المساعد الذكي.
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
      <article class="p-4 rounded-xl bg-white dark:bg-[#121A16] hairline-border flex flex-col justify-between gap-4 hover:border-[#065F46]/50 dark:hover:border-[#10B981]/50 transition-colors">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border flex items-center justify-center text-[#065F46] dark:text-[#10B981]">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>
              </svg>
            </div>
            <div>
              <h3 class="text-sm font-bold text-[#1E293B] dark:text-slate-100">${safeName}</h3>
              <span class="text-[11px] text-slate-400 dark:text-slate-500">${equivalent}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950/10 text-[#065F46] dark:bg-emerald-500/10 dark:text-[#10B981]">${currency}</span>
        </div>

        <div class="pt-1">
          <div class="text-xl font-bold num-ltr text-[#1E293B] dark:text-white">${formatNumber(amount, currency)}</div>
        </div>

        <div class="pt-2 border-t border-slate-100 dark:border-[#1F2D27] flex items-center gap-1.5">
          <button type="button" onclick="openWalletAdjustModal('${safeName}', 'deposit')" class="flex-1 py-1.5 px-2 rounded-lg bg-emerald-950/5 hover:bg-emerald-950/10 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 text-[#065F46] dark:text-[#10B981] text-xs font-semibold transition-colors">
            + إيداع
          </button>
          <button type="button" onclick="openWalletAdjustModal('${safeName}', 'withdraw')" class="flex-1 py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-[#0A0F0D] dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors">
            - سحب
          </button>
          <button type="button" onclick="openWalletAdjustModal('${safeName}', 'set')" title="تعديل الرصيد المباشر" class="py-1.5 px-2.5 rounded-lg hairline-border text-slate-600 dark:text-slate-400 hover:text-[#065F46] dark:hover:text-[#10B981] text-xs font-semibold transition-colors">
            تعديل
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
      <div class="p-6 rounded-xl bg-white dark:bg-[#121A16] hairline-border text-center text-xs text-slate-500 dark:text-slate-400">
        لا توجد مشاريع نشطة حالياً. المشاريع المصفّرة تنتقل تلقائياً إلى الأرشيف.
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
      <article class="p-4 rounded-xl bg-white dark:bg-[#121A16] hairline-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-[#065F46] dark:bg-[#10B981]"></span>
            <h3 class="text-sm font-bold text-[#1E293B] dark:text-slate-100">${safeName}</h3>
            <span class="text-xs text-slate-500 dark:text-slate-400">— ${summary}</span>
          </div>
          <div class="flex flex-wrap items-center gap-3 pt-1">
            <div class="text-xs text-slate-500 dark:text-slate-400">
              صافي ل.س: <strong class="num-ltr text-[#1E293B] dark:text-slate-100">${formatNumber(netSYP)} SYP</strong>
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-400">
              صافي دولار: <strong class="num-ltr text-[#1E293B] dark:text-slate-100">${formatNumber(netUSD, 'USD')}</strong>
            </div>
            <div class="text-[11px] px-2 py-0.5 rounded bg-emerald-950/5 dark:bg-emerald-500/10 text-[#065F46] dark:text-[#10B981] font-medium">
              المحصلة المقومة: <span class="num-ltr font-bold">${formatNumber(Math.round(totalInSYP))} ل.س</span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button type="button" onclick="openProjectEditModal('${safeName}')" class="px-3 py-1.5 rounded-lg hairline-border text-xs font-semibold text-slate-700 dark:text-slate-300 hover:border-[#065F46] dark:hover:border-[#10B981]">
            تعديل العوائد
          </button>
          <button type="button" onclick="settleAndArchiveProject('${safeName}')" class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#065F46] hover:bg-[#047857] dark:bg-[#10B981] text-white dark:text-[#0A0F0D] text-xs font-bold transition-colors">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>إغلاق وأرشفة</span>
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
      <div class="p-6 rounded-xl bg-white dark:bg-[#121A16] hairline-border text-center text-xs text-slate-500 dark:text-slate-400">
        لا توجد ديون أو ذمم نشطة حالياً. جميع الذمم المسددة محفوظة في الأرشيف.
      </div>
    `;
    return;
  }

  listEl.innerHTML = debts.map((debt) => {
    const isLana = debt.type === 'لنا';
    const badgeClass = isLana
      ? 'bg-emerald-950/10 text-[#065F46] dark:bg-emerald-500/15 dark:text-[#10B981]'
      : 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
    const safePerson = escapeHtml(debt.person || 'غير مسمى');
    const safeNote = escapeHtml(debt.note || '');
    const currency = (debt.currency || 'USD').toUpperCase();

    return `
      <article class="p-4 rounded-xl bg-white dark:bg-[#121A16] hairline-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold ${badgeClass}">${escapeHtml(debt.type || 'علينا')}</span>
            <h3 class="text-sm font-bold text-[#1E293B] dark:text-slate-100">${safePerson}</h3>
            <span class="text-xs font-mono font-bold num-ltr text-[#065F46] dark:text-[#10B981]">${formatNumber(debt.amount, currency)}</span>
          </div>
          ${safeNote ? `<p class="text-xs text-slate-500 dark:text-slate-400">${safeNote}</p>` : ''}
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button type="button" onclick="openDebtEditModal(${Number(debt.id)})" class="px-3 py-1.5 rounded-lg hairline-border text-xs font-semibold text-slate-700 dark:text-slate-300 hover:border-[#065F46] dark:hover:border-[#10B981]">
            تعديل
          </button>
          <button type="button" onclick="settleDebtLocally(${Number(debt.id)})" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#065F46] hover:bg-[#047857] dark:bg-[#10B981] text-white dark:text-[#0A0F0D] text-xs font-bold transition-colors">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>تسوية / إغلاق</span>
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
    container.innerHTML = `<div class="text-xs text-slate-400">لا توجد حركات مسجلة بعد.</div>`;
    return;
  }

  container.innerHTML = recentThree.map((item, idx) => `
    <div class="flex items-center justify-between gap-2 py-1 px-2 rounded bg-[#F8FAF9] dark:bg-[#0A0F0D]">
      <div class="flex items-center gap-2 truncate">
        <span class="w-4 h-4 rounded-full bg-emerald-950/10 dark:bg-emerald-500/15 text-[#065F46] dark:text-[#10B981] font-mono text-[10px] font-bold flex items-center justify-center shrink-0">${idx + 1}</span>
        <span class="truncate text-[#1E293B] dark:text-slate-300">${escapeHtml(item.text)}</span>
      </div>
      <span class="text-[11px] font-mono text-slate-400 shrink-0 num-ltr">${escapeHtml(item.date)}</span>
    </div>
  `).join('');
}

/**
 * ============================================================================
 * HYBRID LOCAL OPERATIONS (Immediate Frontend Execution without AI API Calls)
 * ============================================================================
 */

function openFxModal() {
  currentHybridContext = { type: 'fx' };
  const titleEl = document.getElementById('hybrid-modal-title');
  const fieldsEl = document.getElementById('hybrid-modal-fields');
  titleEl.textContent = 'تحديث سعر الصرف الحي (SYP / USD)';
  fieldsEl.innerHTML = `
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">سعر صرف الدولار الواحد بالليرة السورية:</label>
      <input id="hybrid-fx-input" type="number" step="any" min="1" required value="${Number(appState.fx_rate) || 14500}" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-sm font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
    </div>
  `;
  showHybridModal();
}

function openWalletModal() {
  currentHybridContext = { type: 'new_wallet' };
  const titleEl = document.getElementById('hybrid-modal-title');
  const fieldsEl = document.getElementById('hybrid-modal-fields');
  titleEl.textContent = 'إضافة محفظة نقدية جديدة';
  fieldsEl.innerHTML = `
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">اسم المحفظة:</label>
      <input id="hybrid-wallet-name" type="text" required placeholder="مثال: حساب بنك البركة" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">العملة:</label>
        <select id="hybrid-wallet-currency" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono text-[#1E293B] dark:text-slate-100">
          <option value="SYP">SYP (ليرة سورية)</option>
          <option value="USD">USD (دولار أمريكي)</option>
        </select>
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">الرصيد الافتتاحي:</label>
        <input id="hybrid-wallet-amount" type="number" step="any" required value="0" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
      </div>
    </div>
  `;
  showHybridModal();
}

function openWalletAdjustModal(walletName, mode) {
  const wallet = appState.wallets[walletName];
  if (!wallet) return;

  currentHybridContext = { type: 'adjust_wallet', walletName, mode };
  const titleEl = document.getElementById('hybrid-modal-title');
  const fieldsEl = document.getElementById('hybrid-modal-fields');

  const modeLabels = {
    deposit: `إيداع سريع في "${walletName}"`,
    withdraw: `سحب سريع من "${walletName}"`,
    set: `تعديل الرصيد المباشر لـ "${walletName}"`
  };
  titleEl.textContent = modeLabels[mode] || 'تعديل المحفظة';

  const defaultVal = mode === 'set' ? Number(wallet.amount) || 0 : '';
  const amountLabel = mode === 'set'
    ? `الرصيد الجديد (${wallet.currency}):`
    : `المبلغ المراد ${mode === 'deposit' ? 'إيداعه' : 'سحبه'} (${wallet.currency}):`;

  fieldsEl.innerHTML = `
    <div class="p-2.5 rounded-lg bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs flex justify-between">
      <span class="text-slate-500">الرصيد الحالي:</span>
      <strong class="num-ltr text-[#065F46] dark:text-[#10B981]">${formatNumber(wallet.amount, wallet.currency)}</strong>
    </div>
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">${amountLabel}</label>
      <input id="hybrid-adjust-amount" type="number" step="any" required value="${defaultVal}" placeholder="0" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-sm font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
    </div>
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">بيان الحركة (يُحفظ في السجل):</label>
      <input id="hybrid-adjust-note" type="text" placeholder="عملية يدوية سريعة" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
    </div>
  `;
  showHybridModal();
}

function openProjectModal() {
  currentHybridContext = { type: 'new_project' };
  const titleEl = document.getElementById('hybrid-modal-title');
  const fieldsEl = document.getElementById('hybrid-modal-fields');
  titleEl.textContent = 'إضافة مشروع جديد';
  fieldsEl.innerHTML = `
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">اسم المشروع:</label>
      <input id="hybrid-proj-name" type="text" required placeholder="مثال: تجارة القطع الإلكترونية" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">صافي SYP:</label>
        <input id="hybrid-proj-syp" type="number" step="any" value="0" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">صافي USD:</label>
        <input id="hybrid-proj-usd" type="number" step="any" value="0" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
      </div>
    </div>
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">ملخص المشروع:</label>
      <input id="hybrid-proj-summary" type="text" placeholder="أرباح التشغيل" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
    </div>
  `;
  showHybridModal();
}

function openProjectEditModal(projName) {
  const proj = appState.projects[projName];
  if (!proj) return;

  currentHybridContext = { type: 'edit_project', projName };
  const titleEl = document.getElementById('hybrid-modal-title');
  const fieldsEl = document.getElementById('hybrid-modal-fields');
  titleEl.textContent = `تعديل عوائد مشروع "${projName}"`;
  fieldsEl.innerHTML = `
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">صافي SYP:</label>
        <input id="hybrid-proj-syp" type="number" step="any" required value="${Number(proj.netSYP) || 0}" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">صافي USD:</label>
        <input id="hybrid-proj-usd" type="number" step="any" required value="${Number(proj.netUSD) || 0}" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
      </div>
    </div>
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">ملخص المشروع:</label>
      <input id="hybrid-proj-summary" type="text" value="${escapeHtml(proj.summary || '')}" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
    </div>
  `;
  showHybridModal();
}

function openDebtModal() {
  currentHybridContext = { type: 'new_debt' };
  const titleEl = document.getElementById('hybrid-modal-title');
  const fieldsEl = document.getElementById('hybrid-modal-fields');
  titleEl.textContent = 'تسجيل دين أو ذمة مالية جديدة';
  fieldsEl.innerHTML = `
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">الطرف / الشخص:</label>
        <input id="hybrid-debt-person" type="text" required placeholder="اسم الشخص أو الجهة" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">نوع الذمة:</label>
        <select id="hybrid-debt-type" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100">
          <option value="علينا">علينا (التزام للدفع)</option>
          <option value="لنا">لنا (مستحق للقبض)</option>
        </select>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">المبلغ:</label>
        <input id="hybrid-debt-amount" type="number" step="any" min="0.01" required placeholder="50" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">العملة:</label>
        <select id="hybrid-debt-currency" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono text-[#1E293B] dark:text-slate-100">
          <option value="USD">USD</option>
          <option value="SYP">SYP</option>
        </select>
      </div>
    </div>
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">ملاحظة توضيحية:</label>
      <input id="hybrid-debt-note" type="text" placeholder="مثال: أمانة بضاعة" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
    </div>
  `;
  showHybridModal();
}

function openDebtEditModal(debtId) {
  const debt = (appState.debts || []).find((d) => Number(d.id) === Number(debtId));
  if (!debt) return;

  currentHybridContext = { type: 'edit_debt', debtId: Number(debtId) };
  const titleEl = document.getElementById('hybrid-modal-title');
  const fieldsEl = document.getElementById('hybrid-modal-fields');
  titleEl.textContent = `تعديل ذمة "${debt.person}"`;
  fieldsEl.innerHTML = `
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">المبلغ المتبقي:</label>
        <input id="hybrid-debt-amount" type="number" step="any" required value="${Number(debt.amount) || 0}" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs font-mono num-ltr text-[#1E293B] dark:text-slate-100" />
      </div>
      <div>
        <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">نوع الذمة:</label>
        <select id="hybrid-debt-type" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100">
          <option value="علينا" ${debt.type === 'علينا' ? 'selected' : ''}>علينا</option>
          <option value="لنا" ${debt.type === 'لنا' ? 'selected' : ''}>لنا</option>
        </select>
      </div>
    </div>
    <div>
      <label class="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">ملاحظة:</label>
      <input id="hybrid-debt-note" type="text" value="${escapeHtml(debt.note || '')}" class="w-full px-3 py-2 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border text-xs text-[#1E293B] dark:text-slate-100" />
    </div>
  `;
  showHybridModal();
}

function showHybridModal() {
  const modal = document.getElementById('hybrid-action-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeHybridModal() {
  const modal = document.getElementById('hybrid-action-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
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
      appendLog(`تحديث يدوي لسعر الصرف إلى ${formatNumber(newFx)} ل.س/$`);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث سعر الصرف محلياً');
    }
  } else if (ctx.type === 'new_wallet') {
    const name = document.getElementById('hybrid-wallet-name').value.trim();
    const currency = document.getElementById('hybrid-wallet-currency').value;
    const amount = Number(document.getElementById('hybrid-wallet-amount').value) || 0;
    if (name) {
      appState.wallets[name] = { amount, currency };
      appendLog(`إنشاء محفظة جديدة "${name}" برصيد ${formatNumber(amount, currency)}`);
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
      appendLog(`${actionLabel} محفظة "${ctx.walletName}" (${formatNumber(val, wallet.currency)})${note ? ' - ' + note : ''}`);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث رصيد المحفظة فوراً');
    }
  } else if (ctx.type === 'new_project') {
    const name = document.getElementById('hybrid-proj-name').value.trim();
    const netSYP = Number(document.getElementById('hybrid-proj-syp').value) || 0;
    const netUSD = Number(document.getElementById('hybrid-proj-usd').value) || 0;
    const summary = document.getElementById('hybrid-proj-summary').value.trim() || 'مشروع نشط';
    if (name) {
      appState.projects[name] = { netSYP, netUSD, summary };
      appendLog(`إضافة مشروع "${name}" (${summary})`);
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
      appendLog(`تعديل يدوي لعوائد مشروع "${ctx.projName}"`);
      archiveClosedItems(appState);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث المشروع محلياً');
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
      appendLog(`تسجيل ذمة جديدة (${type}) لـ "${person}" بقيمة ${formatNumber(amount, currency)}`);
      saveStateToStorage();
      renderUI();
      showToast('تم تسجيل الذمة محلياً');
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
      showToast('تم تحديث الذمة وتدقيق الأرشيف');
    }
  }

  closeHybridModal();
}

/**
 * Direct Hybrid Settlement & Archiving for Debts & Projects
 */
function settleDebtLocally(debtId) {
  const idx = (appState.debts || []).findIndex((d) => Number(d.id) === Number(debtId));
  if (idx === -1) return;

  const debt = appState.debts[idx];
  debt.settled = true;
  debt.settledAmount = debt.amount;
  debt.amount = 0;

  appendLog(`تسوية وإغلاق ذمة "${debt.person}" (${formatNumber(debt.settledAmount, debt.currency)}) ونقلها إلى الأرشيف`);
  archiveClosedItems(appState);
  saveStateToStorage();
  renderUI();
  showToast(`تمت تسوية ذمة ${debt.person} وأرشفتها محلياً`);
}

function settleAndArchiveProject(projName) {
  const proj = appState.projects[projName];
  if (!proj) return;

  proj.closed = true;
  appendLog(`إغلاق وأرشفة مشروع "${projName}" بصافي (${formatNumber(proj.netSYP)} ل.س / ${formatNumber(proj.netUSD, 'USD')})`);
  archiveClosedItems(appState);
  saveStateToStorage();
  renderUI();
  showToast(`تم إغلاق مشروع ${projName} ونقله للأرشيف`);
}

/**
 * ============================================================================
 * AI ASSISTANT BOTTOM SHEET & DEEPSEEK API INTEGRATION
 * ============================================================================
 */

function openAIBottomSheet() {
  const sheet = document.getElementById('ai-bottom-sheet');
  if (!sheet) return;
  sheet.classList.remove('hidden');
  updatePayloadInspector();
}

function closeAIBottomSheet() {
  const sheet = document.getElementById('ai-bottom-sheet');
  if (!sheet) return;
  sheet.classList.add('hidden');
}

function fillSamplePrompt(sampleText) {
  const input = document.getElementById('ai-command-input');
  if (!input) return;
  input.value = sampleText;
  input.focus();
}

function togglePromptInspector() {
  const inspector = document.getElementById('ai-payload-inspector');
  if (!inspector) return;
  inspector.classList.toggle('hidden');
  updatePayloadInspector();
}

function updatePayloadInspector() {
  const inspector = document.getElementById('ai-payload-inspector');
  if (!inspector) return;
  const pruned = buildPrunedContextForAI(appState);
  inspector.textContent = JSON.stringify(pruned, null, 2);
}

/**
 * Send Natural Language Command to DeepSeek API (or Intelligent Local Parser in Demo Mode)
 */
async function sendCommandToAI(forceLocalSimulation = false) {
  const inputEl = document.getElementById('ai-command-input');
  const commandText = inputEl ? inputEl.value.trim() : '';
  if (!commandText) {
    showToast('يرجى كتابة الأمر المحاسبي أولاً');
    return;
  }

  const loadingEl = document.getElementById('ai-loading-state');
  const replyContainer = document.getElementById('ai-reply-container');
  loadingEl.classList.remove('hidden');
  replyContainer.classList.add('hidden');

  const apiKey = safeGetStorage(STORAGE_KEYS.API_KEY, '').trim();
  const apiUrl = safeGetStorage(STORAGE_KEYS.API_URL, DEFAULT_API_URL).trim() || DEFAULT_API_URL;

  try {
    let aiResult = null;

    if (!forceLocalSimulation && apiKey) {
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
        throw new Error(`خطأ من خادم DeepSeek (${response.status}): ${errText.slice(0, 120)}`);
      }

      const data = await response.json();
      const rawContent = data?.choices?.[0]?.message?.content || '{}';
      aiResult = parseAIJsonSafely(rawContent);
    } else {
      // Intelligent Local Accounting Simulator when no API key is configured or simulation requested
      await new Promise((r) => setTimeout(r, 450));
      aiResult = simulateSmartAccountingAI(commandText, appState);
    }

    if (!aiResult || !aiResult.updated_state) {
      throw new Error('لم يُرجع النموذج كائن updated_state صالحاً.');
    }

    presentAIProposal(commandText, aiResult);
  } catch (err) {
    showToast(err.message || 'تعذر الاتصال بالمساعد الذكي');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function parseAIJsonSafely(rawContent) {
  const cleaned = String(rawContent)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

/**
 * Built-in Smart Accounting Interpreter for Local Testing & Offline Fallback
 */
function simulateSmartAccountingAI(commandText, currentState) {
  const nextState = buildPrunedContextForAI(currentState);
  const replies = [];

  // 1. Check for wallet deletion request (to demonstrate Validation Layer protection)
  Object.keys(nextState.wallets).forEach((wName) => {
    if ((commandText.includes('احذف') || commandText.includes('حذف')) && commandText.includes(wName)) {
      delete nextState.wallets[wName];
      replies.push(`تم حذف محفظة "${wName}" من الحالة المقترحة بناءً على طلبك.`);
    }
  });

  // 2. Check for exchange rate update
  const fxMatch = commandText.match(/(?:سعر الصرف|الصرف)(?:\s+إلى|\s+هو|\s*=\s*|\s+)(\d{3,6})/);
  if (fxMatch) {
    const newRate = Number(fxMatch[1]);
    if (newRate > 0) {
      nextState.fx_rate = newRate;
      replies.push(`تم تحديث سعر الصرف إلى ${formatNumber(newRate)} ل.س/$.`);
    }
  }

  // 3. Check for currency conversion (e.g. صرفنا 20 دولار من كاش دولار إلى كاش سوري)
  const convertMatch = commandText.match(/صرفنا\s+(\d+(?:\.\d+)?)\s*دولار/);
  if (convertMatch && nextState.wallets["كاش دولار"] && nextState.wallets["كاش سوري"]) {
    const usdAmt = Number(convertMatch[1]);
    const sypEquivalent = usdAmt * nextState.fx_rate;
    nextState.wallets["كاش دولار"].amount = (Number(nextState.wallets["كاش دولار"].amount) || 0) - usdAmt;
    nextState.wallets["كاش سوري"].amount = (Number(nextState.wallets["كاش سوري"].amount) || 0) + sypEquivalent;
    replies.push(`تم خصم ${formatNumber(usdAmt, 'USD')} من "كاش دولار" وإيداع ما يعادلها (${formatNumber(sypEquivalent)} ل.س) في "كاش سوري" بسعر صرف ${formatNumber(nextState.fx_rate)}.`);
  }

  // 4. Check for Acrylic project revenue
  if (commandText.includes('الأكريليك') && commandText.match(/(\d{4,9})/)) {
    const numMatch = commandText.match(/(\d{4,9})/);
    const amountSYP = Number(numMatch[1]);
    if (!nextState.projects["أعمال الأكريليك"]) {
      nextState.projects["أعمال الأكريليك"] = { netSYP: 0, netUSD: 0, summary: "أرباح الشهر" };
    }
    nextState.projects["أعمال الأكريليك"].netSYP = (Number(nextState.projects["أعمال الأكريليك"].netSYP) || 0) + amountSYP;
    if (nextState.wallets["كاش سوري"]) {
      nextState.wallets["كاش سوري"].amount = (Number(nextState.wallets["كاش سوري"].amount) || 0) + amountSYP;
    }
    replies.push(`تمت إضافة ${formatNumber(amountSYP)} ل.س إلى صافي أرباح مشروع "أعمال الأكريليك" وإيداع المبلغ في محفظة "كاش سوري".`);
  }

  // 5. Check for debt settlement to العطار
  if (commandText.includes('العطار')) {
    const numMatch = commandText.match(/(\d+(?:\.\d+)?)\s*(?:دولار|USD)/i);
    const paidUsd = numMatch ? Number(numMatch[1]) : 0;
    const debtItem = nextState.debts.find((d) => d.person.includes('العطار'));
    if (debtItem && paidUsd > 0) {
      debtItem.amount = Math.max(0, (Number(debtItem.amount) || 0) - paidUsd);
      if (nextState.wallets["كاش دولار"]) {
        nextState.wallets["كاش دولار"].amount = (Number(nextState.wallets["كاش دولار"].amount) || 0) - paidUsd;
      }
      replies.push(`تم سداد ${formatNumber(paidUsd, 'USD')} من ذمة "العطار" وخصمها من محفظة "كاش دولار" (المتبقي: ${formatNumber(debtItem.amount, 'USD')}).`);
    }
  }

  // 6. Generic fallback arithmetic if another pattern was entered
  if (replies.length === 0) {
    const anyNum = commandText.match(/(\d+(?:\.\d+)?)/);
    const isUSD = /دولار|USD|\$/i.test(commandText);
    const isExpense = /دفعت|صرفنا|خصم|سحب|اشترينا/i.test(commandText);
    if (anyNum) {
      const val = Number(anyNum[1]);
      const targetWallet = isUSD ? "كاش دولار" : "كاش سوري";
      if (nextState.wallets[targetWallet]) {
        const delta = isExpense ? -val : val;
        nextState.wallets[targetWallet].amount = (Number(nextState.wallets[targetWallet].amount) || 0) + delta;
        replies.push(`تم ${isExpense ? 'خصم' : 'إيداع'} مبلغ ${formatNumber(val, isUSD ? 'USD' : 'SYP')} في محفظة "${targetWallet}" وتحديث الرصيد.`);
      }
    } else {
      replies.push(`تمت قراءة الأمر المحاسبي ("${commandText}") ومراجعة الأرصدة النشطة دون رصد تغييرات رقمية إضافية.`);
    }
  }

  return {
    reply: replies.join(' '),
    updated_state: nextState
  };
}

/**
 * Display AI Reply & Diff Summary inside Bottom Sheet
 */
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
    badgeEl.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold';
  } else {
    badgeEl.textContent = 'تم التحقق بأمان';
    badgeEl.className = 'text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-[#065F46] dark:text-[#10B981] font-semibold';
  }

  const allNotes = [...validation.warnings, ...validation.changes];
  if (allNotes.length === 0) {
    diffPreviewEl.innerHTML = `<div class="text-slate-400">لا توجد فروقات جوهرية في الأرصدة عن الحالة الحالية.</div>`;
  } else {
    diffPreviewEl.innerHTML = allNotes.map((line) => {
      const isWarn = line.startsWith('تنبيه:');
      return `<div class="${isWarn ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-slate-600 dark:text-slate-300'}">• ${escapeHtml(line)}</div>`;
    }).join('');
  }

  replyContainer.classList.remove('hidden');
}

function discardAIReply() {
  pendingAIProposal = null;
  const replyContainer = document.getElementById('ai-reply-container');
  if (replyContainer) replyContainer.classList.add('hidden');
}

/**
 * Approve & Apply Button Handler:
 * 1. Runs State Diffing & Validation (`validateState`).
 * 2. If any wallet/project/debt deletion is detected, opens confirmation warning modal.
 * 3. Otherwise commits state, logs operation, archives closed items, saves to LocalStorage, and re-renders.
 */
function approveAndApplyAIState() {
  if (!pendingAIProposal) return;

  const { validation } = pendingAIProposal;
  if (!validation.valid) {
    showToast(validation.error || 'بيانات الحالة الجديدة غير صالحة');
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
  modal.classList.add('flex');
}

function closeValidationModal() {
  const modal = document.getElementById('validation-confirm-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function confirmApplyValidatedState() {
  closeValidationModal();
  commitValidatedAIState();
}

/**
 * Final Commit Step after Validation Passes or User Confirms
 */
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

  // Append operation to logs
  appendLog(`${pendingAIProposal.commandText} — ${pendingAIProposal.reply}`);

  // Auto-archive any zeroed/settled items
  archiveClosedItems(appState);

  // Persist to LocalStorage
  saveStateToStorage();

  // Refresh UI
  renderUI();

  // Clean up bottom sheet state
  const inputEl = document.getElementById('ai-command-input');
  if (inputEl) inputEl.value = '';
  discardAIReply();
  closeAIBottomSheet();
  showToast('تم اعتماد الحالة الجديدة وحفظها بنجاح');
}

/**
 * ============================================================================
 * LOGS & ARCHIVE MODAL MANAGEMENT
 * ============================================================================
 */

function openLogsModal() {
  const modal = document.getElementById('logs-archive-modal');
  if (!modal) return;
  renderLogsAndArchiveModal();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeLogsModal() {
  const modal = document.getElementById('logs-archive-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function switchLogsModalTab(tab) {
  const logsView = document.getElementById('modal-view-logs');
  const archiveView = document.getElementById('modal-view-archive');
  const btnLogs = document.getElementById('modal-tab-logs');
  const btnArchive = document.getElementById('modal-tab-archive');

  if (tab === 'logs') {
    logsView.classList.remove('hidden');
    archiveView.classList.add('hidden');
    btnLogs.className = 'pb-2.5 px-3 text-xs font-bold border-b-2 border-[#065F46] dark:border-[#10B981] text-[#065F46] dark:text-[#10B981]';
    btnArchive.className = 'pb-2.5 px-3 text-xs font-bold border-b-2 border-transparent text-slate-500 dark:text-slate-400';
  } else {
    logsView.classList.add('hidden');
    archiveView.classList.remove('hidden');
    btnArchive.className = 'pb-2.5 px-3 text-xs font-bold border-b-2 border-[#065F46] dark:border-[#10B981] text-[#065F46] dark:text-[#10B981]';
    btnLogs.className = 'pb-2.5 px-3 text-xs font-bold border-b-2 border-transparent text-slate-500 dark:text-slate-400';
  }
}

function renderLogsAndArchiveModal() {
  const logsContainer = document.getElementById('modal-view-logs');
  const archProjContainer = document.getElementById('archive-projects-list');
  const archDebtsContainer = document.getElementById('archive-debts-list');

  const logs = appState.logs || [];
  if (logs.length === 0) {
    logsContainer.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">لا توجد سجلات محفوظة.</div>`;
  } else {
    logsContainer.innerHTML = logs.map((item, idx) => {
      const inContextWindow = idx < 3;
      return `
        <div class="p-3 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border flex items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-[#1E293B] dark:text-slate-200">${escapeHtml(item.text)}</span>
              ${inContextWindow ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-[#065F46] dark:text-[#10B981] font-mono">ضمن سياق AI</span>` : ''}
            </div>
            <div class="text-[11px] font-mono text-slate-400 num-ltr">${escapeHtml(item.date)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  const archProjects = Object.entries(appState.archive?.projects || {});
  if (archProjects.length === 0) {
    archProjContainer.innerHTML = `<div class="p-3 rounded-lg bg-[#F8FAF9] dark:bg-[#0A0F0D] text-xs text-slate-400">لا توجد مشاريع مؤرشفة بعد.</div>`;
  } else {
    archProjContainer.innerHTML = archProjects.map(([name, p]) => `
      <div class="p-3 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border flex items-center justify-between">
        <div>
          <div class="text-xs font-bold text-[#1E293B] dark:text-slate-200">${escapeHtml(name)}</div>
          <div class="text-[11px] text-slate-400">${escapeHtml(p.summary || '')} | أُرشف: ${escapeHtml(p.archivedAt || '-')}</div>
        </div>
        <button type="button" onclick="restoreArchivedProject('${escapeHtml(name)}')" class="px-2.5 py-1 rounded hairline-border text-[11px] font-semibold text-[#065F46] dark:text-[#10B981]">استعادة للنشط</button>
      </div>
    `).join('');
  }

  const archDebts = appState.archive?.debts || [];
  if (archDebts.length === 0) {
    archDebtsContainer.innerHTML = `<div class="p-3 rounded-lg bg-[#F8FAF9] dark:bg-[#0A0F0D] text-xs text-slate-400">لا توجد ديون مسددة في الأرشيف بعد.</div>`;
  } else {
    archDebtsContainer.innerHTML = archDebts.map((d, index) => `
      <div class="p-3 rounded-xl bg-[#F8FAF9] dark:bg-[#0A0F0D] hairline-border flex items-center justify-between">
        <div>
          <div class="text-xs font-bold text-[#1E293B] dark:text-slate-200">${escapeHtml(d.person)} (${escapeHtml(d.type || 'علينا')})</div>
          <div class="text-[11px] text-slate-400">القيمة المسددة: ${formatNumber(d.settledAmount || d.amount, d.currency || 'USD')} | أُرشف: ${escapeHtml(d.archivedAt || '-')}</div>
        </div>
        <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">#${index + 1}</span>
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
  appendLog(`استعادة مشروع "${projName}" من الأرشيف إلى الحالة النشطة`);
  saveStateToStorage();
  renderUI();
  renderLogsAndArchiveModal();
  showToast(`تمت استعادة مشروع ${projName}`);
}

/**
 * ============================================================================
 * SETTINGS MODAL (API Key & State Reset)
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
  modal.classList.add('flex');
}

function closeSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function saveSettings() {
  const keyInput = document.getElementById('input-api-key');
  const urlInput = document.getElementById('input-api-url');

  if (keyInput) safeSetStorage(STORAGE_KEYS.API_KEY, keyInput.value.trim());
  if (urlInput) safeSetStorage(STORAGE_KEYS.API_URL, urlInput.value.trim() || DEFAULT_API_URL);

  closeSettingsModal();
  showToast('تم حفظ إعدادات DeepSeek API محلياً');
}

function resetToDefaultState() {
  appState = getInitialDefaultState();
  saveStateToStorage();
  renderUI();
  closeSettingsModal();
  showToast('تمت استعادة الحالة الافتراضية للتطبيق');
}

// Expose handlers globally for HTML attributes & initialize on DOM load
Object.assign(window, {
  initApp,
  toggleTheme,
  switchTab,
  openFxModal,
  openWalletModal,
  openWalletAdjustModal,
  openProjectModal,
  openProjectEditModal,
  openDebtModal,
  openDebtEditModal,
  closeHybridModal,
  submitHybridModal,
  settleDebtLocally,
  settleAndArchiveProject,
  openAIBottomSheet,
  closeAIBottomSheet,
  fillSamplePrompt,
  togglePromptInspector,
  sendCommandToAI,
  discardAIReply,
  approveAndApplyAIState,
  closeValidationModal,
  confirmApplyValidatedState,
  openLogsModal,
  closeLogsModal,
  switchLogsModalTab,
  restoreArchivedProject,
  openSettingsModal,
  closeSettingsModal,
  saveSettings,
  resetToDefaultState
});

window.addEventListener('DOMContentLoaded', initApp);
