'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BACKEND_URL = 'https://waterrrrrr.onrender.com';

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
// Paste your Supabase project URL here (found in Settings → API)
const SUPABASE_URL = "https://dqhyxprjdsxhikuojhpk.supabase.co";
// Paste your Supabase PUBLISHABLE (anon) key here — this is safe to expose in frontend code.
// ⚠️ NEVER paste service_role, sb_secret, database password, or JWT secret here!
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_AWEaIC1zGa2WRJuSg8WqfA_1_HzHZIT";

// Create the Supabase client using the CDN-provided global `supabase` object
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ─── STATE ────────────────────────────────────────────────────────────────────
let capturedImageURL = '';
let capturedBlob = null;
let selectedCondition = '';
let selectedPeriod = '';
let cameraStream = null;
let facingMode = 'environment';
// Cache dashboard records so filters work synchronously after initial load
let _dashboardRecords = [];

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function goTo(screenId) {
    const current = document.querySelector('.screen.active');
    const next = document.getElementById(screenId);
    if (!next || next === current) return;
    if (current) { current.classList.remove('active'); current.style.display = ''; }
    next.style.display = 'flex';
    next.getBoundingClientRect();
    next.classList.add('active');
    next.scrollTop = 0;
    if (screenId === 'screen-home') { stopCamera(); updateHomeStats(); }
    else if (screenId === 'screen-camera') { startCamera(); }
    else if (screenId === 'screen-dashboard') { stopCamera(); renderDashboard(); }
    else if (screenId === 'screen-ocr') { stopCamera(); setupOcrScreen(); }
    else if (screenId === 'screen-success') { stopCamera(); }
}

// ─── HOME STATS (Supabase) ────────────────────────────────────────────────────
async function updateHomeStats() {
    const els = { today: document.getElementById('home-today-count'), abnormal: document.getElementById('home-abnormal-count'), total: document.getElementById('home-total-count') };
    Object.values(els).forEach(e => { e.textContent = '–'; });
    try {
        const todayISO = new Date().toISOString().slice(0, 10);
        const [totalRes, abnormalRes, todayRes] = await Promise.all([
            supabaseClient.from('meter_records').select('id', { count: 'exact', head: true }),
            supabaseClient.from('meter_records').select('id', { count: 'exact', head: true }).neq('meter_condition', 'สภาพปกติ'),
            supabaseClient.from('meter_records').select('id', { count: 'exact', head: true }).gte('created_at', todayISO + 'T00:00:00').lte('created_at', todayISO + 'T23:59:59')
        ]);
        els.total.textContent = totalRes.count ?? 0;
        els.abnormal.textContent = abnormalRes.count ?? 0;
        els.today.textContent = todayRes.count ?? 0;
    } catch (e) {
        console.error('updateHomeStats error:', e);
        Object.values(els).forEach(el => { el.textContent = '0'; });
    }
}

// ─── CAMERA ───────────────────────────────────────────────────────────────────
async function startCamera() {
    stopCamera();
    const video = document.getElementById('camera-video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        cameraStream = stream;
        video.srcObject = stream;
    } catch {
        const vf = document.getElementById('camera-viewfinder');
        if (!vf.querySelector('.cam-err')) {
            const d = document.createElement('div');
            d.className = 'cam-err';
            d.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,.75);font-size:14px;text-align:center;gap:12px;z-index:6;padding:24px;';
            d.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="white" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="13" r="4" stroke="white" stroke-width="1.5"/><line x1="2" y1="2" x2="22" y2="22" stroke="#EF4444" stroke-width="1.5"/></svg><span>ไม่สามารถเข้าถึงกล้องได้<br>กรุณาเลือกรูปจากแกลเลอรีแทน</span>';
            vf.appendChild(d);
        }
        document.getElementById('btn-capture').disabled = true;
    }
}

function stopCamera() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    document.getElementById('camera-video').srcObject = null;
}

function switchCamera() { facingMode = facingMode === 'environment' ? 'user' : 'environment'; startCamera(); }

function capturePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    if (!cameraStream || !video.videoWidth) {
        capturedImageURL = ''; capturedBlob = null; goTo('screen-ocr'); uploadAndOcr(null); return;
    }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    capturedImageURL = canvas.toDataURL('image/jpeg', 0.9);
    canvas.toBlob(blob => { capturedBlob = blob; goTo('screen-ocr'); uploadAndOcr(blob); }, 'image/jpeg', 0.9);
}

function handleGalleryImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    capturedBlob = file;
    const reader = new FileReader();
    reader.onload = e => { capturedImageURL = e.target.result; goTo('screen-ocr'); uploadAndOcr(file); };
    reader.readAsDataURL(file);
    event.target.value = '';
}

// ─── REAL OCR — FastAPI + OpenAI Vision ───────────────────────────────────────
async function uploadAndOcr(blob) {
    const display = document.getElementById('ocr-reading-text');
    display.classList.add('loading'); display.textContent = 'กำลังอ่าน...';
    document.getElementById('f-reading').value = '';
    hideOcrToast();
    if (!blob) { display.classList.remove('loading'); display.textContent = '--'; return; }
    try {
        const form = new FormData(); form.append('file', blob, 'meter.jpg');
        const res = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: form });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || `HTTP ${res.status}`); }
        const data = await res.json();
        display.classList.remove('loading');
        if (!data.meter || data.meter === 'error') {
            display.textContent = '--';
            showOcrToast('AI อ่านค่าไม่ได้ — กรุณาพิมพ์เองหรือถ่ายใหม่');
        } else {
            display.textContent = data.meter;
            document.getElementById('f-reading').value = data.meter;
        }
    } catch (e) {
        console.error("DEBUG OCR ERROR:", e);
        display.classList.remove('loading'); display.textContent = '--';
        if (e.message.toLowerCase().includes('fetch') || e.message.toLowerCase().includes('failed')) {
            showOcrToast('ไม่สามารถเชื่อมต่อ AI ได้ — กรุณาพิมพ์ค่าเอง');
        } else { showOcrToast(`เกิดข้อผิดพลาด: ${e.message}`); }
    }
}

function showOcrToast(msg) {
    let t = document.getElementById('ocr-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ocr-toast'; t.className = 'ocr-toast'; document.querySelector('.ocr-reading-card').appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
}
function hideOcrToast() { const t = document.getElementById('ocr-toast'); if (t) t.style.display = 'none'; }

// ─── OCR SCREEN SETUP ─────────────────────────────────────────────────────────
function setupOcrScreen() {
    const preview = document.getElementById('ocr-preview');
    const card = document.querySelector('.ocr-image-card');
    const ph = card.querySelector('.no-img-ph');
    if (capturedImageURL) { preview.src = capturedImageURL; preview.style.display = 'block'; if (ph) ph.remove(); }
    else {
        preview.style.display = 'none';
        if (!ph) {
            const el = document.createElement('div'); el.className = 'no-img-ph';
            el.style.cssText = 'padding:40px;text-align:center;color:#64748B;font-size:14px;';
            el.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" style="margin:0 auto 8px;display:block"><rect x="3" y="3" width="18" height="18" rx="2" stroke="#CBD5E1" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="#CBD5E1"/><path d="M21 15l-5-5L5 21" stroke="#CBD5E1" stroke-width="2" stroke-linecap="round"/></svg>ตัวอย่างรูปมิเตอร์';
            card.insertBefore(el, card.querySelector('.retake-btn'));
        }
    }
    document.getElementById('f-date').value = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
    document.getElementById('f-meter-id').value = '';
    document.getElementById('f-reading').value = '';
    document.getElementById('f-notes').value = '';
    document.getElementById('ocr-reading-text').textContent = '--';
    document.getElementById('ocr-reading-text').classList.remove('loading');
    selectedCondition = ''; selectedPeriod = '';
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected', 'warning'));
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('f-location-main').value = '';
    document.getElementById('f-location-floor').value = '';
    document.getElementById('f-location-custom').value = '';
    document.getElementById('location-floor-group').style.display = 'none';
    document.getElementById('location-custom-group').style.display = 'none';
    document.getElementById('save-error').style.display = 'none';
    hideOcrToast();
}

// ─── LOCATION SELECTION ───────────────────────────────────────────────────────
const BUILDING_OPTIONS = ['อาคาร A', 'อาคาร B', 'อาคาร C', 'อาคาร D'];
function onLocationMainChange() {
    const v = document.getElementById('f-location-main').value;
    const floorG = document.getElementById('location-floor-group');
    const customG = document.getElementById('location-custom-group');
    floorG.style.display = BUILDING_OPTIONS.includes(v) ? 'block' : 'none';
    customG.style.display = v === 'อื่น ๆ' ? 'block' : 'none';
    if (!BUILDING_OPTIONS.includes(v)) document.getElementById('f-location-floor').value = '';
    if (v !== 'อื่น ๆ') document.getElementById('f-location-custom').value = '';
    document.getElementById('save-error').style.display = 'none';
}
function getLocationName() {
    const main = document.getElementById('f-location-main').value;
    if (!main) return '';
    if (BUILDING_OPTIONS.includes(main)) {
        const floor = document.getElementById('f-location-floor').value;
        return floor ? `${main} - ${floor}` : '';
    }
    if (main === 'อื่น ๆ') return document.getElementById('f-location-custom').value.trim();
    return main;
}

// ─── CHIP & PERIOD ────────────────────────────────────────────────────────────
const WARN_CONDITIONS = ['หน้าปัดแตก', 'น้ำรั่ว', 'ตัวเลขมองไม่ชัด', 'ฝาครอบชำรุด', 'อื่น ๆ'];
function selectChip(el, group) {
    if (group === 'condition') {
        document.querySelectorAll('#condition-chips .chip').forEach(c => c.classList.remove('selected', 'warning'));
        el.classList.add('selected');
        if (WARN_CONDITIONS.includes(el.dataset.value)) el.classList.add('warning');
        selectedCondition = el.dataset.value;
    }
    document.getElementById('save-error').style.display = 'none';
}
function selectPeriod(el) {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('selected'));
    el.classList.add('selected'); selectedPeriod = el.dataset.value;
    document.getElementById('save-error').style.display = 'none';
}

// ─── GLOBAL TOAST ─────────────────────────────────────────────────────────────
function showGlobalToast(msg, type = 'error') {
    let t = document.getElementById('global-toast');
    if (!t) { t = document.createElement('div'); t.id = 'global-toast'; document.body.appendChild(t); }
    t.className = `global-toast global-toast-${type}`;
    t.textContent = msg; t.style.display = 'block';
    setTimeout(() => { t.style.display = 'none'; }, 5000);
}

// ─── SAVE (Supabase) ──────────────────────────────────────────────────────────
async function saveRecord() {
    const errEl = document.getElementById('save-error');
    const meterId = document.getElementById('f-meter-id').value.trim();
    const readingVal = document.getElementById('f-reading').value.trim();
    const locationName = getLocationName();
    const mainLoc = document.getElementById('f-location-main').value;
    let errMsg = '';
    if (!readingVal) errMsg = '⚠️ กรุณากรอกค่าที่อ่านได้';
    else if (!mainLoc) errMsg = '⚠️ กรุณาเลือกพื้นที่ / จุดติดตั้ง';
    else if (BUILDING_OPTIONS.includes(mainLoc) && !document.getElementById('f-location-floor').value) errMsg = '⚠️ กรุณาเลือกชั้น';
    else if (mainLoc === 'อื่น ๆ' && !locationName) errMsg = '⚠️ กรุณาระบุพื้นที่อื่น ๆ';
    else if (!selectedCondition) errMsg = '⚠️ กรุณาเลือกสภาพมิเตอร์';
    else if (!selectedPeriod) errMsg = '⚠️ กรุณาเลือกช่วงเวลา';
    if (errMsg) {
        errEl.textContent = errMsg; errEl.style.display = 'block'; errEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }

    // Show loading state on save button
    const saveBtn = document.querySelector('.btn-save');
    const origHTML = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="save-spinner"></span> กำลังบันทึก...';

    let imageUrl = '';
    let imageWarning = false;

    // 1) Upload image to Supabase Storage
    if (capturedBlob) {
        try {
            const fileName = `meter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            const { data: uploadData, error: uploadError } = await supabaseClient.storage
                .from('meter-images')
                .upload(fileName, capturedBlob, { contentType: 'image/jpeg', upsert: false });

            if (uploadError) throw uploadError;

            // Get the public URL for the uploaded image
            const { data: urlData } = supabaseClient.storage
                .from('meter-images')
                .getPublicUrl(uploadData.path);
            imageUrl = urlData.publicUrl;
        } catch (e) {
            console.error('Image upload failed:', e);
            imageWarning = true;
            // Continue saving without image — show warning later
        }
    }

    // 2) Insert record into Supabase database
    const now = new Date();
    const record = {
        meter_id: meterId || '',
        reading_value: readingVal || '--',
        image_url: imageUrl,
        meter_condition: selectedCondition,
        time_period: selectedPeriod,
        inspector_name: document.getElementById('f-inspector').value,
        notes: document.getElementById('f-notes').value.trim(),
        status: selectedCondition === 'สภาพปกติ' ? 'ตรวจสอบแล้ว' : 'รอตรวจสอบ',
        ai_raw_response: document.getElementById('ocr-reading-text').textContent || null,
        ai_confidence: null,
        location_name: locationName,
        created_at: now.toISOString()
    };

    try {
        const { data, error } = await supabaseClient
            .from('meter_records')
            .insert(record)
            .select()
            .single();

        if (error) throw error;

        // Restore save button
        saveBtn.disabled = false;
        saveBtn.innerHTML = origHTML;

        if (imageWarning) {
            showGlobalToast('⚠️ อัปโหลดรูปไม่สำเร็จ แต่ข้อมูลถูกบันทึกแล้ว', 'warning');
        }

        // Show success with formatted dates for display
        showSuccess({
            ...data,
            recorded_at: now.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        });
    } catch (e) {
        console.error('Database insert failed:', e);
        saveBtn.disabled = false;
        saveBtn.innerHTML = origHTML;
        showGlobalToast('❌ บันทึกข้อมูลไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง');
    }
}

// ─── SUCCESS ──────────────────────────────────────────────────────────────────
function showSuccess(rec) {
    const condClass = rec.meter_condition === 'สภาพปกติ' ? 'record-condition-normal' : 'record-condition-warn';
    const dateDisplay = rec.recorded_at || new Date(rec.created_at).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    document.getElementById('success-summary').innerHTML = `
    <div class="success-row"><span class="success-row-label">เลขมิเตอร์</span><span class="success-row-val">${rec.meter_id || '-'}</span></div>
    <div class="success-row"><span class="success-row-label">ค่าที่อ่านได้</span><span class="success-row-val">${rec.reading_value} หน่วย</span></div>
    <div class="success-row"><span class="success-row-label">พื้นที่</span><span class="success-row-val">${rec.location_name || '-'}</span></div>
    <div class="success-row"><span class="success-row-label">สภาพมิเตอร์</span><span class="success-row-val ${condClass}">${rec.meter_condition}</span></div>
    <div class="success-row"><span class="success-row-label">ช่วงเวลา</span><span class="success-row-val">${rec.time_period}</span></div>
    <div class="success-row"><span class="success-row-label">ผู้บันทึก</span><span class="success-row-val">${rec.inspector_name}</span></div>
    <div class="success-row"><span class="success-row-label">วันที่</span><span class="success-row-val">${dateDisplay}</span></div>`;
    goTo('screen-success');
}

function startNewScan() {
    capturedImageURL = ''; capturedBlob = null; selectedCondition = ''; selectedPeriod = '';
    goTo('screen-camera');
}

// ─── DASHBOARD (Supabase) ─────────────────────────────────────────────────────
async function renderDashboard() {
    // Show loading state
    ['stat-total', 'stat-pending', 'stat-abnormal', 'stat-today'].forEach(id => {
        document.getElementById(id).textContent = '–';
    });
    document.getElementById('records-count-label').textContent = 'กำลังโหลด...';
    document.getElementById('records-list').innerHTML = '<div class="loading-skeleton"><div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div></div>';

    try {
        const todayISO = new Date().toISOString().slice(0, 10);

        // Fetch stats and records in parallel
        const [totalRes, pendingRes, abnormalRes, todayRes, recordsRes] = await Promise.all([
            supabaseClient.from('meter_records').select('id', { count: 'exact', head: true }),
            supabaseClient.from('meter_records').select('id', { count: 'exact', head: true }).eq('status', 'รอตรวจสอบ'),
            supabaseClient.from('meter_records').select('id', { count: 'exact', head: true }).neq('meter_condition', 'สภาพปกติ'),
            supabaseClient.from('meter_records').select('id', { count: 'exact', head: true }).gte('created_at', todayISO + 'T00:00:00').lte('created_at', todayISO + 'T23:59:59'),
            supabaseClient.from('meter_records').select('*').order('created_at', { ascending: false }).limit(200)
        ]);

        document.getElementById('stat-total').textContent = totalRes.count ?? 0;
        document.getElementById('stat-pending').textContent = pendingRes.count ?? 0;
        document.getElementById('stat-abnormal').textContent = abnormalRes.count ?? 0;
        document.getElementById('stat-today').textContent = todayRes.count ?? 0;

        if (recordsRes.error) throw recordsRes.error;
        _dashboardRecords = recordsRes.data || [];
        clearFilters();
    } catch (e) {
        console.error('Dashboard load error:', e);
        document.getElementById('records-list').innerHTML = '<div class="empty-state">❌ โหลดข้อมูลไม่สำเร็จ — กรุณาลองใหม่</div>';
        document.getElementById('records-count-label').textContent = 'เกิดข้อผิดพลาด';
    }
}

const KNOWN_LOCATIONS = ['อาคาร A','อาคาร B','อาคาร C','อาคาร D','อาคารหอประชุม / พื้นที่กิจกรรม','ลานจอดรถ','พื้นที่ส่วนกลาง','ห้องระบบน้ำ / ห้องเครื่อง'];
function applyFilters() {
    const mQ = document.getElementById('filter-meter').value.trim().toLowerCase();
    const pQ = document.getElementById('filter-period').value;
    const cQ = document.getElementById('filter-condition').value;
    const iQ = document.getElementById('filter-inspector').value;
    const lQ = document.getElementById('filter-location').value;
    renderRecords(_dashboardRecords.filter(r => {
        if (mQ && !(r.meter_id || '').toLowerCase().includes(mQ)) return false;
        if (pQ && r.time_period !== pQ) return false;
        if (cQ && r.meter_condition !== cQ) return false;
        if (iQ && r.inspector_name !== iQ) return false;
        if (lQ) {
            const loc = r.location_name || '';
            if (['อาคาร A','อาคาร B','อาคาร C','อาคาร D'].includes(lQ)) { if (!loc.startsWith(lQ)) return false; }
            else if (lQ === 'อื่น ๆ') { if (KNOWN_LOCATIONS.some(k => loc.startsWith(k))) return false; }
            else { if (loc !== lQ) return false; }
        }
        return true;
    }));
}

function clearFilters() {
    ['filter-meter', 'filter-period', 'filter-condition', 'filter-inspector', 'filter-location'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    renderRecords(_dashboardRecords);
}

function renderRecords(records) {
    const list = document.getElementById('records-list');
    document.getElementById('records-count-label').textContent = `แสดง ${records.length} รายการ`;
    if (!records.length) { list.innerHTML = '<div class="empty-state">🔍 ไม่พบรายการที่ค้นหา</div>'; return; }
    list.innerHTML = records.map(r => {
        const pCls = r.time_period === 'รอบเช้า' ? 'badge-period-morning' : 'badge-period-evening';
        const sCls = r.status === 'ตรวจสอบแล้ว' ? 'badge-status-ok' : r.meter_condition !== 'สภาพปกติ' ? 'badge-status-warn' : 'badge-status-pending';
        const cCls = r.meter_condition === 'สภาพปกติ' ? 'record-condition-normal' : 'record-condition-warn';
        const dateStr = r.created_at ? new Date(r.created_at).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return `<div class="record-card">
      <div class="record-top">
        <span class="record-meter-id">${r.meter_id || '-'}</span>
        <div class="record-badges">
          <span class="badge ${pCls}">${r.time_period}</span>
          <span class="badge ${sCls}">${r.status}</span>
        </div>
      </div>
      ${r.location_name ? `<div class="record-row"><span class="record-row-label">พื้นที่</span><span class="record-row-val">${r.location_name}</span></div>` : ''}
      <div class="record-row"><span class="record-row-label">ค่าที่อ่านได้</span><span class="record-row-val">${r.reading_value} หน่วย</span></div>
      <div class="record-row"><span class="record-row-label">ผู้บันทึก</span><span class="record-row-val">${r.inspector_name}</span></div>
      <div class="record-row"><span class="record-row-label">วันที่</span><span class="record-row-val">${dateStr}</span></div>
    </div>`;
    }).join('');
}

// ─── EXCEL EXPORT (Supabase) ──────────────────────────────────────────────────
async function exportExcel() {
    const btn = document.querySelector('.btn-export-sm');
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ กำลังส่งออก...';

    try {
        // Apply current filters to exported data
        const mQ = document.getElementById('filter-meter').value.trim().toLowerCase();
        const pQ = document.getElementById('filter-period').value;
        const cQ = document.getElementById('filter-condition').value;
        const iQ = document.getElementById('filter-inspector').value;

        let records = _dashboardRecords;
        if (mQ) records = records.filter(r => (r.meter_id || '').toLowerCase().includes(mQ));
        if (pQ) records = records.filter(r => r.time_period === pQ);
        if (cQ) records = records.filter(r => r.meter_condition === cQ);
        if (iQ) records = records.filter(r => r.inspector_name === iQ);

        const rows = records.map((r, i) => ({
            'ลำดับ': i + 1,
            'เลขมิเตอร์': r.meter_id,
            'ค่าที่อ่านได้': r.reading_value,
            'พื้นที่ / จุดติดตั้ง': r.location_name || '',
            'สภาพมิเตอร์': r.meter_condition,
            'ช่วงเวลา': r.time_period,
            'วันที่บันทึก': r.created_at ? new Date(r.created_at).toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
            'ผู้บันทึก': r.inspector_name,
            'หมายเหตุ': r.notes,
            'สถานะ': r.status,
            'ลิงก์รูปภาพ': r.image_url || ''
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 20 }, { wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 40 }];
        XLSX.utils.book_append_sheet(wb, ws, 'บันทึกมิเตอร์');
        XLSX.writeFile(wb, `SmartMeter_${new Date().toLocaleDateString('th-TH').replace(/\//g, '-')}.xlsx`);
    } catch (e) {
        console.error('Export error:', e);
        showGlobalToast('❌ ส่งออกไฟล์ไม่สำเร็จ — กรุณาลองใหม่');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHTML;
    }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateHomeStats();
    document.querySelectorAll('.screen').forEach(s => { s.style.display = ''; s.classList.remove('active'); });
    const home = document.getElementById('screen-home');
    home.style.display = 'flex';
    home.classList.add('active');
});
