/**
 * はすてぃあ 配信スケジュール - app.js
 */

const DATA_URL = './data/videos.json';

// ===== カテゴリ定義 =====
// 優先順位：上から順に判定し、最初にマッチしたカテゴリを使用
const CATEGORIES = [
  {
    key: 'live',
    label: 'LIVE中',
    match: (item) => item.liveBroadcastContent === 'live',
  },
  {
    key: 'upcoming',
    label: '配信予定',
    match: (item) => item.liveBroadcastContent === 'upcoming' || item.category === 'upcoming',
  },
  {
    // ショートは live/upcoming より後だが isShort フラグを最優先
    // ※ live/upcoming のショートは存在しないので実質問題なし
    key: 'short',
    label: 'ショート',
    match: (item) =>
      item.isShort === true ||
      item.url?.includes('/shorts/') ||
      /[#＃]shorts?\b/i.test(item.title) ||
      /\/shorts\//i.test(item.url),
  },
  {
    key: 'singing',
    label: '歌ってみた',
    match: (item) => /歌ってみた|うたってみた|covered|cover(?!コラボ)/i.test(item.title),
  },
  {
    key: 'sing',
    label: '歌枠',
    match: (item) => /歌枠|歌回|歌配信|カラオケ|うた枠|うた回/i.test(item.title),
  },
  {
    key: 'asmr',
    label: 'ASMR',
    match: (item) => /asmr/i.test(item.title),
  },
  {
    key: 'memorial',
    label: '記念',
    match: (item) => /記念|anniversary|バースデー|誕生日|周年/i.test(item.title),
  },
  {
    key: 'collab',
    label: 'コラボ',
    match: (item) => /コラボ|collab|対談|collaboration/i.test(item.title),
  },
  {
    key: 'game',
    label: 'ゲーム',
    // タイトルに【〜】形式のゲームタイトルがある or ゲームキーワード
    match: (item) => {
      const t = item.title;
      // 【タイトル名】パターン（配信でよく使われる形式）
      if (/【[^】]+】/.test(t)) return true;
      // 具体的なゲームキーワード
      return /ゲーム|マイクラ|minecraft|apex|valorant|スプラ|splatoon|ポケモン|pokemon|ドラクエ|ドラゴンクエスト|ドラゴンボール|ff\d|ファイナルファンタジー|モンハン|zelda|ゼルダ|大神|バイオ|resident evil|sekiro|elden|yakuza|龍が如く|genshin|原神|星レイル|パルワールド|fortnite|overwatch|stardew|animal crossing|あつ森|テトリス|ぷよぷよ|fall guys|among us|カービィ|mario|マリオ|kirby|simulator|シミュレーター|ramen|カカロット|kakarot/i.test(t);
    },
  },
  {
    key: 'chat',
    label: '雑談・その他',
    match: () => true, // デフォルト（どれにも当てはまらない場合）
  },
];

function detectCategory(item) {
  for (const cat of CATEGORIES) {
    if (cat.match(item)) return cat.key;
  }
  return 'chat';
}

function getCatLabel(key) {
  const cat = CATEGORIES.find(c => c.key === key);
  return cat ? cat.label : 'その他';
}

// ===== 日時ユーティリティ =====
function parseDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}

function toJST(d) {
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
  const j = toJST(new Date());
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
}

function getWeekStart(base) {
  // 日曜始まり
  const d = new Date(base);
  const day = d.getUTCDay(); // 0=Sun
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ===== 表示用日時取得（配信予定・ライブ・アーカイブはscheduledStartTime優先）=====
function getDisplayTime(item) {
  // 配信予定・ライブ中：scheduledStartTime（配信予定時間）を優先
  if ((item._cat === 'upcoming' || item._cat === 'live') && item.scheduledStartTime) {
    return item.scheduledStartTime;
  }
  return item.publishedAt;
}
let allItems    = [];
let ttWeekStart = null;
let calYear     = 0;
let calMonth    = 0;
let archiveFilter  = 'all';
let archiveSearch  = '';

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
      .filter(item => item.id)
      .map(item => ({ ...item, _cat: detectCategory(item) }));

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
  }
}

// ===== 次の配信 =====
function renderNextStream() {
  const now = new Date();
  const upcoming = allItems
    .filter(item => {
      const d = parseDate(item.publishedAt);
      return d && d > now && (item._cat === 'upcoming' || item._cat === 'live');
    })
    .sort((a, b) => parseDate(a.publishedAt) - parseDate(b.publishedAt));

  const el = document.getElementById('next-stream-info');
  if (!upcoming.length) {
    el.textContent = '未発表です';
    return;
  }
  const next = upcoming[0];
  el.innerHTML = `
    <div style="font-size:0.72rem;color:#cc4444;font-weight:700;">${formatJST(next.publishedAt,'mdow')}</div>
    <div style="font-size:0.8rem;font-weight:700;">${formatJST(next.publishedAt,'time')}</div>
    <div style="font-size:0.7rem;margin-top:2px;line-height:1.3;color:#bbb;">${escapeHtml(next.title.slice(0,28))}${next.title.length>28?'…':''}</div>
  `;
}

// ===== 番組表 =====
const HOUR_START = 6;
const HOUR_END   = 29; // 29時（翌5時）まで
const ROW_H_PX   = 40; // 1時間=40px

function renderTimetable() {
  const table = document.getElementById('timetable');
  const today = todayJST();

  const days = Array.from({length: 7}, (_, i) => {
    const d = new Date(ttWeekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });

  const DOW = ['日','月','火','水','木','金','土'];
  const fmt = d => {
    const p = n => String(n).padStart(2,'0');
    return `${p(d.getUTCMonth()+1)}/${p(d.getUTCDate())}`;
  };

  document.getElementById('tt-week-range').textContent =
    `${days[0].getUTCFullYear()}年 ${fmt(days[0])}（日）〜${fmt(days[6])}（土）`;

  const weekEnd = new Date(days[6]);
  weekEnd.setUTCHours(23, 59, 59);

  // この週のアイテム（29時=翌5時対応のため翌日分も含める）
  const weekItems = allItems.filter(item => {
    const d = parseDate(item.publishedAt);
    if (!d) return false;
    const j = toJST(d);
    const jstDate = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
    // 29時対応：0〜5時は前日扱い
    const h = j.getUTCHours();
    const adjustedDate = (h < HOUR_START) 
      ? new Date(jstDate.getTime() - 24*60*60*1000)
      : jstDate;
    return adjustedDate >= ttWeekStart && adjustedDate <= weekEnd;
  });

  let html = '<thead><tr>';
  html += '<th class="time-col">時刻</th>';
  days.forEach((d, i) => {
    const isToday = d.getTime() === today.getTime();
    // 日始まり: 0=日, 6=土
    const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    html += `<th class="${cls}${isToday?' today-col':''}">${DOW[i]} ${fmt(d)}</th>`;
  });
  html += '</tr></thead><tbody>';

  // 1時間単位でループ
  for (let hour = HOUR_START; hour < HOUR_END; hour++) {
    const displayHour = hour >= 24 ? hour - 24 : hour; // 表示用（24以降は0時台に）
    html += '<tr>';
    html += `<td class="time-cell">${String(hour).padStart(2,'0')}:00</td>`;

    days.forEach((day, di) => {
      const isToday = day.getTime() === today.getTime();
      html += `<td class="${isToday ? 'today-col' : ''}" data-day="${di}" data-hour="${hour}">`;

      // この日・この時間帯のアイテム
      const slotItems = weekItems.filter(item => {
        const d = parseDate(item.publishedAt);
        if (!d) return false;
        const j = toJST(d);
        const h = j.getUTCHours();
        // 29時対応：0〜5時は実際には前日の24〜29時
        const normHour = h < HOUR_START ? h + 24 : h;
        const jstDate = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
        const adjustedDate = h < HOUR_START
          ? new Date(jstDate.getTime() - 24*60*60*1000)
          : jstDate;
        return adjustedDate.getTime() === day.getTime() && normHour === hour;
      });

      slotItems.forEach(item => {
        const j = toJST(parseDate(getDisplayTime(item)));
        const h = j.getUTCHours();
        const normHour = h < HOUR_START ? h + 24 : h;
        const hh = String(normHour).padStart(2, '0');
        const mi = String(j.getUTCMinutes()).padStart(2, '0');
        const thumb = item.thumbnail || '';
        html += `
          <a class="tt-event cat-${item._cat}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
            ${thumb ? `<img class="ev-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
            <div class="ev-time">${hh}:${mi}</div>
            <div class="ev-title">${escapeHtml(item.title)}</div>
          </a>`;
      });

      html += '</td>';
    });
    html += '</tr>';
  }

  html += '</tbody>';
  table.innerHTML = html;

  // 直近イベントか現在時刻にスクロール
  scrollTimetableToEvent();
}

function scrollTimetableToEvent() {
  const scroll = document.querySelector('.timetable-scroll');
  if (!scroll) return;

  const now = new Date();
  const jNow = toJST(now);
  const currentHour = jNow.getUTCHours();
  const normNow = currentHour < HOUR_START ? currentHour + 24 : currentHour;

  // 今週の直近イベントを探す
  const today = todayJST();
  const weekEnd = new Date(ttWeekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const thisWeekItems = allItems
    .filter(item => {
      const d = parseDate(item.publishedAt);
      if (!d) return false;
      const j = toJST(d);
      const jstDate = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
      const h = j.getUTCHours();
      const adjustedDate = h < HOUR_START ? new Date(jstDate.getTime() - 86400000) : jstDate;
      return adjustedDate >= ttWeekStart && adjustedDate < weekEnd;
    })
    .map(item => {
      const j = toJST(parseDate(getDisplayTime(item)));
      const h = j.getUTCHours();
      return { ...item, _normHour: h < HOUR_START ? h + 24 : h, _jst: j };
    })
    .sort((a, b) => parseDate(a.publishedAt) - parseDate(b.publishedAt));

  let targetHour = null;

  // 今週表示中なら：現在時刻以降で最初のイベント
  if (ttWeekStart.getTime() === getWeekStart(today).getTime()) {
    const future = thisWeekItems.find(item => parseDate(item.publishedAt) >= now);
    if (future) {
      targetHour = future._normHour;
    } else {
      // イベントなければ現在時刻
      targetHour = normNow;
    }
  } else {
    // 他の週：その週の最初のイベント
    if (thisWeekItems.length > 0) {
      targetHour = thisWeekItems[0]._normHour;
    } else {
      targetHour = HOUR_START;
    }
  }

  if (targetHour === null) targetHour = 20; // デフォルト20時

  // スクロール位置計算（ヘッダー分を引いて少し上に余白）
  const headerHeight = 36;
  const rowIndex = Math.max(0, targetHour - HOUR_START);
  const scrollTop = rowIndex * ROW_H_PX - 60; // 少し上に余白
  scroll.scrollTop = Math.max(0, scrollTop);
}

// ===== カレンダー =====
function renderCalendar() {
  const table = document.getElementById('calendar');
  const today = todayJST();
  document.getElementById('cal-month-label').textContent =
    `${calYear}年${String(calMonth+1).padStart(2,'0')}月`;

  const DOW_LABELS = ['日','月','火','水','木','金','土'];
  const firstDay = new Date(Date.UTC(calYear, calMonth, 1));
  const lastDay  = new Date(Date.UTC(calYear, calMonth + 1, 0));

  // 日始まり：firstDayのUTCDay()がそのままオフセット (0=日)
  let startDow = firstDay.getUTCDay();

  const monthItems = allItems.filter(item => {
    const d = parseDate(item.publishedAt);
    if (!d) return false;
    const j = toJST(d);
    return j.getUTCFullYear() === calYear && j.getUTCMonth() === calMonth;
  });

  const byDate = {};
  monthItems.forEach(item => {
    const j = toJST(parseDate(item.publishedAt));
    const key = j.getUTCDate();
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(item);
  });

  let html = '<thead><tr>';
  DOW_LABELS.forEach((d, i) => {
    const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    html += `<th class="${cls}">${d}</th>`;
  });
  html += '</tr></thead><tbody>';

  let date = 1 - startDow;
  for (let row = 0; row < 6; row++) {
    if (date > lastDay.getUTCDate()) break;
    html += '<tr>';
    for (let col = 0; col < 7; col++, date++) {
      const isOther = date < 1 || date > lastDay.getUTCDate();
      const actualDate = isOther ? null : date;
      const cellDate = isOther ? null : new Date(Date.UTC(calYear, calMonth, date));
      const isToday = cellDate && cellDate.getTime() === today.getTime();
      const isSat = col === 6;
      const isSun = col === 0;
      const cls = [
        isOther ? 'other-month' : '',
        isToday ? 'today-cell' : ''
      ].filter(Boolean).join(' ');

      html += `<td class="${cls}">`;
      if (actualDate !== null) {
        const numCls = ['cal-day-num', isSat?'sat':'', isSun?'sun':'', isToday?'today-num':''].filter(Boolean).join(' ');
        html += `<div style="text-align:right;"><span class="${numCls}">${actualDate}</span></div>`;
        const items = (byDate[actualDate] || []).sort((a,b)=>parseDate(a.publishedAt)-parseDate(b.publishedAt));
        html += '<div class="cal-events">';
        const MAX = 3;
        items.slice(0, MAX).forEach(item => {
          const j = toJST(parseDate(getDisplayTime(item)));
          const hh = String(j.getUTCHours()).padStart(2,'0');
          const mi = String(j.getUTCMinutes()).padStart(2,'0');
          const thumb = item.thumbnail || '';
          html += `
            <a class="cal-event cat-${item._cat}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
              ${thumb ? `<img class="cal-ev-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
              <span class="cal-ev-time">${hh}:${mi}</span>
              <span class="cal-ev-title"> ${escapeHtml(item.title)}</span>
            </a>`;
        });
        if (items.length > MAX) {
          html += `<div class="cal-more">他 ${items.length - MAX} 件</div>`;
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
  const archiveItems = allItems
    .filter(item => item._cat !== 'upcoming' && item._cat !== 'live')
    .sort((a, b) => (parseDate(b.publishedAt)||0) - (parseDate(a.publishedAt)||0));

  // カテゴリ集計（CATEGORIES順を維持）
  const catOrder = CATEGORIES.map(c => c.key).filter(k => k !== 'live' && k !== 'upcoming');
  const cats = {};
  archiveItems.forEach(item => { cats[item._cat] = (cats[item._cat]||0) + 1; });

  const filterEl = document.getElementById('archive-filter');
  let filterHtml = `<button class="filter-btn ${archiveFilter==='all'?'active':''}" data-cat="all">すべて ${archiveItems.length}</button>`;
  catOrder.filter(k => cats[k]).forEach(cat => {
    filterHtml += `<button class="filter-btn ${archiveFilter===cat?'active':''}" data-cat="${cat}">${getCatLabel(cat)} ${cats[cat]}</button>`;
  });
  filterEl.innerHTML = filterHtml;

  let filtered = archiveItems;
  if (archiveFilter !== 'all') filtered = filtered.filter(i => i._cat === archiveFilter);
  if (archiveSearch) {
    const q = archiveSearch.toLowerCase();
    filtered = filtered.filter(i => i.title.toLowerCase().includes(q));
  }

  document.getElementById('archive-count').textContent = `${filtered.length}件`;

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
      const date  = formatJST(getDisplayTime(item), 'datetime');
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
        </div>`;
    });
  });
  listEl.innerHTML = html;
}

// ===== イベントバインド =====
function initEvents() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      // 番組表タブに切り替えたらスクロール位置を再設定
      if (btn.dataset.tab === 'timetable') {
        setTimeout(scrollTimetableToEvent, 50);
      }
    });
  });

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

  document.getElementById('archive-filter').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    archiveFilter = btn.dataset.cat;
    renderArchive();
  });

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
