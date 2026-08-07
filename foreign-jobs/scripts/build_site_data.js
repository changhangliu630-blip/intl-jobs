const fs = require("fs");
const path = require("path");

const SITE_DIR = path.join(__dirname, "..");
const SOURCE_PATH = "/Users/Archer/Desktop/Adventurer Guild/automation-outputs/foreign-jobs/source/jobs.local.json";
const OUTPUT_PATH = path.join(SITE_DIR, "data", "jobs.json");
const APPLICATION_MATERIALS_ROOT = "/Users/Archer/Desktop/Adventurer Guild/automation-outputs/foreign-jobs/application-materials";

function getShanghaiNow() {
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
  return {
    date: stamp.slice(0, 10),
    timestamp: `${stamp.replace(" ", "T")}+08:00`
  };
}

const now = getShanghaiNow();
const AUDIT_DATE = process.env.AUDIT_DATE || now.date;

function diffDays(dateValue, auditDate) {
  if (!dateValue) return null;
  const [dy, dm, dd] = dateValue.split("-").map(Number);
  const [ay, am, ad] = auditDate.split("-").map(Number);
  if (![dy, dm, dd, ay, am, ad].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function tokenize(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function inferRiskLevel(job) {
  const text = `${job.workPermitRisk || ""} ${job.workPermitNote || ""}`.toLowerCase();
  if (/低风险/.test(text) || /\blow\b/.test(text)) return "low";
  if (/中高风险|高风险|no sponsorship|right to work|citizen|citizenship|must already/.test(text)) return "high";
  if (/可验证|需确认|未写明|sponsorship|visa|work permit|ep\/s pass|签证/.test(text)) return "medium";
  return "medium";
}

function riskLabel(level) {
  return {
    low: "低风险",
    medium: "可验证",
    high: "中高风险"
  }[level] || "可验证";
}

function inferStatus(job) {
  if (job.expired === true) {
    return {
      status: "expired",
      statusLabel: "已标记过期",
      statusReason: "岗位库已将该岗位标记为过期。",
      daysLeft: null
    };
  }

  const daysLeft = diffDays(job.deadline, AUDIT_DATE);
  if (daysLeft === null) {
    return {
      status: "active",
      statusLabel: "待复核",
      statusReason: "官方 JD 未写明截止日期，按仍在有效岗位池处理；日报检索时需复核官方链接。",
      daysLeft: null
    };
  }
  if (daysLeft < 0) {
    return {
      status: "expired",
      statusLabel: "已过期",
      statusReason: `截止日期 ${job.deadline} 已过。`,
      daysLeft
    };
  }
  if (daysLeft <= 3) {
    return {
      status: "closing",
      statusLabel: daysLeft === 0 ? "今日截止" : `${daysLeft} 天内截止`,
      statusReason: `截止日期 ${job.deadline}，建议优先处理。`,
      daysLeft
    };
  }
  return {
    status: "active",
    statusLabel: "有效",
    statusReason: `截止日期 ${job.deadline} 尚未到期。`,
    daysLeft
  };
}

function inferCategory(job) {
  const text = normalizeText([
    job.title,
    job.titleEn,
    job.company,
    job.source,
    job.matchNote,
    job.workPermitNote
  ].join(" "));

  if (/(brunswick|ogilvy|edelman|apco|fti|fgs|fleishman|weber|public affairs|corporate affairs|strategic communic|communications|influence|reputation|pr\b)/.test(text)) {
    return "战略传播/公共事务";
  }
  if (/(partnership|partner|alliances|ecosystem|donor|institutional relations|stakeholder|membership|community)/.test(text)) {
    return "伙伴关系/生态运营";
  }
  if (/(airwallex|stripe|hsbc|standard chartered|gic|visa|mastercard|bloomberg|msci|moody|s&p|fintech|financial)/.test(text)) {
    return "金融/金融科技";
  }
  if (/(apple|figma|openai|microsoft|google|canva|atlassian|notion|sentient|remote|deel|technology|platform|software)/.test(text)) {
    return "科技平台";
  }
  if (/(coursera|maven|handshake|seek|british council|idp|qs|times higher education|education|talent|learning)/.test(text)) {
    return "教育/人才发展";
  }
  if (/(sgs|bsi|dnv|tuv|tüv|ul |clarivate|economist|oxford economics|standards|certification|assurance|inspection)/.test(text)) {
    return "标准/认证/专业信息";
  }
  if (/(informa|event|exhibition|conference|summit|forum|webinar)/.test(text)) {
    return "会展/专业社群";
  }
  if (/(foundation|social impact|philanthropy|csr|community investment|temasek)/.test(text)) {
    return "企业社会影响";
  }
  if (/(esg|sustainability|climate|carbon|sustainable|green)/.test(text)) {
    return "ESG/可持续";
  }
  return "其他高质量外企";
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const result = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        result.push(fullPath);
      }
    }
  }
  return result;
}

function classifyMaterial(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (/cover|letter|cl/.test(name)) return "coverLetter";
  if (/\bcv\b|resume|résumé/.test(name)) return "cv";
  return "support";
}

function collectMaterials(jobs) {
  const files = walkFiles(APPLICATION_MATERIALS_ROOT).filter((file) => /\.(md|docx|pdf|txt)$/i.test(file));
  const materials = new Map();

  for (const job of jobs) {
    const matched = files.filter((file) => {
      const fileText = normalizeText(path.basename(file));
      if (fileText.includes(normalizeText(job.id))) return true;
      const companyTokens = tokenize(job.company);
      const hasCompany = companyTokens.some((token) => fileText.includes(token));
      if (!hasCompany) return false;

      const locationText = normalizeText(job.location);
      const locationAliases = [
        ["新加坡", "singapore"],
        ["香港", "hong kong"],
        ["伦敦", "london"],
        ["墨尔本", "melbourne"],
        ["吉隆坡", "kuala lumpur"],
        ["马来西亚", "malaysia"],
        ["澳大利亚", "australia"],
        ["菲律宾", "philippines"],
        ["巴塞罗那", "barcelona"]
      ];
      const hasLocation = locationAliases.some(([cn, en]) => locationText.includes(cn) && fileText.includes(en));
      if (!hasLocation) return false;

      const genericTitleTokens = new Set(["manager", "executive", "associate", "consultant", "project", "officer", "specialist"]);
      const titleTokens = [...new Set([...tokenize(job.titleEn), ...tokenize(job.title)])]
        .filter((token) => !genericTitleTokens.has(token));
      const titleScore = titleTokens.reduce((count, token) => count + (fileText.includes(token) ? 1 : 0), 0);
      return titleScore >= 1 && (titleScore >= 2 || /associate|consultant|manager|executive|specialist/.test(fileText));
    });

    if (matched.length === 0) continue;

    const records = matched.map((file) => {
      const stat = fs.statSync(file);
      return {
        name: path.basename(file),
        path: file,
        directory: path.dirname(file),
        kind: classifyMaterial(file),
        modifiedAt: stat.mtime.toISOString()
      };
    }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    const hasCv = records.some((file) => file.kind === "cv");
    const hasCoverLetter = records.some((file) => file.kind === "coverLetter");
    materials.set(job.id, {
      directory: records[0].directory,
      files: records,
      generatedAt: records[0].modifiedAt,
      hasCv,
      hasCoverLetter
    });
  }

  return materials;
}

function materialStatus(material) {
  if (!material) {
    return {
      state: "missing",
      label: "未生成材料",
      hasCv: false,
      hasCoverLetter: false
    };
  }
  if (material.hasCv && material.hasCoverLetter) {
    return {
      state: "ready",
      label: "材料齐全",
      hasCv: true,
      hasCoverLetter: true
    };
  }
  return {
    state: "partial",
    label: material.hasCoverLetter ? "已有 Cover Letter" : "材料不完整",
    hasCv: material.hasCv,
    hasCoverLetter: material.hasCoverLetter
  };
}

function buildHighlights(jobs) {
  const actionable = jobs.filter((job) => job.status !== "expired");
  const priority = actionable
    .filter((job) => Number(job.matchScore || 0) >= 4)
    .sort((a, b) => {
      const scoreDelta = Number(b.matchScore || 0) - Number(a.matchScore || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return String(b.postedDate || b.reportedDate || "").localeCompare(String(a.postedDate || a.reportedDate || ""));
    })
    .slice(0, 5)
    .map((job) => ({
      id: job.id,
      title: job.title,
      titleEn: job.titleEn,
      company: job.company,
      location: job.location,
      matchScore: job.matchScore,
      riskLabel: job.riskLabel,
      category: job.category
    }));

  return {
    priority,
    notes: [
      "岗位主线已从单一 ESG 扩展为 partnerships、stakeholder engagement、public/corporate affairs、programme coordination、membership/community 与 social impact。",
      "LinkedIn、Indeed、Glassdoor 等平台只作为发现源；入库和网页展示仍坚持官方申请链接。",
      "美国、英国、欧盟、澳洲、加拿大岗位如未明确 sponsor/relocation/remote policy，不默认标低风险。"
    ]
  };
}

function build() {
  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(`Missing source jobs file: ${SOURCE_PATH}`);
  }
  const source = JSON.parse(fs.readFileSync(SOURCE_PATH, "utf8"));
  source.lastUpdated = AUDIT_DATE;
  fs.writeFileSync(SOURCE_PATH, `${JSON.stringify(source, null, 2)}\n`);

  const materialMap = collectMaterials(source.jobs || []);
  const jobs = (source.jobs || []).map((job) => {
    const riskLevel = inferRiskLevel(job);
    const status = inferStatus(job);
    const materials = materialMap.get(job.id) || null;
    return {
      ...job,
      ...status,
      category: inferCategory(job),
      riskLevel,
      riskLabel: riskLabel(riskLevel),
      materialStatus: materialStatus(materials),
      materials
    };
  });

  const counts = {
    total: jobs.length,
    active: jobs.filter((job) => job.status === "active").length,
    closing: jobs.filter((job) => job.status === "closing").length,
    expired: jobs.filter((job) => job.status === "expired").length,
    highMatch: jobs.filter((job) => Number(job.matchScore || 0) >= 4).length,
    lowRisk: jobs.filter((job) => job.riskLevel === "low").length,
    verifiableRisk: jobs.filter((job) => job.riskLevel === "medium").length,
    highRisk: jobs.filter((job) => job.riskLevel === "high").length,
    withMaterials: jobs.filter((job) => job.materialStatus.state !== "missing").length
  };

  const payload = {
    version: "2.0",
    lastUpdated: AUDIT_DATE,
    generatedAt: now.timestamp,
    auditDate: AUDIT_DATE,
    source: SOURCE_PATH,
    publicUrl: "https://changhangliu630-blip.github.io/intl-jobs/foreign-jobs/",
    counts,
    highlights: buildHighlights(jobs),
    jobs
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, output: OUTPUT_PATH, counts }, null, 2));
}

build();
