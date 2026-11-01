# はすてぃあ様のスケジュール - セッション引き継ぎメモ

## プロジェクト概要

VTuber はすてぃあ様（[@god_hastia](https://www.youtube.com/@god_hastia)）の配信スケジュールを表示する非公式ファンサイト。

- **公開URL**: https://ringo432-r.github.io/hastia-schedule/
- **GitHubリポジトリ**: https://github.com/ringo432-r/hastia-schedule
- **GitHubユーザー名**: ringo432-r
- **ホスティング**: GitHub Pages（無料）
- **データ更新**: GitHub Actions（30分ごと自動実行）

---

## ファイル構成

```
hastia-schedule/
├── index.html                        # メインHTML
├── style.css                         # スタイル
├── app.js                            # フロントエンドJS
├── data/
│   ├── videos.json                   # YouTube APIから取得した動画データ（自動更新）
│   └── anniversaries.json            # 記念日データ（手動管理）
├── img/
│   ├── hastia.png                    # はすてぃあ様のキャラクターイラスト
│   └── icon-fanbox/gipt/booth.png    # 各サービスのアイコン
├── .github/
│   └── workflows/
│       ├── fetch-youtube.yml         # YouTube APIデータ取得（30分ごと）
│       └── deploy.yml                # GitHub Pagesデプロイ
├── README.md
└── SESSION_CONTEXT.md                # このファイル（サイトには公開されない）
```

GitHub Pages に公開されるのは `index.html` `app.js` `style.css` `data/` `img/` のみ（`deploy.yml` で限定）。

---

## 機能一覧

### タブ構成
| タブ | 内容 |
|---|---|
| 📅 週間 | 週間スケジュール（6:00〜28:00 の番組表形式。常に7日表示）|
| 🗓 月間 | 月間スケジュール（カレンダー形式）|
| 📼 アーカイブ | 配信アーカイブ・動画一覧（カテゴリフィルター・タイトル検索付き）|
| 👤 プロフィール(wiki) | Wikipedia風のプロフィール |

- タブは ← → Home End キーでも切り替え可能（WAI-ARIA のタブ）
- 週間・月間には凡例（全区分）と「※ メンバーシップ限定配信は表示されません」の注記を表示

### 放送日（29時制）
- 0:00〜5:59 の予定は前日の 24:00〜29:59 として扱う（週間・月間とも同じ基準）
- アーカイブは実際の日時で表示・月分け

### テーマ切り替え
- ダークテーマ（デフォルト：黒×赤）/ ライトテーマ 切り替え可能
- `localStorage` で選択を記憶（使えない環境でも切り替え自体は動く）
- PCはサイドバーのボタン、スマホはヘッダーのボタン

### スマホ対応（700px以下）
- サイドバーが消え、上部ヘッダー＋ハンバーガーメニュー（☰）に切り替わる
- メニューは Esc キーで閉じる。閉じている間は操作・読み上げの対象外（inert）
- 週間は縦スクロールなしで全時間帯を表示、横スクロール時も時刻列は固定
- 週間・月間ともサムネイル付きで表示

### カテゴリ自動判定
タイトルキーワードから以下のカテゴリを自動判定（上から順に判定）：

| カテゴリ | 判定条件 |
|---|---|
| ショート | `isShort:true` フラグ / URLに `/shorts/` / `#shorts` / 動画60秒以下 |
| 歌ってみた | 「歌ってみた」「cover」「covered」（英語は単語単位）|
| 歌枠 | 「歌枠」「歌回」「カラオケ」等 |
| ASMR | 「ASMR」（大文字小文字不問）|
| 記念 | 「記念」「誕生日」「周年」「初配信」等 |
| コラボ | 「コラボ」「対談」「collab」等 |
| ゲーム | 【】形式のタイトル / ゲームキーワード（「食べ比べ」を含む場合は除外）|
| 雑談・その他 | 上記に該当しないもの |

配信予定・ライブ中も、上記の区分に振り分ける（専用の区分はない）。

### 記念日表示
`data/anniversaries.json` で管理。週間・月間スケジュールに表示される。
色（`color` / `textColor`）は `#RRGGBB` などの色の値のみ有効（それ以外は無視される）。

| 記念日 | 設定内容 |
|---|---|
| 🎂 誕生日 | 毎年 4/20 |
| 🎉 デビュー記念日 | 2026/10/18（単発）|
| 🎊 デビューnか月記念日 | 毎月18日（2026/11〜、n=経過月数）|

### 時刻表示ルール
| 種別 | 表示する時刻 |
|---|---|
| 配信予定 | `scheduledStartTime`（配信予定時間）|
| ライブ中・アーカイブ | `actualStartTime` → `scheduledStartTime` → `publishedAt` の優先順 |
| 通常動画・ショート | `publishedAt`（公開日時）|

---

## GitHub Actions 設定

### YouTube APIキー
- **保存場所**: GitHubリポジトリの Secrets → `YOUTUBE_API_KEY`
- **取得元**: Google Cloud Console（YouTube Data API v3）
- **APIキー**: （セキュリティのためここには記載しない）

### fetch-youtube.yml の処理内容（30分ごと、1回 約110ユニット）
- 実行時刻は毎時7分・37分（`cron: '7,37 * * * *'`）。毎時0分は GitHub の混雑で遅延・スキップされやすいためずらしている
- GitHub の定期実行は保証されない（以前の毎時0分設定では実際は3〜7時間おきだった）。改善しない場合は外部サービスから workflow_dispatch を呼ぶ方式を検討
1. チャンネルID取得（`@god_hastia`）
2. 配信予定を `search.list` で取得（100ユニット）
3. アーカイブ・通常動画・ショートをアップロード一覧（`playlistItems`、最新150件）で取得
4. 前回データの配信予定・ライブ中を引き継ぎ、`videos.list` で最新の状態・配信時刻を反映
5. 予定時刻から24時間以上過ぎた配信予定は除外
6. `contentDetails` でショート動画（60秒以下）を判定
7. `data/videos.json` に保存してコミット（最新を取り込んでから push、失敗時は最大3回再試行）
8. データが変わったときだけ `deploy.yml` を呼び出してサイトを更新

- API がエラー（上限超え・キー不正など）を返したら、処理を失敗として止める（Actions が赤になる）
- 定期実行と手動実行は同時に動かない（`concurrency`）
- 動画の説明文（description）は保存しない
- アクションはコミットID（SHA）で固定している（コメントにバージョンを記載）

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
2. `git pull --rebase` → `git add` → `git commit` → `git push`
3. `deploy.yml` が自動で GitHub Pages にデプロイ（1〜2分）
4. データ更新は `fetch-youtube.yml` が30分ごとに自動実行し、変化があればデプロイを呼び出す

### git push 手順（ローカルから）
```powershell
cd <このリポジトリのフォルダ>
git pull --rebase
git add <変更したファイル>
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
- `style.css?v=25`
- `app.js?v=18`

ファイルを更新したら番号をインクリメントすること。

---

## 注意事項
- はすてぃあ様の **非公式** ファンサイト
- フッターに「このサイトは信徒による非公式のファンサイトです。」と記載
- GitHub PagesはPublicリポジトリ必須（無料プランの場合）
- メンバーシップ限定配信は YouTube Data API（APIキー）では取得できないため表示しない
