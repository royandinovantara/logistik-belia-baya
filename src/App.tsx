import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  LayoutDashboard, Boxes, ArrowDownToLine, ArrowUpFromLine, Archive,
  BarChart3, Camera, Menu, Package, Truck, LogOut, LockKeyhole,
  Plus, Search, Pencil, Trash2, X, Upload, RefreshCw, Image as ImageIcon,
  Download, ChevronDown, Bell, CheckCircle2, Eye, LoaderCircle
} from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { db, ready } from './lib';

type Item = { id: string; code: string; name: string; category: 'MATERIAL' | 'ALAT'; unit: string | null; is_active: boolean };
type Profile = { full_name: string; role: 'ADMIN' | 'ATASAN' };
type Stock = Omit<Item, 'id'> & { item_id: string; stock: number; incoming_total: number; outgoing_total: number; stock_percentage_base?: number };
type Line = { item_id: string; quantity: string; unit: string; cost_code: string };
type Photo = { id: string; storage_path: string; description: string | null; created_at: string; incoming_transactions?: { id?: string; transaction_no: string; transaction_date: string; created_at?: string; supplier: string | null; driver_name?: string | null; notes?: string | null } | { id?: string; transaction_no: string; transaction_date: string; created_at?: string; supplier: string | null; driver_name?: string | null; notes?: string | null }[] | null };
type Transaction = { id: string; transaction_no: string; transaction_date: string; supplier?: string | null; destination?: string | null; receiver_name?: string | null; vehicle_no?: string | null; driver_name?: string | null; notes?: string | null; created_at: string };
type TransactionLine = { transaction_id: string; item_id: string; quantity: number; unit: string; items?: { code: string; name: string } | { code: string; name: string }[] | null };
type Movement = { id: string; item_id: string; movement_type: 'IN' | 'OUT' | 'OPENING' | 'REVERSAL'; quantity: number; transaction_date: string; notes: string | null };
type MaterialPlan = { id: string; item_id: string; planned_quantity: number; unit: string; created_at: string };
type MaterialOrderLine = { id: string; order_id: string; item_id: string; planned_quantity: number; unit: string; note: string | null };
type MaterialOrder = { id: string; om_no: string; project: 'BAYA' | 'BELIA'; order_date: string; created_at: string; material_order_lines: MaterialOrderLine[] };

const menus = [
  ['Dashboard', LayoutDashboard], ['Rencana Barang', Package], ['Kode Material & Alat', Boxes],
  ['Barang Masuk', ArrowDownToLine], ['Barang Keluar', ArrowUpFromLine],
  ['Stok Gudang', Archive], ['Monitoring', BarChart3], ['Dokumentasi', Camera]
] as const;
const today = () => new Date().toLocaleDateString('en-CA');
const emptyLine = (): Line => ({ item_id: '', quantity: '', unit: '', cost_code: '' });
const formatNumber = (value: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(value);
const stockPercent = (stock: number, percentageBase: number) => {
  if (!Number.isFinite(stock) || stock <= 0) return 0;
  if (!Number.isFinite(percentageBase) || percentageBase <= 0) return 100;
  return Math.max(0, Math.min(100, (stock / percentageBase) * 100));
};
const formatPercent = (value: number) => `${value.toFixed(1)}%`;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [page, setPage] = useState('Dashboard');
  const [mobile, setMobile] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [incoming, setIncoming] = useState<Transaction[]>([]);
  const [outgoing, setOutgoing] = useState<Transaction[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [incomingLines, setIncomingLines] = useState<TransactionLine[]>([]);
  const [outgoingLines, setOutgoingLines] = useState<TransactionLine[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [materialPlans, setMaterialPlans] = useState<MaterialPlan[]>([]);
  const [materialOrders, setMaterialOrders] = useState<MaterialOrder[]>([]);
  const [orderHeader, setOrderHeader] = useState({ om_no: '', project: 'BELIA' as 'BAYA'|'BELIA', order_date: today() });
  const [orderLines, setOrderLines] = useState([{ item_id: '', quantity: '', note: '' }]);
  const [orderSaving, setOrderSaving] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [planItemId, setPlanItemId] = useState('');
  const [planQuantity, setPlanQuantity] = useState('');
  const [planUnit, setPlanUnit] = useState('');
  const [planSaving, setPlanSaving] = useState(false);
  const [selectedStock, setSelectedStock] = useState<string | null>(null);
  const [movementView, setMovementView] = useState<'current' | 'all'>('current');
  const [showNotedDetails, setShowNotedDetails] = useState(false);
  const [monitorMonth, setMonitorMonth] = useState(today().slice(0, 7));
  const [documentationMonth, setDocumentationMonth] = useState(today().slice(0, 7));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [modal, setModal] = useState<'item' | 'incoming' | 'outgoing' | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [itemForm, setItemForm] = useState({ code: '', name: '', category: 'MATERIAL' as 'MATERIAL' | 'ALAT', unit: '' });
  const [transactionForm, setTransactionForm] = useState({ date: today(), supplier: '', vehicle_no: '', driver_name: '', destination: '', receiver_name: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docEditNotes, setDocEditNotes] = useState('');
  const [docEditDate, setDocEditDate] = useState(today());
  const [selectedMonitor, setSelectedMonitor] = useState<{kind:'incoming'|'outgoing';id:string}|null>(null);
  const [editingTransaction, setEditingTransaction] = useState<{kind:'incoming'|'outgoing';id:string}|null>(null);
  const [docEditDriver, setDocEditDriver] = useState('');
  const [docAddFiles, setDocAddFiles] = useState<File[]>([]);
  const [alertState, setAlertState] = useState<Record<string, 'noted' | 'ignored' | 'dismissed'>>(() => { try { return JSON.parse(localStorage.getItem('lb-stock-alerts') || '{}'); } catch { return {}; } });
  const [navigationLoading, setNavigationLoading] = useState(false);

  const isAdmin = profile?.role === 'ADMIN';
  const notify = (type: 'success' | 'error', text: string) => { setNotice({ type, text }); window.setTimeout(() => setNotice(null), 5000); };

  useEffect(() => {
    if (!db) { setLoading(false); return; }
    let active = true;
    const loadProfile = async (current: Session | null) => {
      if (!current) { if (active) { setSession(null); setProfile(null); setLoading(false); } return; }
      const { data, error } = await db!.from('profiles').select('full_name, role').eq('id', current.user.id).single();
      if (!active) return;
      if (error || !data || !['ADMIN', 'ATASAN'].includes(data.role)) {
        setSession(null); setProfile(null); setLoginError('Profil pengguna tidak ditemukan atau hak akses belum sesuai. Hubungi Admin.');
        await db!.auth.signOut({ scope: 'local' });
      } else { setSession(current); setProfile(data as Profile); }
      setLoading(false);
    };
    db.auth.getSession().then(({ data }) => loadProfile(data.session)).catch(() => { if (active) { setLoading(false); setLoginError('Tidak dapat terhubung ke Supabase. Periksa koneksi internet dan konfigurasi project.'); } });
    const { data: listener } = db.auth.onAuthStateChange((_event, current) => {
      if (!current) { setSession(null); setProfile(null); setLoading(false); }
      else { setLoading(true); setTimeout(() => loadProfile(current), 0); }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const loadData = useCallback(async () => {
    if (!db || !session) return;
    setBusy(true);
    const [itemRes, stockRes, inRes, outRes, photoRes, inLineRes, outLineRes] = await Promise.all([
      db.from('items').select('*').order('code'),
      db.from('stock_balances').select('*').order('code'),
      db.from('incoming_transactions').select('id, transaction_no, transaction_date, supplier, vehicle_no, driver_name, notes, created_at').order('created_at', { ascending: false }).limit(1000),
      db.from('outgoing_transactions').select('id, transaction_no, transaction_date, destination, receiver_name, driver_name, notes, created_at').order('created_at', { ascending: false }).limit(1000),
      db.from('transaction_photos').select('id, storage_path, description, created_at, incoming_transactions!inner(id, transaction_no, transaction_date, created_at, supplier, driver_name, notes)').gte('incoming_transactions.transaction_date', `${documentationMonth}-01`).lte('incoming_transactions.transaction_date', `${documentationMonth}-${String(new Date(Number(documentationMonth.slice(0,4)), Number(documentationMonth.slice(5,7)), 0).getDate()).padStart(2,'0')}`).order('created_at', { ascending: false }),
      db.from('incoming_items').select('transaction_id, item_id, quantity, unit, items(code, name)'),
      db.from('outgoing_items').select('transaction_id, item_id, quantity, unit, items(code, name)')
    ]);
    const [planRes, orderRes, dismissedRes] = await Promise.all([
      db.from('material_plans').select('id, item_id, planned_quantity, unit, created_at').order('created_at', { ascending: false }),
      db.from('material_orders').select('id, om_no, project, order_date, created_at, material_order_lines(id, order_id, item_id, planned_quantity, unit, note)').order('order_date', { ascending: false }).order('created_at', { ascending: false }),
      db.from('stock_alert_dismissals').select('item_id')
    ]);
    if (!orderRes.error) setMaterialOrders((orderRes.data || []) as MaterialOrder[]);
    else notify('error', `Gagal memuat Order Material: ${orderRes.error.message}`);
    if (!dismissedRes.error) setDismissedAlerts((dismissedRes.data || []).map((row: {item_id:string}) => row.item_id));
    if (planRes.error) notify('error', `Gagal memuat Rencana Barang: ${planRes.error.message}`);
    else setMaterialPlans((planRes.data || []) as MaterialPlan[]);
    if (itemRes.error) notify('error', `Gagal memuat master barang: ${itemRes.error.message}`);
    else setItems((itemRes.data || []) as Item[]);
    if (stockRes.error) notify('error', `Gagal memuat stok: ${stockRes.error.message}`);
    else setStocks((stockRes.data || []) as Stock[]);
    if (!inRes.error) setIncoming((inRes.data || []) as Transaction[]);
    if (!outRes.error) setOutgoing((outRes.data || []) as Transaction[]);
    if (!photoRes.error) setPhotos((photoRes.data || []) as Photo[]);
    if (!inLineRes.error) setIncomingLines((inLineRes.data || []) as TransactionLine[]);
    if (!outLineRes.error) setOutgoingLines((outLineRes.data || []) as TransactionLine[]);
    if (inLineRes.error) notify('error', `Gagal memuat rincian barang masuk: ${inLineRes.error.message}`);
    if (outLineRes.error) notify('error', `Gagal memuat rincian barang keluar: ${outLineRes.error.message}`);

    // Muat seluruh halaman agar mode Total keseluruhan tidak berhenti di 5.000 gerakan.
    const allMovements: Movement[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from('inventory_movements')
        .select('id, item_id, movement_type, quantity, transaction_date, notes')
        .order('transaction_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        notify('error', `Gagal memuat seluruh riwayat pergerakan stok: ${error.message}`);
        break;
      }
      const page = (data || []) as Movement[];
      allMovements.push(...page);
      if (page.length < pageSize) break;
    }
    setMovements(allMovements);
    setBusy(false);
  }, [session, documentationMonth]);

  useEffect(() => { if (session && profile) void loadData(); }, [session, profile, loadData]);
  useEffect(() => {
    if (!db || !session) return;
    try {
      const old = JSON.parse(localStorage.getItem('lb-stock-alerts') || '{}') as Record<string,string>;
      const ids = Object.entries(old).filter(([,value]) => value === 'ignored').map(([id]) => id);
      if (ids.length) void db.from('stock_alert_dismissals').upsert(ids.map(item_id => ({ item_id, dismissed_by: session.user.id })), { onConflict: 'item_id', ignoreDuplicates: true })
        .then(({ error }) => { if (!error) { const clean = { ...old }; ids.forEach(id => delete clean[id]); localStorage.setItem('lb-stock-alerts', JSON.stringify(clean)); setAlertState(clean as typeof alertState); } });
    } catch { /* data local lama tidak valid */ }
  }, [session]);


  const addMaterialPlan = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!db || !planItemId || !Number.isFinite(Number(planQuantity)) || Number(planQuantity) <= 0) {
      notify('error', 'Pilih material dan masukkan jumlah rencana lebih dari 0.'); return;
    }
    if (materialPlans.some(plan => plan.item_id === planItemId)) {
      notify('error', 'Material ini sudah memiliki satu rencana aktif.'); return;
    }
    const item = items.find(entry => entry.id === planItemId);
    if (!item) return;
    setPlanSaving(true);
    const { data, error } = await db.from('material_plans').insert({
      item_id: planItemId, planned_quantity: Number(planQuantity), unit: planUnit.trim() || item.unit || 'unit'
    }).select('id, item_id, planned_quantity, unit, created_at').single();
    if (error) notify('error', `Gagal menyimpan rencana: ${error.message}`);
    else {
      setMaterialPlans(current => [data as MaterialPlan, ...current]);
      setPlanItemId(''); setPlanQuantity(''); setPlanUnit('');
      notify('success', 'Rencana material berhasil ditambahkan.');
    }
    setPlanSaving(false);
  };
  const deleteMaterialPlan = async (plan: MaterialPlan) => {
    if (!db) return;
    const { error } = await db.from('material_plans').delete().eq('id', plan.id);
    if (error) notify('error', `Gagal menghapus rencana: ${error.message}`);
    else {
      setMaterialPlans(current => current.filter(entry => entry.id !== plan.id));
      notify('success', 'Material dihapus dari Rencana Barang.');
    }
  };
  const planProgress = (plan: MaterialPlan) => {
    const received = incomingLines.filter(line => line.item_id === plan.item_id)
      .reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const percent = plan.planned_quantity > 0 ? received / plan.planned_quantity * 100 : 0;
    return { received, remaining: Math.max(0, plan.planned_quantity - received), percent };
  };


  const saveMaterialOrder = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!db) return;
    if (!orderHeader.om_no.trim() || !orderHeader.order_date || !orderLines.length ||
        orderLines.some(line => !line.item_id || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) {
      notify('error', 'Lengkapi No. OM, tanggal, dan seluruh baris barang dengan jumlah lebih dari 0.'); return;
    }
    if (materialOrders.some(order => order.project === orderHeader.project && order.om_no.trim().toLowerCase() === orderHeader.om_no.trim().toLowerCase())) {
      notify('error', 'No. OM sudah digunakan pada proyek ini.'); return;
    }
    setOrderSaving(true);
    const { error } = await db.rpc('save_material_order', {
      p_header: orderHeader,
      p_lines: orderLines.map(line => ({ item_id: line.item_id, planned_quantity: Number(line.quantity), note: line.note }))
    });
    setOrderSaving(false);
    if (error) notify('error', `Gagal menyimpan OM: ${error.message}`);
    else {
      setOrderHeader({ om_no: '', project: 'BELIA', order_date: today() });
      setOrderLines([{ item_id: '', quantity: '', note: '' }]);
      notify('success', 'Order Material berhasil disimpan.');
      await loadData();
    }
  };
  const deleteMaterialOrder = async (order: MaterialOrder) => {
    if (!db || !isAdmin || !confirm(`Hapus permanen OM ${order.om_no} beserta seluruh baris barangnya?`)) return;
    setBusy(true);
    const { error } = await db.rpc('delete_material_order', { p_id: order.id });
    setBusy(false);
    if (error) notify('error', `Gagal menghapus OM: ${error.message}`);
    else { notify('success', `OM ${order.om_no} dihapus permanen.`); await loadData(); }
  };
  const allocatedOrders = useMemo(() => {
    const receipts = incoming.flatMap(tx => incomingLines.filter(line => line.transaction_id === tx.id)
      .map((line,index) => ({ id: `${tx.id}:${line.item_id}:${index}`, item_id: line.item_id, date: tx.transaction_date, quantity: Number(line.quantity) })))
      .sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const available = new Map(receipts.map(receipt => [receipt.id, receipt.quantity]));
    const orders = [...materialOrders].sort((a,b) => a.order_date.localeCompare(b.order_date) || a.created_at.localeCompare(b.created_at));
    const result = new Map<string, Map<string, number>>();
    for (const order of orders) {
      const byLine = new Map<string, number>();
      for (const line of order.material_order_lines || []) {
        let needed = Number(line.planned_quantity);
        let received = 0;
        for (const receipt of receipts) {
          if (receipt.item_id !== line.item_id || receipt.date < order.order_date || needed <= 0) continue;
          const left = available.get(receipt.id) || 0;
          const take = Math.min(left, needed);
          if (take > 0) { available.set(receipt.id, left - take); needed -= take; received += take; }
        }
        byLine.set(line.id, received);
      }
      result.set(order.id, byLine);
    }
    return result;
  }, [materialOrders, incoming, incomingLines]);
  const orderText = (project: 'BELIA'|'BAYA') => {
    const orders = materialOrders.filter(order => order.project === project)
      .sort((a,b) => b.order_date.localeCompare(a.order_date) || b.created_at.localeCompare(a.created_at));
    const dateFmt = (date: string) => { const [y,m,d] = date.split('-'); return `${d}/${m}/${y}`; };
    const blocks = orders.map(order => {
      const linesText = (order.material_order_lines || []).map(line => {
        const item = items.find(entry => entry.id === line.item_id);
        const received = allocatedOrders.get(order.id)?.get(line.id) || 0;
        const qty = Number(line.planned_quantity);
        const emoji = received >= qty ? '✅' : received > 0 ? '🔄' : '❌';
        const shortage = received > 0 && received < qty ? ` (kurang ${formatNumber(qty-received)} ${line.unit})` : '';
        return `- ${item?.name || 'Barang'} = ${formatNumber(qty)} ${line.unit} ${emoji}${shortage}${line.note ? ` (${line.note})` : ''}`;
      });
      return [`OM: ${order.om_no}   ${dateFmt(order.order_date)}`, ...linesText].join('\n');
    });
    return [`update material&alat proyek ${project.toLowerCase()}`, ...blocks].join('\n\n');
  };
  const copyOrderText = async (project: 'BELIA'|'BAYA') => {
    const value = orderText(project);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement('textarea'); area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
    }
    notify('success', 'Tersalin');
  };

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!db) return;
    setLoginLoading(true); setLoginError('');
    try { const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setLoginError(`Login gagal: ${error.message}`);
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'Koneksi login gagal.'); }
    finally { setLoginLoading(false); }
  };
  const handleLogout = async () => { if (!db) return; await db.auth.signOut({ scope: 'local' }); setPage('Dashboard'); };
  const shownItems = useMemo(() => items.filter(i => `${i.code} ${i.name} ${i.category}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  const activeItems = items.filter(i => i.is_active && (i.category === 'MATERIAL' || i.category === 'ALAT')).sort((a, b) => {
    const categoryOrder = (category: Item['category']) => category === 'MATERIAL' ? 0 : 1;
    return categoryOrder(a.category) - categoryOrder(b.category) || a.code.localeCompare(b.code, 'id', { numeric: true });
  });
  const totalStockKinds = stocks.filter(s => Number(s.stock) > 0).length;
  const totalIncomingQty = incoming.length;
  const totalOutgoingQty = outgoing.length;
  const monthPeriods = useMemo(() => {
    const [year, month] = monitorMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return Array.from({ length: 5 }, (_, index) => {
      const startDay = index * 7 + 1;
      const endDay = Math.min((index + 1) * 7, lastDay);
      const pad = (n: number) => String(n).padStart(2, '0');
      return { number: index + 1, start: `${monitorMonth}-${pad(startDay)}`, end: `${monitorMonth}-${pad(endDay)}`, label: `${pad(startDay)}–${pad(endDay)} ${new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}` };
    });
  }, [monitorMonth]);
  const documentationPhotos = photos.filter(photo => { const tx = Array.isArray(photo.incoming_transactions) ? photo.incoming_transactions[0] : photo.incoming_transactions; const date = tx?.transaction_date || photo.created_at.slice(0, 10); return date.startsWith(documentationMonth); });
  const documentationGroups = useMemo(() => { const map = new Map<string, { transactionId: string; transactionNo: string; date: string; driver: string; notes: string; photos: Photo[] }>(); documentationPhotos.forEach(photo => { const tx = Array.isArray(photo.incoming_transactions) ? photo.incoming_transactions[0] : photo.incoming_transactions; const id = tx?.id || photo.id; if (!map.has(id)) map.set(id, { transactionId: id, transactionNo: tx?.transaction_no || 'Barang Masuk', date: tx?.transaction_date || photo.created_at.slice(0,10), driver: tx?.driver_name || '', notes: tx?.notes || '', photos: [] }); map.get(id)!.photos.push(photo); }); return [...map.values()].sort((a,b) => b.date.localeCompare(a.date)); }, [documentationPhotos]);
  const stocksWithPercent = useMemo(() => stocks.map(stock => ({ ...stock, percent: stockPercent(Number(stock.stock), Number(stock.stock_percentage_base ?? stock.incoming_total ?? 0)) })), [stocks]);
  useEffect(() => {
    const recovered = stocksWithPercent.filter(stock => stock.percent > 30 && (alertState[stock.item_id] === 'noted' || alertState[stock.item_id] === 'dismissed'));
    if (!recovered.length) return;
    const next = { ...alertState };
    recovered.forEach(stock => { delete next[stock.item_id]; });
    setAlertState(next);
    localStorage.setItem('lb-stock-alerts', JSON.stringify(next));
  }, [stocksWithPercent, alertState]);
  const stockWarnings = stocksWithPercent.filter(stock => (Number(stock.incoming_total) > 0 || Number(stock.outgoing_total) > 0) && stock.percent <= 30 && !dismissedAlerts.includes(stock.item_id) && alertState[stock.item_id] !== 'noted' && alertState[stock.item_id] !== 'dismissed');
  const selectedStockData = stocksWithPercent.find(stock => stock.item_id === selectedStock);
  const selectedStockMovements = selectedStock ? movements.filter(movement => movement.item_id === selectedStock) : [];

  const openItemModal = (item?: Item) => {
    setEditingItem(item || null);
    setItemForm(item ? { code: item.code, name: item.name, category: item.category, unit: item.unit || '' } : { code: '', name: '', category: 'MATERIAL', unit: '' });
    setModal('item');
  };
  const saveItem = async (e: FormEvent) => {
    e.preventDefault(); if (!db) return;
    const code = itemForm.code.trim();
    const name = itemForm.name.trim();
    if (!code || !name) { notify('error', 'Kode dan nama barang wajib diisi.'); return; }
    // Pemeriksaan awal agar admin langsung mendapat pesan yang mudah dipahami.
    const duplicate = items.find(item => item.id !== editingItem?.id && (
      item.code.trim().toLocaleLowerCase('id-ID') === code.toLocaleLowerCase('id-ID') ||
      item.name.trim().toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID')
    ));
    if (duplicate) {
      const sameCode = duplicate.code.trim().toLocaleLowerCase('id-ID') === code.toLocaleLowerCase('id-ID');
      const sameName = duplicate.name.trim().toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID');
      notify('error', `Barang sudah terdaftar: ${sameCode && sameName ? 'kode dan nama barang' : sameCode ? 'kode barang' : 'nama barang'} sudah digunakan oleh ${duplicate.code} — ${duplicate.name}.`);
      return;
    }
    setBusy(true);
    const normalizedUnit = itemForm.unit.trim().toUpperCase();
    const payload = { code, name, category: itemForm.category, unit: normalizedUnit, is_active: normalizedUnit.length > 0 };
    const result = editingItem ? await db.from('items').update(payload).eq('id', editingItem.id) : await db.from('items').insert(payload);
    setBusy(false);
    if (result.error) {
      const message = /duplicate|unique/i.test(result.error.message)
        ? 'Kode atau nama barang sudah terdaftar. Periksa kembali data Master Material & Alat.'
        : result.error.message;
      notify('error', `Gagal menyimpan barang: ${message}`); return;
    }
    setModal(null); notify('success', 'Master barang berhasil disimpan.'); await loadData();
  };
  const startTransaction = (kind: 'incoming' | 'outgoing') => {
    setEditingTransaction(null);
    setTransactionForm({ date: today(), supplier: '', vehicle_no: '', driver_name: '', destination: '', receiver_name: '', notes: '' });
    setLines([emptyLine()]); setPhotoFiles([]); setModal(kind);
  };
  const startEditTransaction = (kind: 'incoming'|'outgoing', tx: Transaction) => {
    const sourceLines = (kind === 'incoming' ? incomingLines : outgoingLines).filter(line => line.transaction_id === tx.id);
    setEditingTransaction({kind,id:tx.id});
    setTransactionForm({date:tx.transaction_date,supplier:tx.supplier||'',vehicle_no:tx.vehicle_no||'',driver_name:tx.driver_name||'',destination:tx.destination||'',receiver_name:tx.receiver_name||'',notes:tx.notes||''});
    setLines(sourceLines.map(line=>({item_id:line.item_id,quantity:String(line.quantity),unit:line.unit,cost_code:''})));
    setPhotoFiles([]);
    setModal(kind);
  };
  const updateLine = (index: number, key: keyof Line, value: string) => setLines(old => old.map((line, i) => {
    if (i !== index) return line;
    if (key === 'item_id') { const selected = items.find(item => item.id === value); return { ...line, item_id: value, unit: selected?.unit || '' }; }
    return { ...line, [key]: value };
  }));
  const saveTransaction = async (e: FormEvent, kind: 'incoming' | 'outgoing') => {
    e.preventDefault(); if (!db || !session) return;
    const problems: string[] = [];
    if (!transactionForm.date || !/^\d{4}-\d{2}-\d{2}$/.test(transactionForm.date)) problems.push('Tanggal transaksi belum diisi atau tidak valid.');
    if (!lines.length) problems.push('Tambahkan minimal satu barang.');
    lines.forEach((line, index) => {
      if (!line.item_id) problems.push(`Baris ${index + 1}: barang belum dipilih.`);
      else if (!activeItems.some(item => item.id === line.item_id)) problems.push(`Baris ${index + 1}: barang tidak aktif atau tidak tersedia.`);
      if (!line.quantity.trim() || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) problems.push(`Baris ${index + 1}: jumlah harus lebih dari 0.`);
    });
    if (problems.length) { notify('error', `Transaksi belum dapat disimpan:\n${problems.join('\n')}`); return; }
    const validLines = lines;
    if (kind === 'incoming' && photoFiles.some(f => !['image/jpeg', 'image/png', 'image/webp'].includes(f.type))) { notify('error', 'Foto harus berformat JPG, PNG, atau WEBP.'); return; }
    if (photoFiles.some(f => f.size > 10 * 1024 * 1024)) { notify('error', 'Ukuran setiap foto maksimal 10 MB.'); return; }
    setBusy(true);
    const transactionNo = `${kind === 'incoming' ? 'BM' : 'BK'}-${transactionForm.date.replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const header = kind === 'incoming'
      ? { transaction_no: transactionNo, transaction_date: transactionForm.date, supplier: transactionForm.supplier || null, vehicle_no: transactionForm.vehicle_no || null, driver_name: transactionForm.driver_name || null, notes: transactionForm.notes || null }
      : { transaction_no: transactionNo, transaction_date: transactionForm.date, destination: transactionForm.destination || null, receiver_name: transactionForm.receiver_name || null, driver_name: transactionForm.driver_name || null, notes: transactionForm.notes || null };
    const payloadLines = validLines.map(l => ({ item_id: l.item_id, quantity: Number(l.quantity), unit: l.unit, cost_code: l.cost_code || null }));
    if (editingTransaction && editingTransaction.kind === kind) {
      setBusy(true);
      const header = kind === 'incoming'
        ? {transaction_date:transactionForm.date,supplier:transactionForm.supplier,vehicle_no:transactionForm.vehicle_no,driver_name:transactionForm.driver_name,notes:transactionForm.notes}
        : {transaction_date:transactionForm.date,destination:transactionForm.destination,receiver_name:transactionForm.receiver_name,driver_name:transactionForm.driver_name,notes:transactionForm.notes};
      const {error:updateError}=await db.rpc(kind==='incoming'?'update_incoming_transaction':'update_outgoing_transaction',{p_id:editingTransaction.id,p_header:header,p_lines:payloadLines});
      if (!updateError && kind==='incoming' && photoFiles.length) {
        const paths:string[]=[];
        for (const file of photoFiles) {
          const path=`${editingTransaction.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
          const upload=await db.storage.from('incoming-evidence').upload(path,file,{contentType:file.type,upsert:false});
          if (!upload.error) paths.push(path);
        }
        if(paths.length) await db.from('transaction_photos').insert(paths.map(storage_path=>({incoming_transaction_id:editingTransaction.id,storage_path,uploaded_by:session.user.id})));
      }
      setBusy(false);
      if(updateError) notify('error',`Gagal memperbarui transaksi: ${updateError.message}`);
      else {setModal(null);setEditingTransaction(null);notify('success','Transaksi berhasil diperbarui.');await loadData();}
      return;
    }
    const rpc = kind === 'incoming' ? 'post_incoming_transaction' : 'post_outgoing_transaction';
    const { data: transactionId, error } = await db.rpc(rpc, { p_header: header, p_lines: payloadLines });
    if (error) { setBusy(false); const detail = [error.message, error.details, error.hint, error.code ? `Kode: ${error.code}` : ''].filter(Boolean).join(' | '); notify('error', `Transaksi gagal disimpan: ${detail}`); return; }
    let photoWarning = '';
    if (kind === 'incoming' && photoFiles.length) {
      const paths: string[] = [];
      for (const [fileIndex, file] of photoFiles.entries()) {
        setUploadStatus(`Mengunggah foto ${fileIndex + 1}/${photoFiles.length} (${Math.round(((fileIndex + 1) / photoFiles.length) * 100)}%)`);
        const path = `${transactionId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const upload = await db.storage.from('incoming-evidence').upload(path, file, { contentType: file.type, upsert: false });
        if (upload.error) { photoWarning += ` Foto ${file.name} gagal diunggah. ${upload.error.message}`; continue; }
        paths.push(path);
      }
      if (paths.length) {
        const photoRows = paths.map(storage_path => ({ incoming_transaction_id: transactionId, storage_path, uploaded_by: session.user.id }));
        const { error: photoError } = await db.from('transaction_photos').insert(photoRows);
        if (photoError) { await db.storage.from('incoming-evidence').remove(paths); photoWarning += ` Data dokumentasi foto gagal dicatat. ${photoError.message}`; }
      }
    }
    setUploadStatus(''); setBusy(false); setModal(null); notify(photoWarning ? 'error' : 'success', photoWarning ? `Transaksi ${transactionNo} tersimpan, tetapi ada kendala dokumentasi.${photoWarning}` : `${kind === 'incoming' ? 'Barang masuk' : 'Barang keluar'} ${transactionNo} berhasil disimpan.`); await loadData();
  };


  const downloadMonitoring = async (format: 'pdf'|'excel') => {
    const [selectedYear, selectedMonth] = monitorMonth.split('-').map(Number);
    if (!selectedYear || !selectedMonth || selectedMonth < 1 || selectedMonth > 12) {
      notify('error', 'Bulan laporan tidak valid.'); return;
    }
    const monthStart = `${monitorMonth}-01`;
    const nextMonthDate = new Date(selectedYear, selectedMonth, 1);
    const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`;
    const monthName = new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    const isInSelectedMonth = (date: string) => date >= monthStart && date < nextMonth;
    const monthTransactions = [
      ...incoming.filter(tx => isInSelectedMonth(tx.transaction_date)).map(tx => ({ tx, kind: 'Masuk' as const, lines: incomingLines.filter(line => line.transaction_id === tx.id) })),
      ...outgoing.filter(tx => isInSelectedMonth(tx.transaction_date)).map(tx => ({ tx, kind: 'Keluar' as const, lines: outgoingLines.filter(line => line.transaction_id === tx.id) }))
    ].sort((a, b) => b.tx.transaction_date.localeCompare(a.tx.transaction_date) || b.tx.created_at.localeCompare(a.tx.created_at));
    if (!monthTransactions.length) { notify('error', 'Tidak ada data pada bulan ini'); return; }

    const rows = monthTransactions.flatMap(({ tx, kind, lines }) => lines.map(line => {
      const item = Array.isArray(line.items) ? line.items[0] : line.items;
      const period = monthPeriods.find(p => tx.transaction_date >= p.start && tx.transaction_date <= p.end);
      const currentStock = stocks.find(stock => stock.item_id === line.item_id);
      return [period?.label || '', tx.transaction_date, new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }), kind, item?.name || 'Barang', Number(line.quantity), Number(currentStock?.stock ?? 0), line.unit, kind === 'Masuk' ? [tx.supplier, tx.driver_name].filter(Boolean).join(' / ') : [tx.destination, tx.receiver_name].filter(Boolean).join(' / '), tx.notes || ''];
    }));
    const periodSummary = monthPeriods.map(period => {
      const periodIn = incoming.filter(tx => isInSelectedMonth(tx.transaction_date) && tx.transaction_date >= period.start && tx.transaction_date <= period.end).length;
      const periodOut = outgoing.filter(tx => isInSelectedMonth(tx.transaction_date) && tx.transaction_date >= period.start && tx.transaction_date <= period.end).length;
      return [period.label, periodIn, periodOut];
    });
    const filename = `monitoring-${monitorMonth}`;

    if (format === 'excel') {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      const reportData = [
        [`LAPORAN MONITORING LOGISTIK — ${monthName.toLocaleUpperCase('id-ID')}`],
        ['Periode laporan', monthName],
        [],
        ['Periode', 'Tanggal', 'Jam', 'Jenis', 'Nama Barang', 'Jumlah', 'Sisa Stok Saat Ini', 'Satuan', 'Supplier/Driver atau Tujuan/Penerima', 'Catatan'],
        ...rows
      ];
      const reportSheet = XLSX.utils.aoa_to_sheet(reportData);
      reportSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
      reportSheet['!cols'] = [
        { wch: 22 }, { wch: 13 }, { wch: 9 }, { wch: 11 }, { wch: 30 },
        { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 34 }, { wch: 38 }
      ];
      reportSheet['!autofilter'] = { ref: `A4:J${reportData.length}` };
      reportSheet['!freeze'] = { xSplit: 0, ySplit: 4 };
      XLSX.utils.book_append_sheet(workbook, reportSheet, 'Transaksi Bulanan');

      const summaryData = [
        [`REKAP TRANSAKSI — ${monthName.toLocaleUpperCase('id-ID')}`],
        [],
        ['Periode', 'Transaksi Masuk', 'Transaksi Keluar', 'Total Transaksi'],
        ...periodSummary.map(([period, masuk, keluar]) => [period, masuk, keluar, Number(masuk) + Number(keluar)]),
        ['TOTAL BULANAN', periodSummary.reduce((sum, row) => sum + Number(row[1]), 0), periodSummary.reduce((sum, row) => sum + Number(row[2]), 0), monthTransactions.length]
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      summarySheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
      summarySheet['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Rekap 5 Periode');
      XLSX.writeFile(workbook, `${filename}.xlsx`);
    } else {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('LAPORAN MONITORING LOGISTIK', 14, 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(monthName, 14, 23);
      doc.setDrawColor(210, 218, 226);
      doc.line(14, 27, 283, 27);
      autoTable(doc, {
        startY: 32,
        head: [['Periode', 'Tanggal', 'Jam', 'Jenis', 'Nama Barang', 'Jumlah', 'Sisa Stok Saat Ini', 'Satuan', 'Supplier/Driver atau Tujuan/Penerima', 'Catatan']],
        body: rows.map(row => row.map(value => String(value))),
        theme: 'striped',
        styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.2, overflow: 'linebreak', textColor: [45, 55, 65] },
        headStyles: { fillColor: [35, 91, 132], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 248, 250] },
        margin: { left: 14, right: 14, bottom: 16 },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 18 }, 2: { cellWidth: 11 }, 3: { cellWidth: 14 }, 4: { cellWidth: 34 }, 5: { cellWidth: 13 }, 6: { cellWidth: 18 }, 7: { cellWidth: 13 }, 8: { cellWidth: 44 }, 9: { cellWidth: 'auto' } }
      });
      const finalY = (doc as any).lastAutoTable?.finalY || 35;
      autoTable(doc, {
        startY: finalY + 8,
        head: [['Periode', 'Transaksi Masuk', 'Transaksi Keluar', 'Total']],
        body: [...periodSummary.map(([period, masuk, keluar]) => [String(period), String(masuk), String(keluar), String(Number(masuk) + Number(keluar))]), ['TOTAL BULANAN', String(periodSummary.reduce((sum, row) => sum + Number(row[1]), 0)), String(periodSummary.reduce((sum, row) => sum + Number(row[2]), 0)), String(monthTransactions.length)]],
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [35, 91, 132], textColor: [255, 255, 255] },
        margin: { left: 14, right: 14, bottom: 16 },
        didDrawPage: () => {
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text(`Logistik BELIA-BAYA · ${monthName}`, 14, 202);
          doc.text(`Halaman ${doc.getNumberOfPages()}`, 283, 202);
        }
      });
      doc.save(`${filename}.pdf`);
    }
    notify('success', `File ${filename}.${format === 'pdf' ? 'pdf' : 'xlsx'} berhasil dibuat.`);
  };
  const setAlert = (id: string, state: 'noted' | 'ignored') => {
    if (state === 'ignored') {
      if (!db) return;
      void (async () => {
        const { error } = await db.from('stock_alert_dismissals').insert({ item_id: id, dismissed_by: session?.user.id });
        if (error && error.code !== '23505') notify('error', `Gagal menghapus peringatan: ${error.message}`);
        else { setDismissedAlerts(current => current.includes(id) ? current : [...current, id]); notify('success', 'Peringatan dihapus permanen.'); }
      })();
      return;
    }
    const next = { ...alertState, [id]: state }; setAlertState(next); localStorage.setItem('lb-stock-alerts', JSON.stringify(next));
  };
  const dismissNotedAlert = (id: string) => { const next = { ...alertState, [id]: 'dismissed' as const }; setAlertState(next); localStorage.setItem('lb-stock-alerts', JSON.stringify(next)); };

  const deleteTransaction = async (kind: 'incoming'|'outgoing', id: string) => {
    if (!db || !isAdmin || !confirm(`Hapus permanen transaksi Barang ${kind === 'incoming' ? 'Masuk' : 'Keluar'}? Stok akan dikembalikan seperti sebelum transaksi.`)) return;
    setBusy(true);
    let photoPaths: string[] = [];
    if (kind === 'incoming') {
      const { data } = await db.from('transaction_photos').select('storage_path').eq('incoming_transaction_id', id);
      photoPaths = (data || []).map(row => row.storage_path);
      if (photoPaths.length) {
        const { error: storageError } = await db.storage.from('incoming-evidence').remove(photoPaths);
        if (storageError) {
          setBusy(false); notify('error', `Foto belum berhasil dihapus dari penyimpanan. Transaksi tidak dihapus: ${storageError.message}`); return;
        }
      }
    }
    const { error } = await db.rpc(kind === 'incoming' ? 'delete_incoming_transaction' : 'delete_outgoing_transaction', { p_id: id });
    setBusy(false);
    if (error) notify('error', `Gagal menghapus transaksi: ${error.message}`);
    else {
      setSelectedMonitor(null); notify('success', 'Transaksi dihapus permanen dan stok diperbarui.');
      await loadData();
    }
  };
  const openDocumentation = (group: { transactionId: string; notes: string; driver: string; date: string }) => { setSelectedDoc(group.transactionId); setDocEditNotes(group.notes); setDocEditDriver(group.driver); setDocEditDate(group.date); setDocAddFiles([]); };
  const saveDocumentation = async () => {
    if (!db || !session || !selectedDoc) return;
    const invalid = docAddFiles.find(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024);
    if (invalid) { notify('error', `Foto ${invalid.name} tidak valid. Gunakan JPG/PNG/WEBP maksimal 10 MB per foto.`); return; }
    if (!docEditDate) { notify('error', 'Tanggal dokumentasi wajib diisi.'); return; }
    setBusy(true);
    try {
      const { error } = await db.from('incoming_transactions').update({ notes: docEditNotes, driver_name: docEditDriver, transaction_date: docEditDate }).eq('id', selectedDoc);
      if (error) throw new Error(`Gagal memperbarui informasi dokumentasi: ${error.message}`);
      const paths: string[] = [];
      for (const [fileIndex, file] of docAddFiles.entries()) {
        setUploadStatus(`Mengunggah foto ${fileIndex + 1}/${docAddFiles.length} (${Math.round(((fileIndex + 1) / docAddFiles.length) * 100)}%)`);
        const path = `${selectedDoc}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const up = await db.storage.from('incoming-evidence').upload(path, file, { contentType: file.type, upsert: false });
        if (up.error) throw new Error(`Gagal mengunggah ${file.name}: ${up.error.message}`);
        paths.push(path);
      }
      if (paths.length) {
        const { error: insertError } = await db.from('transaction_photos').insert(paths.map(storage_path => ({ incoming_transaction_id: selectedDoc, storage_path, uploaded_by: session.user.id })));
        if (insertError) {
          await db.storage.from('incoming-evidence').remove(paths);
          throw new Error(`Foto gagal dicatat ke dokumentasi: ${insertError.message}`);
        }
      }
      setSelectedDoc(null);
      notify('success', 'Dokumentasi berhasil diperbarui.');
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Dokumentasi gagal diperbarui.');
    } finally { setUploadStatus(''); setBusy(false); }
  };
  const deleteDocumentationPhoto = async (photo: Photo) => { if (!db || !isAdmin || !confirm('Hapus foto dokumentasi ini?')) return; setBusy(true); const { error } = await db.from('transaction_photos').delete().eq('id',photo.id); if (!error) await db.storage.from('incoming-evidence').remove([photo.storage_path]); setBusy(false); if (error) notify('error',error.message); else { notify('success','Foto dokumentasi dihapus.'); await loadData(); } };
  const deleteDocumentationArchive = async () => { if (!db || !isAdmin || !selectedDoc || !confirm('Hapus seluruh foto dalam arsip ini? Transaksi dan stok tidak akan dihapus.')) return; const target=photos.filter(p=>{const tx=Array.isArray(p.incoming_transactions)?p.incoming_transactions[0]:p.incoming_transactions;return tx?.id===selectedDoc;}); setBusy(true); const {error}=await db.from('transaction_photos').delete().eq('incoming_transaction_id',selectedDoc); if (!error && target.length) await db.storage.from('incoming-evidence').remove(target.map(p=>p.storage_path)); setBusy(false); if(error) notify('error',error.message); else {setSelectedDoc(null);notify('success','Foto arsip dihapus. Transaksi dan stok tetap aman.');await loadData();} };
  const downloadPhoto = async (path: string, filename: string) => { if (!db) return; const { data, error } = await db.storage.from('incoming-evidence').download(path); if (error || !data) { notify('error',error?.message || 'Foto tidak dapat diunduh.'); return; } const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url); };



  // Semua Hook harus dipanggil sebelum conditional return agar urutannya konsisten.
  const getSignedPhoto = useCallback((path: string) => db!.storage.from('incoming-evidence').createSignedUrl(path, 3600), [session]);

  if (!ready || !db) return <div className="login-page"><div className="login-card"><div className="login-brand">LB</div><h2>Konfigurasi Database</h2><p>Pengaturan koneksi Supabase belum tersedia. Periksa Environment Variables project.</p></div></div>;
  if (loading) return <div className="login-page"><p>Memeriksa akun pengguna...</p></div>;
  if (!session || !profile) return <div className="login-page"><form className="login-card" onSubmit={handleLogin}><div className="login-brand">LB</div><small className="login-subtitle">BELIA-BAYA</small><h2>Login Sistem Logistik</h2><p>Silakan masuk menggunakan akun yang telah didaftarkan.</p><label>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Masukkan email" required /><label>Password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan password" required />{loginError && <div className="login-error">{loginError}</div>}<button className="login-button" type="submit" disabled={loginLoading}><LockKeyhole size={17} />{loginLoading ? 'Memproses...' : 'Masuk'}</button></form></div>;

  const visibleMenus = isAdmin ? menus : menus.filter(([name]) => !['Barang Masuk', 'Barang Keluar'].includes(name));

  return <div className="shell">
    <aside className={mobile ? 'sidebar show' : 'sidebar'}><div className="brand"><b>LB</b><span><strong>LOGISTIK</strong><small>BELIA-BAYA</small></span></div><label>PROJECT MANAGEMENT</label>
      {visibleMenus.map(([name, Icon]) => <button key={name} className={page === name ? 'nav active' : 'nav'} onClick={() => { if (page !== name) { setNavigationLoading(true); setPage(name); setMobile(false); setSearch(''); window.setTimeout(() => setNavigationLoading(false), 350); } }}><Icon size={18} />{name}</button>)}
      <div className="account-box"><strong>{profile.full_name}</strong><small>{isAdmin ? 'Administrator' : 'Supervisor'}</small><button onClick={handleLogout}><LogOut size={15} />Keluar</button></div><small className="foot">Sistem Logistik v1.1</small>
    </aside>
    <main><header><button className="hamb" onClick={() => setMobile(!mobile)}><Menu /></button><div><small>PROJECT / LOGISTICS</small><h1>{page === 'Dashboard' ? 'OVERVIEW' : page}</h1></div><span className="pill">{isAdmin ? 'ADMIN' : 'SUPERVISOR'}</span></header>
      {notice && <div className={`notice ${notice.type}`}>{notice.text}<button onClick={() => setNotice(null)}><X size={16}/></button></div>}
      <div className="toolbar"><span>{busy ? (uploadStatus || 'Memproses / menyimpan data...') : 'Data tersinkron dengan Supabase'}</span><button className="button dark-action small" onClick={() => void loadData()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>} Segarkan</button></div>
      {busy && items.length === 0 && stocks.length === 0 && <section className="panel loading-skeleton"><div className="skeleton-line wide"/><div className="skeleton-line"/><div className="skeleton-grid"><i/><i/><i/><i/></div><div className="skeleton-line wide"/><div className="skeleton-line"/></section>}
      {page === 'Dashboard' && <>
        <section className="hero"><small>OVERVIEW</small><h2>Selamat datang di Sistem Logistik</h2><p>Kelola penerimaan, pengeluaran, persediaan, dan dokumentasi proyek dalam satu tempat.</p></section>
        <div className="stats"><article><Package/><small>Jenis Material</small><b>{items.filter(i => i.category === 'MATERIAL' && i.is_active).length}</b></article><article><Truck/><small>Jenis Alat</small><b>{items.filter(i => i.category === 'ALAT' && i.is_active).length}</b></article><article><ArrowDownToLine/><small>Transaksi Masuk (100 terakhir)</small><b>{totalIncomingQty}</b></article><article><ArrowUpFromLine/><small>Transaksi Keluar (100 terakhir)</small><b>{totalOutgoingQty}</b></article></div>
        {stockWarnings.length > 0 && <section className="panel stock-alert-panel"><div className="panel-heading"><div><h3><Bell size={17}/> Peringatan Persediaan (≤30%)</h3><p>Merah: 0–30% atau negatif · Kuning: 31–69% · Hijau: 70–100%.</p></div></div>{stockWarnings.map(w => <div className="stock-alert-row" key={w.item_id}><div><b>{w.code} — {w.name}</b><small>Sisa {formatNumber(Number(w.stock))} {w.unit} · {formatPercent(w.percent)}</small><div className={`stock-progress ${w.percent <= 30 ? 'stock-red' : w.percent <= 69 ? 'stock-yellow' : 'stock-green'}`}><span style={{width:`${Math.max(0,Math.min(100,w.percent))}%`}}/></div></div><div className="alert-actions"><button className="button secondary small" onClick={()=>setAlert(w.item_id,'ignored')}><X size={14}/>Abaikan</button><button className="button dark-action small" onClick={()=>setAlert(w.item_id,'noted')}><CheckCircle2 size={14}/>Noted</button></div></div>)}</section>}
        {stocks.some(s=>alertState[s.item_id]==='noted') && <section className="panel noted-summary-panel"><div className="panel-heading"><div><h3>Stok yang sudah di-noted</h3><p>{stocks.filter(s=>alertState[s.item_id]==='noted').length} jenis material dan alat ditandai untuk informasi grup.</p></div><button className="button dark-action" onClick={()=>setShowNotedDetails(true)}><Eye size={15}/>Detail stok</button></div><p className="hint">Ringkasan stok yang dapat dibagikan kepada grup tersedia dalam satu tampilan.</p></section>}
        <section className="panel"><div className="panel-heading"><div><h3>Ringkasan Persediaan</h3><p>{totalStockKinds} jenis barang memiliki stok tersedia</p></div><button className="button dark-action" onClick={() => setPage('Stok Gudang')}>Lihat stok</button></div><div className="table"><table><thead><tr><th>KODE</th><th>NAMA BARANG</th><th>KATEGORI</th><th>STOK TERSEDIA</th><th>SISA (%)</th><th>SATUAN</th></tr></thead><tbody>{stocksWithPercent.filter(s => Number(s.stock) > 0).slice(0, 8).map(s => <tr key={s.item_id} className="stock-click-row" onClick={()=>{setMovementView('current');setSelectedStock(s.item_id);}}><td>{s.code}</td><td>{s.name}</td><td>{s.category}</td><td><b className={Number(s.stock) < 0 ? 'negative' : ''}>{formatNumber(Number(s.stock))}</b></td><td><span className={`percent-chip ${s.percent <= 30 ? 'percent-red' : s.percent <= 69 ? 'percent-yellow' : 'percent-green'}`}>{formatPercent(s.percent)}</span></td><td>{s.unit}</td></tr>)}</tbody></table>{!stocks.length && <p className="empty">Belum ada data persediaan.</p>}</div></section>
        <section className="panel"><h3>Akses Cepat</h3><div className="quick">{visibleMenus.slice(1).map(([name, Icon]) => <button key={name} onClick={() => setPage(name)}><Icon/>{name}</button>)}</div></section>
      </>}
      {page === 'Kode Material & Alat' && <section className="panel"><div className="panel-heading"><div><h3>Master Material & Alat</h3><p>Kelola kode, nama, kategori, dan satuan barang.</p></div>{isAdmin && <button className="button primary" onClick={() => openItemModal()}><Plus size={16}/>Tambah Barang</button>}</div><div className="searchbar"><Search size={17}/><input placeholder="Cari kode/nama barang..." value={search} onChange={e => setSearch(e.target.value)}/></div><div className="table"><table><thead><tr><th>KODE</th><th>NAMA BARANG</th><th>KATEGORI</th><th>SATUAN</th><th>STATUS</th>{isAdmin && <th>AKSI</th>}</tr></thead><tbody>{shownItems.map(item => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.category}</td><td>{item.unit}</td><td><span className={item.is_active && (item.unit || '').trim() ? 'status active-status' : 'status'}>{(item.unit || '').trim() ? 'Aktif' : 'Tidak Aktif'}</span></td>{isAdmin && <td><div className="actions"><button title="Edit" onClick={() => openItemModal(item)}><Pencil size={15}/></button></div></td>}</tr>)}</tbody></table>{!shownItems.length && <p className="empty">Belum ada data barang. Tambahkan master barang terlebih dahulu.</p>}</div></section>}
      {(page === 'Barang Masuk' || page === 'Barang Keluar') && <section className="panel"><div className="panel-heading"><div><h3>Riwayat {page}</h3><p>Satu transaksi dapat memuat beberapa jenis barang sekaligus.</p></div>{isAdmin && <button className="button primary" onClick={() => startTransaction(page === 'Barang Masuk' ? 'incoming' : 'outgoing')}><Plus size={16}/>Tambah {page}</button>}</div><div className="table"><table><thead><tr><th>NO. TRANSAKSI</th><th>TANGGAL</th><th>JAM</th>{page === 'Barang Masuk' && <th>DRIVER</th>}<th>CATATAN</th>{isAdmin&&<th>AKSI</th>}</tr></thead><tbody>{(page === 'Barang Masuk' ? incoming : outgoing).map(t => <tr key={t.id}><td><b>{t.transaction_no}</b></td><td>{t.transaction_date}</td><td>{new Date(t.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false})}</td>{page === 'Barang Masuk' && <td>{t.driver_name || '—'}</td>}<td>{t.notes || '—'}</td>{isAdmin&&<td><button className='icon-button' title='Edit transaksi' onClick={()=>startEditTransaction(page==='Barang Masuk'?'incoming':'outgoing',t)}><Pencil size={15}/></button><button className='icon-button' title='Hapus transaksi' onClick={()=>void deleteTransaction(page==='Barang Masuk'?'incoming':'outgoing',t.id)}><Trash2 size={15}/></button></td>}</tr>)}</tbody></table>{!(page === 'Barang Masuk' ? incoming : outgoing).length && <p className="empty">Belum ada transaksi.</p>}</div></section>}
      {page === 'Stok Gudang' && <section className="panel"><div className="panel-heading"><div><h3>Persediaan Gudang</h3><p>Persentase 100% dimulai dari total penambahan stok; pengeluaran mengurangi persentase.</p></div></div><div className="searchbar"><Search size={17}/><input placeholder="Cari kode/nama barang..." value={search} onChange={e => setSearch(e.target.value)}/></div><div className="table"><table><thead><tr><th>KODE</th><th>NAMA BARANG</th><th>KATEGORI</th><th>STOK TERSEDIA</th><th>SISA (%)</th><th>SATUAN</th></tr></thead><tbody>{stocksWithPercent.filter(s => `${s.code} ${s.name}`.toLowerCase().includes(search.toLowerCase())).map(s => <tr key={s.item_id} className="stock-click-row" onClick={()=>{setMovementView('current');setSelectedStock(s.item_id);}}><td>{s.code}</td><td>{s.name}</td><td>{s.category}</td><td><b className={Number(s.stock) < 0 ? 'negative' : ''}>{formatNumber(Number(s.stock))}</b></td><td><span className={`percent-chip ${s.percent <= 30 ? 'percent-red' : s.percent <= 69 ? 'percent-yellow' : 'percent-green'}`}>{formatPercent(s.percent)}</span></td><td>{s.unit}</td></tr>)}</tbody></table>{!stocks.length && <p className="empty">Belum ada data stok.</p>}</div></section>}
      {page === 'Monitoring' && <section className="panel"><div className="panel-heading"><div><h3>Monitoring Barang Masuk & Keluar</h3><p>Pilih bulan untuk melihat aktivitas dalam 5 periode mingguan (masing-masing 7 hari, periode terakhir menyesuaikan akhir bulan).</p></div><label className="month-filter">Pilih bulan<input type="month" value={monitorMonth} onChange={e => setMonitorMonth(e.target.value)}/></label><div className="export-actions"><button className="button secondary small" onClick={()=>void downloadMonitoring('pdf')}>Download PDF</button><button className="button secondary small" onClick={()=>void downloadMonitoring('excel')}>Download Excel</button></div></div>{monthPeriods.map(period => { const periodIn = incoming.filter(t => t.transaction_date >= period.start && t.transaction_date <= period.end); const periodOut = outgoing.filter(t => t.transaction_date >= period.start && t.transaction_date <= period.end); return <article className="monitor-period" key={period.number}><div className="period-head"><div><b>Periode {period.number}</b><small>{period.label}</small></div><div className="period-counts"><span className="in-count">Masuk: {periodIn.length}</span><span className="out-count">Keluar: {periodOut.length}</span></div></div><div className="monitor-columns"><div><h4><ArrowDownToLine size={16}/> Barang Masuk</h4>{periodIn.length ? periodIn.map(t => <div role="button" tabIndex={0} className="monitor-transaction monitor-click" key={t.id} onClick={() => setSelectedMonitor({kind:'incoming',id:t.id})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedMonitor({kind:'incoming',id:t.id});}}}><b>{t.transaction_date}</b><small>{new Date(t.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false})} · {t.driver_name || 'Driver tidak dicantumkan'}</small><ul>{incomingLines.filter(line => line.transaction_id === t.id).map((line, i) => { const item = Array.isArray(line.items) ? line.items[0] : line.items; return <li key={`${line.item_id}-${i}`}>{item?.name || 'Barang'}: {formatNumber(Number(line.quantity))} {line.unit}</li>; })}</ul>{t.notes && <small>Catatan: {t.notes}</small>}{isAdmin&&<button type='button' className='icon-button' title='Hapus transaksi' onClick={e=>{e.stopPropagation();void deleteTransaction('incoming',t.id);}}><Trash2 size={15}/></button>}</div>) : <p className="empty small-empty">Tidak ada barang masuk.</p>}</div><div><h4><ArrowUpFromLine size={16}/> Barang Keluar</h4>{periodOut.length ? periodOut.map(t => <div role="button" tabIndex={0} className="monitor-transaction monitor-click" key={t.id} onClick={() => setSelectedMonitor({kind:'outgoing',id:t.id})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelectedMonitor({kind:'outgoing',id:t.id});}}}><b>{t.transaction_date}</b><small>{new Date(t.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false})}</small><ul>{outgoingLines.filter(line => line.transaction_id === t.id).map((line, i) => { const item = Array.isArray(line.items) ? line.items[0] : line.items; return <li key={`${line.item_id}-${i}`}>{item?.name || 'Barang'}: {formatNumber(Number(line.quantity))} {line.unit}</li>; })}</ul>{t.notes && <small>Catatan: {t.notes}</small>}{isAdmin&&<button type='button' className='icon-button' title='Hapus transaksi' onClick={e=>{e.stopPropagation();void deleteTransaction('outgoing',t.id);}}><Trash2 size={15}/></button>}</div>) : <p className="empty small-empty">Tidak ada barang keluar.</p>}</div></div></article>; })}<p className="hint">Monitoring menggunakan tanggal transaksi. Data yang ditampilkan mengikuti transaksi yang berhasil dimuat dari database.</p></section>}
      {page === 'Dokumentasi' && <section className="panel"><div className="panel-heading"><div><h3>Dokumentasi Barang Masuk</h3><p>Arsip dikelompokkan per transaksi. {documentationGroups.length} arsip · {documentationPhotos.length} foto.</p></div><label className="month-filter">Pilih bulan<input type="month" value={documentationMonth} onChange={e => setDocumentationMonth(e.target.value)}/></label></div>{documentationGroups.length ? <div className="doc-archive-list">{documentationGroups.map(group=><button className="doc-archive" key={group.transactionId} onClick={()=>openDocumentation(group)}><div className="doc-archive-head"><div><b>{group.date} · {(() => { const tx=photos.find(p=>{const v=Array.isArray(p.incoming_transactions)?p.incoming_transactions[0]:p.incoming_transactions;return v?.id===group.transactionId;});const v=tx?(Array.isArray(tx.incoming_transactions)?tx.incoming_transactions[0]:tx.incoming_transactions):null;return v?.created_at?new Date(v.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false}):'--:--';})()}</b><small>Driver: {group.driver || 'Belum dicantumkan'}</small><small>Catatan: {group.notes || 'Tidak ada catatan'}</small></div><span>{group.photos.length} foto <ChevronDown size={16}/></span></div><div className="doc-thumb-row">{group.photos.slice(0,4).map(photo=><DocThumb key={photo.id} photo={photo} getSignedPhoto={getSignedPhoto}/>)}{group.photos.length>4&&<span className="doc-more">+{group.photos.length-4}</span>}</div></button>)}</div> : <div className="empty"><ImageIcon size={32}/><p>Tidak ada arsip dokumentasi pada {new Date(Number(documentationMonth.slice(0,4)),Number(documentationMonth.slice(5,7))-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})}.</p></div>}</section>}
      {page === 'Rencana Barang' && <section className="panel plan-panel">
        <div className="section-head"><div><h2>Rencana Barang</h2><p>Rencana kebutuhan material dan alat berdasarkan Order Material.</p></div><span className="plan-count">{materialOrders.length} OM</span></div>
        {isAdmin && <form className="plan-form" onSubmit={saveMaterialOrder}>
          <div className="plan-field"><label>No. OM</label><input value={orderHeader.om_no} onChange={e=>setOrderHeader({...orderHeader,om_no:e.target.value})} required placeholder="Masukkan nomor OM"/></div>
          <div className="plan-field"><label>Proyek</label><select value={orderHeader.project} onChange={e=>setOrderHeader({...orderHeader,project:e.target.value as 'BELIA'|'BAYA'})}><option value="BELIA">Belia</option><option value="BAYA">Baya</option></select></div>
          <div className="plan-field"><label>Tanggal</label><input type="date" value={orderHeader.order_date} onChange={e=>setOrderHeader({...orderHeader,order_date:e.target.value})} required/></div>
          <div className="line-editor full"><div className="line-heading"><strong>Baris barang</strong><button type="button" className="button secondary small" onClick={()=>setOrderLines(old=>[...old,{item_id:'',quantity:'',note:''}])}><Plus size={14}/>Tambah baris</button></div>
            {orderLines.map((line,index)=>{const item=items.find(entry=>entry.id===line.item_id);return <div className="line-row" key={index}>
              <label>Nama material & alat<SearchableItemSelect items={activeItems} value={line.item_id} onChange={value=>setOrderLines(old=>old.map((row,i)=>i===index?{...row,item_id:value}:row))} placeholder="Cari kode atau nama barang..."/></label>
              <label>Jumlah rencana<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>setOrderLines(old=>old.map((row,i)=>i===index?{...row,quantity:e.target.value}:row))} required/></label>
              <label>Satuan<input readOnly value={item?.unit || ''} placeholder="Otomatis"/></label>
              <label>Keterangan<input value={line.note} onChange={e=>setOrderLines(old=>old.map((row,i)=>i===index?{...row,note:e.target.value}:row))} placeholder="Opsional"/></label>
              <button type="button" className="remove-line" title="Hapus baris" aria-label="Hapus baris" disabled={orderLines.length===1} onClick={()=>setOrderLines(old=>old.filter((_,i)=>i!==index))}><X size={16}/></button>
            </div>;})}
          </div>
          <button className="button primary" type="submit" disabled={orderSaving}>{orderSaving?'Menyimpan...':<><Plus size={15}/>Tambah Rencana</>}</button>
        </form>}
        {(['BELIA','BAYA'] as const).map(project=><section className="panel order-project" key={project}>
          <div className="panel-heading"><div><h3>Update Material & Alat Proyek {project==='BELIA'?'Belia':'Baya'}</h3></div><button type="button" className="icon-button" title="Salin seluruh OM" onClick={()=>void copyOrderText(project)}><Download size={17}/></button></div>
          {materialOrders.filter(order=>order.project===project).sort((a,b)=>b.order_date.localeCompare(a.order_date)).map(order=><article className="plan-row" key={order.id} style={{display:'block',position:'relative'}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:12}}><strong>OM: {order.om_no}　{order.order_date.split('-').reverse().join('/')}</strong>{isAdmin&&<button className="icon-button" title="Hapus OM" onClick={()=>void deleteMaterialOrder(order)}><X size={17}/></button>}</div>
            <ul>{(order.material_order_lines||[]).map(line=>{const item=items.find(entry=>entry.id===line.item_id);const received=allocatedOrders.get(order.id)?.get(line.id)||0;const qty=Number(line.planned_quantity);const status=received>=qty?'✅':received>0?'🔄':'❌';return <li key={line.id}>{item?.name||'Barang'} = {formatNumber(qty)} {line.unit} {status}{received>0&&received<qty?` (kurang ${formatNumber(qty-received)} ${line.unit})`:''}{line.note?` (${line.note})`:''}</li>;})}</ul>
          </article>)}
          {!materialOrders.some(order=>order.project===project)&&<p className="empty">Belum ada OM untuk proyek {project}.</p>}
        </section>)}
      </section>}
      <footer>© {new Date().getFullYear()} BELIA-BAYA</footer>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><div className="modal"><div className="modal-head"><div><h3>{modal === 'item' ? (editingItem ? 'Edit Master Barang' : 'Tambah Master Barang') : modal === 'incoming' ? (editingTransaction ? 'Edit Barang Masuk' : 'Tambah Barang Masuk') : modal === 'outgoing' ? (editingTransaction ? 'Edit Barang Keluar' : 'Tambah Barang Keluar') : ''}</h3><p>Lengkapi informasi berikut sebelum menyimpan.</p></div><button className="icon-button" onClick={() => setModal(null)}><X/></button></div>
      {modal === 'item' && <form onSubmit={saveItem} className="form-grid"><label>Kode barang<input value={itemForm.code} onChange={e => setItemForm({ ...itemForm, code: e.target.value })} placeholder="Contoh: 1005" required/></label><label>Nama barang<input value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Contoh: Semen" required/></label><label>Kategori<select value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value as 'MATERIAL' | 'ALAT' })}><option value="MATERIAL">Material</option><option value="ALAT">Alat</option></select></label><label>Satuan<input value={itemForm.unit} onChange={e => setItemForm({ ...itemForm, unit: e.target.value })} placeholder="Kosongkan untuk menonaktifkan barang"/></label><div className="form-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Batal</button><button className="button primary" disabled={busy}>Simpan</button></div></form>}
      {(modal === 'incoming' || modal === 'outgoing') && <form onSubmit={e => void saveTransaction(e, modal)} className="form-grid"><label>Tanggal transaksi<input type="date" value={transactionForm.date} onChange={e => setTransactionForm({ ...transactionForm, date: e.target.value })} required/></label>
        {modal === 'incoming' && <><label>Supplier / pemasok<input value={transactionForm.supplier} onChange={e => setTransactionForm({ ...transactionForm, supplier: e.target.value })} placeholder="Nama supplier"/></label><label>Nama driver<input value={transactionForm.driver_name} onChange={e => setTransactionForm({ ...transactionForm, driver_name: e.target.value })} placeholder="Nama driver"/></label><label>Nomor kendaraan (opsional)<input value={transactionForm.vehicle_no} onChange={e => setTransactionForm({ ...transactionForm, vehicle_no: e.target.value })} placeholder="Nomor kendaraan"/></label></>}
        <div className="line-editor"><div className="line-heading"><strong>Daftar barang</strong><button type="button" className="button secondary small" onClick={() => setLines(old => [...old, emptyLine()])}><Plus size={14}/>Tambah barang</button></div>{lines.map((line, index) => <div className="line-row" key={index}><label>Barang<SearchableItemSelect items={activeItems} value={line.item_id} onChange={value => updateLine(index, 'item_id', value)} placeholder="Cari kode atau nama barang..." /></label><label>Jumlah<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => updateLine(index, 'quantity', e.target.value)} placeholder="0" required/></label><label>Satuan<input value={line.unit} readOnly placeholder="Otomatis"/></label><button type="button" className="remove-line" title="Hapus baris" disabled={lines.length === 1} onClick={() => setLines(old => old.filter((_, i) => i !== index))}><Trash2 size={16}/></button></div>)}</div>
        <label className="full">Catatan / informasi transaksi<textarea rows={2} value={transactionForm.notes} onChange={e => setTransactionForm({ ...transactionForm, notes: e.target.value })} placeholder="Keterangan tambahan..."/></label>
        {modal === 'outgoing' && <><label>Tujuan / lokasi pengiriman<input value={transactionForm.destination} onChange={e => setTransactionForm({ ...transactionForm, destination: e.target.value })} placeholder="Tujuan barang"/></label><label>Nama penerima<input value={transactionForm.receiver_name} onChange={e => setTransactionForm({ ...transactionForm, receiver_name: e.target.value })} placeholder="Nama penerima"/></label></>}
        {modal === 'incoming' && <label className="full upload-box"><span><Upload size={18}/> Upload foto nota / barang masuk</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => setPhotoFiles(Array.from(e.target.files || []))}/><small>{photoFiles.length ? `${photoFiles.length} foto dipilih: ${photoFiles.map(f => f.name).join(', ')}` : 'Bisa memilih beberapa foto sekaligus. Maksimal 10 MB per foto.'}</small></label>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Batal</button><button className="button primary" disabled={busy}>{busy ? 'Menyimpan...' : editingTransaction ? 'Simpan Perubahan' : 'Simpan Transaksi'}</button></div></form>}

    </div></div>}
    {showNotedDetails && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowNotedDetails(false);}}><div className="modal stock-detail-modal"><div className="modal-head"><div><h3>Detail Stok untuk Grup</h3><p>Gabungan seluruh material dan alat yang sudah di-noted.</p></div><button className="icon-button" onClick={()=>setShowNotedDetails(false)}><X/></button></div><div className="table noted-detail-table"><table><thead><tr><th>NO.</th><th>KODE MATERIAL</th><th>NAMA MATERIAL / ALAT</th><th>SATUAN</th><th>SISA STOK</th><th>SISA (%)</th><th>AKSI</th></tr></thead><tbody>{stocksWithPercent.filter(s=>alertState[s.item_id]==='noted').sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})).map((s,index)=><tr key={s.item_id}><td>{index+1}</td><td><b>{s.code}</b></td><td>{s.name}</td><td>{s.unit||'—'}</td><td>{formatNumber(Number(s.stock))}</td><td><span className={`percent-chip ${s.percent<=30?'percent-red':s.percent<=69?'percent-yellow':'percent-green'}`}>{formatPercent(s.percent)}</span></td><td><button type="button" className="icon-button" title="Hapus permanen dari daftar Detail Stok untuk Grup" aria-label={`Hapus ${s.name} dari daftar Detail Stok untuk Grup`} onClick={()=>dismissNotedAlert(s.item_id)}><X size={17}/></button></td></tr>)}</tbody></table>{!stocksWithPercent.some(s=>alertState[s.item_id]==='noted')&&<p className="empty">Belum ada stok yang di-noted.</p>}</div><div className="form-actions"><button className="button dark-action" onClick={()=>setShowNotedDetails(false)}>Tutup</button></div></div></div>}
    {selectedStockData && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedStock(null);}}><div className="modal stock-detail-modal"><div className="modal-head"><div><h3>Detail Pergerakan Stok</h3><p>{selectedStockData.code} · {selectedStockData.name}</p></div><button className="icon-button" onClick={()=>setSelectedStock(null)}><X/></button></div><div className="movement-view-switch" role="group" aria-label="Pilihan ringkasan pergerakan stok"><button type="button" className={movementView==='current'?'active':''} onClick={()=>setMovementView('current')}>Total sekarang</button><button type="button" className={movementView==='all'?'active':''} onClick={()=>setMovementView('all')}>Total keseluruhan</button></div>{movementView==='current' ? <><div className="stock-detail-stats current-stock-stats"><article><small>Stok tersedia sekarang</small><b>{formatNumber(Number(selectedStockData.stock))} {selectedStockData.unit}</b></article><article><small>Sisa dari dasar 100%</small><b>{formatPercent(selectedStockData.percent)}</b></article></div><p className="hint">Tampilan ringkas kondisi stok terakhir. Pilih <b>Total keseluruhan</b> untuk melihat akumulasi barang masuk, barang keluar, dan seluruh riwayat pergerakan.</p></> : <><div className="stock-detail-stats"><article><small>Stok tersedia sekarang</small><b>{formatNumber(Number(selectedStockData.stock))} {selectedStockData.unit}</b></article><article><small>Total barang masuk</small><b>{formatNumber(Number(selectedStockData.incoming_total))} {selectedStockData.unit}</b></article><article><small>Total barang keluar</small><b>{formatNumber(Number(selectedStockData.outgoing_total))} {selectedStockData.unit}</b></article><article><small>Persentase tersisa</small><b>{formatPercent(selectedStockData.percent)}</b></article></div><h4>Seluruh riwayat pergerakan stok</h4><div className="table"><table><thead><tr><th>TANGGAL</th><th>JENIS</th><th>JUMLAH</th><th>CATATAN</th></tr></thead><tbody>{selectedStockMovements.map(m=><tr key={m.id}><td>{m.transaction_date}</td><td>{m.movement_type==='IN'?'Barang Masuk':m.movement_type==='OUT'?'Barang Keluar':m.movement_type==='OPENING'?'Stok Awal':'Reversal'}</td><td>{m.movement_type==='OUT'||m.movement_type==='REVERSAL'?'-':''}{formatNumber(Number(m.quantity))} {selectedStockData.unit}</td><td>{m.notes||'—'}</td></tr>)}</tbody></table>{!selectedStockMovements.length&&<p className="empty">Belum ada riwayat pergerakan stok.</p>}</div></>}</div></div>}
    {selectedDoc && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedDoc(null);}}><div className="modal doc-modal"><div className="modal-head"><div><h3>Detail Dokumentasi</h3><p>Kelola catatan, driver, dan foto dalam satu arsip.</p></div><button className="icon-button" onClick={()=>setSelectedDoc(null)}><X/></button></div><div className="form-grid"><label>Tanggal dokumentasi<input type="date" value={docEditDate} onChange={e=>setDocEditDate(e.target.value)}/></label><label>Nama driver<input value={docEditDriver} onChange={e=>setDocEditDriver(e.target.value)}/></label><label className="full">Catatan / informasi<textarea rows={3} value={docEditNotes} onChange={e=>setDocEditNotes(e.target.value)}/></label><label className="full upload-box"><span><Upload size={17}/> Tambah beberapa foto</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setDocAddFiles(Array.from(e.target.files||[]))}/><small>{docAddFiles.length} foto dipilih</small></label><div className="doc-detail-grid full">{photos.filter(p=>{const tx=Array.isArray(p.incoming_transactions)?p.incoming_transactions[0]:p.incoming_transactions;return tx?.id===selectedDoc;}).map(p=><DocDetailPhoto key={p.id} photo={p} getSignedPhoto={getSignedPhoto} onDownload={()=>void downloadPhoto(p.storage_path, p.storage_path.split('/').pop()||'dokumentasi.jpg')} onDelete={()=>void deleteDocumentationPhoto(p)}/>)}</div><div className="form-actions"><button className="button secondary" onClick={()=>setSelectedDoc(null)}>Tutup</button>{isAdmin&&<button className="button secondary" onClick={()=>void deleteDocumentationArchive()}>Hapus arsip foto</button>}{isAdmin&&<button className="button dark-action" disabled={busy} onClick={()=>void saveDocumentation()}>{busy?'Menyimpan...':'Simpan Perubahan'}</button>}</div></div></div></div>}
    {selectedMonitor && (()=>{const tx=(selectedMonitor.kind==='incoming'?incoming:outgoing).find(t=>t.id===selectedMonitor.id);const detailLines=(selectedMonitor.kind==='incoming'?incomingLines:outgoingLines).filter(l=>l.transaction_id===selectedMonitor.id);return tx?<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedMonitor(null);}}><div className="modal"><div className="modal-head"><div><h3>Detail {selectedMonitor.kind==='incoming'?'Barang Masuk':'Barang Keluar'}</h3><p>{tx.transaction_date}<br/>{new Date(tx.created_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false})}</p></div><button className="icon-button" onClick={()=>setSelectedMonitor(null)}><X/></button></div>{selectedMonitor.kind==='incoming' ? <><p><b>Supplier:</b> {tx.supplier||'Tidak dicantumkan'}</p><p><b>Driver:</b> {tx.driver_name||'Tidak dicantumkan'}</p><p><b>Nomor kendaraan:</b> {tx.vehicle_no||'—'}</p></> : <><p><b>Tujuan:</b> {tx.destination||'Tidak dicantumkan'}</p><p><b>Penerima:</b> {tx.receiver_name||'Tidak dicantumkan'}</p></>}<p><b>Catatan:</b> {tx.notes||'Tidak ada catatan'}</p><div className="table"><table><thead><tr><th>Barang</th><th>Jumlah</th><th>Satuan</th></tr></thead><tbody>{detailLines.map((l,i)=>{const it=Array.isArray(l.items)?l.items[0]:l.items;return <tr key={i}><td>{it?.code} — {it?.name}</td><td>{formatNumber(Number(l.quantity))}</td><td>{l.unit}</td></tr>;})}</tbody></table></div><div className="form-actions">{isAdmin&&<button className="button secondary" onClick={()=>{startEditTransaction(selectedMonitor.kind,tx);setSelectedMonitor(null);}}><Pencil size={15}/>Edit</button>}{isAdmin&&<button className="button secondary" onClick={()=>void deleteTransaction(selectedMonitor.kind,tx.id)}><Trash2 size={15}/>Hapus permanen</button>}<button className="button dark-action" onClick={()=>setSelectedMonitor(null)}>Tutup</button></div></div></div>:null;})()}
    {navigationLoading && <div className="page-loading"><LoaderCircle className="spin" size={30}/><span>Memuat halaman dan menyinkronkan tampilan...</span></div>}
  </div>;
}

function usePhotoUrl(path: string, getSignedPhoto: (path: string) => Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>) { const [url,setUrl]=useState(''); useEffect(()=>{let active=true;getSignedPhoto(path).then(({data})=>{if(active&&data)setUrl(data.signedUrl);});return()=>{active=false;};},[path,getSignedPhoto]);return url; }
function DocThumb({photo,getSignedPhoto}:{photo:Photo;getSignedPhoto:(path:string)=>Promise<{data:{signedUrl:string}|null;error:{message:string}|null}>}) { const url=usePhotoUrl(photo.storage_path,getSignedPhoto); return url?<img className="doc-thumb" src={url} alt="Foto dokumentasi"/>:<span className="doc-thumb placeholder"><ImageIcon size={18}/></span>; }
function DocDetailPhoto({photo,getSignedPhoto,onDownload,onDelete}:{photo:Photo;getSignedPhoto:(path:string)=>Promise<{data:{signedUrl:string}|null;error:{message:string}|null}>;onDownload:()=>void;onDelete:()=>void}) { const url=usePhotoUrl(photo.storage_path,getSignedPhoto); return <article className="doc-detail-photo">{url?<img src={url} alt="Dokumentasi transaksi"/>:<div className="photo-placeholder"><ImageIcon/></div>}<div><button className="button dark-action small" onClick={onDownload}><Download size={14}/>Unduh</button><button className="button secondary small" onClick={onDelete}><Trash2 size={14}/>Hapus</button></div></article>; }


function SearchableItemSelect({items,value,onChange,placeholder}:{items:Item[];value:string;onChange:(value:string)=>void;placeholder:string}) {
  const [query,setQuery] = useState('');
  const [open,setOpen] = useState(false);
  const selected = items.find(item=>item.id===value);
  useEffect(()=>{ if (!open) setQuery(selected ? `${selected.code} — ${selected.name}` : ''); },[value, selected?.code, selected?.name]);
  const filtered = items
    .filter(item =>
      `${item.code} ${item.name}`
        .toLocaleLowerCase('id-ID')
        .includes(query.toLocaleLowerCase('id-ID'))
    )
    .sort((a, b) => {
      const categoryOrder = (category: Item['category']) =>
        category?.toUpperCase() === 'MATERIAL' ? 0 :
        category?.toUpperCase() === 'ALAT' ? 1 : 2;

      const categoryDifference = categoryOrder(a.category) - categoryOrder(b.category);
      if (categoryDifference !== 0) return categoryDifference;

      return String(a.code).localeCompare(String(b.code), 'id', { numeric: true });
    });
  return <div className="item-search-select">
    <div className="item-search-input"><Search size={15}/><input type="text" value={query} placeholder={placeholder} autoComplete="off" onFocus={()=>{setOpen(true);setQuery('');}} onChange={e=>{setQuery(e.target.value);onChange('');setOpen(true);}} onBlur={()=>window.setTimeout(()=>setOpen(false),140)} aria-label="Cari barang berdasarkan kode atau nama"/><ChevronDown size={15}/></div>
    {open && <div className="item-search-options">{filtered.length ? filtered.map(item=><button type="button" key={item.id} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(item.id);setQuery(`${item.code} — ${item.name}`);setOpen(false);}}><b>{item.code}</b><span>{item.name}</span><small><span className={`item-category-tag ${item.category==='ALAT'?'alat':''}`}>{item.category==='ALAT'?'ALAT':'MATERIAL'}</span>{item.unit||'Tanpa satuan'}</small></button>) : <p>Tidak ada barang yang cocok.</p>}</div>}
  </div>;
}
