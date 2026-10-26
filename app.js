/**
 * はすてぃあ 配信スケジュール - app.js
 * data/videos.json を読み込んで番組表・カレンダー・アーカイブを描画する
 */

const DATA_URL = './data/videos.json';

// ===== カテゴリ自動判定 =====
const CATEGORY_RULES = [
  { key: 'live',    label: 'LIVE中',   patterns: [] }, // liveBroadcastContentで判定
  { key: 'upcoming',label: '配信予定', patterns: [] }, // liveBroadcastContentで判定
  { key: 'sing',    label: '歌枠',     patterns: ['歌','うた','sing','歌枠','歌回','カラオケ','歌ってみた','cover','covered'] },
  { key: 'game',    label: 'ゲーム',   patterns: ['ゲーム','game','マイクラ','minecraft','apex','valorant','スプラ','splatoon','among','ポケモン','pokemon','ff','ファイナルファンタジー','モンハン','zelda','ゼルダ','スト6','street fighter','パルワールド','fortnite','fall guys','overwatch','原神','genshin','星レイル','大神','バイオ','resident evil','sekiro','elden','ff14','ff16','ff7','龍が如く','yakuza'] },
  { key: 'horror',  label: 'ホラー',   patterns: ['ホラー','horror','怖','こわ','恐怖','脱出','escape','バイオハザード'] },
  { key: 'collab',  label: 'コラボ',   patterns: ['コラボ','collab','対談','w/','×','collaboration'] },
  { key: 'chat',    label: '雑談',     patterns: ['雑談','ざつだん','chat','talk','お話','おはなし','朝活','ゆる','報告','おやすみ','おはよう','新年','誕生日','生放送'] },
  { key: 'short',   label: 'ショート', patterns: ['#shorts','#short','short'] },
];

function detectCategory(item) {
  if (item.liveBroadcastContent === 'live') return 'live';
  if (item.liveBroadcastContent === 'upcoming') return 'upcoming';
  if (item.category === 'upcoming') return 'upcoming';
  if (item.category === 'live') return 'live';
  const text = (item.title + ' ' + item.description).toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (!rule.patterns.length) continue;
    if (rule.patterns.some(p => text.includes(p.toLowerCase()))) return rule.key;
  }
  return 'default';
}

function getCatLabel(key) {
  const rule = CATEGORY_RULES.find(r => r.key === key);
  if (rule) return rule.label;
  if (key === 'default') return 'その他';
  return key;
}

// ===== 日時ユーティリティ =====
function parseDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function toJST(d) {
  if (!d) return null;
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}

function formatJST(iso, fmt = 'datetime') {
  const d = parseDate(iso);
  if (!d) return '';
  const j = toJST(d);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = j.getUTCFullYear();
  const mm   = pad(j.getUTCMonth() + 1);
  const dd   = pad(j.getUTCDate());
  const hh   = pad(j.getUTCHours());
  const mi   = pad(j.getUTCMinutes());
  const DOW  = ['日','月','火','水','木','金','土'];
  const dow  = DOW[j.getUTCDay()];
  if (fmt === 'date')     return `${yyyy}/${mm}/${dd}（${dow}）`;
  if (fmt === 'time')     return `${hh}:${mi}`;
  if (fmt === 'month')    return `${yyyy}年${mm}月`;
  if (fmt === 'datetime') return `${yyyy}/${mm}/${dd}（${dow}） ${hh}:${mi}`;
  if (fmt === 'mdow')     return `${mm}/${dd}（${dow}）`;
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function todayJST() {
  const now = new Date();
  const j = toJST(now);
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
}

function getWeekStart(base) {
  // 月曜始まり
  const d = new Date(base);
  const day = d.getUTCDay(); // 0=Sun
  const diff = (day === 0) ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ===== グローバル状態 =====
let allItems = [];
let ttWeekStart = null;   // 番組表の週始め
let calYear = 0;          // カレンダーの年
let calMonth = 0;         // カレンダーの月（0-indexed）
let archiveFilter = 'all';
let archiveSearch = '';

// ===== データ読み込み =====
async function loadData() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.updatedAt) {
      document.getElementById('updatedAt').textContent = formatJST(data.updatedAt);
    }

    allItems = (Array.isArray(data.items) ? data.items : [])
      .filter(item => item.id && item.publishedAt)
      .map(item => ({ ...item, _cat: detectCategory(item) }));

    // 次の配信
    renderNextStream();

    // 初期描画
    const today = todayJST();
    ttWeekStart = getWeekStart(today);
    calYear  = today.getUTCFullYear();
    calMonth = today.getUTCMonth();

    renderTimetable();
    renderCalendar();
    renderArchive();

  } catch (err) {
    console.error('データ読み込みエラー:', err);
    document.getElementById('updatedAt').textContent = '読み込みエラー';
    ['timetable','calendar','archive-list'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="empty-msg">データの読み込みに失敗しました。</div>';
    });
  }
}

// ===== 次の配信 =====
function renderNextStream() {
  const now = new Date();
  const upcoming = allItems
    .filter(item => (item._cat === 'upcoming' || item._cat === 'live') && parseDate(item.publishedAt) > now)
    .sort((a, b) => parseDate(a.publishedAt) - parseDate(b.publishedAt));

  const el = document.getElementById('next-stream-info');
  if (!upcoming.length) {
    el.textContent = '未発表です';
    return;
  }
  const next = upcoming[0];
  el.innerHTML = `
    <div style="font-size:0.72rem;color:#446;font-weight:700;">${formatJST(next.publishedAt,'mdow')}</div>
    <div style="font-size:0.72rem;font-weight:700;">${formatJST(next.publishedAt,'time')}</div>
    <div style="font-size:0.7rem;margin-top:2px;line-height:1.3;">${escapeHtml(next.title.slice(0,30))}${next.title.length>30?'…':''}</div>
  `;
}

// ===== 番組表 =====
const HOUR_START = 6;
const HOUR_END   = 26; // 翌2時まで
const SLOT_H_PX  = 36; // 1時間=36px（30分単位=18px）

function renderTimetable() {
  const table = document.getElementById('timetable');
  const today = todayJST();

  // 週の7日
  const days = Array.from({length: 7}, (_, i) => {
    const d = new Date(ttWeekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });

  // 週ラベル
  const DOW = ['月','火','水','木','金','土','日'];
  const fmt = d => {
    const p = n => String(n).padStart(2,'0');
    return `${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())}`;
  };
  document.getElementById('tt-week-range').textContent =
    `${days[0].getUTCFullYear()}年 ${fmt(days[0])}（月）〜${fmt(days[6])}（日）`;

  // このウィークの動画を抽出
  const weekEnd = new Date(days[6]);
  weekEnd.setUTCHours(23, 59, 59);

  const weekItems = allItems.filter(item => {
    const d = parseDate(item.publishedAt);
    if (!d) return false;
    const jst = toJST(d);
    const jstDate = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()));
    return jstDate >= ttWeekStart && jstDate <= weekEnd;
  });

  // テーブル構築
  let html = '<thead><tr>';
  html += '<th class="time-col">時刻</th>';
  days.forEach((d, i) => {
    const isToday = d.getTime() === today.getTime();
    const cls = i === 5 ? 'sat' : i === 6 ? 'sun' : '';
    html += `<th class="${cls}${isToday?' today-col':''}">${DOW[i]} ${fmt(d)}</th>`;
  });
  html += '</tr></thead><tbody>';

  // 時間スロット（30分単位）
  const slots = (HOUR_END - HOUR_START) * 2; // 30分単位スロット数
  for (let s = 0; s < slots; s++) {
    const hour   = HOUR_START + Math.floor(s / 2);
    const minute = s % 2 === 0 ? 0 : 30;
    const isHour = minute === 0;

    html += '<tr>';
    // 時刻列
    if (isHour) {
      html += `<td class="time-cell" rowspan="2">${hour}:00</td>`;
    }
    // 曜日列
    days.forEach((day, di) => {
      const isToday = day.getTime() === today.getTime();
      const cls = [
        isToday ? 'today-col' : '',
        !isHour ? 'half-hour' : ''
      ].filter(Boolean).join(' ');

      // この日・このスロットに始まる動画を探す
      const slotItems = weekItems.filter(item => {
        const d = parseDate(item.publishedAt);
        if (!d) return false;
        const j = toJST(d);
        const itemDate = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
        if (itemDate.getTime() !== day.getTime()) return false;
        const itemHour = j.getUTCHours();
        const itemMin  = j.getUTCMinutes();
        // 25時以降は翌日扱いのため+24補正
        const normHour = itemHour < HOUR_START ? itemHour + 24 : itemHour;
        return normHour === hour && (minute === 0 ? itemMin < 30 : itemMin >= 30);
      });

      html += `<td class="${cls}" data-day="${di}" data-hour="${hour}" data-min="${minute}">`;
      slotItems.forEach(item => {
        const j = toJST(parseDate(item.publishedAt));
        const hh = String(j.getUTCHours()).padStart(2,'0');
        const mi = String(j.getUTCMinutes()).padStart(2,'0');
        const thumb = item.thumbnail || item.thumbnailHigh || '';
        html += `
          <a class="tt-event cat-${item._cat}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
            ${thumb ? `<img class="ev-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
            <div class="ev-time">${hh}:${mi}</div>
            <div class="ev-title">${escapeHtml(item.title)}</div>
          </a>
        `;
      });
      html += '</td>';
    });
    html += '</tr>';
  }

  html += '</tbody>';
  table.innerHTML = html;
}

// ===== カレンダー =====
function renderCalendar() {
  const table = document.getElementById('calendar');
  const today = todayJST();
  document.getElementById('cal-month-label').textContent = `${calYear}年${String(calMonth+1).padStart(2,'0')}月`;

  const DOW_LABELS = ['月','火','水','木','金','土','日'];

  // 月の1日・末日
  const firstDay = new Date(Date.UTC(calYear, calMonth, 1));
  const lastDay  = new Date(Date.UTC(calYear, calMonth + 1, 0));

  // 月初の曜日（月曜始まり: 0=月 ... 6=日）
  let startDow = firstDay.getUTCDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // 月曜始まりに変換

  // この月の動画
  const monthItems = allItems.filter(item => {
    const d = parseDate(item.publishedAt);
    if (!d) return false;
    const j = toJST(d);
    return j.getUTCFullYear() === calYear && j.getUTCMonth() === calMonth;
  });

  // 日付ごとに動画をグルーピング
  const byDate = {};
  monthItems.forEach(item => {
    const j = toJST(parseDate(item.publishedAt));
    const key = j.getUTCDate();
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(item);
  });

  let html = '<thead><tr>';
  DOW_LABELS.forEach((d, i) => {
    const cls = i === 5 ? 'sat' : i === 6 ? 'sun' : '';
    html += `<th class="${cls}">${d}</th>`;
  });
  html += '</tr></thead><tbody>';

  let date = 1 - startDow; // グリッド左上の日付（前月末の日も含む）
  for (let row = 0; row < 6; row++) {
    // 最後の行が全部来月ならスキップ
    if (date > lastDay.getUTCDate()) break;
    html += '<tr>';
    for (let col = 0; col < 7; col++, date++) {
      const isOther = date < 1 || date > lastDay.getUTCDate();
      const actualDate = isOther ? null : date;
      const cellDate = isOther ? null : new Date(Date.UTC(calYear, calMonth, date));
      const isToday = cellDate && cellDate.getTime() === today.getTime();
      const isSat = col === 5;
      const isSun = col === 6;
      const cls = [
        isOther ? 'other-month' : '',
        isToday ? 'today-cell' : ''
      ].filter(Boolean).join(' ');

      html += `<td class="${cls}">`;
      if (actualDate !== null) {
        const numCls = ['cal-day-num', isSat?'sat':'', isSun?'sun':'', isToday?'today-num':''].filter(Boolean).join(' ');
        html += `<div style="text-align:right;"><span class="${numCls}">${actualDate}</span></div>`;
        const items = byDate[actualDate] || [];
        html += '<div class="cal-events">';
        const SHOW_MAX = 3;
        items.slice(0, SHOW_MAX).forEach(item => {
          const j = toJST(parseDate(item.publishedAt));
          const hh = String(j.getUTCHours()).padStart(2,'0');
          const mi = String(j.getUTCMinutes()).padStart(2,'0');
          const thumb = item.thumbnail || '';
          html += `
            <a class="cal-event cat-${item._cat}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
              ${thumb ? `<img class="cal-ev-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
              <span class="cal-ev-time">${hh}:${mi}</span>
              <span class="cal-ev-title"> ${escapeHtml(item.title)}</span>
            </a>
          `;
        });
        if (items.length > SHOW_MAX) {
          html += `<div class="cal-more">他 ${items.length - SHOW_MAX} 件</div>`;
        }
        html += '</div>';
      }
      html += '</td>';
    }
    html += '</tr>';
  }

  html += '</tbody>';
  table.innerHTML = html;
}

// ===== アーカイブ =====
function renderArchive() {
  // アーカイブ対象：live/upcomingでないもの
  const archiveItems = allItems
    .filter(item => item._cat !== 'upcoming' && item._cat !== 'live')
    .sort((a, b) => (parseDate(b.publishedAt)||0) - (parseDate(a.publishedAt)||0));

  // カテゴリ集計
  const cats = {};
  archiveItems.forEach(item => {
    cats[item._cat] = (cats[item._cat] || 0) + 1;
  });

  // フィルターボタン
  const filterEl = document.getElementById('archive-filter');
  let filterHtml = `<button class="filter-btn ${archiveFilter==='all'?'active':''}" data-cat="all">すべて ${archiveItems.length}</button>`;
  Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([cat, count]) => {
    filterHtml += `<button class="filter-btn ${archiveFilter===cat?'active':''}" data-cat="${cat}">${getCatLabel(cat)} ${count}</button>`;
  });
  filterEl.innerHTML = filterHtml;

  // フィルター・検索を適用
  let filtered = archiveItems;
  if (archiveFilter !== 'all') {
    filtered = filtered.filter(item => item._cat === archiveFilter);
  }
  if (archiveSearch) {
    const q = archiveSearch.toLowerCase();
    filtered = filtered.filter(item => item.title.toLowerCase().includes(q));
  }

  document.getElementById('archive-count').textContent = `${filtered.length}件`;

  // 月ごとにグループ化
  const byMonth = {};
  filtered.forEach(item => {
    const j = toJST(parseDate(item.publishedAt));
    const key = `${j.getUTCFullYear()}年${String(j.getUTCMonth()+1).padStart(2,'0')}月`;
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(item);
  });

  const listEl = document.getElementById('archive-list');
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-msg">該当する動画が見つかりませんでした。</div>';
    return;
  }

  let html = '';
  Object.entries(byMonth).forEach(([month, items]) => {
    html += `<div class="archive-month-header">${month}</div>`;
    items.forEach(item => {
      const thumb = item.thumbnailHigh || item.thumbnail || '';
      const date  = formatJST(item.publishedAt, 'datetime');
      html += `
        <div class="archive-item">
          ${thumb ? `<img class="archive-item-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
          <div class="archive-item-info">
            <div class="archive-item-date">
              ${date}
              <span class="cat-badge cat-${item._cat}">${getCatLabel(item._cat)}</span>
            </div>
            <div class="archive-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          </div>
          <a class="archive-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">アーカイブを見る</a>
        </div>
      `;
    });
  });
  listEl.innerHTML = html;
}

// ===== イベントバインド =====
function initEvents() {
  // タブ切り替え
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // 番組表ナビ
  document.getElementById('tt-prev').addEventListener('click', () => {
    ttWeekStart.setUTCDate(ttWeekStart.getUTCDate() - 7);
    renderTimetable();
  });
  document.getElementById('tt-next').addEventListener('click', () => {
    ttWeekStart.setUTCDate(ttWeekStart.getUTCDate() + 7);
    renderTimetable();
  });
  document.getElementById('tt-today').addEventListener('click', () => {
    ttWeekStart = getWeekStart(todayJST());
    renderTimetable();
  });

  // カレンダーナビ
  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  // アーカイブフィルター（動的要素なのでdelegation）
  document.getElementById('archive-filter').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    archiveFilter = btn.dataset.cat;
    renderArchive();
  });

  // アーカイブ検索
  document.getElementById('archive-search').addEventListener('input', e => {
    archiveSearch = e.target.value.trim();
    renderArchive();
  });
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  loadData();
});
