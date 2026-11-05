# はすてぃあ様の配信スケジュール（非公式）

VTuber [はすてぃあ](https://www.youtube.com/@god_hastia) 様の配信予定・アーカイブ・動画をまとめた非公式ファンサイトです。

## 機能

- 📅 週間スケジュール（番組表形式）
- 🗓 月間スケジュール（カレンダー形式）
- 🔍 検索（配信アーカイブ・動画一覧。区分での絞り込み・タイトル検索）
- 👤 プロフ(wiki)
- 𝕏 Xポスト（タブ名は X ロゴ＋「ポスト」。ハッシュタグの X 検索・ハッシュタグ入りの投稿画面を開く。複数選択可）

## 仕組み

GitHub Actions（`fetch-youtube.yml`）が30分ごとに YouTube Data API v3 からデータを取得し、`data/videos.json` を更新します。アップロード一覧は最新150件を取得し、それより古い動画は前回のデータから引き継いで蓄積します。YouTube API の規約（保存したデータは30日以内に取り直すか削除する）に合わせ、引き継いだ動画は1日1回まとめて取り直し、削除・非公開になった動画はその時に外します。データが変わったときは `deploy.yml` を呼び出して GitHub Pages を更新します。フロントエンドはこのJSONを読み込んで表示します。

GitHub Pages に公開するのは、サイトに必要なファイル（`index.html` `app.js` `style.css` `sitemap.xml` `robots.txt` `data/` `img/`）だけです。

### メンバーシップ限定配信の追加（手動）

メン限配信は API では取得できないため、`data/members.json` の `items` に手動で追加します。自動更新では書き換えられません。GitHub の画面で直接編集して保存すると、1〜2分でサイトに反映されます。

```json
{
  "items": [
    {
      "title": "【メン限】雑談",
      "start": "2026-11-03T23:00:00+09:00",
      "url": "https://www.youtube.com/watch?v=xxxxxxxxxxx",
      "thumbnail": ""
    }
  ]
}
```

- `title` と `start`（日本時間は `+09:00` を付ける）は必須、`url`・`thumbnail`・`category` は省略できます
- `category` は区分を指定します（`ショート` `歌ってみた` `歌枠` `ASMR` `記念` `コラボ` `ゲーム` `雑談・その他` のどれか）。省略するとタイトルから判定します
- 2件目以降は `},` のようにカンマで区切ります
- 週間・月間・検索タブに「メン限」バッジ付きで表示されます。検索タブでは「メン限」で絞り込めます

## セットアップ

### 1. リポジトリのSecretにAPIキーを追加

GitHub リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で以下を追加：

| Name | Value |
|------|-------|
| `YOUTUBE_API_KEY` | Google Cloud ConsoleのYouTube Data API v3キー |

### 2. GitHub Pages を有効化

**Settings → Pages → Source → GitHub Actions** を選択。

### 3. 手動で初回実行

**Actions → Fetch YouTube Data → Run workflow** で初回データを取得。

## 技術スタック

- HTML / CSS / Vanilla JavaScript（フレームワークなし）
- YouTube Data API v3
- GitHub Actions（定期データ更新）
- GitHub Pages（静的ホスティング）
