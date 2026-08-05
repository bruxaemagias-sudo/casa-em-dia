import React, { useState, useEffect, useCallback, useRef } from "react";
import { createWorker } from "tesseract.js";
import {
  Home, Phone, ShoppingBasket, Pill, Wallet, Plus, Minus, Trash2,
  Camera, UploadCloud, MessageCircle, AlertTriangle, X, ChevronDown, Lock,
  Check, Users, CalendarDays, Sparkles, Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";

/* ---------------------------------------------------------------------- */
/*  LAR EM DIA — secretária do lar                                        */
/*  Paleta "azulejo de cozinha": marinho, terracota, sálvia e marfim        */
/* ---------------------------------------------------------------------- */

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => (iso || todayISO()).slice(0, 7);

const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function monthLabel(mk) {
  const [y, m] = mk.split("-").map(Number);
  return `${MESES[m - 1]} de ${y}`;
}
function fmtDateBR(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function fmtMoney(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(todayISO() + "T00:00:00");
  const target = new Date(iso + "T00:00:00");
  return Math.round((target - today) / 86400000);
}
function itemStatus(item) {
  const d = daysUntil(item.validade);
  if (item.qty <= 0) return "falta";
  if (d !== null && d < 0) return "vencido";
  if (d !== null && d <= 7) return "vencendo";
  if (item.qty <= 2) return "baixo";
  return "ok";
}
const STATUS_META = {
  falta:    { label: "Em falta",        color: "var(--danger)", bg: "var(--danger-bg)" },
  vencido:  { label: "Vencido",         color: "var(--danger)", bg: "var(--danger-bg)" },
  vencendo: { label: "Vencendo",        color: "var(--gold)",   bg: "var(--gold-bg)"   },
  baixo:    { label: "Estoque baixo",   color: "var(--clay)",   bg: "var(--clay-bg)"   },
  ok:       { label: "Em dia",          color: "var(--sage)",   bg: "var(--sage-bg)"   },
};

/* --------------------- leitura automática por foto (OCR) ----------------- */
let ocrWorkerPromise = null;
async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    const worker = await createWorker("por");
    ocrWorkerPromise = worker;
  }
  return ocrWorkerPromise;
}

function preprocessImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível abrir a imagem"));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagem inválida"));
      img.onload = () => {
        const minWidth = 1400;
        const scale = img.width < minWidth ? minWidth / img.width : 1;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          let v = (gray - 128) * 1.6 + 128;
          v = Math.max(0, Math.min(255, v));
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao processar imagem"))), "image/png");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function extractTextFromImage(file) {
  const worker = await getOcrWorker();
  let input = file;
  try {
    input = await preprocessImage(file);
  } catch {
    input = file;
  }
  const { data } = await worker.recognize(input);
  return data.text || "";
}

function parseReceiptText(rawText) {
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const dateMatch = rawText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null;

  const allMoney = [...rawText.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)]
    .map((m) => parseFloat(m[0].replace(/\./g, "").replace(",", ".")))
    .filter((n) => !isNaN(n) && n > 0);

  let total = null;
  const totalMatches = [...rawText.matchAll(/TOTAL[^\d\n]{0,20}(\d{1,3}(?:\.\d{3})*,\d{2})/gi)];
  if (totalMatches.length) {
    total = parseFloat(totalMatches[totalMatches.length - 1][1].replace(/\./g, "").replace(",", "."));
  } else if (allMoney.length) {
    total = Math.max(...allMoney);
  }

  const local = lines.find((l) => l.length > 3 && !/^\d+$/.test(l) && !/^\d{2}\/\d{2}\/\d{4}/.test(l)) || null;

  const items = [];
  for (const line of lines) {
    const cleanLine = line.replace(/^\d+\s*(UN|KG|UNID|PC|CX)?\s*/i, "").trim();
    if (cleanLine.length > 2 && !/total|troco|dinheiro|cart[aã]o|desconto|subtotal|cnpj|cpf|data|caixa|operador/i.test(cleanLine)) {
      items.push({ name: cleanLine, qty: 1, unit: "un", validade: randFutureDate(30, 180) });
    }
  }
  return { date, total, local, items };
}

function onlyDigits(s) { return (s || "").replace(/\D/g, ""); }
function waLink(phone, text) {
  let d = onlyDigits(phone);
  if (d && !d.startsWith("55")) d = "55" + d;
  const base = d ? `https://wa.me/${d}` : `https://wa.me/`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

function randFutureDate(minD, maxD) {
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(minD + Math.random() * (maxD - minD)));
  return d.toISOString().slice(0, 10);
}

/* ------------------------------- estilo -------------------------------- */

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap');

    .lardia * { box-sizing: border-box; }
    .lardia {
      --bg: #F6EFDF;
      --paper: #FFFFFE;
      --ink: #24312B;
      --ink-soft: #6C7568;
      --line: #E6DCC0;
      --primary: #1F4160;
      --primary-dark: #16324C;
      --primary-tint: #E4EBF0;
      --clay: #B5502F;
      --clay-bg: #F6E3DA;
      --sage: #5F7A4E;
      --sage-bg: #E4EBDD;
      --gold: #A97C1C;
      --gold-bg: #F3E7C9;
      --danger: #A23B3B;
      --danger-bg: #F3DEDE;
      font-family: 'Manrope', sans-serif;
      color: var(--ink);
      background: var(--bg);
      min-height: 100vh;
      width: 100%;
      display: flex;
      justify-content: center;
      padding: 0;
    }
    .lardia .display { font-family: 'Fraunces', serif; }

    .phone-shell {
      width: 100%;
      max-width: 430px;
      min-height: 100vh;
      background: var(--paper);
      position: relative;
      display: flex;
      flex-direction: column;
      box-shadow: 0 30px 60px -20px rgba(31,65,96,0.25);
    }
    @media (min-width: 480px) {
      .phone-shell { min-height: 860px; margin: 24px 0; border-radius: 28px; overflow: hidden; }
      .lardia { background: 
        radial-gradient(circle at 15% 20%, rgba(31,65,96,0.06) 0, transparent 45%),
        radial-gradient(circle at 85% 80%, rgba(181,80,47,0.06) 0, transparent 45%),
        var(--bg);
      }
    }

    .tile-pattern {
      background-image:
        repeating-linear-gradient(45deg, rgba(255,255,255,0.09) 0 2px, transparent 2px 22px),
        repeating-linear-gradient(-45deg, rgba(255,255,255,0.09) 0 2px, transparent 2px 22px);
    }

    .header {
      background: var(--primary);
      color: #fff;
      padding: 22px 20px 26px;
      position: relative;
      overflow: hidden;
    }
    .header .eyebrow {
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      opacity: 0.75;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header h1 {
      font-size: 26px;
      margin: 4px 0 2px;
      font-weight: 600;
    }
    .header .sub { font-size: 13.5px; opacity: 0.85; }

    .scroll-area {
      flex: 1;
      overflow-y: auto;
      padding: 18px 18px 100px;
    }

    .section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--ink-soft); margin: 22px 0 10px;
      font-weight: 700;
    }
    .section-title:first-child { margin-top: 4px; }
    .tab-dot { width: 8px; height: 8px; border-radius: 2px; transform: rotate(45deg); background: var(--clay); flex: none; }

    .card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px 14px;
      margin-bottom: 10px;
      position: relative;
    }

    .alert-card { display: flex; align-items: flex-start; gap: 10px; border-radius: 14px; padding: 12px 14px; margin-bottom: 8px; }
    .alert-icon { flex: none; width: 30px; height: 30px; border-radius: 9px; display: flex; align-items: center; justify-content: center; }
    .alert-title { font-weight: 700; font-size: 14px; }
    .alert-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 1px; }

    .empty-state {
      text-align: center; padding: 40px 20px; color: var(--ink-soft);
    }
    .empty-state .display { font-size: 18px; color: var(--ink); margin-bottom: 6px; }

    .item-row { display: flex; align-items: center; gap: 12px; }
    .item-info { flex: 1; min-width: 0; }
    .item-name { font-weight: 700; font-size: 14.5px; }
    .item-meta { font-size: 12px; color: var(--ink-soft); margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; }
    .stepper { display: flex; align-items: center; gap: 8px; background: var(--bg); border-radius: 20px; padding: 4px; border: 1px solid var(--line); }
    .stepper button { width: 26px; height: 26px; border-radius: 50%; border: none; background: var(--paper); display: flex; align-items: center; justify-content: center; color: var(--primary); cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
    .stepper button:active { transform: scale(0.92); }
    .stepper .qty { min-width: 20px; text-align: center; font-weight: 700; font-size: 14px; }

    .icon-btn { border: none; background: transparent; color: var(--ink-soft); cursor: pointer; padding: 6px; border-radius: 8px; display: flex; }
    .icon-btn:hover { background: var(--bg); color: var(--danger); }

    .contact-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border: 1px solid var(--line); border-radius: 14px; margin-bottom: 8px; background: var(--paper); }
    .avatar { width: 42px; height: 42px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-family: 'Fraunces', serif; flex: none; }
    .contact-actions { display: flex; align-items: center; gap: 8px; }
    .wa-btn { width: 38px; height: 38px; border-radius: 50%; background: #25D366; color: #fff; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; text-decoration: none; box-shadow: 0 2px 5px rgba(37,211,102,0.3); }
    .wa-btn:active { transform: scale(0.92); }

    .fab-add {
      position: sticky; bottom: 0; margin-top: 14px;
      width: 100%; padding: 13px; border-radius: 14px; border: none;
      background: var(--primary); color: #fff; font-weight: 700; font-size: 14.5px;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      cursor: pointer;
    }
    .scan-row { display: flex; gap: 8px; margin-top: 10px; }
    .scan-btn {
      flex: 1; border: 1.5px dashed var(--line); background: var(--bg);
      color: var(--primary); border-radius: 12px; padding: 12px 8px;
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .scan-btn:active { transform: scale(0.98); }

    .bottom-nav {
      position: sticky; bottom: 0; left: 0; right: 0;
      background: var(--paper); border-top: 1px solid var(--line);
      display: flex; justify-content: space-around; padding: 8px 4px 10px;
      z-index: 30;
    }
    .nav-btn { border: none; background: transparent; display: flex; flex-direction: column; align-items: center; gap: 3px; color: var(--ink-soft); font-size: 10.5px; font-weight: 700; cursor: pointer; padding: 4px 6px; border-radius: 10px; }
    .nav-btn.active { color: var(--primary); }
    .nav-btn .dot-pill { width: 34px; height: 26px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
    .nav-btn.active .dot-pill { background: var(--primary-tint); }

    .modal-overlay {
      position: fixed; inset: 0; background: rgba(31,40,35,0.5);
      display: flex; align-items: flex-end; justify-content: center; z-index: 100;
    }
    @media (min-width: 480px) { .modal-overlay { align-items: center; } }
    .modal-sheet {
      background: var(--paper); width: 100%; max-width: 430px;
      border-radius: 22px 22px 0 0; padding: 20px 20px 26px; max-height: 88vh; overflow-y: auto;
    }
    @media (min-width: 480px) { .modal-sheet { border-radius: 22px; } }
    .modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .modal-head h3 { font-family: 'Fraunces', serif; font-size: 19px; font-weight: 600; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 12px; font-weight: 700; color: var(--ink-soft); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.05em; }
    .field input, .field select { width: 100%; padding: 11px 12px; border-radius: 10px; border: 1.5px solid var(--line); font-size: 14.5px; font-family: inherit; background: var(--paper); color: var(--ink); }
    .field input:focus, .field select:focus { outline: none; border-color: var(--primary); }
    .btn-primary { width: 100%; padding: 13px; border-radius: 12px; border: none; background: var(--primary); color: #fff; font-weight: 700; font-size: 14.5px; cursor: pointer; }
    .btn-ghost { width: 100%; padding: 12px; border-radius: 12px; border: none; background: transparent; color: var(--ink-soft); font-weight: 700; font-size: 13.5px; cursor: pointer; margin-top: 6px; }

    .toast {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: var(--primary-dark); color: #fff; padding: 10px 18px; border-radius: 30px;
      font-size: 13px; font-weight: 600; z-index: 200; box-shadow: 0 8px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; gap: 8px;
    }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `}</style>
);

/* ------------------------------- storage -------------------------------- */

async function loadKey(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const SEED_CONTACTS = [
  { id: uid(), name: "Mariana", relation: "Filha", phone: "51999990001" },
  { id: uid(), name: "Roberto", relation: "Esposo", phone: "51999990002" },
];

/* --------------------------------- app ----------------------------------- */

export default function LarEmDiaApp() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("home");
  const [toast, setToast] = useState(null);

  const [contacts, setContacts] = useState([]);
  const [groceries, setGroceries] = useState([]);
  const [pharmacy, setPharmacy] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [viewMonth, setViewMonth] = useState(monthKey(todayISO()));

  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddItem, setShowAddItem] = useState(null); 
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseDraft, setExpenseDraft] = useState(null);
  const [scanningFor, setScanningFor] = useState(null);
  
  // Estados para formulário de contato
  const [contactName, setContactName] = useState("");
  const [contactRelation, setContactRelation] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  // Estados para formulários manuais de itens
  const [manualName, setManualName] = useState("");
  const [manualQty, setManualQty] = useState("1");
  const [manualValidade, setManualValidade] = useState(randFutureDate(30, 90));

  const fileInputRef = useRef(null);
  const pendingScan = useRef(null);

  useEffect(() => {
    (async () => {
      const [c, g, p, e] = await Promise.all([
        loadKey("ldd:contacts", null),
        loadKey("ldd:groceries", null),
        loadKey("ldd:pharmacy", null),
        loadKey("ldd:expenses", null),
      ]);
      setContacts(c ?? SEED_CONTACTS);
      setGroceries(g ?? []);
      setPharmacy(p ?? []);
      setExpenses(e ?? []);
      setReady(true);
    })();
  }, []);

  useEffect(() => { if (ready) saveKey("ldd:contacts", contacts); }, [contacts, ready]);
  useEffect(() => { if (ready) saveKey("ldd:groceries", groceries); }, [groceries, ready]);
  useEffect(() => { if (ready) saveKey("ldd:pharmacy", pharmacy); }, [pharmacy, ready]);
  useEffect(() => { if (ready) saveKey("ldd:expenses", expenses); }, [expenses, ready]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  function adjustQty(listSetter, id, delta) {
    listSetter((list) => list.map((it) => (it.id === id ? { ...it, qty: Math.max(0, it.qty + delta) } : it)));
  }
  function removeItem(listSetter, id) {
    listSetter((list) => list.filter((it) => it.id !== id));
  }

  function openScanner(target) {
    pendingScan.current = target;
    const input = fileInputRef.current;
    if (!input) return;
    input.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    const target = pendingScan.current;
    e.target.value = ""; 
    if (!file || !target) return;

    setScanningFor(target);
    let text = "";
    try {
      text = await extractTextFromImage(file);
    } catch {
      setScanningFor(null);
      showToast("Erro ao ler a imagem. Adicione manualmente.");
      setShowAddItem(target === "receipt" ? "grocery" : target);
      return;
    }
    setScanningFor(null);

    const data = parseReceiptText(text);
    if (target === "receipt") {
      setExpenseDraft({
        date: data.date || todayISO(),
        local: data.local || "",
        value: data.total ? data.total.toFixed(2) : "",
      });
      setShowAddExpense(true);
    } else {
      if (data.items.length > 0) {
        const newItems = data.items.map(i => ({ id: uid(), ...i }));
        if (target === "grocery") setGroceries(l => [...newItems, ...l]);
        if (target === "pharmacy") setPharmacy(l => [...newItems, ...l]);
        showToast(`${newItems.length} item(ns) adicionado(s) da foto!`);
      } else {
        showToast("Não achamos itens legíveis na foto. Insira manualmente.");
        setManualName("");
        setManualQty("1");
        setManualValidade(randFutureDate(30, 90));
        setShowAddItem(target);
      }
    }
  }

  const allAlerts = [...groceries.map((i) => ({ ...i, origin: "Despensa" })), ...pharmacy.map((i) => ({ ...i, origin: "Farmácia" }))]
    .map((i) => ({ ...i, status: itemStatus(i) }))
    .filter((i) => i.status !== "ok");

  const monthExpenses = expenses.filter((e) => monthKey(e.date) === viewMonth);
  const monthTotal = monthExpenses.reduce((s, e) => s + e.value, 0);

  if (!ready) {
    return (
      <div className="lardia">
        <GlobalStyle />
        <div className="phone-shell" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
          <Loader2 className="spin" size={26} color="#1F4160" />
        </div>
      </div>
    );
  }

  return (
    <div className="lardia">
      <GlobalStyle />
      <div className="phone-shell">
        {toast && <div className="toast"><Check size={15} /> {toast}</div>}

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />

        {scanningFor && (
          <div className="modal-overlay">
            <div className="modal-sheet" style={{ textAlign: "center", padding: "30px" }}>
              <Loader2 className="spin" size={32} color="#1F4160" style={{ margin: "0 auto 12px" }} />
              <div style={{ fontWeight: "700", fontSize: "16px" }}>Lendo imagem...</div>
              <div style={{ fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" }}>Aguarde um instante.</div>
            </div>
          </div>
        )}

        <div className="header tile-pattern">
          <div className="eyebrow"><Sparkles size={13} /> Lar em Dia</div>
          <h1 className="display">
            {tab === "home" && "Visão geral"}
            {tab === "contatos" && "Contatos"}
            {tab === "mercadoria" && "Despensa"}
            {tab === "farmacia" && "Farmácia"}
            {tab === "gastos" && "Gastos do mês"}
          </h1>
          <div className="sub">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </div>
        </div>

        <div className="scroll-area">
          {tab === "home" && (
            <div>
              <div className="card" style={{ background: "var(--primary-tint)", border: "none" }}>
                <div style={{ fontWeight: "700", color: "var(--primary)", marginBottom: "8px" }}>Ações Rápidas</div>
                <div className="scan-row">
                  <button className="scan-btn" onClick={() => openScanner("grocery")}>
                    <Camera size={18} /> Escanear Despensa
                  </button>
                  <button className="scan-btn" onClick={() => openScanner("receipt")}>
                    <UploadCloud size={18} /> Nota para Gastos
                  </button>
                </div>
              </div>

              <div className="section-title"><span className="tab-dot" /> Alertas da Casa ({allAlerts.length})</div>
              {allAlerts.length === 0 ? (
                <div className="empty-state card">
                  <div className="display">Tudo em dia!</div>
                  <p style={{ fontSize: "13px" }}>Nenhum item vencendo ou em falta no momento.</p>
                </div>
              ) : (
                allAlerts.map((item) => (
                  <div key={item.id} className="card alert-card" style={{ background: STATUS_META[item.status].bg }}>
                    <div className="alert-icon" style={{ background: STATUS_META[item.status].color, color: "#fff" }}>
                      <AlertTriangle size={16} />
                    </div>
                    <div>
                      <div className="alert-title">{item.name}</div>
                      <div className="alert-sub">Origem: {item.origin} — {STATUS_META[item.status].label}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "mercadoria" && (
            <div>
              <div className="scan-row" style={{ marginBottom: "14px" }}>
                <button className="scan-btn" onClick={() => openScanner("grocery")}>
                  <Camera size={18} /> Ler Nota para Despensa
                </button>
              </div>
              <div className="section-title"><span className="tab-dot" /> Itens na Despensa</div>
              {groceries.length === 0 ? (
                <div className="empty-state card">
                  <div className="display">Despensa vazia</div>
                  <p style={{ fontSize: "13px" }}>Adicione itens manualmente ou escaneie uma foto.</p>
                </div>
              ) : (
                groceries.map((item) => (
                  <div key={item.id} className="card item-row">
                    <div className="item-info">
                      <div className="item-name">{item.name}</div>
                      <div className="item-meta">
                        <span>Val: {fmtDateBR(item.validade)}</span>
                      </div>
                    </div>
                    <div className="stepper">
                      <button onClick={() => adjustQty(setGroceries, item.id, -1)}><Minus size={13} /></button>
                      <span className="qty">{item.qty}</span>
                      <button onClick={() => adjustQty(setGroceries, item.id, 1)}><Plus size={13} /></button>
                    </div>
                    <button className="icon-btn" onClick={() => removeItem(setGroceries, item.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
              <button className="fab-add" onClick={() => { setManualName(""); setManualQty("1"); setShowAddItem("grocery"); }}>
                <Plus size={18} /> Adicionar Novo Item
              </button>
            </div>
          )}

          {tab === "farmacia" && (
            <div>
              <div className="scan-row" style={{ marginBottom: "14px" }}>
                <button className="scan-btn" onClick={() => openScanner("pharmacy")}>
                  <Camera size={18} /> Ler Nota para Farmácia
                </button>
              </div>
              <div className="section-title"><span className="tab-dot" /> Itens na Farmácia</div>
              {pharmacy.length === 0 ? (
                <div className="empty-state card">
                  <div className="display">Farmácia vazia</div>
                  <p style={{ fontSize: "13px" }}>Adicione remédios manualmente ou por foto.</p>
                </div>
              ) : (
                pharmacy.map((item) => (
                  <div key={item.id} className="card item-row">
                    <div className="item-info">
                      <div className="item-name">{item.name}</div>
                      <div className="item-meta">
                        <span>Val: {fmtDateBR(item.validade)}</span>
                      </div>
                    </div>
                    <div className="stepper">
                      <button onClick={() => adjustQty(setPharmacy, item.id, -1)}><Minus size={13} /></button>
                      <span className="qty">{item.qty}</span>
                      <button onClick={() => adjustQty(setPharmacy, item.id, 1)}><Plus size={13} /></button>
                    </div>
                    <button className="icon-btn" onClick={() => removeItem(setPharmacy, item.id)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
              <button className="fab-add" onClick={() => { setManualName(""); setManualQty("1"); setShowAddItem("pharmacy"); }}>
                <Plus size={18} /> Adicionar Remédio/Item
              </button>
            </div>
          )}

          {tab === "gastos" && (
            <div>
              <div className="card" style={{ background: "var(--primary)", color: "#fff", textAlign: "center", padding: "20px" }}>
                <div style={{ fontSize: "12px", opacity: 0.8, textTransform: "uppercase" }}>Total do Mês</div>
                <div className="display" style={{ fontSize: "32px", marginTop: "4px" }}>{fmtMoney(monthTotal)}</div>
              </div>
              <div className="scan-row" style={{ marginBottom: "14px" }}>
                <button className="scan-btn" onClick={() => openScanner("receipt")}>
                  <Camera size={18} /> Escanear Nota Fiscal de Gastos
                </button>
              </div>
              <div className="section-title"><span className="tab-dot" /> Histórico de Gastos</div>
              {monthExpenses.length === 0 ? (
                <div className="empty-state card">
                  <div className="display">Nenhum gasto registrado</div>
                  <p style={{ fontSize: "13px" }}>Use o botão acima para escanear uma nota ou adicione manualmente.</p>
                </div>
              ) : (
                monthExpenses.map((exp) => (
                  <div key={exp.id} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: "700" }}>{exp.local || "Estabelecimento"}</div>
                      <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>{fmtDateBR(exp.date)}</div>
                    </div>
                    <div className="display" style={{ fontWeight: "600", color: "var(--primary)" }}>{fmtMoney(exp.value)}</div>
                  </div>
                ))
              )}
              <button className="fab-add" onClick={() => { setExpenseDraft({ date: todayISO(), local: "", value: "" }); setShowAddExpense(true); }}>
                <Plus size={18} /> Adicionar Gasto Manual
              </button>
            </div>
          )}

          {tab === "contatos" && (
            <div>
              <div className="section-title"><span className="tab-dot" /> Lista de Contatos</div>
              {contacts.length === 0 ? (
                <div className="empty-state card">
                  <div className="display">Nenhum contato</div>
                  <p style={{ fontSize: "13px" }}>Adicione familiares ou profissionais úteis.</p>
                </div>
              ) : (
                contacts.map((c) => (
                  <div key={c.id} className="contact-row">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                      <div className="avatar">{(c.name || "C").charAt(0)}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: "700", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                        <div style={{ fontSize: "12px", color: "var(--ink-soft)" }}>{c.relation} • {c.phone}</div>
                      </div>
                    </div>
                    <div className="contact-actions">
                      <a className="wa-btn" href={waLink(c.phone, "Olá!")} target="_blank" rel="noreferrer" title="Enviar WhatsApp">
                        <MessageCircle size={18} />
                      </a>
                      <button className="icon-btn" onClick={() => removeItem(setContacts, c.id)} title="Remover Contato">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))
              )}
              <button className="fab-add" onClick={() => { setContactName(""); setContactRelation(""); setContactPhone(""); setShowAddContact(true); }}>
                <Plus size={18} /> Adicionar Novo Contato
              </button>
            </div>
          )}
        </div>

        {/* Modal para Adicionar Contato */}
        {showAddContact && (
          <div className="modal-overlay" onClick={() => setShowAddContact(false)}>
            <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Novo Contato</h3>
                <button className="icon-btn" onClick={() => setShowAddContact(false)}><X size={18} /></button>
              </div>
              <div className="field">
                <label>Nome</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Ex: Maria"
                />
              </div>
              <div className="field">
                <label>Parentesco / Função</label>
                <input
                  type="text"
                  value={contactRelation}
                  onChange={(e) => setContactRelation(e.target.value)}
                  placeholder="Ex: Filha, Encanador, Farmácia..."
                />
              </div>
              <div className="field">
                <label>Telefone / WhatsApp (com DDD)</label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="Ex: 51999998888"
                />
              </div>
              <button
                className="btn-primary"
                onClick={() => {
                  if (!contactName.trim() || !contactPhone.trim()) {
                    showToast("Preencha o nome e o telefone");
                    return;
                  }
                  const newContact = {
                    id: uid(),
                    name: contactName.trim(),
                    relation: contactRelation.trim() || "Contato",
                    phone: contactPhone.trim(),
                  };
                  setContacts((list) => [newContact, ...list]);
                  setShowAddContact(false);
                  showToast("Contato salvo com sucesso!");
                }}
              >
                Salvar Contato
              </button>
            </div>
          </div>
        )}

        {/* Modal para Adicionar Item Manualmente (Despensa ou Farmácia) */}
        {showAddItem && (
          <div className="modal-overlay" onClick={() => setShowAddItem(null)}>
            <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Adicionar em {showAddItem === "grocery" ? "Despensa" : "Farmácia"}</h3>
                <button className="icon-btn" onClick={() => setShowAddItem(null)}><X size={18} /></button>
              </div>
              <div className="field">
                <label>Nome do Item</label>
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="Ex: Arroz, Leite, Dipirona..."
                />
              </div>
              <div className="field">
                <label>Quantidade</label>
                <input
                  type="number"
                  min="0"
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                />
              </div>
              <div className="field">
                <label>Validade</label>
                <input
                  type="date"
                  value={manualValidade}
                  onChange={(e) => setManualValidade(e.target.value)}
                />
              </div>
              <button
                className="btn-primary"
                onClick={() => {
                  if (!manualName.trim()) {
                    showToast("Digite o nome do item");
                    return;
                  }
                  const newItem = {
                    id: uid(),
                    name: manualName.trim(),
                    qty: parseInt(manualQty) || 1,
                    validade: manualValidade || todayISO(),
                  };
                  if (showAddItem === "grocery") {
                    setGroceries((list) => [newItem, ...list]);
                  } else {
                    setPharmacy((list) => [newItem, ...list]);
                  }
                  setShowAddItem(null);
                  showToast("Item adicionado com sucesso!");
                }}
              >
                Salvar Item
              </button>
            </div>
          </div>
        )}

        {/* Modal de Despesa Manual / OCR */}
        {showAddExpense && expenseDraft && (
          <div className="modal-overlay" onClick={() => setShowAddExpense(false)}>
            <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h3>Registrar Gasto</h3>
                <button className="icon-btn" onClick={() => setShowAddExpense(false)}><X size={18} /></button>
              </div>
              <div className="field">
                <label>Estabelecimento / Local</label>
                <input
                  type="text"
                  value={expenseDraft.local}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, local: e.target.value })}
                  placeholder="Ex: Supermercado"
                />
              </div>
              <div className="field">
                <label>Valor Total (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={expenseDraft.value}
                  onChange={(e) => setExpenseDraft({ ...expenseDraft, value: e.target.value })}
                  placeholder="0,00"
                />
              </div>
              <button
                className="btn-primary"
                onClick={() => {
                  setExpenses((list) => [{ id: uid(), date: expenseDraft.date, local: expenseDraft.local, value: parseFloat(expenseDraft.value) || 0 }, ...list]);
                  setShowAddExpense(false);
                  setExpenseDraft(null);
                  showToast("Gasto registrado com sucesso!");
                }}
              >
                Salvar Gasto
              </button>
            </div>
          </div>
        )}

        {/* Navegação Inferior */}
        <div className="bottom-nav">
          <button className={`nav-btn ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>
            <div className="dot-pill"><Home size={18} /></div>
            Início
          </button>
          <button className={`nav-btn ${tab === "mercadoria" ? "active" : ""}`} onClick={() => setTab("mercadoria")}>
            <div className="dot-pill"><ShoppingBasket size={18} /></div>
            Despensa
          </button>
          <button className={`nav-btn ${tab === "gastos" ? "active" : ""}`} onClick={() => setTab("gastos")}>
            <div className="dot-pill"><Wallet size={18} /></div>
            Gastos
          </button>
          <button className={`nav-btn ${tab === "contatos" ? "active" : ""}`} onClick={() => setTab("contatos")}>
            <div className="dot-pill"><Users size={18} /></div>
            Contatos
          </button>
        </div>

      </div>
    </div>
  );
}
