# はすてぃあ様の配信スケジュール（非公式）

VTuber [はすてぃあ](https://www.youtube.com/@god_hastia) 様の配信予定・アーカイブ・動画をまとめた非公式ファンサイトです。

## 機能

- 📅 配信予定の一覧表示
- 🔴 ライブ中の配信表示
- 📼 配信アーカイブ一覧
- 🎬 通常動画一覧
- ▶ ショート動画一覧

## 仕組み

GitHub Actions が1時間ごとに YouTube Data API v3 からデータを取得し、`data/videos.json` を更新します。フロントエンドはこのJSONを読み込んで表示します。

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
