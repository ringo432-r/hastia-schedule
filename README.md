# はすてぃあ様の配信スケジュール（非公式）

VTuber [はすてぃあ](https://www.youtube.com/@god_hastia) 様の配信予定・アーカイブ・動画をまとめた非公式ファンサイトです。

## 機能

- 📅 週間スケジュール（番組表形式）
- 🗓 月間スケジュール（カレンダー形式）
- 📼 配信アーカイブ・動画一覧（区分での絞り込み・タイトル検索）
- 👤 プロフィール(wiki)

## 仕組み

GitHub Actions（`fetch-youtube.yml`）が30分ごとに YouTube Data API v3 からデータを取得し、`data/videos.json` を更新します。データが変わったときは `deploy.yml` を呼び出して GitHub Pages を更新します。フロントエンドはこのJSONを読み込んで表示します。

GitHub Pages に公開するのは、サイトに必要なファイル（`index.html` `app.js` `style.css` `data/` `img/`）だけです。

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
