# リベ大工務店｜対応エリア検索

お住まいの地域でリベ大工務店のサービス（注文住宅・リノベーション・リフォーム）に対応しているかを検索できる静的 Web アプリケーションです。

## URL

https://area.libe-home.com/

## 特徴

- **静的サイト** — HTML / CSS / JavaScript のみで構成。GitHub Pages で配信
- **Google スプレッドシート連携** — スプレッドシートを更新すれば最大30分で自動反映
- **高速検索** — 全国の市区町村データをブラウザ内で即時検索
- **モバイル対応** — レスポンシブデザイン
- **オフラインキャッシュ** — localStorage で2回目以降の表示を高速化

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| マークアップ / スタイル | HTML5 / CSS3 |
| スクリプト | Vanilla JavaScript（ES2017+） |
| データ同期 | Node.js 24 + [PapaParse](https://www.papaparse.com/)（GitHub Actions で実行） |
| フォント | [Google Fonts](https://fonts.google.com/)（Zen Kaku Gothic New / Zen Old Mincho） |
| ホスティング | GitHub Pages |

## ファイル構成

```
libe-home-area-search/
├── index.html                       # エントリーポイント
├── assets/
│   ├── css/style.css
│   ├── js/app.js
│   └── images/
├── data/
│   ├── area.json                    # 対応エリアデータ（同期スクリプトが生成）
│   └── reform-works.json            # リフォーム工事メタデータ
├── scripts/sync-data.mjs            # スプシ→JSON 同期スクリプト
├── .github/workflows/sync-data.yml  # 30分ごとに sync を実行
├── package.json
└── .nojekyll                        # Jekyll を無効化（data/ を確実に配信するため）
```

## データの流れ

```
Google スプレッドシート（マスター）
    ↓ GitHub Actions（cron 7,37）
data/*.json を自動コミット
    ↓ GitHub Pages 自動デプロイ
ブラウザは同一オリジンの JSON を fetch
```

スプレッドシートを編集すると、最大30分以内にサイトへ反映されます。即時反映が必要なら GitHub Actions の `Sync spreadsheet data` を手動実行できます。

## ローカルでの開発

```bash
# 依存導入（同期スクリプト用）
npm install

# 最新データを取得
npm run sync

# 任意の静的ファイルサーバーで配信
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000` を開いて動作確認できます。

## メンテナンスのコツ

### スプレッドシート編集

そのまま編集すればOK。GitHub のコードを触る必要はありません。

### app.js / style.css を変更したとき

ブラウザが古いファイルを掴んだままにならないよう、`index.html` 内の `?v=YYYYMMDD` を当日の日付に更新してください。同日中に複数回更新する場合は `?v=YYYYMMDD-2` のようにサフィックスを上げます。

### スキーマ（`data/*.json` の構造）を変更したとき

`scripts/sync-data.mjs` の `SCHEMA_VERSION` と `assets/js/app.js` の `EXPECTED_SCHEMA_VERSION` を同じ値にインクリメントしてください。古いクライアントのキャッシュは自動で破棄されます。

## 判定値

| 判定値 | 表示 |
|--------|-----|
| `対応可能` | 対応可能（緑） |
| `要相談` | 要相談（オレンジ） |
| 上記以外 / 空欄 | 対応不可（グレー） |

## ライセンス

MIT License
