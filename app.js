/**
 * はすてぃあ 配信スケジュール - app.js
 */

const DATA_URL = './data/videos.json';
// メンバーシップ限定配信（手動で追加。自動更新では書き換えない）
const MEMBERS_URL = './data/members.json';
// メン限の予定に URL が書かれていないときのリンク先
const MEMBERS_FALLBACK_URL = 'https://www.youtube.com/@god_hastia/membership';
// チャンネル登録者数（毎朝6時ごろに記録。YouTube API の規約で28日を過ぎた数値は保存・表示しない）
const SUBS_URL = './data/subscribers.json';
const SUBS_RETENTION_MS = 28 * 24 * 60 * 60 * 1000;
// 再生リスト（fetch-youtube が1日1回更新する）
const PLAYLISTS_URL = './data/playlists.json';

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

// リンクに使う URL は https:// で始まるものだけ許可する（javascript: などを防ぐ）
function safeUrl(u, fallback = '#') {
  const s = String(u ?? '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : fallback;
}

// YouTube の URL から動画ID（11文字）を取り出す。見つからなければ ''
function youtubeId(url) {
  const m = String(url || '').match(/(?:[?&]v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : '';
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
let archiveMode      = 'video';  // 検索タブの表示：'video'（動画）/ 'playlist'（再生リスト）。毎回「動画」から始める
let playlistSearch   = '';
let playlistFilter   = 'all';    // 再生リスト表示の区分（'all' または区分のキー）
let allPlaylists     = null;     // null = まだ読み込めていない
let playlistLoadFailed = false;

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

// ===== メンバーシップ限定配信（data/members.json）=====
// 1件は { title, start（日本時間なら +09:00 付きの日時）, url（任意）, thumbnail（任意）}
// 日時が読めないものは表示しない。videos.json に同じ動画があるときは、そちらを優先する
function normalizeMembers(list, knownIds) {
  const now = Date.now();
  return list.map((m, i) => {
    const start = parseDate(m && m.start);
    if (!start) {
      console.warn(`members.json の ${i + 1} 件目は start（日時）が読めないため表示しません`);
      return null;
    }
    const url = safeUrl(m.url, MEMBERS_FALLBACK_URL);
    const vid = youtubeId(url);
    if (vid && knownIds.has(vid)) return null;
    const iso = start.toISOString();
    const upcoming = start.getTime() > now;
    const thumb = safeUrl(m.thumbnail, '') || (vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : '');
    const it = {
      id: vid || `members-${i}`,
      title: String(m.title || 'メンバー限定配信'),
      publishedAt: iso,
      scheduledStartTime: iso,
      actualStartTime: upcoming ? '' : iso,
      liveBroadcastContent: upcoming ? 'upcoming' : 'none',
      category: upcoming ? 'upcoming' : 'archive',
      url,
      thumbnail: thumb,
      thumbnailHigh: thumb,
      _members: true,
    };
    // category を書いたときはその区分にする（キー "chat" でも表示名 "雑談・その他" でもよい）。
    // 書いていない・合わないときはタイトルから判定する
    it._cat = categoryKeyOf(m.category) || detectCategory(it);
    return it;
  }).filter(Boolean);
}

// 区分のキーまたは表示名から、区分のキーを返す。合わなければ ''
function categoryKeyOf(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const cat = CATEGORIES.find(c => c.key === s || c.label === s);
  return cat ? cat.key : '';
}

// 検索タブの「メン限」で絞り込むときの値（区分のキーと重ならない名前）
const MEMBERS_FILTER = '_members';

// メン限のバッジ（週間・月間・検索タブで共通）
function membersBadge(item) {
  return item._members ? '<span class="members-badge">メン限</span>' : '';
}

// ===== データ読み込み =====
async function loadData() {
  try {
    // 動画データ・記念日データ・メン限データを並行取得
    // 記念日・メン限のデータの取得に失敗しても、動画データは表示する
    const [videoResult, annResult, memResult] = await Promise.allSettled([
      fetch(`${DATA_URL}?t=${Date.now()}`),
      fetch(`./data/anniversaries.json?t=${Date.now()}`),
      fetch(`${MEMBERS_URL}?t=${Date.now()}`)
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

    // メン限（手動追加）を合わせる。書き方の間違いなどで読めなくても、ほかの予定は表示する
    if (memResult.status === 'fulfilled' && memResult.value.ok) {
      try {
        const memData = await memResult.value.json();
        const list = Array.isArray(memData.items) ? memData.items : [];
        allItems = allItems.concat(normalizeMembers(list, new Set(allItems.map(i => i.id))));
      } catch (e) {
        console.warn('メン限データ（members.json）を読み込めませんでした:', e);
      }
    } else {
      console.warn('メン限データ（members.json）を取得できませんでした');
    }

    const today = todayJST();
    ttWeekStart = getWeekStart(today);
    calYear  = today.getUTCFullYear();
    calMonth = today.getUTCMonth();

    renderTimetable();
    renderCalendar();
    renderArchive();
    // 再生リストの区分は動画データをもとにつけるので、動画の読み込み後にも描き直す
    renderPlaylistsView();

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
      <${titleTag} class="${titleTag === 'div' ? 'ev-title' : 'cal-ev-title'}">${membersBadge(item)}${escapeHtml(item.title)}</${titleTag}>`;
}

// ===== 番組表（週間）=====

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
          <a class="tt-event cat-${item._cat}" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
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

  rebuildStickyHead('timetable');

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

  // 目的の放送日（UTC 0時の Date）と時（6〜29）
  let targetDay, targetHour;
  if (ttWeekStart.getTime() === getWeekStart(todayJST()).getTime()) {
    // 今週表示中なら：現在時刻以降で最初のイベント。なければ現在時刻
    const future = weekItems.find(x => x.date >= now);
    if (future) {
      targetDay = future.slot.day;
      targetHour = future.slot.hour;
    } else {
      const j = toJST(now);
      const h = j.getUTCHours();
      const late = h < HOUR_START;
      targetDay = new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() - (late ? 1 : 0)));
      targetHour = late ? h + 24 : h;
    }
  } else {
    // 他の週：その週の最初のイベント
    targetDay = weekItems.length > 0 ? weekItems[0].slot.day : ttWeekStart;
    targetHour = weekItems.length > 0 ? weekItems[0].slot.hour : HOUR_START;
  }

  const rowIndex = Math.max(0, targetHour - HOUR_START);
  const dayIndex = Math.min(6, Math.max(0, Math.round((targetDay - ttWeekStart) / 86400000)));

  // 週間タブを表示していないときは位置を測れないので何もしない（タブ切り替え時に呼び直す）
  const panel = document.getElementById('tab-timetable');
  const table = document.getElementById('timetable');
  const row = table && table.tBodies[0] && table.tBodies[0].rows[rowIndex];
  if (!panel || !panel.classList.contains('active') || !row) return;

  // 横方向：表が横にはみ出しているとき（スマホなど）は、目的の日の列が時刻列のすぐ右に来るようにする
  if (scroll.scrollWidth > scroll.clientWidth + 1) {
    const headRow = table.tHead && table.tHead.rows[0];
    const th = headRow && headRow.cells[dayIndex + 1]; // 0番目は時刻列
    const timeCol = headRow && headRow.cells[0];
    if (th) {
      const left = th.getBoundingClientRect().left - scroll.getBoundingClientRect().left + scroll.scrollLeft
        - (timeCol ? timeCol.offsetWidth : 0);
      scroll.scrollLeft = Math.max(0, left);
    }
  }

  // 縦方向：番組表の枠の中でスクロールできるとき（幅701〜759px）は枠の中を動かす
  const innerVertical = getComputedStyle(scroll).overflowY !== 'visible'
    && scroll.scrollHeight > scroll.clientHeight + 1;
  if (innerVertical) {
    scroll.scrollTop = Math.max(0, row.offsetTop - 60); // 少し上に余白
    return;
  }

  // それ以外（PC・スマホ）はページ全体を動かす。
  // 画面の上に固定されている部分（スマホのヘッダー、PC のタブ・各タブの上部・日付の行）の下に、
  // 目的の時間帯が少し余白をあけて来るようにする
  const isStuck = el => el && getComputedStyle(el).position === 'sticky' && el.offsetHeight > 0;
  let covered = 0;
  [document.querySelector('.mobile-header'), document.querySelector('.tab-nav'), panel.querySelector('.panel-sticky')]
    .forEach(el => { if (isStuck(el)) covered += el.offsetHeight; });
  // 日付の行も画面の上に残る（PC は元の行、スマホなどは複製）ので、その分も差し引く
  if (table.tHead) covered += table.tHead.offsetHeight;
  const top = row.getBoundingClientRect().top + window.scrollY - covered - 40;
  window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
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
            <a class="cal-event cat-${item._cat}" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener" title="${escapeHtml(item.title)}">
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

  rebuildStickyHead('calendar');
}

// ===== 検索タブ（動画一覧。関数名・id は旧名 archive のまま）=====
function renderArchive() {
  // 配信予定・配信中・アーカイブ・動画をすべて新しい順に並べる（配信中は「配信中」バッジ付き）
  const archiveItems = allItems
    .slice()
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
  // メン限（区分とは別の絞り込み。1件以上あるときだけ表示）
  const membersCount = archiveItems.filter(i => i._members).length;
  if (membersCount) {
    const on = archiveFilter === MEMBERS_FILTER;
    filterHtml += `<button class="filter-btn filter-btn-members ${on ? 'active' : ''}" data-cat="${MEMBERS_FILTER}" aria-pressed="${on}">メン限 ${membersCount}</button>`;
  } else if (archiveFilter === MEMBERS_FILTER) {
    archiveFilter = 'all';
  }
  filterEl.innerHTML = filterHtml;

  let filtered = archiveItems;
  if (archiveFilter === MEMBERS_FILTER) filtered = filtered.filter(i => i._members);
  else if (archiveFilter !== 'all') filtered = filtered.filter(i => i._cat === archiveFilter);
  if (archiveSearch) {
    const q = archiveSearch.toLowerCase();
    filtered = filtered.filter(i => i.title.toLowerCase().includes(q));
  }

  // 再生リスト表示中は、件数欄を再生リストの件数に使っているので書き換えない
  if (archiveMode === 'video') document.getElementById('archive-count').textContent = `${filtered.length}件`;

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
      const linkLabel = item._members && item.url === MEMBERS_FALLBACK_URL ? 'メンバーシップを見る'
        : item.liveBroadcastContent === 'live' ? '配信を見る'
        : item.liveBroadcastContent === 'upcoming' ? '配信予定を見る' : 'アーカイブを見る';
      const liveBadge = item.liveBroadcastContent === 'live' ? '<span class="live-badge">配信中</span>' : '';
      html += `
        <div class="archive-item">
          ${thumb ? `<img class="archive-item-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
          <div class="archive-item-info">
            <div class="archive-item-date">
              ${date}
              ${liveBadge}
              <span class="cat-badge cat-${item._cat}">${escapeHtml(getCatLabel(item._cat))}</span>
              ${membersBadge(item)}
            </div>
            <div class="archive-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          </div>
          <a class="archive-link" href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener">${linkLabel}<span class="visually-hidden">：${escapeHtml(item.title)}</span></a>
        </div>`;
    });
  });
  listEl.innerHTML = html;
}

// ===== Xポスト（ハッシュタグの検索・ポスト）=====
// プロフ(wiki) の「ハッシュタグ（X用）」と同じもの（タグを変えるときは両方直す）
// postable: false … はすてぃあ様ご本人用のタグ。検索だけでき、ポストには選べない（一覧の一番下に置く）
const X_HASHTAGS = [
  { label: '総合',         tag: 'はすてぃあ' },
  { label: '配信',         tag: 'はすてぃあ様降臨中' },
  { label: 'ファンアート', tag: 'はすてぃあーと' },
  { label: '切り抜き',     tag: 'はすてぃあ様布教' },
  { label: 'エゴサ',       tag: 'はすてぃあ様万歳' },
  { label: '配信予定',     tag: 'エルノア教予定表', postable: false },
];

// X の検索結果（最新順）
function xSearchUrl(tag) {
  return `https://x.com/search?q=${encodeURIComponent(`#${tag}`)}&src=hashtag_click&f=live`;
}
// 本文を入れた状態の投稿画面（Web Intent。投稿はしない）
function xPostUrl(text) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

// 本文＋選択したハッシュタグ（タグの前後は空白で区切る）
function composeXPostText() {
  const body = document.getElementById('xpost-text').value.trim();
  const tags = [...document.querySelectorAll('.xpost-check:checked')].map(el => `#${el.value}`);
  const tagLine = tags.join(' ');
  // ハッシュタグの位置（本文の後 / 前）。本文とは改行で区切る
  const before = document.querySelector('input[name="xpost-position"]:checked')?.value === 'before';
  const parts = before ? [tagLine, body] : [body, tagLine];
  return { text: parts.filter(Boolean).join('\n'), count: tags.length };
}

function updateXPostComposer() {
  const { text, count } = composeXPostText();
  const preview = document.getElementById('xpost-preview');
  const submit = document.getElementById('xpost-submit');
  preview.textContent = text || '（ハッシュタグを選ぶと、ここに表示されます）';
  preview.classList.toggle('empty', !text);
  const enabled = count > 0;
  submit.classList.toggle('disabled', !enabled);
  submit.setAttribute('aria-disabled', String(!enabled));
  submit.href = enabled ? xPostUrl(`${text} `) : '#';
  submit.textContent = enabled ? `選択したハッシュタグでポスト（${count}件）` : '選択したハッシュタグでポスト';
}

function renderXPost() {
  const list = document.getElementById('xpost-list');
  if (!list) return;
  list.innerHTML = X_HASHTAGS.map((h, i) => {
    const postable = h.postable !== false;
    return `
    <li class="xpost-item${postable ? '' : ' xpost-item-searchonly'}">
      <span class="xpost-item-links">
        <a class="xpost-btn" href="${escapeHtml(xSearchUrl(h.tag))}" target="_blank" rel="noopener">検索<span class="visually-hidden">：#${escapeHtml(h.tag)}</span></a>
      </span>
      <label class="xpost-tag">
        <input type="checkbox" class="xpost-check" id="xpost-check-${i}" value="${escapeHtml(h.tag)}"${postable ? '' : ' disabled aria-describedby="xpost-searchonly-note"'}>
        <span class="xpost-tag-name">#${escapeHtml(h.tag)}</span>
        <span class="xpost-tag-label">${escapeHtml(h.label)}</span>
        ${postable ? '' : '<span class="xpost-searchonly" id="xpost-searchonly-note">はすてぃあ様用のため検索のみ</span>'}
      </label>
    </li>`;
  }).join('');

  list.addEventListener('change', updateXPostComposer);
  document.getElementById('xpost-text').addEventListener('input', updateXPostComposer);
  document.querySelectorAll('input[name="xpost-position"]').forEach(el => el.addEventListener('change', updateXPostComposer));
  document.getElementById('xpost-clear').addEventListener('click', () => {
    list.querySelectorAll('.xpost-check').forEach(el => { el.checked = false; });
    updateXPostComposer();
  });
  // 何も選んでいないときは開かない
  document.getElementById('xpost-submit').addEventListener('click', e => {
    if (e.currentTarget.getAttribute('aria-disabled') === 'true') e.preventDefault();
  });
  updateXPostComposer();
}

// ===== テーマ切り替え =====
// localStorage が使えない環境（一部のプライベートブラウズ等）でも動くようにする
// 保存するのは、利用者が切り替えボタンを押したときだけ。
// 以前の 'theme' は開くたびに自動で保存されていた（標準がダークのころの値が残っている）ため、
// 新しいキー 'themeChoice' を使い、古い値は読まない
const THEME_KEY = 'themeChoice';
function loadTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}
function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 保存できなくても表示は切り替える */ }
}

function initTheme() {
  // 標準はライトモード。ダークモードを選んだ人だけダークで表示する
  const saved = loadTheme();
  applyTheme(saved === 'dark' ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
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
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveTheme(next);
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
  // 番組表タブに切り替えたらスクロール位置を再設定。
  // ほかのタブはページ全体でスクロールするので、前のタブのスクロール位置が残らないよう先頭に戻す
  if (btn.dataset.tab === 'timetable') setTimeout(scrollTimetableToEvent, 50);
  else if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'auto' });
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

  document.getElementById('playlist-filter').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    playlistFilter = btn.dataset.cat;
    renderPlaylistsView();
  });

  document.getElementById('archive-search').addEventListener('input', e => {
    // 動画と再生リストで、検索の文字は別々に覚えておく
    if (archiveMode === 'playlist') {
      playlistSearch = e.target.value.trim();
      renderPlaylistsView();
    } else {
      archiveSearch = e.target.value.trim();
      renderArchive();
    }
  });

  // 検索タブの「動画 / 再生リスト」の切り替え
  document.querySelector('.archive-mode').addEventListener('click', e => {
    const btn = e.target.closest('.mode-btn');
    if (btn) setArchiveMode(btn.dataset.mode);
  });
}

function setArchiveMode(mode) {
  archiveMode = mode === 'playlist' ? 'playlist' : 'video';
  const isPl = archiveMode === 'playlist';
  document.querySelectorAll('.mode-btn').forEach(b => {
    const on = b.dataset.mode === archiveMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('archive-filter').hidden = isPl;
  document.getElementById('playlist-filter').hidden = !isPl;
  document.getElementById('archive-list').hidden = isPl;
  document.getElementById('playlist-list').hidden = !isPl;
  const input = document.getElementById('archive-search');
  input.value = isPl ? playlistSearch : archiveSearch;
  input.placeholder = isPl ? '再生リスト・動画のタイトルで検索' : 'タイトルで検索';
  input.setAttribute('aria-label', input.placeholder);
  if (isPl) renderPlaylistsView(); else renderArchive();
  // 上部に固定している部分の高さが変わるので測り直す
  updateStickyHeights();
}

// ===== 上部固定の高さ =====
// タブと、表示中のタブの上部（.panel-sticky）の高さを CSS 変数に入れる。
// style.css で固定位置（top）や番組表の枠の高さの計算に使う。
// 凡例の折り返し・タブ切り替え・画面サイズの変更で高さが変わるため、そのたびに測り直す
function updateStickyHeights() {
  const root = document.documentElement;
  const mh = document.querySelector('.mobile-header'); // スマホのヘッダー（PC では非表示で高さ 0）
  const nav = document.querySelector('.tab-nav');
  const active = document.querySelector('.tab-panel.active .panel-sticky');
  root.style.setProperty('--mh', `${mh ? mh.offsetHeight : 0}px`);
  root.style.setProperty('--tabnav-h', `${nav ? nav.offsetHeight : 0}px`);
  root.style.setProperty('--panel-sticky-h', `${active ? active.offsetHeight : 0}px`);
  updateStickyHeads();
}

function initStickyHeights() {
  updateStickyHeights();
  window.addEventListener('resize', updateStickyHeights);
  window.addEventListener('scroll', updateStickyHeads, { passive: true });
  STICKY_HEADS.forEach(cfg => {
    const scroll = document.querySelector(cfg.scroll);
    if (scroll) scroll.addEventListener('scroll', () => updateStickyHead(cfg), { passive: true });
  });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(updateStickyHeights);
    document.querySelectorAll('.mobile-header, .tab-nav, .panel-sticky').forEach(el => ro.observe(el));
  }
}

// ===== 見出し行の複製（日付・曜日の行を画面の上に残す）=====
// 表が横スクロールになる幅（スマホなど）では、横スクロール枠の中にある見出し行を画面の上に固定できない。
// そこで見出し行を複製して各タブの上部（.panel-sticky）のすぐ下に重ね、元の見出し行が上に隠れたときだけ表示する。
// 横スクロールの位置は元の表に合わせる。幅760px以上では元の見出し行が固定されるので使わない（style.css で非表示）
const STICKY_HEADS = [
  { table: 'timetable', scroll: '.timetable-scroll',   head: 'tt-sticky-head' },
  { table: 'calendar',  scroll: '.calendar-grid-wrap', head: 'cal-sticky-head' },
];

// 表を描き直したら複製も作り直す
function rebuildStickyHead(tableId) {
  const cfg = STICKY_HEADS.find(c => c.table === tableId);
  const table = document.getElementById(tableId);
  const head = cfg && document.getElementById(cfg.head);
  if (!head || !table || !table.tHead) return;
  head.innerHTML = `<table class="${table.className}">${table.tHead.outerHTML}</table>`;
  updateStickyHead(cfg);
}

function updateStickyHead(cfg) {
  const table = document.getElementById(cfg.table);
  const head = document.getElementById(cfg.head);
  const scroll = document.querySelector(cfg.scroll);
  if (!table || !head || !scroll || !table.tHead || !head.firstElementChild) return;
  const panel = head.closest('.tab-panel');
  const sticky = head.closest('.panel-sticky');
  if (!panel || !sticky || !panel.classList.contains('active') || window.matchMedia('(min-width: 760px)').matches) {
    head.hidden = true;
    return;
  }
  // 複製は .panel-sticky の下端の外側に重ねている（レイアウトは動かない）
  const stickyBottom = sticky.getBoundingClientRect().bottom;
  const theadRect = table.tHead.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  // 元の見出し行が上部の固定部分の下に隠れ、表の残りがまだ画面に出ているときだけ表示する
  head.hidden = !(theadRect.top < stickyBottom - 1 && tableRect.bottom > stickyBottom + theadRect.height);
  if (head.hidden) return;
  head.firstElementChild.style.width = `${table.offsetWidth}px`;
  head.scrollLeft = scroll.scrollLeft;
}

function updateStickyHeads() {
  STICKY_HEADS.forEach(updateStickyHead);
}

// ===== 検索タブの「再生リスト」表示 =====
// 各再生リストを開閉できる一覧にする（開くと中の動画が並ぶ）。動画へのリンクは再生リストの文脈（list=）付き
async function loadPlaylists() {
  if (!document.getElementById('playlist-list')) return;
  try {
    const res = await fetch(`${PLAYLISTS_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const lists = (Array.isArray(data.items) ? data.items : [])
      .filter(p => p && /^[\w-]+$/.test(String(p.id || '')) && Array.isArray(p.videos));
    allPlaylists = lists;
  } catch (e) {
    console.warn('再生リストを読み込めませんでした:', e);
    playlistLoadFailed = true;
  }
  renderPlaylistsView();
}

// 検索タブの「再生リスト」表示を描く（検索ボックスの内容で絞り込む）
function renderPlaylistsView() {
  const box = document.getElementById('playlist-list');
  const countEl = document.getElementById('archive-count');
  if (!box) return;
  const inMode = archiveMode === 'playlist';
  if (allPlaylists === null) {
    box.innerHTML = `<div class="empty-msg">${playlistLoadFailed ? '再生リストはまだ取得できていません。' : '読み込み中...'}</div>`;
    if (inMode && countEl) countEl.textContent = '';
    return;
  }
  // 各再生リストに区分をつける（中の動画でいちばん多い区分）
  const byId = new Map(allItems.map(i => [i.id, i]));
  const withCat = allPlaylists.map(p => ({ ...p, _cat: playlistCategory(p, byId) }));
  renderPlaylistFilter(withCat);
  const filtered = playlistFilter === 'all' ? withCat : withCat.filter(p => p._cat === playlistFilter);
  const n = renderPlaylists(box, filtered, playlistSearch);
  if (inMode && countEl) countEl.textContent = `${n}件`;
}

// 再生リストの区分：中の動画の区分を数えて、いちばん多いもの。
// 動画データ（videos.json / members.json）にある動画はその区分を、ないものはタイトルから判定する。
// 同数のときは、CATEGORIES で上にある区分を選ぶ
function playlistCategory(p, byId) {
  const counts = {};
  (p.videos || []).forEach(v => {
    if (!v || !v.id) return;
    const known = byId.get(v.id);
    const cat = known ? known._cat : detectCategory({ title: String(v.title || ''), url: '' });
    counts[cat] = (counts[cat] || 0) + 1;
  });
  let best = 'chat', bestN = 0;
  CATEGORIES.forEach(c => {
    if ((counts[c.key] || 0) > bestN) { best = c.key; bestN = counts[c.key]; }
  });
  return best;
}

// 再生リスト表示の区分ボタン（件数は再生リストの数）
function renderPlaylistFilter(withCat) {
  const el = document.getElementById('playlist-filter');
  if (!el) return;
  const cats = {};
  withCat.forEach(p => { cats[p._cat] = (cats[p._cat] || 0) + 1; });
  if (playlistFilter !== 'all' && !cats[playlistFilter]) playlistFilter = 'all';
  if (!withCat.length) { el.innerHTML = ''; return; }
  let html = `<button type="button" class="filter-btn ${playlistFilter === 'all' ? 'active' : ''}" data-cat="all" aria-pressed="${playlistFilter === 'all'}">すべて ${withCat.length}</button>`;
  CATEGORIES.map(c => c.key).filter(k => cats[k]).forEach(cat => {
    const on = playlistFilter === cat;
    html += `<button type="button" class="filter-btn ${on ? 'active' : ''}" data-cat="${cat}" aria-pressed="${on}">${escapeHtml(getCatLabel(cat))} ${cats[cat]}</button>`;
  });
  el.innerHTML = html;
}

// 検索ボックスに文字があるときは、合う再生リストだけを開いた状態で並べる
// （再生リストの題名に合えば中の動画をすべて、動画の題名だけに合えば合う動画だけ）。表示した再生リストの数を返す
function renderPlaylists(box, lists, query = '') {
  const q = query.toLowerCase();
  const hit = (s) => String(s || '').toLowerCase().includes(q);
  const rows = lists.map(p => {
    const all = p.videos.filter(v => v && /^[\w-]{6,}$/.test(String(v.id || '')));
    const title = String(p.title || '（題名なし）');
    if (!q || hit(title)) return { p, all, shown: all, title };
    const shown = all.filter(v => hit(v.title));
    return shown.length ? { p, all, shown, title } : null;
  }).filter(Boolean);
  if (!lists.length) {
    box.innerHTML = '<div class="empty-msg">再生リストはまだありません。</div>';
    return 0;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty-msg">該当する再生リストが見つかりませんでした。</div>';
    return 0;
  }
  box.innerHTML = rows.map(({ p, all, shown, title }) => {
    const vids = shown;
    const first = all[0]; // 再生ボタンは、絞り込みに関係なく再生リストの先頭から再生する
    // 先頭の動画＋再生リスト指定の形にすると、開いた時点で先頭から再生され、続けて次の動画へ進む
    const listUrl = first
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(first.id)}&list=${encodeURIComponent(p.id)}`
      : `https://www.youtube.com/playlist?list=${encodeURIComponent(p.id)}`;
    const thumb = first ? `https://i.ytimg.com/vi/${encodeURIComponent(first.id)}/mqdefault.jpg` : '';
    const items = vids.map(v => {
      const vTitle = String(v.title || '');
      const url = `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}&list=${encodeURIComponent(p.id)}`;
      return `
        <div class="archive-item">
          <img class="archive-item-thumb" src="https://i.ytimg.com/vi/${encodeURIComponent(v.id)}/mqdefault.jpg" alt="" loading="lazy">
          <div class="archive-item-info">
            <div class="archive-item-title" title="${escapeHtml(vTitle)}">${escapeHtml(vTitle)}</div>
          </div>
          <a class="archive-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">動画を見る<span class="visually-hidden">：${escapeHtml(vTitle)}</span></a>
        </div>`;
    }).join('');
    return `
      <details class="playlist-item"${q ? ' open' : ''}>
        <summary class="playlist-summary">
          ${thumb ? `<img class="archive-item-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : ''}
          <span class="playlist-title">${escapeHtml(title)}</span>
          ${p._cat ? `<span class="cat-badge cat-${p._cat}">${escapeHtml(getCatLabel(p._cat))}</span>` : ''}
        </summary>
        <div class="playlist-body">
          <a class="archive-link playlist-open" href="${escapeHtml(listUrl)}" target="_blank" rel="noopener">YouTube で再生リストを再生<span class="visually-hidden">：${escapeHtml(title)}</span></a>
          ${items}
        </div>
      </details>`;
  }).join('');
  return rows.length;
}

// ===== チャンネル登録者数のグラフ =====
// 記録された数値をそのまま折れ線で結ぶだけ（増減の計算や予想はしない）
async function loadSubscribers() {
  const box = document.getElementById('subs-chart');
  if (!box) return;
  try {
    const res = await fetch(`${SUBS_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const now = Date.now();
    // 取得から28日を過ぎた数値は、データに残っていても表示しない
    const items = (Array.isArray(data.items) ? data.items : [])
      .filter(i => i && /^\d{4}-\d{2}-\d{2}$/.test(i.date) && Number.isFinite(i.subscribers))
      .filter(i => {
        const t = Date.parse(i.fetchedAt);
        return Number.isFinite(t) && now - t < SUBS_RETENTION_MS;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    renderSubscribers(box, items, data.hidden === true);
  } catch (e) {
    console.warn('登録者数データを読み込めませんでした:', e);
    box.textContent = '登録者数のデータはまだありません。';
  }
}

function renderSubscribers(box, items, hidden) {
  if (hidden) {
    box.textContent = 'チャンネルの登録者数は非公開に設定されているため、表示できません。';
    return;
  }
  if (items.length === 0) {
    box.textContent = 'まだ記録がありません。毎朝6時ごろに記録します。';
    return;
  }
  const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const num = (n) => n.toLocaleString('ja-JP');
  const last = items[items.length - 1];

  // 描画サイズ（viewBox。画面幅に合わせて拡縮する）
  const W = 640, H = 260, L = 64, R = 20, T = 20, B = 40;
  const toTime = (date) => Date.parse(`${date}T00:00:00Z`);
  const t0 = toTime(items[0].date);
  const t1 = toTime(last.date);
  const vals = items.map(i => i.subscribers);
  // 縦軸の下端は最小値を 100 単位に切り下げ、上端は最大値を 100 単位に切り上げた値（例：4,560人 → 4,500〜4,600）
  const STEP = 100;
  const yMin = Math.floor(Math.min(...vals) / STEP) * STEP;
  let yMax = Math.ceil(Math.max(...vals) / STEP) * STEP;
  if (yMax === yMin) yMax = yMin + STEP; // ちょうど 100 の倍数のときも幅を持たせる
  const x = (date) => (t1 === t0 ? (L + (W - R)) / 2 : L + (toTime(date) - t0) / (t1 - t0) * (W - L - R));
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);

  const ticks = [yMin, Math.round((yMin + yMax) / 2), yMax];
  const grid = ticks.map(v =>
    `<line class="subs-grid" x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}"/>` +
    `<text class="subs-axis" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${num(v)}</text>`
  ).join('');
  const xLabels = (items.length === 1 ? [items[0]] : [items[0], last]).map((i, idx, arr) =>
    `<text class="subs-axis" x="${x(i.date).toFixed(1)}" y="${H - 14}" text-anchor="${arr.length === 1 ? 'middle' : idx === 0 ? 'start' : 'end'}">${md(i.date)}</text>`
  ).join('');
  const points = items.map(i => `${x(i.date).toFixed(1)},${y(i.subscribers).toFixed(1)}`).join(' ');
  const line = items.length > 1 ? `<polyline class="subs-line" points="${points}"/>` : '';
  const dots = items.map(i =>
    `<circle class="subs-dot" cx="${x(i.date).toFixed(1)}" cy="${y(i.subscribers).toFixed(1)}" r="4"><title>${md(i.date)}：${num(i.subscribers)}人</title></circle>`
  ).join('');

  box.innerHTML = `
    <div class="subs-latest">最終更新：${escapeHtml(last.date.replace(/-/g, '/'))}　<strong>${escapeHtml(num(last.subscribers))}人</strong></div>
    <svg class="subs-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="チャンネル登録者数の推移。${escapeHtml(md(items[0].date))}から${escapeHtml(md(last.date))}までの${items.length}日分。最新は${escapeHtml(num(last.subscribers))}人。">
      ${grid}${line}${dots}${xLabels}
    </svg>`;
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initThemeButtons();
  initDrawer();
  initEvents();
  renderXPost();
  initStickyHeights();
  loadData();
  loadPlaylists();
  loadSubscribers();
});
