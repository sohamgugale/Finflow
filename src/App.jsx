import { useState, useEffect, useCallback, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// ─── API CLIENT ──────────────────────────────────────────────────────────────
const BASE_URL = "https://finflow-backend-09kd.onrender.com";

const api = {
  async register(email, username, password) {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Registration failed");
    return data;
  },
  async login(username, password) {
    const form = new URLSearchParams();
    form.append("username", username);
    form.append("password", password);
    const res = await fetch(`${BASE_URL}/auth/login`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed");
    localStorage.setItem("token", data.access_token);
    return data;
  },
  async getTransactions() {
    const res = await fetch(`${BASE_URL}/transactions/`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },
  async addTransaction(txn) {
    const res = await fetch(`${BASE_URL}/transactions/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
      body: JSON.stringify(txn),
    });
    if (!res.ok) throw new Error("Failed to add");
    return res.json();
  },
  async deleteTransaction(id) {
    await fetch(`${BASE_URL}/transactions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
    });
  },
  logout() { localStorage.removeItem("token"); },
};

// ─── CATEGORIES ──────────────────────────────────────────────────────────────
const CATEGORIES = {
  food:          { label: "Food & Dining",  icon: "🍜", color: "#F97316" },
  housing:       { label: "Housing",        icon: "🏠", color: "#8B5CF6" },
  transport:     { label: "Transport",      icon: "🚇", color: "#3B82F6" },
  entertainment: { label: "Entertainment",  icon: "🎮", color: "#EC4899" },
  health:        { label: "Health",         icon: "💊", color: "#10B981" },
  shopping:      { label: "Shopping",       icon: "🛍️", color: "#F59E0B" },
  utilities:     { label: "Utilities",      icon: "⚡", color: "#6366F1" },
  income:        { label: "Income",         icon: "💰", color: "#22C55E" },
};

// ─── ANALYTICS ───────────────────────────────────────────────────────────────
function computeMonthlyTotals(txns) {
  const map = {};
  txns.forEach(t => {
    const key = t.date.slice(0, 7);
    if (!map[key]) map[key] = { month: key, income: 0, expenses: 0 };
    if (t.type === "income") map[key].income += t.amount;
    else map[key].expenses += t.amount;
  });
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({
    ...m, net: m.income - m.expenses,
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
    name: CATEGORIES[cat]?.label || cat, icon: CATEGORIES[cat]?.icon || "💸",
    color: CATEGORIES[cat]?.color || "#888", value: Math.round(amt * 100) / 100, cat,
  })).sort((a, b) => b.value - a.value);
}

function detectAnomalies(txns) {
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
  const result = [];
  let cumulative = 0;
  for (let d = 1; d <= now.getDate(); d++) {
    cumulative += days[d] || 0;
    result.push({ day: d, daily: Math.round((days[d] || 0) * 100) / 100, cumulative: Math.round(cumulative * 100) / 100 });
  }
  return result;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt  = n => n?.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtD = n => n?.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── RESPONSIVE HOOK ─────────────────────────────────────────────────────────
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ─── AUTH SCREEN ─────────────────────────────────────────────────────────────
function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ email: "", username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      if (mode === "register") {
        await api.register(form.email, form.username, form.password);
        await api.login(form.username, form.password);
      } else {
        await api.login(form.username, form.password);
      }
      onLogin();
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: 400, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 24, padding: "32px 28px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.04em" }}>
            <span style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Fin</span>
            <span style={{ color: "#fff" }}>Flow</span>
          </div>
          <div style={{ fontSize: 12, color: "#555", letterSpacing: "0.1em", marginTop: 4 }}>INTELLIGENCE LAYER</div>
        </div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 4, marginBottom: 28 }}>
          {["login", "register"].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 600, transition: "all 0.2s",
              background: mode === m ? "rgba(124,58,237,0.3)" : "transparent",
              color: mode === m ? "#a78bfa" : "#666",
            }}>{m === "login" ? "Sign In" : "Create Account"}</button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "register" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Email</span>
              <input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="you@example.com"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "11px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%" }} />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Username</span>
            <input type="text" value={form.username} onChange={e => set("username", e.target.value)} placeholder="soham"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "11px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Password</span>
            <input type="password" value={form.password} onChange={e => set("password", e.target.value)}
              placeholder="••••••••" onKeyDown={e => e.key === "Enter" && submit()}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "11px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%" }} />
          </label>
        </div>
        {error && <div style={{ marginTop: 14, fontSize: 13, color: "#F87171", background: "rgba(239,68,68,0.1)", borderRadius: 8, padding: "8px 12px" }}>{error}</div>}
        <button onClick={submit} disabled={loading} style={{
          width: "100%", marginTop: 24, background: "linear-gradient(135deg,#7C3AED,#3B82F6)",
          border: "none", borderRadius: 12, padding: "13px 0", color: "#fff",
          fontWeight: 700, fontSize: 15, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
        }}>{loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}</button>
      </div>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap'); * { box-sizing: border-box; margin: 0; padding: 0; } input::placeholder { color: #444; }`}</style>
    </div>
  );
}

// ─── UI COMPONENTS ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, icon, trend }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, letterSpacing: "0.1em", color: "#888", textTransform: "uppercase", fontWeight: 600, lineHeight: 1.3 }}>{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || "#fff", fontFamily: "'DM Mono', monospace", letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: trend === "up" ? "#10B981" : trend === "down" ? "#F87171" : "#666" }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div style={{ width: 3, height: 16, background: "linear-gradient(to bottom,#7C3AED,#3B82F6)", borderRadius: 2 }} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#aaa" }}>{children}</span>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#111", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#eee" }}>
      <div style={{ color: "#888", marginBottom: 6, fontSize: 10, textTransform: "uppercase" }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color || "#fff", fontFamily: "monospace" }}>{p.name}: <strong>{fmt(p.value)}</strong></div>)}
    </div>
  );
}

// ─── ADD TRANSACTION MODAL ───────────────────────────────────────────────────
function AddModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ type: "expense", category: "food", merchant: "", amount: "", date: new Date().toISOString().split("T")[0], note: "" });
  const [loading, setLoading] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.amount || !form.merchant) return;
    setLoading(true);
    await onAdd({ ...form, amount: parseFloat(form.amount), category: form.type === "income" ? "income" : form.category });
    setLoading(false);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "20px 20px 0 0", padding: "28px 24px 40px", width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "-8px auto 4px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Add Transaction</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 20, padding: 4 }}>✕</button>
        </div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 4 }}>
          {["expense", "income"].map(t => (
            <button key={t} onClick={() => set("type", t)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: form.type === t ? (t === "income" ? "#10B981" : "#EF4444") : "transparent",
              color: form.type === t ? "#fff" : "#888",
            }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        {[
          { label: "Merchant", key: "merchant", type: "text", placeholder: "e.g. Whole Foods" },
          { label: "Amount ($)", key: "amount", type: "number", placeholder: "0.00" },
          { label: "Date", key: "date", type: "date" },
        ].map(f => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>{f.label}</span>
            <input type={f.type} value={form[f.key]} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%" }} />
          </label>
        ))}
        {form.type === "expense" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em" }}>Category</span>
            <select value={form.category} onChange={e => set("category", e.target.value)}
              style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%" }}>
              {Object.entries(CATEGORIES).filter(([k]) => k !== "income").map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
          </label>
        )}
        <button onClick={submit} disabled={loading} style={{
          background: "linear-gradient(135deg,#7C3AED,#3B82F6)", border: "none", borderRadius: 12,
          padding: "13px 0", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", marginTop: 4, width: "100%",
        }}>{loading ? "Saving..." : "Add Transaction"}</button>
      </div>
    </div>
  );
}

// ─── BUDGET MODAL ─────────────────────────────────────────────────────────────
function BudgetModal({ budgets, onClose, onSave }) {
  const [local, setLocal] = useState({ ...budgets });
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, backdropFilter: "blur(4px)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "20px 20px 0 0", padding: "28px 24px 40px", width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "-8px auto 4px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Monthly Budgets</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 20, padding: 4 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", maxHeight: "60vh", display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(CATEGORIES).filter(([k]) => k !== "income").map(([k, v]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 120, fontSize: 13, color: "#ccc", flexShrink: 0 }}>{v.icon} {v.label}</span>
              <input type="number" value={local[k] || ""} placeholder="No limit"
                onChange={e => setLocal(l => ({ ...l, [k]: parseFloat(e.target.value) || 0 }))}
                style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "8px 12px", color: "#fff", fontSize: 14, outline: "none" }} />
            </label>
          ))}
        </div>
        <button onClick={() => { onSave(local); onClose(); }} style={{
          background: "linear-gradient(135deg,#7C3AED,#3B82F6)", border: "none", borderRadius: 12,
          padding: "13px 0", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", width: "100%",
        }}>Save Budgets</button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function FinFlow() {
  const [authed, setAuthed]       = useState(!!localStorage.getItem("token"));
  const [txns, setTxns]           = useState([]);
  const [loading, setLoading]     = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [showAdd, setShowAdd]     = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [budgets, setBudgets]     = useState({ food: 400, housing: 900, transport: 150, entertainment: 80, health: 100, shopping: 200, utilities: 120 });
  const [txnFilter, setTxnFilter] = useState("all");
  const [searchQ, setSearchQ]     = useState("");
  const isMobile = useIsMobile();

  const loadTxns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTransactions();
      setTxns(Array.isArray(data) ? data.sort((a, b) => new Date(b.date) - new Date(a.date)) : []);
    } catch { api.logout(); setAuthed(false); }
    setLoading(false);
  }, []);

  useEffect(() => { if (authed) loadTxns(); }, [authed]);

  const addTxn = useCallback(async (txn) => {
    const saved = await api.addTransaction(txn);
    setTxns(prev => [saved, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
  }, []);

  const deleteTxn = useCallback(async (id) => {
    await api.deleteTransaction(id);
    setTxns(prev => prev.filter(t => t.id !== id));
  }, []);

  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);

  const monthly      = useMemo(() => computeMonthlyTotals(txns), [txns]);
  const catBreakdown = useMemo(() => computeCategoryBreakdown(txns, currentMonth), [txns]);
  const anomalies    = useMemo(() => detectAnomalies(txns), [txns]);
  const dailySpend   = useMemo(() => computeDailySpend(txns), [txns]);

  const thisMonth = monthly.find(m => m.month === currentMonth) || { income: 0, expenses: 0, net: 0 };
  const lastMonth = monthly.find(m => m.month === prevMonth)    || { income: 0, expenses: 0, net: 0 };
  const savingsRate = thisMonth.income > 0 ? ((thisMonth.net / thisMonth.income) * 100).toFixed(1) : "0.0";

  const filtered = useMemo(() => txns.filter(t => {
    if (txnFilter !== "all" && t.category !== txnFilter) return false;
    if (searchQ && !t.merchant.toLowerCase().includes(searchQ.toLowerCase())) return false;
    return true;
  }), [txns, txnFilter, searchQ]);

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

  if (!authed) return <AuthScreen onLogin={() => setAuthed(true)} />;

  const tabs = [
    { id: "dashboard",    label: "Dashboard",    icon: "◈" },
    { id: "transactions", label: "Transactions", icon: "≡" },
    { id: "analytics",    label: "Analytics",    icon: "⌁" },
    { id: "budgets",      label: "Budgets",      icon: "◎" },
  ];

  // ── MOBILE BOTTOM NAV + LAYOUT ────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ minHeight: "100vh", background: "#0A0A0A", color: "#fff", fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column", paddingBottom: 70 }}>
        {/* Mobile Header */}
        <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(10,10,10,0.95)", backdropFilter: "blur(10px)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.04em" }}>
              <span style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Fin</span>
              <span style={{ color: "#fff" }}>Flow</span>
            </div>
          </div>
          <button onClick={() => setShowAdd(true)} style={{
            background: "linear-gradient(135deg,#7C3AED,#3B82F6)", border: "none",
            borderRadius: 10, padding: "8px 16px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer",
          }}>+ Add</button>
        </div>

        {/* Mobile Content */}
        <div style={{ flex: 1, padding: "20px 16px", overflowY: "auto" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
              <div style={{ color: "#555", fontSize: 14 }}>Loading...</div>
            </div>
          )}

          {/* MOBILE DASHBOARD */}
          {!loading && activeTab === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 2 }}>
                  Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, Soham 👋
                </h1>
                <p style={{ color: "#555", fontSize: 13 }}>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
              </div>

              {txns.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16 }}>
                  <div style={{ fontSize: 48 }}>📊</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>No transactions yet</div>
                  <div style={{ fontSize: 13, color: "#555" }}>Tap + Add to get started</div>
                </div>
              ) : (
                <>
                  {/* 2x2 stat grid on mobile */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <StatCard label="Income" value={fmt(thisMonth.income)} icon="💰" accent="#22C55E" sub={`${thisMonth.income >= lastMonth.income ? "▲" : "▼"} vs last month`} trend={thisMonth.income >= lastMonth.income ? "up" : "down"} />
                    <StatCard label="Spend" value={fmt(thisMonth.expenses)} icon="💸" accent="#F97316" sub={`${thisMonth.expenses <= lastMonth.expenses ? "▼" : "▲"} vs last month`} trend={thisMonth.expenses <= lastMonth.expenses ? "up" : "down"} />
                    <StatCard label="Net Cashflow" value={fmt(thisMonth.net)} icon="⚖️" accent={thisMonth.net >= 0 ? "#22C55E" : "#F87171"} sub={thisMonth.net >= 0 ? "Saving ✓" : "Overspending"} />
                    <StatCard label="Savings Rate" value={`${savingsRate}%`} icon="📈" accent="#7C3AED" sub={parseFloat(savingsRate) >= 20 ? "Above 20% ✓" : "Below 20%"} />
                  </div>

                  {/* Cash flow chart */}
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 14px" }}>
                    <SectionTitle>6-Month Cash Flow</SectionTitle>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={monthly}>
                        <defs>
                          <linearGradient id="gIncome" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22C55E" stopOpacity={0.3}/><stop offset="100%" stopColor="#22C55E" stopOpacity={0}/></linearGradient>
                          <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F97316" stopOpacity={0.3}/><stop offset="100%" stopColor="#F97316" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="label" tick={{ fill:"#666", fontSize:10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill:"#666", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`} width={45} />
                        <Tooltip content={<CustomTooltip />} />
                        <Area type="monotone" dataKey="income" name="Income" stroke="#22C55E" strokeWidth={2} fill="url(#gIncome)" />
                        <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#F97316" strokeWidth={2} fill="url(#gExp)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Spend breakdown — horizontal list on mobile */}
                  {catBreakdown.length > 0 && (
                    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 14px" }}>
                      <SectionTitle>Spend Breakdown</SectionTitle>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {catBreakdown.slice(0, 5).map(c => (
                          <div key={c.cat} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 16, width: 24 }}>{c.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontSize: 12, color: "#ccc" }}>{c.name}</span>
                                <span style={{ fontSize: 12, fontFamily: "monospace", color: c.color }}>{fmt(c.value)}</span>
                              </div>
                              <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 999, height: 4 }}>
                                <div style={{ height: "100%", width: `${(c.value / catBreakdown[0].value) * 100}%`, background: c.color, borderRadius: 999 }} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Anomalies */}
                  {anomalies.length > 0 && (
                    <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 16, padding: "18px 14px" }}>
                      <SectionTitle>⚠️ Spend Anomalies</SectionTitle>
                      {anomalies.map(a => (
                        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 18 }}>{CATEGORIES[a.category]?.icon}</span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{a.merchant}</div>
                              <div style={{ fontSize: 10, color: "#666" }}>{a.date} · z={a.zScore.toFixed(1)}σ</div>
                            </div>
                          </div>
                          <div style={{ fontFamily: "monospace", color: "#F87171", fontWeight: 700, fontSize: 13 }}>{fmtD(a.amount)}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recent transactions */}
                  <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 14px" }}>
                    <SectionTitle>Recent Transactions</SectionTitle>
                    {txns.slice(0, 8).map(t => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${CATEGORIES[t.category]?.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                            {CATEGORIES[t.category]?.icon}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{t.merchant}</div>
                            <div style={{ fontSize: 11, color: "#555" }}>{t.date}</div>
                          </div>
                        </div>
                        <div style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13, color: t.type === "income" ? "#22C55E" : "#fff" }}>
                          {t.type === "income" ? "+" : "−"}{fmtD(t.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* MOBILE TRANSACTIONS */}
          {!loading && activeTab === "transactions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800 }}>Transactions</h1>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search merchant..."
                style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 16px", color: "#fff", fontSize: 14, outline: "none" }} />
              <select value={txnFilter} onChange={e => setTxnFilter(e.target.value)}
                style={{ width: "100%", background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 14, outline: "none" }}>
                <option value="all">All Categories</option>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {filtered.length === 0 ? (
                  <div style={{ textAlign: "center", color: "#555", padding: "40px 0" }}>No transactions found.</div>
                ) : filtered.slice(0, 80).map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderRadius: 12, background: "rgba(255,255,255,0.02)", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: `${CATEGORIES[t.category]?.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>
                        {CATEGORIES[t.category]?.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{t.merchant}</div>
                        <div style={{ fontSize: 11, color: "#555" }}>{t.date} · {CATEGORIES[t.category]?.label}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 13, color: t.type === "income" ? "#22C55E" : "#fff" }}>
                        {t.type === "income" ? "+" : "−"}{fmtD(t.amount)}
                      </span>
                      <button onClick={() => deleteTxn(t.id)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 16, padding: "2px 4px" }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MOBILE ANALYTICS */}
          {!loading && activeTab === "analytics" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <h1 style={{ fontSize: 22, fontWeight: 800 }}>Analytics</h1>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 14px" }}>
                <SectionTitle>Daily Spend — This Month</SectionTitle>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={dailySpend}>
                    <defs><linearGradient id="gCum" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7C3AED" stopOpacity={0.4}/><stop offset="100%" stopColor="#7C3AED" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" tick={{ fill:"#666", fontSize:10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill:"#666", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`} width={45} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke="#7C3AED" strokeWidth={2} fill="url(#gCum)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 14px" }}>
                <SectionTitle>Income vs Expenses</SectionTitle>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={monthly} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill:"#666", fontSize:10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill:"#666", fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`} width={45} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="income" name="Income" fill="#22C55E" radius={[4,4,0,0]} />
                    <Bar dataKey="expenses" name="Expenses" fill="#F97316" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 14px" }}>
                <SectionTitle>Category Spend This Month</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {catBreakdown.map(c => {
                    const max = catBreakdown[0]?.value || 1;
                    return (
                      <div key={c.cat}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 13 }}>{c.icon} {c.name}</span>
                          <span style={{ fontFamily: "monospace", fontSize: 13, color: c.color }}>{fmtD(c.value)}</span>
                        </div>
                        <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 999, height: 5 }}>
                          <div style={{ height: "100%", width: `${(c.value/max)*100}%`, background: c.color, borderRadius: 999 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* ML Forecast — 2 cols on mobile */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "18px 14px" }}>
                <SectionTitle>ML Spend Forecast</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {Object.keys(CATEGORIES).filter(k => k !== "income").map(cat => {
                    const f = forecastBudget(txns, cat);
                    if (!f) return null;
                    return (
                      <div key={cat} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "12px" }}>
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{CATEGORIES[cat].icon}</div>
                        <div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>{CATEGORIES[cat].label}</div>
                        <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: CATEGORIES[cat].color }}>{fmt(f.forecast)}</div>
                        <div style={{ fontSize: 10, color: f.trend > 0 ? "#F87171" : "#10B981", marginTop: 2 }}>{f.trend > 0 ? "▲" : "▼"} {Math.abs(f.trend).toFixed(0)}/mo</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* MOBILE BUDGETS */}
          {!loading && activeTab === "budgets" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h1 style={{ fontSize: 22, fontWeight: 800 }}>Budgets</h1>
                <button onClick={() => setShowBudget(true)} style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: 10, padding: "8px 14px", color: "#a78bfa", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Edit</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {budgetProgress.map(b => (
                  <div key={b.cat} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${b.over ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.07)"}`, borderRadius: 16, padding: "16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 20 }}>{b.icon}</span>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{b.label}</span>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: b.over ? "#F87171" : "#fff" }}>{fmtD(b.spent)}</div>
                        <div style={{ fontSize: 10, color: "#666" }}>of {fmt(b.budget)}</div>
                      </div>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 999, height: 7 }}>
                      <div style={{ height: "100%", width: `${b.pct}%`, background: b.over ? "#EF4444" : b.pct > 80 ? "#F59E0B" : b.color, borderRadius: 999 }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7 }}>
                      <span style={{ fontSize: 11, color: b.over ? "#F87171" : "#666" }}>{b.pct.toFixed(0)}% used</span>
                      {b.over
                        ? <span style={{ fontSize: 11, color: "#F87171" }}>Over by {fmtD(b.spent - b.budget)}</span>
                        : <span style={{ fontSize: 11, color: "#666" }}>{fmtD(b.budget - b.spent)} left</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Mobile Bottom Nav */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(10,10,10,0.97)", backdropFilter: "blur(10px)", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", zIndex: 50, paddingBottom: "env(safe-area-inset-bottom)" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flex: 1, padding: "10px 4px 8px", background: "transparent", border: "none", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              color: activeTab === t.id ? "#a78bfa" : "#555",
            }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
              <span style={{ fontSize: 10, fontWeight: activeTab === t.id ? 700 : 400, letterSpacing: "0.02em" }}>{t.label}</span>
            </button>
          ))}
        </div>

        {showAdd    && <AddModal    onClose={() => setShowAdd(false)}    onAdd={addTxn} />}
        {showBudget && <BudgetModal onClose={() => setShowBudget(false)} budgets={budgets} onSave={setBudgets} />}
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;600&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          ::-webkit-scrollbar { display: none; }
          input::placeholder { color: #444; }
          input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
        `}</style>
      </div>
    );
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", color: "#fff", fontFamily: "'DM Sans', sans-serif", display: "flex" }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: "rgba(255,255,255,0.02)", borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", padding: "28px 0", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "0 24px 28px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.04em" }}>
            <span style={{ background: "linear-gradient(135deg,#7C3AED,#3B82F6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Fin</span>
            <span style={{ color: "#fff" }}>Flow</span>
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 2, letterSpacing: "0.06em" }}>INTELLIGENCE LAYER</div>
        </div>
        <nav style={{ flex: 1, padding: "20px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              background: activeTab === t.id ? "rgba(124,58,237,0.15)" : "transparent",
              border: activeTab === t.id ? "1px solid rgba(124,58,237,0.3)" : "1px solid transparent",
              borderRadius: 10, padding: "10px 16px",
              color: activeTab === t.id ? "#a78bfa" : "#666",
              cursor: "pointer", textAlign: "left", fontSize: 14, fontWeight: activeTab === t.id ? 600 : 400,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
        <div style={{ padding: "0 12px 16px" }}>
          <button onClick={() => setShowAdd(true)} style={{
            width: "100%", background: "linear-gradient(135deg,#7C3AED,#3B82F6)", border: "none",
            borderRadius: 12, padding: "12px 0", color: "#fff", fontWeight: 700, fontSize: 14,
            cursor: "pointer", marginBottom: 8,
          }}>+ Add Transaction</button>
          <button onClick={() => { api.logout(); setAuthed(false); setTxns([]); }} style={{
            width: "100%", background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "10px 0", color: "#555", fontSize: 13, cursor: "pointer",
          }}>Sign Out</button>
        </div>
      </div>

      {/* Desktop Main */}
      <div style={{ flex: 1, padding: "32px 36px", overflowY: "auto" }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200 }}>
            <div style={{ color: "#555", fontSize: 14 }}>Loading transactions...</div>
          </div>
        )}

        {!loading && txns.length === 0 && activeTab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16 }}>
            <div style={{ fontSize: 48 }}>📊</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>No transactions yet</div>
            <div style={{ fontSize: 14, color: "#555" }}>Add your first transaction to get started</div>
            <button onClick={() => setShowAdd(true)} style={{
              background: "linear-gradient(135deg,#7C3AED,#3B82F6)", border: "none", borderRadius: 12,
              padding: "12px 28px", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}>+ Add Transaction</button>
          </div>
        )}

        {/* DESKTOP DASHBOARD */}
        {!loading && activeTab === "dashboard" && txns.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 4 }}>
                Good {now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, Soham 👋
              </h1>
              <p style={{ color: "#555", fontSize: 14 }}>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
              <StatCard label="This Month Income" value={fmt(thisMonth.income)} icon="💰" accent="#22C55E" sub={`${thisMonth.income >= lastMonth.income ? "▲" : "▼"} vs last month`} trend={thisMonth.income >= lastMonth.income ? "up" : "down"} />
              <StatCard label="This Month Spend"  value={fmt(thisMonth.expenses)} icon="💸" accent="#F97316" sub={`${thisMonth.expenses <= lastMonth.expenses ? "▼" : "▲"} vs last month`} trend={thisMonth.expenses <= lastMonth.expenses ? "up" : "down"} />
              <StatCard label="Net Cashflow" value={fmt(thisMonth.net)} icon="⚖️" accent={thisMonth.net >= 0 ? "#22C55E" : "#F87171"} sub={thisMonth.net >= 0 ? "You're saving money" : "Spending > earning"} />
              <StatCard label="Savings Rate" value={`${savingsRate}%`} icon="📈" accent="#7C3AED" sub={parseFloat(savingsRate) >= 20 ? "Above 20% target ✓" : "Below 20% target"} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 20 }}>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
                <SectionTitle>6-Month Cash Flow</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={monthly}>
                    <defs>
                      <linearGradient id="gIncome2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22C55E" stopOpacity={0.3}/><stop offset="100%" stopColor="#22C55E" stopOpacity={0}/></linearGradient>
                      <linearGradient id="gExp2"    x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F97316" stopOpacity={0.3}/><stop offset="100%" stopColor="#F97316" stopOpacity={0}/></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill:"#666", fontSize:11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill:"#666", fontSize:11 }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="income"   name="Income"   stroke="#22C55E" strokeWidth={2} fill="url(#gIncome2)" />
                    <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#F97316" strokeWidth={2} fill="url(#gExp2)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 24 }}>
                <SectionTitle>Spend Breakdown</SectionTitle>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={catBreakdown} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={2}>
                      {catBreakdown.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={v => fmtD(v)} contentStyle={{ background:"#111", border:"1px solid #333", borderRadius:8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:8 }}>
                  {catBreakdown.slice(0,4).map(c => (
                    <div key={c.cat} style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ width:8, height:8, borderRadius:"50%", background:c.color }} />
                        <span style={{ fontSize:12, color:"#888" }}>{c.icon} {c.name}</span>
                      </div>
                      <span style={{ fontSize:12, fontFamily:"monospace", color:"#ccc" }}>{fmt(c.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {anomalies.length > 0 && (
              <div style={{ background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:18, padding:24 }}>
                <SectionTitle>⚠️ Spend Anomaly Detector</SectionTitle>
                <p style={{ fontSize:12, color:"#888", marginBottom:14 }}>Transactions flagged as statistical outliers (z-score &gt; 2.2σ)</p>
                <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                  {anomalies.map(a => (
                    <div key={a.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(239,68,68,0.06)", borderRadius:10, padding:"10px 16px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <span style={{ fontSize:20 }}>{CATEGORIES[a.category]?.icon}</span>
                        <div>
                          <div style={{ fontSize:13, fontWeight:600 }}>{a.merchant}</div>
                          <div style={{ fontSize:11, color:"#666" }}>{a.date} · {CATEGORIES[a.category]?.label} · z = {a.zScore.toFixed(2)}σ</div>
                        </div>
                      </div>
                      <div style={{ fontFamily:"monospace", color:"#F87171", fontWeight:700 }}>{fmtD(a.amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:24 }}>
              <SectionTitle>Recent Transactions</SectionTitle>
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {txns.slice(0,8).map(t => (
                  <div key={t.id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 12px", borderRadius:10 }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                      <div style={{ width:36, height:36, borderRadius:10, background:`${CATEGORIES[t.category]?.color}22`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17 }}>
                        {CATEGORIES[t.category]?.icon}
                      </div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:500 }}>{t.merchant}</div>
                        <div style={{ fontSize:11, color:"#555" }}>{t.date}</div>
                      </div>
                    </div>
                    <div style={{ fontFamily:"monospace", fontWeight:600, color: t.type==="income" ? "#22C55E" : "#fff" }}>
                      {t.type==="income" ? "+" : "−"}{fmtD(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* DESKTOP TRANSACTIONS */}
        {!loading && activeTab === "transactions" && (
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
            <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.03em" }}>All Transactions</h1>
            <div style={{ display:"flex", gap:12 }}>
              <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search merchant..."
                style={{ flex:1, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"10px 16px", color:"#fff", fontSize:14, outline:"none" }} />
              <select value={txnFilter} onChange={e=>setTxnFilter(e.target.value)}
                style={{ background:"#1a1a1a", border:"1px solid rgba(255,255,255,0.1)", borderRadius:10, padding:"10px 14px", color:"#fff", fontSize:14, outline:"none" }}>
                <option value="all">All Categories</option>
                {Object.entries(CATEGORIES).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            {txns.length === 0 ? (
              <div style={{ textAlign:"center", color:"#555", padding:"60px 0" }}>No transactions yet. Add one!</div>
            ) : (
              <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, overflow:"hidden" }}>
                <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 40px", padding:"12px 20px", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                  {["Merchant","Category","Date","Amount",""].map(h => <span key={h} style={{ fontSize:11, color:"#555", textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:600 }}>{h}</span>)}
                </div>
                {filtered.slice(0,80).map(t => (
                  <div key={t.id} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr 1fr 40px", padding:"12px 20px", borderBottom:"1px solid rgba(255,255,255,0.03)", alignItems:"center" }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:17 }}>{CATEGORIES[t.category]?.icon}</span>
                      <span style={{ fontSize:13, fontWeight:500 }}>{t.merchant}</span>
                    </div>
                    <span style={{ fontSize:12, color:"#777" }}>{CATEGORIES[t.category]?.label}</span>
                    <span style={{ fontSize:12, color:"#777", fontFamily:"monospace" }}>{t.date}</span>
                    <span style={{ fontSize:13, fontFamily:"monospace", fontWeight:600, color: t.type==="income" ? "#22C55E" : "#fff" }}>
                      {t.type==="income" ? "+" : "−"}{fmtD(t.amount)}
                    </span>
                    <button onClick={() => deleteTxn(t.id)} style={{ background:"none", border:"none", color:"#444", cursor:"pointer", fontSize:16, padding:4 }}
                      onMouseEnter={e=>e.currentTarget.style.color="#F87171"}
                      onMouseLeave={e=>e.currentTarget.style.color="#444"}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* DESKTOP ANALYTICS */}
        {!loading && activeTab === "analytics" && (
          <div style={{ display:"flex", flexDirection:"column", gap:28 }}>
            <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.03em" }}>Analytics</h1>
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:24 }}>
              <SectionTitle>Daily Cumulative Spend — This Month</SectionTitle>
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={dailySpend}>
                  <defs><linearGradient id="gCum2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7C3AED" stopOpacity={0.4}/><stop offset="100%" stopColor="#7C3AED" stopOpacity={0}/></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="day" tick={{ fill:"#666", fontSize:11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:"#666", fontSize:11 }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="cumulative" name="Cumulative" stroke="#7C3AED" strokeWidth={2} fill="url(#gCum2)" />
                  <Area type="monotone" dataKey="daily" name="Daily" stroke="#3B82F6" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:24 }}>
              <SectionTitle>Monthly Income vs Expenses</SectionTitle>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={monthly} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="label" tick={{ fill:"#666", fontSize:11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill:"#666", fontSize:11 }} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="income"   name="Income"   fill="#22C55E" radius={[5,5,0,0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#F97316" radius={[5,5,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:24 }}>
              <SectionTitle>ML Spend Forecasting</SectionTitle>
              <p style={{ fontSize:12, color:"#666", marginBottom:18 }}>Linear trend extrapolation from rolling average</p>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
                {Object.keys(CATEGORIES).filter(k=>k!=="income").map(cat => {
                  const f = forecastBudget(txns, cat);
                  if (!f) return null;
                  return (
                    <div key={cat} style={{ background:"rgba(255,255,255,0.03)", borderRadius:12, padding:"14px 16px" }}>
                      <div style={{ fontSize:20, marginBottom:6 }}>{CATEGORIES[cat].icon}</div>
                      <div style={{ fontSize:12, color:"#888", marginBottom:4 }}>{CATEGORIES[cat].label}</div>
                      <div style={{ fontFamily:"monospace", fontSize:18, fontWeight:700, color:CATEGORIES[cat].color }}>{fmt(f.forecast)}</div>
                      <div style={{ fontSize:11, color: f.trend>0 ? "#F87171" : "#10B981", marginTop:2 }}>{f.trend>0?"▲":"▼"} {Math.abs(f.trend).toFixed(0)}/mo</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:18, padding:24 }}>
              <SectionTitle>Category Spend This Month</SectionTitle>
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {catBreakdown.map(c => {
                  const max = catBreakdown[0]?.value || 1;
                  return (
                    <div key={c.cat}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                        <span style={{ fontSize:13 }}>{c.icon} {c.name}</span>
                        <span style={{ fontFamily:"monospace", fontSize:13, color:c.color }}>{fmtD(c.value)}</span>
                      </div>
                      <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:999, height:6, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${(c.value/max)*100}%`, background:c.color, borderRadius:999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* DESKTOP BUDGETS */}
        {!loading && activeTab === "budgets" && (
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:"-0.03em" }}>Budgets</h1>
              <button onClick={()=>setShowBudget(true)} style={{ background:"rgba(124,58,237,0.15)", border:"1px solid rgba(124,58,237,0.3)", borderRadius:10, padding:"9px 18px", color:"#a78bfa", fontWeight:600, fontSize:13, cursor:"pointer" }}>Edit Budgets</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {budgetProgress.map(b => (
                <div key={b.cat} style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${b.over?"rgba(239,68,68,0.3)":"rgba(255,255,255,0.07)"}`, borderRadius:18, padding:22 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
                    <div>
                      <div style={{ fontSize:20, marginBottom:4 }}>{b.icon}</div>
                      <div style={{ fontSize:14, fontWeight:600 }}>{b.label}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:"monospace", fontSize:16, fontWeight:700, color: b.over?"#F87171":"#fff" }}>{fmtD(b.spent)}</div>
                      <div style={{ fontSize:11, color:"#666" }}>of {fmt(b.budget)}</div>
                    </div>
                  </div>
                  <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:999, height:8, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${b.pct}%`, background: b.over?"#EF4444":b.pct>80?"#F59E0B":b.color, borderRadius:999 }} />
                  </div>
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
                    <span style={{ fontSize:11, color: b.over?"#F87171":"#666" }}>{b.pct.toFixed(0)}% used</span>
                    {b.over
                      ? <span style={{ fontSize:11, color:"#F87171" }}>Over by {fmtD(b.spent-b.budget)}</span>
                      : <span style={{ fontSize:11, color:"#666" }}>{fmtD(b.budget-b.spent)} remaining</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAdd    && <AddModal    onClose={()=>setShowAdd(false)}    onAdd={addTxn} />}
      {showBudget && <BudgetModal onClose={()=>setShowBudget(false)} budgets={budgets} onSave={setBudgets} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        input::placeholder { color: #444; }
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>
    </div>
  );
}