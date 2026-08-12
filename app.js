const DATA_URL = "./data/jobs.json";
const APPLIED_STORAGE_KEY = "intlJobsApplied";
const LOCAL_HELPER_BASE = "http://127.0.0.1:47831";
const HELPER_STARTER_PATH = "/Users/Archer/Desktop/Adventurer Guild/intl-jobs-site/start_local_open_helper.command";

const state = {
  jobs: [],
  filtered: [],
  categories: new Set(),
  appliedJobs: new Set(),
  localHelperAvailable: false,
  filters: {
    search: "",
    status: "actionable",
    category: "all",
    sortBy: "match",
    application: "all"
  }
};

const userProfile = {
  name: "刘畅航",
  currentRole: "CSC 项目官员",
  location: "Beijing, China",
  education: "MSc Education, Public Policy and Equity, University of Glasgow",
  summary: "Project Officer with 3 years of experience in stakeholder engagement, partnerships, bilingual communications, and international programme coordination.",
  focusAreas: [
    "stakeholder engagement and partnership coordination",
    "bilingual communications and translation",
    "large-scale event and outreach delivery",
    "higher education and international career-development programming",
    "external relations, partner servicing, and cross-functional coordination"
  ]
};

function el(id) {
  return document.getElementById(id);
}

function slugify(value) {
  return (value || "job")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function showToast(message) {
  const toast = el("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function getLocalHelperStartupHint() {
  return `请先双击 ${HELPER_STARTER_PATH}，再刷新页面。`;
}

function setHelperStatus(available) {
  state.localHelperAvailable = available;
  const statusText = `岗位核查日期：${state.auditDate || "--"} · 本机直开${available ? "可用" : "未连接"}`;
  el("auditDate").textContent = statusText;
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

function buildOpenFolderCommand(folderPath) {
  return `open ${quoteShellPath(folderPath)}`;
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

async function fallbackWithCopiedCommand(command, successMessage) {
  const copied = await copyToClipboard(command);
  showToast(
    copied
      ? `${successMessage} ${getLocalHelperStartupHint()}`
      : `命令复制失败，请检查浏览器剪贴板权限。${getLocalHelperStartupHint()}`
  );
}

function buildMaterialCommand(job) {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return `node "/Users/Archer/Desktop/Adventurer Guild/.agents/skills/intl-jobs-application-materials/scripts/prepare_application_materials.js" --date ${date} --job-id "${job.id}"`;
}

function formatMaterialStamp(materials) {
  const raw = materials?.generatedAt || materials?.date;
  if (!raw) return "未知";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return String(raw).slice(0, 10);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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
}

function downloadWordFile(filename, content) {
  const blob = new Blob([content], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inferTrack(job) {
  const text = [
    job.title,
    job.titleEn,
    job.matchNote,
    job.requirements,
    job.sourceCategory
  ].join(" ").toLowerCase();

  if (/(communicat|media|public information|outreach|advocacy|campaign|content)/.test(text)) {
    return "communications";
  }
  if (/(partnership|engagement|donor|resource mobilization|membership|external relations|stakeholder)/.test(text)) {
    return "partnerships";
  }
  return "general";
}

function getTailoringPrompts(job) {
  const track = inferTrack(job);
  const shared = [
    "Insert the strongest quantified achievement from your private master CV.",
    "Keep 4,500+ participants, 133 universities, and 20+ international organizations where relevant.",
    "Use the vacancy's terminology in the first three bullets."
  ];
  if (track === "communications") {
    return [
      "Prioritize communication strategy, bilingual content production, outreach campaigns, and audience engagement examples.",
      "Show editing, translation, and messaging alignment work with external partners.",
      ...shared
    ];
  }
  if (track === "partnerships") {
    return [
      "Prioritize partner outreach, onboarding, retention, relationship management, and stakeholder coordination examples.",
      "Show how you managed multi-organization engagement and follow-through.",
      ...shared
    ];
  }
  return [
    "Prioritize programme coordination, reporting, cross-functional delivery, and event execution examples.",
    "Show ownership of timelines, logistics, and partner-facing implementation.",
    ...shared
  ];
}

function buildWordDocument(title, bodyHtml) {
  return `
  <html xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:w="urn:schemas-microsoft-com:office:word"
        xmlns="http://www.w3.org/TR/REC-html40">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Calibri, 'Microsoft YaHei', sans-serif; color: #222; margin: 28px; line-height: 1.55; }
      h1 { font-size: 18pt; margin: 0 0 8px; }
      h2 { font-size: 12.5pt; margin: 18px 0 8px; color: #2f4154; }
      p { margin: 0 0 10px; }
      ul { margin: 6px 0 10px 20px; padding: 0; }
      li { margin: 0 0 6px; }
      .meta { color: #555; font-size: 10.5pt; }
      .note { background: #f2f4f6; padding: 10px 12px; border-radius: 6px; }
      .section { margin-top: 16px; }
    </style>
  </head>
  <body>${bodyHtml}</body></html>`;
}

function buildPSDocument(job) {
  const prompts = getTailoringPrompts(job);
  const position = escapeHtml(job.titleEn || job.title);
  const organization = escapeHtml(job.organization || "");
  const body = `
    <h1>Cover Letter Draft</h1>
    <p class="meta">Target role: ${position} | ${organization}</p>
    <p class="meta">Word-compatible draft for WPS editing. This public version does not embed private CV text.</p>

    <div class="section">
      <p>Dear Hiring Team,</p>
      <p>I am writing to apply for the <strong>${position}</strong> position at <strong>${organization}</strong>. With three years of experience as a ${escapeHtml(userProfile.currentRole)} at the China Scholarship Council, I bring hands-on experience in stakeholder engagement, bilingual communications, international outreach, and cross-institution coordination that aligns closely with this role.</p>
      <p>${escapeHtml(job.matchNote || "This role aligns strongly with my background in partnerships, communications, and programme coordination.")}</p>
      <p>In my current role, I have built and maintained relationships across international organizations, universities, and external partners while translating strategy into concrete outreach, engagement, and delivery.</p>
      <p>Use your private CV to replace the placeholders below with the most relevant evidence:</p>
      <ul>
        <li>[Insert a quantified partnership / communications achievement most relevant to this role]</li>
        <li>[Insert a stakeholder coordination example showing ownership and results]</li>
        <li>[Insert a bilingual communication, outreach, or reporting example]</li>
      </ul>
      <p>These experiences have strengthened my ability to communicate across cultures, manage multiple stakeholders with competing priorities, and produce high-quality bilingual materials under deadline. They also position me to contribute to ${organization} through structured coordination, audience-sensitive messaging, and disciplined follow-through.</p>
      <p class="note">Customization notes:</p>
      <ul>${prompts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p class="note">Also add one paragraph on why ${organization} specifically matters, and connect current CSC work to ${escapeHtml(job.requirements || "the role's core responsibilities")}.</p>
      <p>Thank you for your time and consideration. I would welcome the opportunity to discuss how my background in partnership development, communications, and programme support could contribute to your team.</p>
      <p>Sincerely,<br>${escapeHtml(userProfile.name)}</p>
    </div>
  `;
  return buildWordDocument(`PS - ${job.titleEn || job.title}`, body);
}

function buildCVDocument(job) {
  const prompts = getTailoringPrompts(job);
  const track = inferTrack(job);
  const profileLine = track === "communications"
    ? "Tailored toward communications, public information, outreach, and stakeholder-facing narrative work."
    : track === "partnerships"
      ? "Tailored toward partnerships, stakeholder engagement, external relations, and coordination work."
      : "Tailored toward programme coordination and cross-functional delivery in international organizations.";

  const keywords = [
    "stakeholder engagement",
    "partnership management",
    "external relations",
    "bilingual communications",
    "programme coordination",
    "event delivery",
    "reporting",
    "relationship management"
  ];

  const body = `
    <h1>Tailored CV Draft</h1>
    <p class="meta">${escapeHtml(userProfile.name)} | ${escapeHtml(userProfile.location)} | ${escapeHtml(userProfile.currentRole)}</p>
    <p class="meta">Target role: ${escapeHtml(job.titleEn || job.title)} | ${escapeHtml(job.organization || "")}</p>

    <div class="section">
      <h2>Professional Profile</h2>
      <p>${escapeHtml(userProfile.summary)} ${escapeHtml(profileLine)}</p>
      <p>Education: ${escapeHtml(userProfile.education)}</p>
    </div>

    <div class="section">
      <h2>Priority Keywords For This Application</h2>
      <ul>${keywords.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>

    <div class="section">
      <h2>Core Experience To Move Up In The CV</h2>
      <p><strong>Project Officer, China Scholarship Council (CSC) | Beijing | Sep 2022 – Present</strong></p>
      <ul>
        <li>[Insert the strongest quantified bullet from your private master CV for this role]</li>
        <li>[Insert a second bullet emphasizing ${escapeHtml(track === "communications" ? "communications and outreach" : track === "partnerships" ? "partnership and stakeholder management" : "programme coordination")}]</li>
        <li>[Insert a third bullet showing measurable cross-institution coordination impact]</li>
        <li>[Insert a fourth bullet on bilingual materials, reporting, or external engagement as relevant]</li>
      </ul>
    </div>

    <div class="section">
      <h2>Tailoring Notes</h2>
      <ul>${prompts.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <ul>
        <li>Keep bullets that match this role's emphasis: ${escapeHtml(job.requirements || "stakeholder engagement, coordination, and communication responsibilities")}.</li>
        <li>Use the terminology of the vacancy in the top half of the CV.</li>
        <li>Retain quantification: 4,500+ participants, 133 universities, 20+ international organizations.</li>
        <li>Reduce or move down bullets that do not support this target role directly.</li>
      </ul>
      <p class="note">This file is Word-compatible for WPS and designed as a safe public template that points you back to your private CV, instead of exposing it online.</p>
    </div>
  `;
  return buildWordDocument(`CV - ${job.titleEn || job.title}`, body);
}

function renderPills(counts) {
  el("summaryBar").innerHTML = [
    `<span class="pill active">有效 ${counts.active || 0}</span>`,
    `<span class="pill closing">今日截止 ${counts.closing || 0}</span>`,
    `<span class="pill expired">已过期 ${counts.expired || 0}</span>`,
    `<span class="pill unavailable">链接失效 ${counts.unavailable || 0}</span>`,
    `<span class="pill applied">已投递 ${counts.applied || 0}</span>`
  ].join("");
}

function renderAuditGrid(counts) {
  el("auditGrid").innerHTML = [
    ["全部记录", counts.total || 0],
    ["仍可行动", (counts.active || 0) + (counts.closing || 0)],
    ["高匹配有效岗", counts.highMatchActive || 0],
    ["失效/过期", (counts.expired || 0) + (counts.unavailable || 0)]
  ].map(([label, value]) => `
    <div class="audit-chip">
      <div class="audit-num">${value}</div>
      <div class="audit-label">${label}</div>
    </div>
  `).join("");
}

function matchStars(score) {
  return "★".repeat(score) + "☆".repeat(5 - score);
}

function deadlineText(job) {
  if (!job.deadline) return "未写明";
  if (job.status === "expired") return `${job.deadline} · 已过期`;
  if (job.status === "closing") return `${job.deadline} · 今日截止`;
  if (typeof job.daysLeft === "number") return `${job.deadline} · ${job.daysLeft} 天`;
  return job.deadline;
}

function sortJobs(a, b) {
  const { sortBy } = state.filters;
  if (sortBy === "deadline") {
    const da = a.deadline || "9999-12-31";
    const db = b.deadline || "9999-12-31";
    return da.localeCompare(db);
  }
  if (sortBy === "organization") {
    return (a.organization || "").localeCompare(b.organization || "", "zh-CN");
  }
  const scoreDelta = (b.matchScore || 0) - (a.matchScore || 0);
  if (scoreDelta !== 0) return scoreDelta;
  const statusRank = { closing: 0, active: 1, unknown: 2, unavailable: 3, expired: 4 };
  return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
}

function renderPriorityList(jobs) {
  const picks = jobs
    .filter((job) => ["active", "closing"].includes(job.status))
    .filter((job) => (job.matchScore || 0) >= 4)
    .slice(0, 4);

  el("priorityList").innerHTML = picks.length ? picks.map((job) => `
    <div class="priority-item">
      <h4>${job.title}</h4>
      <p>${job.organization} · ${deadlineText(job)}</p>
    </div>
  `).join("") : "<p class='empty'>当前没有 4 星以上的在招岗位。</p>";
}

function renderJob(job) {
  const category = job.sourceCategory || "未分类";
  const applied = isApplied(job.id);
  const materials = job.localMaterials;
  const materialStatus = job.materialStatus || null;
  const materialStamp = materials ? formatMaterialStamp(materials) : "";
  const materialActionLabel = materials ? "刷新材料" : "生成材料";
  return `
    <article class="job-card ${job.status} ${applied ? "applied" : ""}" data-match="${job.matchScore || 0}">
      <div class="job-top">
        <div>
          <h3 class="job-title">${job.title}<small>${job.titleEn || ""}</small></h3>
          <div class="job-org">${job.organization || ""}</div>
        </div>
        <div class="chip">匹配 ${matchStars(job.matchScore || 0)} · ${job.matchScore || 0}/5</div>
      </div>
      <div class="job-meta">
        <span class="chip status-${job.status}">${job.statusLabel}</span>
        ${applied ? `<span class="chip chip-applied">已投递</span>` : ""}
        <span class="chip">${category}</span>
        ${job.source ? `<span class="chip">${job.source}</span>` : ""}
        ${materials ? `<span class="chip chip-materials status-${materialStatus?.state || "ready"}">${materialStatus?.label || "材料已生成"}</span>` : ""}
      </div>
      <div class="job-gridline">
        <div><strong>地点</strong><span>${job.location || "未知"}</span></div>
        <div><strong>合同</strong><span>${job.contract || "未知"}${job.grade ? ` · ${job.grade}` : ""}</span></div>
        <div><strong>截止</strong><span>${deadlineText(job)}</span></div>
        <div><strong>申请方式</strong><span>${job.applyMethod || "未说明"}</span></div>
      </div>
      ${job.matchNote ? `<p class="job-copy"><strong>匹配说明：</strong>${job.matchNote}</p>` : ""}
      ${job.statusReason ? `<p class="job-copy"><strong>核查结论：</strong>${job.statusReason}</p>` : ""}
      ${job.requirements ? `<p class="job-copy"><strong>岗位重点：</strong>${job.requirements}</p>` : ""}
      ${materials ? `
        <div class="materials-panel ${job.status === "expired" || job.status === "unavailable" ? "is-dimmed" : ""} ${materialStatus?.needsRefresh ? "is-stale" : ""}">
          <div class="materials-head">
            <strong>申请材料</strong>
            <span>最近生成：${materialStamp}</span>
          </div>
          <div class="materials-status-row">
            <span class="materials-badge status-${materialStatus?.state || "ready"}">${materialStatus?.label || "材料已生成"}</span>
            ${materialStatus?.needsRefresh ? `<span class="materials-note">岗位在 ${job.reportedDate || "最近一次更新"} 后有更新，建议重生材料</span>` : ""}
            ${materialStatus && !materialStatus.hasCv ? `<span class="materials-note">CV 缺失</span>` : ""}
            ${materialStatus && !materialStatus.hasCoverLetter ? `<span class="materials-note">Cover Letter 缺失</span>` : ""}
          </div>
          <div class="materials-actions">
            <button class="job-button folder icon-only" data-action="folder" data-id="${job.id}" title="复制 Mac 打开目录命令">📁 打开目录</button>
            ${materials?.cv ? `<button class="job-button folder alt icon-only" data-action="open-cv" data-id="${job.id}" title="复制 Mac 定位 CV 命令">定位 CV</button>` : ""}
            ${materials?.coverLetter ? `<button class="job-button folder alt icon-only" data-action="open-cl" data-id="${job.id}" title="复制 Mac 定位 Cover Letter 命令">定位 CL</button>` : ""}
            <button class="job-button folder generate" data-action="generate-materials" data-id="${job.id}" title="${materialActionLabel}">${materialActionLabel}</button>
          </div>
          <span class="materials-helper">Mac：点按钮后把命令粘贴到终端并回车，即可打开或在 Finder 中定位文件。</span>
          <span class="materials-path" title="${materials.directory}">${materials.directory}</span>
        </div>
      ` : `
        <div class="materials-panel materials-panel-empty">
          <div class="materials-head">
            <strong>申请材料</strong>
            <span>当前未生成</span>
          </div>
          <div class="materials-status-row">
            <span class="materials-badge status-missing">未生成材料</span>
            <span class="materials-note">点击下方按钮复制生成命令</span>
          </div>
          <div class="materials-actions">
            <button class="job-button folder generate" data-action="generate-materials" data-id="${job.id}" title="${materialActionLabel}">${materialActionLabel}</button>
          </div>
        </div>
      `}
      <div class="job-actions">
        <div class="job-actions-left">
          <a class="job-link" href="${job.link}" target="_blank" rel="noreferrer">打开原岗位</a>
          <button class="job-button mark ${applied ? "is-applied" : ""}" data-action="toggle-applied" data-id="${job.id}">${applied ? "取消已投递" : "标记已投递"}</button>
        </div>
        <span class="verification">核查：${job.verification || "Source file"} · ${job.auditDate || ""}</span>
      </div>
    </article>
  `;
}

function applyFilters() {
  const search = state.filters.search.trim().toLowerCase();
  state.filtered = state.jobs
    .filter((job) => {
      if (state.filters.status === "actionable" && !["active", "closing"].includes(job.status)) return false;
      if (state.filters.status !== "actionable" && state.filters.status !== "all" && job.status !== state.filters.status) return false;
      if (state.filters.category !== "all" && (job.sourceCategory || "未分类") !== state.filters.category) return false;
      if (state.filters.application === "applied" && !isApplied(job.id)) return false;
      if (state.filters.application === "not_applied" && isApplied(job.id)) return false;
      if (!search) return true;
      const haystack = [
        job.title,
        job.titleEn,
        job.organization,
        job.location,
        job.sourceCategory,
        job.matchNote,
        job.requirements
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    })
    .sort(sortJobs);

  renderList();
}

function renderList() {
  el("resultCount").textContent = `显示 ${state.filtered.length} 条`;
  if (!state.filtered.length) {
    el("jobGrid").innerHTML = "<div class='empty'>当前筛选条件下没有结果。</div>";
    return;
  }
  el("jobGrid").innerHTML = state.filtered.map(renderJob).join("");
}

function bindControls() {
  el("searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    applyFilters();
  });
  el("statusFilter").addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    applyFilters();
  });
  el("categoryFilter").addEventListener("change", (event) => {
    state.filters.category = event.target.value;
    applyFilters();
  });
  el("sortBy").addEventListener("change", (event) => {
    state.filters.sortBy = event.target.value;
    applyFilters();
  });
  el("applicationFilter").addEventListener("change", (event) => {
    state.filters.application = event.target.value;
    applyFilters();
  });
  el("jobGrid").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const job = state.jobs.find((item) => item.id === button.dataset.id);
    if (!job) return;
    if (button.dataset.action === "toggle-applied") {
      toggleApplied(job.id);
      renderPills(computeCounts(state.jobs));
      applyFilters();
      showToast(isApplied(job.id) ? `已标记 ${job.title} 为已投递` : `已取消 ${job.title} 的已投递标记`);
      return;
    }
    if (button.dataset.action === "folder") {
      const folderPath = job.localMaterials?.directory;
      if (!folderPath) {
        showToast("这个岗位还没有现成的申请材料目录");
        return;
      }
      if (state.localHelperAvailable) {
        try {
          await requestLocalHelper("/open-folder", { path: folderPath });
          showToast("已在 Finder 中打开材料目录");
          return;
        } catch {
          setHelperStatus(false);
        }
      }
      await fallbackWithCopiedCommand(buildOpenFolderCommand(folderPath), "本机直开未连接，已复制 Mac 打开目录命令。");
      return;
    }
    if (button.dataset.action === "open-cv") {
      const cvPath = job.localMaterials?.cv;
      if (!cvPath) {
        showToast("这个岗位还没有现成的 CV 文件");
        return;
      }
      if (state.localHelperAvailable) {
        try {
          await requestLocalHelper("/reveal-file", { path: cvPath });
          showToast("已在 Finder 中定位 CV");
          return;
        } catch {
          setHelperStatus(false);
        }
      }
      await fallbackWithCopiedCommand(buildRevealFileCommand(cvPath), "本机直开未连接，已复制 Mac 定位 CV 命令。");
      return;
    }
    if (button.dataset.action === "open-cl") {
      const clPath = job.localMaterials?.coverLetter;
      if (!clPath) {
        showToast("这个岗位还没有现成的 Cover Letter 文件");
        return;
      }
      if (state.localHelperAvailable) {
        try {
          await requestLocalHelper("/reveal-file", { path: clPath });
          showToast("已在 Finder 中定位 Cover Letter");
          return;
        } catch {
          setHelperStatus(false);
        }
      }
      await fallbackWithCopiedCommand(buildRevealFileCommand(clPath), "本机直开未连接，已复制 Mac 定位 Cover Letter 命令。");
      return;
    }
    if (button.dataset.action === "generate-materials") {
      const command = buildMaterialCommand(job);
      const copied = await copyToClipboard(command);
      showToast(copied ? "已复制生成/刷新材料命令，可直接粘贴到终端执行" : "生成命令复制失败，请检查浏览器剪贴板权限");
    }
  });
}

function computeCounts(jobs) {
  const counts = {
    total: jobs.length,
    active: 0,
    closing: 0,
    expired: 0,
    unavailable: 0,
    unknown: 0,
    highMatchActive: 0,
    applied: 0
  };

  jobs.forEach((job) => {
    const status = job.status || "unknown";
    if (counts[status] !== undefined) {
      counts[status] += 1;
    } else {
      counts.unknown += 1;
    }
    if (["active", "closing"].includes(status) && (job.matchScore || 0) >= 4) {
      counts.highMatchActive += 1;
    }
    if (isApplied(job.id)) {
      counts.applied += 1;
    }
  });

  return counts;
}

async function load() {
  const resp = await fetch(DATA_URL);
  const data = await resp.json();
  state.jobs = data.jobs;
  state.auditDate = data.auditDate;
  state.appliedJobs = loadAppliedJobs();
  setHelperStatus(await probeLocalHelper());

  el("generatedAt").textContent = `站点生成时间：${data.generatedAt}`;

  const counts = computeCounts(state.jobs);
  renderAuditGrid(counts);
  renderPills(counts);
  el("highlights").innerHTML = `<ul>${data.highlights.map((item) => `<li>${item}</li>`).join("")}</ul>`;

  const categories = [...new Set(state.jobs.map((job) => job.sourceCategory || "未分类"))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  el("categoryFilter").innerHTML += categories.map((category) => `<option value="${category}">${category}</option>`).join("");

  renderPriorityList(state.jobs);
  bindControls();
  applyFilters();
}

load().catch((error) => {
  el("jobGrid").innerHTML = `<div class="empty">数据加载失败：${error.message}</div>`;
});
