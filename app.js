/**
 * はすてぃあ 配信スケジュール - app.js
 */

const DATA_URL = './data/videos.json';

// ===== カテゴリ定義 =====
// 優先順位：上から順に判定し、最初にマッチしたカテゴリを使用
const CATEGORIES = [
  {
    // 配信予定・ライブ中も含め、すべて以下の区分のいずれかに振り分ける
    key: 'short',
    label: 'ショート',
    match: (item) =>
      item.isShort === true ||
      item.url?.includes('/shorts/') ||
      /[#＃]shorts?\b/i.test(item.title),
  },
  {
    key: 'singing',
    label: '歌ってみた',
    // 英単語は \b で単語として一致させる（discover / recover などに反応しないように）
    match: (item) => /歌ってみた|うたってみた|\bcover(?:ed)?\b/i.test(item.title),
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
    match: (item) => /記念|anniversary|バースデー|誕生日|周年|初配信/i.test(item.title),
  },
  {
    key: 'collab',
    label: 'コラボ',
    match: (item) => /コラボ|対談|\bcollab(?:oration)?\b/i.test(item.title),
  },
  {
    key: 'game',
    label: 'ゲーム',
    // タイトルに【〜】形式のゲームタイトルがある or ゲームキーワード
    match: (item) => {
      const t = item.title;
      // 「食べ比べ」を含む場合はゲームではなく雑談・その他にする
      if (/食べ比べ/.test(t)) return false;
      // 【タイトル名】パターン（配信でよく使われる形式）
      if (/【[^】]+】/.test(t)) return true;
      // 具体的なゲームキーワード（日本語）
      if (/ゲーム|マイクラ|スプラ|ポケモン|ドラクエ|ドラゴンクエスト|ドラゴンボール|ファイナルファンタジー|モンハン|ゼルダ|大神|バイオハザード|龍が如く|原神|星レイル|パルワールド|あつ森|テトリス|ぷよぷよ|カービィ|マリオ|シミュレーター|カカロット/.test(t)) return true;
      // 具体的なゲームキーワード（英語。\b で単語として一致させる）
      return /\b(?:minecraft|apex|valorant|splatoon|pokemon|ff\d{1,2}|zelda|resident evil|sekiro|elden ring|yakuza|genshin|fortnite|overwatch|stardew|animal crossing|fall guys|among us|mario|kirby|simulator|kakarot)\b/i.test(t);
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
const DOW = ['日','月','火','水','木','金','土'];
const pad2 = n => String(n).padStart(2, '0');

function parseDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toJST(d) {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}

// yyyy/mm/dd(曜) hh:mm
function formatJST(iso) {
  const d = parseDate(iso);
  if (!d) return '';
  const j = toJST(d);
  return `${j.getUTCFullYear()}/${pad2(j.getUTCMonth() + 1)}/${pad2(j.getUTCDate())}(${DOW[j.getUTCDay()]}) ${pad2(j.getUTCHours())}:${pad2(j.getUTCMinutes())}`;
}

function todayJST() {
  const j = toJST(new Date());
  return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()));
}

function getWeekStart(base) {
  // 日曜始まり
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// style 属性に入れる色は、#RGB / #RRGGBB(AA) / rgb()/rgba() / 英字の色名のみ許可する
function safeColor(c, fallback = 'inherit') {
  const s = String(c ?? '').trim();
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;
  if (/^rgba?\(\s*[\d.\s,%]+\)$/i.test(s)) return s;
  if (/^[a-z]{3,20}$/i.test(s)) return s;
  return fallback;
}

// UTC の Date から年月日を YYYY-MM-DD にする（日付キー用）
function dateKey(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ===== 表示用日時取得（配信予定・ライブ・アーカイブは配信開始時刻優先）=====
function getDisplayTime(item) {
  const lbc = item.liveBroadcastContent;
  // 配信予定：scheduledStartTime（配信予定時間）
  if (lbc === 'upcoming' && item.scheduledStartTime) {
    return item.scheduledStartTime;
  }
  // ライブ中・アーカイブ：actualStartTime > scheduledStartTime > publishedAt の優先順位
  if (lbc === 'live' || item.category === 'archive') {
    if (item.actualStartTime)    return item.actualStartTime;
    if (item.scheduledStartTime) return item.scheduledStartTime;
  }
  return item.publishedAt;
}

// 表示に使う日時（Date）。週間・月間・検索タブで同じ基準を使う
function itemDate(item) {
  return parseDate(getDisplayTime(item));
}

const byItemDate = (a, b) => (itemDate(a) || 0) - (itemDate(b) || 0);

// ===== 放送日（29時制）=====
// 番組表は 6:00〜29:00（翌5時）で1日とする。0〜5時台は前日の 24〜29時として扱う
// 週間・月間のどちらもこの基準で日付を決める
const HOUR_START = 6;
const HOUR_END   = 29;

// アイテムの放送日（UTC 0時の Date）・時（6〜29）・分を返す。日時が無ければ null
function broadcastSlot(item) {
  const d = itemDate(item);
  if (!d) return null;
  const j = toJST(d);
  const h = j.getUTCHours();
  const late = h < HOUR_START;
  const day = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() - (late ? 1 : 0)));
  return { day, hour: late ? h + 24 : h, minute: j.getUTCMinutes() };
}

// 「HH:MM」（24時以降は 24:xx〜29:xx と表記）
function slotTimeLabel(slot) {
  return `${pad2(slot.hour)}:${pad2(slot.minute)}`;
}

// ===== グローバル状態 =====
let allItems         = [];
let allAnniversaries = [];
let ttWeekStart      = null;
let calYear          = 0;
let calMonth         = 0;
let archiveFilter    = 'all';
let archiveSearch    = '';

// ===== 記念日計算 =====
// 指定年月に該当する記念日を返す（JST年月で渡す）
function getAnniversariesForMonth(jstYear, jstMonth) {
  const result = [];
  for (const ann of allAnniversaries) {
    // 毎年繰り返し（誕生日など）
    if (ann.yearly) {
      if (ann.month === jstMonth + 1) {
        result.push({ day: ann.day, label: ann.label, color: ann.color, textColor: ann.textColor });
      }
    }
    // 毎月繰り返し（デビューnか月記念日）
    else if (ann.monthly) {
      const base = new Date(Date.UTC(ann.baseYear, ann.baseMonth - 1, ann.baseDay));
      const target = new Date(Date.UTC(jstYear, jstMonth, ann.baseDay));
      if (target > base) {
        // 経過月数を計算
        const months = (jstYear - ann.baseYear) * 12 + (jstMonth - (ann.baseMonth - 1));
        if (months > 0) {
          const label = ann.label.replace('{n}', months);
          result.push({ day: ann.baseDay, label, color: ann.color, textColor: ann.textColor });
        }
      }
    }
    // 単発記念日
    else {
      if (ann.year === jstYear && ann.month === jstMonth + 1) {
        result.push({ day: ann.day, label: ann.label, color: ann.color, textColor: ann.textColor });
      }
    }
  }
  return result;
}

// 指定週（7日分）に該当する記念日を返す { 'YYYY-MM-DD': [...] }
function getAnniversariesForWeek(days) {
  const result = {};
  for (const day of days) {
    const jstYear  = day.getUTCFullYear();
    const jstMonth = day.getUTCMonth(); // 0-indexed
    const jstDay   = day.getUTCDate();
    const anns = getAnniversariesForMonth(jstYear, jstMonth).filter(a => a.day === jstDay);
    if (anns.length > 0) result[dateKey(day)] = anns;
  }
  return result;
}

// 記念日バッジのHTML
function annBadgeHtml(ann) {
  return `<div class="ann-badge" style="background:${safeColor(ann.color, 'transparent')};color:${safeColor(ann.textColor)};">${escapeHtml(ann.label)}</div>`;
}

// ===== データ読み込み =====
async function loadData() {
  try {
    // 動画データと記念日データを並行取得
    // 記念日データの取得に失敗しても、動画データは表示する
    const [videoResult, annResult] = await Promise.allSettled([
      fetch(`${DATA_URL}?t=${Date.now()}`),
      fetch(`./data/anniversaries.json?t=${Date.now()}`)
    ]);
    if (videoResult.status !== 'fulfilled') throw videoResult.reason;
    const res = videoResult.value;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (annResult.status === 'fulfilled' && annResult.value.ok) {
      try {
        const annData = await annResult.value.json();
        allAnniversaries = Array.isArray(annData.items) ? annData.items : [];
      } catch (e) {
        console.warn('記念日データを読み込めませんでした:', e);
      }
    } else {
      console.warn('記念日データを取得できませんでした');
    }

    if (data.updatedAt) {
      document.getElementById('updatedAt').textContent = formatJST(data.updatedAt);
    }

    allItems = (Array.isArray(data.items) ? data.items : [])
      .filter(item => item.id)
      .map(item => {
        // タイトルが欠けていても判定・表示で落ちないよう文字列にそろえる
        const it = { ...item, title: String(item.title || '') };
        it._cat = detectCategory(it);
        return it;
      });

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

// ===== 凡例レンダリング =====
// 常に全カテゴリを表示する
function renderLegend(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;

  const style = getComputedStyle(document.documentElement);
  let html = '';
  CATEGORIES.forEach(cat => {
    const bg  = safeColor(style.getPropertyValue(`--cat-${cat.key}`), 'transparent');
    const txt = safeColor(style.getPropertyValue(`--cat-${cat.key}-txt`), 'var(--color-text-sub)');
    // 枠線は文字色を薄くしたもの（#RRGGBB のときだけ透明度 20% を付ける）
    const outline = /^#[0-9a-f]{6}$/i.test(txt) ? `${txt}33` : 'transparent';
    html += `<span class="legend-item">
      <span class="legend-dot" style="background:${bg};outline:1px solid ${outline};"></span>
      <span style="color:${txt};">${escapeHtml(cat.label)}</span>
    </span>`;
  });
  el.innerHTML = html;
}

// 予定1件分のリンクHTML（週間・月間で共通の中身）
function eventLinkInner(item, slot, thumbClass, timeTag, titleTag) {
  const thumb = item.thumbnail || '';
  return `
      ${thumb ? `<img class="${thumbClass}" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
      <${timeTag} class="${timeTag === 'div' ? 'ev-time' : 'cal-ev-time'}">${slotTimeLabel(slot)}</${timeTag}>
      <${titleTag} class="${titleTag === 'div' ? 'ev-title' : 'cal-ev-title'}">${escapeHtml(item.title)}</${titleTag}>`;
}

// ===== 番組表（週間）=====
const ROW_H_PX = 40; // 1時間=40px（PC表示時）

function renderTimetable() {
  const table = document.getElementById('timetable');
  const today = todayJST();

  const days = Array.from({length: 7}, (_, i) => {
    const d = new Date(ttWeekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });

  const fmt = d => `${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
  // 週ラベル：yyyy/mm/dd(曜) ~ yyyy/mm/dd(曜)
  const fmtFull = d => `${d.getUTCFullYear()}/${fmt(d)}(${DOW[d.getUTCDay()]})`;
  document.getElementById('tt-week-range').textContent =
    `${fmtFull(days[0])} ~ ${fmtFull(days[6])}`;

  // この週のアイテムを「放送日 × 時」ごとにまとめる
  const dayIndex = new Map(days.map((d, i) => [d.getTime(), i]));
  const slots = {};
  allItems.forEach(item => {
    const slot = broadcastSlot(item);
    if (!slot) return;
    const di = dayIndex.get(slot.day.getTime());
    if (di === undefined) return;
    const key = `${di}-${slot.hour}`;
    if (!slots[key]) slots[key] = [];
    slots[key].push({ item, slot });
  });
  Object.values(slots).forEach(list => list.sort((a, b) => byItemDate(a.item, b.item)));

  let html = '<thead><tr>';
  html += '<th class="time-col" scope="col">時刻</th>';
  days.forEach(d => {
    const isToday = d.getTime() === today.getTime();
    const dow = d.getUTCDay(); // 0=日, 6=土
    const cls = dow === 0 ? 'sun' : dow === 6 ? 'sat' : '';
    html += `<th scope="col" class="${cls}${isToday ? ' today-col' : ''}">${fmt(d)}<br>${DOW[dow]}</th>`;
  });
  html += '</tr>';

  // 記念日行
  const weekAnns = getAnniversariesForWeek(days);
  if (Object.keys(weekAnns).length > 0) {
    html += '<tr>';
    html += '<td class="time-cell" style="font-size:0.68rem;color:#886666;">記念日</td>';
    days.forEach(d => {
      html += '<td style="padding:2px;vertical-align:top;">';
      (weekAnns[dateKey(d)] || []).forEach(ann => { html += annBadgeHtml(ann); });
      html += '</td>';
    });
    html += '</tr>';
  }

  html += '</thead><tbody>';

  // 1時間単位でループ（6:00〜28:00）
  for (let hour = HOUR_START; hour < HOUR_END; hour++) {
    html += '<tr>';
    html += `<td class="time-cell">${pad2(hour)}:00</td>`;

    days.forEach((day, di) => {
      const isToday = day.getTime() === today.getTime();
      html += `<td class="${isToday ? 'today-col' : ''}">`;
      const list = slots[`${di}-${hour}`];
      if (list) {
        // 同じ時間帯に複数ある場合も重ならないよう、縦に並べる
        html += '<div class="tt-slot">';
        list.forEach(({ item, slot }) => {
          html += `
          <a class="tt-event cat-${item._cat}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
            ${eventLinkInner(item, slot, 'ev-thumb', 'div', 'div')}
          </a>`;
        });
        html += '</div>';
      }
      html += '</td>';
    });
    html += '</tr>';
  }

  html += '</tbody>';
  table.innerHTML = html;

  // 凡例を更新（常に全カテゴリ）
  renderLegend('tt-legend');

  // 直近イベントか現在時刻にスクロール
  scrollTimetableToEvent();
}

function scrollTimetableToEvent() {
  const scroll = document.querySelector('.timetable-scroll');
  if (!scroll || !ttWeekStart) return;

  const now = new Date();
  const weekEnd = new Date(ttWeekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const weekItems = allItems
    .map(item => ({ slot: broadcastSlot(item), date: itemDate(item) }))
    .filter(x => x.slot && x.slot.day >= ttWeekStart && x.slot.day < weekEnd)
    .sort((a, b) => a.date - b.date);

  let targetHour;
  if (ttWeekStart.getTime() === getWeekStart(todayJST()).getTime()) {
    // 今週表示中なら：現在時刻以降で最初のイベント。なければ現在時刻
    const future = weekItems.find(x => x.date >= now);
    if (future) {
      targetHour = future.slot.hour;
    } else {
      const h = toJST(now).getUTCHours();
      targetHour = h < HOUR_START ? h + 24 : h;
    }
  } else {
    // 他の週：その週の最初のイベント
    targetHour = weekItems.length > 0 ? weekItems[0].slot.hour : HOUR_START;
  }

  const rowIndex = Math.max(0, targetHour - HOUR_START);
  scroll.scrollTop = Math.max(0, rowIndex * ROW_H_PX - 60); // 少し上に余白
}

// ===== カレンダー（月間）=====
function renderCalendar() {
  const table = document.getElementById('calendar');
  const today = todayJST();
  document.getElementById('cal-month-label').textContent = `${calYear}/${pad2(calMonth + 1)}`;

  const firstDay = new Date(Date.UTC(calYear, calMonth, 1));
  const lastDate = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
  // 日始まり：firstDayのUTCDay()がそのままオフセット (0=日)
  const startDow = firstDay.getUTCDay();

  // この月のアイテムを放送日ごとにまとめる（週間と同じ基準）
  const byDate = {};
  allItems.forEach(item => {
    const slot = broadcastSlot(item);
    if (!slot) return;
    if (slot.day.getUTCFullYear() !== calYear || slot.day.getUTCMonth() !== calMonth) return;
    const key = slot.day.getUTCDate();
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push({ item, slot });
  });

  // 記念日は月に1回だけ計算する
  const monthAnns = getAnniversariesForMonth(calYear, calMonth);

  let html = '<thead><tr>';
  DOW.forEach((d, i) => {
    const cls = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    html += `<th scope="col" class="${cls}">${d}</th>`;
  });
  html += '</tr></thead><tbody>';

  const MAX = 3;
  let date = 1 - startDow;
  for (let row = 0; row < 6; row++) {
    if (date > lastDate) break;
    html += '<tr>';
    for (let col = 0; col < 7; col++, date++) {
      const isOther = date < 1 || date > lastDate;
      const isToday = !isOther && Date.UTC(calYear, calMonth, date) === today.getTime();
      const cls = [isOther ? 'other-month' : '', isToday ? 'today-cell' : ''].filter(Boolean).join(' ');

      html += `<td class="${cls}">`;
      if (!isOther) {
        const numCls = ['cal-day-num', col === 6 ? 'sat' : '', col === 0 ? 'sun' : '', isToday ? 'today-num' : ''].filter(Boolean).join(' ');
        html += `<div style="text-align:right;"><span class="${numCls}">${date}</span></div>`;
        const list = (byDate[date] || []).sort((a, b) => byItemDate(a.item, b.item));
        html += '<div class="cal-events">';
        monthAnns.filter(a => a.day === date).forEach(ann => { html += annBadgeHtml(ann); });
        list.slice(0, MAX).forEach(({ item, slot }) => {
          html += `
            <a class="cal-event cat-${item._cat}" href="${escapeHtml(item.url)}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
              ${eventLinkInner(item, slot, 'cal-ev-thumb', 'span', 'span')}
            </a>`;
        });
        if (list.length > MAX) {
          html += `<div class="cal-more">他 ${list.length - MAX} 件</div>`;
        }
        // 予定がない日：予定1件分の高さを確保するため、見えない予定カードを入れる
        if (list.length === 0) {
          html += `
            <div class="cal-event cal-event-ghost" aria-hidden="true">
              <div class="cal-ev-thumb-ghost"></div>
              <span class="cal-ev-time">&nbsp;</span>
              <span class="cal-ev-title">&nbsp;<br>&nbsp;</span>
            </div>`;
        }
        html += '</div>';
      }
      html += '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody>';
  table.innerHTML = html;

  // 凡例を更新（常に全カテゴリ）
  renderLegend('cal-legend');
}

// ===== 検索タブ（動画一覧。関数名・id は旧名 archive のまま）=====
function renderArchive() {
  const archiveItems = allItems
    .filter(item => item.liveBroadcastContent !== 'live')
    .sort((a, b) => byItemDate(b, a));

  // カテゴリ集計（CATEGORIES順を維持）
  const cats = {};
  archiveItems.forEach(item => { cats[item._cat] = (cats[item._cat] || 0) + 1; });

  const filterEl = document.getElementById('archive-filter');
  let filterHtml = `<button class="filter-btn ${archiveFilter === 'all' ? 'active' : ''}" data-cat="all" aria-pressed="${archiveFilter === 'all'}">すべて ${archiveItems.length}</button>`;
  CATEGORIES.map(c => c.key).filter(k => cats[k]).forEach(cat => {
    const on = archiveFilter === cat;
    filterHtml += `<button class="filter-btn ${on ? 'active' : ''}" data-cat="${cat}" aria-pressed="${on}">${escapeHtml(getCatLabel(cat))} ${cats[cat]}</button>`;
  });
  filterEl.innerHTML = filterHtml;

  let filtered = archiveItems;
  if (archiveFilter !== 'all') filtered = filtered.filter(i => i._cat === archiveFilter);
  if (archiveSearch) {
    const q = archiveSearch.toLowerCase();
    filtered = filtered.filter(i => i.title.toLowerCase().includes(q));
  }

  document.getElementById('archive-count').textContent = `${filtered.length}件`;

  const listEl = document.getElementById('archive-list');
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-msg">該当する動画が見つかりませんでした。</div>';
    return;
  }

  // 表示している日時の年月でまとめる
  const byMonth = {};
  filtered.forEach(item => {
    const d = itemDate(item);
    const j = d ? toJST(d) : null;
    const key = j ? `${j.getUTCFullYear()}/${pad2(j.getUTCMonth() + 1)}` : '日時不明';
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(item);
  });

  let html = '';
  Object.entries(byMonth).forEach(([month, items]) => {
    html += `<div class="archive-month-header">${escapeHtml(month)}</div>`;
    items.forEach(item => {
      const thumb = item.thumbnailHigh || item.thumbnail || '';
      const date  = formatJST(getDisplayTime(item));
      const linkLabel = item.liveBroadcastContent === 'upcoming' ? '配信予定を見る' : 'アーカイブを見る';
      html += `
        <div class="archive-item">
          ${thumb ? `<img class="archive-item-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
          <div class="archive-item-info">
            <div class="archive-item-date">
              ${date}
              <span class="cat-badge cat-${item._cat}">${escapeHtml(getCatLabel(item._cat))}</span>
            </div>
            <div class="archive-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          </div>
          <a class="archive-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${linkLabel}<span class="visually-hidden">：${escapeHtml(item.title)}</span></a>
        </div>`;
    });
  });
  listEl.innerHTML = html;
}

// ===== テーマ切り替え =====
// localStorage が使えない環境（一部のプライベートブラウズ等）でも動くようにする
function loadTheme() {
  try { return localStorage.getItem('theme'); } catch (e) { return null; }
}
function saveTheme(theme) {
  try { localStorage.setItem('theme', theme); } catch (e) { /* 保存できなくても表示は切り替える */ }
}

function initTheme() {
  const saved = loadTheme();
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  saveTheme(theme);
  const isDark = theme === 'dark';
  const icon  = isDark ? '☀️' : '🌙';
  const label = isDark ? 'ライトモード' : 'ダークモード';
  document.querySelectorAll('.theme-toggle-icon').forEach(el => { el.textContent = icon; });
  const lbl = document.getElementById('theme-toggle-label');
  if (lbl) lbl.textContent = label;
  const mobileBtn = document.getElementById('theme-toggle-mobile');
  if (mobileBtn) {
    mobileBtn.textContent = icon;
    mobileBtn.setAttribute('aria-label', `${label}に切り替え`);
  }
  const drawerBtn = document.getElementById('theme-toggle-drawer');
  if (drawerBtn) drawerBtn.textContent = `${icon} テーマ切り替え`;
  // テーマが変わると凡例の色も変わるので描き直す
  if (allItems.length) {
    renderLegend('tt-legend');
    renderLegend('cal-legend');
  }
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

// ===== ドロワーメニュー（スマホ）=====
function initDrawer() {
  const overlay  = document.getElementById('drawer-overlay');
  const drawer   = document.getElementById('drawer');
  const openBtn  = document.getElementById('drawer-open');
  const closeBtn = document.getElementById('drawer-close');
  if (!overlay || !drawer) return;

  const isOpen = () => drawer.classList.contains('open');

  function open() {
    drawer.classList.add('open');
    overlay.classList.add('open');
    drawer.removeAttribute('inert');
    openBtn?.setAttribute('aria-expanded', 'true');
    closeBtn?.focus();
  }
  function close() {
    if (!isOpen()) return;
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    drawer.setAttribute('inert', '');
    openBtn?.setAttribute('aria-expanded', 'false');
    openBtn?.focus();
  }

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) close();
  });
}

// ===== テーマ・ドロワーのボタンバインド =====
function initThemeButtons() {
  document.getElementById('theme-toggle-pc')?.addEventListener('click', toggleTheme);
  document.getElementById('theme-toggle-mobile')?.addEventListener('click', toggleTheme);
  document.getElementById('theme-toggle-drawer')?.addEventListener('click', toggleTheme);
}

// ===== タブ =====
function activateTab(btn, moveFocus) {
  const tabs = [...document.querySelectorAll('.tab-btn')];
  tabs.forEach(b => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    const on = p.id === `tab-${btn.dataset.tab}`;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
  if (moveFocus) btn.focus();
  // 表示中のタブが変わると上部固定の高さも変わる（initStickyHeights より前に呼ばれても問題ない）
  updateStickyHeights();
  // 番組表タブに切り替えたらスクロール位置を再設定
  if (btn.dataset.tab === 'timetable') setTimeout(scrollTimetableToEvent, 50);
}

function initTabs() {
  const tabs = [...document.querySelectorAll('.tab-btn')];
  tabs.forEach((btn, i) => {
    btn.addEventListener('click', () => activateTab(btn, false));
    // ← → Home End でタブを移動（WAI-ARIA のタブの操作方法）
    btn.addEventListener('keydown', e => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (next) { e.preventDefault(); activateTab(next, true); }
    });
  });
  const current = tabs.find(b => b.classList.contains('active')) || tabs[0];
  if (current) activateTab(current, false);
}

// ===== イベントバインド =====
function initEvents() {
  initTabs();

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

// ===== 上部固定の高さ =====
// タブと、表示中のタブの上部（.panel-sticky）の高さを CSS 変数に入れる。
// style.css で固定位置（top）や番組表の枠の高さの計算に使う。
// 凡例の折り返し・タブ切り替え・画面サイズの変更で高さが変わるため、そのたびに測り直す
function updateStickyHeights() {
  const root = document.documentElement;
  const nav = document.querySelector('.tab-nav');
  const active = document.querySelector('.tab-panel.active .panel-sticky');
  root.style.setProperty('--tabnav-h', `${nav ? nav.offsetHeight : 0}px`);
  root.style.setProperty('--panel-sticky-h', `${active ? active.offsetHeight : 0}px`);
}

function initStickyHeights() {
  updateStickyHeights();
  window.addEventListener('resize', updateStickyHeights);
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(updateStickyHeights);
    document.querySelectorAll('.tab-nav, .panel-sticky').forEach(el => ro.observe(el));
  }
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initThemeButtons();
  initDrawer();
  initEvents();
  initStickyHeights();
  loadData();
});
