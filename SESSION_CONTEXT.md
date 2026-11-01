# はすてぃあ様のスケジュール - セッション引き継ぎメモ

## プロジェクト概要

VTuber はすてぃあ様（[@god_hastia](https://www.youtube.com/@god_hastia)）の配信スケジュールを表示する非公式ファンサイト。

- **公開URL**: https://ringo432-r.github.io/hastia-schedule/
- **GitHubリポジトリ**: https://github.com/ringo432-r/hastia-schedule
- **GitHubユーザー名**: ringo432-r
- **ホスティング**: GitHub Pages（無料）
- **データ更新**: GitHub Actions（1時間ごと自動実行）

---

## ファイル構成

```
hastia-schedule/
├── index.html                        # メインHTML
├── style.css                         # スタイル（v=9）
├── app.js                            # フロントエンドJS（v=8）
├── data/
│   ├── videos.json                   # YouTube APIから取得した動画データ（自動更新）
│   └── anniversaries.json            # 記念日データ（手動管理）
├── img/
│   └── hastia.png                    # はすてぃあ様のキャラクターイラスト
├── .github/
│   └── workflows/
│       ├── fetch-youtube.yml         # YouTube APIデータ取得（1時間ごと）
│       └── deploy.yml                # GitHub Pagesデプロイ
├── README.md
└── SESSION_CONTEXT.md                # このファイル
```

---

## 機能一覧

### タブ構成
| タブ | 内容 |
|---|---|
| 📅 週間 | 週間スケジュール（時間軸×曜日の番組表形式） |
| 🗓 月間 | 月間スケジュール（カレンダー形式） |
| 📼 アーカイブ | 配信アーカイブ・動画一覧（カテゴリフィルター・タイトル検索付き） |

### テーマ切り替え
- ダークテーマ（デフォルト：黒×赤）/ ライトテーマ 切り替え可能
- `localStorage` で選択を記憶
- PCはサイドバーのボタン、スマホはヘッダーの🌙ボタン

### スマホ対応
- 700px以下でサイドバーが消え、上部ヘッダーに切り替わる
- ハンバーガーメニュー（☰）でドロワーメニューを表示
- 週間スケジュールに「3日 / 7日」切り替えボタン表示

### カテゴリ自動判定
タイトルキーワードから以下のカテゴリを自動判定：

| カテゴリ | 判定条件 |
|---|---|
| ショート | `isShort:true` フラグ / URLに `/shorts/` / `#shorts` / 動画60秒以下 |
| 歌ってみた | 「歌ってみた」「covered」等 |
| 歌枠 | 「歌枠」「歌回」「カラオケ」等 |
| ASMR | 「ASMR」（大文字小文字不問）|
| 記念 | 「記念」「誕生日」「周年」「初配信」等 |
| コラボ | 「コラボ」「collab」等 |
| ゲーム | 【】形式のタイトル / ゲームキーワード多数（「食べ比べ」を含む場合は除外） |
| 雑談・その他 | 上記に該当しないもの |

### 記念日表示
`data/anniversaries.json` で管理。週間・月間スケジュールに表示される。

| 記念日 | 設定内容 |
|---|---|
| 🎂 誕生日 | 毎年 4/20 |
| 🎉 デビュー記念日 | 2026/10/18（単発）|
| 🎊 デビューnか月記念日 | 毎月18日（2026/11〜、n=経過月数）|

### 時刻表示ルール
| 種別 | 表示する時刻 |
|---|---|
| 配信予定 | `scheduledStartTime`（配信予定時間）|
| アーカイブ | `actualStartTime` → `scheduledStartTime` → `publishedAt` の優先順 |
| 通常動画・ショート | `publishedAt`（公開日時）|

---

## GitHub Actions 設定

### YouTube APIキー
- **保存場所**: GitHubリポジトリの Secrets → `YOUTUBE_API_KEY`
- **取得元**: Google Cloud Console（YouTube Data API v3）
- **APIキー**: （セキュリティのためここには記載しない）

### fetch-youtube.yml の処理内容
1. チャンネルID取得（`@god_hastia`）
2. 配信予定・ライブ中・アーカイブ・通常動画を取得（各50件）
3. `liveStreamingDetails` で全動画の配信開始時刻を補完
4. `contentDetails` でショート動画（60秒以下）を判定
5. `data/videos.json` に保存してコミット

---

## サイドバーリンク
- YouTube: https://www.youtube.com/@god_hastia
- X（Twitter）: https://x.com/god_hastia?s=20
- lit.link: https://lit.link/godhastia
- FANBOX: https://godhastia.fanbox.cc/
- Gipt: https://gi-pt.com/main/wishlist/fan-view/3a23ee33-3cc9-4641-79ef-1f364528c083
- BOOTH: https://godhastia.booth.pm/

---

## デプロイの仕組み
1. ローカルでファイルを編集
2. `git add . && git commit && git push`
3. `deploy.yml` が自動で GitHub Pages にデプロイ（1〜2分）
4. データ更新は `fetch-youtube.yml` が1時間ごとに自動実行

### git push 手順（ローカルから）
```powershell
cd <このリポジトリのフォルダ>
git pull --rebase
git add .
git commit -m "変更内容"
git push
```
※ `git pull --rebase` を先に実行しないと、GitHub Actionsのコミットと競合してpushが失敗する。

---

## 未実装・検討中の機能
- カテゴリの管理画面（ログイン認証付き）→ Supabase か Netlify CMS を検討中
- 独自ドメイン（現在は `github.io` のデフォルトURL）

---

## キャッシュバースト管理
HTML内のCSS/JSのバージョン番号：
- `style.css?v=24`
- `app.js?v=17`

ファイルを更新したら番号をインクリメントすること。

---

## 注意事項
- はすてぃあ様の **非公式** ファンサイト
- フッターに「このサイトは信徒による非公式のファンサイトです。」と記載
- GitHub PagesはPublicリポジトリ必須（無料プランの場合）
