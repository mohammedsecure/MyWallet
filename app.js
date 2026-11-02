/**
 * My Wallet v1.3 (محفظتي)
 * - Complete Currency Separation (No * fx or / fx merging in cards/summaries)
 * - 2 Top Summary Cards Only (Total Cash SYP & Total Cash USD)
 * - Dedicated Independent Tabs (Wallets | Projects & Monthly Flow | Debts)
 * - Live Instant FX Calculator inside Exchange Rate Modal
 * - Monthly Financial Flow System (monthly_flow: income & expenses + Archive Month)
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
    monthly_flow: {
      income: {
        totalSYP: 0,
        totalUSD: 0,
        items: []
      },
      expenses: {
        totalSYP: 0,
        totalUSD: 0,
        items: []
      }
    },
    logs: [],
    archive: {
      projects: {},
      debts: [],
      monthly_flow: []
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

function normalizeCurrencyCode(rawCur, hintText = '', fallback = 'SYP') {
  const str = String(rawCur || '').trim().toUpperCase();
  if (str === 'USD' || str === '$' || str.includes('دولار') || str.includes('DOLLAR')) {
    return 'USD';
  }
  if (str === 'SYP' || str.includes('ل.س') || str.includes('ليرة') || str.includes('سوري')) {
    return 'SYP';
  }
  const hint = String(hintText || '');
  if (hint.includes('دولار') || hint.toUpperCase().includes('USD') || hint.includes('$')) {
    return 'USD';
  }
  if (hint.includes('ليرة') || hint.includes('سوري') || hint.toUpperCase().includes('SYP')) {
    return 'SYP';
  }
  return fallback;
}

function normalizeDebtType(rawType) {
  const str = String(rawType || '').trim();
  if (str === 'لنا' || str.includes('لنا') || str.includes('مستحق لنا') || str.includes('مدين لنا')) {
    return 'لنا';
  }
  return 'علينا';
}

/**
 * Helper to normalize a branch of `monthly_flow` (`income` or `expenses`)
 */
function normalizeFlowBranch(rawBranch) {
  const result = { totalSYP: 0, totalUSD: 0, items: [] };
  if (!rawBranch) return result;

  if (typeof rawBranch === 'number') {
    result.totalSYP = Number(rawBranch) || 0;
    return result;
  }

  if (Array.isArray(rawBranch)) {
    rawBranch.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const amt = Number(item.amount ?? item.value ?? 0) || 0;
      const cur = normalizeCurrencyCode(item.currency, item.title || item.note || '', 'SYP');
      const title = String(item.title ?? item.name ?? item.category ?? item.note ?? 'بند مالي').trim();
      if (amt > 0) {
        result.items.push({
          id: Number(item.id) || (idx + 1),
          title,
          amount: amt,
          currency: cur,
          date: String(item.date || formatTimestamp())
        });
      }
    });
  } else if (typeof rawBranch === 'object') {
    let explicitSYP = Number(rawBranch.totalSYP ?? rawBranch.SYP ?? rawBranch.syp ?? 0) || 0;
    let explicitUSD = Number(rawBranch.totalUSD ?? rawBranch.USD ?? rawBranch.usd ?? 0) || 0;

    if (Array.isArray(rawBranch.items)) {
      rawBranch.items.forEach((item, idx) => {
        if (!item || typeof item !== 'object') return;
        const amt = Number(item.amount ?? item.value ?? 0) || 0;
        const cur = normalizeCurrencyCode(item.currency, item.title || item.note || '', 'SYP');
        const title = String(item.title ?? item.name ?? item.category ?? item.note ?? 'بند مالي').trim();
        if (amt > 0) {
          result.items.push({
            id: Number(item.id) || (idx + 1),
            title,
            amount: amt,
            currency: cur,
            date: String(item.date || formatTimestamp())
          });
        }
      });
    } else {
      // Support key-value map e.g. { "مصاريف الغرانولا": { amount: 50000, currency: "SYP" } }
      let idx = 1;
      Object.entries(rawBranch).forEach(([k, v]) => {
        if (['totalSYP', 'totalUSD', 'SYP', 'USD', 'syp', 'usd', 'items'].includes(k)) return;
        if (typeof v === 'number' && v > 0) {
          const cur = normalizeCurrencyCode('', k, 'SYP');
          result.items.push({
            id: idx++,
            title: k,
            amount: v,
            currency: cur,
            date: formatTimestamp()
          });
        } else if (v && typeof v === 'object') {
          const amt = Number(v.amount ?? v.value ?? 0) || 0;
          const cur = normalizeCurrencyCode(v.currency, k, 'SYP');
          if (amt > 0) {
            result.items.push({
              id: idx++,
              title: String(v.title || k).trim(),
              amount: amt,
              currency: cur,
              date: String(v.date || formatTimestamp())
            });
          }
        }
      });
    }

    const sumItemsSYP = result.items
      .filter((i) => i.currency === 'SYP')
      .reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
    const sumItemsUSD = result.items
      .filter((i) => i.currency === 'USD')
      .reduce((acc, i) => acc + (Number(i.amount) || 0), 0);

    result.totalSYP = Math.max(explicitSYP, sumItemsSYP);
    result.totalUSD = Math.max(explicitUSD, sumItemsUSD);
    return result;
  }

  result.totalSYP = result.items
    .filter((i) => i.currency === 'SYP')
    .reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  result.totalUSD = result.items
    .filter((i) => i.currency === 'USD')
    .reduce((acc, i) => acc + (Number(i.amount) || 0), 0);

  return result;
}

/**
 * Resilient State Schema Normalizer
 */
function normalizeStateSchema(raw) {
  const clean = getInitialCleanState();
  if (!raw || typeof raw !== 'object') return clean;

  // 1. fx_rate
  const fxRate = Number(raw.fx_rate ?? raw.exchange_rate ?? raw.rate) > 0
    ? Number(raw.fx_rate ?? raw.exchange_rate ?? raw.rate)
    : (Number(appState?.fx_rate) > 0 ? Number(appState.fx_rate) : clean.fx_rate);

  // 2. wallets
  const normalizedWallets = {};
  if (raw.wallets && typeof raw.wallets === 'object' && !Array.isArray(raw.wallets)) {
    Object.entries(raw.wallets).forEach(([wName, wData]) => {
      const cleanName = String(wName).trim();
      if (!cleanName) return;
      if (typeof wData === 'number' || typeof wData === 'string') {
        normalizedWallets[cleanName] = {
          amount: Number(wData) || 0,
          currency: normalizeCurrencyCode('', cleanName, 'SYP')
        };
      } else if (wData && typeof wData === 'object') {
        normalizedWallets[cleanName] = {
          amount: Number(wData.amount ?? wData.balance ?? wData.value ?? wData.total ?? 0) || 0,
          currency: normalizeCurrencyCode(wData.currency ?? wData.unit, cleanName, 'SYP')
        };
      }
    });
  } else if (Array.isArray(raw.wallets)) {
    raw.wallets.forEach((wItem) => {
      if (!wItem || typeof wItem !== 'object') return;
      const cleanName = String(wItem.name ?? wItem.wallet ?? wItem.title ?? '').trim();
      if (!cleanName) return;
      normalizedWallets[cleanName] = {
        amount: Number(wItem.amount ?? wItem.balance ?? wItem.value ?? 0) || 0,
        currency: normalizeCurrencyCode(wItem.currency ?? wItem.unit, cleanName, 'SYP')
      };
    });
  }

  // 3. projects
  const normalizedProjects = {};
  if (raw.projects && typeof raw.projects === 'object' && !Array.isArray(raw.projects)) {
    Object.entries(raw.projects).forEach(([pName, pData]) => {
      const cleanName = String(pName).trim();
      if (!cleanName) return;
      if (typeof pData === 'number') {
        normalizedProjects[cleanName] = {
          netSYP: Number(pData) || 0,
          netUSD: 0,
          summary: 'مشروع نشط'
        };
      } else if (pData && typeof pData === 'object') {
        normalizedProjects[cleanName] = {
          netSYP: Number(pData.netSYP ?? pData.syp ?? pData.amountSYP ?? (pData.currency === 'SYP' ? pData.amount : 0) ?? 0) || 0,
          netUSD: Number(pData.netUSD ?? pData.usd ?? pData.amountUSD ?? (pData.currency === 'USD' ? pData.amount : 0) ?? 0) || 0,
          summary: String(pData.summary ?? pData.note ?? pData.description ?? 'مشروع نشط'),
          closed: Boolean(pData.closed || pData.archived)
        };
      }
    });
  } else if (Array.isArray(raw.projects)) {
    raw.projects.forEach((pItem) => {
      if (!pItem || typeof pItem !== 'object') return;
      const cleanName = String(pItem.name ?? pItem.project ?? pItem.title ?? '').trim();
      if (!cleanName) return;
      normalizedProjects[cleanName] = {
        netSYP: Number(pItem.netSYP ?? pItem.syp ?? (pItem.currency === 'SYP' ? pItem.amount : 0) ?? 0) || 0,
        netUSD: Number(pItem.netUSD ?? pItem.usd ?? (pItem.currency === 'USD' ? pItem.amount : 0) ?? 0) || 0,
        summary: String(pItem.summary ?? pItem.note ?? pItem.description ?? 'مشروع نشط'),
        closed: Boolean(pItem.closed || pItem.archived)
      };
    });
  }

  // 4. debts
  const normalizedDebts = [];
  let nextId = 1;
  if (Array.isArray(raw.debts)) {
    raw.debts.forEach((dItem) => {
      if (!dItem || typeof dItem !== 'object') return;
      const person = String(dItem.person ?? dItem.name ?? dItem.party ?? dItem.creditor ?? dItem.debtor ?? '').trim();
      if (!person) return;
      const amt = Number(dItem.amount ?? dItem.balance ?? dItem.value ?? 0) || 0;
      const cur = normalizeCurrencyCode(dItem.currency ?? dItem.unit, dItem.note || '', 'USD');
      const type = normalizeDebtType(dItem.type ?? dItem.direction ?? dItem.status);
      const id = Number(dItem.id) > 0 ? Number(dItem.id) : nextId++;
      if (id >= nextId) nextId = id + 1;
      normalizedDebts.push({
        id,
        person,
        amount: amt,
        currency: cur,
        type,
        note: String(dItem.note ?? dItem.description ?? dItem.summary ?? dItem.reason ?? ''),
        settled: Boolean(dItem.settled)
      });
    });
  } else if (raw.debts && typeof raw.debts === 'object') {
    Object.entries(raw.debts).forEach(([personKey, dVal]) => {
      const person = String(personKey).trim();
      if (!person) return;
      if (typeof dVal === 'number') {
        normalizedDebts.push({
          id: nextId++,
          person,
          amount: Math.abs(Number(dVal)) || 0,
          currency: 'USD',
          type: Number(dVal) >= 0 ? 'لنا' : 'علينا',
          note: ''
        });
      } else if (dVal && typeof dVal === 'object') {
        normalizedDebts.push({
          id: Number(dVal.id) > 0 ? Number(dVal.id) : nextId++,
          person: String(dVal.person ?? person).trim(),
          amount: Number(dVal.amount ?? dVal.balance ?? dVal.value ?? 0) || 0,
          currency: normalizeCurrencyCode(dVal.currency ?? dVal.unit, dVal.note || '', 'USD'),
          type: normalizeDebtType(dVal.type ?? dVal.direction ?? dVal.status),
          note: String(dVal.note ?? dVal.description ?? dVal.summary ?? ''),
          settled: Boolean(dVal.settled)
        });
      }
    });
  }

  // 5. monthly_flow (income & expenses)
  const rawFlow = raw.monthly_flow && typeof raw.monthly_flow === 'object' ? raw.monthly_flow : {};
  const normalizedMonthlyFlow = {
    income: normalizeFlowBranch(rawFlow.income),
    expenses: normalizeFlowBranch(rawFlow.expenses)
  };

  return {
    fx_rate: fxRate,
    wallets: normalizedWallets,
    projects: normalizedProjects,
    debts: normalizedDebts,
    monthly_flow: normalizedMonthlyFlow,
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    archive: {
      projects: raw.archive && raw.archive.projects && typeof raw.archive.projects === 'object' ? raw.archive.projects : {},
      debts: raw.archive && Array.isArray(raw.archive.debts) ? raw.archive.debts : [],
      monthly_flow: raw.archive && Array.isArray(raw.archive.monthly_flow) ? raw.archive.monthly_flow : []
    }
  };
}

function initApp() {
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
 * Switch Active Tab (Completely Separated Tabs: Wallets | Projects & Flow | Debts)
 */
function switchTab(tabName) {
  currentTab = tabName;
  const walletsPanel = document.getElementById('panel-wallets');
  const projectsPanel = document.getElementById('panel-projects');
  const debtsPanel = document.getElementById('panel-debts');

  const btnWallets = document.getElementById('tab-btn-wallets');
  const btnProjects = document.getElementById('tab-btn-projects');
  const btnDebts = document.getElementById('tab-btn-debts');

  [btnWallets, btnProjects, btnDebts].forEach((b) => {
    if (b) b.classList.remove('active');
  });

  if (tabName === 'wallets') {
    walletsPanel.classList.remove('hidden');
    projectsPanel.classList.add('hidden');
    debtsPanel.classList.add('hidden');
    if (btnWallets) btnWallets.classList.add('active');
  } else if (tabName === 'projects') {
    walletsPanel.classList.add('hidden');
    projectsPanel.classList.remove('hidden');
    debtsPanel.classList.add('hidden');
    if (btnProjects) btnProjects.classList.add('active');
  } else if (tabName === 'debts') {
    walletsPanel.classList.add('hidden');
    projectsPanel.classList.add('hidden');
    debtsPanel.classList.remove('hidden');
    if (btnDebts) btnDebts.classList.add('active');
  }
}

/**
 * State Pruning & Auto-Archiving (`archiveClosedItems`)
 */
function archiveClosedItems(targetState = appState) {
  if (!targetState.archive) {
    targetState.archive = { projects: {}, debts: [], monthly_flow: [] };
  }
  if (!targetState.archive.projects) targetState.archive.projects = {};
  if (!Array.isArray(targetState.archive.debts)) targetState.archive.debts = [];
  if (!Array.isArray(targetState.archive.monthly_flow)) targetState.archive.monthly_flow = [];

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
 * Context Window Pruning for DeepSeek AI (Active State + monthly_flow + Last 3 Logs only, No Archive)
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
    monthly_flow: JSON.parse(JSON.stringify(sourceState.monthly_flow || {
      income: { totalSYP: 0, totalUSD: 0, items: [] },
      expenses: { totalSYP: 0, totalUSD: 0, items: [] }
    })),
    logs: JSON.parse(JSON.stringify(recentThreeLogs))
  };
}

/**
 * System Prompt (Incorporating Strict Currency Separation & monthly_flow Income/Expenses Rules)
 */
function buildSystemPrompt(sourceState = appState) {
  const prunedState = buildPrunedContextForAI(sourceState);
  return `أنت محاسب مالي ذكي. مهمتك فهم كلامي بلغتي الطبيعية وتحديث الحالة المالية بدقة، مع الفصل التام بين عملتي الدولار (USD) والليرة السورية (SYP) دون دمج أو تحويل تلقائي بينهما إلا إذا طلبت صراحة عملية تصريف عملة.

الحالة المالية الحالية:
${JSON.stringify(prunedState, null, 2)}

قواعد الرد وتوزيع الحقول وهيكلها البرمجي:
1. "wallets": للأرصدة النقدية الفعلية فقط (مثل: كاش دولار، كاش سوري، شام كاش) ولا تضع أسماء الأشخاص هنا أبداً.
   - هيكل كل محفظة: "اسم المحفظة": { "amount": رقم_الرصيد, "currency": "USD" أو "SYP" }
2. "debts": لالتزامات وديون وأمانات الأشخاص القابلة للاسترداد أو السداد (لنا = أموال لنا عند الغير / علينا = أموال للغير عندنا).
   - هيكل كل دين داخل مصفوفة debts: { "id": رقم, "person": "اسم الشخص", "amount": رقم, "currency": "USD" أو "SYP", "type": "لنا" أو "علينا", "note": "توضيح" }
3. "projects": لمراكز وأرباح المشاريع والورشات المستمرة.
   - هيكل كل مشروع: "اسم المشروع": { "netSYP": صافي_الليرة, "netUSD": صافي_الدولار, "summary": "وصف مختصر" }
4. "monthly_flow": لتتبع التدفق المالي الشهري للأموال التي لا تُسترد (المصروفات التشغيلية أو الشخصية، والإيرادات أو الأرباح المسحوبة):
   - يحتوي على قسمين:
     * "income" (إيرادات وأرباح مسحوبة): { "totalSYP": إجمالي_الليرة, "totalUSD": إجمالي_الدولار, "items": [{ "id": رقم, "title": "وصف الإيراد", "amount": رقم, "currency": "SYP" أو "USD" }] }
     * "expenses" (مصروفات ومشتريات لا تُسترد مثل شراء مواد أولية للغرانولا أو مصاريف شخصية): { "totalSYP": إجمالي_الليرة, "totalUSD": إجمالي_الدولار, "items": [{ "id": رقم, "title": "وصف المصروف", "amount": رقم, "currency": "SYP" أو "USD" }] }
   - القاعدة المحاسبية لـ monthly_flow: عند ذكر مصروف (مثل شراء مواد أولية لمشروع الغرانولا أو مصروف شخصي) أو إيراد/ربح مسحوب (مثل أرباح مسحوبة من مشروع)، قم فوراً بخصم/إضافة المبلغ من محفظة الكاش المناسبة في "wallets"، وفي نفس اللحظة أضف القيمة إلى عداد وقائمة "expenses" أو "income" داخل "monthly_flow" بنفس العملة، دون اعتبار هذا المصروف ديناً في "debts" أو مشروعاً مستقلاً في "projects".

المطلوب:
افهم ما أطلبه منك، قم بتحديث الأرقام المحاسبية المناسبة، وأرجع حصراً كائن JSON صالح يحتوي على:
1. "reply": رد بشري مختصر جداً يوضح ما فعلته.
2. "updated_state": كائن الحالة المحدث بالكامل (شاملاً fx_rate و wallets و projects و debts و monthly_flow).`;
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

  // 1. Wallets Diff
  Object.keys(curWallets).forEach((walletName) => {
    if (!Object.prototype.hasOwnProperty.call(newWallets, walletName)) {
      warnings.push(`تنبيه: هذا الإجراء سيحذف محفظة [${walletName}] بالكامل، هل أنت متأكد؟`);
    } else {
      const oldAmt = Number(curWallets[walletName].amount) || 0;
      const newAmt = Number(newWallets[walletName].amount) || 0;
      const oldCur = curWallets[walletName].currency || 'SYP';
      const newCur = newWallets[walletName].currency || oldCur;
      if (oldAmt !== newAmt || oldCur !== newCur) {
        changes.push(`تحديث محفظة "${walletName}": من ${formatNumber(oldAmt, oldCur)} إلى ${formatNumber(newAmt, newCur)}`);
      }
    }
  });

  Object.keys(newWallets).forEach((walletName) => {
    if (!Object.prototype.hasOwnProperty.call(curWallets, walletName)) {
      const cur = newWallets[walletName].currency || 'SYP';
      changes.push(`إنشاء محفظة "${walletName}" برصيد ${formatNumber(newWallets[walletName].amount, cur)}`);
    }
  });

  // 2. Projects Diff
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
        changes.push(`تحديث مشروع "${projName}": SYP (${formatNumber(oldSyp)} ← ${formatNumber(newSyp)}) | USD (${formatNumber(oldUsd, 'USD')} ← ${formatNumber(newUsd, 'USD')})`);
      }
    }
  });

  Object.keys(newProjects).forEach((projName) => {
    if (!Object.prototype.hasOwnProperty.call(curProjects, projName)) {
      const p = newProjects[projName];
      changes.push(`إضافة مشروع "${projName}" (SYP: ${formatNumber(p.netSYP)} | USD: ${formatNumber(p.netUSD, 'USD')})`);
    }
  });

  // 3. Debts Diff
  const curDebts = Array.isArray(currentState.debts) ? currentState.debts : [];
  const newDebts = Array.isArray(updatedState.debts) ? updatedState.debts : [];

  curDebts.forEach((oldDebt) => {
    const match = newDebts.find((d) =>
      (d.id !== undefined && Number(d.id) === Number(oldDebt.id)) ||
      (d.person && d.person.trim() === oldDebt.person.trim())
    );
    if (!match) {
      warnings.push(`تنبيه: هذا الإجراء سيحذف سجل الدين الخاص بـ [${oldDebt.person}] بالكامل، هل أنت متأكد؟`);
    } else {
      const oldAmt = Number(oldDebt.amount) || 0;
      const newAmt = Number(match.amount) || 0;
      const oldType = oldDebt.type || 'علينا';
      const newType = match.type || oldType;
      const cur = match.currency || oldDebt.currency || 'USD';
      if (oldAmt !== newAmt || oldType !== newType) {
        if (newAmt <= 0 || match.settled) {
          changes.push(`تسديد وإغلاق ذمة "${oldDebt.person}" بالكامل (كانت ${formatNumber(oldAmt, cur)})`);
        } else {
          changes.push(`تحديث ذمة "${oldDebt.person}" (${newType}): من ${formatNumber(oldAmt, oldDebt.currency)} إلى ${formatNumber(newAmt, cur)}`);
        }
      }
    }
  });

  newDebts.forEach((newDebt) => {
    const existed = curDebts.find((d) =>
      (d.id !== undefined && Number(d.id) === Number(newDebt.id)) ||
      (d.person && d.person.trim() === newDebt.person.trim())
    );
    if (!existed && Number(newDebt.amount) > 0) {
      changes.push(`تسجيل ذمة جديدة (${newDebt.type || 'علينا'}) لـ "${newDebt.person}": ${formatNumber(newDebt.amount, newDebt.currency || 'USD')}`);
    }
  });

  // 4. Monthly Flow Diff
  const curFlow = currentState.monthly_flow || { income: { totalSYP: 0, totalUSD: 0 }, expenses: { totalSYP: 0, totalUSD: 0 } };
  const newFlow = updatedState.monthly_flow || { income: { totalSYP: 0, totalUSD: 0 }, expenses: { totalSYP: 0, totalUSD: 0 } };

  if ((Number(newFlow.income?.totalSYP) || 0) !== (Number(curFlow.income?.totalSYP) || 0)) {
    changes.push(`تحديث إيرادات الشهر (SYP): من ${formatNumber(curFlow.income?.totalSYP, 'SYP')} إلى ${formatNumber(newFlow.income?.totalSYP, 'SYP')}`);
  }
  if ((Number(newFlow.income?.totalUSD) || 0) !== (Number(curFlow.income?.totalUSD) || 0)) {
    changes.push(`تحديث إيرادات الشهر (USD): من ${formatNumber(curFlow.income?.totalUSD, 'USD')} إلى ${formatNumber(newFlow.income?.totalUSD, 'USD')}`);
  }
  if ((Number(newFlow.expenses?.totalSYP) || 0) !== (Number(curFlow.expenses?.totalSYP) || 0)) {
    changes.push(`تحديث مصروفات الشهر (SYP): من ${formatNumber(curFlow.expenses?.totalSYP, 'SYP')} إلى ${formatNumber(newFlow.expenses?.totalSYP, 'SYP')}`);
  }
  if ((Number(newFlow.expenses?.totalUSD) || 0) !== (Number(curFlow.expenses?.totalUSD) || 0)) {
    changes.push(`تحديث مصروفات الشهر (USD): من ${formatNumber(curFlow.expenses?.totalUSD, 'USD')} إلى ${formatNumber(newFlow.expenses?.totalUSD, 'USD')}`);
  }

  // 5. FX Rate Diff
  if (Number(updatedState.fx_rate) && Number(updatedState.fx_rate) !== Number(currentState.fx_rate)) {
    changes.push(`تحديث سعر الصرف: من ${formatNumber(currentState.fx_rate)} إلى ${formatNumber(updatedState.fx_rate)} ل.س/$`);
  }

  return {
    valid: true,
    requiresConfirmation: warnings.length > 0,
    warnings,
    changes
  };
}

/**
 * Render Complete UI (Strictly Separated Currencies - Zero Cross-Currency Multiplication/Division)
 */
function renderUI() {
  const fx = Number(appState.fx_rate) || 15000;

  const fxEl = document.getElementById('header-fx-value');
  if (fxEl) fxEl.textContent = formatNumber(fx);

  const logsBadge = document.getElementById('logs-count-badge');
  if (logsBadge) logsBadge.textContent = String((appState.logs || []).length);

  // 1. Top 2 Summary Cards: Total Cash in SYP & Total Cash in USD (No conversion)
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

  const sumSypEl = document.getElementById('summary-wallets-syp');
  const sumUsdEl = document.getElementById('summary-wallets-usd');
  if (sumSypEl) sumSypEl.textContent = formatNumber(totalWalletsSYP, 'SYP');
  if (sumUsdEl) sumUsdEl.textContent = formatNumber(totalWalletsUSD, 'USD');

  // 2. Render Wallets, Projects, Monthly Flow, Debts, and Logs
  renderWalletsSection();
  renderProjectsSection();
  renderMonthlyFlowSection();
  renderDebtsSection();
  renderContextLogsStrip();
}

/**
 * Render Wallets Section (No "يعادل كذا" subtitle - pure currency display)
 */
function renderWalletsSection() {
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
    const currencyLabel = currency === 'USD' ? 'محفظة دولار أمريكي' : 'محفظة ليرة سورية';
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
              <span class="card-subtext">${currencyLabel}</span>
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

/**
 * Render Projects Section (Independent SYP & USD Totals - Zero Merging)
 */
function renderProjectsSection() {
  const grid = document.getElementById('projects-grid');
  const netSypEl = document.getElementById('projects-net-syp-val');
  const netUsdEl = document.getElementById('projects-net-usd-val');
  if (!grid) return;

  let totalNetSYP = 0;
  let totalNetUSD = 0;
  const entries = Object.entries(appState.projects || {});

  entries.forEach(([, proj]) => {
    totalNetSYP += Number(proj.netSYP) || 0;
    totalNetUSD += Number(proj.netUSD) || 0;
  });

  if (netSypEl) netSypEl.textContent = formatNumber(totalNetSYP, 'SYP');
  if (netUsdEl) netUsdEl.textContent = formatNumber(totalNetUSD, 'USD');

  if (entries.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box">
        <span>لا توجد مشاريع نشطة حالياً. يمكنك إضافة مشروع جديد لمتابعة عوائده بالليرة والدولار بشكل مستقل.</span>
      </div>
    `;
    return;
  }

  grid.innerHTML = entries.map(([name, proj]) => {
    const netSYP = Number(proj.netSYP) || 0;
    const netUSD = Number(proj.netUSD) || 0;
    const summary = escapeHtml(proj.summary || 'مشروع نشط');
    const safeName = escapeHtml(name);

    return `
      <article class="item-card">
        <div class="card-top-row">
          <div>
            <h3 class="card-title">${safeName}</h3>
            <p class="card-subtext">${summary}</p>
          </div>
          <div style="display:flex; align-items:center; gap:0.35rem; flex-wrap:wrap;">
            <span class="badge-pill num-ltr">${formatNumber(netSYP, 'SYP')}</span>
            <span class="badge-pill num-ltr">${formatNumber(netUSD, 'USD')}</span>
          </div>
        </div>

        <div style="display:flex; flex-wrap:wrap; gap:1rem; font-size:0.78rem; color:var(--text-muted);">
          <div>صافي الليرة: <strong class="num-ltr" style="color:var(--text-main);">${formatNumber(netSYP, 'SYP')}</strong></div>
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

/**
 * Render Monthly Financial Flow Section (Income & Expenses)
 */
function renderMonthlyFlowSection() {
  const flow = appState.monthly_flow || {
    income: { totalSYP: 0, totalUSD: 0, items: [] },
    expenses: { totalSYP: 0, totalUSD: 0, items: [] }
  };

  const incSypEl = document.getElementById('flow-income-syp');
  const incUsdEl = document.getElementById('flow-income-usd');
  const expSypEl = document.getElementById('flow-expenses-syp');
  const expUsdEl = document.getElementById('flow-expenses-usd');
  const listEl = document.getElementById('monthly-flow-list');

  if (incSypEl) incSypEl.textContent = formatNumber(flow.income?.totalSYP || 0, 'SYP');
  if (incUsdEl) incUsdEl.textContent = formatNumber(flow.income?.totalUSD || 0, 'USD');
  if (expSypEl) expSypEl.textContent = formatNumber(flow.expenses?.totalSYP || 0, 'SYP');
  if (expUsdEl) expUsdEl.textContent = formatNumber(flow.expenses?.totalUSD || 0, 'USD');

  if (!listEl) return;

  const incomeItems = (flow.income?.items || []).map((item) => ({ ...item, flowType: 'income' }));
  const expenseItems = (flow.expenses?.items || []).map((item) => ({ ...item, flowType: 'expenses' }));
  const combined = [...expenseItems, ...incomeItems];

  if (combined.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state-box">
        <span>لا توجد مصروفات أو إيرادات مسجلة لهذا الشهر حتى الآن.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = combined.map((item) => {
    const isIncome = item.flowType === 'income';
    const badgeLabel = isIncome ? 'إيراد / ربح' : 'مصروف';
    const badgeStyle = isIncome
      ? ''
      : 'color:var(--rose-text); background-color:var(--rose-soft);';
    return `
      <div class="log-row">
        <div style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
          <span class="badge-pill" style="${badgeStyle}">${badgeLabel}</span>
          <span style="font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.title)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-shrink:0;">
          <strong class="num-ltr" style="color:${isIncome ? 'var(--emerald-primary)' : 'var(--rose-text)'};">${formatNumber(item.amount, item.currency)}</strong>
          <button type="button" onclick="deleteMonthlyFlowItem('${item.flowType}', ${Number(item.id)})" class="btn-wallet-icon danger" style="width:1.75rem; height:1.75rem;" title="حذف البند">
            <svg style="width:0.8rem; height:0.8rem;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Render Debts Section (Independent SYP & USD Totals - Zero Merging)
 */
function renderDebtsSection() {
  const listEl = document.getElementById('debts-list');
  const netSypEl = document.getElementById('debts-net-syp-val');
  const netUsdEl = document.getElementById('debts-net-usd-val');
  if (!listEl) return;

  const debts = Array.isArray(appState.debts) ? appState.debts : [];

  let netSYP = 0;
  let netUSD = 0;
  debts.forEach((d) => {
    const amt = Number(d.amount) || 0;
    const cur = (d.currency || 'USD').toUpperCase();
    const sign = d.type === 'لنا' ? 1 : -1;
    if (cur === 'SYP') {
      netSYP += sign * amt;
    } else {
      netUSD += sign * amt;
    }
  });

  if (netSypEl) {
    const prefix = netSYP > 0 ? '+' : '';
    netSypEl.textContent = `${prefix}${formatNumber(netSYP, 'SYP')}`;
  }
  if (netUsdEl) {
    const prefix = netUSD > 0 ? '+' : '';
    netUsdEl.textContent = `${prefix}${formatNumber(netUSD, 'USD')}`;
  }

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
 * EXPANDED EXCHANGE RATE MODAL WITH LIVE INSTANT CALCULATOR
 * ============================================================================
 */

function openFxModal() {
  currentHybridContext = { type: 'fx' };
  const currentRate = Number(appState.fx_rate) || 15000;
  document.getElementById('hybrid-modal-title').textContent = 'سعر الصرف وأداة التحويل اللحظية';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div>
      <label class="field-label">سعر الصرف المعتمد (1 دولار مقابل الليرة السورية):</label>
      <input id="hybrid-fx-input" type="number" step="any" min="1" required value="${currentRate}" oninput="onFxRateInputChange()" class="num-ltr" />
    </div>

    <div class="calc-box">
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <span style="font-size:0.75rem; font-weight:700; color:var(--emerald-primary);">حاسبة التحويل السريع (بدون اتصال بالذكاء)</span>
        <span class="badge-pill">LIVE</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <div>
          <label class="field-label" style="font-size:0.68rem;">المبلغ بالدولار ($ USD):</label>
          <input id="calc-usd-input" type="number" step="any" placeholder="100" oninput="onFxCalculatorInput('usd')" class="num-ltr" />
        </div>
        <div>
          <label class="field-label" style="font-size:0.68rem;">المبلغ بالليرة (SYP):</label>
          <input id="calc-syp-input" type="number" step="any" placeholder="${currentRate * 100}" oninput="onFxCalculatorInput('syp')" class="num-ltr" />
        </div>
      </div>
    </div>
  `;
  showHybridModal();
}

function onFxRateInputChange() {
  const usdInput = document.getElementById('calc-usd-input');
  const sypInput = document.getElementById('calc-syp-input');
  if (!usdInput || !sypInput) return;

  if (usdInput.value !== '') {
    onFxCalculatorInput('usd');
  } else if (sypInput.value !== '') {
    onFxCalculatorInput('syp');
  }
}

function onFxCalculatorInput(sourceField) {
  const fxInput = document.getElementById('hybrid-fx-input');
  const usdInput = document.getElementById('calc-usd-input');
  const sypInput = document.getElementById('calc-syp-input');
  if (!fxInput || !usdInput || !sypInput) return;

  const rate = Number(fxInput.value) || Number(appState.fx_rate) || 1;
  if (rate <= 0) return;

  if (sourceField === 'usd') {
    const usdVal = parseFloat(usdInput.value);
    if (isNaN(usdVal)) {
      sypInput.value = '';
    } else {
      sypInput.value = Math.round(usdVal * rate);
    }
  } else if (sourceField === 'syp') {
    const sypVal = parseFloat(sypInput.value);
    if (isNaN(sypVal)) {
      usdInput.value = '';
    } else {
      usdInput.value = Number((sypVal / rate).toFixed(2));
    }
  }
}

/**
 * ============================================================================
 * HYBRID LOCAL OPERATIONS (Wallets, Projects, Monthly Flow, Debts)
 * ============================================================================
 */

function openWalletModal() {
  currentHybridContext = { type: 'new_wallet' };
  document.getElementById('hybrid-modal-title').textContent = 'إضافة محفظة نقدية جديدة';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div>
      <label class="field-label">اسم المحفظة:</label>
      <input id="hybrid-wallet-name" type="text" required placeholder="مثال: كاش سوري أو كاش دولار" />
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

/**
 * Monthly Flow Manual Entry & Archiving
 */
function openMonthlyFlowModal() {
  currentHybridContext = { type: 'new_monthly_flow' };
  const walletOptions = Object.keys(appState.wallets || {}).map((w) =>
    `<option value="${escapeHtml(w)}">${escapeHtml(w)} (${appState.wallets[w].currency})</option>`
  ).join('');

  document.getElementById('hybrid-modal-title').textContent = 'تسجيل مصروف أو إيراد شهري';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">نوع الحركة:</label>
        <select id="hybrid-flow-type">
          <option value="expenses">مصروف (Expenses)</option>
          <option value="income">إيراد / ربح مسحوب (Income)</option>
        </select>
      </div>
      <div>
        <label class="field-label">العملة:</label>
        <select id="hybrid-flow-currency">
          <option value="SYP">SYP (ليرة سورية)</option>
          <option value="USD">USD (دولار أمريكي)</option>
        </select>
      </div>
    </div>
    <div>
      <label class="field-label">البيان / التصنيف:</label>
      <input id="hybrid-flow-title" type="text" required placeholder="مثال: مواد أولية غرانولا أو مصاريف شخصية" />
    </div>
    <div>
      <label class="field-label">المبلغ:</label>
      <input id="hybrid-flow-amount" type="number" step="any" min="0.01" required placeholder="0" class="num-ltr" />
    </div>
    <div>
      <label class="field-label">تأثير مباشر على محفظة نقدية (اختياري):</label>
      <select id="hybrid-flow-wallet">
        <option value="">-- بدون خصم/إضافة من المحافظ --</option>
        ${walletOptions}
      </select>
    </div>
  `;
  showHybridModal();
}

function deleteMonthlyFlowItem(flowType, itemId) {
  const branch = appState.monthly_flow?.[flowType];
  if (!branch || !Array.isArray(branch.items)) return;

  const idx = branch.items.findIndex((i) => Number(i.id) === Number(itemId));
  if (idx === -1) return;

  const removed = branch.items.splice(idx, 1)[0];
  if (removed.currency === 'USD') {
    branch.totalUSD = Math.max(0, (Number(branch.totalUSD) || 0) - (Number(removed.amount) || 0));
  } else {
    branch.totalSYP = Math.max(0, (Number(branch.totalSYP) || 0) - (Number(removed.amount) || 0));
  }

  appendLog(`حذف بند من التدفق الشهري: "${removed.title}"`);
  saveStateToStorage();
  renderUI();
  showToast('تم حذف البند من التدفق الشهري');
}

function archiveCurrentMonthLocally() {
  const flow = appState.monthly_flow || {
    income: { totalSYP: 0, totalUSD: 0, items: [] },
    expenses: { totalSYP: 0, totalUSD: 0, items: [] }
  };

  const hasData = (Number(flow.income?.totalSYP) || 0) > 0 ||
    (Number(flow.income?.totalUSD) || 0) > 0 ||
    (Number(flow.expenses?.totalSYP) || 0) > 0 ||
    (Number(flow.expenses?.totalUSD) || 0) > 0 ||
    (flow.income?.items?.length || 0) > 0 ||
    (flow.expenses?.items?.length || 0) > 0;

  if (!hasData) {
    showToast('عدادات الشهر الحالي مصفّرة بالفعل');
    return;
  }

  if (!appState.archive) appState.archive = { projects: {}, debts: [], monthly_flow: [] };
  if (!Array.isArray(appState.archive.monthly_flow)) appState.archive.monthly_flow = [];

  appState.archive.monthly_flow.unshift({
    archivedAt: formatTimestamp(),
    income: JSON.parse(JSON.stringify(flow.income)),
    expenses: JSON.parse(JSON.stringify(flow.expenses))
  });

  // Reset monthly_flow counters to start a new month while keeping wallets & debts untouched
  appState.monthly_flow = {
    income: { totalSYP: 0, totalUSD: 0, items: [] },
    expenses: { totalSYP: 0, totalUSD: 0, items: [] }
  };

  appendLog('أرشفة التدفق المالي للشهر وتصفير عدادات الإيرادات والمصروفات لبدء شهر جديد');
  saveStateToStorage();
  renderUI();
  showToast('تمت أرشفة الشهر وتصفير عدادات التدفق الشهري');
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
  } else if (ctx.type === 'new_monthly_flow') {
    const flowType = document.getElementById('hybrid-flow-type').value;
    const currency = document.getElementById('hybrid-flow-currency').value;
    const title = document.getElementById('hybrid-flow-title').value.trim();
    const amount = Number(document.getElementById('hybrid-flow-amount').value) || 0;
    const selectedWallet = document.getElementById('hybrid-flow-wallet').value;

    if (title && amount > 0) {
      const branch = appState.monthly_flow[flowType];
      const nextId = (branch.items || []).reduce((max, i) => Math.max(max, Number(i.id) || 0), 0) + 1;
      branch.items.unshift({
        id: nextId,
        title,
        amount,
        currency,
        date: formatTimestamp()
      });
      if (currency === 'USD') {
        branch.totalUSD = (Number(branch.totalUSD) || 0) + amount;
      } else {
        branch.totalSYP = (Number(branch.totalSYP) || 0) + amount;
      }

      if (selectedWallet && appState.wallets[selectedWallet]) {
        const w = appState.wallets[selectedWallet];
        w.amount = flowType === 'income'
          ? (Number(w.amount) || 0) + amount
          : (Number(w.amount) || 0) - amount;
      }

      const label = flowType === 'income' ? 'تسجيل إيراد شهري' : 'تسجيل مصروف شهري';
      appendLog(`${label}: "${title}" بقيمة ${formatNumber(amount, currency)}`);
      saveStateToStorage();
      renderUI();
      showToast('تم تسجيل الحركة في التدفق الشهري');
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
    const parsed = JSON.parse(cleaned);

    const rawUpdatedState = parsed.updated_state || parsed.state || parsed;
    if (!rawUpdatedState || typeof rawUpdatedState !== 'object') {
      throw new Error('لم يُرجع الذكاء الاصطناعي كائن حالة صالحاً.');
    }

    const normalizedProposedState = normalizeStateSchema(rawUpdatedState);

    presentAIProposal(commandText, {
      reply: parsed.reply || 'تم تحليل العملية وتحديث الأرصدة المحاسبية.',
      updated_state: normalizedProposedState
    });
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
    diffPreviewEl.innerHTML = `<div style="color:var(--text-muted);">لم يتم رصد تغييرات رقمية إضافية على الأرصدة الحالية.</div>`;
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
  const preservedArchive = appState.archive || { projects: {}, debts: [], monthly_flow: [] };
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
  const archMonthsContainer = document.getElementById('archive-months-list');
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

  if (archMonthsContainer) {
    const archMonths = appState.archive?.monthly_flow || [];
    if (archMonths.length === 0) {
      archMonthsContainer.innerHTML = `<div class="empty-state-box" style="padding:0.85rem;">لا توجد أشهر مؤرشفة.</div>`;
    } else {
      archMonthsContainer.innerHTML = archMonths.map((m) => `
        <div class="log-row" style="flex-direction:column; align-items:stretch; gap:0.25rem;">
          <div style="display:flex; justify-content:space-between; font-weight:700;">
            <span>أرشيف شهر</span>
            <span class="num-ltr" style="font-size:0.68rem; color:var(--text-muted);">${escapeHtml(m.archivedAt || '-')}</span>
          </div>
          <div style="font-size:0.72rem; color:var(--text-muted);">
            الإيرادات: ${formatNumber(m.income?.totalSYP || 0, 'SYP')} | ${formatNumber(m.income?.totalUSD || 0, 'USD')} —
            المصروفات: ${formatNumber(m.expenses?.totalSYP || 0, 'SYP')} | ${formatNumber(m.expenses?.totalUSD || 0, 'USD')}
          </div>
        </div>
      `).join('');
    }
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
  appState.archive = { projects: {}, debts: [], monthly_flow: [] };
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
  onFxRateInputChange,
  onFxCalculatorInput,
  openWalletModal,
  openWalletAdjustModal,
  deleteWalletLocally,
  openProjectModal,
  openProjectEditModal,
  deleteProjectLocally,
  openMonthlyFlowModal,
  deleteMonthlyFlowItem,
  archiveCurrentMonthLocally,
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
