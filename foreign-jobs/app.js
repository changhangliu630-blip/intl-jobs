const DATA_URL = "./data/jobs.json";
const APPLIED_STORAGE_KEY = "foreignJobsApplied:v1";
const LOCAL_HELPER_BASE = "http://127.0.0.1:47831";

const state = {
  jobs: [],
  filtered: [],
  appliedJobs: new Set(),
  localHelperAvailable: false,
  filters: {
    search: "",
    status: "actionable",
    risk: "all",
    score: "all",
    category: "all",
    application: "all",
    sortBy: "match"
  }
};

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function loadAppliedJobs() {
  try {
    const raw = localStorage.getItem(APPLIED_STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

function saveAppliedJobs() {
  localStorage.setItem(APPLIED_STORAGE_KEY, JSON.stringify([...state.appliedJobs]));
}

function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

async function copyToClipboard(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function quoteShellPath(value) {
  return `"${String(value || "").replace(/(["\\$`])/g, "\\$1")}"`;
}

function buildRevealFileCommand(filePath) {
  return `open -R ${quoteShellPath(filePath)}`;
}

async function probeLocalHelper() {
  try {
    const resp = await fetch(`${LOCAL_HELPER_BASE}/health`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

async function requestLocalHelper(endpoint, payload) {
  const resp = await fetch(`${LOCAL_HELPER_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const data = await resp.json();
      if (data?.message) message = data.message;
    } catch {}
    throw new Error(message);
  }
  return resp.json();
}

function formatDate(value) {
  if (!value) return "未写明";
  return value;
}

function formatMaterialStamp(materials) {
  const raw = materials?.generatedAt;
  if (!raw) return "未知时间";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function isApplied(jobId) {
  return state.appliedJobs.has(jobId);
}

function toggleApplied(jobId) {
  if (state.appliedJobs.has(jobId)) {
    state.appliedJobs.delete(jobId);
  } else {
    state.appliedJobs.add(jobId);
  }
  saveAppliedJobs();
  render();
}

function riskRank(job) {
  return { low: 0, medium: 1, high: 2 }[job.riskLevel] ?? 3;
}

function statusRank(job) {
  return { closing: 0, active: 1, expired: 2 }[job.status] ?? 3;
}

function sortJobs(jobs) {
  return [...jobs].sort((a, b) => {
    if (state.filters.sortBy === "date") {
      return String(b.postedDate || b.reportedDate || "").localeCompare(String(a.postedDate || a.reportedDate || ""));
    }
    if (state.filters.sortBy === "company") {
      return String(a.company || "").localeCompare(String(b.company || ""));
    }
    if (state.filters.sortBy === "risk") {
      return riskRank(a) - riskRank(b) || Number(b.matchScore || 0) - Number(a.matchScore || 0);
    }
    return Number(b.matchScore || 0) - Number(a.matchScore || 0) || statusRank(a) - statusRank(b);
  });
}

function matchesFilters(job) {
  const query = state.filters.search.trim().toLowerCase();
  if (query) {
    const haystack = [
      job.title,
      job.titleEn,
      job.company,
      job.location,
      job.category,
      job.matchNote,
      job.workPermitNote,
      job.source
    ].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (state.filters.status === "actionable" && job.status === "expired") return false;
  if (["active", "closing", "expired"].includes(state.filters.status) && job.status !== state.filters.status) return false;
  if (state.filters.risk !== "all" && job.riskLevel !== state.filters.risk) return false;
  if (state.filters.score === "4plus" && Number(job.matchScore || 0) < 4) return false;
  if (state.filters.score === "3" && Number(job.matchScore || 0) !== 3) return false;
  if (state.filters.category !== "all" && job.category !== state.filters.category) return false;
  if (state.filters.application === "applied" && !isApplied(job.id)) return false;
  if (state.filters.application === "not_applied" && isApplied(job.id)) return false;
  return true;
}

function renderHero(data) {
  el("heroMeta").innerHTML = `
    <span>审计日期 ${escapeHtml(data.auditDate || data.lastUpdated || "")}</span>
    <span>岗位 ${data.counts?.total || state.jobs.length}</span>
    <span>公网每日更新</span>
  `;
}

function chip(label, value, tone = "") {
  return `<div class="audit-chip ${tone}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderAuditGrid(data) {
  const appliedCount = state.appliedJobs.size;
  el("auditGrid").innerHTML = [
    chip("可行动", (data.counts.active || 0) + (data.counts.closing || 0), "green"),
    chip("4★+", data.counts.highMatch || 0, "blue"),
    chip("低风险", data.counts.lowRisk || 0, "green"),
    chip("可验证", data.counts.verifiableRisk || 0, "amber"),
    chip("中高风险", data.counts.highRisk || 0, "red"),
    chip("已标记投递", appliedCount, "ink")
  ].join("");
}

function renderCategoryOptions() {
  const selected = state.filters.category;
  const categories = [...new Set(state.jobs.map((job) => job.category).filter(Boolean))].sort();
  el("categoryFilter").innerHTML = [
    `<option value="all">全部方向</option>`,
    ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
  ].join("");
  el("categoryFilter").value = selected;
}

function renderSummaryBar() {
  const active = state.filtered.filter((job) => job.status !== "expired").length;
  const highMatch = state.filtered.filter((job) => Number(job.matchScore || 0) >= 4).length;
  const lowRisk = state.filtered.filter((job) => job.riskLevel === "low").length;
  const materials = state.filtered.filter((job) => job.materialStatus?.state !== "missing").length;
  el("summaryBar").innerHTML = `
    <span class="pill active">${active} 个可行动</span>
    <span class="pill blue">${highMatch} 个 4★+</span>
    <span class="pill green">${lowRisk} 个低风险</span>
    <span class="pill amber">${materials} 个已有材料</span>
    <span class="pill muted">${state.filtered.length} / ${state.jobs.length} 当前筛选</span>
  `;
}

function renderPriorityList(data) {
  const priority = (data.highlights?.priority || [])
    .map((item) => state.jobs.find((job) => job.id === item.id))
    .filter(Boolean)
    .filter((job) => !isApplied(job.id) && job.status !== "expired")
    .slice(0, 5);

  if (priority.length === 0) {
    el("priorityList").innerHTML = `<p class="empty-note">当前没有未投递的 4★ 优先岗位。</p>`;
    return;
  }

  el("priorityList").innerHTML = priority.map((job) => `
    <button class="priority-item" data-scroll-job="${escapeHtml(job.id)}">
      <span>${escapeHtml(job.company)}</span>
      <strong>${escapeHtml(job.titleEn || job.title)}</strong>
      <small>${escapeHtml(job.location || "")} · ${escapeHtml(job.riskLabel || "")}</small>
    </button>
  `).join("");
}

function renderWatchNotes(data) {
  el("watchNotes").innerHTML = (data.highlights?.notes || []).map((note) => `
    <p class="watch-note">${escapeHtml(note)}</p>
  `).join("");
}

function starString(score) {
  const value = Math.max(0, Math.min(5, Number(score || 0)));
  return `${"★".repeat(value)}${"☆".repeat(5 - value)}`;
}

function getMaterialFile(job, kind) {
  return job.materials?.files?.find((file) => file.kind === kind) || null;
}

async function openMaterial(file, label) {
  if (!file?.path) {
    showToast(`这个岗位还没有现成的 ${label} 文件`);
    return;
  }

  if (state.localHelperAvailable) {
    try {
      await requestLocalHelper("/reveal-file", { path: file.path });
      showToast(`已在 Finder 中定位 ${label}`);
      return;
    } catch {
      state.localHelperAvailable = false;
    }
  }

  const copied = await copyToClipboard(buildRevealFileCommand(file.path));
  showToast(copied ? `本机直开未连接，已复制定位 ${label} 的 Mac 命令` : "命令复制失败，请检查浏览器剪贴板权限");
}

function renderMaterials(job) {
  if (!job.materials || !Array.isArray(job.materials.files) || job.materials.files.length === 0) {
    return `
      <div class="materials empty">
        <span>申请材料</span>
        <strong>未生成</strong>
        <p>优先岗位可在日报链路中生成 Cover Letter 和定制 CV。</p>
      </div>
    `;
  }

  const cvFile = getMaterialFile(job, "cv");
  const clFile = getMaterialFile(job, "coverLetter");
  const fileList = job.materials.files.map((file) => `
    <li>
      <span>${escapeHtml(file.kind === "coverLetter" ? "Cover Letter" : file.kind === "cv" ? "CV" : "支持材料")}</span>
      <strong>${escapeHtml(file.name)}</strong>
    </li>
  `).join("");
  return `
    <div class="materials">
      <div>
        <span>申请材料</span>
        <strong>${escapeHtml(job.materialStatus?.label || "已生成")}</strong>
        <p>最近更新 ${escapeHtml(formatMaterialStamp(job.materials))}</p>
      </div>
      <ul>${fileList}</ul>
      <div class="material-openers" aria-label="申请材料打开按钮">
        ${cvFile ? `<button type="button" class="material-button" data-open-material="cv" data-job-id="${escapeHtml(job.id)}" title="双击打开或定位 CV">CV</button>` : ""}
        ${clFile ? `<button type="button" class="material-button" data-open-material="coverLetter" data-job-id="${escapeHtml(job.id)}" title="双击打开或定位 Cover Letter">CL</button>` : ""}
      </div>
      <p class="materials-helper">单击提示，双击打开/定位文件；若本机助手未连接，会复制 Mac 定位命令。</p>
    </div>
  `;
}

function renderJob(job) {
  const applied = isApplied(job.id);
  const applicationLabel = applied ? "已投递" : "标记已投";
  return `
    <article class="job-card ${job.status === "expired" ? "is-expired" : ""}" id="job-${escapeHtml(job.id)}">
      <div class="job-topline">
        <div>
          <p class="company">${escapeHtml(job.company)}</p>
          <h3>${escapeHtml(job.title)}</h3>
          <p class="title-en">${escapeHtml(job.titleEn || "")}</p>
        </div>
        <div class="score" aria-label="匹配度 ${escapeHtml(job.matchScore)} 星">
          <span>${escapeHtml(starString(job.matchScore))}</span>
          <strong>${escapeHtml(job.matchScore || "")}.0</strong>
        </div>
      </div>

      <div class="job-chips">
        <span class="status ${escapeHtml(job.status)}">${escapeHtml(job.statusLabel || "")}</span>
        <span class="risk ${escapeHtml(job.riskLevel)}">${escapeHtml(job.riskLabel || "")}</span>
        <span>${escapeHtml(job.category || "")}</span>
        <span>${escapeHtml(job.source || "")}</span>
        <span class="${applied ? "applied-chip" : ""}">${applied ? "已投递" : "未投递"}</span>
        <span>${escapeHtml(job.materialStatus?.label || "未生成材料")}</span>
      </div>

      <dl class="job-facts">
        <div><dt>地点</dt><dd>${escapeHtml(job.location || "未写明")}</dd></div>
        <div><dt>模式</dt><dd>${escapeHtml(job.workMode || "未写明")}</dd></div>
        <div><dt>类型</dt><dd>${escapeHtml(job.contract || "未写明")}</dd></div>
        <div><dt>发布日期</dt><dd>${escapeHtml(formatDate(job.postedDate || job.reportedDate))}</dd></div>
        <div><dt>截止</dt><dd>${escapeHtml(formatDate(job.deadline))}</dd></div>
      </dl>

      <div class="analysis-grid">
        <section>
          <h4>匹配判断</h4>
          <p>${escapeHtml(job.matchNote || "")}</p>
        </section>
        <section>
          <h4>工签 / 地点</h4>
          <p>${escapeHtml(job.workPermitNote || job.workPermitRisk || "")}</p>
        </section>
      </div>

      ${renderMaterials(job)}

      <div class="job-actions">
        <a class="primary-link" href="${escapeHtml(job.link || "#")}" target="_blank" rel="noreferrer">官方申请</a>
        <button type="button" class="mark-button ${applied ? "is-applied" : ""}" data-toggle-applied="${escapeHtml(job.id)}">${applicationLabel}</button>
      </div>
    </article>
  `;
}

function renderJobs() {
  el("resultCount").textContent = `${state.filtered.length} 个岗位`;
  if (state.filtered.length === 0) {
    el("jobsList").innerHTML = `<div class="empty-state">没有符合当前筛选的岗位。</div>`;
    return;
  }
  el("jobsList").innerHTML = state.filtered.map(renderJob).join("");
}

function applyFilters() {
  state.filtered = sortJobs(state.jobs.filter(matchesFilters));
}

function render(data = window.__foreignJobsData) {
  applyFilters();
  renderAuditGrid(data);
  renderCategoryOptions();
  renderSummaryBar();
  renderPriorityList(data);
  renderJobs();
}

function bindFilters() {
  const bindings = [
    ["searchInput", "search", "input"],
    ["statusFilter", "status", "change"],
    ["riskFilter", "risk", "change"],
    ["scoreFilter", "score", "change"],
    ["categoryFilter", "category", "change"],
    ["applicationFilter", "application", "change"],
    ["sortFilter", "sortBy", "change"]
  ];
  for (const [id, key, eventName] of bindings) {
    el(id).addEventListener(eventName, (event) => {
      state.filters[key] = event.target.value;
      render();
    });
  }

  document.addEventListener("click", async (event) => {
    const materialButton = event.target.closest("[data-open-material]");
    if (materialButton) {
      const label = materialButton.dataset.openMaterial === "cv" ? "CV" : "Cover Letter";
      showToast(`双击 ${label} 按钮即可打开/定位文件`);
      return;
    }

    const appliedButton = event.target.closest("[data-toggle-applied]");
    if (appliedButton) {
      toggleApplied(appliedButton.dataset.toggleApplied);
      showToast("投递状态已更新");
      return;
    }

    const copyButton = event.target.closest("[data-copy-path]");
    if (copyButton) {
      const command = `open -R ${quoteShellPath(copyButton.dataset.copyPath)}`;
      const ok = await copyToClipboard(command);
      showToast(ok ? "已复制定位命令" : "复制失败，请手动打开材料目录");
      return;
    }

    const scrollButton = event.target.closest("[data-scroll-job]");
    if (scrollButton) {
      const target = document.getElementById(`job-${scrollButton.dataset.scrollJob}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  document.addEventListener("dblclick", async (event) => {
    const materialButton = event.target.closest("[data-open-material]");
    if (!materialButton) return;
    const job = state.jobs.find((item) => item.id === materialButton.dataset.jobId);
    if (!job) return;
    const kind = materialButton.dataset.openMaterial;
    const label = kind === "cv" ? "CV" : "Cover Letter";
    await openMaterial(getMaterialFile(job, kind), label);
  });
}

async function init() {
  state.appliedJobs = loadAppliedJobs();
  state.localHelperAvailable = await probeLocalHelper();
  const resp = await fetch(`${DATA_URL}?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Unable to load jobs data: ${resp.status}`);
  const data = await resp.json();
  window.__foreignJobsData = data;
  state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
  renderHero(data);
  renderWatchNotes(data);
  bindFilters();
  render(data);
}

init().catch((error) => {
  el("jobsList").innerHTML = `<div class="empty-state">加载失败：${escapeHtml(error.message)}</div>`;
});
