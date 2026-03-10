// ==================== 設定 ====================
const CONFIG = {
  CSV_URL: window.__csvUrl,
  REFORM_WORKS_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTakKTc-ekIJM4mN34A0MP4WjpiaXgcie8bQYn5fMswI85X91fNSUDGOT59nGMnHQomYL4BVsxAtDf-/pub?gid=1088443442&single=true&output=csv',
  KOMUTEN_CATEGORIES: ['注文住宅', 'リノベーション', 'オフィス・店舗'],  // 工務店グループの表示対象列
  HEADER_ROW: 3,        // 3行目にサービス名（注文住宅・リノベーション・リフォーム_各工事...）
  DATA_START_ROW: 4,    // 4行目からデータ開始
  FIRST_JUDGE_COL: 4,   // D列から判定列
  SUGGEST_LIMIT: 30
};

// ==================== グローバルデータ ====================
const appData = {
  table: [],              // 2次元配列（CSVデータ全体）
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
const elMuniList = document.getElementById("muniList");
const elBtn = document.getElementById("btn");
const elMsg = document.getElementById("msg");
const elResult = document.getElementById("result");
const elMuniHint = document.getElementById("muniHint");
const elLoadingOverlay = document.getElementById("loadingOverlay");
const elLoadingContent = document.getElementById("loadingContent");

let suggestTimer = null;
let loadingTimeout = null;
const BTN_ORIGINAL_HTML = elBtn.innerHTML;

// ==================== リフォーム各工事（対応可能工事CSVから動的構築） ====================
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
  }
}

// ステータス定義（判定ロジックを一元管理）
const STATUS_MAP = {
  available:   { cssClass: "available",   label: "対応可能" },
  consult:     { cssClass: "consult",     label: "要相談" },
  unavailable: { cssClass: "unavailable", label: "対応不可" }
};

/**
 * CSV上の判定値（"対応可能", "要相談", "対応不可" 等）からステータスオブジェクトを返す。
 * 返却値: { cssClass: string, label: string }
 */
function resolveStatus(value) {
  if (!value || value === "" || value === "—" || value === "対応不可") return STATUS_MAP.unavailable;
  if (value.includes("非対応") || value.includes("対応エリア外")) return STATUS_MAP.unavailable;
  if (value.includes("要相談")) return STATUS_MAP.consult;
  if (value === "対応可能" || value === "○" || value === "◯" || value === "対応可") return STATUS_MAP.available;
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

/**
 * 全画面ローディングオーバーレイを表示する。データ未取得状態で検索ボタンが押された際に使用。
 */
function showLoading() {
  if (elLoadingOverlay) {
    elLoadingOverlay.style.display = "flex";
    elLoadingOverlay.classList.remove("hidden");
    // ローディングコンテンツをリセット
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
const CACHE_KEY = 'libe_koumu_csv_cache';

// ==================== CSV読み込みと解析 ====================

/**
 * CSVテキストをPapaParseで解析し、appData にテーブル・カテゴリ・都道府県別インデックスを構築する。
 */
function parseAndBuildData(csvText) {
  const parsed = Papa.parse(csvText, {
    skipEmptyLines: false
  });

  appData.table = parsed.data;

  // ヘッダ読み取り（1行目からカテゴリを取得）
  const headerRow = appData.table[CONFIG.HEADER_ROW - 1];

  // D列以降を取得
  appData.categories = headerRow.slice(CONFIG.FIRST_JUDGE_COL - 1);

  // インデックス構築
  buildIndex();
}

/** localStorageからキャッシュ済みCSVテキストを取得する。存在しない場合は null を返す。 */
function loadFromCache() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      return cached;
    }
  } catch (e) {
    console.warn('キャッシュ読み込みエラー:', e);
  }
  return null;
}

/** CSVテキストをlocalStorageにキャッシュとして保存する。 */
function saveToCache(csvText) {
  try {
    localStorage.setItem(CACHE_KEY, csvText);
  } catch (e) {
    console.warn('キャッシュ保存エラー:', e);
  }
}

/**
 * メインCSVデータの読み込みと解析を行う。
 * 1. キャッシュがあれば即座にデータを構築（高速表示）
 * 2. バックグラウンドでネットワークから最新データを取得
 * 3. キャッシュを更新し、差分があればデータを再構築
 */
async function loadAndParseCSV() {
  try {
    // 1. まずキャッシュから読み込みを試みる（即座にデータ準備）
    const cachedCSV = loadFromCache();

    if (cachedCSV) {
      try {
        parseAndBuildData(cachedCSV);
        appData.isReady = true;
        dataReadyResolve();
        onDataReady();
        console.log('キャッシュからデータを読み込みました');
      } catch (e) {
        console.warn('キャッシュデータの解析に失敗:', e);
      }
    }

    // 2. バックグラウンドで最新データを取得（UIをブロックしない）
    let csvText = null;

    if (window.__csvFetchPromise) {
      // 既に開始済みのfetchを待つ
      csvText = await window.__csvFetchPromise;
      if (window.__csvFetchError) {
        throw new Error(window.__csvFetchError);
      }
    }

    if (!csvText) {
      // フォールバック：再度fetchを実行
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 60000);

      const response = await fetch(CONFIG.CSV_URL, {
        signal: controller.signal
      });
      clearTimeout(fetchTimeout);

      if (!response.ok) throw new Error('CSV取得失敗');
      csvText = await response.text();
    }

    // 3. キャッシュを更新
    saveToCache(csvText);

    // 4. データを構築
    if (!appData.isReady) {
      // 初回：データを構築して準備完了
      parseAndBuildData(csvText);
      appData.isReady = true;
      dataReadyResolve();
      onDataReady();
      console.log('ネットワークからデータを読み込みました');
    } else if (cachedCSV !== csvText) {
      // キャッシュと異なる場合：データを更新
      parseAndBuildData(csvText);
      console.log('バックグラウンドでデータを更新しました');
    }

  } catch (error) {
    console.error(error);

    // キャッシュから読み込み済みなら、エラーは警告程度に
    if (appData.isReady) {
      console.warn('ネットワークエラーですが、キャッシュデータで動作中');
      return;
    }

    // データがない場合はエラーを記録（確認ボタン押下時にエラー表示）
    appData.loadError = error;
    dataReadyResolve(); // エラーでもPromiseを解決して待機を終了
  }
}

// ==================== 対応可能工事CSV読み込み ====================

/**
 * リフォーム対応可能工事のCSVを取得し、reformWorks 配列を構築する。
 * 各工事の名前・列キー・説明を保持する。
 */
async function loadReformWorks() {
  try {
    const response = await fetch(CONFIG.REFORM_WORKS_CSV_URL);
    if (!response.ok) throw new Error('対応可能工事CSV取得失敗');
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { skipEmptyLines: true });
    // 行1(コメント)・行2(ヘッダー)をスキップ
    reformWorks = parsed.data.slice(2)
      .filter(row => row[0] && row[0].trim())
      .map(row => ({
        name: row[0].trim(),
        colKey: 'リフォーム_' + row[0].trim(),
        desc: row[1] ? row[1].trim() : ''
      }));
    console.log('対応可能工事データ読み込み完了:', reformWorks.length, '件');
  } catch (error) {
    console.error('対応可能工事CSV取得エラー:', error);
  } finally {
    reformWorksReady = true;
    reformWorksReadyResolve();
  }
}

/**
 * CSVデータから都道府県別のインデックス（Map）を構築する。
 * 各エントリには市区町村名・かな・行インデックス・行データを格納。
 */
function buildIndex() {
  appData.rowsByPref = new Map();

  for (let i = CONFIG.DATA_START_ROW - 1; i < appData.table.length; i++) {
    const row = appData.table[i];
    const pref = row[0]?.trim();
    const muni = row[1]?.trim();
    const kana = row[2]?.trim();

    if (!pref || !muni) continue;

    if (!appData.rowsByPref.has(pref)) {
      appData.rowsByPref.set(pref, []);
    }

    appData.rowsByPref.get(pref).push({
      muni,
      kana,
      rowIndex: i + 1,
      rowData: row
    });
  }
}

/** データ読み込み完了時にプレースホルダーとヒントテキストを更新する。 */
function onDataReady() {
  // placeholderを更新
  elMuni.placeholder = "市区町村名を入力してください";

  // ヒントを更新（ローディング表示を解除）
  if (elMuniHint) {
    elMuniHint.classList.remove("loading-hint");
    elMuniHint.textContent = "※ ひらがなを数文字入力すると候補が絞り込めます";
  }
}

// ==================== サジェスト ====================

/**
 * 指定都道府県内で、市区町村名またはかな読みが query に部分一致する候補を返す。
 * 重複を除外し、最大 CONFIG.SUGGEST_LIMIT 件まで返す。
 */
function suggestMunicipalities(pref, query) {
  if (!pref) return [];

  const rows = appData.rowsByPref.get(pref) || [];
  const queryLower = query.toLowerCase();
  const results = [];
  const seen = new Set();

  for (const row of rows) {
    if (seen.has(row.muni)) continue;

    const muniMatch = row.muni.toLowerCase().includes(queryLower);
    const kanaMatch = row.kana.toLowerCase().includes(queryLower);

    if (muniMatch || kanaMatch) {
      results.push({
        muni: row.muni,
        kana: row.kana
      });
      seen.add(row.muni);

      if (results.length >= CONFIG.SUGGEST_LIMIT) break;
    }
  }

  return results;
}

/** サジェスト候補リストを datalist の option 要素として描画する。 */
function renderSuggest(list) {
  elMuniList.innerHTML = "";
  (list || []).forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.muni || "";
    if (item.kana) opt.label = item.kana;
    elMuniList.appendChild(opt);
  });
}

/** 現在の都道府県と入力値からサジェスト候補を検索し、datalist を更新する。 */
function requestSuggest() {
  const pref = elPref.value;
  const q = elMuni.value;

  if (!pref) {
    renderSuggest([]);
    return;
  }

  const list = suggestMunicipalities(pref, q);

  // 入力値が候補と完全一致する場合はリストをクリア（選択後の再表示を防止）
  if (list.length === 1 && list[0].muni === q) {
    renderSuggest([]);
    return;
  }

  renderSuggest(list);
}

/** サジェストリクエストを200msのデバウンスで遅延実行する。 */
function debounceSuggest() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(requestSuggest, 200);
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

  const targetRow = matches[0];
  const values = targetRow.rowData.slice(CONFIG.FIRST_JUDGE_COL - 1);

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
    group.appendChild(item);
  });

  return group;
}

/**
 * リベ大リフォームグループの結果カードを生成して返す。
 * 対応可能/要相談の工事一覧をバッジで表示し、各工事の紹介セクションも含む。
 * 工事情報CSV未取得時はエラーメッセージを表示する。
 */
function renderReformGroup(reformItems) {
  const group = document.createElement("div");
  group.className = "result-item-group";
  group.innerHTML = `
      <h3 class="result-title">
        <img src="assets/images/logo_rehome.svg" alt="リベ大リフォーム" width="132" height="24">
      </h3>
    `;

  // 工事情報CSVの取得に失敗した場合
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

  const availableWorks = reformWorks
    .filter(work => getStatusClass(reformMap.get(work.colKey) ?? '') === 'available')
    .map(work => work.name);
  const consultWorks = reformWorks
    .filter(work => getStatusClass(reformMap.get(work.colKey) ?? '') === 'consult')
    .map(work => work.name);

  // リフォーム result-item
  const reformResultItem = document.createElement("div");
  reformResultItem.className = "result-item";

  const reformServiceTitle = document.createElement("h4");
  reformServiceTitle.className = "result-service";
  reformServiceTitle.textContent = "リフォーム";
  reformResultItem.appendChild(reformServiceTitle);

  if (availableWorks.length === 0 && consultWorks.length === 0) {
    const statusDiv = document.createElement("div");
    statusDiv.className = "result-status";
    const badge = document.createElement("span");
    badge.className = "status-badge unavailable";
    badge.textContent = "対応不可";
    statusDiv.appendChild(badge);
    reformResultItem.appendChild(statusDiv);
  } else {
    // バッジリスト生成ヘルパー
    const appendBadgeGroup = (works, labelText, badgeClass) => {
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
        li.textContent = w;
        ul.appendChild(li);
      });
      statusDiv.appendChild(ul);
      reformResultItem.appendChild(statusDiv);
    };
    appendBadgeGroup(availableWorks, "対応可能工事：", "partial");
    appendBadgeGroup(consultWorks, "要相談工事：", "consult");
  }
  group.appendChild(reformResultItem);

  // リフォーム各工事の紹介（動的 is_available 付与）
  const workIntro = document.createElement("section");
  workIntro.className = "work-intro";

  const workIntroTitle = document.createElement("h3");
  workIntroTitle.className = "work-intro-title";
  workIntroTitle.textContent = "リフォーム各工事の紹介";
  workIntro.appendChild(workIntroTitle);

  const workIntroList = document.createElement("dl");
  workIntroList.className = "work-intro-list";

  reformWorks.forEach(work => {
    const workValue = reformMap.get(work.colKey) ?? "";
    const workStatus  = getStatusClass(workValue);
    const isAvailable = workStatus === 'available';
    const isConsult   = workStatus === 'consult';

    const dt = document.createElement("dt");
    dt.className = `work-intro-term${isAvailable ? ' is_available' : isConsult ? ' is_consult' : ''}`;
    dt.textContent = work.name;

    const dd = document.createElement("dd");
    dd.className = "work-intro-desc";
    dd.textContent = work.desc;

    workIntroList.appendChild(dt);
    workIntroList.appendChild(dd);
  });

  workIntro.appendChild(workIntroList);
  group.appendChild(workIntro);

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

  if (komutenItems.length > 0) {
    elResult.appendChild(renderKomutenGroup(komutenItems));
  }

  if (reformItems.length > 0) {
    elResult.appendChild(renderReformGroup(reformItems));
  }

  elResult.classList.add("show", "fade-in");

  // 結果ヘッダーがスティッキーヘッダー直下に来るようスクロール
  requestAnimationFrame(() => {
    const headerHeight = document.querySelector(".header")?.offsetHeight || 0;
    const resultTop = elResult.getBoundingClientRect().top + window.scrollY;
    const scrollTarget = resultTop - headerHeight - 16;
    window.scrollTo({ top: scrollTarget, behavior: "smooth" });
  });
}

// ==================== イベントハンドラ ====================

/** 都道府県セレクト変更時：市区町村入力をリセットし、サジェスト候補を再構築する。 */
function onPrefChange() {
  setMsg("", "");
  clearResult();
  elMuni.value = "";
  renderSuggest([]);
  debounceSuggest();
  // ヒントを再表示
  if (elMuniHint) {
    elMuniHint.classList.remove("hidden");
  }
  // 都道府県が選択されたら市区町村入力へフォーカス
  if (elPref.value) {
    elMuni.focus();
  }
}

/** 市区町村入力時：ヒントの表示切替とサジェスト候補の更新を行う。 */
function onMuniInput() {
  // 入力があればヒントを非表示
  if (elMuni.value.length > 0) {
    if (elMuniHint) {
      elMuniHint.classList.add("hidden");
    }
  } else {
    // 空になったらヒントを再表示
    if (elMuniHint) {
      elMuniHint.classList.remove("hidden");
    }
  }
  // サジェスト処理
  debounceSuggest();
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

  // 基本バリデーション（都道府県・市区町村が入力されているか）
  if (!pref) {
    setMsg('都道府県を選択してください', "error");
    return;
  }
  if (!muni) {
    setMsg('市区町村を入力してください', "error");
    return;
  }

  setBusy(true);

  // データがまだ準備できていない場合はローディングを表示して待つ
  if (!appData.isReady) {
    showLoading();

    // タイムアウト警告を設定
    loadingTimeout = setTimeout(() => {
      showLoadingError();
    }, 20000);

    await dataReadyPromise;
    hideLoading();

    // エラーがあった場合
    if (appData.loadError) {
      let errorMessage = 'データの読み込みに失敗しました';
      if (appData.loadError.name === 'AbortError') {
        errorMessage = '読み込みに時間がかかりすぎています。ページを再読み込みしてください。';
      } else if (!navigator.onLine) {
        errorMessage = 'インターネット接続を確認してください';
      }
      setMsg(errorMessage, 'error');
      setBusy(false);
      return;
    }
  }

  // リフォーム工事データの準備を待つ
  if (!reformWorksReady) {
    await reformWorksReadyPromise;
  }

  // 市区町村の存在チェック
  const rows = appData.rowsByPref.get(pref) || [];
  const exists = rows.some(row => row.muni === muni);
  if (!exists) {
    setMsg('市区町村は表示された候補から選択してください', "error");
    setBusy(false);
    return;
  }

  setTimeout(() => {
    const result = getJudgement(pref, muni);
    renderMenu(result);
    setBusy(false);
  }, 300);
}

// ==================== 初期化 ====================

document.addEventListener("DOMContentLoaded", () => {
  // イベントリスナー設定
  elPref.addEventListener("change", onPrefChange);
  elMuni.addEventListener("input", onMuniInput);
  elMuni.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  });
  elBtn.addEventListener("click", onSubmit);

  // CSVデータをバックグラウンドで並列取得
  loadAndParseCSV();
  loadReformWorks();
});
