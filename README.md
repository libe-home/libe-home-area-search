# libe-home-area-search
## エリア検索ツール用

GoogleスプレッドシートからCSVデータを読み込み、都道府県・市区町村を選択してサービス対応状況を表示する静的Webアプリケーションです。

## 特徴

- **GASバナーなし**：静的HTML + CSV公開方式でGoogle Apps Scriptのバナーを回避
- **シンプルな運用**：Googleスプレッドシートを更新するだけでデータが反映
- **モバイル対応**：レスポンシブデザインでスマホ・タブレット・PCに対応
- **高速検索**：約1,900件のデータをブラウザ内で高速検索
- **サジェスト機能**：ひらがな入力で市区町村を絞り込み

## デモ

**GitHub Pages URL:**
https://itohenthunagi.github.io/libe-home-area/

## 技術スタック

- HTML5/CSS3/JavaScript (Vanilla)
- [PapaParse](https://www.papaparse.com/) - CSV解析ライブラリ
- [Google Fonts](https://fonts.google.com/) - Noto Sans JP
- GitHub Pages - 静的ホスティング

## ファイル構成

```
libe_koumu_area/
├── index.html      # メインアプリケーション
└── README.md       # このファイル
```

## セットアップ

### 1. Googleスプレッドシートの準備

#### 公開用シート「公開_まとめ」を作成

データ構造：

```
行番号 | A列(都道府県) | B列(市区町村) | C列(ふりがな) | D列以降(判定セル)
-------|--------------|--------------|--------------|------------------
2      | (空白)       | (空白)       | (空白)       | プロバイダー種別
3      | (空白)       | (空白)       | (空白)       | カテゴリ
4以降  | 都道府県名    | 市区町村名    | ふりがな      | 判定値
```

#### CSV公開URLの取得

1. Googleスプレッドシートを開く
2. ファイル → 共有 → ウェブに公開
3. 「公開_まとめ」シート + CSV形式を選択
4. URLをコピー

### 2. HTMLファイルの設定

`index.html` の `CONFIG` オブジェクトを編集：

```javascript
const CONFIG = {
  CSV_URL: 'YOUR_CSV_PUBLIC_URL',
  CONTACT_URL: 'YOUR_CONTACT_URL',
  // ...
};
```

### 3. GitHubリポジトリにアップロード

```bash
# リポジトリをクローン
git clone https://github.com/itohenthunagi/libe-home-area.git
cd libe-home-area

# ファイルを編集後、コミット＆プッシュ
git add index.html
git commit -m "Update configuration"
git push origin main
```

### 4. GitHub Pages設定

1. GitHubリポジトリページを開く
2. Settings → Pages
3. Source: Deploy from a branch
4. Branch: main / root
5. Save

数分後、以下のURLで公開されます：
```
https://itohenthunagi.github.io/libe-home-area/
```

## 使い方

### ユーザー向け

1. 都道府県をプルダウンから選択
2. 市区町村をひらがなで入力（候補が表示されます）
3. 候補から市区町村を選択
4. 「確認する」ボタンをクリック
5. 対応状況が一覧表示されます

### データ更新方法

1. Googleスプレッドシートの「まとめ」シートを編集
2. 「公開_まとめ」シートに自動転記される
3. 数分待つ（Google側のキャッシュ更新）
4. Webサイトをリロード（Ctrl+F5でキャッシュクリア）

## 設定項目

### CONFIG オブジェクト

| 項目 | 説明 | デフォルト値 |
|------|------|-------------|
| CSV_URL | 公開CSV URL | (要設定) |
| CONTACT_URL | お問い合わせURL | (要設定) |
| HEADER_PROVIDER_ROW | プロバイダー種別行 | 2 |
| HEADER_CATEGORY_ROW | カテゴリ行 | 3 |
| DATA_START_ROW | データ開始行 | 4 |
| FIRST_JUDGE_COL | 判定値開始列 | 4 (D列) |
| SUGGEST_LIMIT | サジェスト上限 | 30 |

### カテゴリ名変換

`categoryNameMap` で表示名をカスタマイズできます：

```javascript
const categoryNameMap = {
  "大規模": "大規模リフォーム",
  "小規模": "小規模リフォーム"
};
```

## 判定値の表示ルール

| 判定値 | 表示 | スタイル |
|--------|------|---------|
| ○ | 対応可能 | available (緑) |
| 要相談 | 要相談 | consult (オレンジ) |
| 一部 / 除く | (そのまま) | partial (青緑) |
| 空欄 / — | 対応エリア外 | unavailable (グレー) |

## トラブルシューティング

### データが表示されない

- CSVのURL が正しいか確認
- ブラウザのコンソールでエラーを確認
- CSV公開設定が有効か確認

### 候補が表示されない

- 都道府県を選択しているか確認
- ひらがなで入力しているか確認
- データに該当市区町村が存在するか確認

### 更新が反映されない

- ブラウザキャッシュをクリア（Ctrl+F5）
- Google側のキャッシュ更新を待つ（数分）
- CSV URLが正しいか再確認

## ライセンス

MIT License

## お問い合わせ

ご不明な点は[お問い合わせフォーム](https://docs.google.com/forms/d/e/1FAIpQLSeqtoxMGXGZEHZ9x2QbNUdb7g--Fb-yoxjU5VKbuMT5TmJIvw/viewform)までご連絡ください。
