/**
 * はすてぃあ 配信スケジュール
 * data/videos.json を読み込んでカード表示する
 */

const DATA_URL = './data/videos.json';

// 日時フォーマット
function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d)) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

// バッジHTML
function badgeHTML(category) {
  switch (category) {
    case 'live':     return '<span class="badge badge-live">🔴 LIVE</span>';
    case 'upcoming': return '<span class="badge badge-upcoming">📅 配信予定</span>';
    case 'archive':  return '<span class="badge badge-archive">📼 アーカイブ</span>';
    case 'short':    return '<span class="badge badge-short">▶ SHORT</span>';
    default:         return '';
  }
}

// カードHTML生成
function createCard(item) {
  const thumbnail = item.thumbnailHigh || item.thumbnail || '';
  const date = formatDate(item.publishedAt);
  const badge = badgeHTML(item.category);

  return `
    <a class="video-card" href="${item.url}" target="_blank" rel="noopener">
      <div class="card-thumbnail">
        ${thumbnail ? `<img src="${thumbnail}" alt="${escapeHtml(item.title)}" loading="lazy" />` : ''}
        ${badge}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.title)}</div>
        ${date ? `<div class="card-date">🕐 ${date}</div>` : ''}
      </div>
    </a>
  `;
}

// XSS対策
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ローディング表示
function showLoading(el) {
  el.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <span>読み込み中...</span>
    </div>
  `;
}

// 空状態表示
function showEmpty(el, message = 'データがありません') {
  el.innerHTML = `
    <div class="empty-state">
      <div style="font-size:2.5rem">📭</div>
      <p>${message}</p>
    </div>
  `;
}

// タブ制御
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      buttons.forEach((b) => b.classList.remove('active'));
      contents.forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
    });
  });
}

// データ読み込みと描画
async function loadData() {
  const lists = {
    upcoming: document.getElementById('list-upcoming'),
    live:     document.getElementById('list-live'),
    archive:  document.getElementById('list-archive'),
    video:    document.getElementById('list-video'),
    short:    document.getElementById('list-short'),
  };

  // 全タブにローディング表示
  Object.values(lists).forEach(showLoading);

  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 更新日時
    if (data.updatedAt) {
      document.getElementById('updatedAt').textContent =
        `最終更新: ${formatDate(data.updatedAt)}`;
    }

    const items = Array.isArray(data.items) ? data.items : [];

    // カテゴリ別に振り分け
    const buckets = { upcoming: [], live: [], archive: [], video: [], short: [] };

    items.forEach((item) => {
      const cat = item.category;
      if (buckets[cat]) {
        buckets[cat].push(item);
      } else {
        buckets.video.push(item);
      }
    });

    // 各タブに描画
    Object.entries(buckets).forEach(([cat, arr]) => {
      const el = lists[cat];
      if (!el) return;

      if (arr.length === 0) {
        const messages = {
          upcoming: '現在、配信予定はありません',
          live:     '現在ライブ配信はありません',
          archive:  'アーカイブが見つかりませんでした',
          video:    '動画が見つかりませんでした',
          short:    'ショート動画が見つかりませんでした',
        };
        showEmpty(el, messages[cat] || 'データがありません');
      } else {
        el.innerHTML = arr.map(createCard).join('');
      }
    });

    // ライブ中があればライブタブのバッジを目立たせる
    if (buckets.live.length > 0) {
      const liveBtn = document.querySelector('[data-tab="live"]');
      if (liveBtn) {
        liveBtn.textContent = `🔴 ライブ中 (${buckets.live.length})`;
        liveBtn.style.color = '#ff4444';
      }
    }

  } catch (err) {
    console.error('データの読み込みに失敗しました:', err);
    Object.values(lists).forEach((el) => {
      showEmpty(el, 'データの読み込みに失敗しました。しばらくしてから再読み込みしてください。');
    });
    document.getElementById('updatedAt').textContent = '読み込みエラー';
  }
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadData();
});
