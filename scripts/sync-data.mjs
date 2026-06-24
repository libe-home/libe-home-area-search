// Google スプレッドシートから対応エリア／対応可能工事のCSVを取得し、
// リポジトリ同梱用のJSONに変換する。GitHub Actions から定期実行される。
//
// 出力先:
//   data/area.json          : 都道府県×市区町村×カテゴリの判定値
//   data/reform-works.json  : リフォーム工事の名前と説明
//
// 設計指針:
//   - 安定出力（揮発フィールド無し）にしてデータ未変更時は git 差分も出さない
//   - schemaVersion を埋めて、クライアント側で旧cacheを自動破棄できるようにする
//   - 取得結果は必ず validate してから書き出す（壊れたJSONがコミットされない）
//   - 全 source を fetch+validate 完了後にまとめて write（部分更新を残さない）

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SPREADSHEET_PUB_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTakKTc-ekIJM4mN34A0MP4WjpiaXgcie8bQYn5fMswI85X91fNSUDGOT59nGMnHQomYL4BVsxAtDf-/pub';

// クライアント側 cache のキー戦略と同期。スキーマ変更時に値を上げる。
// v2: kana 削除、末尾の未表示カテゴリ列カット、値の整数エンコード（valueMap 参照）
const SCHEMA_VERSION = 2;

// 頻出値を整数で参照する辞書（出現頻度順ではなく安定順序で固定）
const VALUE_DICT = ['', '対応可能', '要相談', '対応不可'];
const VALUE_INDEX = new Map(VALUE_DICT.map((v, i) => [v, i]));

// クライアントが描画対象としていない category prefix
// （列が増減しても末尾の不要列だけが落ちる挙動になるよう、prefix 指定でゆるく持つ）
const DROP_CATEGORY_PREFIXES = ['小規模_'];

const SOURCES = {
  area: {
    url: `${SPREADSHEET_PUB_BASE}?gid=1502020184&single=true&output=csv`,
    out: 'data/area.json',
    build: buildAreaJson,
    validate: validateAreaJson,
  },
  reformWorks: {
    url: `${SPREADSHEET_PUB_BASE}?gid=1088443442&single=true&output=csv`,
    out: 'data/reform-works.json',
    build: buildReformWorksJson,
    validate: validateReformWorksJson,
  },
};

// スプシ上のレイアウト定数（クライアント側と同じ位置情報）
const HEADER_ROW = 3;       // 3行目にサービス名
const DATA_START_ROW = 4;   // 4行目からデータ
const FIRST_JUDGE_COL = 4;  // D列から判定列

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

// CSVが極端に短い場合は Google が HTML エラーページを 200 で返したと判断する
const MIN_CSV_BYTES = 100;
// エリアCSVの最低期待値（壊れたデータをコミットしないためのガード）
const MIN_PREFS = 40;        // 47都道府県のうち最低40都道府県
const MIN_MUNI_ROWS = 1000;  // 全国合計で最低1000市区町村
const MIN_CATEGORIES = 5;    // カテゴリは最低5つ（注文住宅・リノベ・オフィス・店舗・リフォーム・リフォーム_xx...）
const MIN_REFORM_WORKS = 5;  // 工事も最低5件

async function fetchWithRetry(url) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text || text.length < MIN_CSV_BYTES) {
        throw new Error(`response too short (${text?.length ?? 0} bytes)`);
      }
      // Google がエラーページを 200 で返すケースの早期検出
      const head = text.slice(0, 256).toLowerCase();
      if (head.includes('<html') || head.includes('<!doctype html')) {
        throw new Error('HTML response detected (expected CSV)');
      }
      return text;
    } catch (err) {
      lastErr = err;
      console.warn(`[fetch] attempt ${attempt}/${FETCH_RETRIES} failed: ${err.message}`);
      if (attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`fetch failed after ${FETCH_RETRIES} attempts: ${lastErr?.message}`);
}

function parseCsvOrThrow(csvText, options) {
  const parsed = Papa.parse(csvText, options);
  if (parsed.errors && parsed.errors.length > 0) {
    // 致命的なものだけ拒否（Papa は単発の "TooFewFields" 等も errors に積む）
    const fatal = parsed.errors.filter((e) => e.type === 'Quotes' || e.code === 'UndetectableDelimiter');
    if (fatal.length > 0) {
      throw new Error(`CSV parse fatal errors: ${fatal.slice(0, 3).map((e) => e.message).join('; ')}`);
    }
    console.warn(`[parse] non-fatal warnings: ${parsed.errors.length}`);
  }
  return parsed.data;
}

/**
 * クライアントが描画する最後のカテゴリ位置を返す（末尾の空欄や非対象列を落とすため）。
 * カテゴリ末尾の空欄／DROP_CATEGORY_PREFIXES に一致する列を全部落とした位置 = cutoff（exclusive）。
 */
function findCategoriesCutoff(categories) {
  let lastKeep = -1;
  for (let i = 0; i < categories.length; i++) {
    const c = (categories[i] ?? '').toString().trim();
    if (c === '') continue;
    if (DROP_CATEGORY_PREFIXES.some((p) => c.startsWith(p))) continue;
    lastKeep = i;
  }
  return lastKeep + 1;
}

/** 頻出値は整数に、それ以外（自由記述など）は文字列のまま返す。trim を入れて余計な空白で未知扱いになるのを防ぐ。 */
function encodeValue(raw) {
  const s = (raw ?? '').toString().trim();
  const idx = VALUE_INDEX.get(s);
  return idx !== undefined ? idx : s;
}

function buildAreaJson(csvText, sourceUrl) {
  const table = parseCsvOrThrow(csvText, { skipEmptyLines: false });
  const headerRow = table[HEADER_ROW - 1] ?? [];
  const allCategories = headerRow.slice(FIRST_JUDGE_COL - 1).map((c) => (c ?? '').toString());

  const cutoff = findCategoriesCutoff(allCategories);
  const categories = allCategories.slice(0, cutoff);

  const byPref = {};
  for (let i = DATA_START_ROW - 1; i < table.length; i++) {
    const row = table[i] ?? [];
    const pref = (row[0] ?? '').toString().trim();
    const muni = (row[1] ?? '').toString().trim();
    if (!pref || !muni) continue;
    // kana 列(C) はクライアント未使用のため出力しない
    const rawValues = row.slice(FIRST_JUDGE_COL - 1, FIRST_JUDGE_COL - 1 + cutoff);
    const values = rawValues.map(encodeValue);
    if (!byPref[pref]) byPref[pref] = [];
    byPref[pref].push({ muni, values });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    source: sourceUrl,
    categories,
    valueMap: VALUE_DICT,
    byPref,
  };
}

function buildReformWorksJson(csvText, sourceUrl) {
  const rows = parseCsvOrThrow(csvText, { skipEmptyLines: true });
  // 行1: コメント、行2: ヘッダー、行3以降: 工事データ
  const works = rows
    .slice(2)
    .filter((row) => row[0] && row[0].toString().trim())
    .map((row) => {
      const name = row[0].toString().trim();
      const desc = (row[1] ?? '').toString().trim();
      return { name, colKey: `リフォーム_${name}`, desc };
    });

  return { schemaVersion: SCHEMA_VERSION, source: sourceUrl, works };
}

function validateAreaJson(data) {
  if (!data || typeof data !== 'object') throw new Error('area: not an object');
  if (!Array.isArray(data.categories) || data.categories.length < MIN_CATEGORIES) {
    throw new Error(`area: categories too few (${data.categories?.length ?? 0} < ${MIN_CATEGORIES})`);
  }
  if (!Array.isArray(data.valueMap) || data.valueMap.length === 0) {
    throw new Error('area: valueMap missing');
  }
  if (!data.byPref || typeof data.byPref !== 'object') {
    throw new Error('area: byPref missing');
  }
  const prefCount = Object.keys(data.byPref).length;
  if (prefCount < MIN_PREFS) {
    throw new Error(`area: prefs too few (${prefCount} < ${MIN_PREFS})`);
  }
  const muniCount = Object.values(data.byPref).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0);
  if (muniCount < MIN_MUNI_ROWS) {
    throw new Error(`area: muni rows too few (${muniCount} < ${MIN_MUNI_ROWS})`);
  }
  console.log(`[validate] area OK (prefs=${prefCount}, muni=${muniCount}, categories=${data.categories.length}, valueMap=${data.valueMap.length})`);
}

function validateReformWorksJson(data) {
  if (!data || typeof data !== 'object') throw new Error('reformWorks: not an object');
  if (!Array.isArray(data.works) || data.works.length < MIN_REFORM_WORKS) {
    throw new Error(`reformWorks: too few works (${data.works?.length ?? 0} < ${MIN_REFORM_WORKS})`);
  }
  for (const w of data.works) {
    if (!w.name || !w.colKey) throw new Error(`reformWorks: malformed work entry (${JSON.stringify(w)})`);
  }
  console.log(`[validate] reformWorks OK (works=${data.works.length})`);
}

// area.categories と reform-works.json の colKey の整合性を確認する。
// 不一致でも sync は通す（スプシ反映ラグを許容するため）が、警告ログを残す。
function crossValidate(areaJson, reformJson) {
  const categorySet = new Set(areaJson.categories.map((c) => (c ?? '').toString().trim()));
  const missing = reformJson.works
    .map((w) => w.colKey)
    .filter((k) => !categorySet.has(k));
  if (missing.length > 0) {
    console.warn(`[cross] reformWorks の colKey ${missing.length}件が area.categories に未登録: ${missing.join(', ')}`);
  } else {
    console.log('[cross] colKey 整合性 OK');
  }
}

async function writeJson(relPath, obj) {
  const full = resolve(ROOT, relPath);
  await mkdir(dirname(full), { recursive: true });
  const json = JSON.stringify(obj, null, 2) + '\n';
  await writeFile(full, json, 'utf8');
  console.log(`[write] ${relPath} (${json.length} bytes)`);
}

async function main() {
  console.log('[sync] start');
  // 1. 全 source を fetch + build + validate（write はまだしない）
  const built = {};
  const failures = [];
  for (const [key, src] of Object.entries(SOURCES)) {
    try {
      console.log(`[fetch] ${key} <- ${src.url}`);
      const csvText = await fetchWithRetry(src.url);
      console.log(`[fetch] ${key} OK (${csvText.length} bytes)`);
      const json = src.build(csvText, src.url);
      src.validate(json);
      built[key] = { src, json };
    } catch (err) {
      console.error(`[sync] ${key} FAILED: ${err.message}`);
      failures.push(key);
    }
  }

  if (failures.length > 0) {
    console.error(`[sync] failed sources: ${failures.join(', ')} (skip write to keep existing data)`);
    process.exit(1);
  }

  // 2. cross validation（warning only）
  if (built.area && built.reformWorks) {
    crossValidate(built.area.json, built.reformWorks.json);
  }

  // 3. まとめて write
  for (const { src, json } of Object.values(built)) {
    await writeJson(src.out, json);
  }

  console.log('[sync] done');
}

await main();
