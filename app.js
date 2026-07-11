/* ==================== シフト表アプリ フロントエンド ==================== */

const DAYS = ['月', '火', '水', '木', '金', '土'];
const AMPM = ['AM', 'PM'];
const EXTRA_CATEGORIES = ['送迎', '事務', 'ヘルプ'];

let state = {
  staff: [],     // {id,name,roles:[],defaultStart,defaultEnd,active}
  roles: [],     // {name}
  minRules: [],  // {id,role,store('' /'A'/'B'),day('' /0-5),ampm('' /'AM'/'PM'),minCount}
  shiftsList: [],
  current: { id: null, title: '', comment: '', storeAName: '大森', storeBName: '高花', basedOn: '', showExtra: false },
  cells: { A: {}, B: {} },     // key: `${day}_${ampm}` -> [{staffName,startTime,endTime,slotIndex}]
  extra: {},                   // key: `${day}_${ampm}_${cat}` -> [{staffName,slotIndex}]
  closed: { A: {}, B: {} },    // key: `${day}_${ampm}` -> true/false
};

/* ---------- ユーティリティ ---------- */
function cellKey(day, ampm) { return day + '_' + ampm; }
function extraKey(day, ampm, cat) { return day + '_' + ampm + '_' + cat; }

function getCell(store, day, ampm) {
  const k = cellKey(day, ampm);
  if (!state.cells[store][k]) state.cells[store][k] = [];
  return state.cells[store][k];
}
function getExtra(day, ampm, cat) {
  const k = extraKey(day, ampm, cat);
  if (!state.extra[k]) state.extra[k] = [];
  return state.extra[k];
}
function getClosed(store, day, ampm) {
  return !!(state.closed[store] && state.closed[store][cellKey(day, ampm)]);
}
function setClosed(store, day, ampm, val) {
  if (!state.closed[store]) state.closed[store] = {};
  state.closed[store][cellKey(day, ampm)] = val;
}
function findStaff(name) { return state.staff.find((s) => s.name === name); }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setStatus(msg) {
  document.getElementById('statusLine').textContent = msg;
}

/* ---------- API ---------- */
async function apiGet(params) {
  try {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(API_URL + '?' + qs);
    return await res.json();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
async function apiPost(action, data) {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, data)),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ---------- 初期ロード ---------- */
async function loadInit() {
  setStatus('読み込み中...');
  try {
    const res = await apiGet({ action: 'init' });
    if (!res.ok) throw new Error(res.error || '不明なエラー');
    state.staff = (res.staff || []).map((s) => ({
      id: s.id, name: s.name,
      roles: (s.roles || '').toString().split(',').map((x) => x.trim()).filter(Boolean),
      defaultStart: s.defaultStart || '', defaultEnd: s.defaultEnd || '',
      active: s.active !== false && s.active !== 'false',
    }));
    state.roles = (res.roles || []).map((r) => ({ name: r.name }));
    state.minRules = (res.minRules || []).map((r) => ({
      id: r.id, role: r.role || '', store: r.store || '', day: (r.day === 0 ? '0' : (r.day || '')).toString(),
      ampm: r.ampm || '', minCount: Number(r.minCount) || 0,
    }));
    state.shiftsList = res.shifts || [];
    renderShiftSelect();
    renderAdminTables();
    if (state.shiftsList.length > 0) {
      await loadShift(state.shiftsList[0].id);
    } else {
      resetCurrentShift();
      renderShiftArea();
    }
    setStatus('');
  } catch (err) {
    console.error(err);
    toast('データベースに接続できません。画面の確認だけはこのままできます(保存は失敗します)。API_URLの設定をご確認ください。');
    renderShiftSelect();
    renderAdminTables();
    resetCurrentShift();
    renderShiftArea();
    setStatus('未接続(オフライン表示)');
  }
}

async function loadShift(id) {
  setStatus('読み込み中...');
  const res = await apiGet({ action: 'getShift', id: id });
  if (!res.ok) { toast('読み込みエラー: ' + res.error); setStatus(''); return; }
  const meta = res.meta || {};
  state.current = {
    id: meta.id, title: meta.title || '', comment: meta.comment || '',
    storeAName: meta.storeAName || '大森', storeBName: meta.storeBName || '高花',
    basedOn: meta.basedOn || '', showExtra: meta.showExtra === true || meta.showExtra === 'true' || meta.showExtra === 'TRUE',
  };
  state.cells = { A: {}, B: {} };
  (res.shiftData || []).forEach((r) => {
    const store = r.store;
    const k = cellKey(Number(r.day), r.ampm);
    if (!state.cells[store][k]) state.cells[store][k] = [];
    state.cells[store][k].push({
      staffName: r.staffName, startTime: r.startTime || '', endTime: r.endTime || '',
      slotIndex: Number(r.slotIndex) || 0,
    });
  });
  Object.keys(state.cells.A).forEach((k) => state.cells.A[k].sort((a, b) => a.slotIndex - b.slotIndex));
  Object.keys(state.cells.B).forEach((k) => state.cells.B[k].sort((a, b) => a.slotIndex - b.slotIndex));

  state.extra = {};
  (res.extraData || []).forEach((r) => {
    const k = extraKey(Number(r.day), r.ampm, r.category);
    if (!state.extra[k]) state.extra[k] = [];
    state.extra[k].push({ staffName: r.staffName, slotIndex: Number(r.slotIndex) || 0 });
  });
  Object.keys(state.extra).forEach((k) => state.extra[k].sort((a, b) => a.slotIndex - b.slotIndex));

  state.closed = { A: {}, B: {} };
  try {
    (JSON.parse(meta.closedSlots || '[]') || []).forEach((token) => {
      const parts = String(token).split('|');
      const store = parts[0], key = parts[1];
      if (store && key) { if (!state.closed[store]) state.closed[store] = {}; state.closed[store][key] = true; }
    });
  } catch (e) { /* ignore malformed data */ }

  document.getElementById('shiftSelect').value = String(id);
  renderShiftArea();
  setStatus('');
}

function resetCurrentShift(keepStoreNames) {
  const prevA = keepStoreNames ? state.current.storeAName : '大森';
  const prevB = keepStoreNames ? state.current.storeBName : '高花';
  state.current = { id: null, title: '', comment: '', storeAName: prevA, storeBName: prevB, basedOn: '', showExtra: false };
  state.cells = { A: {}, B: {} };
  state.extra = {};
  state.closed = { A: {}, B: {} };
}

/* ---------- 保存 ---------- */
function buildShiftDataPayload() {
  const rows = [];
  ['A', 'B'].forEach((store) => {
    Object.keys(state.cells[store]).forEach((k) => {
      const [day, ampm] = k.split('_');
      state.cells[store][k].forEach((entry, idx) => {
        rows.push({
          store, day: Number(day), ampm, slotIndex: idx,
          staffName: entry.staffName, startTime: entry.startTime || '', endTime: entry.endTime || '',
        });
      });
    });
  });
  return rows;
}
function buildExtraDataPayload() {
  const rows = [];
  Object.keys(state.extra).forEach((k) => {
    const [day, ampm, cat] = k.split('_');
    state.extra[k].forEach((entry, idx) => {
      rows.push({ day: Number(day), ampm, category: cat, slotIndex: idx, staffName: entry.staffName });
    });
  });
  return rows;
}
function buildClosedSlotsPayload() {
  const arr = [];
  ['A', 'B'].forEach((store) => {
    Object.keys(state.closed[store] || {}).forEach((k) => {
      if (state.closed[store][k]) arr.push(store + '|' + k);
    });
  });
  return JSON.stringify(arr);
}

async function saveShift() {
  if (!state.current.title.trim()) {
    toast('タイトルを入力してください');
    return;
  }
  setStatus('保存中...');
  const payload = {
    id: state.current.id,
    title: state.current.title,
    comment: state.current.comment,
    storeAName: state.current.storeAName,
    storeBName: state.current.storeBName,
    basedOn: state.current.basedOn,
    closedSlots: buildClosedSlotsPayload(),
    showExtra: !!state.current.showExtra,
    shiftData: buildShiftDataPayload(),
    extraData: buildExtraDataPayload(),
  };
  const res = await apiPost('saveShift', payload);
  if (!res.ok) { toast('保存エラー: ' + res.error); setStatus(''); return; }
  state.current.id = res.id;
  const existing = state.shiftsList.find((s) => String(s.id) === String(res.id));
  if (existing) {
    existing.title = state.current.title;
    existing.updatedAt = new Date().toISOString();
  } else {
    state.shiftsList.unshift({ id: res.id, title: state.current.title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }
  renderShiftSelect();
  document.getElementById('shiftSelect').value = String(res.id);
  toast('保存しました');
  setStatus('');
}

async function deleteCurrentShift() {
  if (!state.current.id) { toast('未保存の表です'); return; }
  if (!confirm('「' + state.current.title + '」を削除します。よろしいですか？')) return;
  setStatus('削除中...');
  const res = await apiPost('deleteShift', { id: state.current.id });
  if (!res.ok) { toast('削除エラー: ' + res.error); setStatus(''); return; }
  state.shiftsList = state.shiftsList.filter((s) => String(s.id) !== String(state.current.id));
  renderShiftSelect();
  if (state.shiftsList.length > 0) {
    await loadShift(state.shiftsList[0].id);
  } else {
    resetCurrentShift();
    renderShiftArea();
  }
  toast('削除しました');
  setStatus('');
}

/* ---------- 集計（警告） ---------- */
function computeDuplicateNames() {
  const dupMap = {};
  DAYS.forEach((_, day) => {
    AMPM.forEach((ampm) => {
      const namesA = getClosed('A', day, ampm) ? [] : getCell('A', day, ampm).map((e) => e.staffName);
      const namesB = getClosed('B', day, ampm) ? [] : getCell('B', day, ampm).map((e) => e.staffName);
      const setA = new Set(namesA);
      const dup = new Set(namesB.filter((n) => setA.has(n)));
      dupMap[cellKey(day, ampm)] = dup;
    });
  });
  return dupMap;
}

/** 役職ごとの最低人数ルールを、より具体的な条件を優先して解決する */
function calcMinCount(store, day, ampm, roleName) {
  const matches = state.minRules.filter((r) => r.role === roleName
    && (r.store === '' || r.store === store)
    && (r.day === '' || Number(r.day) === Number(day))
    && (r.ampm === '' || r.ampm === ampm));
  if (matches.length === 0) return 0;
  let best = null, bestScore = -1;
  matches.forEach((r) => {
    const score = (r.store !== '' ? 1 : 0) + (r.day !== '' ? 1 : 0) + (r.ampm !== '' ? 1 : 0);
    if (score >= bestScore) { bestScore = score; best = r; }
  });
  return best ? (Number(best.minCount) || 0) : 0;
}

function computeShortages(store) {
  const result = {};
  DAYS.forEach((_, day) => {
    AMPM.forEach((ampm) => {
      if (getClosed(store, day, ampm)) return; // 休業コマは対象外
      const names = getCell(store, day, ampm).map((e) => e.staffName);
      const shortages = [];
      state.roles.forEach((role) => {
        const need = calcMinCount(store, day, ampm, role.name);
        if (!need || need <= 0) return;
        const have = names.filter((n) => {
          const st = findStaff(n);
          return st && st.roles.includes(role.name);
        }).length;
        if (have < need) shortages.push({ role: role.name, have, need });
      });
      if (shortages.length) result[cellKey(day, ampm)] = shortages;
    });
  });
  return result;
}

/* ---------- 描画: セレクタ ---------- */
function renderShiftSelect() {
  const sel = document.getElementById('shiftSelect');
  sel.innerHTML = '';
  if (state.shiftsList.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(保存済みの表はありません)';
    opt.value = '';
    sel.appendChild(opt);
    return;
  }
  state.shiftsList.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.title || '(無題)';
    sel.appendChild(opt);
  });
  if (state.current.id) sel.value = String(state.current.id);
}

/* ---------- 描画: メイン領域(編集画面) ---------- */
function renderShiftArea() {
  document.getElementById('titleInput').value = state.current.title;
  document.getElementById('commentInput').value = state.current.comment;

  const dupMap = computeDuplicateNames();
  const shortA = computeShortages('A');
  const shortB = computeShortages('B');

  renderWarnSummary(shortA, shortB);
  renderStoreTable('A', document.getElementById('storeBlockA'), dupMap, shortA);
  renderStoreTable('B', document.getElementById('storeBlockB'), dupMap, shortB);
  renderExtraBlock(document.getElementById('extraBlock'));
}


function renderWarnSummary(shortA, shortB) {
  const box = document.getElementById('warnSummary');
  const lines = [];
  function addLines(storeLabel, shortages) {
    Object.keys(shortages).forEach((k) => {
      const [day, ampm] = k.split('_');
      shortages[k].forEach((s) => {
        lines.push(`⚠ ${storeLabel} ${DAYS[day]}${ampm}: ${s.role} ${s.have}/${s.need}名`);
      });
    });
  }
  addLines(state.current.storeAName || '店舗A', shortA);
  addLines(state.current.storeBName || '店舗B', shortB);
  if (lines.length === 0) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = '<div style="background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12.5px;">' +
    lines.map((l) => '<div>' + l + '</div>').join('') + '</div>';
}

function staffOptionListHtml(selectedPlaceholder) {
  let html = '<option value="">' + selectedPlaceholder + '</option>';
  state.staff.filter((s) => s.active).forEach((s) => {
    html += `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`;
  });
  return html;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderStoreTable(store, container, dupMap, shortages) {
  const storeNameKey = store === 'A' ? 'storeAName' : 'storeBName';
  let html = `
    <div class="store-name-row">
      <input type="text" class="store-name-input" value="${escapeHtml(state.current[storeNameKey])}" data-store="${store}" onInput="onStoreNameInput(event)">
    </div>
    <table class="shift-table">
      <thead><tr><th class="corner"></th>`;
  DAYS.forEach((d, day) => {
    const amShort = shortages[cellKey(day, 'AM')];
    const pmShort = shortages[cellKey(day, 'PM')];
    const hasWarn = (amShort && amShort.length) || (pmShort && pmShort.length);
    html += `<th${hasWarn ? ' class="warn"' : ''}>${d}${hasWarn ? ' ⚠' : ''}</th>`;
  });
  html += '</tr></thead><tbody>';

  AMPM.forEach((ampm) => {
    html += `<tr><td class="ampm-cell">${ampm}</td>`;
    DAYS.forEach((d, day) => {
      const closed = getClosed(store, day, ampm);
      html += `<td class="slot-cell">`;
      html += `<label class="closed-check"><input type="checkbox" data-store="${store}" data-day="${day}" data-ampm="${ampm}" ${closed ? 'checked' : ''} onchange="onToggleClosed(event)"> 休業</label>`;
      if (closed) {
        html += `<div class="slot-closed-label">休業</div>`;
      } else {
        const entries = getCell(store, day, ampm);
        const dup = dupMap[cellKey(day, ampm)] || new Set();
        const short = shortages[cellKey(day, ampm)] || [];
        entries.forEach((entry, idx) => {
          const isDup = dup.has(entry.staffName);
          const timeLabel = entry.startTime || entry.endTime ? `${entry.startTime || '?'}〜${entry.endTime || '?'}` : '';
          html += `
            <div class="staff-chip${isDup ? ' dup' : ''}" data-store="${store}" data-day="${day}" data-ampm="${ampm}" data-idx="${idx}">
              <div class="chip-name" onclick="onChipClick(event)">${escapeHtml(entry.staffName)}${timeLabel ? `<span class="chip-time">${timeLabel}</span>` : ''}</div>
              <div class="chip-del" onclick="onChipDelete(event)">×</div>
            </div>`;
        });
        if (short.length) {
          html += `<div class="warn-tooltip">${short.map((s) => s.role + '不足(' + s.have + '/' + s.need + ')').join(' ')}</div>`;
        }
        html += `<select class="add-select" data-store="${store}" data-day="${day}" data-ampm="${ampm}" onchange="onAddToCell(event)">${staffOptionListHtml('＋追加')}</select>`;
      }
      html += `</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderExtraBlock(container) {
  const shown = !!state.current.showExtra;
  let html = `
    <div class="extra-toggle-row">
      <h3>送迎・事務・ヘルプ（両店舗共通）</h3>
      <button type="button" class="extra-toggle-btn" onclick="onToggleExtraVisible()">${shown ? '－ 隠す' : '＋ 表示する'}</button>
    </div>`;
  if (shown) {
    html += '<table class="extra-table"><thead><tr><th></th>';
    DAYS.forEach((d) => { html += `<th colspan="2">${d}</th>`; });
    html += '</tr><tr><th></th>';
    DAYS.forEach(() => { html += '<th style="font-size:9px;">AM</th><th style="font-size:9px;">PM</th>'; });
    html += '</tr></thead><tbody>';

    EXTRA_CATEGORIES.forEach((cat) => {
      html += `<tr><td class="cat-cell">${cat}</td>`;
      DAYS.forEach((d, day) => {
        AMPM.forEach((ampm) => {
          const entries = getExtra(day, ampm, cat);
          html += '<td>';
          entries.forEach((entry, idx) => {
            html += `
              <div class="staff-chip" data-day="${day}" data-ampm="${ampm}" data-cat="${cat}" data-idx="${idx}">
                <div class="chip-name">${escapeHtml(entry.staffName)}</div>
                <div class="chip-del" onclick="onExtraDelete(event)">×</div>
              </div>`;
          });
          html += `<select class="add-select" data-day="${day}" data-ampm="${ampm}" data-cat="${cat}" onchange="onAddToExtra(event)">${staffOptionListHtml('＋')}</select>`;
          html += '</td>';
        });
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
  }
  container.innerHTML = html;
}
function onToggleExtraVisible() {
  state.current.showExtra = !state.current.showExtra;
  renderShiftArea();
}

/* ---------- 描画: 画像・印刷用のシンプル表示 ---------- */
function buildCleanView() {
  const dupMap = computeDuplicateNames();
  const shortA = computeShortages('A');
  const shortB = computeShortages('B');
  let html = '';
  html += `<div class="clean-title">${escapeHtml(state.current.title || '(無題)')}</div>`;
  if (state.current.comment) html += `<div class="clean-comment">${escapeHtml(state.current.comment)}</div>`;
  html += buildCleanStoreHtml('A', state.current.storeAName, dupMap, shortA);
  if (state.current.showExtra) html += buildCleanExtraHtml();
  html += buildCleanStoreHtml('B', state.current.storeBName, dupMap, shortB);
  document.getElementById('cleanView').innerHTML = html;
}

function buildCleanStoreHtml(store, storeName, dupMap, shortages) {
  let html = `<div class="clean-store-name">${escapeHtml(storeName)}</div><table><thead><tr><th></th>`;
  DAYS.forEach((d, day) => {
    const amS = shortages[cellKey(day, 'AM')], pmS = shortages[cellKey(day, 'PM')];
    const warn = (amS && amS.length) || (pmS && pmS.length);
    html += `<th${warn ? ' class="warn-day"' : ''}>${d}${warn ? ' ⚠' : ''}</th>`;
  });
  html += '</tr></thead><tbody>';
  AMPM.forEach((ampm) => {
    html += `<tr><td class="clean-ampm">${ampm}</td>`;
    DAYS.forEach((d, day) => {
      const closed = getClosed(store, day, ampm);
      html += '<td>';
      if (closed) {
        html += '<div class="slot-closed-label">休業</div>';
      } else {
        const entries = getCell(store, day, ampm);
        const dup = dupMap[cellKey(day, ampm)] || new Set();
        html += '<ul class="clean-bullet">';
        entries.forEach((entry) => {
          const isDup = dup.has(entry.staffName);
          const timeLabel = entry.startTime || entry.endTime ? ` <span class="clean-time">${entry.startTime || '?'}〜${entry.endTime || '?'}</span>` : '';
          html += `<li${isDup ? ' class="dup"' : ''}>・${escapeHtml(entry.staffName)}${timeLabel}</li>`;
        });
        html += '</ul>';
      }
      html += '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildCleanExtraHtml() {
  let html = '<div class="clean-extra-title">送迎・事務・ヘルプ</div><table><thead><tr><th></th>';
  DAYS.forEach((d) => { html += `<th colspan="2">${d}</th>`; });
  html += '</tr><tr><th></th>';
  DAYS.forEach(() => { html += '<th style="font-size:10px;">AM</th><th style="font-size:10px;">PM</th>'; });
  html += '</tr></thead><tbody>';
  EXTRA_CATEGORIES.forEach((cat) => {
    html += `<tr><td style="font-weight:700;background:#f5f5f5;text-align:center;">${cat}</td>`;
    DAYS.forEach((d, day) => {
      AMPM.forEach((ampm) => {
        const entries = getExtra(day, ampm, cat);
        html += '<td>' + entries.map((e) => escapeHtml(e.staffName)).join('<br>') + '</td>';
      });
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

/* ---------- イベント: シフト表セル ---------- */
function onAddToCell(e) {
  const sel = e.target;
  const name = sel.value;
  if (!name) return;
  const store = sel.dataset.store, day = Number(sel.dataset.day), ampm = sel.dataset.ampm;
  const st = findStaff(name);
  getCell(store, day, ampm).push({
    staffName: name,
    startTime: st ? st.defaultStart : '',
    endTime: st ? st.defaultEnd : '',
  });
  renderShiftArea();
}
function onChipDelete(e) {
  e.stopPropagation();
  const chip = e.target.closest('.staff-chip');
  const store = chip.dataset.store, day = Number(chip.dataset.day), ampm = chip.dataset.ampm, idx = Number(chip.dataset.idx);
  getCell(store, day, ampm).splice(idx, 1);
  renderShiftArea();
}
function onChipClick(e) {
  const chip = e.target.closest('.staff-chip');
  const store = chip.dataset.store, day = Number(chip.dataset.day), ampm = chip.dataset.ampm, idx = Number(chip.dataset.idx);
  const entry = getCell(store, day, ampm)[idx];
  openTimeEditor(chip, entry);
}
function onStoreNameInput(e) {
  const store = e.target.dataset.store;
  state.current[store === 'A' ? 'storeAName' : 'storeBName'] = e.target.value;
}
function onToggleClosed(e) {
  const store = e.target.dataset.store, day = Number(e.target.dataset.day), ampm = e.target.dataset.ampm;
  setClosed(store, day, ampm, e.target.checked);
  renderShiftArea();
}

/* ---------- イベント: 送迎・事務・ヘルプ ---------- */
function onAddToExtra(e) {
  const sel = e.target;
  const name = sel.value;
  if (!name) return;
  const day = Number(sel.dataset.day), ampm = sel.dataset.ampm, cat = sel.dataset.cat;
  getExtra(day, ampm, cat).push({ staffName: name });
  renderShiftArea();
}
function onExtraDelete(e) {
  e.stopPropagation();
  const chip = e.target.closest('.staff-chip');
  const day = Number(chip.dataset.day), ampm = chip.dataset.ampm, cat = chip.dataset.cat, idx = Number(chip.dataset.idx);
  getExtra(day, ampm, cat).splice(idx, 1);
  renderShiftArea();
}

/* ---------- 勤務時間エディタ ---------- */
function openTimeEditor(anchorEl, entry) {
  closeTimeEditor();
  const rect = anchorEl.getBoundingClientRect();
  const editor = document.createElement('div');
  editor.className = 'time-editor';
  editor.id = 'timeEditor';
  editor.style.top = (window.scrollY + rect.bottom + 4) + 'px';
  editor.style.left = (window.scrollX + rect.left) + 'px';
  editor.innerHTML = `
    <div class="te-row"><b>${escapeHtml(entry.staffName)}</b> の勤務時間</div>
    <div class="te-row">
      <input type="time" id="teStart" value="${entry.startTime || ''}">
      〜
      <input type="time" id="teEnd" value="${entry.endTime || ''}">
    </div>
    <div class="te-row">
      <button class="primary" onclick="saveTimeEditor()">設定</button>
      <button onclick="clearTimeEditor()">時間なしにする</button>
      <button onclick="closeTimeEditor()">閉じる</button>
    </div>
  `;
  document.body.appendChild(editor);
  editor._entry = entry;
  setTimeout(() => document.addEventListener('click', onOutsideTimeEditorClick), 0);
}
function onOutsideTimeEditorClick(e) {
  const editor = document.getElementById('timeEditor');
  if (editor && !editor.contains(e.target) && !e.target.classList.contains('chip-name')) closeTimeEditor();
}
function closeTimeEditor() {
  const editor = document.getElementById('timeEditor');
  if (editor) editor.remove();
  document.removeEventListener('click', onOutsideTimeEditorClick);
}
function saveTimeEditor() {
  const editor = document.getElementById('timeEditor');
  const entry = editor._entry;
  entry.startTime = document.getElementById('teStart').value;
  entry.endTime = document.getElementById('teEnd').value;
  closeTimeEditor();
  renderShiftArea();
}
function clearTimeEditor() {
  const editor = document.getElementById('timeEditor');
  const entry = editor._entry;
  entry.startTime = '';
  entry.endTime = '';
  closeTimeEditor();
  renderShiftArea();
}

/* ---------- スタッフ・役職・ルール 管理パネル ---------- */
function renderAdminTables() {
  renderRolesTable();
  renderStaffTable();
  renderMinRulesTable();
}
function renderRolesTable() {
  const tbody = document.querySelector('#rolesTable tbody');
  tbody.innerHTML = '';
  state.roles.forEach((role, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${escapeHtml(role.name)}" data-i="${i}" onInput="onRoleNameInput(event)"></td>
      <td><button class="small-btn danger" onclick="deleteRole(${i})">削除</button></td>
    `;
    tbody.appendChild(tr);
  });
}
function renderStaffTable() {
  const tbody = document.querySelector('#staffTable tbody');
  tbody.innerHTML = '';
  state.staff.forEach((s, i) => {
    const tr = document.createElement('tr');
    const roleChecks = state.roles.map((r) => `
      <label class="role-tag-check">
        <input type="checkbox" data-i="${i}" data-role="${escapeHtml(r.name)}" ${s.roles.includes(r.name) ? 'checked' : ''} onChange="onStaffRoleToggle(event)">
        ${escapeHtml(r.name)}
      </label>`).join('');
    tr.innerHTML = `
      <td><input type="text" value="${escapeHtml(s.name)}" data-i="${i}" onInput="onStaffNameInput(event)"></td>
      <td><div class="role-tags">${roleChecks || '<span style="color:var(--muted);font-size:11px;">役職未登録</span>'}</div></td>
      <td><input type="time" value="${s.defaultStart}" data-i="${i}" onInput="onStaffTimeInput(event,'defaultStart')"></td>
      <td><input type="time" value="${s.defaultEnd}" data-i="${i}" onInput="onStaffTimeInput(event,'defaultEnd')"></td>
      <td><button class="small-btn danger" onclick="deleteStaff(${i})">削除</button></td>
    `;
    tbody.appendChild(tr);
  });
}
function renderMinRulesTable() {
  const tbody = document.querySelector('#minRulesTable tbody');
  tbody.innerHTML = '';
  state.minRules.forEach((rule, i) => {
    const tr = document.createElement('tr');
    const roleOptions = state.roles.map((r) => `<option value="${escapeHtml(r.name)}" ${rule.role === r.name ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
    tr.innerHTML = `
      <td><select data-i="${i}" onchange="onMinRuleChange(event,'role')"><option value="">(選択してください)</option>${roleOptions}</select></td>
      <td><select data-i="${i}" onchange="onMinRuleChange(event,'store')">
            <option value="" ${rule.store === '' ? 'selected' : ''}>全店舗</option>
            <option value="A" ${rule.store === 'A' ? 'selected' : ''}>店舗A(上段)</option>
            <option value="B" ${rule.store === 'B' ? 'selected' : ''}>店舗B(下段)</option>
          </select></td>
      <td><select data-i="${i}" onchange="onMinRuleChange(event,'day')">
            <option value="" ${rule.day === '' ? 'selected' : ''}>全曜日</option>
            ${DAYS.map((d, di) => `<option value="${di}" ${String(rule.day) === String(di) ? 'selected' : ''}>${d}</option>`).join('')}
          </select></td>
      <td><select data-i="${i}" onchange="onMinRuleChange(event,'ampm')">
            <option value="" ${rule.ampm === '' ? 'selected' : ''}>両方</option>
            <option value="AM" ${rule.ampm === 'AM' ? 'selected' : ''}>AM</option>
            <option value="PM" ${rule.ampm === 'PM' ? 'selected' : ''}>PM</option>
          </select></td>
      <td><input type="number" min="0" value="${rule.minCount}" data-i="${i}" onInput="onMinRuleMinInput(event)"></td>
      <td><button class="small-btn danger" onclick="deleteMinRule(${i})">削除</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function onRoleNameInput(e) {
  const i = Number(e.target.dataset.i);
  const oldName = state.roles[i].name;
  const newName = e.target.value;
  state.roles[i].name = newName;
  state.staff.forEach((s) => {
    const idx = s.roles.indexOf(oldName);
    if (idx >= 0) s.roles[idx] = newName;
  });
  state.minRules.forEach((r) => { if (r.role === oldName) r.role = newName; });
  renderShiftArea();
}
function deleteRole(i) {
  const name = state.roles[i].name;
  state.roles.splice(i, 1);
  state.staff.forEach((s) => { s.roles = s.roles.filter((r) => r !== name); });
  state.minRules = state.minRules.filter((r) => r.role !== name);
  renderAdminTables();
  renderShiftArea();
}
function addRole() {
  state.roles.push({ name: '新しい役職' });
  renderAdminTables();
}

function onStaffNameInput(e) {
  const i = Number(e.target.dataset.i);
  const oldName = state.staff[i].name;
  const newName = e.target.value;
  state.staff[i].name = newName;
  ['A', 'B'].forEach((store) => {
    Object.values(state.cells[store]).forEach((arr) => arr.forEach((entry) => { if (entry.staffName === oldName) entry.staffName = newName; }));
  });
  Object.values(state.extra).forEach((arr) => arr.forEach((entry) => { if (entry.staffName === oldName) entry.staffName = newName; }));
  renderShiftArea();
}
function onStaffRoleToggle(e) {
  const i = Number(e.target.dataset.i);
  const role = e.target.dataset.role;
  const s = state.staff[i];
  if (e.target.checked) { if (!s.roles.includes(role)) s.roles.push(role); }
  else { s.roles = s.roles.filter((r) => r !== role); }
  renderShiftArea();
}
function onStaffTimeInput(e, field) {
  const i = Number(e.target.dataset.i);
  state.staff[i][field] = e.target.value;
}
function deleteStaff(i) {
  state.staff.splice(i, 1);
  renderAdminTables();
  renderShiftArea();
}
function addStaff() {
  state.staff.push({ id: 'st' + new Date().getTime() + Math.floor(Math.random() * 1000), name: '新しいスタッフ', roles: [], defaultStart: '', defaultEnd: '', active: true });
  renderAdminTables();
}

function onMinRuleChange(e, field) {
  const i = Number(e.target.dataset.i);
  state.minRules[i][field] = e.target.value;
  renderShiftArea();
}
function onMinRuleMinInput(e) {
  const i = Number(e.target.dataset.i);
  state.minRules[i].minCount = Number(e.target.value) || 0;
  renderShiftArea();
}
function addMinRule() {
  state.minRules.push({ id: 'r' + new Date().getTime() + Math.floor(Math.random() * 1000), role: '', store: '', day: '', ampm: '', minCount: 1 });
  renderMinRulesTable();
}
function deleteMinRule(i) {
  state.minRules.splice(i, 1);
  renderMinRulesTable();
  renderShiftArea();
}

async function saveStaffRolesAndRules() {
  setStatus('保存中...');
  const staffPayload = state.staff.map((s) => ({
    id: s.id, name: s.name, roles: s.roles.join(','), defaultStart: s.defaultStart, defaultEnd: s.defaultEnd, active: s.active,
  }));
  const rolesPayload = state.roles.map((r) => ({ name: r.name }));
  const rulesPayload = state.minRules.map((r) => ({ id: r.id, role: r.role, store: r.store, day: r.day, ampm: r.ampm, minCount: r.minCount }));
  const r1 = await apiPost('saveStaff', { staff: staffPayload });
  const r2 = await apiPost('saveRoles', { roles: rolesPayload });
  const r3 = await apiPost('saveMinRules', { rules: rulesPayload });
  if (!r1.ok || !r2.ok || !r3.ok) { toast('保存エラー'); setStatus(''); return; }
  toast('スタッフ・役職・ルールを保存しました');
  setStatus('');
}

/* ---------- 画像化 / 印刷（Excelのようなシンプル表示で出力） ---------- */
function enterExportMode() {
  buildCleanView();
  document.getElementById('metaEditArea').style.display = 'none';
  document.getElementById('editableView').style.display = 'none';
  document.getElementById('cleanView').style.display = 'block';
}
function exitExportMode() {
  document.getElementById('metaEditArea').style.display = '';
  document.getElementById('editableView').style.display = '';
  document.getElementById('cleanView').style.display = 'none';
}

async function exportImage() {
  enterExportMode();
  try {
    const canvas = await html2canvas(document.getElementById('printArea'), { scale: 2, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = (state.current.title || 'シフト表') + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    toast('画像化エラー: ' + err);
  } finally {
    exitExportMode();
  }
}
function printShift(mode) {
  enterExportMode();
  document.documentElement.classList.remove('print-half', 'print-full');
  document.documentElement.classList.add(mode === 'full' ? 'print-full' : 'print-half');
  const pageStyle = document.getElementById('dynamicPrintPage');
  pageStyle.textContent = mode === 'full'
    ? '@page{size:A4 landscape;margin:8mm;}'
    : '@page{size:A4 portrait;margin:8mm;}';
  setTimeout(() => window.print(), 50);
}
window.addEventListener('afterprint', () => {
  document.documentElement.classList.remove('print-half', 'print-full');
  exitExportMode();
});

/* ---------- 初期化 ---------- */
document.getElementById('btnNew').addEventListener('click', () => { resetCurrentShift(true); renderShiftSelect(); renderShiftArea(); toast('新しいシフト表を作成しています(未保存)'); });
document.getElementById('btnDuplicate').addEventListener('click', () => {
  const basedOn = state.current.id;
  state.current.id = null;
  state.current.basedOn = basedOn || '';
  state.current.title = state.current.title ? state.current.title + '（コピー）' : '';
  renderShiftSelect();
  renderShiftArea();
  toast('複製しました。内容を編集して保存してください');
});
document.getElementById('btnSave').addEventListener('click', saveShift);
document.getElementById('btnDelete').addEventListener('click', deleteCurrentShift);
document.getElementById('btnImage').addEventListener('click', exportImage);
document.getElementById('btnPrintHalf').addEventListener('click', () => printShift('half'));
document.getElementById('btnPrintFull').addEventListener('click', () => printShift('full'));
document.getElementById('shiftSelect').addEventListener('change', (e) => { if (e.target.value) loadShift(e.target.value); });
document.getElementById('titleInput').addEventListener('input', (e) => { state.current.title = e.target.value; });
document.getElementById('commentInput').addEventListener('input', (e) => { state.current.comment = e.target.value; });
document.getElementById('btnAddRole').addEventListener('click', addRole);
document.getElementById('btnAddStaff').addEventListener('click', addStaff);
document.getElementById('btnAddMinRule').addEventListener('click', addMinRule);
document.getElementById('btnSaveStaffRoles').addEventListener('click', saveStaffRolesAndRules);

loadInit();
