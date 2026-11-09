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
type Photo = { id: string; storage_path: string; description: string | null; created_at: string; incoming_transactions?: { id?: string; transaction_no: string; transaction_date: string; supplier: string | null; driver_name?: string | null; notes?: string | null } | { id?: string; transaction_no: string; transaction_date: string; supplier: string | null; driver_name?: string | null; notes?: string | null }[] | null };
type Transaction = { id: string; transaction_no: string; transaction_date: string; supplier?: string | null; destination?: string | null; receiver_name?: string | null; vehicle_no?: string | null; driver_name?: string | null; notes?: string | null; created_at: string };
type TransactionLine = { transaction_id: string; item_id: string; quantity: number; unit: string; items?: { code: string; name: string } | { code: string; name: string }[] | null };
type Movement = { id: string; item_id: string; movement_type: 'IN' | 'OUT' | 'OPENING' | 'REVERSAL'; quantity: number; transaction_date: string; notes: string | null };
type MaterialPlan = { id: string; item_id: string; planned_quantity: number; unit: string; created_at: string };

const menus = [
  ['Dashboard', LayoutDashboard], ['Rencana Barang', Package], ['Kode Material & Alat', Boxes],
  ['Barang Masuk', ArrowDownToLine], ['Barang Keluar', ArrowUpFromLine],
  ['Stok Gudang', Archive], ['Monitoring', BarChart3], ['Dokumentasi', Camera]
] as const;
const today = () => new Date().toLocaleDateString('en-CA');
const emptyLine = (): Line => ({ item_id: '', quantity: '', unit: '', cost_code: '' });
const formatNumber = (value: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(value);
const stockPercent = (stock: number, percentageBase: number, outgoingTotal: number) => percentageBase > 0 ? (stock / percentageBase) * 100 : stock < 0 || outgoingTotal > 0 ? -100 : 0;
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
  const [modal, setModal] = useState<'item' | 'incoming' | 'outgoing' | 'adjust' | null>(null);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [itemForm, setItemForm] = useState({ code: '', name: '', category: 'MATERIAL' as 'MATERIAL' | 'ALAT', unit: '' });
  const [transactionForm, setTransactionForm] = useState({ date: today(), supplier: '', vehicle_no: '', driver_name: '', destination: '', receiver_name: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [adjustForm, setAdjustForm] = useState({ item_id: '', direction: 'IN', quantity: '', date: today(), notes: '' });
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [docEditNotes, setDocEditNotes] = useState('');
  const [docEditDate, setDocEditDate] = useState(today());
  const [selectedMonitor, setSelectedMonitor] = useState<{kind:'incoming'|'outgoing';id:string}|null>(null);
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
        await db!.auth.signOut();
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
      db.from('transaction_photos').select('id, storage_path, description, created_at, incoming_transactions(id, transaction_no, transaction_date, supplier, driver_name, notes)').order('created_at', { ascending: false }).limit(500),
      db.from('incoming_items').select('transaction_id, item_id, quantity, unit, items(code, name)'),
      db.from('outgoing_items').select('transaction_id, item_id, quantity, unit, items(code, name)')
    ]);
    const planRes = await db.from('material_plans').select('id, item_id, planned_quantity, unit, created_at').order('created_at', { ascending: false });
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
  }, [session]);

  useEffect(() => { if (session && profile) void loadData(); }, [session, profile, loadData]);

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

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!db) return;
    setLoginLoading(true); setLoginError('');
    try { const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setLoginError(`Login gagal: ${error.message}`);
    } catch (error) { setLoginError(error instanceof Error ? error.message : 'Koneksi login gagal.'); }
    finally { setLoginLoading(false); }
  };
  const handleLogout = async () => { if (!db) return; await db.auth.signOut(); setPage('Dashboard'); };
  const shownItems = useMemo(() => items.filter(i => `${i.code} ${i.name} ${i.category}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  const activeItems = items.filter(i => i.is_active);
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
  const stocksWithPercent = useMemo(() => stocks.map(stock => ({ ...stock, percent: stockPercent(Number(stock.stock), Number(stock.stock_percentage_base ?? stock.incoming_total ?? 0), Number(stock.outgoing_total || 0)) })), [stocks]);
  useEffect(() => {
    // Jika stok pulih di atas ambang peringatan, hapus status Noted/Abaikan lama.
    // Jika stok kembali rendah di kemudian hari, peringatannya akan muncul lagi.
    const recovered = stocksWithPercent.filter(stock => stock.percent > 30 && alertState[stock.item_id]);
    if (!recovered.length) return;
    const next = { ...alertState };
    recovered.forEach(stock => { delete next[stock.item_id]; });
    setAlertState(next);
    localStorage.setItem('lb-stock-alerts', JSON.stringify(next));
  }, [stocksWithPercent, alertState]);
  const stockWarnings = stocksWithPercent.filter(stock => (Number(stock.incoming_total) > 0 || Number(stock.outgoing_total) > 0) && stock.percent <= 30 && alertState[stock.item_id] !== 'ignored' && alertState[stock.item_id] !== 'noted' && alertState[stock.item_id] !== 'dismissed');
  const ignoredStocks = stocksWithPercent.filter(stock => stock.percent <= 30 && alertState[stock.item_id] === 'ignored');
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
    setTransactionForm({ date: today(), supplier: '', vehicle_no: '', driver_name: '', destination: '', receiver_name: '', notes: '' });
    setLines([emptyLine()]); setPhotoFiles([]); setModal(kind);
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

  const setAlert = (id: string, state: 'noted' | 'ignored') => { const next = { ...alertState, [id]: state }; setAlertState(next); localStorage.setItem('lb-stock-alerts', JSON.stringify(next)); };
  const dismissNotedAlert = (id: string) => { const next = { ...alertState, [id]: 'dismissed' as const }; setAlertState(next); localStorage.setItem('lb-stock-alerts', JSON.stringify(next)); };
  const restoreAlert = (id: string) => { const next = { ...alertState }; delete next[id]; setAlertState(next); localStorage.setItem('lb-stock-alerts', JSON.stringify(next)); };
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
      setDocumentationMonth(docEditDate.slice(0, 7)); setSelectedDoc(null);
      notify('success', 'Dokumentasi berhasil diperbarui.');
      await loadData();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Dokumentasi gagal diperbarui.');
    } finally { setUploadStatus(''); setBusy(false); }
  };
  const deleteDocumentationPhoto = async (photo: Photo) => { if (!db || !isAdmin || !confirm('Hapus foto dokumentasi ini?')) return; setBusy(true); const { error } = await db.from('transaction_photos').delete().eq('id',photo.id); if (!error) await db.storage.from('incoming-evidence').remove([photo.storage_path]); setBusy(false); if (error) notify('error',error.message); else { notify('success','Foto dokumentasi dihapus.'); await loadData(); } };
  const deleteDocumentationArchive = async () => { if (!db || !isAdmin || !selectedDoc || !confirm('Hapus seluruh foto dalam arsip ini? Transaksi dan stok tidak akan dihapus.')) return; const target=photos.filter(p=>{const tx=Array.isArray(p.incoming_transactions)?p.incoming_transactions[0]:p.incoming_transactions;return tx?.id===selectedDoc;}); setBusy(true); const {error}=await db.from('transaction_photos').delete().eq('incoming_transaction_id',selectedDoc); if (!error && target.length) await db.storage.from('incoming-evidence').remove(target.map(p=>p.storage_path)); setBusy(false); if(error) notify('error',error.message); else {setSelectedDoc(null);notify('success','Foto arsip dihapus. Transaksi dan stok tetap aman.');await loadData();} };
  const downloadPhoto = async (path: string, filename: string) => { if (!db) return; const { data, error } = await db.storage.from('incoming-evidence').download(path); if (error || !data) { notify('error',error?.message || 'Foto tidak dapat diunduh.'); return; } const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url); };

  const saveAdjustment = async (e: FormEvent) => {
    e.preventDefault(); if (!db) return;
    if (!adjustForm.item_id || Number(adjustForm.quantity) <= 0) { notify('error', 'Pilih barang dan isi jumlah koreksi yang valid.'); return; }
    setBusy(true);
    const { error } = await db.rpc('adjust_stock', { p_item_id: adjustForm.item_id, p_direction: adjustForm.direction, p_quantity: Number(adjustForm.quantity), p_date: adjustForm.date, p_notes: adjustForm.notes });
    setBusy(false);
    if (error) notify('error', `Koreksi stok gagal: ${error.message}`);
    else { setModal(null); notify('success', 'Koreksi stok berhasil dicatat dalam riwayat.'); await loadData(); }
  };

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
        {ignoredStocks.length > 0 && <section className="panel ignored-alert-panel"><div className="panel-heading"><div><h3>Peringatan yang diabaikan</h3><p>{ignoredStocks.length} peringatan disembunyikan dari daftar aktif.</p></div></div>{ignoredStocks.map(stock=><div className="stock-alert-row" key={stock.item_id}><div><b>{stock.code} — {stock.name}</b><small>Sisa {formatNumber(Number(stock.stock))} {stock.unit} · {formatPercent(stock.percent)}</small></div><button className="button secondary small" onClick={()=>restoreAlert(stock.item_id)}>Tampilkan lagi</button></div>)}</section>}
        {stocks.some(s=>alertState[s.item_id]==='noted') && <section className="panel noted-summary-panel"><div className="panel-heading"><div><h3>Stok yang sudah di-noted</h3><p>{stocks.filter(s=>alertState[s.item_id]==='noted').length} jenis material dan alat ditandai untuk informasi grup.</p></div><button className="button dark-action" onClick={()=>setShowNotedDetails(true)}><Eye size={15}/>Detail stok</button></div><p className="hint">Ringkasan stok yang dapat dibagikan kepada grup tersedia dalam satu tampilan.</p></section>}
        <section className="panel"><div className="panel-heading"><div><h3>Ringkasan Persediaan</h3><p>{totalStockKinds} jenis barang memiliki stok tersedia</p></div><button className="button dark-action" onClick={() => setPage('Stok Gudang')}>Lihat stok</button></div><div className="table"><table><thead><tr><th>KODE</th><th>NAMA BARANG</th><th>KATEGORI</th><th>STOK TERSEDIA</th><th>SISA (%)</th><th>SATUAN</th></tr></thead><tbody>{stocksWithPercent.slice(0, 8).map(s => <tr key={s.item_id} className="stock-click-row" onClick={()=>{setMovementView('current');setSelectedStock(s.item_id);}}><td>{s.code}</td><td>{s.name}</td><td>{s.category}</td><td><b className={Number(s.stock) < 0 ? 'negative' : ''}>{formatNumber(Number(s.stock))}</b></td><td><span className={`percent-chip ${s.percent <= 30 ? 'percent-red' : s.percent <= 69 ? 'percent-yellow' : 'percent-green'}`}>{formatPercent(s.percent)}</span></td><td>{s.unit}</td></tr>)}</tbody></table>{!stocks.length && <p className="empty">Belum ada data persediaan.</p>}</div></section>
        <section className="panel"><h3>Akses Cepat</h3><div className="quick">{visibleMenus.slice(1).map(([name, Icon]) => <button key={name} onClick={() => setPage(name)}><Icon/>{name}</button>)}</div></section>
      </>}
      {page === 'Kode Material & Alat' && <section className="panel"><div className="panel-heading"><div><h3>Master Material & Alat</h3><p>Kelola kode, nama, kategori, dan satuan barang.</p></div>{isAdmin && <button className="button primary" onClick={() => openItemModal()}><Plus size={16}/>Tambah Barang</button>}</div><div className="searchbar"><Search size={17}/><input placeholder="Cari kode/nama barang..." value={search} onChange={e => setSearch(e.target.value)}/></div><div className="table"><table><thead><tr><th>KODE</th><th>NAMA BARANG</th><th>KATEGORI</th><th>SATUAN</th><th>STATUS</th>{isAdmin && <th>AKSI</th>}</tr></thead><tbody>{shownItems.map(item => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.category}</td><td>{item.unit}</td><td><span className={item.is_active && (item.unit || '').trim() ? 'status active-status' : 'status'}>{(item.unit || '').trim() ? 'Aktif' : 'Tidak Aktif'}</span></td>{isAdmin && <td><div className="actions"><button title="Edit" onClick={() => openItemModal(item)}><Pencil size={15}/></button></div></td>}</tr>)}</tbody></table>{!shownItems.length && <p className="empty">Belum ada data barang. Tambahkan master barang terlebih dahulu.</p>}</div></section>}
      {(page === 'Barang Masuk' || page === 'Barang Keluar') && <section className="panel"><div className="panel-heading"><div><h3>Riwayat {page}</h3><p>Satu transaksi dapat memuat beberapa jenis barang sekaligus.</p></div>{isAdmin && <button className="button primary" onClick={() => startTransaction(page === 'Barang Masuk' ? 'incoming' : 'outgoing')}><Plus size={16}/>Tambah {page}</button>}</div><div className="table"><table><thead><tr><th>NO. TRANSAKSI</th><th>TANGGAL</th>{page === 'Barang Masuk' && <th>DRIVER</th>}<th>CATATAN</th></tr></thead><tbody>{(page === 'Barang Masuk' ? incoming : outgoing).map(t => <tr key={t.id}><td><b>{t.transaction_no}</b></td><td>{t.transaction_date}</td>{page === 'Barang Masuk' && <td>{t.driver_name || '—'}</td>}<td>{t.notes || '—'}</td></tr>)}</tbody></table>{!(page === 'Barang Masuk' ? incoming : outgoing).length && <p className="empty">Belum ada transaksi.</p>}</div></section>}
      {page === 'Stok Gudang' && <section className="panel"><div className="panel-heading"><div><h3>Persediaan Gudang</h3><p>Persentase 100% dimulai dari total penambahan stok; pengeluaran mengurangi persentase.</p></div>{isAdmin && <button className="button primary" onClick={() => { setAdjustForm({ item_id: '', direction: 'IN', quantity: '', date: today(), notes: '' }); setModal('adjust'); }}><RefreshCw size={16}/>Koreksi Stok</button>}</div><div className="searchbar"><Search size={17}/><input placeholder="Cari kode/nama barang..." value={search} onChange={e => setSearch(e.target.value)}/></div><div className="table"><table><thead><tr><th>KODE</th><th>NAMA BARANG</th><th>KATEGORI</th><th>STOK TERSEDIA</th><th>SISA (%)</th><th>SATUAN</th></tr></thead><tbody>{stocksWithPercent.filter(s => `${s.code} ${s.name}`.toLowerCase().includes(search.toLowerCase())).map(s => <tr key={s.item_id} className="stock-click-row" onClick={()=>{setMovementView('current');setSelectedStock(s.item_id);}}><td>{s.code}</td><td>{s.name}</td><td>{s.category}</td><td><b className={Number(s.stock) < 0 ? 'negative' : ''}>{formatNumber(Number(s.stock))}</b></td><td><span className={`percent-chip ${s.percent <= 30 ? 'percent-red' : s.percent <= 69 ? 'percent-yellow' : 'percent-green'}`}>{formatPercent(s.percent)}</span></td><td>{s.unit}</td></tr>)}</tbody></table>{!stocks.length && <p className="empty">Belum ada data stok.</p>}</div></section>}
      {page === 'Monitoring' && <section className="panel"><div className="panel-heading"><div><h3>Monitoring Barang Masuk & Keluar</h3><p>Pilih bulan untuk melihat aktivitas dalam 5 periode mingguan (masing-masing 7 hari, periode terakhir menyesuaikan akhir bulan).</p></div><label className="month-filter">Pilih bulan<input type="month" value={monitorMonth} onChange={e => setMonitorMonth(e.target.value)}/></label></div>{monthPeriods.map(period => { const periodIn = incoming.filter(t => t.transaction_date >= period.start && t.transaction_date <= period.end); const periodOut = outgoing.filter(t => t.transaction_date >= period.start && t.transaction_date <= period.end); return <article className="monitor-period" key={period.number}><div className="period-head"><div><b>Periode {period.number}</b><small>{period.label}</small></div><div className="period-counts"><span className="in-count">Masuk: {periodIn.length}</span><span className="out-count">Keluar: {periodOut.length}</span></div></div><div className="monitor-columns"><div><h4><ArrowDownToLine size={16}/> Barang Masuk</h4>{periodIn.length ? periodIn.map(t => <button type="button" className="monitor-transaction monitor-click" key={t.id} onClick={() => setSelectedMonitor({kind:'incoming',id:t.id})}><b>{t.transaction_no}</b><small>{t.transaction_date} · {t.driver_name || 'Driver tidak dicantumkan'}</small><ul>{incomingLines.filter(line => line.transaction_id === t.id).map((line, i) => { const item = Array.isArray(line.items) ? line.items[0] : line.items; return <li key={`${line.item_id}-${i}`}>{item?.name || 'Barang'}: {formatNumber(Number(line.quantity))} {line.unit}</li>; })}</ul>{t.notes && <small>Catatan: {t.notes}</small>}</button>) : <p className="empty small-empty">Tidak ada barang masuk.</p>}</div><div><h4><ArrowUpFromLine size={16}/> Barang Keluar</h4>{periodOut.length ? periodOut.map(t => <button type="button" className="monitor-transaction monitor-click" key={t.id} onClick={() => setSelectedMonitor({kind:'outgoing',id:t.id})}><b>{t.transaction_no}</b><small>{t.transaction_date}</small><ul>{outgoingLines.filter(line => line.transaction_id === t.id).map((line, i) => { const item = Array.isArray(line.items) ? line.items[0] : line.items; return <li key={`${line.item_id}-${i}`}>{item?.name || 'Barang'}: {formatNumber(Number(line.quantity))} {line.unit}</li>; })}</ul>{t.notes && <small>Catatan: {t.notes}</small>}</button>) : <p className="empty small-empty">Tidak ada barang keluar.</p>}</div></div></article>; })}<p className="hint">Monitoring menggunakan tanggal transaksi. Data yang ditampilkan mengikuti transaksi yang berhasil dimuat dari database.</p></section>}
      {page === 'Dokumentasi' && <section className="panel"><div className="panel-heading"><div><h3>Dokumentasi Barang Masuk</h3><p>Arsip dikelompokkan per transaksi. Klik arsip untuk membuka seluruh foto.</p></div><label className="month-filter">Pilih bulan<input type="month" value={documentationMonth} onChange={e => setDocumentationMonth(e.target.value)}/></label></div>{documentationGroups.length ? <div className="doc-archive-list">{documentationGroups.map(group=><button className="doc-archive" key={group.transactionId} onClick={()=>openDocumentation(group)}><div className="doc-archive-head"><div><b>{group.date} · {group.transactionNo}</b><small>Driver: {group.driver || 'Belum dicantumkan'}</small><small>Catatan: {group.notes || 'Tidak ada catatan'}</small></div><span>{group.photos.length} foto <ChevronDown size={16}/></span></div><div className="doc-thumb-row">{group.photos.slice(0,4).map(photo=><DocThumb key={photo.id} photo={photo} getSignedPhoto={getSignedPhoto}/>)}{group.photos.length>4&&<span className="doc-more">+{group.photos.length-4}</span>}</div></button>)}</div> : <div className="empty"><ImageIcon size={32}/><p>Tidak ada arsip dokumentasi pada bulan ini.</p></div>}</section>}
      {page === 'Rencana Barang' && <section className="panel plan-panel">
        <div className="section-head"><div><h2>Rencana Barang</h2><p>Pantau kebutuhan material dan realisasi Barang Masuk.</p></div><span className="plan-count">{materialPlans.length} Material</span></div>
        {isAdmin && <form className="plan-form" onSubmit={addMaterialPlan}>
          <div className="plan-field"><label>Nama material</label><select value={planItemId} onChange={e => { setPlanItemId(e.target.value); const found = items.find(item => item.id === e.target.value); setPlanUnit(found?.unit || ''); }} required><option value="">Pilih material</option>{activeItems.filter(item => item.category === 'MATERIAL' && !materialPlans.some(plan => plan.item_id === item.id)).map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></div>
          <div className="plan-field"><label>Jumlah rencana</label><input type="number" min="0.001" step="0.001" value={planQuantity} onChange={e => setPlanQuantity(e.target.value)} placeholder="Masukkan jumlah" required /></div>
          <div className="plan-field"><label>Satuan</label><input value={planUnit} onChange={e => setPlanUnit(e.target.value)} placeholder="Contoh: sak, m³, batang" /></div>
          <button className="button primary" type="submit" disabled={planSaving}>{planSaving ? 'Menyimpan...' : <><Plus size={15}/> Tambah Rencana</>}</button>
        </form>}
        {materialPlans.length ? <div className="plan-list">{materialPlans.map(plan => {
          const item = items.find(entry => entry.id === plan.item_id);
          const progress = planProgress(plan);
          return <article className="plan-row" key={plan.id}>
            <div className="plan-name"><strong>{item?.name || 'Material tidak ditemukan'}</strong><small>{item?.code || '—'}</small></div>
            <div className="plan-progress"><div className="plan-progress-meta"><span>{`${progress.percent.toFixed(2)}%`} terpenuhi</span><small>{formatNumber(progress.received)} / {formatNumber(plan.planned_quantity)} {plan.unit}</small></div><div className="plan-track"><i style={{width: `${Math.min(100, Math.max(0, progress.percent))}%`}} /></div></div>
            <div className="plan-remaining"><small>Sisa</small><strong>{formatNumber(progress.remaining)} <small>{plan.unit}</small></strong></div>
            {isAdmin && <button className="plan-remove" title="Hapus dari Rencana Barang" aria-label={`Hapus ${item?.name || 'material'} dari rencana`} onClick={() => void deleteMaterialPlan(plan)}><X size={17}/></button>}
          </article>;
        })}</div> : <div className="empty"><Package size={30}/><p>Belum ada material dalam Rencana Barang.</p><small>Tambahkan material untuk mulai memantau kebutuhan dan realisasinya.</small></div>}
      </section>}
      <footer>© {new Date().getFullYear()} BELIA-BAYA</footer>
    </main>

    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null); }}><div className="modal"><div className="modal-head"><div><h3>{modal === 'item' ? (editingItem ? 'Edit Master Barang' : 'Tambah Master Barang') : modal === 'incoming' ? 'Tambah Barang Masuk' : modal === 'outgoing' ? 'Tambah Barang Keluar' : 'Koreksi Stok Gudang'}</h3><p>Lengkapi informasi berikut sebelum menyimpan.</p></div><button className="icon-button" onClick={() => setModal(null)}><X/></button></div>
      {modal === 'item' && <form onSubmit={saveItem} className="form-grid"><label>Kode barang<input value={itemForm.code} onChange={e => setItemForm({ ...itemForm, code: e.target.value })} placeholder="Contoh: 1005" required/></label><label>Nama barang<input value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Contoh: Semen" required/></label><label>Kategori<select value={itemForm.category} onChange={e => setItemForm({ ...itemForm, category: e.target.value as 'MATERIAL' | 'ALAT' })}><option value="MATERIAL">Material</option><option value="ALAT">Alat</option></select></label><label>Satuan<input value={itemForm.unit} onChange={e => setItemForm({ ...itemForm, unit: e.target.value })} placeholder="Kosongkan untuk menonaktifkan barang"/></label><div className="form-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Batal</button><button className="button primary" disabled={busy}>Simpan</button></div></form>}
      {(modal === 'incoming' || modal === 'outgoing') && <form onSubmit={e => void saveTransaction(e, modal)} className="form-grid"><label>Tanggal transaksi<input type="date" value={transactionForm.date} onChange={e => setTransactionForm({ ...transactionForm, date: e.target.value })} required/></label>
        {modal === 'incoming' && <><label>Supplier / pemasok<input value={transactionForm.supplier} onChange={e => setTransactionForm({ ...transactionForm, supplier: e.target.value })} placeholder="Nama supplier"/></label><label>Nama driver<input value={transactionForm.driver_name} onChange={e => setTransactionForm({ ...transactionForm, driver_name: e.target.value })} placeholder="Nama driver"/></label><label>Nomor kendaraan (opsional)<input value={transactionForm.vehicle_no} onChange={e => setTransactionForm({ ...transactionForm, vehicle_no: e.target.value })} placeholder="Nomor kendaraan"/></label></>}
        <div className="line-editor"><div className="line-heading"><strong>Daftar barang</strong><button type="button" className="button secondary small" onClick={() => setLines(old => [...old, emptyLine()])}><Plus size={14}/>Tambah barang</button></div>{lines.map((line, index) => <div className="line-row" key={index}><label>Barang<SearchableItemSelect items={activeItems} value={line.item_id} onChange={value => updateLine(index, 'item_id', value)} placeholder="Cari kode atau nama barang..." /></label><label>Jumlah<input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e => updateLine(index, 'quantity', e.target.value)} placeholder="0" required/></label><label>Satuan<input value={line.unit} readOnly placeholder="Otomatis"/></label><button type="button" className="remove-line" title="Hapus baris" disabled={lines.length === 1} onClick={() => setLines(old => old.filter((_, i) => i !== index))}><Trash2 size={16}/></button></div>)}</div>
        <label className="full">Catatan / informasi transaksi<textarea rows={2} value={transactionForm.notes} onChange={e => setTransactionForm({ ...transactionForm, notes: e.target.value })} placeholder="Keterangan tambahan..."/></label>
        {modal === 'outgoing' && <><label>Tujuan / lokasi pengiriman<input value={transactionForm.destination} onChange={e => setTransactionForm({ ...transactionForm, destination: e.target.value })} placeholder="Tujuan barang"/></label><label>Nama penerima<input value={transactionForm.receiver_name} onChange={e => setTransactionForm({ ...transactionForm, receiver_name: e.target.value })} placeholder="Nama penerima"/></label></>}
        {modal === 'incoming' && <label className="full upload-box"><span><Upload size={18}/> Upload foto nota / barang masuk</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => setPhotoFiles(Array.from(e.target.files || []))}/><small>{photoFiles.length ? `${photoFiles.length} foto dipilih: ${photoFiles.map(f => f.name).join(', ')}` : 'Bisa memilih beberapa foto sekaligus. Maksimal 10 MB per foto.'}</small></label>}
        <div className="form-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Batal</button><button className="button primary" disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Transaksi'}</button></div></form>}
      {modal === 'adjust' && <form onSubmit={saveAdjustment} className="form-grid"><label className="full">Pilih barang<SearchableItemSelect items={items} value={adjustForm.item_id} onChange={value => setAdjustForm({ ...adjustForm, item_id: value })} placeholder="Cari kode atau nama barang..." /></label><label>Jenis koreksi<select value={adjustForm.direction} onChange={e => setAdjustForm({ ...adjustForm, direction: e.target.value })}><option value="IN">Tambah stok (stok fisik lebih banyak)</option><option value="OUT">Kurangi stok (stok fisik lebih sedikit)</option></select></label><label>Jumlah koreksi<input type="number" min="0.001" step="0.001" value={adjustForm.quantity} onChange={e => setAdjustForm({ ...adjustForm, quantity: e.target.value })} required/></label><label>Tanggal koreksi<input type="date" value={adjustForm.date} onChange={e => setAdjustForm({ ...adjustForm, date: e.target.value })} required/></label><label className="full">Alasan koreksi<textarea rows={3} value={adjustForm.notes} onChange={e => setAdjustForm({ ...adjustForm, notes: e.target.value })} placeholder="Contoh: koreksi hasil stock opname..." required/></label><div className="form-actions"><button type="button" className="button secondary" onClick={() => setModal(null)}>Batal</button><button className="button primary" disabled={busy}>Simpan Koreksi</button></div></form>}
    </div></div>}
    {showNotedDetails && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowNotedDetails(false);}}><div className="modal stock-detail-modal"><div className="modal-head"><div><h3>Detail Stok untuk Grup</h3><p>Gabungan seluruh material dan alat yang sudah di-noted.</p></div><button className="icon-button" onClick={()=>setShowNotedDetails(false)}><X/></button></div><div className="table noted-detail-table"><table><thead><tr><th>NO.</th><th>KODE MATERIAL</th><th>NAMA MATERIAL / ALAT</th><th>SATUAN</th><th>SISA STOK</th><th>SISA (%)</th><th>AKSI</th></tr></thead><tbody>{stocksWithPercent.filter(s=>alertState[s.item_id]==='noted').sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})).map((s,index)=><tr key={s.item_id}><td>{index+1}</td><td><b>{s.code}</b></td><td>{s.name}</td><td>{s.unit||'—'}</td><td>{formatNumber(Number(s.stock))}</td><td><span className={`percent-chip ${s.percent<=30?'percent-red':s.percent<=69?'percent-yellow':'percent-green'}`}>{formatPercent(s.percent)}</span></td><td><button type="button" className="icon-button" title="Hapus permanen dari daftar Detail Stok untuk Grup" aria-label={`Hapus ${s.name} dari daftar Detail Stok untuk Grup`} onClick={()=>dismissNotedAlert(s.item_id)}><X size={17}/></button></td></tr>)}</tbody></table>{!stocksWithPercent.some(s=>alertState[s.item_id]==='noted')&&<p className="empty">Belum ada stok yang di-noted.</p>}</div><div className="form-actions"><button className="button dark-action" onClick={()=>setShowNotedDetails(false)}>Tutup</button></div></div></div>}
    {selectedStockData && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedStock(null);}}><div className="modal stock-detail-modal"><div className="modal-head"><div><h3>Detail Pergerakan Stok</h3><p>{selectedStockData.code} · {selectedStockData.name}</p></div><button className="icon-button" onClick={()=>setSelectedStock(null)}><X/></button></div><div className="movement-view-switch" role="group" aria-label="Pilihan ringkasan pergerakan stok"><button type="button" className={movementView==='current'?'active':''} onClick={()=>setMovementView('current')}>Total sekarang</button><button type="button" className={movementView==='all'?'active':''} onClick={()=>setMovementView('all')}>Total keseluruhan</button></div>{movementView==='current' ? <><div className="stock-detail-stats current-stock-stats"><article><small>Stok tersedia sekarang</small><b>{formatNumber(Number(selectedStockData.stock))} {selectedStockData.unit}</b></article><article><small>Sisa dari dasar 100%</small><b>{formatPercent(selectedStockData.percent)}</b></article></div><p className="hint">Tampilan ringkas kondisi stok terakhir. Pilih <b>Total keseluruhan</b> untuk melihat akumulasi barang masuk, barang keluar, dan seluruh riwayat pergerakan.</p></> : <><div className="stock-detail-stats"><article><small>Stok tersedia sekarang</small><b>{formatNumber(Number(selectedStockData.stock))} {selectedStockData.unit}</b></article><article><small>Total barang masuk</small><b>{formatNumber(Number(selectedStockData.incoming_total))} {selectedStockData.unit}</b></article><article><small>Total barang keluar</small><b>{formatNumber(Number(selectedStockData.outgoing_total))} {selectedStockData.unit}</b></article><article><small>Persentase tersisa</small><b>{formatPercent(selectedStockData.percent)}</b></article></div><h4>Seluruh riwayat pergerakan stok</h4><div className="table"><table><thead><tr><th>TANGGAL</th><th>JENIS</th><th>JUMLAH</th><th>CATATAN</th></tr></thead><tbody>{selectedStockMovements.map(m=><tr key={m.id}><td>{m.transaction_date}</td><td>{m.movement_type==='IN'?'Barang Masuk':m.movement_type==='OUT'?'Barang Keluar':m.movement_type==='OPENING'?'Stok Awal':'Reversal'}</td><td>{m.movement_type==='OUT'||m.movement_type==='REVERSAL'?'-':''}{formatNumber(Number(m.quantity))} {selectedStockData.unit}</td><td>{m.notes||'—'}</td></tr>)}</tbody></table>{!selectedStockMovements.length&&<p className="empty">Belum ada riwayat pergerakan stok.</p>}</div></>}</div></div>}
    {selectedDoc && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedDoc(null);}}><div className="modal doc-modal"><div className="modal-head"><div><h3>Detail Dokumentasi</h3><p>Kelola catatan, driver, dan foto dalam satu arsip.</p></div><button className="icon-button" onClick={()=>setSelectedDoc(null)}><X/></button></div><div className="form-grid"><label>Tanggal dokumentasi<input type="date" value={docEditDate} onChange={e=>setDocEditDate(e.target.value)}/></label><label>Nama driver<input value={docEditDriver} onChange={e=>setDocEditDriver(e.target.value)}/></label><label className="full">Catatan / informasi<textarea rows={3} value={docEditNotes} onChange={e=>setDocEditNotes(e.target.value)}/></label><label className="full upload-box"><span><Upload size={17}/> Tambah beberapa foto</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setDocAddFiles(Array.from(e.target.files||[]))}/><small>{docAddFiles.length} foto dipilih</small></label><div className="doc-detail-grid full">{photos.filter(p=>{const tx=Array.isArray(p.incoming_transactions)?p.incoming_transactions[0]:p.incoming_transactions;return tx?.id===selectedDoc;}).map(p=><DocDetailPhoto key={p.id} photo={p} getSignedPhoto={getSignedPhoto} onDownload={()=>void downloadPhoto(p.storage_path, p.storage_path.split('/').pop()||'dokumentasi.jpg')} onDelete={()=>void deleteDocumentationPhoto(p)}/>)}</div><div className="form-actions"><button className="button secondary" onClick={()=>setSelectedDoc(null)}>Tutup</button>{isAdmin&&<button className="button secondary" onClick={()=>void deleteDocumentationArchive()}>Hapus arsip foto</button>}{isAdmin&&<button className="button dark-action" disabled={busy} onClick={()=>void saveDocumentation()}>{busy?'Menyimpan...':'Simpan Perubahan'}</button>}</div></div></div></div>}
    {selectedMonitor && (()=>{const tx=(selectedMonitor.kind==='incoming'?incoming:outgoing).find(t=>t.id===selectedMonitor.id);const detailLines=(selectedMonitor.kind==='incoming'?incomingLines:outgoingLines).filter(l=>l.transaction_id===selectedMonitor.id);return tx?<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedMonitor(null);}}><div className="modal"><div className="modal-head"><div><h3>Detail {selectedMonitor.kind==='incoming'?'Barang Masuk':'Barang Keluar'}</h3><p>{tx.transaction_no} · {tx.transaction_date}</p></div><button className="icon-button" onClick={()=>setSelectedMonitor(null)}><X/></button></div>{selectedMonitor.kind==='incoming' ? <><p><b>Supplier:</b> {tx.supplier||'Tidak dicantumkan'}</p><p><b>Driver:</b> {tx.driver_name||'Tidak dicantumkan'}</p><p><b>Nomor kendaraan:</b> {tx.vehicle_no||'—'}</p></> : <><p><b>Tujuan:</b> {tx.destination||'Tidak dicantumkan'}</p><p><b>Penerima:</b> {tx.receiver_name||'Tidak dicantumkan'}</p></>}<p><b>Catatan:</b> {tx.notes||'Tidak ada catatan'}</p><div className="table"><table><thead><tr><th>Barang</th><th>Jumlah</th><th>Satuan</th></tr></thead><tbody>{detailLines.map((l,i)=>{const it=Array.isArray(l.items)?l.items[0]:l.items;return <tr key={i}><td>{it?.code} — {it?.name}</td><td>{formatNumber(Number(l.quantity))}</td><td>{l.unit}</td></tr>;})}</tbody></table></div><div className="form-actions"><button className="button dark-action" onClick={()=>setSelectedMonitor(null)}>Tutup</button></div></div></div>:null;})()}
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
  const filtered = items.filter(item=>`${item.code} ${item.name}`.toLocaleLowerCase('id-ID').includes(query.toLocaleLowerCase('id-ID'))).slice(0,100);
  return <div className="item-search-select">
    <div className="item-search-input"><Search size={15}/><input type="text" value={query} placeholder={placeholder} autoComplete="off" onFocus={()=>{setOpen(true);setQuery('');}} onChange={e=>{setQuery(e.target.value);onChange('');setOpen(true);}} onBlur={()=>window.setTimeout(()=>setOpen(false),140)} aria-label="Cari barang berdasarkan kode atau nama"/><ChevronDown size={15}/></div>
    {open && <div className="item-search-options">{filtered.length ? filtered.map(item=><button type="button" key={item.id} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(item.id);setQuery(`${item.code} — ${item.name}`);setOpen(false);}}><b>{item.code}</b><span>{item.name}</span><small>{item.unit||'Tanpa satuan'}</small></button>) : <p>Tidak ada barang yang cocok.</p>}</div>}
  </div>;
}
