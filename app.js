const DATA_URL = "./data/jobs.json";

const state = {
  jobs: [],
  filtered: [],
  categories: new Set(),
  filters: {
    search: "",
    status: "actionable",
    category: "all",
    sortBy: "match"
  }
};

const userProfile = {
  name: "刘畅航",
  currentRole: "CSC 项目官员",
  education: "MSc Education, Public Policy and Equity, University of Glasgow",
  strengths: [
    "组织并推广 CSC 联合国岗位说明会，触达 4,500+ 学生、133 所高校",
    "协调 20+ 联合国机构和国际组织参与大型职业发展活动",
    "多方利益相关者沟通、伙伴拓展与维护、外联与活动项目管理",
    "中英文官方沟通材料编辑翻译、数字传播与社媒推广",
    "大学就业/国际组织职业发展培训与青年发展相关经验"
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

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildPSDraft(job) {
  return `# Cover Letter Draft\n\n## Target Role\n- Position: ${job.titleEn || job.title}\n- Organization: ${job.organization || ""}\n- Location: ${job.location || "Unknown"}\n- Category: ${job.sourceCategory || "未分类"}\n- Deadline: ${job.deadline || "未写明"}\n\n## Opening Angle\nI am writing to apply for the ${job.titleEn || job.title} position at ${job.organization || "your organization"}. With three years of experience as a ${userProfile.currentRole}, ${userProfile.name} brings a track record in stakeholder engagement, international outreach, bilingual communications, and large-scale partnership coordination that aligns strongly with this role.\n\n## Why This Role Fits\n- ${job.matchNote || "This role aligns with partnerships, communications, and stakeholder engagement strengths."}\n- Relevant role focus: ${job.requirements || "Programme coordination, relationship management, and communications."}\n- Current value proposition: ${userProfile.strengths[0]}.\n\n## Evidence Paragraph Ideas\n- Partnerships: ${userProfile.strengths[1]}.\n- Communications: ${userProfile.strengths[3]}.\n- Capacity building / youth: ${userProfile.strengths[4]}.\n- Policy and education background: ${userProfile.education}.\n\n## Customization Notes\n- Mention this organization's mandate and why it matters.\n- Tie current CSC work to ${job.sourceCategory || "international organization"} ecosystem relevance.\n- Emphasize measurable coordination outcomes and bilingual communication.\n- Address experience gap directly if this is a stretch role.\n\n## Closing Paragraph Draft\nI would welcome the opportunity to contribute my experience in cross-sector coordination, stakeholder engagement, and communications to ${job.organization || "the organization"}. I would be glad to support its work through disciplined execution, strong relationship management, and high-quality bilingual materials.\n`;
}

function buildCVBrief(job) {
  return `# CV Tailoring Brief\n\n## Target Role\n- Position: ${job.titleEn || job.title}\n- Organization: ${job.organization || ""}\n- Location: ${job.location || "Unknown"}\n- Grade / Contract: ${job.grade || ""} ${job.contract || ""}\n\n## Priority Keywords To Weave In\n- stakeholder engagement\n- partnerships\n- external relations\n- programme coordination\n- bilingual communications\n- outreach\n- reporting\n- event management\n${(job.requirements || "").split(/[、,，。;]/).filter(Boolean).slice(0, 6).map((item) => `- ${item.trim()}`).join("\n")}\n\n## Experience Bullets To Emphasize\n- ${userProfile.strengths[0]}\n- ${userProfile.strengths[1]}\n- ${userProfile.strengths[2]}\n- ${userProfile.strengths[3]}\n- ${userProfile.strengths[4]}\n\n## Rewrite Guidance\n- Move the most relevant CSC bullets to the top of the experience section.\n- Rephrase bullets using the target role vocabulary from the vacancy.\n- Make every bullet outcome-driven and quantified where possible.\n- If the role is more senior, stress cross-institution coordination and ownership.\n- If the role is communications-heavy, foreground writing, translation, and campaign metrics.\n\n## Risks To Mitigate\n- Current site match note: ${job.matchNote || "No note provided."}\n- Audit status: ${job.statusLabel || "Unknown"}\n- Potential gap: clarify how current experience transfers to ${job.organization || "the target organization"}.\n`;
}

function renderPills(counts) {
  el("summaryBar").innerHTML = [
    `<span class="pill active">有效 ${counts.active || 0}</span>`,
    `<span class="pill closing">今日截止 ${counts.closing || 0}</span>`,
    `<span class="pill expired">已过期 ${counts.expired || 0}</span>`,
    `<span class="pill unavailable">链接失效 ${counts.unavailable || 0}</span>`
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
  return `
    <article class="job-card ${job.status}" data-match="${job.matchScore || 0}">
      <div class="job-top">
        <div>
          <h3 class="job-title">${job.title}<small>${job.titleEn || ""}</small></h3>
          <div class="job-org">${job.organization || ""}</div>
        </div>
        <div class="chip">匹配 ${matchStars(job.matchScore || 0)} · ${job.matchScore || 0}/5</div>
      </div>
      <div class="job-meta">
        <span class="chip status-${job.status}">${job.statusLabel}</span>
        <span class="chip">${category}</span>
        ${job.source ? `<span class="chip">${job.source}</span>` : ""}
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
      <div class="job-actions">
        <div class="job-actions-left">
          <a class="job-link" href="${job.link}" target="_blank" rel="noreferrer">打开原岗位</a>
          <button class="job-button secondary" data-action="ps" data-id="${job.id}">生成 PS</button>
          <button class="job-button tertiary" data-action="cv" data-id="${job.id}">生成 CV</button>
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
  el("jobGrid").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const job = state.jobs.find((item) => item.id === button.dataset.id);
    if (!job) return;
    const slug = slugify(job.titleEn || job.title);
    if (button.dataset.action === "ps") {
      downloadTextFile(`PS_${slug}.md`, buildPSDraft(job));
      showToast(`已生成 ${job.title} 的 PS 草稿`);
    }
    if (button.dataset.action === "cv") {
      downloadTextFile(`CV_${slug}.md`, buildCVBrief(job));
      showToast(`已生成 ${job.title} 的 CV 定制提纲`);
    }
  });
}

async function load() {
  const resp = await fetch(DATA_URL);
  const data = await resp.json();
  state.jobs = data.jobs;

  el("generatedAt").textContent = `站点生成时间：${data.generatedAt}`;
  el("auditDate").textContent = `岗位核查日期：${data.auditDate}`;

  renderAuditGrid(data.counts);
  renderPills(data.counts);
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
