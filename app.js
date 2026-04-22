'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BACKEND_URL = 'https://waterrrrrr.onrender.com';

// ─── DATA STORE ───────────────────────────────────────────────────────────────
const DB_KEY = 'smartmeter_records';
function loadRecords() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || []; }
    catch { return []; }
}
function saveRecords(r) { localStorage.setItem(DB_KEY, JSON.stringify(r)); }

function purgeDemoData() {
    const records = loadRecords();
    const realRecords = records.filter(r => !r.id.startsWith('rec_demo_'));
    if (records.length !== realRecords.length) {
        saveRecords(realRecords);
    }
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let capturedImageURL = '';  // data URL for preview
let capturedBlob = null;    // Blob for API upload
let selectedCondition = '';
let selectedPeriod = '';
let cameraStream = null;
let facingMode = 'environment';

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function goTo(screenId) {
    const current = document.querySelector('.screen.active');
    const next = document.getElementById(screenId);
    if (!next || next === current) return;

    if (current) {
        current.classList.remove('active');
        current.style.display = '';
    }
    next.style.display = 'flex';
    next.getBoundingClientRect(); // force reflow for transition
    next.classList.add('active');
    next.scrollTop = 0;

    if (screenId === 'screen-home') { stopCamera(); updateHomeStats(); }
    else if (screenId === 'screen-camera') { startCamera(); }
    else if (screenId === 'screen-dashboard') { stopCamera(); renderDashboard(); }
    else if (screenId === 'screen-ocr') { stopCamera(); setupOcrScreen(); }
    else if (screenId === 'screen-success') { stopCamera(); }
}

// ─── HOME ─────────────────────────────────────────────────────────────────────
function updateHomeStats() {
    const records = loadRecords();
    const todayStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
    document.getElementById('home-today-count').textContent = records.filter(r => r.recorded_date === todayStr).length;
    document.getElementById('home-abnormal-count').textContent = records.filter(r => r.meter_condition !== 'สภาพปกติ').length;
    document.getElementById('home-total-count').textContent = records.length;
}

// ─── CAMERA ───────────────────────────────────────────────────────────────────
async function startCamera() {
    stopCamera();
    const video = document.getElementById('camera-video');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
        });
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

function switchCamera() {
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
}

function capturePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    if (!cameraStream || !video.videoWidth) {
        // No camera — navigate to OCR for manual entry
        capturedImageURL = '';
        capturedBlob = null;
        goTo('screen-ocr');
        uploadAndOcr(null);
        return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    capturedImageURL = canvas.toDataURL('image/jpeg', 0.9);
    canvas.toBlob(blob => {
        capturedBlob = blob;
        goTo('screen-ocr');
        uploadAndOcr(blob);
    }, 'image/jpeg', 0.9);
}

function handleGalleryImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    capturedBlob = file;
    const reader = new FileReader();
    reader.onload = e => {
        capturedImageURL = e.target.result;
        goTo('screen-ocr');
        uploadAndOcr(file);
    };
    reader.readAsDataURL(file);
    // reset so same file can be re-selected
    event.target.value = '';
}

// ─── REAL OCR — FastAPI + OpenAI Vision ───────────────────────────────────────
async function uploadAndOcr(blob) {
    const display = document.getElementById('ocr-reading-text');
    display.classList.add('loading');
    display.textContent = 'กำลังอ่าน...';
    document.getElementById('f-reading').value = '';
    hideOcrToast();

    if (!blob) {
        display.classList.remove('loading');
        display.textContent = '--';
        return;
    }

    try {
        const form = new FormData();
        form.append('file', blob, 'meter.jpg');

        const res = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: form });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error("API Error Status:", res.status, err);
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

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
        display.classList.remove('loading');
        display.textContent = '--';
        if (e.message.toLowerCase().includes('fetch') || e.message.toLowerCase().includes('failed')) {
            showOcrToast('ไม่สามารถเชื่อมต่อ AI ได้ — กรุณาพิมพ์ค่าเอง');
        } else {
            showOcrToast(`เกิดข้อผิดพลาด: ${e.message}`);
        }
    }
}

function showOcrToast(msg) {
    let t = document.getElementById('ocr-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'ocr-toast';
        t.className = 'ocr-toast';
        document.querySelector('.ocr-reading-card').appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
}
function hideOcrToast() {
    const t = document.getElementById('ocr-toast');
    if (t) t.style.display = 'none';
}

// ─── OCR SCREEN SETUP ─────────────────────────────────────────────────────────
function setupOcrScreen() {
    const preview = document.getElementById('ocr-preview');
    const card = document.querySelector('.ocr-image-card');
    const ph = card.querySelector('.no-img-ph');

    if (capturedImageURL) {
        preview.src = capturedImageURL;
        preview.style.display = 'block';
        if (ph) ph.remove();
    } else {
        preview.style.display = 'none';
        if (!ph) {
            const el = document.createElement('div');
            el.className = 'no-img-ph';
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
    selectedCondition = '';
    selectedPeriod = '';
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected', 'warning'));
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('save-error').style.display = 'none';
    hideOcrToast();
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
    el.classList.add('selected');
    selectedPeriod = el.dataset.value;
    document.getElementById('save-error').style.display = 'none';
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────
function saveRecord() {
    const errEl = document.getElementById('save-error');
    if (!selectedCondition || !selectedPeriod) {
        errEl.style.display = 'block';
        errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    const now = new Date();
    const record = {
        id: `rec_${Date.now()}`,
        meter_id: document.getElementById('f-meter-id').value.trim() || `W-${Date.now()}`,
        reading_value: document.getElementById('f-reading').value.trim() || '--',
        image_url: capturedImageURL || '',
        meter_condition: selectedCondition,
        time_period: selectedPeriod,
        recorded_at: now.toLocaleString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        recorded_date: now.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' }),
        inspector_name: document.getElementById('f-inspector').value,
        notes: document.getElementById('f-notes').value.trim(),
        status: selectedCondition === 'สภาพปกติ' ? 'ตรวจสอบแล้ว' : 'รอตรวจสอบ'
    };
    const records = loadRecords();
    records.unshift(record);
    saveRecords(records);
    showSuccess(record);
}

// ─── SUCCESS ──────────────────────────────────────────────────────────────────
function showSuccess(rec) {
    const condClass = rec.meter_condition === 'สภาพปกติ' ? 'record-condition-normal' : 'record-condition-warn';
    document.getElementById('success-summary').innerHTML = `
    <div class="success-row"><span class="success-row-label">เลขมิเตอร์</span><span class="success-row-val">${rec.meter_id}</span></div>
    <div class="success-row"><span class="success-row-label">ค่าที่อ่านได้</span><span class="success-row-val">${rec.reading_value} หน่วย</span></div>
    <div class="success-row"><span class="success-row-label">สภาพมิเตอร์</span><span class="success-row-val ${condClass}">${rec.meter_condition}</span></div>
    <div class="success-row"><span class="success-row-label">ช่วงเวลา</span><span class="success-row-val">${rec.time_period}</span></div>
    <div class="success-row"><span class="success-row-label">ผู้บันทึก</span><span class="success-row-val">${rec.inspector_name}</span></div>
    <div class="success-row"><span class="success-row-label">วันที่</span><span class="success-row-val">${rec.recorded_at}</span></div>`;
    goTo('screen-success');
}

function startNewScan() {
    capturedImageURL = '';
    capturedBlob = null;
    selectedCondition = '';
    selectedPeriod = '';
    goTo('screen-camera');
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function renderDashboard() {
    const records = loadRecords();
    const todayStr = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
    document.getElementById('stat-total').textContent = records.length;
    document.getElementById('stat-pending').textContent = records.filter(r => r.status === 'รอตรวจสอบ').length;
    document.getElementById('stat-abnormal').textContent = records.filter(r => r.meter_condition !== 'สภาพปกติ').length;
    document.getElementById('stat-today').textContent = records.filter(r => r.recorded_date === todayStr).length;
    clearFilters();
}

function applyFilters() {
    const mQ = document.getElementById('filter-meter').value.trim().toLowerCase();
    const pQ = document.getElementById('filter-period').value;
    const cQ = document.getElementById('filter-condition').value;
    const iQ = document.getElementById('filter-inspector').value;
    renderRecords(loadRecords().filter(r =>
        (!mQ || r.meter_id.toLowerCase().includes(mQ)) &&
        (!pQ || r.time_period === pQ) &&
        (!cQ || r.meter_condition === cQ) &&
        (!iQ || r.inspector_name === iQ)
    ));
}

function clearFilters() {
    ['filter-meter', 'filter-period', 'filter-condition', 'filter-inspector'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    renderRecords(loadRecords());
}

function renderRecords(records) {
    const list = document.getElementById('records-list');
    document.getElementById('records-count-label').textContent = `แสดง ${records.length} รายการ`;
    if (!records.length) { list.innerHTML = '<div class="empty-state">🔍 ไม่พบรายการที่ค้นหา</div>'; return; }
    list.innerHTML = records.map(r => {
        const pCls = r.time_period === 'รอบเช้า' ? 'badge-period-morning' : 'badge-period-evening';
        const sCls = r.status === 'ตรวจสอบแล้ว' ? 'badge-status-ok' : r.meter_condition !== 'สภาพปกติ' ? 'badge-status-warn' : 'badge-status-pending';
        const cCls = r.meter_condition === 'สภาพปกติ' ? 'record-condition-normal' : 'record-condition-warn';
        return `<div class="record-card">
      <div class="record-top">
        <span class="record-meter-id">${r.meter_id}</span>
        <div class="record-badges">
          <span class="badge ${pCls}">${r.time_period}</span>
          <span class="badge ${sCls}">${r.status}</span>
        </div>
      </div>
      <div class="record-row"><span class="record-row-label">ค่าที่อ่านได้</span><span class="record-row-val">${r.reading_value} หน่วย</span></div>
      <div class="record-row"><span class="record-row-label">สภาพมิเตอร์</span><span class="record-row-val ${cCls}">${r.meter_condition}</span></div>
      <div class="record-row"><span class="record-row-label">ผู้บันทึก</span><span class="record-row-val">${r.inspector_name}</span></div>
      <div class="record-row"><span class="record-row-label">วันที่</span><span class="record-row-val">${r.recorded_at}</span></div>
      ${r.notes ? `<div class="record-row"><span class="record-row-label">หมายเหตุ</span><span class="record-row-val">${r.notes}</span></div>` : ''}
    </div>`;
    }).join('');
}

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────
function exportExcel() {
    const mQ = document.getElementById('filter-meter').value.trim().toLowerCase();
    const pQ = document.getElementById('filter-period').value;
    const cQ = document.getElementById('filter-condition').value;
    const iQ = document.getElementById('filter-inspector').value;
    let records = loadRecords();
    if (mQ) records = records.filter(r => r.meter_id.toLowerCase().includes(mQ));
    if (pQ) records = records.filter(r => r.time_period === pQ);
    if (cQ) records = records.filter(r => r.meter_condition === cQ);
    if (iQ) records = records.filter(r => r.inspector_name === iQ);

    const rows = records.map((r, i) => ({
        'ลำดับ': i + 1, 'เลขมิเตอร์': r.meter_id, 'ค่าที่อ่านได้': r.reading_value,
        'สภาพมิเตอร์': r.meter_condition, 'ช่วงเวลา': r.time_period,
        'วันที่บันทึก': r.recorded_at, 'ผู้บันทึก': r.inspector_name,
        'หมายเหตุ': r.notes, 'สถานะ': r.status
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 24 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'บันทึกมิเตอร์');
    XLSX.writeFile(wb, `SmartMeter_${new Date().toLocaleDateString('th-TH').replace(/\//g, '-')}.xlsx`);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    purgeDemoData();
    updateHomeStats();
    // Ensure only home is shown
    document.querySelectorAll('.screen').forEach(s => {
        s.style.display = '';
        s.classList.remove('active');
    });
    const home = document.getElementById('screen-home');
    home.style.display = 'flex';
    home.classList.add('active');
});
