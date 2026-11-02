/**
 * My Wallet v1.4 (محفظتي) - Deterministic Financial Engine + Intent & Entity Extraction
 * Tailored to User's Real Financial Workflows:
 * 1. Locked-Currency Wallets: كاش سوري [SYP], كاش دولار [USD], شام كاش سوري [SYP], شام كاش دولار [USD], سيرياتيل كاش [SYP], Wish Money [USD], فيزا كارد [USD]
 * 2. Canonical Projects & Entities:
 *    - "granola.sy": Tracks raw material assets (assetsSYP, assetsUSD) AND net profits (netSYP, netUSD).
 *    - "قص ليزر": Separates workshop owner's costs/share (recorded as debt_us 'علينا' to ورشة قص الليزر) from user's net profit.
 *    - "العطار الحمدو": Tracks shipping trusts/advances, personal profit share, borrowing from Al-Attar's funds, and 3rd-party withdrawals from Al-Attar's funds.
 * 3. Shared Housing Tracker (شركاء السكن): Separates roommate contributions from user's own housing share (not treated as debt).
 */

const STORAGE_KEYS = {
  LEGACY_V1: 'my_wallet_state_v1',
  STATE: 'my_wallet_state_v1_4',
  API_KEY: 'my_wallet_deepseek_api_key',
  API_URL: 'my_wallet_deepseek_api_url',
  THEME: 'my_wallet_theme_mode'
};

const DEFAULT_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * Canonical Locked-Currency Wallets Registry
 */
const LOCKED_WALLETS_REGISTRY = {
  'كاش سوري': 'SYP',
  'كاش دولار': 'USD',
  'شام كاش سوري': 'SYP',
  'شام كاش دولار': 'USD',
  'سيرياتيل كاش': 'SYP',
  'Wish Money': 'USD',
  'فيزا كارد': 'USD'
};

/**
 * Canonical Projects Registry
 */
const CANONICAL_PROJECTS = {
  'granola.sy': 'مشروع الغرانولا (أصول مواد أولية ومبيعات)',
  'قص ليزر': 'أعمال ورشة قص الليزر',
  'العطار الحمدو': 'شحن بضاعة وأمانات العطار الحمدو'
};

/**
 * Clean Empty Initial State (Zero Pre-Populated Balances)
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
      },
      housing: {
        partnersSYP: 0,
        partnersUSD: 0,
        spentSYP: 0,
        spentUSD: 0,
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
let pendingAIOperations = null;
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
    // Ignore storage errors
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
  if (hint.includes('دولار') || hint.toUpperCase().includes('USD') || hint.includes('$') || hint.includes('ويش') || hint.includes('فيزا')) {
    return 'USD';
  }
  return fallback;
}

/**
 * Resolve Synonym to Canonical Wallet Name + Enforce Locked Currency
 */
function resolveCanonicalWallet(rawWalletName, currency = 'SYP') {
  if (!rawWalletName) return null;
  const w = String(rawWalletName).trim();
  if (!w || w === 'null') return null;

  const cur = normalizeCurrencyCode(currency, w, 'SYP');
  const lower = w.toLowerCase();

  if (lower.includes('شام')) {
    return cur === 'USD' ? 'شام كاش دولار' : 'شام كاش سوري';
  }
  if (lower.includes('سيرياتيل') || lower.includes('سرياتيل') || lower.includes('syriatel')) {
    return 'سيرياتيل كاش';
  }
  if (lower.includes('wish') || lower.includes('ويش') || lower.includes('وش موني')) {
    return 'Wish Money';
  }
  if (lower.includes('فيزا') || lower.includes('visa') || lower.includes('كرت') || lower.includes('بطاقة')) {
    return 'فيزا كارد';
  }
  if (lower.includes('كاش') || lower.includes('جيب') || lower.includes('يد') || lower.includes('نقد')) {
    return cur === 'USD' ? 'كاش دولار' : 'كاش سوري';
  }

  // If it matches an existing wallet key
  if (appState.wallets && appState.wallets[w]) {
    return w;
  }
  return w;
}

/**
 * Ensure Wallet Exists in appState.wallets with its Locked Currency
 */
function ensureWalletExists(walletName, fallbackCurrency = 'SYP') {
  if (!walletName) return null;
  const lockedCur = LOCKED_WALLETS_REGISTRY[walletName] || normalizeCurrencyCode(fallbackCurrency, walletName, 'SYP');
  if (!appState.wallets[walletName]) {
    appState.wallets[walletName] = {
      amount: 0,
      currency: lockedCur
    };
  }
  return appState.wallets[walletName];
}

/**
 * Resolve Synonym to Canonical Project Name
 */
function resolveCanonicalProject(rawProject) {
  if (!rawProject) return null;
  const p = String(rawProject).trim();
  if (!p || p === 'null') return null;
  const lower = p.toLowerCase();

  if (lower.includes('غرانولا') || lower.includes('جرانولا') || lower.includes('granola')) {
    return 'granola.sy';
  }
  if (lower.includes('ليزر') || lower.includes('ورشة') || lower.includes('laser')) {
    return 'قص ليزر';
  }
  if (lower.includes('عطار') || lower.includes('حمدو')) {
    return 'العطار الحمدو';
  }
  return p;
}

function ensureProjectExists(projName) {
  if (!projName) return null;
  if (!appState.projects[projName]) {
    appState.projects[projName] = {
      netSYP: 0,
      netUSD: 0,
      assetsSYP: 0,
      assetsUSD: 0,
      summary: CANONICAL_PROJECTS[projName] || 'مشروع نشط'
    };
  }
  if (appState.projects[projName].assetsSYP === undefined) appState.projects[projName].assetsSYP = 0;
  if (appState.projects[projName].assetsUSD === undefined) appState.projects[projName].assetsUSD = 0;
  return appState.projects[projName];
}

/**
 * Resolve Party Synonym (e.g., العطار -> العطار الحمدو)
 */
function resolveCanonicalParty(rawParty) {
  if (!rawParty) return null;
  const p = String(rawParty).trim();
  if (!p || p === 'null') return null;
  if (p.includes('عطار') || p.includes('حمدو')) return 'العطار الحمدو';
  if (p.includes('ورشة') && p.includes('ليزر')) return 'ورشة قص الليزر';
  return p;
}

function normalizeStateSchema(raw) {
  const clean = getInitialCleanState();
  if (!raw || typeof raw !== 'object') return clean;

  const fxRate = Number(raw.fx_rate) > 0 ? Number(raw.fx_rate) : clean.fx_rate;

  const normalizedWallets = {};
  if (raw.wallets && typeof raw.wallets === 'object') {
    Object.entries(raw.wallets).forEach(([wName, wData]) => {
      if (!wData || typeof wData !== 'object') return;
      const lockedCur = LOCKED_WALLETS_REGISTRY[wName] || normalizeCurrencyCode(wData.currency, wName, 'SYP');
      normalizedWallets[wName] = {
        amount: Number(wData.amount) || 0,
        currency: lockedCur
      };
    });
  }

  const normalizedProjects = {};
  if (raw.projects && typeof raw.projects === 'object') {
    Object.entries(raw.projects).forEach(([pName, pData]) => {
      if (!pData || typeof pData !== 'object') return;
      normalizedProjects[pName] = {
        netSYP: Number(pData.netSYP) || 0,
        netUSD: Number(pData.netUSD) || 0,
        assetsSYP: Number(pData.assetsSYP) || 0,
        assetsUSD: Number(pData.assetsUSD) || 0,
        summary: String(pData.summary || CANONICAL_PROJECTS[pName] || 'مشروع نشط'),
        closed: Boolean(pData.closed)
      };
    });
  }

  const normalizedDebts = Array.isArray(raw.debts) ? raw.debts.map((d, idx) => ({
    id: Number(d.id) || (idx + 1),
    person: String(d.person || 'جهة غير محددة'),
    amount: Number(d.amount) || 0,
    currency: normalizeCurrencyCode(d.currency, d.note || '', 'USD'),
    type: d.type === 'لنا' ? 'لنا' : 'علينا',
    note: String(d.note || ''),
    settled: Boolean(d.settled)
  })) : [];

  const rawFlow = raw.monthly_flow || {};
  const normalizedFlow = {
    income: {
      totalSYP: Number(rawFlow.income?.totalSYP) || 0,
      totalUSD: Number(rawFlow.income?.totalUSD) || 0,
      items: Array.isArray(rawFlow.income?.items) ? rawFlow.income.items : []
    },
    expenses: {
      totalSYP: Number(rawFlow.expenses?.totalSYP) || 0,
      totalUSD: Number(rawFlow.expenses?.totalUSD) || 0,
      items: Array.isArray(rawFlow.expenses?.items) ? rawFlow.expenses.items : []
    },
    housing: {
      partnersSYP: Number(rawFlow.housing?.partnersSYP) || 0,
      partnersUSD: Number(rawFlow.housing?.partnersUSD) || 0,
      spentSYP: Number(rawFlow.housing?.spentSYP) || 0,
      spentUSD: Number(rawFlow.housing?.spentUSD) || 0,
      items: Array.isArray(rawFlow.housing?.items) ? rawFlow.housing.items : []
    }
  };

  return {
    fx_rate: fxRate,
    wallets: normalizedWallets,
    projects: normalizedProjects,
    debts: normalizedDebts,
    monthly_flow: normalizedFlow,
    logs: Array.isArray(raw.logs) ? raw.logs : [],
    archive: {
      projects: raw.archive?.projects || {},
      debts: Array.isArray(raw.archive?.debts) ? raw.archive.debts : [],
      monthly_flow: Array.isArray(raw.archive?.monthly_flow) ? raw.archive.monthly_flow : []
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
  }, 3200);
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
 * ============================================================================
 * v1.4 SYSTEM PROMPT (Intent & Entity Extraction Only - Zero Balance Exposure)
 * ============================================================================
 */
function buildSystemPrompt() {
  return `أنت محلل مالي دقيق جداً مهمتك استخراج الحركات المالية من نص المستخدم فقط دون إجراء أي حسابات أو تعديل أرصدة.

الكيانات والمشاريع المعتمدة (طابق أي مرادف يذكره المستخدم مع الاسم القياسي):
- "granola.sy": (مرادفاته: غرانولا، مشروع الغرانولا، شغل الغرانولا).
  * ملاحظة: شراء مواد أولية (مكسرات، شوفان، تغليف) لمشروع الغرانولا من مال المستخدم يُسجل كـ action: "project_asset" لأنه يعتبر أصولاً للمشروع. أما بيع الغرانولا وتحقيق ربح فيُسجل "income" مرتبطاً بمشروع "granola.sy".
- "قص ليزر": (مرادفاته: ورشة الليزر، شغل الليزر، القص).
  * ملاحظة: الورشة ليست ملك المستخدم؛ فإذا استلم مبلغاً إجمالياً لعمل في الورشة (مثلاً استلم 100$: منها 80$ تكاليف مواد وأجور قص للورشة و20$ ربح له)، فككها إلى عمليتين:
    1. عملية "debt_us" بمبلغ 80$ والـ party هو "ورشة قص الليزر" (لأن تكاليف المواد والقص أمانة/دين لصاحب الورشة) مع إيداعها في المحفظة المستلمة.
    2. عملية "income" بمبلغ 20$ لمشروع "قص ليزر" كربح صافي للمستخدم مع إيداعها في المحفظة المستلمة.
- "العطار الحمدو": (مرادفاته: العطار، التاجر اللبناني، بضاعة العطار).
  * ملاحظة: الأموال التي يرسلها العطار الحمدو لتغطية شحن البضاعة أو كرصيد له عند المستخدم تُسجل "debt_us" والـ party هو "العطار الحمدو"، أما ربح المستخدم الصافي منها فيُسجل "income" لمشروع "العطار الحمدو".
  * إذا اقترض المستخدم لنفسه من أموال العطار، أو طلب شخص ثالث (فلان) مبلغاً من طرف العطار الحمدو ("أعطيت فلان 50$ من أموال العطار" أو "فلان استدان من العطار 50$")، سجلها كـ action: "third_party_from_trust" حيث party: "العطار الحمدو" و secondary_party: "اسم الشخص المستلم" ليتم خصمها من أمانة العطار وتوثيق أن فلان استدانها من العطار.

المحافظ المعتمدة ونوع عملتها المقفلة:
- "كاش سوري" [SYP] | "كاش دولار" [USD]
- "شام كاش سوري" [SYP] | "شام كاش دولار" [USD]
- "سيرياتيل كاش" [SYP]
- "Wish Money" [USD]
- "فيزا كارد" [USD]
(إذا ذكر المستخدم "شام كاش" أو "كاش" دون تحديد، اختر تلقائياً المحفظة المطابقة لعملة المبلغ المذكور).

قواعد شركاء السكن والأمانات:
- إذا أعطاني شركاء السكن مالاً لمصاريف المنزل: استخدم action: "housing_contribution" (ليس ديناً وليس ربحاً شخصياً).
- إذا اشتريت أغراضاً أو دفعت مصاريف للسكن المشترك: استخدم action: "housing_expense".
- إذا أرسل لي شخص مالاً لأشتري له به أغراضاً خاصة (مثل ثياب): استخدم action: "debt_us" مع party باسم الشخص، وعند شرائي الأغراض له منها استخدم action: "debt_settle" مع party باسم الشخص و wallet_target المحفظة التي دفعت منها.

أنواع الحركات المسموحة في حقل "action":
- "income": إيراد شخصي، ربح صافي من مشروع، أو مصروف من الوالدة.
- "expense": مصروف شخصي أو تشغيلي لا يُسترد.
- "project_asset": شراء مواد أولية أو أصول لمشروع (مثل مكسرات غرانولا).
- "housing_contribution": مال مستلم من شركاء السكن لمصاريف المنزل.
- "housing_expense": صرف مبلغ على أغراض وفواتير السكن المشترك.
- "debt_us": دين علينا أو أمانة للغير عندنا (أمانة العطار، حصة ورشة الليزر، سلفة من صديق، أمانة شراء ثياب لفلان).
- "debt_them": دين لنا عند الغير (أقرضت شخصاً من مالي).
- "debt_settle": سداد دين علينا أو قبض دين لنا أو صرف من أمانة شخص لشراء أغراضه.
- "third_party_from_trust": إعطاء شخص مبلغاً من أمانة العطار الحمدو الموجودة عندي.
- "transfer": نقل مبلغ بين محفظتين بنفس العملة (حدد wallet_source و wallet_target).
- "exchange": تصريف عملة صريح بطلب المستخدم فقط (حدد amount, currency, wallet_source و amount_to, currency_to, wallet_target).

أرجع كائن JSON صالح فقط بالشكل التالي:
{
  "reply": "ملخص بشري شديد الاختصار لما فهمته من الحركة",
  "operations": [
    {
      "action": "income" | "expense" | "project_asset" | "housing_contribution" | "housing_expense" | "debt_us" | "debt_them" | "debt_settle" | "third_party_from_trust" | "transfer" | "exchange",
      "amount": رقم المبلغ كقيمة موجبة,
      "currency": "USD" أو "SYP" فقط كما ذكرها المستخدم دون أي تحويل,
      "wallet_target": "اسم المحفظة المعتمد من القائمة إن ذُكرت أو null",
      "wallet_source": "اسم المحفظة المصدر في حال التحويل أو التصريف أو null",
      "amount_to": رقم المبلغ الناتج في حال التصريف الصريح فقط أو null,
      "currency_to": "USD" أو "SYP" في حال التصريف الصريح فقط أو null,
      "party": "اسم الشخص/الجهة في حال الديون أو الأمانات أو null",
      "secondary_party": "اسم الطرف الثالث المستفيد إن وجد أو null",
      "project": "granola.sy" | "قص ليزر" | "العطار الحمدو" | null,
      "category": "تصنيف فرعي مثل: مواد أولية، أرباح، مصروف من الوالدة، مصاريف سكن، أمانة ثياب",
      "note": "ملاحظة توضيحية مختصرة"
    }
  ]
}

قواعد صارمة:
1. ممنوع منعاً باتاً تحويل أي عملة لأخرى بسعر الصرف إلا إذا طلب المستخدم صراحة عملية تصريف عملة ("exchange"). ما ذُكر بالدولار يبقى USD وما ذُكر بالليرة يبقى SYP.
2. فكك العمليات المركبة إلى حركات مستقلة ودقيقة.`;
}

/**
 * ============================================================================
 * DETERMINISTIC JAVASCRIPT FINANCIAL ENGINE (`applyFinancialOperations`)
 * Executes extracted operations with strict currency locking & zero hallucination
 * ============================================================================
 */
function describeOperationForPreview(op) {
  const amt = Number(op.amount) || 0;
  const cur = normalizeCurrencyCode(op.currency, op.wallet_target || '', 'SYP');
  const wTarget = resolveCanonicalWallet(op.wallet_target, cur);
  const wSource = resolveCanonicalWallet(op.wallet_source, cur);
  const proj = resolveCanonicalProject(op.project);
  const party = resolveCanonicalParty(op.party);

  switch (op.action) {
    case 'income':
      return `إيراد صافي: +${formatNumber(amt, cur)}${proj ? ` (مشروع ${proj})` : ''}${wTarget ? ` ← إيداع في [${wTarget}]` : ''}`;
    case 'expense':
      return `مصروف: -${formatNumber(amt, cur)} (${op.category || op.note || 'مصروف عام'})${wTarget ? ` ← خصم من [${wTarget}]` : ''}`;
    case 'project_asset':
      return `شراء أصول/مواد أولية لمشروع [${proj || 'granola.sy'}]: ${formatNumber(amt, cur)}${wTarget ? ` ← خصم من [${wTarget}]` : ''}`;
    case 'housing_contribution':
      return `مساهمة من شركاء السكن: +${formatNumber(amt, cur)}${wTarget ? ` ← إيداع في [${wTarget}]` : ''}`;
    case 'housing_expense':
      return `مصروف سكن مشترك: -${formatNumber(amt, cur)} (${op.note || op.category || 'أغراض سكن'})${wTarget ? ` ← خصم من [${wTarget}]` : ''}`;
    case 'debt_us':
      return `تسجيل التزام/أمانة علينا لـ [${party || 'جهة غير محددة'}]: ${formatNumber(amt, cur)}${wTarget ? ` (إيداع النقد في [${wTarget}])` : ''}`;
    case 'debt_them':
      return `تسجيل دين لنا عند [${party || 'جهة غير محددة'}]: ${formatNumber(amt, cur)}${wTarget ? ` (خصم من [${wTarget}])` : ''}`;
    case 'debt_settle':
      return `تسديد/تصفية ذمة [${party || 'جهة غير محددة'}]: ${formatNumber(amt, cur)}${wTarget ? ` عبر [${wTarget}]` : ''}`;
    case 'third_party_from_trust':
      return `صرف من أمانة [${party || 'العطار الحمدو'}] لصالح [${op.secondary_party || 'طرف ثالث'}]: ${formatNumber(amt, cur)}${wTarget ? ` من [${wTarget}]` : ''}`;
    case 'transfer':
      return `نقل رصيد: ${formatNumber(amt, cur)} من [${wSource || 'محفظة'}] إلى [${wTarget || 'محفظة'}]`;
    case 'exchange':
      return `تصريف عملة: ${formatNumber(amt, cur)} من [${wSource || 'محفظة'}] ← ${formatNumber(op.amount_to, op.currency_to || 'SYP')} في [${resolveCanonicalWallet(op.wallet_target, op.currency_to) || 'محفظة'}]`;
    default:
      return `حركة مالية: ${formatNumber(amt, cur)}`;
  }
}

function applyFinancialOperations(operations, summaryReply = '') {
  if (!Array.isArray(operations) || operations.length === 0) return;

  operations.forEach((rawOp) => {
    if (!rawOp || typeof rawOp !== 'object') return;

    const action = String(rawOp.action || '').trim();
    const amt = Math.abs(Number(rawOp.amount) || 0);
    if (amt <= 0) return;

    const cur = normalizeCurrencyCode(rawOp.currency, rawOp.wallet_target || '', 'SYP');
    const walletTargetName = resolveCanonicalWallet(rawOp.wallet_target, cur);
    const walletSourceName = resolveCanonicalWallet(rawOp.wallet_source, cur);
    const projectName = resolveCanonicalProject(rawOp.project);
    const partyName = resolveCanonicalParty(rawOp.party) || 'جهة غير محددة';
    const noteText = String(rawOp.note || rawOp.category || '').trim();

    switch (action) {
      case 'income': {
        // 1. Update Monthly Flow Income
        if (cur === 'USD') appState.monthly_flow.income.totalUSD += amt;
        else appState.monthly_flow.income.totalSYP += amt;

        appState.monthly_flow.income.items.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: noteText || (projectName ? `ربح ${projectName}` : 'إيراد صافي'),
          amount: amt,
          currency: cur,
          date: formatTimestamp()
        });

        // 2. Update Project Net Profit if linked to a project
        if (projectName) {
          const proj = ensureProjectExists(projectName);
          if (cur === 'USD') proj.netUSD += amt;
          else proj.netSYP += amt;
        }

        // 3. Deposit into Target Wallet (Enforcing Currency Match)
        if (walletTargetName) {
          const w = ensureWalletExists(walletTargetName, cur);
          if (w.currency === cur) {
            w.amount += amt;
          }
        }
        break;
      }

      case 'expense': {
        // 1. Update Monthly Flow Expenses
        if (cur === 'USD') appState.monthly_flow.expenses.totalUSD += amt;
        else appState.monthly_flow.expenses.totalSYP += amt;

        appState.monthly_flow.expenses.items.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: noteText || 'مصروف شخصي',
          amount: amt,
          currency: cur,
          date: formatTimestamp()
        });

        // 2. Deduct from Target Wallet (Enforcing Currency Match)
        const targetW = walletTargetName || walletSourceName;
        if (targetW) {
          const w = ensureWalletExists(targetW, cur);
          if (w.currency === cur) {
            w.amount = Math.max(0, w.amount - amt);
          }
        }
        break;
      }

      case 'project_asset': {
        // Buying raw materials/assets for a project (e.g., granola.sy nuts/materials)
        const targetProjName = projectName || 'granola.sy';
        const proj = ensureProjectExists(targetProjName);

        // 1. Increase Project Assets counter
        if (cur === 'USD') proj.assetsUSD = (Number(proj.assetsUSD) || 0) + amt;
        else proj.assetsSYP = (Number(proj.assetsSYP) || 0) + amt;

        // 2. Deduct cash from wallet if specified
        const targetW = walletTargetName || walletSourceName;
        if (targetW) {
          const w = ensureWalletExists(targetW, cur);
          if (w.currency === cur) {
            w.amount = Math.max(0, w.amount - amt);
          }
        }

        // 3. Record in Monthly Flow Expenses as Project Raw Materials
        if (cur === 'USD') appState.monthly_flow.expenses.totalUSD += amt;
        else appState.monthly_flow.expenses.totalSYP += amt;
        appState.monthly_flow.expenses.items.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: `أصول ومواد أولية (${targetProjName}): ${noteText || 'مواد أولية'}`,
          amount: amt,
          currency: cur,
          date: formatTimestamp()
        });
        break;
      }

      case 'housing_contribution': {
        // Money given by roommates for shared housing expenses (Not debt, not personal profit)
        if (!appState.monthly_flow.housing) {
          appState.monthly_flow.housing = { partnersSYP: 0, partnersUSD: 0, spentSYP: 0, spentUSD: 0, items: [] };
        }
        if (cur === 'USD') appState.monthly_flow.housing.partnersUSD += amt;
        else appState.monthly_flow.housing.partnersSYP += amt;

        appState.monthly_flow.housing.items.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          kind: 'contribution',
          title: noteText || (rawOp.party ? `مساهمة سكن من ${rawOp.party}` : 'دفعة من شركاء السكن'),
          amount: amt,
          currency: cur,
          date: formatTimestamp()
        });

        if (walletTargetName) {
          const w = ensureWalletExists(walletTargetName, cur);
          if (w.currency === cur) w.amount += amt;
        }
        break;
      }

      case 'housing_expense': {
        // Spending on shared housing groceries/bills
        if (!appState.monthly_flow.housing) {
          appState.monthly_flow.housing = { partnersSYP: 0, partnersUSD: 0, spentSYP: 0, spentUSD: 0, items: [] };
        }
        if (cur === 'USD') appState.monthly_flow.housing.spentUSD += amt;
        else appState.monthly_flow.housing.spentSYP += amt;

        appState.monthly_flow.housing.items.unshift({
          id: Date.now() + Math.floor(Math.random() * 1000),
          kind: 'expense',
          title: noteText || 'مشتريات ومصاريف سكن مشترك',
          amount: amt,
          currency: cur,
          date: formatTimestamp()
        });

        const targetW = walletTargetName || walletSourceName;
        if (targetW) {
          const w = ensureWalletExists(targetW, cur);
          if (w.currency === cur) w.amount = Math.max(0, w.amount - amt);
        }
        break;
      }

      case 'debt_us': {
        // Obligation on us / trust held for someone (Al-Attar, Laser Workshop share, friend's clothes money, loan)
        const existingDebt = appState.debts.find(
          (d) => d.person === partyName && d.currency === cur && d.type === 'علينا'
        );
        if (existingDebt) {
          existingDebt.amount += amt;
          if (noteText) {
            existingDebt.note = existingDebt.note ? `${existingDebt.note} | ${noteText}` : noteText;
          }
        } else {
          appState.debts.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            person: partyName,
            amount: amt,
            currency: cur,
            type: 'علينا',
            note: noteText || 'أمانة / التزام علينا'
          });
        }

        if (walletTargetName) {
          const w = ensureWalletExists(walletTargetName, cur);
          if (w.currency === cur) w.amount += amt;
        }
        break;
      }

      case 'debt_them': {
        // Debt owed to us by someone else
        const existingDebt = appState.debts.find(
          (d) => d.person === partyName && d.currency === cur && d.type === 'لنا'
        );
        if (existingDebt) {
          existingDebt.amount += amt;
          if (noteText) {
            existingDebt.note = existingDebt.note ? `${existingDebt.note} | ${noteText}` : noteText;
          }
        } else {
          appState.debts.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            person: partyName,
            amount: amt,
            currency: cur,
            type: 'لنا',
            note: noteText || 'دين لنا'
          });
        }

        const sourceW = walletSourceName || walletTargetName;
        if (sourceW) {
          const w = ensureWalletExists(sourceW, cur);
          if (w.currency === cur) w.amount = Math.max(0, w.amount - amt);
        }
        break;
      }

      case 'debt_settle': {
        // Paying off a debt/trust on us OR collecting a debt owed to us
        const targetDebt = appState.debts.find(
          (d) => d.person.includes(partyName) || partyName.includes(d.person)
        );
        const wName = walletTargetName || walletSourceName;

        if (targetDebt) {
          const wasUs = targetDebt.type === 'علينا';
          targetDebt.amount = Math.max(0, (Number(targetDebt.amount) || 0) - amt);
          if (targetDebt.amount <= 0) targetDebt.settled = true;

          if (wName) {
            const w = ensureWalletExists(wName, targetDebt.currency);
            if (w.currency === targetDebt.currency) {
              if (wasUs) {
                w.amount = Math.max(0, w.amount - amt);
              } else {
                w.amount += amt;
              }
            }
          }
        } else if (wName) {
          const w = ensureWalletExists(wName, cur);
          if (w.currency === cur) w.amount = Math.max(0, w.amount - amt);
        }
        break;
      }

      case 'third_party_from_trust': {
        // Someone took/borrowed money from Al-Attar Al-Hamdo's funds held by the user
        const trustOwner = resolveCanonicalParty(rawOp.party) || 'العطار الحمدو';
        const beneficiary = String(rawOp.secondary_party || 'طرف ثالث').trim();
        const trustRecord = appState.debts.find(
          (d) => d.person === trustOwner && d.currency === cur && d.type === 'علينا'
        );

        const docNote = `استلم/استدان [${beneficiary}] مبلغ ${formatNumber(amt, cur)} من أموال ${trustOwner}${noteText ? ` (${noteText})` : ''}`;

        if (trustRecord) {
          trustRecord.amount = Math.max(0, trustRecord.amount - amt);
          trustRecord.note = trustRecord.note ? `${trustRecord.note} | ${docNote}` : docNote;
          if (trustRecord.amount <= 0) trustRecord.settled = true;
        }

        // Also record a reminder note under debts so the user always sees that [beneficiary] took from Al-Attar
        appState.debts.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          person: `${beneficiary} (من طرف ${trustOwner})`,
          amount: amt,
          currency: cur,
          type: 'لنا',
          note: docNote
        });

        const wName = walletSourceName || walletTargetName;
        if (wName) {
          const w = ensureWalletExists(wName, cur);
          if (w.currency === cur) w.amount = Math.max(0, w.amount - amt);
        }
        break;
      }

      case 'transfer': {
        // Same-currency transfer between two wallets
        if (walletSourceName && walletTargetName) {
          const wSrc = ensureWalletExists(walletSourceName, cur);
          const wDst = ensureWalletExists(walletTargetName, cur);
          if (wSrc.currency === wDst.currency) {
            wSrc.amount = Math.max(0, wSrc.amount - amt);
            wDst.amount += amt;
          }
        }
        break;
      }

      case 'exchange': {
        // Explicit currency exchange requested by user
        const curTo = normalizeCurrencyCode(rawOp.currency_to, rawOp.wallet_target || '', cur === 'USD' ? 'SYP' : 'USD');
        const amtTo = Math.abs(Number(rawOp.amount_to) || 0);
        const wSrcName = resolveCanonicalWallet(rawOp.wallet_source, cur);
        const wDstName = resolveCanonicalWallet(rawOp.wallet_target, curTo);

        if (wSrcName) {
          const wSrc = ensureWalletExists(wSrcName, cur);
          if (wSrc.currency === cur) wSrc.amount = Math.max(0, wSrc.amount - amt);
        }
        if (wDstName && amtTo > 0) {
          const wDst = ensureWalletExists(wDstName, curTo);
          if (wDst.currency === curTo) wDst.amount += amtTo;
        }
        break;
      }
    }
  });

  archiveClosedItems(appState);
  saveStateToStorage();
  renderUI();
}

/**
 * ============================================================================
 * RENDER COMPLETE UI (Zero Currency Merging)
 * ============================================================================
 */
function renderUI() {
  const fx = Number(appState.fx_rate) || 15000;

  const fxEl = document.getElementById('header-fx-value');
  if (fxEl) fxEl.textContent = formatNumber(fx);

  const logsBadge = document.getElementById('logs-count-badge');
  if (logsBadge) logsBadge.textContent = String((appState.logs || []).length);

  // Top 2 Summary Cards: Total Cash in SYP & Total Cash in USD
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

  renderWalletsSection();
  renderProjectsSection();
  renderHousingSection();
  renderMonthlyFlowSection();
  renderDebtsSection();
  renderContextLogsStrip();
}

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
        <div>لا توجد محافظ مضافة حالياً. يمكنك إضافة محفظة أو تهيئة المحافظ المعتمدة من الإعدادات، أو إرسال أمر للمساعد الذكي لينشئها تلقائياً.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = entries.map(([name, data]) => {
    const amount = Number(data.amount) || 0;
    const currency = (data.currency || 'SYP').toUpperCase();
    const currencyLabel = currency === 'USD' ? 'عملة مقفلة: دولار أمريكي (USD)' : 'عملة مقفلة: ليرة سورية (SYP)';
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
        <span>لا توجد مشاريع مسجلة حالياً. عند ذكر (granola.sy، قص ليزر، العطار الحمدو) سيقوم النظام بإضافتها وتتبع أصولها وأرباحها.</span>
      </div>
    `;
    return;
  }

  grid.innerHTML = entries.map(([name, proj]) => {
    const netSYP = Number(proj.netSYP) || 0;
    const netUSD = Number(proj.netUSD) || 0;
    const assetsSYP = Number(proj.assetsSYP) || 0;
    const assetsUSD = Number(proj.assetsUSD) || 0;
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
            <span class="badge-pill num-ltr">ربح: ${formatNumber(netSYP, 'SYP')}</span>
            <span class="badge-pill num-ltr">ربح: ${formatNumber(netUSD, 'USD')}</span>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; padding:0.6rem; border-radius:0.6rem; background-color:var(--bg-subtle); font-size:0.75rem;">
          <div>
            <span style="color:var(--text-muted); display:block; font-size:0.68rem;">صافي الأرباح المحققة:</span>
            <strong class="num-ltr" style="color:var(--emerald-primary);">${formatNumber(netSYP, 'SYP')} | ${formatNumber(netUSD, 'USD')}</strong>
          </div>
          <div>
            <span style="color:var(--text-muted); display:block; font-size:0.68rem;">أصول ومواد أولية بالمشروع:</span>
            <strong class="num-ltr" style="color:var(--amber-text);">${formatNumber(assetsSYP, 'SYP')} | ${formatNumber(assetsUSD, 'USD')}</strong>
          </div>
        </div>

        <div style="display:flex; align-items:center; justify-content:flex-end; gap:0.45rem; padding-top:0.5rem; border-top:1px solid var(--border-hairline);">
          <button type="button" onclick="openProjectEditModal('${safeName}')" class="btn-secondary">تعديل الأرباح / الأصول</button>
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
 * Render Shared Housing Section (فصل ما دفعه شركاء السكن عما دفعته أنا)
 */
function renderHousingSection() {
  const h = appState.monthly_flow?.housing || { partnersSYP: 0, partnersUSD: 0, spentSYP: 0, spentUSD: 0 };
  const pSyp = Number(h.partnersSYP) || 0;
  const pUsd = Number(h.partnersUSD) || 0;
  const sSyp = Number(h.spentSYP) || 0;
  const sUsd = Number(h.spentUSD) || 0;

  // Net paid from user's own pocket = max(0, totalSpent - partnersContributed)
  const mySyp = Math.max(0, sSyp - pSyp);
  const myUsd = Math.max(0, sUsd - pUsd);

  const elPSyp = document.getElementById('housing-partners-syp');
  const elPUsd = document.getElementById('housing-partners-usd');
  const elSSyp = document.getElementById('housing-spent-syp');
  const elSUsd = document.getElementById('housing-spent-usd');
  const elMySyp = document.getElementById('housing-myshare-syp');
  const elMyUsd = document.getElementById('housing-myshare-usd');

  if (elPSyp) elPSyp.textContent = formatNumber(pSyp, 'SYP');
  if (elPUsd) elPUsd.textContent = formatNumber(pUsd, 'USD');
  if (elSSyp) elSSyp.textContent = formatNumber(sSyp, 'SYP');
  if (elSUsd) elSUsd.textContent = formatNumber(sUsd, 'USD');
  if (elMySyp) elMySyp.textContent = formatNumber(mySyp, 'SYP');
  if (elMyUsd) elMyUsd.textContent = formatNumber(myUsd, 'USD');
}

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
        <span>لا توجد ديون أو أمانات نشطة حالياً.</span>
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
 * FX MODAL & LIVE CALCULATOR + HYBRID MODALS
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
    sypInput.value = isNaN(usdVal) ? '' : Math.round(usdVal * rate);
  } else if (sourceField === 'syp') {
    const sypVal = parseFloat(sypInput.value);
    usdInput.value = isNaN(sypVal) ? '' : Number((sypVal / rate).toFixed(2));
  }
}

function openWalletModal() {
  currentHybridContext = { type: 'new_wallet' };
  document.getElementById('hybrid-modal-title').textContent = 'إضافة محفظة نقدية أو إلكترونية';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div>
      <label class="field-label">اختر من المحافظ المعتمدة أو اكتب اسماً مخصصاً:</label>
      <input id="hybrid-wallet-name" list="approved-wallets-datalist" type="text" required placeholder="مثال: شام كاش دولار أو سيرياتيل كاش" />
      <datalist id="approved-wallets-datalist">
        <option value="كاش سوري">كاش سوري (SYP)</option>
        <option value="كاش دولار">كاش دولار (USD)</option>
        <option value="شام كاش سوري">شام كاش سوري (SYP)</option>
        <option value="شام كاش دولار">شام كاش دولار (USD)</option>
        <option value="سيرياتيل كاش">سيرياتيل كاش (SYP)</option>
        <option value="Wish Money">Wish Money (USD)</option>
        <option value="فيزا كارد">فيزا كارد (USD)</option>
      </datalist>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">العملة المقفلة:</label>
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

function openTransferModal() {
  const walletNames = Object.keys(appState.wallets || {});
  if (walletNames.length < 2) {
    showToast('يرجى إضافة محفظتين على الأقل لإجراء تحويل');
    return;
  }
  const options = walletNames.map((w) => `<option value="${escapeHtml(w)}">${escapeHtml(w)} (${appState.wallets[w].currency})</option>`).join('');
  currentHybridContext = { type: 'transfer_wallets' };
  document.getElementById('hybrid-modal-title').textContent = 'تحويل رصيد بين محفظتين';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">من المحفظة المصدر:</label>
        <select id="hybrid-transfer-source">${options}</select>
      </div>
      <div>
        <label class="field-label">إلى المحفظة الهدف:</label>
        <select id="hybrid-transfer-target">${options}</select>
      </div>
    </div>
    <div>
      <label class="field-label">المبلغ المراد نقله (بنفس العملة):</label>
      <input id="hybrid-transfer-amount" type="number" step="any" min="0.01" required placeholder="0" class="num-ltr" />
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
  document.getElementById('hybrid-modal-title').textContent = 'إضافة مشروع (granola.sy / قص ليزر / العطار)';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div>
      <label class="field-label">اسم المشروع:</label>
      <input id="hybrid-proj-name" list="approved-projects-datalist" type="text" required placeholder="مثال: granola.sy أو قص ليزر" />
      <datalist id="approved-projects-datalist">
        <option value="granola.sy">granola.sy (مشروع الغرانولا)</option>
        <option value="قص ليزر">قص ليزر (ورشة الليزر)</option>
        <option value="العطار الحمدو">العطار الحمدو (التاجر اللبناني)</option>
      </datalist>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">صافي الربح (SYP):</label>
        <input id="hybrid-proj-syp" type="number" step="any" value="0" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">صافي الربح (USD):</label>
        <input id="hybrid-proj-usd" type="number" step="any" value="0" class="num-ltr" />
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">أصول / مواد أولية (SYP):</label>
        <input id="hybrid-proj-assets-syp" type="number" step="any" value="0" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">أصول / مواد أولية (USD):</label>
        <input id="hybrid-proj-assets-usd" type="number" step="any" value="0" class="num-ltr" />
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
        <label class="field-label">صافي الربح (SYP):</label>
        <input id="hybrid-proj-syp" type="number" step="any" required value="${Number(proj.netSYP) || 0}" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">صافي الربح (USD):</label>
        <input id="hybrid-proj-usd" type="number" step="any" required value="${Number(proj.netUSD) || 0}" class="num-ltr" />
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">أصول / مواد أولية (SYP):</label>
        <input id="hybrid-proj-assets-syp" type="number" step="any" required value="${Number(proj.assetsSYP) || 0}" class="num-ltr" />
      </div>
      <div>
        <label class="field-label">أصول / مواد أولية (USD):</label>
        <input id="hybrid-proj-assets-usd" type="number" step="any" required value="${Number(proj.assetsUSD) || 0}" class="num-ltr" />
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

function openHousingModal() {
  currentHybridContext = { type: 'housing_entry' };
  const walletOptions = Object.keys(appState.wallets || {}).map((w) =>
    `<option value="${escapeHtml(w)}">${escapeHtml(w)} (${appState.wallets[w].currency})</option>`
  ).join('');

  document.getElementById('hybrid-modal-title').textContent = 'ميزانية السكن المشترك (شركاء السكن)';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">نوع الحركة:</label>
        <select id="hybrid-housing-kind">
          <option value="housing_contribution">دفعة استلمتها من شركاء السكن</option>
          <option value="housing_expense">شراء أغراض ومصاريف للسكن</option>
        </select>
      </div>
      <div>
        <label class="field-label">العملة:</label>
        <select id="hybrid-housing-currency">
          <option value="SYP">SYP (ليرة سورية)</option>
          <option value="USD">USD (دولار أمريكي)</option>
        </select>
      </div>
    </div>
    <div>
      <label class="field-label">المبلغ:</label>
      <input id="hybrid-housing-amount" type="number" step="any" min="0.01" required placeholder="0" class="num-ltr" />
    </div>
    <div>
      <label class="field-label">المحفظة النقدية المتأثرة (اختياري):</label>
      <select id="hybrid-housing-wallet">
        <option value="">-- بدون تعديل محفظة --</option>
        ${walletOptions}
      </select>
    </div>
    <div>
      <label class="field-label">ملاحظة:</label>
      <input id="hybrid-housing-note" type="text" placeholder="مثال: فاتورة كهرباء أو دفعة من أحمد للسكن" />
    </div>
  `;
  showHybridModal();
}

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
          <option value="income">إيراد / ربح صافي (Income)</option>
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
      <input id="hybrid-flow-title" type="text" required placeholder="مثال: مصروف من الوالدة أو مصاريف شخصية" />
    </div>
    <div>
      <label class="field-label">المبلغ:</label>
      <input id="hybrid-flow-amount" type="number" step="any" min="0.01" required placeholder="0" class="num-ltr" />
    </div>
    <div>
      <label class="field-label">المحفظة النقدية المتأثرة (اختياري):</label>
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
    expenses: { totalSYP: 0, totalUSD: 0, items: [] },
    housing: { partnersSYP: 0, partnersUSD: 0, spentSYP: 0, spentUSD: 0, items: [] }
  };

  const hasData = (Number(flow.income?.totalSYP) || 0) > 0 ||
    (Number(flow.income?.totalUSD) || 0) > 0 ||
    (Number(flow.expenses?.totalSYP) || 0) > 0 ||
    (Number(flow.expenses?.totalUSD) || 0) > 0 ||
    (Number(flow.housing?.partnersSYP) || 0) > 0 ||
    (Number(flow.housing?.spentSYP) || 0) > 0 ||
    (Number(flow.housing?.partnersUSD) || 0) > 0 ||
    (Number(flow.housing?.spentUSD) || 0) > 0;

  if (!hasData) {
    showToast('عدادات الشهر الحالي مصفّرة بالفعل');
    return;
  }

  if (!appState.archive) appState.archive = { projects: {}, debts: [], monthly_flow: [] };
  if (!Array.isArray(appState.archive.monthly_flow)) appState.archive.monthly_flow = [];

  appState.archive.monthly_flow.unshift({
    archivedAt: formatTimestamp(),
    income: JSON.parse(JSON.stringify(flow.income)),
    expenses: JSON.parse(JSON.stringify(flow.expenses)),
    housing: JSON.parse(JSON.stringify(flow.housing || {}))
  });

  appState.monthly_flow = {
    income: { totalSYP: 0, totalUSD: 0, items: [] },
    expenses: { totalSYP: 0, totalUSD: 0, items: [] },
    housing: { partnersSYP: 0, partnersUSD: 0, spentSYP: 0, spentUSD: 0, items: [] }
  };

  appendLog('أرشفة التدفق المالي وميزانية السكن للشهر وتصفير العدادات لبدء شهر جديد');
  saveStateToStorage();
  renderUI();
  showToast('تمت أرشفة الشهر وتصفير عدادات التدفق والسكن');
}

function openDebtModal() {
  currentHybridContext = { type: 'new_debt' };
  document.getElementById('hybrid-modal-title').textContent = 'إضافة دين أو أمانة مالية';
  document.getElementById('hybrid-modal-fields').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
      <div>
        <label class="field-label">الاسم / الجهة:</label>
        <input id="hybrid-debt-person" type="text" required placeholder="مثال: العطار الحمدو أو ورشة الليزر" />
      </div>
      <div>
        <label class="field-label">نوع الذمة:</label>
        <select id="hybrid-debt-type">
          <option value="علينا">علينا (التزام أو أمانة للغير عندنا)</option>
          <option value="لنا">لنا (مستحق لنا عند الغير)</option>
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
      <label class="field-label">ملاحظة (مثل: أمانة لشراء ثياب / استدانة من أموال العطار):</label>
      <input id="hybrid-debt-note" type="text" placeholder="تفاصيل الذمة أو الأمانة" />
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
    const rawName = document.getElementById('hybrid-wallet-name').value.trim();
    const selectedCur = document.getElementById('hybrid-wallet-currency').value;
    const amount = Number(document.getElementById('hybrid-wallet-amount').value) || 0;
    if (rawName) {
      const lockedCur = LOCKED_WALLETS_REGISTRY[rawName] || selectedCur;
      appState.wallets[rawName] = { amount, currency: lockedCur };
      appendLog(`إنشاء محفظة "${rawName}" برصيد ${formatNumber(amount, lockedCur)}`);
      saveStateToStorage();
      renderUI();
      showToast(`تمت إضافة محفظة ${rawName}`);
    }
  } else if (ctx.type === 'transfer_wallets') {
    const src = document.getElementById('hybrid-transfer-source').value;
    const dst = document.getElementById('hybrid-transfer-target').value;
    const amt = Number(document.getElementById('hybrid-transfer-amount').value) || 0;
    if (src && dst && src !== dst && amt > 0) {
      const wSrc = appState.wallets[src];
      const wDst = appState.wallets[dst];
      if (wSrc && wDst) {
        if (wSrc.currency !== wDst.currency) {
          showToast(`تعارض عملة: لا يمكن النقل المباشر بين ${wSrc.currency} و ${wDst.currency}`);
          return;
        }
        wSrc.amount = Math.max(0, (Number(wSrc.amount) || 0) - amt);
        wDst.amount = (Number(wDst.amount) || 0) + amt;
        appendLog(`تحويل ${formatNumber(amt, wSrc.currency)} من "${src}" إلى "${dst}"`);
        saveStateToStorage();
        renderUI();
        showToast('تم التحويل بين المحفظتين بنجاح');
      }
    }
  } else if (ctx.type === 'adjust_wallet') {
    const wallet = appState.wallets[ctx.walletName];
    const val = Number(document.getElementById('hybrid-adjust-amount').value) || 0;
    const note = document.getElementById('hybrid-adjust-note').value.trim();
    if (wallet) {
      const oldAmt = Number(wallet.amount) || 0;
      let newAmt = oldAmt;
      if (ctx.mode === 'deposit') newAmt = oldAmt + val;
      if (ctx.mode === 'withdraw') newAmt = Math.max(0, oldAmt - val);
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
    const assetsSYP = Number(document.getElementById('hybrid-proj-assets-syp').value) || 0;
    const assetsUSD = Number(document.getElementById('hybrid-proj-assets-usd').value) || 0;
    const summary = document.getElementById('hybrid-proj-summary').value.trim() || CANONICAL_PROJECTS[name] || 'مشروع نشط';
    if (name) {
      appState.projects[name] = { netSYP, netUSD, assetsSYP, assetsUSD, summary };
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
      proj.assetsSYP = Number(document.getElementById('hybrid-proj-assets-syp').value) || 0;
      proj.assetsUSD = Number(document.getElementById('hybrid-proj-assets-usd').value) || 0;
      proj.summary = document.getElementById('hybrid-proj-summary').value.trim() || proj.summary;
      appendLog(`تعديل بيانات مشروع "${ctx.projName}"`);
      archiveClosedItems(appState);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث المشروع');
    }
  } else if (ctx.type === 'housing_entry') {
    const kind = document.getElementById('hybrid-housing-kind').value;
    const cur = document.getElementById('hybrid-housing-currency').value;
    const amt = Number(document.getElementById('hybrid-housing-amount').value) || 0;
    const wallet = document.getElementById('hybrid-housing-wallet').value;
    const note = document.getElementById('hybrid-housing-note').value.trim();
    if (amt > 0) {
      applyFinancialOperations([{
        action: kind,
        amount: amt,
        currency: cur,
        wallet_target: wallet || null,
        note: note || (kind === 'housing_contribution' ? 'دفعة من شركاء السكن' : 'مصروف سكن مشترك')
      }]);
      appendLog(`${kind === 'housing_contribution' ? 'استلام مساهمة سكن' : 'صرف للسكن المشترك'}: ${formatNumber(amt, cur)}`);
      saveStateToStorage();
      renderUI();
      showToast('تم تحديث ميزانية السكن المشترك');
    }
  } else if (ctx.type === 'new_monthly_flow') {
    const flowType = document.getElementById('hybrid-flow-type').value;
    const currency = document.getElementById('hybrid-flow-currency').value;
    const title = document.getElementById('hybrid-flow-title').value.trim();
    const amount = Number(document.getElementById('hybrid-flow-amount').value) || 0;
    const selectedWallet = document.getElementById('hybrid-flow-wallet').value;

    if (title && amount > 0) {
      applyFinancialOperations([{
        action: flowType === 'income' ? 'income' : 'expense',
        amount,
        currency,
        wallet_target: selectedWallet || null,
        note: title
      }]);
      appendLog(`تسجيل ${flowType === 'income' ? 'إيراد' : 'مصروف'}: "${title}" (${formatNumber(amount, currency)})`);
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
 * Initialize Approved Wallets & Projects with 0 Balance (Optional 1-Click Helper in Settings)
 */
function initApprovedStructureZeroBalance() {
  Object.entries(LOCKED_WALLETS_REGISTRY).forEach(([wName, cur]) => {
    if (!appState.wallets[wName]) {
      appState.wallets[wName] = { amount: 0, currency: cur };
    }
  });
  Object.entries(CANONICAL_PROJECTS).forEach(([pName, summary]) => {
    if (!appState.projects[pName]) {
      appState.projects[pName] = { netSYP: 0, netUSD: 0, assetsSYP: 0, assetsUSD: 0, summary };
    }
  });
  saveStateToStorage();
  renderUI();
  closeSettingsModal();
  showToast('تم إنشاء المحافظ الـ 7 والمشاريع الـ 3 برصيد صفر');
}

/**
 * ============================================================================
 * AI ASSISTANT BOTTOM SHEET & DEEPSEEK API (Intent & Operations Extraction)
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
    const systemPrompt = buildSystemPrompt();
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
        temperature: 0.0,
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

    const operations = Array.isArray(parsed.operations) ? parsed.operations : [];
    if (operations.length === 0) {
      throw new Error('لم يتم رصد عمليات مالية قابلة للتنفيذ في النص.');
    }

    presentAIOperationsProposal(commandText, {
      reply: parsed.reply || 'تم استخراج العمليات المالية بنجاح.',
      operations
    });
  } catch (err) {
    showToast(err.message || 'تعذر الاتصال بخدمة DeepSeek API');
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function presentAIOperationsProposal(commandText, aiResult) {
  pendingAIOperations = {
    commandText,
    reply: aiResult.reply,
    operations: aiResult.operations
  };

  const replyContainer = document.getElementById('ai-reply-container');
  const replyTextEl = document.getElementById('ai-reply-text');
  const diffPreviewEl = document.getElementById('ai-diff-preview');
  const badgeEl = document.getElementById('ai-validation-badge');

  replyTextEl.textContent = pendingAIOperations.reply;
  badgeEl.textContent = `${aiResult.operations.length} عملية حتمية`;
  badgeEl.className = 'badge-pill';

  diffPreviewEl.innerHTML = aiResult.operations.map((op, i) => {
    return `<div style="color:var(--text-main); font-weight:600;">${i + 1}. ${escapeHtml(describeOperationForPreview(op))}</div>`;
  }).join('');

  replyContainer.classList.remove('hidden');
}

function discardAIReply() {
  pendingAIOperations = null;
  const replyContainer = document.getElementById('ai-reply-container');
  if (replyContainer) replyContainer.classList.add('hidden');
}

function approveAndApplyAIState() {
  if (!pendingAIOperations || !Array.isArray(pendingAIOperations.operations)) return;

  applyFinancialOperations(pendingAIOperations.operations, pendingAIOperations.reply);
  appendLog(`${pendingAIOperations.commandText} — ${pendingAIOperations.reply}`);
  saveStateToStorage();
  renderUI();

  const inputEl = document.getElementById('ai-command-input');
  if (inputEl) inputEl.value = '';
  discardAIReply();
  closeAIBottomSheet();
  showToast('تم تنفيذ العمليات الحسابية بدقة');
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
    logsContainer.innerHTML = logs.map((item) => `
      <div class="log-row" style="flex-direction:column; align-items:stretch; gap:0.25rem;">
        <span style="font-weight:600; color:var(--text-main);">${escapeHtml(item.text)}</span>
        <span class="num-ltr" style="font-size:0.65rem; color:var(--text-muted);">${escapeHtml(item.date)}</span>
      </div>
    `).join('');
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
  safeRemoveStorage('my_wallet_state_v1_1');
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
  openTransferModal,
  openWalletAdjustModal,
  deleteWalletLocally,
  openProjectModal,
  openProjectEditModal,
  deleteProjectLocally,
  openHousingModal,
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
  initApprovedStructureZeroBalance,
  openAIBottomSheet,
  closeAIBottomSheet,
  sendCommandToAI,
  discardAIReply,
  approveAndApplyAIState,

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
