const APP_CONFIG = {
  TOAST_DURATION: 3000,
  STATUS_APPROVED: ["อนุมติ", "อนุมัติ"],
  STATUS_REJECTED: ["ปฎิเสธ", "ปฏิเสธ"],
};

// ==========================================
// สถานะส่วนกลาง (GLOBAL STATE)
// ==========================================
let currentModalJobNo = null;
let currentModalCustomerName = null;
window.isModalEditMode = false;
window.finalModalItems = [];

// ==========================================
// ฟังก์ชันอรรถประโยชน์ (UTILITY FUNCTIONS)
// ==========================================
function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.innerText = msg;
  t.style.backgroundColor =
    type === "error"
      ? "var(--tmt-red)"
      : type === "warning"
        ? "#ffc107"
        : "var(--tmt-dark)";
  t.style.color = type === "warning" ? "#000" : "#fff";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), APP_CONFIG.TOAST_DURATION);
}

/** ดึงค่าวันที่ช่วง Start - End (ใช้ job_order_date) */
function getSharedDateFilters() {
  return {
    start: document.getElementById("shared_filter_start")?.value || "",
    end: document.getElementById("shared_filter_end")?.value || "",
  };
}

function normalizePromoHeader(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

async function runQuery(sqlQuery) {
  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: sqlQuery }),
  });
  const data = await res.json();
  if (data.status === "success") return data.values;
  console.error("ข้อผิดพลาดของคิวรี (Query Error):", data.message);
  return [];
}

// ==========================================
// การจัดการสถานะ (STATE MANAGEMENT)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("db_status_box").innerHTML =
    `สถานะ: <span style="color:var(--tmt-green);">● ออนไลน์ (บันทึกอัตโนมัติ)</span>`;
  document.getElementById("btn_save_db").style.display = "none";
  [
    "excel_file",
    "btn_import_excel",
    "promo_excel_file",
    "btn_import_promo",
    "btn_clear_promo",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = false;
  });

  refreshSharedYearOptionsFromDB().then(() => {
    updateDashboard();
    populateSADropdown();
    populateAptSADropdown();
  });
});

window.onclick = (event) => {
  const modal = document.getElementById("historyModal");
  if (event.target == modal) closeModal();
};
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    document.getElementById("historyModal").style.display === "flex"
  )
    closeModal();
});

function switchTab(tabId) {
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.remove("active"));
  document
    .querySelectorAll(".nav-tabs button")
    .forEach((el) => el.classList.remove("active"));

  const sharedFilter = document.querySelector(".shared-filter");
  if (sharedFilter) {
    sharedFilter.style.display = (tabId === "upload" || tabId === "appointments" || tabId === "parts-prep") ? "none" : "flex";
  }

  const target = document.getElementById("content-" + tabId);
  target.classList.add("active");

  if (tabId === "workspace") loadWorkspace();
  if (tabId === "dashboard") updateDashboard();
  if (tabId === "promotion") loadPromotionJobs();
  if (tabId === "appointments") loadAppointments();

  // เพิ่มส่วนนี้เพื่อโหลดข้อมูลของแท็บเตรียมสั่งอะไหล่
  if (tabId === "parts-prep") loadPartsPrep();

  document.getElementById("tab-btn-" + tabId).classList.add("active");
}

function handleTabSwitch(tabId) {
  switchTab(tabId);
}

/** หาช่วงเดือนปี น้อยสุด - มากสุด จาก job_order_date เพื่อตั้งค่า Date Range อัตโนมัติ */
async function refreshSharedYearOptionsFromDB() {
  const startEl = document.getElementById("shared_filter_start");
  const endEl = document.getElementById("shared_filter_end");
  const rows = await runQuery(
    "SELECT job_order_date FROM Job_Orders WHERE job_order_date IS NOT NULL AND job_order_date <> ''",
  );

  let min = "9999-99",
    max = "0000-00";
  rows.forEach((r) => {
    const dateStr = r[0] || "";
    if (dateStr) {
      let p = dateStr.split(/[-/]/);
      let ym = "";
      if (p.length === 3) {
        if (p[0].length === 4) ym = `${p[0]}-${p[1].padStart(2, "0")}`;
        else if (p[2].length === 4) ym = `${p[2]}-${p[1].padStart(2, "0")}`;
        if (ym) {
          if (ym < min) min = ym;
          if (ym > max) max = ym;
        }
      }
    }
  });

  if (min !== "9999-99" && startEl && !startEl.value) startEl.value = min;
  if (max !== "0000-00" && endEl && !endEl.value) endEl.value = max;
}

function onSharedDateChange() {
  updateDashboard();
  loadWorkspace();
  loadPromotionJobs();
  loadAppointments();
}

// ==========================================
// ฟังก์ชันหลัก (อ้างอิง Job Order Date แทน Quotation Date)
// ==========================================
async function updateDashboard() {
  const shared = getSharedDateFilters();
  const rows = await runQuery(`
                SELECT e.employee_name, o.job_order_no, o.job_order_date,
                    COUNT(i.job_order_no) as total_item_count,
                    (SELECT COUNT(*) FROM Follow_Ups f WHERE f.job_order_no = o.job_order_no) as has_followup,
                    (SELECT COUNT(*) FROM Follow_Ups f WHERE f.job_order_no = o.job_order_no AND f.call_result IS NOT NULL AND f.call_result <> '') as has_call,
                    SUM(i.invoice_amount) as total_amount,
                    SUM(CASE WHEN (COALESCE(i.item_status, '') LIKE '%อนุมติ%' OR COALESCE(i.item_status, '') LIKE '%อนุมัติ%') THEN i.invoice_amount ELSE 0 END) as ori_amount,
                    COUNT(CASE WHEN (COALESCE(i.item_status, '') LIKE '%อนุมติ%' OR COALESCE(i.item_status, '') LIKE '%อนุมัติ%') THEN 1 END) as ori_count,
                    SUM(CASE WHEN (COALESCE(i.item_status, '') LIKE '%ปฎิเสธ%' OR COALESCE(i.item_status, '') LIKE '%ปฏิเสธ%') AND i.sa_status = 'APPROVED' THEN i.invoice_amount ELSE 0 END) as adj_amount,
                    COUNT(CASE WHEN (COALESCE(i.item_status, '') LIKE '%ปฎิเสธ%' OR COALESCE(i.item_status, '') LIKE '%ปฏิเสธ%') AND i.sa_status = 'APPROVED' THEN 1 END) as adj_count,
                    SUM(CASE WHEN (COALESCE(i.item_status, '') LIKE '%ปฎิเสธ%' OR COALESCE(i.item_status, '') LIKE '%ปฏิเสธ%') AND (i.sa_status IS NULL OR i.sa_status = '' OR i.sa_status = 'PENDING') THEN i.invoice_amount
                            WHEN (COALESCE(i.item_status, '') NOT LIKE '%อนุมติ%' AND COALESCE(i.item_status, '') NOT LIKE '%อนุมัติ%' AND COALESCE(i.item_status, '') NOT LIKE '%ปฎิเสธ%' AND COALESCE(i.item_status, '') NOT LIKE '%ปฏิเสธ%') THEN i.invoice_amount ELSE 0 END) as pending_amount,
                    COUNT(CASE WHEN (COALESCE(i.item_status, '') LIKE '%ปฎิเสธ%' OR COALESCE(i.item_status, '') LIKE '%ปฏิเสธ%') AND (i.sa_status IS NULL OR i.sa_status = '' OR i.sa_status = 'PENDING') THEN 1
                                WHEN (COALESCE(i.item_status, '') NOT LIKE '%อนุมติ%' AND COALESCE(i.item_status, '') NOT LIKE '%อนุมัติ%' AND COALESCE(i.item_status, '') NOT LIKE '%ปฎิเสธ%' AND COALESCE(i.item_status, '') NOT LIKE '%ปฏิเสธ%') THEN 1 END) as pending_count
                FROM Job_Order_Items i LEFT JOIN Job_Orders o ON i.job_order_no = o.job_order_no LEFT JOIN Employees e ON o.employee_id = e.employee_id
                WHERE e.employee_name IS NOT NULL GROUP BY e.employee_name, o.job_order_no, o.job_order_date
            `);

  let tot = 0,
    oriTotal = 0,
    adjTotal = 0,
    pendingTotal = 0;
  let saStats = {};

  rows.forEach((r) => {
    let emp = r[0] || "ไม่ระบุ";
    let dateStr = r[2] || "";
    let ym = "";
    if (dateStr) {
      let p = dateStr.split(/[-/]/);
      if (p.length === 3) {
        if (p[0].length === 4) ym = `${p[0]}-${p[1].padStart(2, "0")}`;
        else if (p[2].length === 4) ym = `${p[2]}-${p[1].padStart(2, "0")}`;
      }
    }

    let inRange = true;
    if (shared.start || shared.end) {
      if (!ym) inRange = false;
      else {
        if (shared.start && ym < shared.start) inRange = false;
        if (shared.end && ym > shared.end) inRange = false;
      }
    }

    if (inRange) {
      tot += parseFloat(r[6]) || 0;
      oriTotal += parseFloat(r[7]) || 0;
      adjTotal += parseFloat(r[9]) || 0;
      pendingTotal += parseFloat(r[11]) || 0;
      if (!saStats[emp]) {
        saStats[emp] = {
          totalAmt: 0,
          approveOriAmt: 0,
          approveOriCount: 0,
          approveAdjAmt: 0,
          approveAdjCount: 0,
          approveSaCount: 0,
          pendingAmt: 0,
          pendingCount: 0,
          jobCount: 0,
          totalItemCount: 0,
          followUpSetCount: 0,
          followUpDoneCount: 0,
        };
      }
      saStats[emp].totalAmt += parseFloat(r[6]) || 0;
      saStats[emp].approveOriAmt += parseFloat(r[7]) || 0;
      saStats[emp].approveOriCount += parseInt(r[8]) || 0;
      saStats[emp].approveAdjAmt += parseFloat(r[9]) || 0;
      saStats[emp].approveAdjCount += parseInt(r[10]) || 0;
      saStats[emp].approveSaCount += parseInt(r[10]) || 0;
      saStats[emp].pendingAmt += parseFloat(r[11]) || 0;
      saStats[emp].pendingCount += parseInt(r[12]) || 0;
      saStats[emp].jobCount += 1;
      saStats[emp].totalItemCount += parseInt(r[3]) || 0;
      saStats[emp].followUpSetCount += parseInt(r[4]) > 0 ? 1 : 0;
      saStats[emp].followUpDoneCount += parseInt(r[5]) > 0 ? 1 : 0;
    }
  });

  document.getElementById("dash_total").innerText =
    tot.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿";
  document.getElementById("dash_approve_ori").innerText =
    oriTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿";
  document.getElementById("dash_approve_adj").innerText =
    adjTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿";
  document.getElementById("dash_pending").innerText =
    pendingTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 }) + " ฿";
  document.getElementById("dash_pct_approve_ori").innerText =
    (tot > 0 ? (oriTotal / tot) * 100 : 0).toFixed(2) + "%";
  document.getElementById("dash_pct_approve_adj").innerText =
    (tot > 0 ? (adjTotal / tot) * 100 : 0).toFixed(2) + "%";
  document.getElementById("dash_pct_pending").innerText =
    (tot > 0 ? (pendingTotal / tot) * 100 : 0).toFixed(2) + "%";

  updateRejectionDashboard(shared.start, shared.end);

  window.leaderboardData = Object.keys(saStats)
    .map((name) => {
      let s = saStats[name];
      return {
        emp: name,
        jobCount: s.jobCount,
        totalItemCount: s.totalItemCount,
        totalAmt: s.totalAmt,
        approveOriCount: s.approveOriCount,
        approveOriAmt: s.approveOriAmt,
        approveAdjCount: s.approveAdjCount,
        approveAdjAmt: s.approveAdjAmt,
        pendingCount: s.pendingCount,
        pendingAmt: s.pendingAmt,
        approveAdjRate:
          s.totalItemCount > 0
            ? (s.approveSaCount / s.totalItemCount) * 100
            : 0,
        followUpSetCount: s.followUpSetCount,
        followUpDoneCount: s.followUpDoneCount,
      };
    })
    .sort((a, b) => b.totalAmt - a.totalAmt);

  refreshLeaderboardDisplay();
}

async function updateRejectionDashboard(start, end) {
  const container = document.getElementById("rejection_summary_body");
  const rows = await runQuery(
    `SELECT notes, call_time FROM Follow_Ups WHERE notes LIKE '%[เหตุผล: %'`,
  );
  const reasonCounts = {};

  rows.forEach((row) => {
    let ct = row[1] || "";
    let inRange = true;
    if (ct) {
      let ym = ct.substring(0, 7);
      if (start && ym < start) inRange = false;
      if (end && ym > end) inRange = false;
    }
    if (inRange) {
      const match = String(row[0]).match(/\[เหตุผล: (.*?)\]/);
      if (match && match[1]) {
        const reason = match[1].trim();
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
      }
    }
  });

  const sortedReasons = Object.entries(reasonCounts).sort(
    (a, b) => b[1] - a[1],
  );
  if (sortedReasons.length === 0) {
    container.innerHTML = `<tr><td colspan="2" style="text-align: center; color: #999; padding: 20px;">ไม่มีข้อมูลการปฏิเสธในช่วงที่เลือก</td></tr>`;
    return;
  }
  container.innerHTML = sortedReasons
    .map(
      ([reason, count]) =>
        `<tr><td style="font-size: 0.95em; font-weight: 600; color: var(--tmt-dark);">${reason}</td><td style="text-align: center;"><span class="badge badge-red" style="min-width: 40px;">${count}</span></td></tr>`,
    )
    .join("");
}

function refreshLeaderboardDisplay() {
  const summaryBody = document.getElementById("leaderboard_summary_body");
  const detailBody = document.getElementById("leaderboard_detail_body");
  if (!window.leaderboardData || window.leaderboardData.length === 0) {
    summaryBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">ไม่มีข้อมูล</td></tr>`;
    detailBody.innerHTML = `<tr><td colspan="7" style="text-align: center;">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  let summaryHTML = "",
    detailHTML = "";
  window.leaderboardData.forEach((sa) => {
    const safeEmp = escapeHtmlAttr(sa.emp || "");
    summaryHTML += `<tr>
                    <td><button class="sa-link" type="button" onclick="openWorkspaceForSA('${safeEmp}')">${safeEmp}</button></td>
                    <td style="text-align: center;">${sa.jobCount}</td><td style="text-align: center;">${sa.followUpSetCount}</td>
                    <td style="text-align: center;">${sa.followUpDoneCount}</td><td style="text-align: center;">${sa.totalItemCount}</td>
                    <td style="text-align: right;">${sa.totalAmt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                    <td style="text-align: right;"><span class="badge ${sa.approveAdjRate >= 50 ? "badge-green" : sa.approveAdjRate >= 30 ? "badge-blue" : "badge-red"}">${sa.approveAdjRate.toFixed(1)}%</span></td>
                </tr>`;
    detailHTML += `<tr>
                    <td><button class="sa-link" type="button" onclick="openWorkspaceForSA('${safeEmp}')">${safeEmp}</button></td>
                    <td style="text-align: center;">${sa.approveOriCount}</td><td style="text-align: right; color: var(--tmt-green); font-weight: 600;">${sa.approveOriAmt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                    <td style="text-align: center;">${sa.approveAdjCount}</td><td style="text-align: right; color: var(--tmt-blue); font-weight: 600;">${sa.approveAdjAmt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                    <td style="text-align: center;">${sa.pendingCount}</td><td style="text-align: right; color: var(--tmt-orange); font-weight: 600;">${sa.pendingAmt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                </tr>`;
  });
  summaryBody.innerHTML = summaryHTML;
  detailBody.innerHTML = detailHTML;
}

function openWorkspaceForSA(saName) {
  document.getElementById("sa_filter").value = saName;
  document.getElementById("status_filter").value = "PENDING";
  document.getElementById("ws_search").value = "";
  switchTab("workspace");
}

async function populateSADropdown() {
  const rows = await runQuery(
    "SELECT employee_name FROM Employees ORDER BY employee_name",
  );
  const sel = document.getElementById("sa_filter");
  const current = sel.value;
  sel.innerHTML = '<option value="ALL">-- ทั้งหมด --</option>';
  rows.forEach(
    (row) => (sel.innerHTML += `<option value="${row[0]}">${row[0]}</option>`),
  );
  sel.value = current;
}

async function populateAptSADropdown() {
  const rows = await runQuery(
    "SELECT employee_name FROM Employees ORDER BY employee_name",
  );
  const sel = document.getElementById("apt_sa_filter");
  const current = sel.value;
  sel.innerHTML = '<option value="ALL">-- ทั้งหมด --</option>';
  rows.forEach(
    (row) => (sel.innerHTML += `<option value="${row[0]}">${row[0]}</option>`),
  );
  sel.value = current;
}

async function updatePromoSheetDropdown(currentSelected) {
  const select = document.getElementById("promo_sheet_filter");
  const rows = await runQuery(
    "SELECT DISTINCT source_sheet FROM Promotion_Parts WHERE source_sheet IS NOT NULL AND source_sheet <> '' ORDER BY source_sheet",
  );
  select.innerHTML = '<option value="ALL">ทุกชีต</option>';
  rows.forEach(
    (r) => (select.innerHTML += `<option value="${r[0]}">${r[0]}</option>`),
  );
  if (currentSelected) select.value = currentSelected;
}

function updatePromoSADropdown(currentSelected, rows) {
  const select = document.getElementById("promo_sa_filter");
  const names = new Set();
  (rows || []).forEach((r) => {
    if (r[4]) names.add(r[4].trim());
  });
  const sorted = Array.from(names).sort((a, b) => a.localeCompare(b));
  let html = '<option value="ALL">พนักงานรับรถทุกคน</option>';
  sorted.forEach(
    (name) =>
      (html += `<option value="${escapeHtmlAttr(name)}">${escapeHtmlAttr(name)}</option>`),
  );
  select.innerHTML = html;
  select.value = names.has(currentSelected) ? currentSelected : "ALL";
}

async function loadWorkspace() {
  const saFilter = document.getElementById("sa_filter").value;
  const statusFilter = document.getElementById("status_filter").value;
  const shared = getSharedDateFilters();
  const searchText = document.getElementById("ws_search").value.toLowerCase();
  const tbody = document.getElementById("sa_table_body");

  const checkAll = document.getElementById("checkAll");
  if (checkAll) checkAll.checked = false;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">กำลังโหลด...</td></tr>`;

  const sql = `
                SELECT
                    jo.job_order_no, jo.job_order_date, c.contact_name, c.tel_no, e.employee_name, f.next_contact_date,
                    COALESCE(f.attempt_number, 0) as current_attempt,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') AND (ji.sa_status IS NULL OR ji.sa_status = 'PENDING') THEN 1 ELSE 0 END) as c_rej_pending,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') AND ji.sa_status = 'APPROVED' THEN 1 ELSE 0 END) as c_rej_approved,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') AND ji.sa_status = 'REJECTED' THEN 1 ELSE 0 END) as c_rej_rejected,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') THEN 1 ELSE 0 END) as c_rej_total,
                    f.call_result, jo.job_order_date,
                    v.vehicle_registration_no
                FROM Job_Orders jo
                LEFT JOIN Customers c ON jo.customer_id = c.customer_id
                LEFT JOIN Employees e ON jo.employee_id = e.employee_id
                LEFT JOIN Job_Order_Items ji ON jo.job_order_no = ji.job_order_no
                LEFT JOIN Vehicles v ON jo.vin_no = v.vin_no
                LEFT JOIN (SELECT job_order_no, MAX(attempt_number) as max_att FROM Follow_Ups GROUP BY job_order_no) fm ON jo.job_order_no = fm.job_order_no
                LEFT JOIN Follow_Ups f ON fm.job_order_no = f.job_order_no AND fm.max_att = f.attempt_number
                GROUP BY jo.job_order_no
            `;

  let rowsData = await runQuery(sql);
  if (rowsData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">ไม่พบรายการ</td></tr>`;
    return;
  }

  let todayStr = new Date().toISOString().split("T")[0];

  if (saFilter !== "ALL") rowsData = rowsData.filter((r) => r[4] === saFilter);

  rowsData = rowsData
    .filter((r) => {
      let jobNo = (r[0] || "").toLowerCase();
      let jDate = r[1] || "";
      let cName = (r[2] || "").toLowerCase();
      let cTel = (r[3] || "").toLowerCase();
      let nextDate = r[5];
      let cRejPending = r[7];
      let licensePlate = (r[13] || "").toLowerCase();

      let rowYm = "";
      if (jDate) {
        let parts = jDate.split(/[-/]/);
        if (parts.length === 3) {
          if (parts[0].length === 4) rowYm = `${parts[0]}-${parts[1].padStart(2, "0")}`;
          else if (parts[2].length === 4) rowYm = `${parts[2]}-${parts[1].padStart(2, "0")}`;
        }
      }

      let matchDate = true;
      if (shared.start || shared.end) {
        if (!rowYm) matchDate = false;
        else {
          if (shared.start && rowYm < shared.start) matchDate = false;
          if (shared.end && rowYm > shared.end) matchDate = false;
        }
      }

      // เพิ่มการเช็คผลการโทรของความพยายามรอบล่าสุด
      let callResult = r[11] || "";
      let isCalled = callResult.trim() !== "";

      // หมวดหมู่และเงื่อนไขการกรองแบบใหม่
      let matchStatus = true;
      if (statusFilter === "PENDING") {
        // รอดำเนินการ = ไม่มีวันโทร หรือ มีวันโทรแต่โทรไปแล้ว (ยังไม่ได้ตั้งวันใหม่)
        matchStatus = cRejPending > 0 && (!nextDate || nextDate === "" || isCalled);
      } else if (statusFilter === "TO_CALL") {
        // ต้องโทรติดตาม = มีวันโทร และ ต้องยังไม่ได้ทำการโทรเท่านั้น
        matchStatus = cRejPending > 0 && (nextDate && nextDate !== "" && !isCalled);
      } else if (statusFilter === "COMPLETED") {
        matchStatus = cRejPending === 0;
      }

      let matchSearch =
        !searchText ||
        jobNo.includes(searchText) ||
        cName.includes(searchText) ||
        cTel.includes(searchText) ||
        licensePlate.includes(searchText);

      return matchDate && matchStatus && matchSearch;
    })
    .sort((a, b) => {
      const hasDateA = a[5] && a[5] !== "" && a[5] !== "9999-12-31";
      const hasDateB = b[5] && b[5] !== "" && b[5] !== "9999-12-31";

      // ดันงานที่มีวันโทรติดตามขึ้นบนสุด เรียงจากอดีต -> อนาคต
      if (hasDateA && hasDateB) return (a[5] || "").localeCompare(b[5] || "");
      if (hasDateA && !hasDateB) return -1;
      if (!hasDateA && hasDateB) return 1;

      // งานที่ไม่มีวันโทร ให้เรียงตามวันที่ใบสั่งซ่อมจากใหม่ -> เก่า
      const toISO = (d) => {
        if (!d) return "";
        const p = d.split(/[-/]/);
        return p[2].length === 4 ? `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}` : d;
      };
      return toISO(b[1]).localeCompare(toISO(a[1]));
    });

  const toISODate = (d) => {
    if (!d) return "-";
    const p = d.split(/[-/]/);
    return p[2].length === 4 ? `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}` : d;
  };

  if (rowsData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">ไม่มีรายการที่ตรงกับตัวกรอง</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  const renderWSRows = (dataChunk) => {
    dataChunk.forEach((r) => {
      let jobNo = r[0],
        jDate = toISODate(r[1]),
        cName = r[2] || "-",
        cTel = r[3] || "-",
        sa = r[4] || "-";
      let nDate = r[5],
        attempt = r[6],
        cRejPending = r[7],
        cRejApproved = r[8],
        cRejRejected = r[9],
        cRejTotal = r[10],
        callResult = r[11] || "";
      const isPending = cRejPending > 0;
      let isOverdue = isPending && nDate && nDate < todayStr;
      let isToday = isPending && nDate === todayStr;
      let isCalled = isPending && callResult && callResult.trim() !== "";

      let dateBadge = "";
      if (cRejPending === 0) {
        dateBadge = `<span class="badge badge-blue" style="font-size:1em; background:var(--tmt-green);">เสร็จสิ้น</span>`;
      } else {
        dateBadge = nDate
          ? `<span class="badge badge-blue" style="font-size:1em;">${nDate}</span>`
          : `<span class="badge badge-gray">ยังไม่กำหนด</span>`;
        if (isCalled && isToday)
          dateBadge = `<span class="badge badge-green" style="font-size:1em;">โทรวันนี้แล้ว</span>`;
        else if (isCalled)
          dateBadge = `<span class="badge badge-green" style="font-size:1em;">โทรแล้ว</span>`;
        else if (isOverdue)
          dateBadge = `<span class="badge badge-red" style="font-size:1em;">เกินกำหนด (${nDate})</span>`;
        else if (isToday)
          dateBadge = `<span class="badge badge-orange" style="font-size:1em; background:var(--tmt-orange);">ต้องโทรวันนี้</span>`;
      }

      let tr = document.createElement("tr");
      // ถ้าสถานะเป็น TO_CALL แล้วยังเกินกำหนด ให้ไฮไลท์แดง
      if (isOverdue && statusFilter === "TO_CALL") tr.className = "overdue";
      tr.setAttribute("onclick", "handleRowClick(event, 'row-checkbox')");
      tr.style.cursor = "pointer";

      let statusBadge = `<div style="display:flex; flex-direction:column; gap:4px;">`;
      if (cRejTotal === 0)
        statusBadge += `<span class="badge badge-green">อนุมัติ (ไม่ต้องติดตาม)</span>`;
      else {
        if (cRejPending > 0)
          statusBadge += `<span class="badge badge-red">${cRejPending} รอดำเนินการ</span>`;
        if (cRejApproved > 0)
          statusBadge += `<span class="badge badge-green">${cRejApproved} พนักงานรับรถอนุมัติ</span>`;
        if (cRejRejected > 0)
          statusBadge += `<span class="badge badge-dark">${cRejRejected} ยกเลิก</span>`;
        if (cRejPending === 0 && cRejTotal > 0)
          statusBadge += `<span class="badge badge-blue">เสร็จสิ้นทั้งหมด</span>`;
      }
      statusBadge += `</div>`;

      const isApprovedAll = cRejPending === 0;
      const checkboxHtml = isApprovedAll
        ? `<label class="custom-checkbox"><input type="checkbox" class="row-checkbox" value="${jobNo}" data-attempt="${attempt}" disabled><span class="checkmark"></span></label>`
        : `<label class="custom-checkbox"><input type="checkbox" class="row-checkbox" value="${jobNo}" data-attempt="${attempt}"><span class="checkmark"></span></label>`;
      tr.innerHTML = `
                        <td style="text-align:center;">${checkboxHtml}</td>
                        <td>${dateBadge} ${attempt > 0 ? `<br><small style="color:#666;">โทรแล้ว: ${attempt} ครั้ง</small>` : ""}</td>
                        <td><strong>${jobNo}</strong><br><small>${jDate}</small></td>
                        <td>${cName}<br><small>โทร: ${cTel}</small></td>
                        <td>${sa}</td>
                        <td>${statusBadge}</td>
                        <td style="text-align:center;"><button class="action-btn btn-dark btn-sm" onclick="event.stopPropagation(); showJobDetails('${jobNo}', '${escapeHtmlAttr(cName)}')">ดูรายละเอียด</button></td>
                    `;
      tbody.appendChild(tr);
    });
  };
  renderWSRows(rowsData.slice(0, 50));
  if (rowsData.length > 50) setTimeout(() => renderWSRows(rowsData.slice(50)), 10);
}

async function loadPromotionJobs() {
  const shared = getSharedDateFilters();
  const searchText = (document.getElementById("promo_search")?.value || "").toLowerCase();
  const sheetFilter = document.getElementById("promo_sheet_filter")?.value || "ALL";
  const statusFilter = document.getElementById("promo_status_filter")?.value || "ALL";
  const saFilter = document.getElementById("promo_sa_filter")?.value || "ALL";

  const promoCheckAll = document.getElementById("promo_check_all");
  if (promoCheckAll) promoCheckAll.checked = false;

  updatePromoSheetDropdown(sheetFilter);
  let sheetClause =
    sheetFilter !== "ALL" ? ` AND pp.source_sheet = '${sheetFilter.replace(/'/g, "''")}'` : "";

  const sql = `
                SELECT
                    jo.job_order_no, jo.job_order_date, c.contact_name, c.tel_no, e.employee_name, f.next_contact_date,
                    COALESCE(f.attempt_number, 0) as current_attempt,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') AND (ji.sa_status IS NULL OR ji.sa_status = 'PENDING') THEN 1 ELSE 0 END) as c_rej_pending,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') AND ji.sa_status = 'APPROVED' THEN 1 ELSE 0 END) as c_rej_approved,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') AND ji.sa_status = 'REJECTED' THEN 1 ELSE 0 END) as c_rej_rejected,
                    SUM(CASE WHEN (ji.item_status LIKE '%ปฎิเสธ%' OR ji.item_status LIKE '%ปฏิเสธ%') THEN 1 ELSE 0 END) as c_rej_total,
                    f.call_result, jo.job_order_date,
                    v.vehicle_registration_no
                FROM Job_Orders jo
                LEFT JOIN Customers c ON jo.customer_id = c.customer_id
                LEFT JOIN Employees e ON jo.employee_id = e.employee_id
                JOIN Job_Order_Items ji ON jo.job_order_no = ji.job_order_no
                JOIN Promotion_Parts pp ON ji.operation_part_no = pp.part_no
                LEFT JOIN Vehicles v ON jo.vin_no = v.vin_no
                LEFT JOIN (SELECT job_order_no, MAX(attempt_number) as max_att FROM Follow_Ups GROUP BY job_order_no) fm ON jo.job_order_no = fm.job_order_no
                LEFT JOIN Follow_Ups f ON fm.job_order_no = f.job_order_no AND fm.max_att = f.attempt_number
                WHERE 1=1 ${sheetClause}
                GROUP BY jo.job_order_no
            `;

  const tbody = document.getElementById("promo_job_body");
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">กำลังโหลด...</td></tr>`;

  let rows = await runQuery(sql);
  if (!rows.length) {
    updatePromoSADropdown(saFilter, []);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">ยังไม่มีข้อมูลงานโปรโมชัน</td></tr>`;
    return;
  }

  updatePromoSADropdown(saFilter, rows);
  const effectiveSaFilter = document.getElementById("promo_sa_filter")?.value || "ALL";
  const effectiveSaFilterNorm = effectiveSaFilter.toLowerCase();
  const todayStr = new Date().toISOString().split("T")[0];

  rows = rows.filter((r) => {
    const jobNo = (r[0] || "").toLowerCase();
    const jDate = r[1] || "";
    const cName = (r[2] || "").toLowerCase();
    const cTel = (r[3] || "").toLowerCase();
    const saName = (r[4] || "").toLowerCase();
    const nextDate = r[5] || "";
    const cRejPending = r[7] || 0;
    const licensePlate = (r[13] || "").toLowerCase();

    let rowYm = "";
    if (jDate) {
      let parts = jDate.split(/[-/]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) rowYm = `${parts[0]}-${parts[1].padStart(2, "0")}`;
        else if (parts[2].length === 4) rowYm = `${parts[2]}-${parts[1].padStart(2, "0")}`;
      }
    }

    let matchDate = true;
    if (shared.start || shared.end) {
      if (!rowYm) matchDate = false;
      else {
        if (shared.start && rowYm < shared.start) matchDate = false;
        if (shared.end && rowYm > shared.end) matchDate = false;
      }
    }

    let matchSearch =
      !searchText ||
      jobNo.includes(searchText) ||
      cName.includes(searchText) ||
      cTel.includes(searchText) ||
      saName.includes(searchText) ||
      licensePlate.includes(searchText);

    // เพิ่มการเช็คผลการโทรของความพยายามรอบล่าสุด
    let callResult = r[11] || "";
    let isCalled = callResult.trim() !== "";

    // หมวดหมู่และเงื่อนไขการกรองแบบใหม่ (Promotion)
    let matchStatus = true;
    if (statusFilter === "PENDING") {
      // รอดำเนินการ = ไม่มีวันโทร หรือ มีวันโทรแต่โทรไปแล้ว (ยังไม่ได้ตั้งวันใหม่)
      matchStatus = cRejPending > 0 && (!nextDate || nextDate === "" || isCalled);
    } else if (statusFilter === "TO_CALL") {
      // ต้องโทรติดตาม = มีวันโทร และ ต้องยังไม่ได้ทำการโทรเท่านั้น
      matchStatus = cRejPending > 0 && (nextDate && nextDate !== "" && !isCalled);
    } else if (statusFilter === "COMPLETED") {
      matchStatus = cRejPending === 0;
    }

    let matchSa = effectiveSaFilter === "ALL" || saName === effectiveSaFilterNorm;

    return matchDate && matchSearch && matchStatus && matchSa;
  });

  // จัดเรียงลำดับใหม่ให้งานโปรโมชั่น
  rows.sort((a, b) => {
    const hasDateA = a[5] && a[5] !== "" && a[5] !== "9999-12-31";
    const hasDateB = b[5] && b[5] !== "" && b[5] !== "9999-12-31";

    if (hasDateA && hasDateB) return (a[5] || "").localeCompare(b[5] || "");
    if (hasDateA && !hasDateB) return -1;
    if (!hasDateA && hasDateB) return 1;

    const toISO = (d) => {
      if (!d) return "";
      const p = d.split(/[-/]/);
      return p[2].length === 4 ? `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}` : d;
    };
    return toISO(b[1]).localeCompare(toISO(a[1]));
  });

  const toISODate = (d) => {
    if (!d) return "-";
    const p = d.split(/[-/]/);
    return p[2].length === 4 ? `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}` : d;
  };

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">ไม่มีงานที่ตรงกับตัวกรอง</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  const renderRows = (dataChunk) => {
    dataChunk.forEach((r) => {
      const jobNo = r[0] || "-",
        jDate = toISODate(r[1]),
        cName = r[2] || "-",
        cTel = r[3] || "-",
        saName = r[4] || "-",
        nextDate = r[5] || "",
        attempt = r[6] || 0,
        cRejPending = r[7] || 0,
        cRejApproved = r[8] || 0,
        cRejRejected = r[9] || 0,
        cRejTotal = r[10] || 0,
        callResult = r[11] || "";
      const isPending = cRejPending > 0;
      const isOverdue = isPending && nextDate && nextDate < todayStr;
      const isToday = isPending && nextDate === todayStr;
      const isCalled = isPending && callResult && callResult.trim() !== "";

      let dateBadge = "";
      if (cRejPending === 0) {
        dateBadge = `<span class="badge badge-blue" style="font-size:1em; background:var(--tmt-green);">เสร็จสิ้น</span>`;
      } else {
        dateBadge = nextDate
          ? `<span class="badge badge-blue" style="font-size:1em;">${nextDate}</span>`
          : `<span class="badge badge-gray">ยังไม่กำหนด</span>`;
        if (isCalled && isToday)
          dateBadge = `<span class="badge badge-green" style="font-size:1em;">โทรวันนี้แล้ว</span>`;
        else if (isCalled)
          dateBadge = `<span class="badge badge-green" style="font-size:1em;">โทรแล้ว</span>`;
        else if (isOverdue)
          dateBadge = `<span class="badge badge-red" style="font-size:1em;">เกินกำหนด (${nextDate})</span>`;
        else if (isToday)
          dateBadge = `<span class="badge badge-orange" style="font-size:1em; background:var(--tmt-orange);">ต้องโทรวันนี้</span>`;
      }

      let statusBadge = `<div style="display:flex; flex-direction:column; gap:4px;">`;
      if (cRejTotal === 0)
        statusBadge += `<span class="badge badge-green">อนุมัติ (ไม่ต้องติดตาม)</span>`;
      else {
        if (cRejPending > 0)
          statusBadge += `<span class="badge badge-red">${cRejPending} รอดำเนินการ</span>`;
        if (cRejApproved > 0)
          statusBadge += `<span class="badge badge-green">${cRejApproved} พนักงานรับรถอนุมัติ</span>`;
        if (cRejRejected > 0)
          statusBadge += `<span class="badge badge-dark">${cRejRejected} ยกเลิก</span>`;
        if (cRejPending === 0 && cRejTotal > 0)
          statusBadge += `<span class="badge badge-blue">เสร็จสิ้นทั้งหมด</span>`;
      }
      statusBadge += `</div>`;

      const isApprovedAll = cRejPending === 0;
      const checkboxHtml = isApprovedAll
        ? `<label class="custom-checkbox"><input type="checkbox" class="promo-row-checkbox" value="${jobNo}" data-attempt="${attempt}" data-cname="${cName}" disabled><span class="checkmark"></span></label>`
        : `<label class="custom-checkbox"><input type="checkbox" class="promo-row-checkbox" value="${jobNo}" data-attempt="${attempt}" data-cname="${cName}"><span class="checkmark"></span></label>`;

      const tr = document.createElement("tr");
      if (isOverdue && statusFilter === "TO_CALL") tr.className = "overdue";
      tr.setAttribute("onclick", "handleRowClick(event, 'promo-row-checkbox')");
      tr.style.cursor = "pointer";
      tr.innerHTML = `
                        <td style="text-align:center;">${checkboxHtml}</td>
                        <td>${dateBadge} ${attempt > 0 ? `<br><small style="color:#666;">โทรแล้ว: ${attempt} ครั้ง</small>` : ""}</td>
                        <td><strong>${jobNo}</strong><br><small>${jDate}</small></td>
                        <td>${cName}<br><small>โทร: ${cTel}</small></td>
                        <td>${saName}</td>
                        <td>${statusBadge}</td>
                        <td style="text-align:center;"><button class="action-btn btn-dark btn-sm" onclick="event.stopPropagation(); showJobDetails('${jobNo}', '${escapeHtmlAttr(cName)}')">ดูรายละเอียด</button></td>
                    `;
      tbody.appendChild(tr);
    });
  };
  renderRows(rows.slice(0, 50));
  if (rows.length > 50) setTimeout(() => renderRows(rows.slice(50)), 10);
}

async function loadAppointments() {
  const aptStart = document.getElementById("apt_filter_start").value;
  const aptEnd = document.getElementById("apt_filter_end").value;
  const saFilter = document.getElementById("apt_sa_filter").value;
  const searchText = document.getElementById("apt_search").value.toLowerCase();
  const tbody = document.getElementById("apt_table_body");

  // เพิ่ม v.vehicle_registration_no ใน SELECT และ LEFT JOIN Vehicles v 
  const sql = `
                SELECT f.appointment_date, f.job_order_no, c.contact_name, c.tel_no, e.employee_name, f.notes, f.call_time, jo.job_order_date,
                       v.vehicle_registration_no
                FROM Follow_Ups f
                JOIN Job_Orders jo ON f.job_order_no = jo.job_order_no
                LEFT JOIN Customers c ON jo.customer_id = c.customer_id
                LEFT JOIN Employees e ON jo.employee_id = e.employee_id
                LEFT JOIN Vehicles v ON jo.vin_no = v.vin_no
                WHERE f.appointment_date IS NOT NULL AND f.appointment_date <> ''
                ORDER BY f.appointment_date ASC
            `;

  let rows = await runQuery(sql);
  tbody.innerHTML = "";
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">ไม่พบรายการนัดหมาย</td></tr>`;
    return;
  }

  rows = rows.filter((r) => {
    const aptDateTime = r[0] || "";
    const aptDate = aptDateTime.split(" ")[0];
    const jobNo = (r[1] || "").toLowerCase();
    const cName = (r[2] || "").toLowerCase();
    const cTel = (r[3] || "").toLowerCase(); // ดึงเบอร์โทรศัพท์ Index ที่ 3
    const saName = r[4] || "";
    const licensePlate = (r[8] || "").toLowerCase(); // ดึงเลขทะเบียนรถ Index ที่ 8

    let matchDate = true;
    if (aptStart || aptEnd) {
      if (!aptDate) matchDate = false;
      else {
        if (aptStart && aptDate < aptStart) matchDate = false;
        if (aptEnd && aptDate > aptEnd) matchDate = false;
      }
    }

    const matchSA = saFilter === "ALL" || saName === saFilter;

    // ปรับเงื่อนไขการค้นหาให้ครอบคลุม หมายเลขงาน, ชื่อลูกค้า, เบอร์โทร และเลขทะเบียนรถ
    const matchSearch =
      !searchText ||
      jobNo.includes(searchText) ||
      cName.includes(searchText) ||
      cTel.includes(searchText) ||
      licensePlate.includes(searchText);

    return matchDate && matchSA && matchSearch;
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">ไม่พบรายการนัดหมายที่ตรงเงื่อนไข</td></tr>`;
    return;
  }

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
                    <td style="font-weight:700; color:var(--tmt-blue);">${r[0]}</td>
                    <td><strong>${r[1]}</strong></td>
                    <td>${r[2]}</td><td>${r[3]}</td><td>${r[4] || "-"}</td>
                    <td style="font-size:0.85em; color:#666;">${r[5] || "-"}</td>
                    <td style="text-align:center;"><button class="action-btn btn-dark btn-sm" onclick="showAppointmentDetails('${r[1]}', '${escapeHtmlAttr(r[2])}')">ดูรายละเอียด</button></td>
                `;
    tbody.appendChild(tr);
  });
}

// ==========================================
// Checkboxes & Group Saves
// ==========================================
function toggleAllCheckboxes() {
  const isChecked = document.getElementById("checkAll").checked;
  document.querySelectorAll(".row-checkbox:not(:disabled)").forEach((cb) => {
    cb.checked = isChecked;
    cb.closest("tr").classList.toggle("row-selected", isChecked);
  });
}

function toggleAllPromotionCheckboxes() {
  const isChecked = document.getElementById("promo_check_all").checked;
  document
    .querySelectorAll(".promo-row-checkbox:not(:disabled)")
    .forEach((cb) => {
      cb.checked = isChecked;
      cb.closest("tr").classList.toggle("row-selected", isChecked);
    });
}

// ใช้ได้ทั้งในตารางหลัก และใน Modal
function handleRowClick(event, checkboxClass) {
  if (
    event.target.tagName === "BUTTON" ||
    event.target.tagName === "SELECT" ||
    (event.target.tagName === "INPUT" && event.target.type !== "checkbox")
  )
    return;
  const row = event.currentTarget;
  const cb = row.querySelector("." + checkboxClass);
  if (cb && !cb.disabled) {
    cb.checked = !cb.checked;
    row.classList.toggle("row-selected", cb.checked);
  }
}

async function applyBulkSave(dateInput, noteInput, checkboxes, reloadFunc) {
  if (checkboxes.length === 0)
    return showToast("กรุณาเลือกรายการอย่างน้อย 1 งาน", "warning");
  if (!dateInput) return showToast("กรุณาระบุวันที่ติดต่อ/ทบทวน", "warning");

  let jobs = [];
  checkboxes.forEach((cb) => {
    jobs.push({
      jobNo: cb.value,
      attemptNo: parseInt(cb.dataset.attempt || "0"),
    });
  });

  try {
    const res = await fetch("/api/bulk-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs, nextDate: dateInput, notes: noteInput }),
    });
    const data = await res.json();
    if (data.status === "success") {
      showToast(`บันทึก ${checkboxes.length} รายการแล้ว`, "success");
      reloadFunc();
    } else showToast("ข้อผิดพลาด: " + data.message, "error");
  } catch (e) {
    showToast("ข้อผิดพลาดของเซิร์ฟเวอร์", "error");
  }
}

function applyBulkFollowUp() {
  applyBulkSave(
    document.getElementById("bulk_date").value,
    document.getElementById("bulk_note").value.trim(),
    document.querySelectorAll(".row-checkbox:checked"),
    () => {
      document.getElementById("bulk_date").value = "";
      document.getElementById("bulk_note").value = "";
      loadWorkspace();
    },
  );
}

function applyPromotionReview() {
  applyBulkSave(
    document.getElementById("promo_review_date").value,
    document.getElementById("promo_note").value.trim(),
    document.querySelectorAll(".promo-row-checkbox:checked"),
    () => {
      document.getElementById("promo_review_date").value = "";
      document.getElementById("promo_note").value = "";
      loadPromotionJobs();
    },
  );
}

async function exportAppointmentsToExcel() {
  const aptStart = document.getElementById("apt_filter_start").value;
  const aptEnd = document.getElementById("apt_filter_end").value;

  let dateFilterName = "ทั้งหมด";
  if (aptStart && aptEnd) dateFilterName = `${aptStart}_ถึง_${aptEnd}`;
  else if (aptStart) dateFilterName = `ตั้งแต่_${aptStart}`;
  else if (aptEnd) dateFilterName = `ถึง_${aptEnd}`;

  // สร้างเงื่อนไข Query ช่วงวันที่
  const sql = `
                SELECT
                    f.appointment_date, f.job_order_no, c.contact_name, c.tel_no, e.employee_name, f.notes, f.call_time, jo.job_order_date,
                       v.vehicle_registration_no
                FROM Follow_Ups f
                JOIN Job_Orders jo ON f.job_order_no = jo.job_order_no
                LEFT JOIN Customers c ON jo.customer_id = c.customer_id
                LEFT JOIN Employees e ON jo.employee_id = e.employee_id
                LEFT JOIN Vehicles v ON jo.vin_no = v.vin_no
                WHERE f.appointment_date IS NOT NULL AND f.appointment_date <> ''
                ORDER BY f.appointment_date ASC
            `;
  const rows = await runQuery(sql);
  if (rows.length === 0)
    return showToast("ไม่มีข้อมูลนัดหมายให้ส่งออก", "warning");

  const headers = [
    "วันเวลาที่นัดหมาย",
    "เลขที่ใบสั่งซ่อม",
    "ชื่อลูกค้า",
    "โทรศัพท์",
    "ทะเบียนรถ",
    "ชื่อพนักงานรับรถ",
    "หมายเหตุ",
  ];

  const processedRows = rows.map(r => {
    return [
      r[0], // วันที่นัดหมาย
      r[1], // เลขที่ใบสั่งซ่อม
      r[2], // ชื่อลูกค้า
      r[3], // โทรศัพท์
      r[8], // ทะเบียนรถ
      r[4] || "-", // ชื่อพนักงานรับรถ
      r[5] || "-", // หมายเหตุพนักงานรับรถ
    ];
  });

  const data = [headers, ...processedRows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "นัดหมาย");
  XLSX.writeFile(wb, `นัดหมายโตโยต้า_${dateFilterName}.xlsx`);
  showToast("ส่งออกเป็น Excel สำเร็จ", "success");
}

function exportWorkspaceToExcel() {
  const table = document.getElementById("sa_table");
  const cloneTable = table.cloneNode(true);
  for (let i = 0; i < cloneTable.rows.length; i++) {
    cloneTable.rows[i].deleteCell(6);
    cloneTable.rows[i].deleteCell(0);
  }
  const wb = XLSX.utils.table_to_book(cloneTable, { sheet: "รายการติดตาม" });
  XLSX.writeFile(wb, "รายการติดตามพนักงานรับรถ.xlsx");
  showToast("ส่งออกเป็น Excel สำเร็จ", "success");
}

function exportPromotionToExcel() {
  const table = document.getElementById("promo_job_table");
  const cloneTable = table.cloneNode(true);
  for (let i = 0; i < cloneTable.rows.length; i++) {
    cloneTable.rows[i].deleteCell(6);
    cloneTable.rows[i].deleteCell(0);
  }
  const wb = XLSX.utils.table_to_book(cloneTable, { sheet: "รายการติดตาม" });
  XLSX.writeFile(wb, "รายการติดตามพนักงานรับรถ อะไหล่โปรโมชัน.xlsx");
  showToast("ส่งออกเป็น Excel สำเร็จ", "success");
}

// ==========================================
// หน้าต่างป๊อปอัป Modal
// ==========================================
async function showAppointmentDetails(jobNo, cName) {
  document.getElementById("modal_title").innerText = `สรุปนัดหมาย: ${jobNo}`;
  const modalBody = document.getElementById("modal_body");
  modalBody.innerHTML = "<div style='padding:20px;'>กำลังโหลด...</div>";
  document.getElementById("modal_close_btn").style.display = "block";
  document.getElementById("historyModal").style.display = "flex";

  const safeJobNo = String(jobNo || "").replace(/'/g, "''");
  const vRes = await runQuery(`
                SELECT jo.job_order_date, v.vehicle_registration_no, v.model, c.tel_no, e.employee_name, f.appointment_date, f.notes
                FROM Job_Orders jo LEFT JOIN Vehicles v ON jo.vin_no = v.vin_no LEFT JOIN Customers c ON jo.customer_id = c.customer_id
                LEFT JOIN Employees e ON jo.employee_id = e.employee_id LEFT JOIN Follow_Ups f ON jo.job_order_no = f.job_order_no
                WHERE jo.job_order_no = '${safeJobNo}' AND f.appointment_date IS NOT NULL ORDER BY f.attempt_number DESC LIMIT 1
            `);

  // ปรับปรุง: ดึงฟิลด์ ji.flat_rate_qty เพิ่มมาด้วย
  const itemsRes = await runQuery(`
                SELECT
                    ji.operation_part_no,
                    op.operation_description,
                    ji.sa_status,
                    ji.item_type,
                    CASE WHEN pp.part_no IS NOT NULL THEN 1 ELSE 0 END AS is_promo,
                    ji.flat_rate_qty,
                    ji.operation_part_no_raw
                FROM Job_Order_Items ji
                LEFT JOIN Operations_Parts op ON ji.operation_part_no = op.operation_part_no
                LEFT JOIN Promotion_Parts pp ON ji.operation_part_no = pp.part_no
                WHERE ji.job_order_no = '${safeJobNo}' AND ji.sa_status = 'APPROVED'
                ORDER BY is_promo DESC, CASE WHEN ji.item_type = 'P' THEN 1 WHEN ji.item_type = 'O' THEN 2 ELSE 3 END ASC, ji.operation_part_no ASC
            `);

  if (vRes.length > 0) {
    const r = vRes[0];
    let html = `
                    <div style="padding:25px;">
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:25px; background:#f8f9fa; padding:20px; border-radius:12px;">
                            <div><strong>ลูกค้า:</strong> ${cName}</div><div><strong>โทรศัพท์:</strong> ${r[3]}</div>
                            <div><strong>รถ:</strong> ${r[1]} (${r[2]})</div><div><strong>พนักงานรับรถ:</strong> ${r[4]}</div>
                            <div style="grid-column: span 2; border-top:1px solid #ddd; pt:10px; margin-top:10px;">
                                <strong style="color:var(--tmt-red);">วันเวลาในการนัดหมาย:</strong> ${r[5]}
                            </div>
                            <div style="grid-column: span 2;"><strong>หมายเหตุพนักงานรับรถ:</strong> ${r[6] || '-'}</div>
                        </div>
                        <h4 style="margin-bottom:10px; color:var(--tmt-dark);">รายการที่อนุมัติสำหรับนัดหมายนี้:</h4>`;
    if (itemsRes.length > 0) {
      html += `<table class="data-table"><thead><tr><th style="width:80px; text-align:center;">ประเภท</th><th>เลขอะไหล่ / รายละเอียด</th></tr></thead><tbody>`;
      itemsRes.forEach((item) => {
        const partNoNormal = item[0] || "-";
        const description = item[1] || "-";
        const itemType = item[3] || "";
        const isPromo = item[4] === 1;
        const flatQty = parseFloat(item[5]) || 0;
        const partNoRaw = item[6] || "";

        const partNo = partNoRaw || partNoNormal;

        // ปรับปรุง: ตรวจสอบและแสดงจำนวนชิ้นกรณีที่เป็นประเภทอะไหล่ (P) เท่านั้น
        let qtyText = (itemType === "P" && flatQty > 0) ? ` (${flatQty} ชิ้น)` : "";

        let typeBadge = "";
        if (itemType === "P")
          typeBadge = '<span class="badge" style="background:#e0f7fa; color:#006064; border:1px solid #b2ebf2; font-size:0.8em;">อะไหล่</span>';
        else if (itemType === "O")
          typeBadge = '<span class="badge" style="background:#f3e5f5; color:#4a148c; border:1px solid #e1bee7; font-size:0.8em;">บริการ</span>';
        if (isPromo)
          typeBadge += (typeBadge ? "<br>" : "") + '<span class="promo-badge" style="margin-top:4px; display:inline-block; font-size:0.8em;">โปรโมชัน</span>';

        html += `<tr>
                    <td style="text-align:center; vertical-align:middle;">${typeBadge}</td>
                    <td><strong>${partNo}</strong>${qtyText}<br><small>${description}</small></td>
                 </tr>`;
      });
    } else {
      html += `<tr><td colspan="2" style="text-align:center;">ไม่มีรายการที่ระบุสำหรับนัดหมายนี้</td></tr>`;
    }
    modalBody.innerHTML = html + "</tbody></table></div>";
  }
}

async function showJobDetails(jobNo, cName) {
  currentModalJobNo = jobNo;
  currentModalCustomerName = cName;
  window.isModalEditMode = false;

  const modalBody = document.getElementById("modal_body");
  modalBody.innerHTML = "<div style='padding:20px;'>กำลังโหลด...</div>";
  document.getElementById("modal_close_btn").style.display = "block";
  document.getElementById("historyModal").style.display = "flex";

  const safeJobNo = String(jobNo || "").replace(/'/g, "''");
  const promoRes = await runQuery(
    `SELECT DISTINCT ji.operation_part_no FROM Job_Order_Items ji JOIN Promotion_Parts pp ON ji.operation_part_no = pp.part_no WHERE ji.job_order_no = '${safeJobNo}'`,
  );
  const vRes = await runQuery(
    `SELECT jo.job_order_date, jo.mileage_in, v.vin_no, v.vehicle_registration_no, v.model, v.series, c.tel_no FROM Job_Orders jo LEFT JOIN Vehicles v ON jo.vin_no = v.vin_no LEFT JOIN Customers c ON jo.customer_id = c.customer_id WHERE jo.job_order_no = '${safeJobNo}' LIMIT 1`,
  );

  // ปรับปรุง: ดึงฟิลด์ ji.flat_rate_qty เป็นลำดับสุดท้าย (r[10]) เพื่อนำไปคำนวณจำนวนชิ้นอะไหล่
  const res = await runQuery(`
      SELECT ji.item_id, ji.operation_part_no, ji.operation_part_no_raw, op.operation_description, ji.item_status, ji.technician_message, ji.reject_reason, ji.sa_status, ji.sa_approved_date, ji.item_type, ji.flat_rate_qty
      FROM Job_Order_Items ji LEFT JOIN Operations_Parts op ON ji.operation_part_no = op.operation_part_no
      WHERE ji.job_order_no = '${safeJobNo}'
      ORDER BY
          (SELECT COUNT(*) FROM Promotion_Parts pp WHERE pp.part_no = ji.operation_part_no) DESC,
          CASE WHEN ji.item_type = 'P' THEN 1 WHEN ji.item_type = 'O' THEN 2 ELSE 3 END ASC,
          ji.item_status DESC
  `);
  const fRes = await runQuery(
    `SELECT attempt_number, next_contact_date, notes, call_result, contact_person, contact_relation, call_time, call_attempts, appointment_date FROM Follow_Ups WHERE job_order_no = '${safeJobNo}' ORDER BY attempt_number DESC`,
  );

  const todayStr = new Date().toISOString().split("T")[0];
  let maxAttempt = 0;

  fRes.forEach((f) => {
    if (f[0] > maxAttempt) maxAttempt = f[0];
  });

  let modalPendingCount = 0;
  res.forEach((r) => {
    let stat = r[4] || "",
      saStat = r[7] || "PENDING";
    let isRejectedItem = stat.includes("ปฎิเสธ") || stat.includes("ปฏิเสธ");
    if (isRejectedItem && saStat === "PENDING") modalPendingCount++;
  });
  let isCompletedJob = modalPendingCount === 0;

  document.getElementById("modal_title").innerHTML =
    `ใบสั่งซ่อม: ${jobNo} | ${cName} ` +
    (isCompletedJob
      ? `<span class="badge badge-blue" style="margin-left:10px; vertical-align:middle; background:var(--tmt-green);">เสร็จสิ้น</span> <button id="btn_edit_completed_job" class="action-btn btn-dark btn-sm" style="margin-left:10px; margin-top:0; margin-bottom:0; padding:2px 10px;" onclick="enableModalEditMode()">แก้ไขสถานะรายการ</button>`
      : "");

  let infoHtml = "";
  if (vRes.length > 0) {
    const row = vRes[0];
    infoHtml = `
                <div style="padding: 20px 25px; border-bottom: 1px solid var(--tmt-border); background:#fff;">
                    <div style="font-weight:700; color:var(--tmt-dark); margin-bottom:10px;">รายละเอียดรถ</div>
                    <table class="data-table" style="margin:0; border:none;">
                        <tbody>
                            <tr><td style="width: 180px; background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">เลขตัวถัง</td><td style="font-weight:700;">${row[2] || "-"}</td>
                                <td style="width: 180px; background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">ทะเบียน</td><td style="font-weight:700; color:var(--tmt-red);">${row[3] || "-"}</td></tr>
                            <tr><td style="background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">รุ่น</td><td>${row[4] || "-"}</td>
                                <td style="background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">ซีรีส์</td><td>${row[5] || "-"}</td></tr>
                            <tr><td style="background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">วันที่ใบงาน</td><td>${row[0] || "-"}</td>
                                <td style="background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">เลขไมล์เข้า</td><td style="font-weight:700;">${Number(row[1] || 0).toLocaleString()} กม.</td></tr>
                            <tr><td style="background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">ชื่อลูกค้า</td><td>${cName}</td>
                                <td style="background:#f8f9fa; font-weight:600; color:#666; font-size:0.9em;">โทรศัพท์</td><td style="font-weight:700; color:var(--tmt-blue);">${row[6] || "-"}</td></tr>
                        </tbody>
                    </table>
                </div>`;
  }

  const techNotesSet = new Set(),
    techNotesList = [];
  const promoSet = new Set();
  promoRes.forEach((r) => promoSet.add(r[0] || ""));
  res.forEach((r) => {
    let tMsg = r[5] || "",
      rRea = r[6] || "";
    if (tMsg && !techNotesSet.has(tMsg)) {
      techNotesSet.add(tMsg);
      techNotesList.push(tMsg);
    }
    if (rRea && !techNotesSet.has(rRea)) {
      techNotesSet.add(rRea);
      techNotesList.push(rRea);
    }
  });

  let techNotesHtml =
    techNotesList.length > 0
      ? `<div style="padding: 20px 25px; border-bottom: 1px solid var(--tmt-border); background:#f8f9fa;"><div style="font-weight:700; color:var(--tmt-dark); margin-bottom:10px;">หมายเหตุช่างและเหตุผล</div><div style="color:var(--tmt-text); line-height:1.6;">${techNotesList.map((note) => `<div style="margin-bottom:8px;"><strong>•</strong> ${note}</div>`).join("")}</div></div>`
      : "";

  let html = `${infoHtml}${techNotesHtml}
        <div id="modal_action_buttons" style="display: ${isCompletedJob ? "none" : "flex"}; padding: 12px 20px; background: #eef2f5; align-items: center; gap: 10px; border-bottom: 1px solid var(--tmt-border);">
            <strong style="color: var(--tmt-dark); font-size: 0.95em; margin-right: 10px;">ตั้งสถานะรายการที่เลือก:</strong>
            <button class="action-btn btn-success btn-sm" style="margin:0;" onclick="setModalItemsStatus('APPROVED')">อนุมัติ</button>
            <button class="action-btn btn-dark btn-sm" style="margin:0;" onclick="setModalItemsStatus('REJECTED')">ยกเลิก</button>
            <button class="action-btn btn-sm" style="background:#ff9800; margin:0;" onclick="setModalItemsStatus('PENDING')">รอดำเนินการ</button>
        </div>
        <table class="data-table" style="margin:0; border:none; border-bottom: 1px solid var(--tmt-border);">
            <thead><tr>
                <th style="width:40px; text-align:center;">
                    <label class="custom-checkbox" style="margin:0;">
                        <input type="checkbox" id="modal_check_all" onchange="toggleAllModalCheckboxes()">
                        <span class="checkmark"></span>
                    </label>
                </th>
                <th style="width:80px; text-align:center;">ประเภท</th>
                <th>เลขอะไหล่ / รายละเอียด</th>
                <th style="width: 150px;">สถานะปัจจุบัน</th>
            </tr></thead>
            <tbody>`;

  if (res.length > 0) {
    res.forEach((r) => {
      let itemId = r[0],
        codeNorm = r[1] || "-",
        codeRaw = r[2] || "",
        desc = r[3] || "-",
        stat = r[4] || "",
        saStat = r[7] || "PENDING",
        appDate = r[8] || "",
        itemType = r[9] || "",
        flatQty = parseFloat(r[10]) || 0;
      let code = codeRaw || codeNorm;
      let isRejectedItem = stat.includes("ปฎิเสธ") || stat.includes("ปฏิเสธ");
      let isPromo = promoSet.has(codeNorm);

      // ปรับปรุง: เติมการคำนวณจำนวนชิ้นเฉพาะประเภทอะไหล่ (P) เท่านั้น
      let qtyText = (itemType === "P" && flatQty > 0) ? ` (${flatQty} ชิ้น)` : "";

      let typeBadge = "";
      if (itemType === "P")
        typeBadge =
          '<span class="badge" style="background:#e0f7fa; color:#006064; border:1px solid #b2ebf2; font-size:0.8em;">อะไหล่</span>';
      else if (itemType === "O")
        typeBadge =
          '<span class="badge" style="background:#f3e5f5; color:#4a148c; border:1px solid #e1bee7; font-size:0.8em;">บริการ</span>';
      if (isPromo)
        typeBadge +=
          (typeBadge ? "<br>" : "") +
          '<span class="promo-badge" style="margin-top:4px; display:inline-block; font-size:0.8em;">โปรโมชัน</span>';

      let statusCol = "",
        checkboxCol = "";
      let trClass = isPromo ? "promo-item" : "";

      if (isRejectedItem) {
        let dateText =
          saStat === "APPROVED" && appDate
            ? `<div style="font-size:0.75em; color:var(--tmt-green); margin-top:4px; font-weight:600;">${appDate}</div>`
            : "";
        let statusText =
          saStat === "APPROVED"
            ? '<span class="badge badge-green">อนุมัติ</span>'
            : saStat === "REJECTED"
              ? '<span class="badge badge-dark">ยกเลิก</span>'
              : '<span class="badge badge-orange">รอดำเนินการ</span>';

        statusCol = `${statusText}${dateText}`;
        checkboxCol = `<label class="custom-checkbox"><input type="checkbox" class="modal-item-cb custom-control-input" value="${itemId}"><span class="checkmark"></span></label>`;

        html += `<tr class="${trClass}" style="cursor:pointer;" onclick="handleRowClick(event, 'modal-item-cb')" data-itemid="${itemId}" data-oldstatus="${saStat}" data-newstatus="${saStat}">
                    <td style="text-align:center;">${checkboxCol}</td><td style="text-align:center; vertical-align:middle;">${typeBadge}</td>
                    <td><strong>${code}</strong>${qtyText}<br><small>${desc}</small></td><td class="status-col">${statusCol}</td>
                 </tr>`;
      } else {
        statusCol = `<span class="badge badge-green">อนุมัติเดิม</span>`;
        checkboxCol = `<label class="custom-checkbox"><input type="checkbox" class="modal-item-cb" value="${itemId}" disabled><span class="checkmark"></span></label>`;

        html += `<tr class="${trClass}" data-itemid="${itemId}" data-oldstatus="ORIGINAL_APPROVED" data-newstatus="ORIGINAL_APPROVED">
                    <td style="text-align:center;">${checkboxCol}</td><td style="text-align:center; vertical-align:middle;">${typeBadge}</td>
                    <td><strong>${code}</strong>${qtyText}<br><small>${desc}</small></td><td class="status-col">${statusCol}</td>
                 </tr>`;
      }
    });
  } else {
    html += `<tr><td colspan="4">ไม่พบรายการ</td></tr>`;
  }
  html += `</tbody></table>`;

  const pendingFollowUps = [];
  fRes.forEach((f) => {
    if (!f[3] || f[3].trim() === "")
      pendingFollowUps.push({ attemptNo: f[0], nextDate: f[1] });
  });

  let currentAttempt =
    pendingFollowUps.length > 0
      ? pendingFollowUps[0].attemptNo
      : maxAttempt + 1;
  let attemptIsToday =
    pendingFollowUps.length > 0 && pendingFollowUps[0].nextDate <= todayStr;
  let dateStatusText = attemptIsToday
    ? "วันนี้หรือเลยกำหนด"
    : pendingFollowUps.length > 0 && pendingFollowUps[0].nextDate
      ? `กำหนด: ${pendingFollowUps[0].nextDate}`
      : "การแก้ไขเพิ่มเติม";

  const showCompletedMsg = isCompletedJob && !window.isModalEditMode;
  const showFollowupForm = attemptIsToday || window.isModalEditMode;

  html += `
      <div id="completed_msg_container" style="display: ${showCompletedMsg ? "block" : "none"}; padding: 16px 20px; border-bottom: 1px solid var(--tmt-border); background:#e8f5e9;">
          <div style="font-weight:700; color:var(--tmt-green); margin-bottom:10px;">บันทึกการติดตามครบแล้ว</div><p style="margin:0; color:var(--tmt-text); font-size:0.9em;">ไม่มีรายการติดตามค้างอยู่</p>
      </div>
      <div id="followup_form_container" style="display: ${showFollowupForm ? "block" : "none"}; padding: 16px 20px; border-bottom: 1px solid var(--tmt-border); background:${attemptIsToday && !isCompletedJob ? "#fff" : "#f0f8ff"};">
          <div style="font-weight:700; color:var(--tmt-dark); margin-bottom:15px;">รายละเอียดการโทร/บันทึกผล (${dateStatusText})</div>
          ${attemptIsToday && !isCompletedJob ? '<div style="background:#ffcccc; padding:10px; border-radius:4px; margin-bottom:15px; color:#d32f2f; font-weight:600;">โปรดบันทึกรายละเอียดการโทรก่อนจึงจะอัปเดตสถานะได้</div>' : ""}
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:15px;">
              <div>
                  <label style="display:block; font-weight:600; margin-bottom:5px; font-size:0.9em;">ผลการโทร <span style="color:red;">*</span></label>
                  <select id="followup_call_result" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;">
                      <option value="">-- เลือกผลการโทร --</option><option value="Connected">ติดต่อได้</option><option value="No Answer">ไม่มีคนรับ</option><option value="Busy">สายไม่ว่าง</option>
                      <option value="Wrong Number">เบอร์ผิด</option><option value="Declined">ปฏิเสธ</option><option value="Line/Social">ไลน์/โซเชียล</option><option value="Walk-in">เข้ามาที่ศูนย์</option>
                      <option value="Customer Called">ลูกค้าโทรกลับ</option><option value="Service Reminder">แจ้งเตือนเช็กระยะ</option><option value="Promotion Inquiry">สอบถามโปรโมชัน</option><option value="Other">อื่นๆ</option>
                  </select>
              </div>
              <div><label style="display:block; font-weight:600; margin-bottom:5px; font-size:0.9em;">ผู้ติดต่อ</label><input type="text" id="followup_contact_person" placeholder="ชื่อ" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;"></div>
              <div><label style="display:block; font-weight:600; margin-bottom:5px; font-size:0.9em;">ความสัมพันธ์</label>
                  <select id="followup_contact_relation" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px;">
                      <option value="">-- เลือก --</option><option value="Owner">เจ้าของรถ</option><option value="Family">ครอบครัว</option><option value="Assistant">ผู้ช่วย</option><option value="Staff">พนักงาน</option><option value="Other">อื่นๆ</option>
                  </select></div>
              <div id="reject_reason_container" style="grid-column:1/-1; display:none;">
                  <label style="display:block; font-weight:600; margin-bottom:5px; font-size:0.9em;">เหตุผลที่ปฏิเสธ (หากยกเลิก)</label>
                  <select id="followup_reject_reason_select" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; margin-bottom:8px;" onchange="handleRejectReasonChange(this)">
                      <option value="">-- เลือกเหตุผล --</option><option value="ราคาแพงเกินไป">ราคาแพงเกินไป</option><option value="ไปทำอู่นอกแล้ว">ไปทำอู่นอกแล้ว</option>
                      <option value="ยังไม่สะดวก/ไม่มีเวลา">ยังไม่สะดวก/ไม่มีเวลา</option><option value="ขายรถไปแล้ว">ขายรถไปแล้ว</option><option value="รอเช็คระยะรอบหน้า">รอเช็คระยะรอบหน้า</option>
                      <option value="ไม่พบอาการผิดปกติ">ไม่พบอาการผิดปกติ</option><option value="ใช้รถน้อย/กิโลเมตรยังไม่ถึง">ใช้รถน้อย/กิโลเมตรยังไม่ถึง</option><option value="ไม่พอใจการบริการครั้งก่อน">ไม่พอใจการบริการครั้งก่อน</option>
                      <option value="มีอะไหล่เอง">มีอะไหล่เอง</option><option value="อื่นๆ">อื่นๆ</option>
                  </select>
                  <input type="text" id="followup_reject_reason_custom" placeholder="ระบุเหตุผล..." style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; display:none;">
              </div>
              <div style="grid-column:1/-1;"><label style="display:block; font-weight:600; margin-bottom:5px; font-size:0.9em;">บันทึก</label>
                  <textarea id="followup_notes" placeholder="รายละเอียดการโทร, การตอบกลับลูกค้า, ขั้นตอนถัดไป..." style="width:100%; padding:8px; border:1px solid #ddd; border-radius:4px; min-height:70px; font-family:monospace; font-size:0.9em;"></textarea>
              </div>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;"><button class="action-btn btn-success" onclick="reviewCallAndStatus('${safeJobNo}', ${currentAttempt})">ตรวจทานและบันทึก</button></div>
      </div>
  `;

  if (fRes.length > 0) {
    html += `<div style="padding: 20px; background: #fff; border-top: 1px solid var(--tmt-border);"><h4 style="margin-top:0; color: var(--tmt-dark); border-left: 4px solid var(--tmt-red); padding-left: 10px;">ประวัติการติดต่อ</h4><div style="display: flex; flex-direction: column; gap: 12px; margin-top: 15px;">`;
    fRes.forEach((f) => {
      const isCompleted = f[3] && f[3].trim() !== "";
      if (!isCompleted) return;
      html += `
                    <div style="border: 1px solid #eee; border-radius: 6px; padding: 12px; background: ${isCompleted ? "#fcfcfc" : "#fff9f0"};">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span class="badge ${isCompleted ? "badge-dark" : "badge-blue"}" style="font-size: 0.75em;">ครั้งที่ ${f[0]}</span><span style="font-size: 0.85em; color: #666;">${f[6] !== "-" ? f[6] : "กำหนด: " + f[1]}</span>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.9em;">
                            <div><strong>ผล:</strong> <span class="color-blue">${f[3]}</span></div><div><strong>ผู้ติดต่อ:</strong> ${f[4] || "-"} (${f[5] || "-"})</div>
                            ${f[8] && f[8] !== "-" ? `<div style="grid-column: span 2; background: #e7f3ff; padding: 4px 8px; border-radius: 4px;"><strong>นัดหมาย:</strong> <span class="color-blue">${f[8]}</span></div>` : ""}
                            <div style="grid-column: span 2; color: #555; font-style: italic; border-top: 1px dashed #eee; padding-top: 5px;"><strong>บันทึก:</strong> ${f[2]}</div>
                        </div>
                    </div>`;
    });
    html += `</div></div>`;
  }

  html += `<div id="modal_overlay_screen" style="display:none; position:fixed; top:50%; left:50%; transform: translate(-50%, -50%); width:550px; max-width:90%; background:white; z-index:1100; padding:30px; border-radius:8px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); border-top: 5px solid var(--tmt-red);"></div>`;
  modalBody.innerHTML = html;

  window.checkIfReasonNeeded();
}

window.toggleAllModalCheckboxes = function () {
  const isChecked = document.getElementById("modal_check_all").checked;
  document.querySelectorAll(".modal-item-cb:not(:disabled)").forEach((cb) => {
    cb.checked = isChecked;
    cb.closest("tr").classList.toggle("row-selected", isChecked);
  });
};

window.setModalItemsStatus = function (newStatus) {
  let checkedBoxes = document.querySelectorAll(
    ".modal-item-cb:checked:not(:disabled)",
  );
  if (checkedBoxes.length === 0)
    return showToast("กรุณาเลือกรายการที่ต้องการเปลี่ยนสถานะ", "warning");

  checkedBoxes.forEach((cb) => {
    let tr = cb.closest("tr");
    tr.dataset.newstatus = newStatus;
    let statusCol = tr.querySelector(".status-col");

    if (newStatus === "APPROVED") {
      statusCol.innerHTML =
        '<span class="badge badge-green">อนุมัติ (รอตรวจทาน)</span>';
    } else if (newStatus === "REJECTED") {
      statusCol.innerHTML =
        '<span class="badge badge-dark">ยกเลิก (รอตรวจทาน)</span>';
    } else {
      statusCol.innerHTML =
        '<span class="badge badge-orange" style="background:#ff9800;">รอดำเนินการ (รอตรวจทาน)</span>';
    }

    cb.checked = false;
    tr.classList.remove("row-selected");
  });

  document.getElementById("modal_check_all").checked = false;
  window.checkIfReasonNeeded();
  showToast(
    "เปลี่ยนสถานะในหน้าจอแล้ว (กรุณากดตรวจทานและบันทึกด้านล่าง)",
    "success",
  );
};

window.checkIfReasonNeeded = function () {
  let hasRejected = false;
  document.querySelectorAll("#modal_body tr[data-newstatus]").forEach((tr) => {
    if (tr.dataset.newstatus === "REJECTED") hasRejected = true;
  });
  const reasonContainer = document.getElementById("reject_reason_container");
  if (reasonContainer)
    reasonContainer.style.display = hasRejected ? "block" : "none";
};

window.enableModalEditMode = function () {
  window.isModalEditMode = true;
  document.querySelectorAll(".modal-item-cb").forEach((cb) => {
    if (cb.closest("tr").dataset.oldstatus !== "ORIGINAL_APPROVED")
      cb.disabled = false;
  });
  document.getElementById("modal_action_buttons").style.display = "flex";
  document.getElementById("followup_form_container").style.display = "block";
  document.getElementById("completed_msg_container").style.display = "none";
  const btnEdit = document.getElementById("btn_edit_completed_job");
  if (btnEdit) btnEdit.style.display = "none";
  showToast("เปิดโหมดแก้ไขแล้ว กรุณาเลือกรายการและกำหนดสถานะใหม่", "info");
};

function handleRejectReasonChange(select) {
  const customInput = document.getElementById("followup_reject_reason_custom");
  if (select.value === "อื่นๆ") {
    customInput.style.display = "block";
    customInput.value = "";
    customInput.focus();
  } else {
    customInput.style.display = "none";
    customInput.value = select.value;
  }
}

function reviewCallAndStatus(jobNo, attemptNo) {
  const callResult =
    document.getElementById("followup_call_result")?.value || "";
  if (!callResult.trim()) return showToast("กรุณาเลือกผลการโทร", "warning");

  window.finalModalItems = [];
  let anyChanges = false;
  let displayApp = 0,
    displayPen = 0,
    displayRej = 0;

  document.querySelectorAll("#modal_body tr[data-newstatus]").forEach((tr) => {
    let itemId = tr.dataset.itemid;
    let oldVal = tr.dataset.oldstatus;
    let newVal = tr.dataset.newstatus;

    if (oldVal === "ORIGINAL_APPROVED") return;
    if (newVal !== oldVal) anyChanges = true;

    if (newVal === "APPROVED") displayApp++;
    if (newVal === "PENDING") displayPen++;
    if (newVal === "REJECTED") displayRej++;

    window.finalModalItems.push({
      itemId: itemId,
      oldStatus: oldVal,
      newStatus: newVal,
    });
  });

  if (window.isModalEditMode && !anyChanges)
    return showToast(
      "โหมดแก้ไข: กรุณาเปลี่ยนสถานะอย่างน้อย 1 รายการ หรือกดยกเลิกการแก้ไข",
      "warning",
    );

  if (displayRej > 0) {
    const reasonSelect = document.getElementById(
      "followup_reject_reason_select",
    );
    if (!reasonSelect || !reasonSelect.value)
      return showToast("กรุณาเลือกเหตุผลสำหรับรายการที่ยกเลิก", "warning");
  }

  const overlay = document.getElementById("modal_overlay_screen");
  let html = `<div style="max-width:500px; margin:20px auto;"><h3 style="color:var(--tmt-dark); margin-bottom:20px; text-align:center;">ตรวจทานและยืนยัน</h3>
      <div style="display:flex; justify-content:space-around; margin-bottom:20px; padding:15px; background:#f8f9fa; border-radius:8px; border:1px solid #ddd;">
          <div><div style="font-size:1.8em; font-weight:bold; color:var(--tmt-green);">${displayApp}</div><small>อนุมัติรวม</small></div>
          <div><div style="font-size:1.8em; font-weight:bold; color:var(--tmt-orange);">${displayPen}</div><small>รอฯ รวม</small></div>
          <div><div style="font-size:1.8em; font-weight:bold; color:var(--tmt-red);">${displayRej}</div><small>ยกเลิกรวม</small></div>
      </div>`;

  let newlyApproved = window.finalModalItems.filter(
    (i) => i.newStatus === "APPROVED" && i.oldStatus !== "APPROVED",
  ).length;
  let newlyPending = window.finalModalItems.filter(
    (i) => i.newStatus === "PENDING",
  ).length;

  html += `<div style="padding:20px; background:#fff; border-radius:8px; border:1px solid #eee; display:flex; flex-direction:column; gap:15px;">`;

  if (newlyApproved > 0) {
    html += `<div><label style="font-weight:bold; display:block; margin-bottom:5px; color:var(--tmt-green);">วันที่นัดหมาย (สำหรับรายการที่อนุมัติใหม่) <span style="color:red;">*</span></label><input type="date" id="req_appt_date" style="width:100%; box-sizing:border-box;"></div>
      <div><label style="font-weight:bold; display:block; margin-bottom:5px; color:var(--tmt-green);">เวลานัดหมาย <span style="color:red;">*</span></label><input type="time" id="req_appt_time" style="width:100%; box-sizing:border-box; padding:10px; font-size:1rem;"></div>`;
  }
  if (newlyPending > 0) {
    html += `<div><label style="font-weight:bold; display:block; margin-bottom:5px; color:var(--tmt-orange);">วันที่ติดตามครั้งถัดไป (สำหรับรายการที่รอดำเนินการ)</label><input type="date" id="req_next_date" style="width:100%; box-sizing:border-box;"></div>`;
  }
  if (newlyApproved === 0 && newlyPending === 0) {
    html += `<div style="color:#666; text-align:center;">ระบบจะบันทึกสถานะตามที่คุณระบุ</div>`;
  }

  html += `</div><div style="display:flex; gap:15px; justify-content:center; margin-top:20px;">
          <button class="action-btn btn-dark" onclick="cancelOverlay()">กลับไปแก้ไข</button>
          <button class="action-btn btn-success" style="width:100%;" onclick="validateAndSaveDates('${escapeHtmlAttr(jobNo)}', ${attemptNo}, ${newlyApproved}, ${newlyPending})">บันทึกข้อมูลการติดต่อ</button>
      </div></div>`;

  overlay.innerHTML = html;
  overlay.style.display = "block";
  document.getElementById("modal_close_btn").style.display = "none";
}

function cancelOverlay() {
  document.getElementById("modal_overlay_screen").style.display = "none";
  document.getElementById("modal_close_btn").style.display = "block";
}

function validateAndSaveDates(jobNo, attemptNo, newlyApproved, newlyPending) {
  let apptDate = null,
    nextDate = null;
  if (newlyApproved > 0) {
    const apptDateInput = document.getElementById("req_appt_date").value;
    const apptTimeInput = document.getElementById("req_appt_time").value;
    if (!apptDateInput) return showToast("กรุณาระบุวันที่นัดหมาย", "warning");
    if (!apptTimeInput) return showToast("กรุณาระบุเวลานัดหมาย", "warning");
    apptDate = apptTimeInput
      ? `${apptDateInput} ${apptTimeInput}`
      : apptDateInput;
  }
  if (newlyPending > 0)
    nextDate = document.getElementById("req_next_date")?.value;
  executeFinalSave(jobNo, attemptNo, apptDate, nextDate);
}

async function executeFinalSave(jobNo, attemptNo, apptDate, nextDate) {
  const callResult =
    document.getElementById("followup_call_result")?.value || "";
  const contactPerson =
    document.getElementById("followup_contact_person")?.value || "";
  const contactRelation =
    document.getElementById("followup_contact_relation")?.value || "";
  const rejectReason =
    document.getElementById("followup_reject_reason_custom")?.value || "";
  let notes = document.getElementById("followup_notes")?.value || "";

  if (rejectReason) notes = `[เหตุผล: ${rejectReason}] ` + notes;
  if (window.isModalEditMode) notes = `[แก้ไขสถานะรายการ] ` + notes;

  const payload = {
    jobNo,
    attemptNo,
    apptDate,
    nextDate,
    callResult,
    contactPerson,
    contactRelation,
    notes,
    items: window.finalModalItems,
  };

  try {
    const res = await fetch("/api/save-followup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.status === "success") {
      showToast("บันทึกข้อมูลสำเร็จ", "success");
      document.getElementById("modal_close_btn").style.display = "block";
      closeModal();
      loadWorkspace();
      updateDashboard();
    } else showToast("ข้อผิดพลาด: " + data.message, "error");
  } catch (e) {
    showToast("ข้อผิดพลาดของเซิร์ฟเวอร์", "error");
  }
}

function closeModal() {
  document.getElementById("historyModal").style.display = "none";
  currentModalJobNo = null;
}

// ==========================================
// นำเข้า EXCEL
// ==========================================
document
  .getElementById("excel_file")
  .addEventListener(
    "change",
    (e) =>
    (document.getElementById("btn_import_excel").disabled =
      e.target.files.length === 0),
  );
document
  .getElementById("promo_excel_file")
  .addEventListener(
    "change",
    (e) =>
    (document.getElementById("btn_import_promo").disabled =
      e.target.files.length === 0),
  );

document.getElementById("btn_import_excel").onclick = function () {
  const file = document.getElementById("excel_file").files[0];
  if (!file) return;
  const btn = this;
  btn.innerHTML = "กำลังประมวลผล...";
  btn.disabled = true;

  const reader = new FileReader();
  reader.onload = function (e) {
    setTimeout(async () => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const rows = XLSX.utils.sheet_to_json(
          workbook.Sheets[workbook.SheetNames[0]],
          { header: 1, raw: false, defval: "" },
        );

        const dataRows = rows.length > 1 ? rows.slice(1) : [];
        const res = await fetch("/api/import-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: dataRows }),
        });
        const resData = await res.json();

        if (resData.status === "success") {
          showToast("นำเข้าสำเร็จ", "success");
          populateSADropdown();
          updateDashboard();
          switchTab("dashboard");
        } else throw new Error(resData.message);
      } catch (err) {
        showToast("นำเข้าไม่สำเร็จ: " + err.message, "error");
        console.error(err);
      } finally {
        btn.innerHTML = "เริ่มนำเข้า";
        btn.disabled = false;
      }
    }, 50);
  };
  reader.readAsArrayBuffer(file);
};

async function clearPromotionData() {
  if (!confirm("ยืนยันการล้างข้อมูลชิ้นส่วนโปรโมชันทั้งหมดหรือไม่?")) return;
  try {
    const res = await fetch("/api/clear-promos", { method: "POST" });
    if ((await res.json()).status === "success") {
      showToast("ล้างข้อมูลชิ้นส่วนโปรโมชันแล้ว", "success");
      loadPromotionJobs();
    } else throw new Error("ล้มเหลว");
  } catch (e) {
    showToast("เกิดข้อผิดพลาดในการล้างข้อมูล", "error");
  }
}

document.getElementById("btn_import_promo").onclick = function () {
  const file = document.getElementById("promo_excel_file").files[0];
  if (!file) return;
  const btn = this;
  btn.innerHTML = "กำลังประมวลผล...";
  btn.disabled = true;

  const reader = new FileReader();
  reader.onload = function (e) {
    setTimeout(async () => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        let parts = [];

        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) return;
          const rows = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: "",
          });
          if (!rows || rows.length < 5) return;

          const headerRow = rows[4] || [];
          let colMap = { part: -1, sub: -1, name: -1 };
          headerRow.forEach((h, idx) => {
            const key = normalizePromoHeader(h);
            if (key === "PART_NO" || key === "PART NO" || key === "PARTNO")
              colMap.part = idx;
            if (
              key === "NEW SUBSTITUTION PNO" ||
              key === "SUBSTITUTION PNO" ||
              key === "SUBSTITUTION PART NO"
            )
              colMap.sub = idx;
            if (key === "PART_NAME" || key === "PART NAME") colMap.name = idx;
          });

          if (colMap.part === -1) return;

          for (let i = 5; i < rows.length; i++) {
            const row = rows[i] || [];
            const partNo = String(row[colMap.part] || "").trim();
            const subNo =
              colMap.sub !== -1 ? String(row[colMap.sub] || "").trim() : "";
            const partName =
              colMap.name !== -1 ? String(row[colMap.name] || "").trim() : "";
            if (partNo)
              parts.push({
                part_no: partNo,
                part_name: partName,
                sheet: sheetName,
                is_sub: 0,
              });
            if (subNo)
              parts.push({
                part_no: subNo,
                part_name: partName,
                sheet: sheetName,
                is_sub: 1,
              });
          }
        });

        const res = await fetch("/api/import-promos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parts }),
        });
        const resData = await res.json();
        if (resData.status === "success") {
          showToast(
            `นำเข้าโปรโมชันสำเร็จ (${resData.count} รายการ)`,
            "success",
          );
          updatePromoSheetDropdown();
          loadPromotionJobs();
        } else throw new Error(resData.message);
      } catch (err) {
        showToast("นำเข้าโปรโมชันไม่สำเร็จ", "error");
        console.error(err);
      } finally {
        btn.innerHTML = "เริ่มนำเข้าโปรโมชัน";
        btn.disabled = false;
      }
    }, 50);
  };
  reader.readAsArrayBuffer(file);
};

// ==========================================================================
// ฟีเจอร์: ระบบตรวจเช็คและเตรียมสั่งอะไหล่ล่วงหน้า (แสดงผลแบบรายใบสั่งซ่อม)
// ==========================================================================

function addDaysToDateStr(dateStr, days) {
  if (!dateStr) return "";
  let date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  let y = date.getFullYear();
  let m = String(date.getMonth() + 1).padStart(2, '0');
  let d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function loadPartsPrep() {
  const filterStart = document.getElementById("parts_filter_start")?.value || "";
  const filterEnd = document.getElementById("parts_filter_end")?.value || "";
  // ดึงค่าจากช่องค้นหา (ถ้ามี) และแปลงเป็นพิมพ์เล็กทั้งหมดเพื่อเทียบข้อมูล
  const searchText = (document.getElementById("parts_search")?.value || "").toLowerCase();
  
  const tbody = document.getElementById("parts_prep_body");

  if (!tbody) return;

  if (!filterStart) {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById("parts_filter_start").value = today;
    document.getElementById("parts_filter_end").value = today;
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>`;
    setTimeout(loadPartsPrep, 10);
    return;
  }

  const queryStart = addDaysToDateStr(filterStart, 3);
  const queryEnd = addDaysToDateStr(filterEnd, 3);

  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">กำลังโหลดข้อมูลนัดหมายวันที่ ${queryStart} ถึง ${queryEnd}...</td></tr>`;

  let sql = `
    SELECT 
        jo.job_order_no,
        f.appointment_date,
        c.contact_name,
        c.tel_no,
        v.vehicle_registration_no,
        ji.operation_part_no,
        op.operation_description,
        ji.flat_rate_qty,
        ji.operation_part_no_raw
    FROM Job_Order_Items ji
    JOIN Job_Orders jo ON ji.job_order_no = jo.job_order_no
    LEFT JOIN Operations_Parts op ON ji.operation_part_no = op.operation_part_no
    LEFT JOIN Customers c ON jo.customer_id = c.customer_id
    LEFT JOIN Vehicles v ON jo.vin_no = v.vin_no
    JOIN Follow_Ups f ON jo.job_order_no = f.job_order_no
    WHERE ji.item_type = 'P' 
      AND ji.sa_status = 'APPROVED'
      AND f.appointment_date IS NOT NULL 
      AND f.appointment_date <> ''
  `;

  if (queryStart) sql += ` AND substr(f.appointment_date, 1, 10) >= '${queryStart}'`;
  if (queryEnd) sql += ` AND substr(f.appointment_date, 1, 10) <= '${queryEnd}'`;
  sql += ` ORDER BY f.appointment_date ASC, jo.job_order_no ASC`;

  const rows = await runQuery(sql);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">ไม่พบรายการใบสั่งซ่อมที่มีการใช้ชิ้นส่วนอะไหล่ในช่วงวันนัดหมายดังกล่าว</td></tr>`;
    return;
  }

  const jobsMap = {};
  rows.forEach((row) => {
    const jobNo = row[0];
    const apptDateFull = row[1] || "-";
    const customerName = row[2] || "-";
    const telNo = row[3] || "-";
    const regNo = row[4] || "-";
    const partNoNormal = row[5];
    const partDesc = row[6] || "ไม่มีข้อมูลชื่ออะไหล่";
    const qty = parseFloat(row[7]) || 0;
    const partNoRaw = row[8] || "";

    const partNo = partNoRaw || partNoNormal;

    if (!jobsMap[jobNo]) {
      jobsMap[jobNo] = {
        jobNo: jobNo,
        apptDate: apptDateFull,
        customerName: customerName,
        telNo: telNo,
        regNo: regNo,
        parts: []
      };
    }
    
    jobsMap[jobNo].parts.push({
      partNo: partNo,
      partDesc: partDesc,
      qty: qty
    });
  });

  window.partsPrepCache = jobsMap;
  tbody.innerHTML = "";
  let matchCount = 0;

  Object.keys(jobsMap).forEach((jobNo) => {
    const item = jobsMap[jobNo];
    
    // --- ลอจิกการค้นหา (เช็คเงื่อนไขตรงนี้) ---
    let matchSearch = true;
    if (searchText) {
      matchSearch = 
        item.jobNo.toLowerCase().includes(searchText) ||
        item.customerName.toLowerCase().includes(searchText) ||
        item.telNo.toLowerCase().includes(searchText) ||
        item.regNo.toLowerCase().includes(searchText) ||
        // ค้นหาลึกเข้าไปถึงเลขอะไหล่และชื่ออะไหล่ในงานซ่อมนั้นๆ ด้วย
        item.parts.some(p => p.partNo.toLowerCase().includes(searchText) || p.partDesc.toLowerCase().includes(searchText));
    }

    if (!matchSearch) return; // ถ้ารายการนี้ไม่ตรงกับคำค้นหา ให้ข้ามไปไม่ต้องวาดแถว
    // ------------------------------------

    matchCount++;
    const tr = document.createElement("tr");
    const displayDate = item.apptDate.split(" ")[0];

    tr.innerHTML = `
        <td style="font-weight:700; color:var(--tmt-blue);">${displayDate}</td>
        <td><strong>${item.jobNo}</strong></td>
        <td>${item.customerName}</td>
        <td>${item.telNo}</td>
        <td style="font-weight:700; color:var(--tmt-red);">${item.regNo}</td>
        <td style="text-align:center;">
            <button class="action-btn btn-dark btn-sm" onclick="showPartsDetailModal('${escapeHtmlAttr(item.jobNo)}')">
                ดูรายละเอียด
            </button>
        </td>
    `;
    tbody.appendChild(tr);
  });

  // ถ้าค้นหาแล้วไม่เจอรายการใดเลย ให้แสดงข้อความแจ้งเตือน
  if (matchCount === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">ไม่พบรายการที่ตรงกับคำค้นหา "${searchText}"</td></tr>`;
  }
}

function showPartsDetailModal(jobNo) {
  const item = window.partsPrepCache ? window.partsPrepCache[jobNo] : null;
  if (!item) return;

  document.getElementById("parts_modal_title").innerText = `รายการอะไหล่สำหรับใบสั่งซ่อม: ${item.jobNo}`;
  const modalBody = document.getElementById("parts_modal_body");
  
  let totalParts = 0;
  
  let html = `
    <div style="padding:20px; background:#f8f9fa; border-bottom:1px solid var(--tmt-border); display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div><strong>ลูกค้า:</strong> ${item.customerName}</div>
        <div><strong>โทรศัพท์:</strong> <span style="color:var(--tmt-blue); font-weight:600;">${item.telNo}</span></div>
        <div><strong>ทะเบียนรถ:</strong> <span style="color:var(--tmt-red); font-weight:700;">${item.regNo}</span></div>
        <div><strong>วันเวลาที่นัดหมาย:</strong> ${item.apptDate}</div>
    </div>
    <table class="data-table" style="margin:0; border:none;">
        <thead>
            <tr>
                <th>เลขอะไหล่</th>
                <th>ชื่ออะไหล่ / รายละเอียด</th>
                <th style="text-align:center; width:120px;">จำนวน (ชิ้น)</th>
            </tr>
        </thead>
        <tbody>
  `;

  item.parts.forEach((part) => {
    totalParts += part.qty; 
    html += `
        <tr>
            <td style="font-weight:700; color:var(--tmt-blue);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    ${part.partNo}
                    <button class="action-btn btn-sm" style="margin: 0; padding: 2px 8px; font-size: 0.8em; background-color: #e0e0e0; color: #333; border: 1px solid #ccc; box-shadow: none;" onclick="copyToClipboardText('${part.partNo}')">คัดลอก</button>
                </div>
            </td>
            <td>${part.partDesc}</td>
            <td style="text-align:center; font-weight:700;">${part.qty}</td>
        </tr>
    `;
  });

  html += `
        <tr style="background-color: #eef2f5;">
            <td colspan="2" style="text-align:right; font-weight:700;">รวมจำนวนอะไหล่ทั้งหมดที่ต้องเบิก:</td>
            <td style="text-align:center; font-weight:700; color:var(--tmt-red); font-size:1.1em;">${totalParts}</td>
        </tr>
        </tbody>
    </table>`;
  
  modalBody.innerHTML = html;
  document.getElementById("partsModal").style.display = "flex";
}

function closePartsModal() {
  document.getElementById("partsModal").style.display = "none";
}

// ฟังก์ชันสำหรับคัดลอกข้อความลงคลิปบอร์ด
function copyToClipboardText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`คัดลอกเลขอะไหล่ ${text} สำเร็จ`, "success");
    }).catch(err => {
      showToast("ไม่สามารถคัดลอกได้", "error");
    });
  } else {
    // โหมดสำรองกรณีเบราว์เซอร์เก่าหรือไม่ใช่ HTTPS
    let textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast(`คัดลอกเลขอะไหล่ ${text} สำเร็จ`, "success");
    } catch (err) {
      showToast("ไม่สามารถคัดลอกได้", "error");
    }
    textArea.remove();
  }
}