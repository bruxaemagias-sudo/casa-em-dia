import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Home, Phone, ShoppingBasket, Pill, Wallet, Plus, Minus, Trash2,
  Camera, UploadCloud, MessageCircle, AlertTriangle, X, ChevronDown,
  Check, Users, CalendarDays, Sparkles, Loader2, ChevronLeft, ChevronRight,
} from "lucide-react";

/* ---------------------------------------------------------------------- */
/*  LAR EM DIA — secretária do lar                                         */
/*  Paleta "azulejo de cozinha": marinho, terracota, sálvia e marfim       */
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

/* --------------------- leitura real de QR Code (NFC-e) ------------------- */
// Carrega a lib jsQR do CDN (decodificação de QR Code 100% no navegador, sem servidor)
function loadJsQR() {
  return new Promise((resolve) => {
    if (window.jsQR) return resolve(true);
    const s = document.createElement("script");
   s.src="htps://cdn.jsdelivr.net/npm/jsqr/dist/jsQR.js";
    s.onload = () => resolve(!!window.jsQR);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

// Lê o QR Code de um arquivo de imagem e devolve o texto decodificado (ou null)
function decodeQRFromImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível abrir a imagem"));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagem inválida"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR ? window.jsQR(imageData.data, imageData.width, imageData.height) : null;
        resolve(code ? code.data : null);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Tenta abrir a página oficial da nota (Sefaz) e extrair itens/valor.
// Muitos portais estaduais bloqueiam esse acesso automático por segurança (CORS) —
// nesse caso a função lança erro e o app oferece o link oficial + preenchimento manual.
async function tryFetchNfceData(url) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("Não foi possível abrir a nota");
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const local = doc.querySelector(".txtTopo, .txtCenter")?.textContent?.trim() || null;

  const items = [];
  doc.querySelectorAll("#tabResult tr").forEach((row) => {
    const desc = row.querySelector(".txtTit")?.textContent?.trim();
    const qtdTxt = row.querySelector(".Rqtd")?.textContent?.replace("Qtde.:", "").trim();
    if (desc) {
      const qtd = parseFloat((qtdTxt || "1").replace(",", ".")) || 1;
      items.push({ name: desc, qty: Math.max(1, Math.round(qtd)), unit: "un", validade: randFutureDate(15, 220) });
    }
  });

  const totalTxt = doc.querySelector("#linhaTotal .txtMax, #valorTotal")?.textContent
    ?.replace(/[^\d,]/g, "")?.replace(",", ".");
  const total = totalTxt ? parseFloat(totalTxt) : null;

  return { local, items, total };
}

function onlyDigits(s) { return (s || "").replace(/\D/g, ""); }
function waLink(phone, text) {
  let d = onlyDigits(phone);
  if (d && !d.startsWith("55")) d = "55" + d;
  const base = d ? `https://wa.me/${d}` : `https://wa.me/`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

const GROCERY_POOL = [
  { name: "Arroz branco 5kg", category: "Alimentos", unit: "pct" },
  { name: "Feijão carioca 1kg", category: "Alimentos", unit: "pct" },
  { name: "Óleo de soja 900ml", category: "Alimentos", unit: "un" },
  { name: "Café em pó 500g", category: "Alimentos", unit: "pct" },
  { name: "Açúcar refinado 1kg", category: "Alimentos", unit: "pct" },
  { name: "Macarrão espaguete", category: "Alimentos", unit: "pct" },
  { name: "Leite integral 1L", category: "Alimentos", unit: "un" },
  { name: "Farinha de trigo 1kg", category: "Alimentos", unit: "pct" },
  { name: "Sabão em pó", category: "Limpeza", unit: "cx" },
  { name: "Detergente neutro", category: "Limpeza", unit: "un" },
  { name: "Água sanitária", category: "Limpeza", unit: "un" },
  { name: "Papel higiênico 12un", category: "Limpeza", unit: "pct" },
];
const PHARMACY_POOL = [
  { name: "Dipirona 500mg", unit: "cx" },
  { name: "Paracetamol 750mg", unit: "cx" },
  { name: "Omeprazol 20mg", unit: "cx" },
  { name: "Losartana 50mg", unit: "cx" },
  { name: "Vitamina D", unit: "fr" },
  { name: "Soro fisiológico", unit: "un" },
  { name: "Curativo adesivo", unit: "cx" },
  { name: "Álcool em gel 70%", unit: "un" },
];
const STORE_POOL = [
  "Supermercado Extra", "Mercado Bom Preço", "Farmácia São João",
  "Hortifruti da Esquina", "Atacadão", "Farmácia Pague Menos", "Padaria Pão Dourado",
];

function randFutureDate(minD, maxD) {
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(minD + Math.random() * (maxD - minD)));
  return d.toISOString().slice(0, 10);
}
function pick(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
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

    .badge {
      font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 20px;
      display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
    }

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

    .contact-row { display: flex; align-items: center; gap: 12px; padding: 12px 4px; border-bottom: 1px solid var(--line); }
    .contact-row:last-child { border-bottom: none; }
    .avatar { width: 42px; height: 42px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-family: 'Fraunces', serif; flex: none; }
    .wa-btn { flex: none; width: 40px; height: 40px; border-radius: 50%; background: #25D366; color: #fff; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; text-decoration:none; }
    .wa-btn:active { transform: scale(0.94); }

    .fab {
      position: absolute; right: 18px; bottom: 92px;
      width: 54px; height: 54px; border-radius: 50%;
      background: #25D366; color: #fff; border: none;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 20px rgba(37,211,102,0.4);
      cursor: pointer; z-index: 20;
      text-decoration: none;
    }
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
    .field-row { display: flex; gap: 10px; }
    .field-row .field { flex: 1; }
    .btn-primary { width: 100%; padding: 13px; border-radius: 12px; border: none; background: var(--primary); color: #fff; font-weight: 700; font-size: 14.5px; cursor: pointer; }
    .btn-ghost { width: 100%; padding: 12px; border-radius: 12px; border: none; background: transparent; color: var(--ink-soft); font-weight: 700; font-size: 13.5px; cursor: pointer; margin-top: 6px; }

    .month-switch { display: flex; align-items: center; justify-content: center; gap: 14px; margin-bottom: 4px; }
    .month-switch button { border: none; background: var(--primary-tint); color: var(--primary); width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .month-switch button:disabled { opacity: 0.35; cursor: default; }
    .total-card { background: var(--primary); color: #fff; border-radius: 18px; padding: 20px; text-align: center; margin-bottom: 16px; }
    .total-card .amount { font-family: 'Fraunces', serif; font-size: 32px; font-weight: 600; margin-top: 4px; }
    .receipt-row { display: flex; align-items: center; justify-content: space-between; }
    .receipt-local { font-weight: 700; font-size: 14px; }
    .receipt-date { font-size: 12px; color: var(--ink-soft); }
    .receipt-value { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--primary); }

    .parsed-item { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 12px; margin-bottom: 8px; }
    .parsed-item .check { width: 22px; height: 22px; border-radius: 6px; border: 1.5px solid var(--line); display: flex; align-items: center; justify-content: center; flex: none; cursor: pointer; }
    .parsed-item .check.on { background: var(--sage); border-color: var(--sage); color: #fff; }

    .scanning-overlay { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 30px 10px; color: var(--primary); }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .toast {
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: var(--primary-dark); color: #fff; padding: 10px 18px; border-radius: 30px;
      font-size: 13px; font-weight: 600; z-index: 200; box-shadow: 0 8px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; gap: 8px;
    }
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
  { id: uid(), name: "Mariana (filha)", relation: "Filha", phone: "51999990001" },
  { id: uid(), name: "Roberto (marido)", relation: "Esposo", phone: "51999990002" },
];
const SEED_GROCERIES = [
  { id: uid(), name: "Arroz branco 5kg", category: "Alimentos", unit: "pct", qty: 1, validade: randFutureDate(120, 200) },
  { id: uid(), name: "Leite integral 1L", category: "Alimentos", unit: "un", qty: 2, validade: randFutureDate(-2, 4) },
  { id: uid(), name: "Detergente neutro", category: "Limpeza", unit: "un", qty: 0, validade: randFutureDate(200, 300) },
];
const SEED_PHARMACY = [
  { id: uid(), name: "Dipirona 500mg", unit: "cx", qty: 1, validade: randFutureDate(180, 300) },
  { id: uid(), name: "Omeprazol 20mg", unit: "cx", qty: 0, validade: randFutureDate(200, 260) },
];

/* --------------------------------- app ----------------------------------- */

export default function LarEmDia() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("home");
  const [toast, setToast] = useState(null);

  const [contacts, setContacts] = useState([]);
  const [groceries, setGroceries] = useState([]);
  const [pharmacy, setPharmacy] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [viewMonth, setViewMonth] = useState(monthKey(todayISO()));

  const [showAddContact, setShowAddContact] = useState(false);
  const [showAddItem, setShowAddItem] = useState(null); // 'grocery' | 'pharmacy'
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseDraft, setExpenseDraft] = useState(null);
  const [scanningFor, setScanningFor] = useState(null);
  const [parsedModal, setParsedModal] = useState(null); // { target, items }
  const [qrFallback, setQrFallback] = useState(null); // { url, chave, target }
  const [qrReady, setQrReady] = useState(false);
  const fileInputRef = useRef(null);
  const pendingScan = useRef(null); // 'grocery' | 'pharmacy' | 'receipt'

  useEffect(() => { loadJsQR().then(setQrReady); }, []);

  useEffect(() => {
    (async () => {
      const [c, g, p, e] = await Promise.all([
        loadKey("ldd:contacts", null),
        loadKey("ldd:groceries", null),
        loadKey("ldd:pharmacy", null),
        loadKey("ldd:expenses", null),
      ]);
      setContacts(c ?? SEED_CONTACTS);
      setGroceries(g ?? SEED_GROCERIES);
      setPharmacy(p ?? SEED_PHARMACY);
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

  /* ---------- ações mercadoria / farmácia ---------- */
  function adjustQty(listSetter, id, delta) {
    listSetter((list) => list.map((it) => (it.id === id ? { ...it, qty: Math.max(0, it.qty + delta) } : it)));
  }
  function removeItem(listSetter, id) {
    listSetter((list) => list.filter((it) => it.id !== id));
  }
  function addItem(listSetter, item) {
    listSetter((list) => [{ id: uid(), ...item }, ...list]);
  }

  function openScanner(target, useCamera) {
    if (!qrReady) { showToast("Leitor de QR Code ainda carregando, tente de novo em instantes"); loadJsQR().then(setQrReady); return; }
    pendingScan.current = target;
    const input = fileInputRef.current;
    if (!input) return;
    if (useCamera) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    const target = pendingScan.current;
    e.target.value = "";
    if (!file || !target) return;

    setScanningFor(target);
    let text;
    try {
      text = await decodeQRFromImage(file);
    } catch {
      setScanningFor(null);
      showToast("Não foi possível ler essa imagem");
      return;
    }
    if (!text) {
      setScanningFor(null);
      showToast("Nenhum QR Code encontrado na imagem");
      return;
    }

    let url;
    try { url = new URL(text).href; } catch { url = null; }
    if (!url) {
      setScanningFor(null);
      showToast("Esse QR Code não parece ser de uma nota fiscal (NFC-e)");
      return;
    }
    const chave = (text.match(/\d{44}/) || [])[0] || null;

    try {
      const data = await tryFetchNfceData(url);
      setScanningFor(null);
      if (target === "receipt") {
        setExpenseDraft({ date: todayISO(), local: data.local || "Estabelecimento", value: data.total ? data.total.toFixed(2) : "" });
        setShowAddExpense(true);
      } else if (data.items.length) {
        setParsedModal({ target, items: data.items.map((i) => ({ ...i, selected: true })) });
      } else {
        setQrFallback({ url, chave, target });
      }
    } catch {
      // Comum: o portal da Sefaz bloqueia leitura automática pelo navegador (CORS).
      setScanningFor(null);
      setQrFallback({ url, chave, target });
    }
  }

  function confirmParsedItems() {
    const { target, items } = parsedModal;
    const toAdd = items.filter((i) => i.selected);
    const setter = target === "grocery" ? setGroceries : setPharmacy;
    setter((list) => [...toAdd.map((i) => ({ id: uid(), ...i })), ...list]);
    setParsedModal(null);
    showToast(`Nota processada — ${toAdd.length} ${toAdd.length === 1 ? "item adicionado" : "itens adicionados"}`);
  }

  function saveExpense(draft) {
    setExpenses((list) => [{ id: uid(), date: draft.date, local: draft.local, value: parseFloat(draft.value) || 0 }, ...list]);
    setShowAddExpense(false);
    setExpenseDraft(null);
    showToast("Gasto registrado");
  }

  /* ---------- alertas home ---------- */
  const allAlerts = [...groceries.map((i) => ({ ...i, origin: "Despensa" })), ...pharmacy.map((i) => ({ ...i, origin: "Farmácia" }))]
    .map((i) => ({ ...i, status: itemStatus(i) }))
    .filter((i) => i.status !== "ok")
    .sort((a, b) => {
      const order = { vencido: 0, falta: 1, vencendo: 2, baixo: 3 };
      return order[a.status] - order[b.status];
    });

  const currentMK = monthKey(todayISO());
  const monthExpenses = expenses.filter((e) => monthKey(e.date) === viewMonth);
  const monthTotal = monthExpenses.reduce((s, e) => s + e.value, 0);
  const knownMonths = Array.from(new Set([currentMK, ...expenses.map((e) => monthKey(e.date))])).sort();
  const mIdx = knownMonths.indexOf(viewMonth);

  const shareText = allAlerts.length
    ? "Lista para repor em casa:\n" + allAlerts.map((a) => `• ${a.name} (${STATUS_META[a.status].label.toLowerCase()})`).join("\n")
    : "Está tudo em dia em casa por enquanto! 🏡";

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
            <HomeScreen alerts={allAlerts} monthTotal={monthTotal} />
          )}
          {tab === "contatos" && (
            <ContatosScreen
              contacts={contacts}
              onAdd={() => setShowAddContact(true)}
              onRemove={(id) => setContacts((l) => l.filter((c) => c.id !== id))}
            />
          )}
          {tab === "mercadoria" && (
            <ItensScreen
              title="Despensa"
              items={groceries}
              hasCategory
              onInc={(id) => adjustQty(setGroceries, id, 1)}
              onDec={(id) => adjustQty(setGroceries, id, -1)}
              onRemove={(id) => removeItem(setGroceries, id)}
              onAdd={() => setShowAddItem("grocery")}
              onScanCamera={() => openScanner("grocery", true)}
              onScanUpload={() => openScanner("grocery", false)}
            />
          )}
          {tab === "farmacia" && (
            <ItensScreen
              title="Farmácia"
              items={pharmacy}
              hasCategory={false}
              onInc={(id) => adjustQty(setPharmacy, id, 1)}
              onDec={(id) => adjustQty(setPharmacy, id, -1)}
              onRemove={(id) => removeItem(setPharmacy, id)}
              onAdd={() => setShowAddItem("pharmacy")}
              onScanCamera={() => openScanner("pharmacy", true)}
              onScanUpload={() => openScanner("pharmacy", false)}
            />
          )}
          {tab === "gastos" && (
            <GastosScreen
              viewMonth={viewMonth}
              setViewMonth={setViewMonth}
              knownMonths={knownMonths}
              mIdx={mIdx}
              monthExpenses={monthExpenses}
              monthTotal={monthTotal}
              onAdd={() => { setExpenseDraft({ date: todayISO(), local: "", value: "" }); setShowAddExpense(true); }}
              onScanCamera={() => openScanner("receipt", true)}
              onScanUpload={() => openScanner("receipt", false)}
              onRemove={(id) => setExpenses((l) => l.filter((e) => e.id !== id))}
            />
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileSelected}
        />

        <a className="fab" href={waLink("", shareText)} target="_blank" rel="noreferrer" title="Compartilhar no WhatsApp">
          <MessageCircle size={24} />
        </a>

        <nav className="bottom-nav">
          <NavBtn icon={<Home size={19} />} label="Início" active={tab === "home"} onClick={() => setTab("home")} />
          <NavBtn icon={<Users size={19} />} label="Contatos" active={tab === "contatos"} onClick={() => setTab("contatos")} />
          <NavBtn icon={<ShoppingBasket size={19} />} label="Despensa" active={tab === "mercadoria"} onClick={() => setTab("mercadoria")} />
          <NavBtn icon={<Pill size={19} />} label="Farmácia" active={tab === "farmacia"} onClick={() => setTab("farmacia")} />
          <NavBtn icon={<Wallet size={19} />} label="Gastos" active={tab === "gastos"} onClick={() => setTab("gastos")} />
        </nav>
      </div>

      {showAddContact && (
        <ContactModal onClose={() => setShowAddContact(false)} onSave={(c) => { setContacts((l) => [{ id: uid(), ...c }, ...l]); setShowAddContact(false); }} />
      )}

      {showAddItem && (
        <ItemModal
          target={showAddItem}
          onClose={() => setShowAddItem(null)}
          onSave={(item) => {
            addItem(showAddItem === "grocery" ? setGroceries : setPharmacy, item);
            setShowAddItem(null);
            showToast("Item adicionado");
          }}
        />
      )}

      {showAddExpense && (
        <ExpenseModal
          draft={expenseDraft}
          onClose={() => { setShowAddExpense(false); setExpenseDraft(null); }}
          onSave={saveExpense}
        />
      )}

      {scanningFor && (
        <div className="modal-overlay">
          <div className="modal-sheet">
            <div className="scanning-overlay">
              <Loader2 className="spin" size={30} />
              <div style={{ fontWeight: 700 }}>Lendo o QR Code…</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", textAlign: "center" }}>
                Decodificando a imagem e consultando a nota fiscal.
              </div>
            </div>
          </div>
        </div>
      )}

      {qrFallback && (
        <ModalShell title="QR Code lido" onClose={() => setQrFallback(null)}>
          <div style={{ fontSize: 13.5, color: "var(--ink-soft)", marginBottom: 14 }}>
            O código foi lido corretamente{qrFallback.chave ? ` (chave ${qrFallback.chave.slice(0, 4)}…${qrFallback.chave.slice(-4)})` : ""},
            mas o site oficial da nota bloqueia a leitura automática pelo navegador. Abra a nota para conferir e complete o registro em seguida.
          </div>
          <a className="btn-primary" style={{ display: "block", textAlign: "center", textDecoration: "none", marginBottom: 8 }}
             href={qrFallback.url} target="_blank" rel="noreferrer">
            Abrir nota fiscal oficial
          </a>
          <button className="btn-ghost" onClick={() => {
            const target = qrFallback.target;
            setQrFallback(null);
            if (target === "receipt") { setExpenseDraft({ date: todayISO(), local: "", value: "" }); setShowAddExpense(true); }
            else setShowAddItem(target);
          }}>
            Preencher manualmente agora
          </button>
        </ModalShell>
      )}

      {parsedModal && (
        <ParsedItemsModal
          data={parsedModal}
          onToggle={(idx) => setParsedModal((pm) => ({ ...pm, items: pm.items.map((it, i) => i === idx ? { ...it, selected: !it.selected } : it) }))}
          onClose={() => setParsedModal(null)}
          onConfirm={confirmParsedItems}
        />
      )}
    </div>
  );
}

/* ------------------------------- pedaços --------------------------------- */

function NavBtn({ icon, label, active, onClick }) {
  return (
    <button className={`nav-btn ${active ? "active" : ""}`} onClick={onClick}>
      <span className="dot-pill">{icon}</span>
      {label}
    </button>
  );
}

function HomeScreen({ alerts, monthTotal }) {
  return (
    <>
      <div className="section-title"><span className="tab-dot" /> Avisos de hoje</div>
      {alerts.length === 0 && (
        <div className="card empty-state">
          <div className="display">Tudo em dia! 🏡</div>
          Nenhum item em falta, com estoque baixo ou vencendo.
        </div>
      )}
      {alerts.map((a) => {
        const meta = STATUS_META[a.status];
        return (
          <div key={a.id} className="card alert-card">
            <div className="alert-icon" style={{ background: meta.bg, color: meta.color }}>
              <AlertTriangle size={16} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="alert-title">{a.name}</div>
              <div className="alert-sub">{a.origin} · {a.validade ? `validade ${fmtDateBR(a.validade)}` : `quantidade ${a.qty}`}</div>
            </div>
            <span className="badge" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
          </div>
        );
      })}

      <div className="section-title" style={{ marginTop: 26 }}><span className="tab-dot" /> Resumo do mês</div>
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" }}>Gasto acumulado</div>
          <div className="display" style={{ fontSize: 24, marginTop: 2 }}>{fmtMoney(monthTotal)}</div>
        </div>
        <Wallet size={26} color="var(--primary)" />
      </div>
    </>
  );
}

function ContatosScreen({ contacts, onAdd, onRemove }) {
  return (
    <>
      <div className="section-title"><span className="tab-dot" /> Contatos de emergência</div>
      <div className="card" style={{ padding: "4px 14px" }}>
        {contacts.length === 0 && (
          <div className="empty-state">
            <div className="display">Nenhum contato ainda</div>
            Adicione familiares para falar com um toque.
          </div>
        )}
        {contacts.map((c) => (
          <div key={c.id} className="contact-row">
            <div className="avatar">{c.name.trim()[0]?.toUpperCase() || "?"}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="item-name">{c.name}</div>
              <div className="item-meta">{c.relation} · {c.phone}</div>
            </div>
            <a className="wa-btn" href={waLink(c.phone, `Oi ${c.name.split(" ")[0]}, tudo bem?`)} target="_blank" rel="noreferrer">
              <MessageCircle size={18} />
            </a>
            <button className="icon-btn" onClick={() => onRemove(c.id)}><Trash2 size={17} /></button>
          </div>
        ))}
      </div>
      <button className="fab-add" onClick={onAdd}><Plus size={18} /> Adicionar contato</button>
    </>
  );
}

function ItensScreen({ title, items, hasCategory, onInc, onDec, onRemove, onAdd, onScanCamera, onScanUpload }) {
  return (
    <>
      <div className="scan-row">
        <button className="scan-btn" onClick={onScanCamera}><Camera size={20} /> Escanear QR Code da nota</button>
        <button className="scan-btn" onClick={onScanUpload}><UploadCloud size={20} /> Enviar foto da nota</button>
      </div>

      <div className="section-title"><span className="tab-dot" /> Itens cadastrados ({items.length})</div>
      {items.length === 0 && (
        <div className="card empty-state">
          <div className="display">Nada por aqui ainda</div>
          Use o + ou escaneie uma nota para começar.
        </div>
      )}
      {items.map((it) => {
        const status = itemStatus(it);
        const meta = STATUS_META[status];
        return (
          <div key={it.id} className="card">
            <div className="item-row">
              <div className="item-info">
                <div className="item-name">{it.name}</div>
                <div className="item-meta">
                  {hasCategory && <span>{it.category}</span>}
                  {it.validade && <span><CalendarDays size={11} style={{ verticalAlign: -1 }} /> {fmtDateBR(it.validade)}</span>}
                </div>
              </div>
              <button className="icon-btn" onClick={() => onRemove(it.id)}><Trash2 size={16} /></button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              <span className="badge" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
              <div className="stepper">
                <button onClick={() => onDec(it.id)}><Minus size={14} /></button>
                <span className="qty">{it.qty} {it.unit}</span>
                <button onClick={() => onInc(it.id)}><Plus size={14} /></button>
              </div>
            </div>
          </div>
        );
      })}
      <button className="fab-add" onClick={onAdd}><Plus size={18} /> Adicionar item</button>
    </>
  );
}

function GastosScreen({ viewMonth, setViewMonth, knownMonths, mIdx, monthExpenses, monthTotal, onAdd, onScanCamera, onScanUpload, onRemove }) {
  return (
    <>
      <div className="month-switch">
        <button disabled={mIdx <= 0} onClick={() => setViewMonth(knownMonths[mIdx - 1])}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700, fontSize: 14, textTransform: "capitalize" }}>{monthLabel(viewMonth)}</div>
        <button disabled={mIdx >= knownMonths.length - 1} onClick={() => setViewMonth(knownMonths[mIdx + 1])}><ChevronRight size={16} /></button>
      </div>

      <div className="total-card">
        <div style={{ fontSize: 12.5, opacity: 0.85, fontWeight: 700, textTransform: "uppercase" }}>Total do mês</div>
        <div className="amount">{fmtMoney(monthTotal)}</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{monthExpenses.length} nota(s) registrada(s)</div>
      </div>

      <div className="scan-row">
        <button className="scan-btn" onClick={onScanCamera}><Camera size={20} /> Escanear nota</button>
        <button className="scan-btn" onClick={onScanUpload}><UploadCloud size={20} /> Enviar nota</button>
      </div>

      <div className="section-title"><span className="tab-dot" /> Notas do mês</div>
      {monthExpenses.length === 0 && (
        <div className="card empty-state">
          <div className="display">Nenhum gasto neste mês</div>
          Adicione manualmente ou escaneie uma nota fiscal.
        </div>
      )}
      {monthExpenses.map((e) => (
        <div key={e.id} className="card receipt-row">
          <div>
            <div className="receipt-local">{e.local}</div>
            <div className="receipt-date">{fmtDateBR(e.date)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="receipt-value">{fmtMoney(e.value)}</div>
            <button className="icon-btn" onClick={() => onRemove(e.id)}><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <button className="fab-add" onClick={onAdd}><Plus size={18} /> Adicionar gasto</button>
    </>
  );
}

/* -------------------------------- modais ---------------------------------- */

function ModalShell({ title, onClose, children }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="display">{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ContactModal({ onClose, onSave }) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("Filho(a)");
  const [phone, setPhone] = useState("");
  return (
    <ModalShell title="Novo contato" onClose={onClose}>
      <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Ana Paula" /></div>
      <div className="field-row">
        <div className="field">
          <label>Relação</label>
          <select value={relation} onChange={(e) => setRelation(e.target.value)}>
            {["Filho(a)", "Esposo(a)", "Mãe", "Pai", "Neto(a)", "Vizinho(a)", "Outro"].map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div className="field"><label>WhatsApp</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(51) 99999-0000" /></div>
      </div>
      <button className="btn-primary" disabled={!name || !phone} onClick={() => onSave({ name, relation, phone })}>Salvar contato</button>
    </ModalShell>
  );
}

function ItemModal({ target, onClose, onSave }) {
  const isGrocery = target === "grocery";
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Alimentos");
  const [qty, setQty] = useState(1);
  const [unit, setUnit] = useState("un");
  const [validade, setValidade] = useState("");
  return (
    <ModalShell title={isGrocery ? "Novo item da despensa" : "Novo medicamento"} onClose={onClose}>
      <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder={isGrocery ? "Ex: Arroz branco 5kg" : "Ex: Dipirona 500mg"} /></div>
      <div className="field-row">
        {isGrocery && (
          <div className="field">
            <label>Categoria</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>Alimentos</option><option>Limpeza</option><option>Outros</option>
            </select>
          </div>
        )}
        <div className="field"><label>Unidade</label><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="un / pct / cx" /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Quantidade</label><input type="number" min="0" value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
        <div className="field"><label>Validade</label><input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} /></div>
      </div>
      <button className="btn-primary" disabled={!name} onClick={() => onSave({ name, category, unit, qty, validade })}>
        {isGrocery ? "Adicionar à despensa" : "Adicionar à farmácia"}
      </button>
    </ModalShell>
  );
}

function ExpenseModal({ draft, onClose, onSave }) {
  const [date, setDate] = useState(draft?.date || todayISO());
  const [local, setLocal] = useState(draft?.local || "");
  const [value, setValue] = useState(draft?.value || "");
  return (
    <ModalShell title="Registrar gasto" onClose={onClose}>
      <div className="field"><label>Estabelecimento</label><input value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Ex: Supermercado Extra" /></div>
      <div className="field-row">
        <div className="field"><label>Data</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label>Valor (R$)</label><input type="number" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" /></div>
      </div>
      <button className="btn-primary" disabled={!local || !value} onClick={() => onSave({ date, local, value })}>Salvar gasto</button>
    </ModalShell>
  );
}

function ParsedItemsModal({ data, onToggle, onClose, onConfirm }) {
  const { target, items } = data;
  return (
    <ModalShell title={target === "grocery" ? "Itens encontrados na nota" : "Medicamentos encontrados"} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 12 }}>
        Confira os itens identificados antes de adicionar à {target === "grocery" ? "despensa" : "farmácia"}.
      </div>
      {items.map((it, idx) => (
        <div key={idx} className="parsed-item">
          <div className={`check ${it.selected ? "on" : ""}`} onClick={() => onToggle(idx)}>
            {it.selected && <Check size={13} />}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{it.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
              {it.qty} {it.unit} · validade {fmtDateBR(it.validade)}
            </div>
          </div>
        </div>
      ))}
      <button className="btn-primary" onClick={onConfirm}>Adicionar itens selecionados</button>
      <button className="btn-ghost" onClick={onClose}>Cancelar</button>
    </ModalShell>
  );
}
