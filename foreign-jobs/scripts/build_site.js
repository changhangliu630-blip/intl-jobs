const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const siteRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "automation-outputs", "foreign-jobs", "source", "jobs.local.json");
const dataDir = path.join(siteRoot, "data");
const dataPath = path.join(dataDir, "jobs.json");
const indexPath = path.join(siteRoot, "index.html");

function stars(score) {
  const value = Number(score) || 0;
  return "★★★★★".slice(0, value) + "☆☆☆☆☆".slice(0, Math.max(0, 5 - value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function riskClass(risk) {
  const text = String(risk || "");
  if (text.includes("低")) return "low";
  if (text.includes("中高") || text.includes("高")) return "high";
  return "medium";
}

function normalizeJob(job) {
  return {
    id: job.id,
    title: job.title || job.titleEn || "Untitled role",
    titleEn: job.titleEn || "",
    company: job.company || job.organization || "",
    location: job.location || "",
    workMode: job.workMode || "",
    contract: job.contract || "",
    deadline: job.deadline || "",
    postedDate: job.postedDate || "",
    link: job.link || "",
    source: job.source || "",
    matchScore: Number(job.matchScore) || 0,
    matchNote: job.matchNote || "",
    workPermitRisk: job.workPermitRisk || "可验证",
    workPermitNote: job.workPermitNote || "",
    reportedDate: job.reportedDate || "",
    expired: Boolean(job.expired)
  };
}

function isActive(job) {
  if (job.expired) return false;
  if (!job.deadline) return true;
  const deadline = Date.parse(job.deadline);
  if (Number.isNaN(deadline)) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadline >= today.getTime();
}

function renderJobCard(job) {
  const title = escapeHtml(job.title);
  const titleEn = job.titleEn ? `<div class="title-en">${escapeHtml(job.titleEn)}</div>` : "";
  const link = job.link
    ? `<a class="apply" href="${escapeHtml(job.link)}" target="_blank" rel="noreferrer">官方申请</a>`
    : "";
  return `
    <article class="job-card">
      <div class="job-topline">
        <div>
          <h2>${title}</h2>
          ${titleEn}
        </div>
        <div class="stars" aria-label="${job.matchScore} stars">${stars(job.matchScore)}</div>
      </div>
      <div class="meta">
        <span>${escapeHtml(job.company)}</span>
        <span>${escapeHtml(job.location || "地点待确认")}</span>
        <span>${escapeHtml(job.workMode || "办公模式待确认")}</span>
        <span>${escapeHtml(job.contract || "合同待确认")}</span>
      </div>
      <div class="risk ${riskClass(job.workPermitRisk)}">
        <strong>工签：</strong>${escapeHtml(job.workPermitRisk)}${job.workPermitNote ? ` - ${escapeHtml(job.workPermitNote)}` : ""}
      </div>
      <p>${escapeHtml(job.matchNote)}</p>
      <div class="card-footer">
        <span>${escapeHtml(job.deadline ? `截止：${job.deadline}` : job.postedDate ? `发布：${job.postedDate}` : "日期待确认")}</span>
        ${link}
      </div>
    </article>`;
}

function renderHtml(payload) {
  const jobs = payload.jobs.map(normalizeJob).sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    return String(b.reportedDate).localeCompare(String(a.reportedDate));
  });
  const activeJobs = jobs.filter(isActive);
  const activeCards = activeJobs.length
    ? activeJobs.map(renderJobCard).join("\n")
    : `<div class="empty">暂无在有效期的外企岗位。下一次日报会继续检索。</div>`;
  const allCards = jobs.length
    ? jobs.map(renderJobCard).join("\n")
    : `<div class="empty">岗位库还没有记录。首次日报生成后会自动出现在这里。</div>`;
  const updated = escapeHtml(payload.lastUpdated || new Date().toISOString().slice(0, 10));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>高质量外企岗位日报</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #172026;
      --muted: #64717c;
      --line: #d8dee4;
      --paper: #f7f8fa;
      --accent: #0f766e;
      --accent-2: #365b9c;
      --low: #0f766e;
      --medium: #9a6700;
      --high: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background: var(--paper);
      line-height: 1.5;
    }
    header {
      background: #ffffff;
      border-bottom: 1px solid var(--line);
    }
    .wrap {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
    }
    .hero {
      padding: 28px 0 18px;
      display: grid;
      gap: 10px;
    }
    h1 {
      margin: 0;
      font-size: clamp(26px, 4vw, 40px);
      line-height: 1.15;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 0;
      color: var(--muted);
      max-width: 820px;
    }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 8px;
    }
    .stat {
      border: 1px solid var(--line);
      background: #ffffff;
      border-radius: 8px;
      padding: 10px 12px;
      min-width: 120px;
    }
    .stat strong {
      display: block;
      font-size: 22px;
    }
    main {
      padding: 22px 0 40px;
    }
    section + section {
      margin-top: 28px;
    }
    h2.section-title {
      margin: 0 0 12px;
      font-size: 20px;
    }
    .grid {
      display: grid;
      gap: 12px;
    }
    .job-card {
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
    }
    .job-topline {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .job-card h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.3;
    }
    .title-en {
      margin-top: 3px;
      color: var(--muted);
      font-size: 14px;
    }
    .stars {
      color: var(--accent-2);
      white-space: nowrap;
      font-weight: 700;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
      color: var(--muted);
      font-size: 14px;
    }
    .meta span {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      background: #fbfcfd;
    }
    .risk {
      border-left: 4px solid var(--medium);
      background: #fff9eb;
      padding: 8px 10px;
      margin: 10px 0;
      font-size: 14px;
    }
    .risk.low { border-left-color: var(--low); background: #edf8f5; }
    .risk.high { border-left-color: var(--high); background: #fff1f0; }
    .job-card p {
      margin: 10px 0;
    }
    .card-footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      color: var(--muted);
      font-size: 14px;
    }
    .apply {
      color: #ffffff;
      background: var(--accent);
      text-decoration: none;
      border-radius: 6px;
      padding: 7px 10px;
      white-space: nowrap;
    }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 18px;
      background: #ffffff;
      color: var(--muted);
    }
    footer {
      color: var(--muted);
      border-top: 1px solid var(--line);
      padding: 18px 0 28px;
      font-size: 13px;
    }
    @media (max-width: 640px) {
      .job-topline, .card-footer { display: block; }
      .stars { margin-top: 8px; }
      .apply { display: inline-block; margin-top: 10px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap hero">
      <h1>高质量外企岗位日报</h1>
      <p class="subtitle">按候选人画像筛选跨国公司正式岗位，重点关注 partnership、public affairs、programme coordination、communications 与 sustainability/ESG，并逐条标注工签和地点风险。</p>
      <div class="stats">
        <div class="stat"><strong>${jobs.length}</strong>累计岗位</div>
        <div class="stat"><strong>${activeJobs.length}</strong>有效岗位</div>
        <div class="stat"><strong>${updated}</strong>最近更新</div>
      </div>
    </div>
  </header>
  <main class="wrap">
    <section>
      <h2 class="section-title">仍在有效期</h2>
      <div class="grid">${activeCards}</div>
    </section>
    <section>
      <h2 class="section-title">全部记录</h2>
      <div class="grid">${allCards}</div>
    </section>
  </main>
  <footer>
    <div class="wrap">数据来源：本地外企岗位日报去重库。原始简历目录只读，不在站点中展示个人联系方式。</div>
  </footer>
</body>
</html>`;
}

function main() {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const payload = JSON.parse(raw);
  payload.lastUpdated = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(sourcePath, JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2) + "\n");
  fs.writeFileSync(indexPath, renderHtml(payload));
  console.log(JSON.stringify({ ok: true, dataPath, indexPath, jobs: payload.jobs.length }, null, 2));
}

main();
