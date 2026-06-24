// ==================== 設定 ====================
const CONFIG = {
  AREA_DATA_URL: window.__areaDataUrl || 'data/area.json',
  REFORM_WORKS_URL: window.__reformWorksUrl || 'data/reform-works.json',
  LINE_URL: 'https://lin.ee/zGxs8aB',
  KOMUTEN_CATEGORIES: ['注文住宅', 'リノベーション', 'オフィス・店舗'],  // 工務店グループの表示対象列
  FETCH_TIMEOUT_MS: 5000,  // 同一オリジン配信なので短めで十分
};

// ==================== グローバルデータ ====================
const appData = {
  categories: [],         // カテゴリ（ヘッダー行 D列以降）
  rowsByPref: new Map(),  // 都道府県別インデックス
  isReady: false          // データ準備完了フラグ
};

// データ準備完了を待つためのPromise
let dataReadyResolve = null;
const dataReadyPromise = new Promise(resolve => {
  dataReadyResolve = resolve;
});

// ==================== DOM要素の取得 ====================
const elPref = document.getElementById("pref");
const elMuni = document.getElementById("muni");
const elBtn = document.getElementById("btn");
const elMsg = document.getElementById("msg");
const elResult = document.getElementById("result");
const elMuniHint = document.getElementById("muniHint");
const elLoadingOverlay = document.getElementById("loadingOverlay");
const elLoadingContent = document.getElementById("loadingContent");
const elContactBtnArea = document.getElementById("contactBtnArea");
const elContactBtn = document.getElementById("contactBtn");
if (elContactBtn) {
  elContactBtn.href = CONFIG.LINE_URL;
  elContactBtn.target = "_blank";
  elContactBtn.rel = "noopener noreferrer";
}

let loadingTimeout = null;
const BTN_ORIGINAL_HTML = elBtn.innerHTML;

// ==================== SVGアイコン定数 ====================
const ICON_EXTERNAL_LINK = '<svg class="external-link-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>';
const ICON_CHEVRON_DOWN = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9" /></svg>';

// ==================== リフォーム各工事 ====================
let reformWorks = []; // loadReformWorks() で構築
let reformWorksReady = false;
let reformWorksReadyResolve = null;
const reformWorksReadyPromise = new Promise(resolve => {
  reformWorksReadyResolve = resolve;
});

// ==================== ユーティリティ関数 ====================

/**
 * エラーメッセージを表示する。kind が "error" 以外の場合はメッセージを非表示にする。
 */
function setMsg(text, kind) {
  elMsg.className = "message";
  if (text && kind === "error") {
    elMsg.classList.add("show", "error");
    elMsg.textContent = text;
  }
}

/**
 * 検索結果セクションの内容をクリアし、非表示にする。
 */
function clearResult() {
  elResult.innerHTML = "";
  elResult.classList.remove("show");
  if (elContactBtnArea) elContactBtnArea.style.display = "none";
}

/**
 * フォーム全体の操作可否を切り替える。検索中はボタン・入力を無効化しスピナーを表示する。
 */
function setBusy(isBusy) {
  elBtn.disabled = isBusy;
  elPref.disabled = isBusy;
  elMuni.disabled = isBusy;
  if (isBusy) {
    elBtn.classList.add('btn--loading');
    elBtn.innerHTML = '<span class="btn-spinner"></span>検索中...';
  } else {
    elBtn.classList.remove('btn--loading');
    elBtn.innerHTML = BTN_ORIGINAL_HTML;
    elBtn.blur();
  }
}

// ステータス定義（判定ロジックを一元管理）
const STATUS_MAP = {
  available:   { cssClass: "available",   label: "対応可能" },
  consult:     { cssClass: "consult",     label: "要相談" },
  unavailable: { cssClass: "unavailable", label: "対応不可" }
};

/**
 * 判定値（"対応可能", "要相談", "対応不可" 等）からステータスオブジェクトを返す。
 * 返却値: { cssClass: string, label: string }
 */
function resolveStatus(value) {
  const v = (value ?? '').trim();
  if (v === "対応可能") return STATUS_MAP.available;
  if (v === "要相談") return STATUS_MAP.consult;
  return STATUS_MAP.unavailable;
}

/** 判定値からCSSクラス名（"available" / "consult" / "unavailable"）を返す。 */
function getStatusClass(value) {
  return resolveStatus(value).cssClass;
}

/** 判定値から表示用ラベル（"対応可能" / "要相談" / "対応不可"）を返す。 */
function getStatusText(value) {
  return resolveStatus(value).label;
}

/** LINEで問い合わせるテキストリンクを生成する。 */
function createLineLink() {
  const link = document.createElement("a");
  link.href = CONFIG.LINE_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "result-status-link";
  link.innerHTML = `LINEで問い合わせる${ICON_EXTERNAL_LINK}`;
  return link;
}

/**
 * 全画面ローディングオーバーレイを表示する。データ未取得状態で検索ボタンが押された際に使用。
 */
function showLoading() {
  if (elLoadingOverlay) {
    elLoadingOverlay.style.display = "flex";
    elLoadingOverlay.classList.remove("hidden");
    if (elLoadingContent) {
      elLoadingContent.innerHTML = `
          <div class="loading-spinner"></div>
          <div class="loading-text">データを読み込んでいます</div>
          <div class="loading-subtext">しばらくお待ちください...</div>
        `;
    }
  }
}

/** ローディングオーバーレイを非表示にし、タイムアウトタイマーをクリアする。 */
function hideLoading() {
  if (loadingTimeout) {
    clearTimeout(loadingTimeout);
    loadingTimeout = null;
  }
  if (elLoadingOverlay) {
    elLoadingOverlay.classList.add("hidden");
    setTimeout(() => {
      elLoadingOverlay.style.display = "none";
    }, 300);
  }
}

/** ローディングが長時間続いた場合にエラーメッセージと再読み込みボタンを表示する。 */
function showLoadingError() {
  if (elLoadingContent) {
    elLoadingContent.innerHTML = `
        <div class="loading-error">
          <div class="loading-error-title">読み込みに時間がかかっています</div>
          <div class="loading-error-message">
            データの取得に時間がかかっています。<br>
            もう少しお待ちいただくか、<br>
            下のボタンで再読み込みをお試しください。
          </div>
          <button class="retry-btn" onclick="location.reload()">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            再読み込み
          </button>
        </div>
      `;
  }
}

// ==================== キャッシュ設定 ====================
// JSON化に伴いキー名を変更（旧キーは自然消滅させる）
const CACHE_KEY_AREA = 'libe_area_data_v2';
const CACHE_KEY_REFORM = 'libe_area_reform_v2';
// data/*.json と一致させる。スキーマ変更時に値を上げると古いcacheを自動破棄できる。
const EXPECTED_SCHEMA_VERSION = 1;

function loadJsonFromCache(key) {
  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    if (parsed && parsed.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      console.log(`旧スキーマのキャッシュを破棄(${key})`);
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn(`キャッシュ読み込みエラー(${key}):`, e);
    try { localStorage.removeItem(key); } catch (_) {}
  }
  return null;
}

function saveJsonToCache(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch (e) {
    console.warn(`キャッシュ保存エラー(${key}):`, e);
  }
}

/** area.json の構造を最低限チェック。NG ならエラーを throw。 */
function validateAreaJson(data) {
  if (!data || typeof data !== 'object') throw new Error('area: not an object');
  if (data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`area: schemaVersion mismatch (${data.schemaVersion} != ${EXPECTED_SCHEMA_VERSION})`);
  }
  if (!Array.isArray(data.categories) || data.categories.length === 0) {
    throw new Error('area: categories missing or empty');
  }
  if (!data.byPref || typeof data.byPref !== 'object' || Object.keys(data.byPref).length === 0) {
    throw new Error('area: byPref missing or empty');
  }
}

/** reform-works.json の構造を最低限チェック。NG ならエラーを throw。 */
function validateReformWorksJson(data) {
  if (!data || typeof data !== 'object') throw new Error('reformWorks: not an object');
  if (data.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`reformWorks: schemaVersion mismatch (${data.schemaVersion} != ${EXPECTED_SCHEMA_VERSION})`);
  }
  if (!Array.isArray(data.works)) throw new Error('reformWorks: works missing');
}

// ==================== データ取得 ====================

/**
 * `<head>` で先行開始した fetch を活用しつつ、5秒で打ち切る。
 * fallback として再フェッチも行う。最終結果はパース済みJSON、失敗時は null。
 */
async function fetchJsonWithTimeout(url, preStarted) {
  try {
    if (preStarted) {
      const result = await Promise.race([
        preStarted,
        new Promise(resolve => setTimeout(() => resolve({ __timeout: true }), CONFIG.FETCH_TIMEOUT_MS)),
      ]);
      if (result && !result.__timeout && !result.__error) {
        return result;
      }
    }
    // fallback: 自前で fetch
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn(`fetch失敗 ${url}:`, e);
    return null;
  }
}

/**
 * area.json の構造をクライアント側の在りし日の形に展開して適用する。
 */
function applyAreaData(json) {
  appData.categories = (json.categories || []).map(c => (c ?? '').toString());
  appData.rowsByPref = new Map();
  const byPref = json.byPref || {};
  for (const pref of Object.keys(byPref)) {
    const entries = byPref[pref];
    if (!Array.isArray(entries)) continue;
    const normalized = entries.map(e => ({
      muni: (e.muni ?? '').toString(),
      kana: (e.kana ?? '').toString(),
      values: Array.isArray(e.values) ? e.values.map(v => (v ?? '').toString()) : [],
    }));
    appData.rowsByPref.set(pref, normalized);
  }
}

/**
 * 対応エリアJSONを読み込み、appData を構築する。
 *  1. キャッシュがあれば即座に展開（表示を高速化）
 *  2. ネットワーク取得 → 検証 → 内容差分があれば再展開 → キャッシュ更新
 *  3. ネットワーク失敗時はキャッシュをそのまま使う（取れていれば動作継続）
 *  4. 展開に失敗した場合は loadError を立てて初回ハングを防ぐ
 */
async function loadAreaData() {
  const cached = loadJsonFromCache(CACHE_KEY_AREA);
  if (cached) {
    try {
      validateAreaJson(cached);
      applyAreaData(cached);
      appData.isReady = true;
      dataReadyResolve();
      onDataReady();
      console.log('キャッシュからエリアデータを読み込みました');
    } catch (e) {
      console.warn('キャッシュ展開に失敗:', e);
      try { localStorage.removeItem(CACHE_KEY_AREA); } catch (_) {}
    }
  }

  const fresh = await fetchJsonWithTimeout(CONFIG.AREA_DATA_URL, window.__areaDataPromise);
  if (fresh) {
    try {
      validateAreaJson(fresh);
    } catch (e) {
      console.warn('取得したエリアデータが不正:', e);
      if (!appData.isReady) {
        appData.loadError = e;
        dataReadyResolve();
      }
      return;
    }

    if (!appData.isReady) {
      try {
        applyAreaData(fresh);
        appData.isReady = true;
        dataReadyResolve();
        onDataReady();
        saveJsonToCache(CACHE_KEY_AREA, fresh);
        console.log('ネットワークからエリアデータを読み込みました');
      } catch (e) {
        console.warn('エリアデータ展開エラー:', e);
        appData.loadError = e;
        dataReadyResolve();
      }
    } else if (!cached || JSON.stringify(cached) !== JSON.stringify(fresh)) {
      try {
        applyAreaData(fresh);
        saveJsonToCache(CACHE_KEY_AREA, fresh);
        console.log('バックグラウンドでエリアデータを更新しました');
      } catch (e) {
        console.warn('エリアデータ再展開エラー（既存データで継続）:', e);
      }
    }
    return;
  }

  if (!appData.isReady) {
    appData.loadError = new Error('エリアデータの取得に失敗しました');
    dataReadyResolve();
  } else {
    console.warn('ネットワーク取得失敗。キャッシュデータで動作継続');
  }
}

/**
 * リフォーム工事JSONを読み込み、reformWorks を構築する。
 * キャッシュ／timeout／フォールバックを備え、サイト全体を止めないよう設計。
 */
async function loadReformWorks() {
  const cached = loadJsonFromCache(CACHE_KEY_REFORM);
  if (cached) {
    try {
      validateReformWorksJson(cached);
      reformWorks = cached.works;
      reformWorksReady = true;
      reformWorksReadyResolve();
      console.log('キャッシュからリフォーム工事データを読み込みました');
    } catch (e) {
      console.warn('リフォーム工事キャッシュが不正:', e);
      try { localStorage.removeItem(CACHE_KEY_REFORM); } catch (_) {}
    }
  }

  const fresh = await fetchJsonWithTimeout(CONFIG.REFORM_WORKS_URL, window.__reformWorksPromise);
  if (fresh) {
    try {
      validateReformWorksJson(fresh);
    } catch (e) {
      console.warn('取得したリフォーム工事データが不正:', e);
      if (!reformWorksReady) {
        reformWorks = [];
        reformWorksReady = true;
        reformWorksReadyResolve();
      }
      return;
    }

    if (!reformWorksReady) {
      reformWorks = fresh.works;
      reformWorksReady = true;
      reformWorksReadyResolve();
      saveJsonToCache(CACHE_KEY_REFORM, fresh);
      console.log('ネットワークからリフォーム工事データを読み込みました');
    } else if (!cached || JSON.stringify(cached.works) !== JSON.stringify(fresh.works)) {
      reformWorks = fresh.works;
      saveJsonToCache(CACHE_KEY_REFORM, fresh);
      console.log('バックグラウンドでリフォーム工事データを更新しました');
    }
    return;
  }

  if (!reformWorksReady) {
    // ネットワーク失敗かつキャッシュ無し → 結果表示はする（部分劣化）
    console.warn('リフォーム工事データの取得に失敗。空のまま継続します');
    reformWorks = [];
    reformWorksReady = true;
    reformWorksReadyResolve();
  } else {
    console.warn('ネットワーク取得失敗。リフォーム工事はキャッシュで動作継続');
  }
}

/** データ読み込み完了時にセレクトとヒントテキストを更新する。 */
function onDataReady() {
  // 都道府県が既に選択されていればセレクトを構築
  populateMuniSelect(elPref.value);

  // ヒントを更新（ローディング表示を解除）
  if (elMuniHint) {
    elMuniHint.classList.remove("loading-hint");
    elMuniHint.textContent = "※ 市区町村を選択してください";
  }
}

// ==================== 市区町村セレクト ====================

/**
 * 指定都道府県の市区町村一覧で <select id="muni"> を構築する。
 * 重複を除外し、先頭に空の選択肢を置く。
 */
function populateMuniSelect(pref) {
  elMuni.innerHTML = "";

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "選択してください";
  elMuni.appendChild(defaultOpt);

  if (!pref) return;

  const rows = appData.rowsByPref.get(pref) || [];
  const seen = new Set();

  for (const row of rows) {
    if (seen.has(row.muni)) continue;
    seen.add(row.muni);

    const opt = document.createElement("option");
    opt.value = row.muni;
    opt.textContent = row.muni;
    elMuni.appendChild(opt);
  }
}

// ==================== 判定処理 ====================

/**
 * 指定した都道府県・市区町村の対応状況を判定する。
 * 該当データが見つからない場合やデータ重複時はエラー情報を返す。
 * 正常時はカテゴリごとの判定値一覧を返す。
 */
function getJudgement(pref, muni) {
  const rows = appData.rowsByPref.get(pref) || [];
  const matches = rows.filter(row => row.muni === muni);

  if (matches.length === 0) {
    return {
      ok: false,
      message: '該当する市区町村が見つかりませんでした'
    };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      message: '同一の都道府県×市区町村が複数行に存在します（データ重複）'
    };
  }

  const values = matches[0].values || [];

  const items = [];
  for (let i = 0; i < values.length; i++) {
    const category = appData.categories[i];
    const value = values[i];

    // カテゴリ名が空の場合はスキップ
    if (!category || category.trim() === '') continue;

    items.push({
      category: category.trim(),
      value: value ? value.trim() : ''
    });
  }

  return {
    ok: true,
    pref,
    muni,
    items
  };
}

// ==================== 結果表示 ====================

/**
 * 工務店グループ（注文住宅・リノベーション・オフィス/店舗）の結果カードを生成して返す。
 * 各サービスの対応状況バッジと、オフィス・店舗対応不可時の補足メッセージを含む。
 */
function renderKomutenGroup(komutenItems) {
  const group = document.createElement("div");
  group.className = "result-item-group";
  group.innerHTML = `
      <h3 class="result-title">
        <img src="assets/images/logo.png" alt="リベ大工務店" width="127" height="24">
      </h3>
    `;

  komutenItems.forEach(it => {
    const value       = it.value ?? "";
    const statusClass = getStatusClass(value);
    const statusText  = getStatusText(value);
    const displayName = it.category === 'オフィス・店舗'
      ? 'オフィス・店舗（新築・リノベーション）'
      : it.category;

    const item = document.createElement("div");
    item.className = "result-item";

    const serviceEl = document.createElement("h4");
    serviceEl.className = "result-service";
    serviceEl.textContent = displayName;
    item.appendChild(serviceEl);

    const statusDiv = document.createElement("div");
    statusDiv.className = "result-status";

    const badge = document.createElement("span");
    badge.className = `status-badge ${statusClass}`;
    badge.textContent = statusText;
    statusDiv.appendChild(badge);

    if (it.category === 'オフィス・店舗' && statusClass === 'unavailable') {
      const noteEl = document.createElement("p");
      noteEl.className = "result-status-note";
      noteEl.textContent = "※オフィス・店舗のリフォームをご希望の方は「リベ大リフォーム」をご確認ください。";
      statusDiv.appendChild(noteEl);
    }

    item.appendChild(statusDiv);

    // 対応可能・要相談の場合は「LINEで問い合わせる」テキストリンクを表示
    if (statusClass === 'available' || statusClass === 'consult') {
      item.appendChild(createLineLink());
    }

    group.appendChild(item);
  });

  return group;
}

/**
 * リベ大リフォームグループの結果カードを生成して返す。
 * 対応可能/要相談の工事一覧をバッジで表示し、各工事の紹介セクションも含む。
 * 工事情報CSV未取得時はエラーメッセージを表示する。
 */
function renderReformGroup(reformItems, masterValue) {
  const group = document.createElement("div");
  group.className = "result-item-group";
  group.innerHTML = `
      <h3 class="result-title">
        <img src="assets/images/logo_rehome.svg" alt="リベ大リフォーム" width="132" height="24">
      </h3>
    `;

  // 工事情報の取得に失敗した場合
  if (reformWorks.length === 0) {
    const noteItem = document.createElement("div");
    noteItem.className = "result-item";
    const noteText = document.createElement("p");
    noteText.className = "result-status-note";
    noteText.textContent = "工事情報を取得できませんでした。ページを再読み込みしてください。";
    noteItem.appendChild(noteText);
    group.appendChild(noteItem);
    return group;
  }

  // 各工事の対応状況をMapで保持（列名→値）
  const reformMap = new Map(reformItems.map(it => [it.category, it.value ?? ""]));

  // マスター列（工務店リフォーム）の判定でリフォーム欄の表示を分岐
  const masterStatus = resolveStatus(masterValue);

  // リフォーム result-item
  const reformResultItem = document.createElement("div");
  reformResultItem.className = "result-item";

  const reformServiceTitle = document.createElement("h4");
  reformServiceTitle.className = "result-service";
  reformServiceTitle.textContent = "リフォーム";
  reformResultItem.appendChild(reformServiceTitle);

  // 個別工事の対応状況を集計
  const availableWorks = reformWorks
    .filter(work => getStatusClass(reformMap.get(work.colKey) ?? '') === 'available');
  const consultWorks = reformWorks
    .filter(work => getStatusClass(reformMap.get(work.colKey) ?? '') === 'consult');
  const hasAnyWorks = availableWorks.length > 0 || consultWorks.length > 0;

  // 単一ステータスバッジを生成してcontainerに追加するヘルパー
  const appendStatusBadge = (container, cssClass, text) => {
    const statusDiv = document.createElement("div");
    statusDiv.className = "result-status";
    const badge = document.createElement("span");
    badge.className = `status-badge ${cssClass}`;
    badge.textContent = text;
    statusDiv.appendChild(badge);
    container.appendChild(statusDiv);
  };

  // 工事名バッジのグループを生成してcontainerに追加するヘルパー
  const appendBadgeGroup = (container, works, labelText, badgeClass) => {
    if (works.length === 0) return;
    const statusDiv = document.createElement("div");
    statusDiv.className = "result-status";
    const label = document.createElement("span");
    label.className = "result-status-label";
    label.textContent = labelText;
    statusDiv.appendChild(label);
    const ul = document.createElement("ul");
    ul.className = "status-badge-group";
    works.forEach(w => {
      const li = document.createElement("li");
      li.className = `status-badge ${badgeClass}`;
      li.textContent = w.name;
      ul.appendChild(li);
    });
    statusDiv.appendChild(ul);
    container.appendChild(statusDiv);
  };

  // リフォームセクションに「LINEで問い合わせる」を表示するか
  let showReformLineLink = false;
  // 各工事の紹介を表示するか
  let showWorkIntro = false;

  if (masterStatus === STATUS_MAP.available) {
    // マスター値「対応可能」→ 「対応可能」バッジ
    appendStatusBadge(reformResultItem, "available", "対応可能");
    showReformLineLink = true;
    showWorkIntro = true;
  } else if (masterStatus === STATUS_MAP.consult) {
    // マスター値「要相談」→ 「要相談」バッジ
    appendStatusBadge(reformResultItem, "consult", "要相談");
    showReformLineLink = true;
    showWorkIntro = true;
  } else {
    // マスター値「対応不可」→ 個別工事を確認
    if (!hasAnyWorks) {
      // すべて対応不可 → 「対応不可」バッジ、工事紹介なし
      appendStatusBadge(reformResultItem, "unavailable", "対応不可");
    } else {
      // 一部工事のみ対応可能 → 対応可能・要相談の工事のみバッジ表示
      appendBadgeGroup(reformResultItem, availableWorks, "対応可能工事：", "partial");
      appendBadgeGroup(reformResultItem, consultWorks, "要相談工事：", "consult");
      showReformLineLink = true;
      showWorkIntro = true;
    }
  }

  // LINEで問い合わせるテキストリンク
  if (showReformLineLink) {
    reformResultItem.appendChild(createLineLink());
  }

  group.appendChild(reformResultItem);

  // リフォーム各工事の紹介（アコーディオン）
  if (showWorkIntro) {
    const workIntro = document.createElement("section");
    workIntro.className = "work-intro";

    // ヘッダー（タイトル + トグルボタン）
    const workIntroHeader = document.createElement("div");
    workIntroHeader.className = "work-intro-header";

    const workIntroTitle = document.createElement("h3");
    workIntroTitle.className = "work-intro-title";
    workIntroTitle.textContent = "リフォーム各工事の紹介";
    workIntroHeader.appendChild(workIntroTitle);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "work-intro-toggle";
    toggleBtn.type = "button";
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.innerHTML = `<span class="is-open">詳しく見る</span><span class="is-close">閉じる</span>${ICON_CHEVRON_DOWN}`;
    workIntroHeader.appendChild(toggleBtn);

    workIntro.appendChild(workIntroHeader);

    // コンテンツ（初期状態は閉じている）
    const workIntroContent = document.createElement("div");
    workIntroContent.className = "work-intro-content";

    const workIntroList = document.createElement("dl");
    workIntroList.className = "work-intro-list";

    // 工事紹介リストへの追加ヘルパー
    const appendWorkItem = (work, cssClass) => {
      const dt = document.createElement("dt");
      dt.className = `work-intro-term ${cssClass}`;
      dt.textContent = work.name;
      const dd = document.createElement("dd");
      dd.className = "work-intro-desc";
      dd.textContent = work.desc;
      workIntroList.appendChild(dt);
      workIntroList.appendChild(dd);
    };

    if (masterStatus === STATUS_MAP.available) {
      // 全工事を緑色で表示
      reformWorks.forEach(w => appendWorkItem(w, 'is_available'));
    } else if (masterStatus === STATUS_MAP.consult) {
      // 全工事を黄色で表示
      reformWorks.forEach(w => appendWorkItem(w, 'is_consult'));
    } else {
      // 一部対応：対応可能→要相談の順で表示
      availableWorks.forEach(w => appendWorkItem(w, 'is_available'));
      consultWorks.forEach(w => appendWorkItem(w, 'is_consult'));
    }

    workIntroContent.appendChild(workIntroList);
    workIntro.appendChild(workIntroContent);

    // トグル動作のイベントリスナー
    toggleBtn.addEventListener('click', () => {
      const isOpen = workIntroContent.classList.toggle('show');
      toggleBtn.setAttribute('aria-expanded', isOpen);
    });

    group.appendChild(workIntro);
  }

  return group;
}

/**
 * 判定結果をもとに、結果セクション全体（ヘッダー・凡例・工務店/リフォームグループ）を描画する。
 * エラー時はエラーメッセージを表示する。
 */
function renderMenu(res) {
  clearResult();

  if (!res || !res.ok) {
    setMsg((res && res.message) ? res.message : "データの取得に失敗しました", "error");
    return;
  }

  elMsg.className = "message";

  const items = res.items || [];

  // ヘッダー
  const header = document.createElement("div");
  header.className = "result-header";
  const headerTitle = document.createElement("h2");
  headerTitle.className = "result-header-title";
  headerTitle.textContent = `${res.pref} ${res.muni}`;
  header.appendChild(headerTitle);
  const headerSub = document.createElement("div");
  headerSub.className = "result-header-sub";
  headerSub.textContent = "の対応状況";
  header.appendChild(headerSub);
  elResult.appendChild(header);

  // 凡例
  const legend = document.createElement("div");
  legend.className = "result-legend";
  legend.innerHTML = `
      <div class="result-legend-item">
        <span class="legend-badge available">対応可能</span>
        <span class="legend-desc">通常対応しているエリアです</span>
      </div>
      <div class="result-legend-item">
        <span class="legend-badge consult">要相談</span>
        <span class="legend-desc">内容や地域条件により対応可否を確認します</span>
      </div>
      <div class="result-legend-item">
        <span class="legend-badge unavailable">対応不可</span>
        <span class="legend-desc">現在は対応対象外のエリアです</span>
      </div>
    `;
  elResult.appendChild(legend);

  // カテゴリをグループに分類
  const komutenItems = items.filter(it => CONFIG.KOMUTEN_CATEGORIES.includes(it.category));
  const reformItems  = items.filter(it => it.category.startsWith('リフォーム_'));
  const reformMaster = items.find(it => it.category === 'リフォーム');
  const reformMasterValue = reformMaster ? reformMaster.value : '';

  if (komutenItems.length > 0) {
    elResult.appendChild(renderKomutenGroup(komutenItems));
  }

  if (reformItems.length > 0 || reformMasterValue) {
    elResult.appendChild(renderReformGroup(reformItems, reformMasterValue));
  }

  elResult.classList.add("show", "fade-in");

  // LINEボタン：対応可能・要相談が1つでもあれば表示
  if (elContactBtnArea) {
    const hasAny = items.some(it => {
      const st = resolveStatus(it.value);
      return st === STATUS_MAP.available || st === STATUS_MAP.consult;
    });
    elContactBtnArea.style.display = hasAny ? "" : "none";
  }

  // 結果ヘッダーがスティッキーヘッダー直下に来るようスクロール
  requestAnimationFrame(() => {
    const headerHeight = document.querySelector(".header")?.offsetHeight || 0;
    const resultTop = elResult.getBoundingClientRect().top + window.scrollY;
    const scrollTarget = resultTop - headerHeight - 16;
    window.scrollTo({ top: scrollTarget, behavior: "smooth" });
  });
}

// ==================== イベントハンドラ ====================

/** 都道府県セレクト変更時：市区町村セレクトを再構築する。 */
function onPrefChange() {
  setMsg("", "");
  clearResult();
  populateMuniSelect(elPref.value);
  if (elMuniHint) {
    elMuniHint.classList.remove("hidden");
  }
}

/** 市区町村セレクト変更時：ヒントの表示切替を行う。 */
function onMuniChange() {
  if (elMuni.value) {
    if (elMuniHint) {
      elMuniHint.classList.add("hidden");
    }
  } else {
    if (elMuniHint) {
      elMuniHint.classList.remove("hidden");
    }
  }
}

/**
 * 検索ボタン押下時の送信処理。
 * バリデーション → データ準備待機 → 判定実行 → 結果描画 の順に処理する。
 */
async function onSubmit() {
  const pref = elPref.value;
  const muni = elMuni.value.trim();

  setMsg("", "");
  clearResult();

  if (!pref) {
    setMsg('都道府県を選択してください', "error");
    return;
  }
  if (!muni) {
    setMsg('市区町村を選択してください', "error");
    return;
  }

  setBusy(true);

  // データがまだ準備できていない場合はローディングを表示して待つ
  if (!appData.isReady) {
    showLoading();
    loadingTimeout = setTimeout(() => {
      showLoadingError();
    }, 8000);

    await dataReadyPromise;
    hideLoading();

    if (appData.loadError) {
      let errorMessage = 'データの読み込みに失敗しました';
      if (!navigator.onLine) {
        errorMessage = 'インターネット接続を確認してください';
      }
      setMsg(errorMessage, 'error');
      setBusy(false);
      return;
    }
  }

  // リフォーム工事データの準備を待つ（取れなくても部分劣化で続行）
  if (!reformWorksReady) {
    await reformWorksReadyPromise;
  }

  // 市区町村の存在チェック
  const rows = appData.rowsByPref.get(pref) || [];
  const exists = rows.some(row => row.muni === muni);
  if (!exists) {
    setMsg('該当する市区町村が見つかりません', "error");
    setBusy(false);
    return;
  }

  const result = getJudgement(pref, muni);
  renderMenu(result);
  setBusy(false);
}

// ==================== 初期化 ====================

document.addEventListener("DOMContentLoaded", () => {
  elPref.addEventListener("change", onPrefChange);
  elMuni.addEventListener("change", onMuniChange);
  elBtn.addEventListener("click", onSubmit);

  // データを並列取得
  loadAreaData();
  loadReformWorks();
});
