export default async function handler(req, res) {
  // CORS（同域部署一般不需要，但加上更稳）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
    if (!apiKey) return res.status(500).json({ ok: false, error: "Missing DEEPSEEK_API_KEY in environment variables" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const action = body?.action;
    const payload = body?.payload || {};

    let messages = [];
    let temperature = 0.5;
    let max_tokens = 900;

    // --- Prompt builders ---
    const sysBase = `你是一个企业级“面试陪练系统”。要求：
- 所有输出必须稳定、可执行、避免空话；
- 需要时使用清晰的项目符号；
- 如果用户提供内容含敏感信息，提醒先脱敏（但不要拒绝）。
`;

    if (action === "parse_jd") {
      const jd = String(payload.jd_text || "").trim();
      if (!jd) return res.status(400).json({ ok: false, error: "jd_text is required" });

      messages = [
        { role: "system", content: sysBase + "你负责把 JD 解析为结构化 JSON。" },
        { role: "user", content:
`请把下面 JD 解析成严格 JSON（不要输出任何多余文字），字段如下：
{
  "job_title": "",
  "job_level": "",
  "core_responsibilities": ["最多6条"],
  "must_have": ["最多8条"],
  "nice_to_have": ["最多6条"],
  "business_scenarios": ["最多6条，尽量具体"],
  "metrics": ["最多6条，尽量量化口径"],
  "interview_focus": ["最多5条，面试重点建议"]
}
JD：
${jd}
`
        }
      ];
      temperature = 0.2;
      max_tokens = 800;
    }

    else if (action === "generate_bank") {
      const jd = String(payload.jd_text || "").trim();
      const profile = payload.jd_profile || null;
      if (!jd) return res.status(400).json({ ok: false, error: "jd_text is required" });

      messages = [
        { role: "system", content: sysBase + "你负责生成题库 JSON（含追问与rubric）。" },
        { role: "user", content:
`基于 JD（以及可选的 jd_profile），生成一份严格 JSON 题库，不要输出任何多余文字。

输出格式（严格遵守）：
{
  "job_title": "",
  "job_level": "",
  "competencies": [{"id":"c1","name":""} ... 至少6个],
  "questions": [
    {
      "id":"q_xx",
      "type":"behavior_star|scenario_case|skill_check|closing_reverse",
      "competency_ids":["c1","c2"],
      "difficulty":1|2|3,
      "prompt":"题目正文",
      "followups":[
        {"trigger":"missing_task|missing_action|missing_result|vague_claim|risk_tradeoff|metric_definition","ask":"追问句"}
      ],
      "rubric":{
        "dimensions":["clarity","structure","evidence","fit","impact"],
        "anchors":{
          "excellent":"一句话描述优秀标准",
          "ok":"一句话描述合格标准",
          "poor":"一句话描述较差标准"
        }
      }
    }
  ]
}

数量要求：
- behavior_star：至少 6 题
- scenario_case：至少 4 题
- skill_check：至少 2 题（可做“数据拆解/汇报口径/指标对齐”类）
- closing_reverse：固定 1 题（训练反问与收尾）

追问要求：
- 每题 followups 3~5 条，必须“可执行、可追细节、可量化”。

输入：
JD：
${jd}

jd_profile（可能为空）：
${JSON.stringify(profile)}
`
        }
      ];
      temperature = 0.35;
      max_tokens = 2200;
    }

    else if (action === "chat") {
      const cfg = payload.session_config || {};
      const q = payload.question || {};
      const userAnswer = String(payload.user_answer || "").trim();
      const historySummary = String(payload.history_summary || "");
      const rubricWeights = payload.rubric_weights || {};

      if (!q?.prompt) return res.status(400).json({ ok: false, error: "question.prompt is required" });
      if (!userAnswer) return res.status(400).json({ ok: false, error: "user_answer is required" });

      const sys = `你是一个“面试陪练系统”，同时扮演两种角色：
1) Interviewer（面试官）：只负责提问/追问，语气取决于 style。
2) Coach（教练）：只负责评价与训练建议，专业、清晰、可执行。

【运行参数】
style=${cfg.style}（friendly 或 pressure）
goal=${cfg.goal}（star / scenario / quant）
difficulty=${cfg.difficulty}（1~3）
反馈策略：每题 micro-feedback（短、硬、可执行）
切换策略：本轮已确定参数，本轮结束后下一题才应用新参数。

【风格约束】
- friendly：语气温和、引导式，可给轻提示，不压迫。
- pressure：句子短、追问尖锐、强调细节与量化，可打断式追问，但禁止人身攻击、禁止羞辱。

【目标约束】
- goal=star：强制检验 STAR 是否齐全；缺哪个就追问哪个。
- goal=scenario：强制检验“约束/取舍/风险/对齐干系人/推进路径”。
- goal=quant：强制检验“数字、口径、对比基线、周期、影响量化”。

【输出格式：必须是严格 JSON，不要输出任何多余文字】
{
  "interviewer_reply": "下一句面试官要说的话（1~2句）",
  "coach_feedback": {
    "total_score": 0-100,
    "subscores": {"clarity":0-100,"structure":0-100,"evidence":0-100,"fit":0-100,"impact":0-100},
    "strength": "一句话指出亮点（必须具体）",
    "improve": "一句话指出最关键的可执行改进点（必须具体）",
    "one_sentence_demo": "给用户一句更好的示范表达（1句，不要超过30字）"
  },
  "next_focus": "star|scenario|quant|clarity|structure|evidence|fit|impact",
  "next_action": "下一题策略建议（不超过15字）"
}
`;

      messages = [
        { role: "system", content: sys },
        { role: "user", content:
`current_question:
${JSON.stringify(q)}

user_answer:
${userAnswer}

history_summary:
${historySummary}

rubric_weights:
${JSON.stringify(rubricWeights)}
`
        }
      ];
      temperature = 0.45;
      max_tokens = 900;
    }

    else {
      return res.status(400).json({ ok: false, error: "Unknown action" });
    }

    // DeepSeek Chat Completions
    // 官方端点：POST https://api.deepseek.com/chat/completions :contentReference[oaicite:5]{index=5}
    const r = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}` // Bearer Auth :contentReference[oaicite:6]{index=6}
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens
      })
    });

    const out = await r.json();
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: out?.error?.message || "DeepSeek API error", detail: out });
    }

    const content = out?.choices?.[0]?.message?.content ?? "";
    // 解析为 JSON（模型可能偶尔夹带多余字符，这里做一次容错）
    const data = parseJsonWithExtraction(content);

    if (!data) {
      // 对 parse_jd / generate_bank / chat 都要求严格 JSON，失败就返回原文便于你调试
      return res.status(200).json({ ok: false, error: "Model output is not valid JSON", raw: content });
    }

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}

// -------- helpers --------
function parseJsonWithExtraction(str) {
  try { return JSON.parse(str); } catch(e) {}
  const a = str.indexOf("{");
  const b = str.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try { return JSON.parse(str.slice(a, b + 1)); } catch(e) {}
  }
  return null;
}
