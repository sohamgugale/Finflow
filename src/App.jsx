import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine
} from "recharts";

// ─── SEED DATA ENGINE ────────────────────────────────────────────────────────
const CATEGORIES = {
  food: { label: "Food & Dining", icon: "🍜", color: "#F97316" },
  housing: { label: "Housing", icon: "🏠", color: "#8B5CF6" },
  transport: { label: "Transport", icon: "🚇", color: "#3B82F6" },
  entertainment: { label: "Entertainment", icon: "🎮", color: "#EC4899" },
  health: { label: "Health", icon: "💊", color: "#10B981" },
  shopping: { label: "Shopping", icon: "🛍️", color: "#F59E0B" },
  utilities: { label: "Utilities", icon: "⚡", color: "#6366F1" },
  income: { label: "Income", icon: "💰", color: "#22C55E" },
};

const MERCHANTS = {
  food: ["Chipotle", "Trader Joe's", "Whole Foods", "DoorDash", "Starbucks", "Sweetgreen", "McDonald's", "Panera"],
  housing: ["Duke Housing", "Zillow Rent", "Maintenance Co."],
  transport: ["Uber", "Lyft", "GoTriangle", "Shell Gas", "Tesla Supercharger"],
  entertainment: ["Netflix", "Spotify", "Steam", "AMC Theaters", "Apple TV+"],
  health: ["CVS Pharmacy", "Duke Health", "Equinox", "GoodRx"],
  shopping: ["Amazon", "Target", "IKEA", "Best Buy", "Zara"],
  utilities: ["Duke Energy", "AT&T", "Google One", "AWS"],
  income: ["Duke TA Stipend", "Freelance Transfer", "Venmo Refund"],
};

function seedTransactions() {
  const now = new Date();
  const txns = [];
  let id = 1;

  for (let m = 5; m >= 0; m--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

    // Income
    txns.push({
      id: id++, type: "income", category: "income",
      amount: 1850 + Math.floor(Math.random() * 200),
      merchant: "Duke TA Stipend",
      date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).toISOString().split("T")[0],
      note: "Monthly stipend",
    });
    if (Math.random() > 0.5) {
      txns.push({
        id: id++, type: "income", category: "income",
        amount: 80 + Math.floor(Math.random() * 220),
        merchant: "Freelance Transfer",
        date: new Date(monthDate.getFullYear(), monthDate.getMonth(), 15).toISOString().split("T")[0],
        note: "Side project",
      });
    }

    // Expenses
    const expCats = ["food", "housing", "transport", "entertainment", "health", "shopping", "utilities"];
    expCats.forEach(cat => {
      const count = cat === "food" ? 10 + Math.floor(Math.random() * 8)
        : cat === "housing" ? 1
        : cat === "shopping" ? 2 + Math.floor(Math.random() * 3)
        : 2 + Math.floor(Math.random() * 4);

      for (let i = 0; i < count; i++) {
        const day = 1 + Math.floor(Math.random() * (daysInMonth - 1));
        const merchants = MERCHANTS[cat];
        const merchant = merchants[Math.floor(Math.random() * merchants.length)];
        const baseAmt = cat === "housing" ? 780
          : cat === "utilities" ? 40 + Math.random() * 60
          : cat === "food" ? 8 + Math.random() * 42
          : cat === "transport" ? 6 + Math.random() * 30
          : cat === "entertainment" ? 10 + Math.random() * 25
          : cat === "health" ? 12 + Math.random() * 60
          : 15 + Math.random() * 80;

        // Inject anomaly in most recent month
        const anomalyFactor = m === 0 && cat === "shopping" && i === 0 ? 4.5 : 1;
        txns.push({
          id: id++, type: "expense", category: cat,
          amount: Math.round(baseAmt * anomalyFactor * 100) / 100,
          merchant,
          date: new Date(monthDate.getFullYear(), monthDate.getMonth(), day).toISOString().split("T")[0],
          note: "",
          anomaly: anomalyFactor > 2,
        });
      }
    });
  }

  return txns.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ─── ANALYTICS ENGINE ────────────────────────────────────────────────────────
function computeMonthlyTotals(txns) {
  const map = {};
  txns.forEach(t => {
    const key = t.date.slice(0, 7);
    if (!map[key]) map[key] = { month: key, income: 0, expenses: 0, net: 0 };
    if (t.type === "income") map[key].income += t.amount;
    else map[key].expenses += t.amount;
  });
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({
    ...m,
    net: m.income - m.expenses,
    label: new Date(m.month + "-15").toLocaleString("default", { month: "short" }),
  }));
}

function computeCategoryBreakdown(txns, month) {
  const filtered = month ? txns.filter(t => t.date.startsWith(month)) : txns;
  const map = {};
  filtered.filter(t => t.type === "expense").forEach(t => {
    map[t.category] = (map[t.category] || 0) + t.amount;
  });
  return Object.entries(map).map(([cat, amt]) => ({
    name: CATEGORIES[cat].label,
    icon: CATEGORIES[cat].icon,
    color: CATEGORIES[cat].color,
    value: Math.round(amt * 100) / 100,
    cat,
  })).sort((a, b) => b.value - a.value);
}

function detectAnomalies(txns) {
  // Z-score per category
  const catAmounts = {};
  txns.filter(t => t.type === "expense").forEach(t => {
    if (!catAmounts[t.category]) catAmounts[t.category] = [];
    catAmounts[t.category].push(t.amount);
  });

  const stats = {};
  Object.entries(catAmounts).forEach(([cat, amts]) => {
    const mean = amts.reduce((a, b) => a + b, 0) / amts.length;
    const std = Math.sqrt(amts.reduce((a, b) => a + (b - mean) ** 2, 0) / amts.length);
    stats[cat] = { mean, std };
  });

  return txns.filter(t => t.type === "expense").map(t => {
    const { mean, std } = stats[t.category] || { mean: 0, std: 1 };
    const z = std > 0 ? (t.amount - mean) / std : 0;
    return { ...t, zScore: z, isAnomaly: z > 2.2 };
  }).filter(t => t.isAnomaly).slice(0, 6);
}

function forecastBudget(txns, category) {
  const monthly = {};
  txns.filter(t => t.type === "expense" && (!category || t.category === category)).forEach(t => {
    const key = t.date.slice(0, 7);
    monthly[key] = (monthly[key] || 0) + t.amount;
  });
  const vals = Object.values(monthly);
  if (vals.length < 2) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const trend = (vals[vals.length - 1] - vals[0]) / vals.length;
  return { avg: Math.round(avg), forecast: Math.round(avg + trend * 0.5), trend };
}

function computeDailySpend(txns) {
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const days = {};
  txns.filter(t => t.type === "expense" && t.date.startsWith(month)).forEach(t => {
    const d = parseInt(t.date.split("-")[2]);
    days[d] = (days[d] || 0) + t.amount;
  });

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const result = [];
  let cumulative = 0;
  for (let d = 1; d <= Math.min(now.getDate(), daysInMonth); d++) {
    cumulative += days[d] || 0;
    result.push({ day: d, daily: Math.round((days[d] || 0) * 100) / 100, cumulative: Math.round(cumulative * 100) / 100 });
  }
  return result;
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────
const fmt = (n) => n?.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtD = (n) => n?.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatCard({ label, value, sub, accent, icon, trend }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16, padding: "20px 24px", display: "flex", flexDirection: "column", gap: 6,
      backdropFilter: "blur(10px)", transition: "border-color 0.2s",
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = accent + "66"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, letterSpacing: "0.12em", color: "#888", textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 20 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: accent || "#fff", fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: trend === "up" ? "#10B981" : trend === "down" ? "#F87171" : "#666" }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <div style={{ width: 3, height: 18, background: "linear-gradient(to bottom, #7C3AED, #3B82F6)", borderRadius: 2 }} />
      <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#aaa" }}>{children}</span>
    </div>
  );
}

const CUSTOM_TOOLTIP_STYLE = {
  background: "#111", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#eee",
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={CUSTOM_TOOLTIP_STYLE}>
      <div style={{ color: "#888", marginBottom: 6, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || "#fff", fontFamily: "monospace" }}>
          {p.name}: <strong>{fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

// ─── MODAL: Add Transaction ───────────────────────────────────────────────────
function AddModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ type: "expense", category: "food", merchant: "", amount: "", date: new Date().toISOString().split("T")[0], note: "" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: 32, width: 420, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Add Transaction</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>

        {/* Type toggle */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 4 }}>
          {["expense", "income"].map(t => (
            <button key={t} onClick={() => set("type", t)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.2s",
              background: form.type === t ? (t === "income" ? "#10B981" : "#EF4444") : "transparent",
              color: form.type === t ? "#fff" : "#888",
            }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>

        {[
          { label: "Merchant / Description", key: "merchant", type: "text", placeholder: "e.g. Whole Foods" },
          { label: "Amount ($)", key: "amount", type: "number", placeholder: "0.00" },
          { label: "Date", key: "date", type: "date" },
        ].map(f => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>{f.label}</span>
            <input type={f.type} value={form[f.key]} placeholder={f.placeholder}
              onChange={e => set(f.key, e.target.value)}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none" }} />
          </label>
        ))}

        {form.type === "expense" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Category</span>
            <select value={form.category} onChange={e => set("category", e.target.value)}
              style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none" }}>
              {Object.entries(CATEGORIES).filter(([k]) => k !== "income").map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </label>
        )}

        <button onClick={() => {
          if (!form.amount || !form.merchant) return;
          onAdd({ ...form, id: Date.now(), amount: parseFloat(form.amount), category: form.type === "income" ? "income" : form.category });
          onClose();
        }} style={{
          background: "linear-gradient(135deg, #7C3AED, #3B82F6)", border: "none", borderRadius: 12,
          padding: "13px 0", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 4,
        }}>Add Transaction</button>
      </div>
    </div>
  );
}

// ─── BUDGET SETTINGS MODAL ────────────────────────────────────────────────────
function BudgetModal({ budgets, onClose, onSave }) {
  const [local, setLocal] = useState({ ...budgets });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: 32, width: 400, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>Monthly Budgets</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 20 }}>✕</button>
        </div>
        {Object.entries(CATEGORIES).filter(([k]) => k !== "income").map(([k, v]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 130, fontSize: 13, color: "#ccc" }}>{v.icon} {v.label}</span>
            <input type="number" value={local[k] || ""} placeholder="No limit"
              onChange={e => setLocal(l => ({ ...l, [k]: parseFloat(e.target.value) || 0 }))}
              style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 14, outline: "none" }} />
          </label>
        ))}
        <button onClick={() => { onSave(local); onClose(); }} style={{
          background: "linear-gradient(135deg, #7C3AED, #3B82F6)", border: "none", borderRadius: 12,
          padding: "13px 0", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
        }}>Save Budgets</button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FinFlow() {
  const [txns, setTxns] = useState(() => seedTransactions());
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showAdd, setShowAdd] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [budgets, setBudgets] = useState({ food: 400, housing: 900, transport: 150, entertainment: 80, health: 100, shopping: 200, utilities: 120 });
  const [txnFilter, setTxnFilter] = useState("all");
  const [searchQ, setSearchQ] = useState("");

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

  const monthly = useMemo(() => computeMonthlyTotals(txns), [txns]);
  const catBreakdown = useMemo(() => computeCategoryBreakdown(txns, currentMonth), [txns]);
  const anomalies = useMemo(() => detectAnomalies(txns), [txns]);
  const dailySpend = useMemo(() => computeDailySpend(txns), [txns]);

  const thisMonth = monthly.find(m => m.month === currentMonth) || { income: 0, expenses: 0, net: 0 };
  const lastMonth = monthly.find(m => m.month === prevMonth) || { income: 0, expenses: 0, net: 0 };
  const savingsRate = thisMonth.income > 0 ? ((thisMonth.net / thisMonth.income) * 100).toFixed(1) : "0.0";

  const addTxn = useCallback(t => setTxns(prev => [t, ...prev]), []);

  const filtered = useMemo(() => txns.filter(t => {
    if (txnFilter !== "all" && t.category !== txnFilter) return false;
    if (searchQ && !t.merchant.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  }), [txns, txnFilter, searchQ]);

  // Budget progress
  const budgetProgress = useMemo(() => {
    const spent = {};
    txns.filter(t => t.type === "expense" && t.date.startsWith(currentMonth)).forEach(t => {
      spent[t.category] = (spent[t.category] || 0) + t.amount;
    });
    return Object.entries(budgets).map(([cat, budget]) => ({
      cat, budget, spent: spent[cat] || 0,
      pct: budget > 0 ? Math.min(((spent[cat] || 0) / budget) * 100, 100) : 0,
      over: budget > 0 && (spent[cat] || 0) > budget,
      label: CATEGORIES[cat].label, icon: CATEGORIES[cat].icon, color: CATEGORIES[cat].color,
    }));
  }, [txns, budgets, currentMonth]);

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "transactions", label: "Transactions", icon: "≡" },
    { id: "analytics", label: "Analytics", icon: "⌁" },
    { id: "budgets", label: "Budgets", icon: "◎" },
  ];

  const sidebarW = 220;

  return (
    <div style={{
      minHeight: "100vh", background: "#0A0A0A", color: "#fff",
      fontFamily: "'DM Sans', 'Outfit', sans-serif",
      display: "flex",
    }}>
      {/* SIDEBAR */}
      <div style={{
        width: sidebarW, background: "rgba(255,255,255,0.02)", borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex", flexDirection: "column", padding: "28px 0", flexShrink: 0, position: "sticky", top: 0, height: "100vh",
      }}>
        {/* Logo */}
        <div style={{ padding: "0 24px 28px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em" }}>
            <span style={{ background: "linear-gradient(135deg, #7C3AED, #3B82F6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Fin</span>
            <span style={{ color: "#fff" }}>Flow</span>
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 2, letterSpacing: "0.06em" }}>INTELLIGENCE LAYER</div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "20px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              background: activeTab === t.id ? "rgba(124,58,237,0.15)" : "transparent",
              border: activeTab === t.id ? "1px solid rgba(124,58,237,0.3)" : "1px solid transparent",
              borderRadius: 10, padding: "10px 16px", color: activeTab === t.id ? "#a78bfa" : "#666",
              cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: activeTab === t.id ? 600 : 400,
              display: "flex", alignItems: "center", gap: 10, transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>

        {/* Add button */}
        <div style={{ padding: "0 12px" }}>
          <button onClick={() => setShowAdd(true)} style={{
            width: "100%", background: "linear-gradient(135deg, #7C3AED, #3B82F6)", border: "none",
            borderRadius: 12, padding: "12px 0", color: "#fff", fontWeight: 700, fontSize: 14,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add Transaction
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, padding: "32px 36px", overflowY: "auto", minHeight: "100vh" }}>

        {/* DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
                Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, Soham 👋
              </h1>
              <p style={{ color: "#555", fontSize: 14 }}>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
            </div>

            {/* Stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              <StatCard label="This Month Income" value={fmt(thisMonth.income)} icon="💰" accent="#22C55E"
                sub={`${thisMonth.income >= lastMonth.income ? "▲" : "▼"} vs last month`}
                trend={thisMonth.income >= lastMonth.income ? "up" : "down"} />
              <StatCard label="This Month Spend" value={fmt(thisMonth.expenses)} icon="💸" accent="#F97316"
                sub={`${thisMonth.expenses <= lastMonth.expenses ? "▼" : "▲"} vs last month`}
                trend={thisMonth.expenses <= lastMonth.expenses ? "up" : "down"} />
              <StatCard label="Net Cashflow" value={fmt(thisMonth.net)} icon="⚖️"
                accent={thisMonth.net >= 0 ? "#22C55E" : "#F87171"}
                sub={thisMonth.net >= 0 ? "You're saving money" : "Spending more than earning"} />
              <StatCard label="Savings Rate" value={`${savingsRate}%`} icon="📈"
                accent="#7C3AED"
                sub={parseFloat(savingsRate) >= 20 ? "Above 20% target ✓" : "Below 20% target"} />
            </div>

            {/* Charts row */}
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 20 }}>
              {/* Area chart */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
                <SectionTitle>6-Month Cash Flow</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={monthly}>
                    <defs>
                      <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22C55E" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F97316" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="income" name="Income" stroke="#22C55E" strokeWidth={2} fill="url(#gIncome)" />
                    <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#F97316" strokeWidth={2} fill="url(#gExpenses)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Pie chart */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
                <SectionTitle>Spend Breakdown</SectionTitle>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={catBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={75}
                      dataKey="value" paddingAngle={2}>
                      {catBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmtD(v)} contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {catBreakdown.slice(0, 4).map(c => (
                    <div key={c.cat} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }} />
                        <span style={{ fontSize: 12, color: "#888" }}>{c.icon} {c.name}</span>
                      </div>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: "#ccc" }}>{fmt(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Anomaly alerts */}
            {anomalies.length > 0 && (
              <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 18, padding: 24 }}>
                <SectionTitle>⚠️ Spend Anomaly Detector</SectionTitle>
                <p style={{ fontSize: 12, color: "#888", marginBottom: 14 }}>Transactions flagged as statistical outliers (z-score &gt; 2.2σ from category mean)</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {anomalies.map(a => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(239,68,68,0.06)", borderRadius: 10, padding: "10px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 20 }}>{CATEGORIES[a.category]?.icon}</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{a.merchant}</div>
                          <div style={{ fontSize: 11, color: "#666" }}>{a.date} · {CATEGORIES[a.category]?.label} · z = {a.zScore.toFixed(2)}σ</div>
                        </div>
                      </div>
                      <div style={{ fontFamily: "monospace", color: "#F87171", fontWeight: 700 }}>{fmtD(a.amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent transactions */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
              <SectionTitle>Recent Transactions</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {txns.slice(0, 8).map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, transition: "background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${CATEGORIES[t.category]?.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>
                        {CATEGORIES[t.category]?.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{t.merchant}</div>
                        <div style={{ fontSize: 11, color: "#555" }}>{t.date}</div>
                      </div>
                    </div>
                    <div style={{ fontFamily: "monospace", fontWeight: 600, color: t.type === "income" ? "#22C55E" : "#fff" }}>
                      {t.type === "income" ? "+" : "−"}{fmtD(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TRANSACTIONS TAB */}
        {activeTab === "transactions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>All Transactions</h1>

            {/* Filters */}
            <div style={{ display: "flex", gap: 12 }}>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search merchant..."
                style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 16px", color: "#fff", fontSize: 14, outline: "none" }} />
              <select value={txnFilter} onChange={e => setTxnFilter(e.target.value)}
                style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none" }}>
                <option value="all">All Categories</option>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>

            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Merchant", "Category", "Date", "Amount"].map(h => (
                  <span key={h} style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>{h}</span>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {filtered.slice(0, 80).map((t, i) => (
                  <div key={t.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.03)", transition: "background 0.1s" }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 17 }}>{CATEGORIES[t.category]?.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{t.merchant}</div>
                        {t.anomaly && <span style={{ fontSize: 10, background: "rgba(239,68,68,0.15)", color: "#F87171", padding: "1px 6px", borderRadius: 4 }}>anomaly</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: "#777", alignSelf: "center" }}>{CATEGORIES[t.category]?.label}</span>
                    <span style={{ fontSize: 12, color: "#777", alignSelf: "center", fontFamily: "monospace" }}>{t.date}</span>
                    <span style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 600, alignSelf: "center", color: t.type === "income" ? "#22C55E" : "#fff" }}>
                      {t.type === "income" ? "+" : "−"}{fmtD(t.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ANALYTICS TAB */}
        {activeTab === "analytics" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>Analytics</h1>

            {/* Daily spend this month */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
              <SectionTitle>Daily Cumulative Spend — This Month</SectionTitle>
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={dailySpend}>
                  <defs>
                    <linearGradient id="gCum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#7C3AED" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="cumulative" name="Cumulative Spend" stroke="#7C3AED" strokeWidth={2} fill="url(#gCum)" />
                  <Area type="monotone" dataKey="daily" name="Daily Spend" stroke="#3B82F6" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Monthly bar */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
              <SectionTitle>Monthly Income vs Expenses</SectionTitle>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={monthly} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="label" tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#666", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="income" name="Income" fill="#22C55E" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#F97316" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Forecasts */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
              <SectionTitle>ML Spend Forecasting</SectionTitle>
              <p style={{ fontSize: 12, color: "#666", marginBottom: 18 }}>Linear trend extrapolation from 6-month rolling average</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                {Object.keys(CATEGORIES).filter(k => k !== "income").map(cat => {
                  const f = forecastBudget(txns, cat);
                  if (!f) return null;
                  return (
                    <div key={cat} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "14px 16px" }}>
                      <div style={{ fontSize: 20, marginBottom: 6 }}>{CATEGORIES[cat].icon}</div>
                      <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{CATEGORIES[cat].label}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: CATEGORIES[cat].color }}>{fmt(f.forecast)}</div>
                      <div style={{ fontSize: 11, color: f.trend > 0 ? "#F87171" : "#10B981", marginTop: 2 }}>
                        {f.trend > 0 ? "▲" : "▼"} {Math.abs(f.trend).toFixed(0)}/mo trend
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Category breakdown bar */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
              <SectionTitle>Category Spend This Month</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {catBreakdown.map(c => {
                  const max = catBreakdown[0].value;
                  return (
                    <div key={c.cat}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 13 }}>{c.icon} {c.name}</span>
                        <span style={{ fontFamily: "monospace", fontSize: 13, color: c.color }}>{fmtD(c.value)}</span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 999, height: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(c.value / max) * 100}%`, background: c.color, borderRadius: 999, transition: "width 1s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* BUDGETS TAB */}
        {activeTab === "budgets" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em" }}>Budgets</h1>
              <button onClick={() => setShowBudget(true)} style={{
                background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)",
                borderRadius: 10, padding: "9px 18px", color: "#a78bfa", fontWeight: 600, fontSize: 13, cursor: "pointer",
              }}>Edit Budgets</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {budgetProgress.map(b => (
                <div key={b.cat} style={{
                  background: "rgba(255,255,255,0.02)", border: `1px solid ${b.over ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: 18, padding: 22,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{b.icon}</div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{b.label}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: b.over ? "#F87171" : "#fff" }}>{fmtD(b.spent)}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>of {fmt(b.budget)}</div>
                    </div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 999, height: 8, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${b.pct}%`,
                      background: b.over ? "#EF4444" : b.pct > 80 ? "#F59E0B" : b.color,
                      borderRadius: 999, transition: "width 1s ease",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: b.over ? "#F87171" : "#666" }}>{b.pct.toFixed(0)}% used</span>
                    {b.over
                      ? <span style={{ fontSize: 11, color: "#F87171" }}>Over by {fmtD(b.spent - b.budget)}</span>
                      : <span style={{ fontSize: 11, color: "#666" }}>{fmtD(b.budget - b.spent)} remaining</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onAdd={addTxn} />}
      {showBudget && <BudgetModal budgets={budgets} onClose={() => setShowBudget(false)} onSave={setBudgets} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=DM+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
        input::placeholder { color: #444; }
      `}</style>
    </div>
  );
}