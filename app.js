/**
 * 나라장터 발주계획 통합 조회 웹앱 (100% Client-Side Vanilla JS)
 */
(function () {
  "use strict";

  const STORAGE_KEY_BOOKMARKS = "nsu_koneps_bookmarks_v1";
  const STORAGE_KEY_THEME = "nsu_koneps_theme_v1";

  // App State
  const state = {
    allRows: [],
    filteredRows: [],
    bookmarks: new Set(),
    sourceFileName: "UI-ADOCAA-003R.나라장터_발주_계획_내역.csv",
    filters: {
      keyword: "",
      method: "ALL",       // 조달방식
      region: "ALL",       // 광역시/도
      agency: "ALL",       // 발주기관
      intl: "ALL",         // 국제입찰대상여부
      agreement: "ALL",    // 협정구분
      termType: "ALL",     // 신규장기구분
      budgetPreset: "ALL", // 예산 범위 프리셋
      minBudget: "",
      maxBudget: "",
      excludeDummy: false, // 100원 이하 및 테스트기관 제외
      onlyBookmarks: false
    },
    sort: {
      field: "budgetNum",
      dir: "desc"
    },
    pagination: {
      page: 1,
      pageSize: 30
    },
    viewMode: "table", // 'table' | 'card'
    compactMode: false,
    currentDetailRow: null
  };

  /**
   * RFC 4180 Compliant CSV Parser (handles multiline fields & escaped quotes)
   */
  function parseCSV(csvText) {
    const rows = [];
    let currentRow = [];
    let currentVal = "";
    let inQuotes = false;
    const text = csvText.replace(/^\uFEFF/, ""); // Strip BOM if present
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const ch = text[i];
      const nextCh = i + 1 < len ? text[i + 1] : "";

      if (inQuotes) {
        if (ch === '"' && nextCh === '"') {
          currentVal += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          currentVal += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          currentRow.push(currentVal.trim());
          currentVal = "";
        } else if (ch === "\r" && nextCh === "\n") {
          currentRow.push(currentVal.trim());
          if (currentRow.length > 1 || currentRow[0] !== "") {
            rows.push(currentRow);
          }
          currentRow = [];
          currentVal = "";
          i++;
        } else if (ch === "\n" || ch === "\r") {
          currentRow.push(currentVal.trim());
          if (currentRow.length > 1 || currentRow[0] !== "") {
            rows.push(currentRow);
          }
          currentRow = [];
          currentVal = "";
        } else {
          currentVal += ch;
        }
      }
    }

    if (currentVal.length > 0 || currentRow.length > 0) {
      currentRow.push(currentVal.trim());
      if (currentRow.length > 1 || currentRow[0] !== "") {
        rows.push(currentRow);
      }
    }

    if (rows.length < 2) return [];

    const headers = rows[0].map((h) => h.trim());
    const records = [];

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      if (!cols || cols.length < 2) continue;

      const rawMap = {};
      headers.forEach((h, idx) => {
        rawMap[h] = cols[idx] !== undefined ? cols[idx].trim() : "";
      });

      const planNo = rawMap["발주계획번호"] || `ROW-${r}`;
      const rawBudget = (rawMap["구매예정금액(예산액)"] || "0").replace(/[^0-9.-]/g, "");
      const budgetNum = Number(rawBudget) || 0;

      const rawQty = (rawMap["물품수량"] || "0").replace(/[^0-9.-]/g, "");
      const qtyNum = Number(rawQty) || 0;

      const address = rawMap["발주기관소재시군구"] || "";
      const regionTop = extractRegionTop(address);

      const rawDate = rawMap["발주시기"] || "";
      const formattedDate =
        rawDate.length === 6
          ? `${rawDate.slice(0, 4)}.${rawDate.slice(4, 6)}`
          : rawDate;

      const item = {
        id: planNo,
        rowNum: r,
        method: rawMap["조달방식"] || "미분류",
        planNo: planNo,
        projectName: rawMap["사업명"] || "",
        orderDate: rawDate,
        orderDateFormatted: formattedDate,
        agencyCode: rawMap["발주기관코드"] || "",
        agencyName: rawMap["발주기관"] || "",
        contractMethod: rawMap["계약방법"] || "",
        intlBid: rawMap["국제입찰대상여부"] || "-",
        agreement: rawMap["협정구분"] || "-",
        termType: rawMap["신규장기구분"] || "-",
        deptName: rawMap["발주기관담당부서"] || "",
        address: address,
        regionTop: regionTop,
        categoryNo: rawMap["물품분류번호"] || "",
        categoryName: rawMap["품명"] || "",
        subCategoryNo: rawMap["세부물품분류번호"] || "",
        subCategoryName: rawMap["세부품명"] || "",
        purpose: rawMap["용도"] || "",
        spec: rawMap["주요규격"] || "",
        qtyStr: rawMap["물품수량"] || "",
        qtyNum: qtyNum,
        unit: rawMap["단위"] || "",
        budgetStr: rawMap["구매예정금액(예산액)"] || "0",
        budgetNum: budgetNum,
        isDummy:
          budgetNum <= 100 ||
          (rawMap["발주기관"] || "").includes("테스트") ||
          (rawMap["사업명"] || "").includes("테스트")
      };

      item.searchIndex = [
        item.planNo,
        item.projectName,
        item.agencyName,
        item.agencyCode,
        item.deptName,
        item.address,
        item.categoryName,
        item.subCategoryName,
        item.categoryNo,
        item.subCategoryNo,
        item.purpose,
        item.spec,
        item.contractMethod
      ]
        .join(" ")
        .toLowerCase();

      records.push(item);
    }

    return records;
  }

  function extractRegionTop(address) {
    if (!address) return "미상";
    const firstToken = address.trim().split(/\s+/)[0];
    if (!firstToken) return "미상";
    return firstToken;
  }

  /**
   * Format Korean Won cleanly (e.g. 55.1억원, 2.83억원, 4,500만원)
   */
  function formatKoreanCurrency(num) {
    if (!num || num <= 0) return "0원";
    if (num >= 100000000) {
      const eok = num / 100000000;
      const fixed = eok >= 100 ? eok.toFixed(0) : eok >= 10 ? eok.toFixed(1) : eok.toFixed(2);
      return `약 ${Number(fixed).toLocaleString("ko-KR")}억원`;
    }
    if (num >= 10000) {
      const man = Math.round(num / 10000);
      return `약 ${man.toLocaleString("ko-KR")}만원`;
    }
    return `${num.toLocaleString("ko-KR")}원`;
  }

  function formatNumber(num) {
    return Number(num || 0).toLocaleString("ko-KR");
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function highlightText(text, keyword) {
    const safe = escapeHtml(text);
    if (!keyword) return safe;
    const terms = keyword
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (terms.length === 0) return safe;
    const regex = new RegExp(`(${terms.join("|")})`, "gi");
    return safe.replace(regex, '<mark class="hl">$1</mark>');
  }

  /**
   * Bookmarks & Theme persistence
   */
  function loadSavedState() {
    try {
      const savedBm = localStorage.getItem(STORAGE_KEY_BOOKMARKS);
      if (savedBm) {
        const arr = JSON.parse(savedBm);
        if (Array.isArray(arr)) {
          state.bookmarks = new Set(arr);
        }
      }
      const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
      if (savedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        const btn = document.getElementById("btnThemeToggle");
        if (btn) btn.textContent = "☀️ 라이트 모드";
      }
    } catch (e) {
      // Ignore storage error on restricted environments
    }
  }

  function saveBookmarks() {
    try {
      localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(Array.from(state.bookmarks)));
    } catch (e) {
      // Ignore
    }
    updateBookmarkCounter();
  }

  function toggleBookmark(planNo, event) {
    if (event) event.stopPropagation();
    if (state.bookmarks.has(planNo)) {
      state.bookmarks.delete(planNo);
      showToast(`관심 목록에서 해제됨 (${planNo})`);
    } else {
      state.bookmarks.add(planNo);
      showToast(`⭐ 관심 발주계획에 저장됨 (${planNo})`);
    }
    saveBookmarks();
    if (state.filters.onlyBookmarks) {
      applyFiltersAndRender();
    } else {
      renderDataView();
    }
  }

  function updateBookmarkCounter() {
    const countEl = document.getElementById("bookmarkCountBadge");
    if (countEl) {
      countEl.textContent = state.bookmarks.size;
    }
  }

  /**
   * Populate Select Dropdown Options Dynamically
   */
  function populateFilterDropdowns() {
    const methods = new Map();
    const regions = new Map();
    const agencies = new Map();

    state.allRows.forEach((r) => {
      methods.set(r.method, (methods.get(r.method) || 0) + 1);
      regions.set(r.regionTop, (regions.get(r.regionTop) || 0) + 1);
      if (r.agencyName) {
        agencies.set(r.agencyName, (agencies.get(r.agencyName) || 0) + 1);
      }
    });

    // 조달방식
    const selMethod = document.getElementById("filterMethod");
    selMethod.innerHTML = '<option value="ALL">전체 조달방식</option>';
    Array.from(methods.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, cnt]) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = `${k} (${cnt.toLocaleString()}건)`;
        selMethod.appendChild(opt);
      });

    // 지역 (시/도)
    const selRegion = document.getElementById("filterRegion");
    selRegion.innerHTML = '<option value="ALL">전체 지역 (시/도)</option>';
    Array.from(regions.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, cnt]) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = `${k} (${cnt.toLocaleString()}건)`;
        selRegion.appendChild(opt);
      });

    // 발주기관
    const selAgency = document.getElementById("filterAgency");
    selAgency.innerHTML = '<option value="ALL">전체 발주기관</option>';
    Array.from(agencies.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, cnt]) => {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = `${k} (${cnt}건)`;
        selAgency.appendChild(opt);
      });
  }

  /**
   * Filter & Sort Pipeline
   */
  function applyFiltersAndRender(resetPage = true) {
    if (resetPage) {
      state.pagination.page = 1;
    }

    const f = state.filters;
    const kwTerms = f.keyword
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const minB = f.minBudget !== "" ? Number(f.minBudget) : null;
    const maxB = f.maxBudget !== "" ? Number(f.maxBudget) : null;

    state.filteredRows = state.allRows.filter((row) => {
      if (f.onlyBookmarks && !state.bookmarks.has(row.planNo)) return false;
      if (f.excludeDummy && row.isDummy) return false;
      if (f.method !== "ALL" && row.method !== f.method) return false;
      if (f.region !== "ALL" && row.regionTop !== f.region) return false;
      if (f.agency !== "ALL" && row.agencyName !== f.agency) return false;
      if (f.intl !== "ALL" && row.intlBid !== f.intl) return false;
      if (f.agreement !== "ALL" && row.agreement !== f.agreement) return false;
      if (f.termType !== "ALL" && row.termType !== f.termType) return false;

      if (minB !== null && row.budgetNum < minB) return false;
      if (maxB !== null && row.budgetNum > maxB) return false;

      if (kwTerms.length > 0) {
        for (let i = 0; i < kwTerms.length; i++) {
          if (!row.searchIndex.includes(kwTerms[i])) {
            return false;
          }
        }
      }

      return true;
    });

    sortFilteredRows();
    renderKPIsAndCharts();
    renderDataView();
    updateSortHeadersUI();
  }

  function sortFilteredRows() {
    const { field, dir } = state.sort;
    const mul = dir === "asc" ? 1 : -1;

    state.filteredRows.sort((a, b) => {
      const va = a[field];
      const vb = b[field];

      if (typeof va === "number" && typeof vb === "number") {
        if (va !== vb) return (va - vb) * mul;
        return a.rowNum - b.rowNum;
      }

      const sa = String(va || "");
      const sb = String(vb || "");
      const cmp = sa.localeCompare(sb, "ko-KR");
      if (cmp !== 0) return cmp * mul;
      return a.rowNum - b.rowNum;
    });
  }

  /**
   * Render KPI Cards & Visual Bar Charts
   */
  function renderKPIsAndCharts() {
    const rows = state.filteredRows;
    const totalCount = rows.length;
    let totalBudget = 0;
    let maxBudgetRow = null;
    let selfCount = 0;
    let centralCount = 0;
    const agencySet = new Set();

    const byAgencyBudget = new Map();
    const byRegionBudget = new Map();
    const byCategoryCount = new Map();

    rows.forEach((r) => {
      totalBudget += r.budgetNum;
      if (!maxBudgetRow || r.budgetNum > maxBudgetRow.budgetNum) {
        maxBudgetRow = r;
      }
      if (r.method === "자체조달") selfCount++;
      else if (r.method === "중앙조달") centralCount++;

      if (r.agencyName) {
        agencySet.add(r.agencyName);
        byAgencyBudget.set(r.agencyName, (byAgencyBudget.get(r.agencyName) || 0) + r.budgetNum);
      }

      const reg = r.regionTop || "미상";
      byRegionBudget.set(reg, (byRegionBudget.get(reg) || 0) + r.budgetNum);

      const catLabel = r.subCategoryName || r.categoryName || "품명 미지정(공사/용역 등)";
      byCategoryCount.set(catLabel, (byCategoryCount.get(catLabel) || 0) + 1);
    });

    const avgBudget = totalCount > 0 ? Math.round(totalBudget / totalCount) : 0;

    // Update KPI DOM
    document.getElementById("kpiTotalCount").textContent = `${formatNumber(totalCount)}건`;
    document.getElementById("kpiTotalCountSub").textContent =
      `전체 ${formatNumber(state.allRows.length)}건 중 ${(totalCount / Math.max(state.allRows.length, 1) * 100).toFixed(1)}%`;

    document.getElementById("kpiTotalBudget").textContent = formatKoreanCurrency(totalBudget);
    document.getElementById("kpiTotalBudgetSub").textContent = `${formatNumber(totalBudget)}원`;

    document.getElementById("kpiAvgBudget").textContent = formatKoreanCurrency(avgBudget);
    document.getElementById("kpiAvgBudgetSub").textContent =
      maxBudgetRow
        ? `최대: ${formatKoreanCurrency(maxBudgetRow.budgetNum)} (${maxBudgetRow.agencyName})`
        : "데이터 없음";

    document.getElementById("kpiMethodSplit").textContent =
      `${formatNumber(selfCount)} / ${formatNumber(centralCount)}`;
    document.getElementById("kpiMethodSplitSub").textContent =
      `참여 발주기관 총 ${formatNumber(agencySet.size)}개 기관`;

    // Render Top 6 Agencies by Budget
    renderBarChart(
      "chartTopAgencies",
      byAgencyBudget,
      (val) => formatKoreanCurrency(val),
      (agency) => {
        document.getElementById("filterAgency").value = agency;
        state.filters.agency = agency;
        applyFiltersAndRender();
        showToast(`발주기관 필터 적용: ${agency}`);
      }
    );

    // Render Top 6 Regions by Budget
    renderBarChart(
      "chartTopRegions",
      byRegionBudget,
      (val) => formatKoreanCurrency(val),
      (region) => {
        document.getElementById("filterRegion").value = region;
        state.filters.region = region;
        applyFiltersAndRender();
        showToast(`지역 필터 적용: ${region}`);
      }
    );

    // Render Top 6 Item Categories by Count
    renderBarChart(
      "chartTopCategories",
      byCategoryCount,
      (val) => `${formatNumber(val)}건`,
      (cat) => {
        if (cat === "품명 미지정(공사/용역 등)") return;
        const searchInput = document.getElementById("searchInput");
        searchInput.value = cat;
        state.filters.keyword = cat;
        document.getElementById("btnClearSearch").style.display = "block";
        applyFiltersAndRender();
        showToast(`품명 검색 적용: ${cat}`);
      }
    );
  }

  function renderBarChart(containerId, dataMap, valueFormatter, onClickLabel) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const sorted = Array.from(dataMap.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    if (sorted.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">조건에 맞는 데이터가 없습니다.</div>`;
      return;
    }

    const maxVal = sorted[0][1] || 1;
    container.innerHTML = "";

    sorted.forEach(([label, val]) => {
      const pct = Math.max(4, Math.round((val / maxVal) * 100));
      const row = document.createElement("div");
      row.className = "bar-item";
      row.title = `클릭하여 '${label}' 조건으로 필터링 (${valueFormatter(val)})`;
      row.innerHTML = `
        <div class="bar-label">${escapeHtml(label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="bar-val">${escapeHtml(valueFormatter(val))}</div>
      `;
      row.addEventListener("click", () => onClickLabel(label));
      container.appendChild(row);
    });
  }

  /**
   * Render Table or Card Grid + Pagination
   */
  function renderDataView() {
    const total = state.filteredRows.length;
    const pageSize = state.pagination.pageSize === "ALL" ? Math.max(total, 1) : Number(state.pagination.pageSize);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.pagination.page > totalPages) state.pagination.page = totalPages;

    const startIdx = (state.pagination.page - 1) * pageSize;
    const pageRows = state.filteredRows.slice(startIdx, startIdx + pageSize);

    // Result summary count
    document.getElementById("resultCountText").innerHTML =
      `조회 결과 <span>${formatNumber(total)}</span>건` +
      (total > 0 ? ` (${startIdx + 1}~${Math.min(startIdx + pageRows.length, total)}번째 표시)` : "");

    const tableWrapper = document.getElementById("tableViewWrapper");
    const cardsWrapper = document.getElementById("cardViewWrapper");

    if (state.viewMode === "table") {
      tableWrapper.style.display = "block";
      cardsWrapper.classList.remove("active");
      renderTableBody(pageRows);
    } else {
      tableWrapper.style.display = "none";
      cardsWrapper.classList.add("active");
      renderCardsGrid(pageRows);
    }

    renderPagination(totalPages);
  }

  function renderTableBody(rows) {
    const tbody = document.getElementById("tableBody");
    const kw = state.filters.keyword;

    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align:center; padding: 48px 16px; color: var(--text-muted);">
            검색 조건에 일치하는 발주계획 내역이 없습니다. 필터를 초기화하거나 검색어를 변경해 보세요.
          </td>
        </tr>
      `;
      return;
    }

    const htmlChunks = rows.map((r) => {
      const isBookmarked = state.bookmarks.has(r.planNo);
      const methodBadgeClass = r.method === "중앙조달" ? "badge-central" : "badge-self";
      const amountClass =
        r.budgetNum >= 1000000000
          ? "amount-high"
          : r.budgetNum >= 100000000
          ? "amount-mid"
          : "";

      const itemDisplay = r.subCategoryName || r.categoryName || "-";
      const itemCodeDisplay = r.subCategoryNo || r.categoryNo || "";

      return `
        <tr data-plan="${escapeHtml(r.planNo)}" class="${isBookmarked ? "bookmarked-row" : ""}">
          <td style="text-align:center;" class="cell-star">
            <button type="button" class="star-btn ${isBookmarked ? "active" : ""}" data-star="${escapeHtml(r.planNo)}" title="관심 발주계획 저장">
              ${isBookmarked ? "★" : "☆"}
            </button>
          </td>
          <td><span class="badge ${methodBadgeClass}">${escapeHtml(r.method)}</span></td>
          <td class="cell-mono">${highlightText(r.planNo, kw)}</td>
          <td class="cell-title">
            ${highlightText(r.projectName, kw)}
            ${r.purpose ? `<span class="cell-sub">용도: ${highlightText(r.purpose.slice(0, 60), kw)}</span>` : ""}
          </td>
          <td class="cell-agency">
            ${highlightText(r.agencyName, kw)}
            <span class="cell-sub">${highlightText(r.deptName || "-", kw)}</span>
          </td>
          <td>
            ${highlightText(r.regionTop, kw)}
            <span class="cell-sub">${highlightText(r.address, kw)}</span>
          </td>
          <td>
            ${highlightText(itemDisplay, kw)}
            ${itemCodeDisplay ? `<span class="cell-sub">${highlightText(itemCodeDisplay, kw)}</span>` : ""}
          </td>
          <td style="text-align:right; white-space:nowrap;">
            ${r.qtyStr ? `${escapeHtml(r.qtyStr)} ${escapeHtml(r.unit)}` : "-"}
          </td>
          <td class="cell-amount ${amountClass}">
            ${formatNumber(r.budgetNum)}원
            <span class="amount-korean">${formatKoreanCurrency(r.budgetNum)}</span>
          </td>
          <td style="text-align:center; white-space:nowrap;">
            <span class="badge ${r.intlBid === "Y" ? "badge-intl-y" : "badge-intl-n"}">
              ${escapeHtml(r.contractMethod || "-")} / 국제:${escapeHtml(r.intlBid)}
            </span>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = htmlChunks.join("");
  }

  function renderCardsGrid(rows) {
    const container = document.getElementById("cardViewWrapper");
    const kw = state.filters.keyword;

    if (rows.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align:center; padding: 48px 16px; color: var(--text-muted);">
          검색 조건에 일치하는 발주계획 내역이 없습니다.
        </div>
      `;
      return;
    }

    container.innerHTML = rows
      .map((r) => {
        const isBookmarked = state.bookmarks.has(r.planNo);
        const methodBadgeClass = r.method === "중앙조달" ? "badge-central" : "badge-self";
        const itemDisplay = r.subCategoryName || r.categoryName || "품명 미지정";

        return `
          <div class="order-card" data-plan="${escapeHtml(r.planNo)}">
            <div class="order-card-top">
              <div style="display:flex; gap:6px; align-items:center;">
                <span class="badge ${methodBadgeClass}">${escapeHtml(r.method)}</span>
                <span class="cell-mono">${highlightText(r.planNo, kw)}</span>
              </div>
              <button type="button" class="star-btn ${isBookmarked ? "active" : ""}" data-star="${escapeHtml(r.planNo)}">
                ${isBookmarked ? "★" : "☆"}
              </button>
            </div>
            <div class="order-card-title">${highlightText(r.projectName, kw)}</div>
            <div class="order-card-meta">
              <div>🏢 <strong>${highlightText(r.agencyName, kw)}</strong> (${highlightText(r.deptName || "-", kw)})</div>
              <div>📍 ${highlightText(r.address || "-", kw)}</div>
              <div>📦 ${highlightText(itemDisplay, kw)} ${r.qtyStr ? `· ${escapeHtml(r.qtyStr)} ${escapeHtml(r.unit)}` : ""}</div>
            </div>
            <div class="order-card-bottom">
              <span style="font-size:12px; color:var(--text-muted);">발주시기: ${escapeHtml(r.orderDateFormatted)}</span>
              <div style="text-align:right;">
                <div style="font-size:15px; font-weight:800; color:var(--primary);">${formatNumber(r.budgetNum)}원</div>
                <div style="font-size:11px; color:var(--text-muted);">${formatKoreanCurrency(r.budgetNum)}</div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderPagination(totalPages) {
    const pageInfo = document.getElementById("paginationInfo");
    const btnGroup = document.getElementById("paginationButtons");
    const cur = state.pagination.page;

    pageInfo.textContent = `페이지 ${cur} / ${totalPages}`;
    btnGroup.innerHTML = "";

    const createBtn = (label, targetPage, disabled = false, active = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `page-btn ${active ? "active" : ""}`;
      b.textContent = label;
      b.disabled = disabled;
      b.addEventListener("click", () => {
        state.pagination.page = targetPage;
        renderDataView();
        document.querySelector(".table-section").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return b;
    };

    btnGroup.appendChild(createBtn("« 처음", 1, cur === 1));
    btnGroup.appendChild(createBtn("‹ 이전", Math.max(1, cur - 1), cur === 1));

    const windowSize = 5;
    let startP = Math.max(1, cur - Math.floor(windowSize / 2));
    let endP = Math.min(totalPages, startP + windowSize - 1);
    if (endP - startP + 1 < windowSize) {
      startP = Math.max(1, endP - windowSize + 1);
    }

    for (let p = startP; p <= endP; p++) {
      btnGroup.appendChild(createBtn(String(p), p, false, p === cur));
    }

    btnGroup.appendChild(createBtn("다음 ›", Math.min(totalPages, cur + 1), cur === totalPages));
    btnGroup.appendChild(createBtn("끝 »", totalPages, cur === totalPages));
  }

  function updateSortHeadersUI() {
    document.querySelectorAll("th.sortable").forEach((th) => {
      const field = th.getAttribute("data-sort");
      const indicator = th.querySelector(".sort-indicator");
      th.classList.remove("sorted-asc", "sorted-desc");
      if (field === state.sort.field) {
        th.classList.add(state.sort.dir === "asc" ? "sorted-asc" : "sorted-desc");
        if (indicator) indicator.textContent = state.sort.dir === "asc" ? "▲" : "▼";
      } else {
        if (indicator) indicator.textContent = "↕";
      }
    });
  }

  /**
   * Detail Modal
   */
  function openDetailModal(planNo) {
    const row = state.allRows.find((r) => r.planNo === planNo);
    if (!row) return;
    state.currentDetailRow = row;

    const isBookmarked = state.bookmarks.has(row.planNo);
    document.getElementById("modalBadges").innerHTML = `
      <span class="badge ${row.method === "중앙조달" ? "badge-central" : "badge-self"}">${escapeHtml(row.method)}</span>
      <span class="cell-mono" style="font-weight:700;">발주계획번호: ${escapeHtml(row.planNo)}</span>
      <span class="badge badge-intl-n">발주시기: ${escapeHtml(row.orderDateFormatted || "-")}</span>
    `;
    document.getElementById("modalProjectTitle").textContent = row.projectName || "(사업명 없음)";
    document.getElementById("modalBudgetMain").textContent = `${formatNumber(row.budgetNum)}원`;
    document.getElementById("modalBudgetSub").textContent = formatKoreanCurrency(row.budgetNum);

    const btnModalStar = document.getElementById("btnModalBookmark");
    btnModalStar.textContent = isBookmarked ? "★ 관심 발주계획 등록됨" : "☆ 관심 발주계획 저장";
    btnModalStar.className = `btn ${isBookmarked ? "btn-active" : ""}`;

    // Related orders from same agency
    const sameAgencyRows = state.allRows.filter(
      (r) => r.agencyName === row.agencyName && r.planNo !== row.planNo
    );

    const fieldsHtml = `
      <div>
        <div class="detail-section-title">🏢 발주기관 및 계약 기본정보</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-item-label">발주기관 (기관코드)</div>
            <div class="detail-item-value">${escapeHtml(row.agencyName || "-")} (${escapeHtml(row.agencyCode || "-")})</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">담당부서</div>
            <div class="detail-item-value">${escapeHtml(row.deptName || "-")}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">소재지 (시군구)</div>
            <div class="detail-item-value">${escapeHtml(row.address || "-")}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">계약방법 / 조달방식</div>
            <div class="detail-item-value">${escapeHtml(row.contractMethod || "-")} / ${escapeHtml(row.method || "-")}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">국제입찰 / 협정구분</div>
            <div class="detail-item-value">국제입찰: ${escapeHtml(row.intlBid)} / 협정구분: ${escapeHtml(row.agreement)}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">신규/장기 구분</div>
            <div class="detail-item-value">${escapeHtml(row.termType || "-")}</div>
          </div>
        </div>
      </div>

      <div>
        <div class="detail-section-title">📦 물품 분류 및 규격·수량 정보</div>
        <div class="detail-grid">
          <div class="detail-item">
            <div class="detail-item-label">품명 (물품분류번호)</div>
            <div class="detail-item-value">${escapeHtml(row.categoryName || "-")} ${row.categoryNo ? `(${escapeHtml(row.categoryNo)})` : ""}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">세부품명 (세부물품분류번호)</div>
            <div class="detail-item-value">${escapeHtml(row.subCategoryName || "-")} ${row.subCategoryNo ? `(${escapeHtml(row.subCategoryNo)})` : ""}</div>
          </div>
          <div class="detail-item">
            <div class="detail-item-label">물품수량 / 단위</div>
            <div class="detail-item-value">${escapeHtml(row.qtyStr || "-")} ${escapeHtml(row.unit || "")}</div>
          </div>
          <div class="detail-item full-width">
            <div class="detail-item-label">용도</div>
            <div class="detail-item-value">${escapeHtml(row.purpose || "-")}</div>
          </div>
          <div class="detail-item full-width">
            <div class="detail-item-label">주요규격</div>
            <div class="detail-item-value">${escapeHtml(row.spec || "-")}</div>
          </div>
        </div>
      </div>

      ${
        sameAgencyRows.length > 0
          ? `
        <div>
          <div class="detail-section-title">🔗 동일 발주기관(${escapeHtml(row.agencyName)})의 다른 발주계획 (${sameAgencyRows.length}건)</div>
          <div style="max-height:160px; overflow-y:auto; border:1px solid var(--border-color); border-radius:var(--radius-sm);">
            <table class="data-table compact" style="font-size:12px;">
              <thead>
                <tr>
                  <th>발주계획번호</th>
                  <th>사업명</th>
                  <th>세부품명</th>
                  <th style="text-align:right;">예산액</th>
                </tr>
              </thead>
              <tbody>
                ${sameAgencyRows
                  .slice(0, 15)
                  .map(
                    (sr) => `
                  <tr data-related-plan="${escapeHtml(sr.planNo)}">
                    <td class="cell-mono">${escapeHtml(sr.planNo)}</td>
                    <td>${escapeHtml(sr.projectName)}</td>
                    <td>${escapeHtml(sr.subCategoryName || sr.categoryName || "-")}</td>
                    <td style="text-align:right; font-weight:700;">${formatNumber(sr.budgetNum)}원</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `
          : ""
      }
    `;

    const detailsContainer = document.getElementById("modalDetailsContainer");
    detailsContainer.innerHTML = fieldsHtml;

    detailsContainer.querySelectorAll("tr[data-related-plan]").forEach((tr) => {
      tr.addEventListener("click", () => {
        openDetailModal(tr.getAttribute("data-related-plan"));
      });
    });

    document.getElementById("detailModalBackdrop").classList.add("open");
  }

  function closeDetailModal() {
    document.getElementById("detailModalBackdrop").classList.remove("open");
    state.currentDetailRow = null;
  }

  /**
   * Export Filtered Data to CSV (with UTF-8 BOM for Excel on Windows)
   */
  function exportFilteredToCSV() {
    if (state.filteredRows.length === 0) {
      showToast("내보낼 조회 데이터가 없습니다.");
      return;
    }

    const headers = [
      "조달방식",
      "발주계획번호",
      "사업명",
      "발주시기",
      "발주기관코드",
      "발주기관",
      "계약방법",
      "국제입찰대상여부",
      "협정구분",
      "신규장기구분",
      "발주기관담당부서",
      "발주기관소재시군구",
      "물품분류번호",
      "품명",
      "세부물품분류번호",
      "세부품명",
      "용도",
      "주요규격",
      "물품수량",
      "단위",
      "구매예정금액(예산액)"
    ];

    const escapeCsvCell = (val) => {
      const s = String(val ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = [headers.join(",")];
    state.filteredRows.forEach((r) => {
      const rowValues = [
        r.method,
        r.planNo,
        r.projectName,
        r.orderDate,
        r.agencyCode,
        r.agencyName,
        r.contractMethod,
        r.intlBid === "-" ? "" : r.intlBid,
        r.agreement === "-" ? "" : r.agreement,
        r.termType === "-" ? "" : r.termType,
        r.deptName,
        r.address,
        r.categoryNo,
        r.categoryName,
        r.subCategoryNo,
        r.subCategoryName,
        r.purpose,
        r.spec,
        r.qtyStr,
        r.unit,
        r.budgetNum
      ];
      lines.push(rowValues.map(escapeCsvCell).join(","));
    });

    const csvContent = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `발주계획_조회결과_${state.filteredRows.length}건_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`📥 CSV 파일 다운로드 완료 (${formatNumber(state.filteredRows.length)}건)`);
  }

  /**
   * Read Uploaded CSV File (Supports both UTF-8 and EUC-KR automatically)
   */
  function handleUploadedFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const buffer = e.target.result;
      let text = "";
      try {
        const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
        text = utf8Decoder.decode(buffer);
      } catch (err) {
        // Fallback to EUC-KR for Korean Windows Excel CSV files
        const euckrDecoder = new TextDecoder("euc-kr");
        text = euckrDecoder.decode(buffer);
      }

      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        showToast("⚠️ 유효한 발주계획 CSV 형식이 아닙니다.");
        return;
      }

      state.allRows = parsed;
      state.sourceFileName = file.name;
      document.getElementById("sourceBadge").textContent = `${file.name} (${formatNumber(parsed.length)}건)`;
      resetAllFilters(false);
      populateFilterDropdowns();
      applyFiltersAndRender(true);
      showToast(`✅ '${file.name}' 파일 로드 완료 (${formatNumber(parsed.length)}건)`);
    };
    reader.readAsArrayBuffer(file);
  }

  function resetAllFilters(shouldRender = true) {
    state.filters = {
      keyword: "",
      method: "ALL",
      region: "ALL",
      agency: "ALL",
      intl: "ALL",
      agreement: "ALL",
      termType: "ALL",
      budgetPreset: "ALL",
      minBudget: "",
      maxBudget: "",
      excludeDummy: false,
      onlyBookmarks: false
    };

    document.getElementById("searchInput").value = "";
    document.getElementById("btnClearSearch").style.display = "none";
    document.getElementById("filterMethod").value = "ALL";
    document.getElementById("filterRegion").value = "ALL";
    document.getElementById("filterAgency").value = "ALL";
    document.getElementById("filterIntl").value = "ALL";
    document.getElementById("filterAgreement").value = "ALL";
    document.getElementById("filterTermType").value = "ALL";
    document.getElementById("minBudgetInput").value = "";
    document.getElementById("maxBudgetInput").value = "";
    document.getElementById("chkExcludeDummy").checked = false;
    document.getElementById("btnOnlyBookmarks").classList.remove("btn-active");

    document.querySelectorAll(".chip[data-budget-preset]").forEach((c) => {
      c.classList.toggle("active", c.getAttribute("data-budget-preset") === "ALL");
    });

    if (shouldRender) {
      applyFiltersAndRender(true);
    }
  }

  function showToast(msg) {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 2600);
  }

  /**
   * Bind Event Listeners
   */
  function initEventListeners() {
    // Search input
    const searchInput = document.getElementById("searchInput");
    const btnClearSearch = document.getElementById("btnClearSearch");

    searchInput.addEventListener("input", (e) => {
      const val = e.target.value;
      state.filters.keyword = val;
      btnClearSearch.style.display = val ? "block" : "none";
      applyFiltersAndRender(true);
    });

    btnClearSearch.addEventListener("click", () => {
      searchInput.value = "";
      state.filters.keyword = "";
      btnClearSearch.style.display = "none";
      applyFiltersAndRender(true);
    });

    // Dropdown filters
    const bindSelect = (id, key) => {
      document.getElementById(id).addEventListener("change", (e) => {
        state.filters[key] = e.target.value;
        applyFiltersAndRender(true);
      });
    };

    bindSelect("filterMethod", "method");
    bindSelect("filterRegion", "region");
    bindSelect("filterAgency", "agency");
    bindSelect("filterIntl", "intl");
    bindSelect("filterAgreement", "agreement");
    bindSelect("filterTermType", "termType");

    // Min/Max custom budget inputs
    const onBudgetInputChange = () => {
      state.filters.minBudget = document.getElementById("minBudgetInput").value;
      state.filters.maxBudget = document.getElementById("maxBudgetInput").value;
      document.querySelectorAll(".chip[data-budget-preset]").forEach((c) => c.classList.remove("active"));
      applyFiltersAndRender(true);
    };
    document.getElementById("minBudgetInput").addEventListener("input", onBudgetInputChange);
    document.getElementById("maxBudgetInput").addEventListener("input", onBudgetInputChange);

    // Budget Preset Chips
    document.querySelectorAll(".chip[data-budget-preset]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const preset = chip.getAttribute("data-budget-preset");
        document.querySelectorAll(".chip[data-budget-preset]").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");

        const minIn = document.getElementById("minBudgetInput");
        const maxIn = document.getElementById("maxBudgetInput");

        if (preset === "ALL") {
          minIn.value = "";
          maxIn.value = "";
        } else if (preset === "UNDER_50M") {
          minIn.value = "";
          maxIn.value = "50000000";
        } else if (preset === "50M_100M") {
          minIn.value = "50000000";
          maxIn.value = "100000000";
        } else if (preset === "100M_500M") {
          minIn.value = "100000000";
          maxIn.value = "500000000";
        } else if (preset === "500M_1B") {
          minIn.value = "500000000";
          maxIn.value = "1000000000";
        } else if (preset === "OVER_1B") {
          minIn.value = "1000000000";
          maxIn.value = "";
        }

        state.filters.minBudget = minIn.value;
        state.filters.maxBudget = maxIn.value;
        applyFiltersAndRender(true);
      });
    });

    // Exclude dummy / 1-won entries checkbox
    document.getElementById("chkExcludeDummy").addEventListener("change", (e) => {
      state.filters.excludeDummy = e.target.checked;
      applyFiltersAndRender(true);
    });

    // Bookmarks filter toggle
    document.getElementById("btnOnlyBookmarks").addEventListener("click", (e) => {
      state.filters.onlyBookmarks = !state.filters.onlyBookmarks;
      e.currentTarget.classList.toggle("btn-active", state.filters.onlyBookmarks);
      applyFiltersAndRender(true);
    });

    // Reset filters
    document.getElementById("btnResetFilters").addEventListener("click", () => {
      resetAllFilters(true);
      showToast("모든 검색 필터가 초기화되었습니다.");
    });

    // Sortable table headers
    document.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", () => {
        const field = th.getAttribute("data-sort");
        if (state.sort.field === field) {
          state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort.field = field;
          state.sort.dir = field === "budgetNum" || field === "qtyNum" ? "desc" : "asc";
        }
        applyFiltersAndRender(false);
      });
    });

    // Page size selector
    document.getElementById("selectPageSize").addEventListener("change", (e) => {
      state.pagination.pageSize = e.target.value;
      state.pagination.page = 1;
      renderDataView();
    });

    // View mode toggle (Table vs Card)
    document.getElementById("btnViewTable").addEventListener("click", () => {
      state.viewMode = "table";
      document.getElementById("btnViewTable").classList.add("btn-active");
      document.getElementById("btnViewCard").classList.remove("btn-active");
      renderDataView();
    });

    document.getElementById("btnViewCard").addEventListener("click", () => {
      state.viewMode = "card";
      document.getElementById("btnViewCard").classList.add("btn-active");
      document.getElementById("btnViewTable").classList.remove("btn-active");
      renderDataView();
    });

    // Compact table toggle
    document.getElementById("btnCompactToggle").addEventListener("click", (e) => {
      state.compactMode = !state.compactMode;
      document.getElementById("mainDataTable").classList.toggle("compact", state.compactMode);
      e.currentTarget.classList.toggle("btn-active", state.compactMode);
    });

    // Table & Card click delegation (Row detail vs Star bookmark)
    const onItemClick = (e) => {
      const starBtn = e.target.closest("button[data-star]");
      if (starBtn) {
        toggleBookmark(starBtn.getAttribute("data-star"), e);
        return;
      }
      const rowEl = e.target.closest("[data-plan]");
      if (rowEl) {
        openDetailModal(rowEl.getAttribute("data-plan"));
      }
    };

    document.getElementById("tableBody").addEventListener("click", onItemClick);
    document.getElementById("cardViewWrapper").addEventListener("click", onItemClick);

    // Analytics panel collapse toggle
    document.getElementById("analyticsToggleHeader").addEventListener("click", () => {
      const body = document.getElementById("analyticsBody");
      const icon = document.getElementById("analyticsCollapseIcon");
      const isCollapsed = body.classList.toggle("collapsed");
      icon.textContent = isCollapsed ? "▼ 펼치기" : "▲ 접기";
    });

    // File upload input & Drag-and-Drop
    const fileInput = document.getElementById("csvFileInput");
    document.getElementById("btnOpenFile").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadedFile(e.target.files[0]);
        e.target.value = "";
      }
    });

    const dropBanner = document.getElementById("dropzoneBanner");
    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropBanner.classList.add("active");
    });
    window.addEventListener("dragleave", (e) => {
      if (e.target === document.documentElement || e.target === document.body) {
        dropBanner.classList.remove("active");
      }
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dropBanner.classList.remove("active");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleUploadedFile(e.dataTransfer.files[0]);
      }
    });

    // Export CSV
    document.getElementById("btnExportCsv").addEventListener("click", exportFilteredToCSV);

    // Dark Mode Toggle
    document.getElementById("btnThemeToggle").addEventListener("click", (e) => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        e.currentTarget.textContent = "🌙 다크 모드";
        try { localStorage.setItem(STORAGE_KEY_THEME, "light"); } catch (_) {}
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        e.currentTarget.textContent = "☀️ 라이트 모드";
        try { localStorage.setItem(STORAGE_KEY_THEME, "dark"); } catch (_) {}
      }
    });

    // Modal controls
    document.getElementById("btnModalClose").addEventListener("click", closeDetailModal);
    document.getElementById("btnModalCloseFooter").addEventListener("click", closeDetailModal);
    document.getElementById("detailModalBackdrop").addEventListener("click", (e) => {
      if (e.target.id === "detailModalBackdrop") closeDetailModal();
    });

    document.getElementById("btnModalBookmark").addEventListener("click", () => {
      if (!state.currentDetailRow) return;
      toggleBookmark(state.currentDetailRow.planNo);
      const isBookmarked = state.bookmarks.has(state.currentDetailRow.planNo);
      const btnModalStar = document.getElementById("btnModalBookmark");
      btnModalStar.textContent = isBookmarked ? "★ 관심 발주계획 등록됨" : "☆ 관심 발주계획 저장";
      btnModalStar.className = `btn ${isBookmarked ? "btn-active" : ""}`;
    });

    document.getElementById("btnModalCopyInfo").addEventListener("click", () => {
      if (!state.currentDetailRow) return;
      const r = state.currentDetailRow;
      const summary = [
        `[발주계획번호] ${r.planNo}`,
        `[사업명] ${r.projectName}`,
        `[발주기관] ${r.agencyName} (${r.deptName || "-"})`,
        `[소재지] ${r.address}`,
        `[품명/세부품명] ${r.categoryName || "-"} / ${r.subCategoryName || "-"}`,
        `[수량/단위] ${r.qtyStr || "-"} ${r.unit || ""}`,
        `[구매예정금액] ${formatNumber(r.budgetNum)}원 (${formatKoreanCurrency(r.budgetNum)})`,
        `[용도] ${r.purpose || "-"}`,
        `[주요규격] ${r.spec || "-"}`
      ].join("\n");

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(summary).then(() => {
          showToast("📋 발주 상세정보가 클립보드에 복사되었습니다.");
        });
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDetailModal();
    });
  }

  /**
   * Initialize App on Load
   */
  function init() {
    loadSavedState();
    initEventListeners();

    if (typeof window.DEFAULT_CSV_DATA === "string" && window.DEFAULT_CSV_DATA.length > 0) {
      state.allRows = parseCSV(window.DEFAULT_CSV_DATA);
      document.getElementById("sourceBadge").textContent =
        `${state.sourceFileName} (${formatNumber(state.allRows.length)}건 내장됨)`;
    }

    updateBookmarkCounter();
    populateFilterDropdowns();
    applyFiltersAndRender(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

