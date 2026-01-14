/* ==========
  AI 面试陪练：语音条对话版
  - 用户：MediaRecorder 录音 -> 语音条可回听  (MDN: MediaRecorder) :contentReference[oaicite:6]{index=6}
  - ASR：SpeechRecognition 隐形转写（不展示文字）(MDN: SpeechRecognition) :contentReference[oaicite:7]{index=7}
  - NPC：SpeechSynthesis 播放 + 可重听（重新 synth）(MDN: getVoices/voice) :contentReference[oaicite:8]{index=8}
========== */

const $ = (id) => document.getElementById(id);

const state = {
  sessionId: crypto?.randomUUID?.() || String(Date.now()),
  questions: [],
  qPtr: 0,
  history: [], // 仅用于给后端维持上下文（不在 UI 展示文字）
  // recording
  stream: null,
  recorder: null,
  chunks: [],
  recBlobUrl: null,
  // asr
  recognition: null,
  transcriptFinal: "",
  transcriptInterim: "",
  // voices
  voices: [],
  selectedVoiceURI: "",
  // npc last
  lastNpcText: "",
  speaking: false,
};

const ui = {
  btnReset: $("btnReset"),
  btnStart: $("btnStart"),
  btnNext: $("btnNext"),
  qIndex: $("qIndex"),
  status: $("status"),
  currentQ: $("currentQ"),
  qList: $("qList"),
  chatList: $("chatList"),

  jobSelect: $("jobSelect"),
  interviewerType: $("interviewerType"),
  styleSelect: $("styleSelect"),
  goalSelect: $("goalSelect"),
  sceneSelect: $("sceneSelect"),

  ttsMode: $("ttsMode"),
  voicePreset: $("voicePreset"),
  voiceSelect: $("voiceSelect"),
  rate: $("rate"),
  pitch: $("pitch"),

  btnHold: $("btnHold"),
  btnStop: $("btnStop"),
  btnSend: $("btnSend"),
  recDot: $("recDot"),
  recState: $("recState"),
  asrState: $("asrState"),
  debugTranscript: $("debugTranscript"),

  sceneLabel: $("sceneLabel"),
  stageWrap: $("stageWrap"),
  fxCanvas: $("fxCanvas"),

  npcMouth: $("npcMouth"),
  userMouth: $("userMouth"),
  npcWave: $("npcWave"),
  userWave: $("userWave"),
};

// ---------- Scene mood ----------
const SCENE_MAP = {
  interview_room: { label: "面试室", mood: "正式、安静、压迫感适中" },
  meeting_room:  { label: "会议室", mood: "复盘、对齐、追问逻辑" },
  open_office:   { label: "开放办公", mood: "快节奏、干扰多、追问更快" },
  online_call:   { label: "线上面试", mood: "视频通话感、表达更清晰" },
};

function applyScene(sceneKey) {
  const { label } = SCENE_MAP[sceneKey] || SCENE_MAP.interview_room;
  ui.sceneLabel.textContent = label;

  const room = ui.stageWrap.querySelector(".room");
  room.classList.remove("s1","s2","s3","s4");
  const cls = {
    interview_room: "s1",
    meeting_room: "s2",
    open_office: "s3",
    online_call: "s4",
  }[sceneKey] || "s1";
  room.classList.add(cls);

  // 微调背景（用 inline style 做轻量差异）
  const bg = {
    s1: "linear-gradient(180deg, rgba(75,107,255,.10), rgba(123,77,255,.08))",
    s2: "linear-gradient(180deg, rgba(75,107,255,.08), rgba(27,35,55,.06))",
    s3: "linear-gradient(180deg, rgba(255,184,75,.10), rgba(75,107,255,.07))",
    s4: "linear-gradient(180deg, rgba(0,200,255,.10), rgba(123,77,255,.07))",
  }[cls];
  room.style.background = `radial-gradient(900px 300px at 50% 0%, rgba(255,255,255,.95), rgba(246,248,255,.5)), ${bg}`;
}

// ---------- Particles FX ----------
function startFX() {
  const canvas = ui.fxCanvas;
  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  };
  resize();
  window.addEventListener("resize", resize);

  const particles = Array.from({ length: 46 }).map(() => ({
    x: Math.random()*canvas.clientWidth,
    y: Math.random()*canvas.clientHeight,
    r: 1 + Math.random()*2.2,
    vx: (-.3 + Math.random()*.6),
    vy: (-.2 + Math.random()*.4),
    a: .10 + Math.random()*.25
  }));

  function tick() {
    ctx.clearRect(0,0,canvas.clientWidth, canvas.clientHeight);

    // subtle glow
    const g = ctx.createRadialGradient(
      canvas.clientWidth*0.6, canvas.clientHeight*0.2, 10,
      canvas.clientWidth*0.6, canvas.clientHeight*0.2, 240
    );
    g.addColorStop(0, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,canvas.clientWidth, canvas.clientHeight);

    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = canvas.clientWidth+10;
      if (p.x > canvas.clientWidth+10) p.x = -10;
      if (p.y < -10) p.y = canvas.clientHeight+10;
      if (p.y > canvas.clientHeight+10) p.y = -10;

      ctx.beginPath();
      ctx.fillStyle = `rgba(75,107,255,${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
}

// ---------- Voices ----------
function loadVoices() {
  state.voices = window.speechSynthesis?.getVoices?.() || [];
  renderVoices();
}
function guessGender(voice) {
  const name = (voice.name || "").toLowerCase();
  const lang = (voice.lang || "").toLowerCase();
  // 启发式：仅作“偏好”匹配
  const femaleHints = ["female","woman","girl","xiaoxiao","xiaoyi","晓晓","晓伊","女","tingting","meijia","susan","zira"];
  const maleHints   = ["male","man","boy","yunxi","yunyang","云希","云扬","男","david","mark","george"];
  if (femaleHints.some(h => name.includes(h))) return "female";
  if (maleHints.some(h => name.includes(h))) return "male";
  // zh 语音默认 unknown
  if (lang.startsWith("zh")) return "unknown";
  return "unknown";
}
function renderVoices() {
  const sel = ui.voiceSelect;
  sel.innerHTML = "";

  if (!state.voices.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "未发现可用音色（稍后重试/换浏览器）";
    sel.appendChild(opt);
    return;
  }

  // 先按语言排序，中文优先
  const voicesSorted = [...state.voices].sort((a,b) => {
    const az = (a.lang||"").startsWith("zh") ? 0 : 1;
    const bz = (b.lang||"").startsWith("zh") ? 0 : 1;
    if (az !== bz) return az - bz;
    return (a.name||"").localeCompare(b.name||"");
  });

  for (const v of voicesSorted) {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    const g = guessGender(v);
    opt.textContent = `${v.name}  · ${v.lang}${g !== "unknown" ? ` · ${g}` : ""}`;
    sel.appendChild(opt);
  }

  // 保持之前选择
  if (state.selectedVoiceURI) sel.value = state.selectedVoiceURI;
  else sel.value = voicesSorted[0].voiceURI;
  state.selectedVoiceURI = sel.value;
}

function pickVoiceByPreset() {
  const preset = ui.voicePreset.value; // auto/male/female
  if (!state.voices.length) return;

  if (preset === "auto") return;

  const candidates = state.voices.filter(v => guessGender(v) === preset);
  if (candidates.length) {
    // 中文优先
    const best = candidates.sort((a,b) => {
      const az = (a.lang||"").startsWith("zh") ? 0 : 1;
      const bz = (b.lang||"").startsWith("zh") ? 0 : 1;
      if (az !== bz) return az - bz;
      return (a.name||"").localeCompare(b.name||"");
    })[0];
    state.selectedVoiceURI = best.voiceURI;
    ui.voiceSelect.value = best.voiceURI;
  }
}

// ---------- Speech Synthesis ----------
function setNpcSpeaking(on) {
  ui.npcMouth.classList.toggle("talk", on);
  ui.npcWave.classList.toggle("on", on);
}
function setUserSpeaking(on) {
  ui.userMouth.classList.toggle("talk", on);
  ui.userWave.classList.toggle("on", on);
}

function speakNPC(text) {
  state.lastNpcText = text || "";
  if (ui.ttsMode.value !== "on") return;

  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = parseFloat(ui.rate.value || "1");
  utter.pitch = parseFloat(ui.pitch.value || "1");

  const v = state.voices.find(x => x.voiceURI === state.selectedVoiceURI);
  if (v) utter.voice = v;

  utter.onstart = () => setNpcSpeaking(true);
  utter.onend = () => setNpcSpeaking(false);
  utter.onerror = () => setNpcSpeaking(false);

  window.speechSynthesis.speak(utter);
}

// ---------- ASR (SpeechRecognition) ----------
function setupASR() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    state.recognition = null;
    return;
  }
  const rec = new SR();
  rec.lang = "zh-CN";
  rec.interimResults = true;
  rec.continuous = true;

  rec.onstart = () => ui.asrState.textContent = "识别中…";
  rec.onend = () => {
    // onend 可能在 stop 后触发
    if (ui.asrState.textContent !== "待机") ui.asrState.textContent = "结束";
  };
  rec.onerror = (e) => {
    ui.asrState.textContent = `错误：${e.error || "unknown"}`;
  };
  rec.onresult = (event) => {
    let interim = "";
    let finalTxt = state.transcriptFinal;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      const txt = r[0]?.transcript || "";
      if (r.isFinal) finalTxt += txt;
      else interim += txt;
    }
    state.transcriptFinal = finalTxt.trim();
    state.transcriptInterim = interim.trim();

    ui.debugTranscript.textContent =
      `FINAL:\n${state.transcriptFinal}\n\nINTERIM:\n${state.transcriptInterim}`;
  };

  state.recognition = rec;
}

// ---------- Recorder ----------
async function ensureMic() {
  if (state.stream) return state.stream;
  state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return state.stream;
}

function startRecording() {
  state.chunks = [];
  state.recBlobUrl = null;
  state.transcriptFinal = "";
  state.transcriptInterim = "";

  ui.btnSend.disabled = true;
  ui.btnStop.disabled = false;
  ui.recDot.classList.add("on");
  ui.recState.textContent = "录音中…";
  ui.asrState.textContent = "待机";

  setUserSpeaking(true);

  ensureMic().then((stream) => {
    const mr = new MediaRecorder(stream);
    state.recorder = mr;

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) state.chunks.push(e.data);
    };
    mr.onstop = () => {
      setUserSpeaking(false);
      ui.recDot.classList.remove("on");
      ui.recState.textContent = "已停止（可发送）";

      const blob = new Blob(state.chunks, { type: mr.mimeType || "audio/webm" });
      state.recBlobUrl = URL.createObjectURL(blob);

      // UI：加入“你”的语音条（可回听）
      appendAudioBubble({
        who: "you",
        label: "你",
        audioUrl: state.recBlobUrl,
        canReplay: false,
      });

      // ASR 结果（不展示，只用于 AI；这里允许发送）
      ui.btnSend.disabled = false;
    };

    mr.start();
    ui.asrState.textContent = "待机";

    // 同时启动隐形 ASR（如果可用）
    if (state.recognition) {
      try { state.recognition.start(); } catch {}
    }
  }).catch((err) => {
    setUserSpeaking(false);
    ui.recDot.classList.remove("on");
    ui.recState.textContent = "麦克风不可用";
    ui.asrState.textContent = "不可用";
    alert("无法获取麦克风权限或设备不可用：" + err.message);
  });
}

function stopRecording() {
  ui.btnStop.disabled = true;

  // stop recorder
  if (state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  }

  // stop ASR
  if (state.recognition) {
    try { state.recognition.stop(); } catch {}
  }

  ui.asrState.textContent = "结束";
}

function appendAudioBubble({ who, label, audioUrl, canReplay, onReplay }) {
  const wrap = document.createElement("div");
  wrap.className = `bubble ${who === "you" ? "you" : "npc"}`;

  const chip = document.createElement("div");
  chip.className = "chip";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = label;

  const row = document.createElement("div");
  row.className = "audioRow";

  if (audioUrl) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = audioUrl;
    row.appendChild(audio);
  } else {
    // NPC：没有音频文件（使用 TTS 播放），这里用“重听”按钮代替
    const placeholder = document.createElement("div");
    placeholder.style.fontSize = "12px";
    placeholder.style.color = "rgba(27,35,55,.65)";
    placeholder.textContent = "（TTS 播放）";
    row.appendChild(placeholder);
  }

  if (canReplay) {
    const btn = document.createElement("button");
    btn.className = "smallBtn";
    btn.textContent = "重听";
    btn.onclick = () => onReplay && onReplay();
    row.appendChild(btn);
  }

  chip.appendChild(meta);
  chip.appendChild(row);
  wrap.appendChild(chip);

  ui.chatList.appendChild(wrap);
  ui.chatList.scrollTop = ui.chatList.scrollHeight;
}

// ---------- Interview flow ----------
function updateQuestionUI() {
  const total = state.questions.length;
  const idx = state.qPtr + 1;
  ui.qIndex.textContent = total ? `${idx} / ${total}` : "- / -";
  ui.currentQ.textContent = total ? state.questions[state.qPtr] : "尚未开始";

  ui.qList.innerHTML = "";
  state.questions.forEach((q, i) => {
    const pill = document.createElement("div");
    pill.className = "qPill" + (i === state.qPtr ? " active" : "");
    pill.textContent = `Q${i+1}`;
    ui.qList.appendChild(pill);
  });
}

async function startSession() {
  ui.status.textContent = "生成题目中…";
  const payload = buildMeta();

  // 让后端生成 3-5 题
  const res = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "generate_questions",
      meta: payload,
      sessionId: state.sessionId,
    }),
  });

  if (!res.ok) {
    ui.status.textContent = "生成失败";
    alert("生成题目失败，请检查 /api/coach 和环境变量。");
    return;
  }

  const data = await res.json();
  state.questions = data.questions || [];
  state.qPtr = 0;
  state.history = data.history || []; // system + 开场
  ui.status.textContent = "已开始";

  updateQuestionUI();

  // 让 NPC 问第一题（语音条 + TTS）
  const first = state.questions[state.qPtr] || "请先做一个 1 分钟自我介绍。";
  await npcAsk(first);
}

async function npcAsk(questionText) {
  // 历史里保留文字（但 UI 不显示）
  state.history.push({ role: "assistant", content: questionText });

  // UI：NPC 语音条（TTS 重听）
  appendAudioBubble({
    who: "npc",
    label: "面试官",
    audioUrl: null,
    canReplay: true,
    onReplay: () => speakNPC(state.lastNpcText || questionText),
  });

  speakNPC(questionText);
}

async function nextQuestion() {
  if (!state.questions.length) return;

  if (state.qPtr < state.questions.length - 1) {
    state.qPtr += 1;
  } else {
    ui.status.textContent = "已完成";
    await npcAsk("本轮 3-5 题已完成。你想再加一题，还是我给你做一个整体点评？");
    return;
  }

  updateQuestionUI();
  await npcAsk(state.questions[state.qPtr]);
}

function buildMeta() {
  const sceneKey = ui.sceneSelect.value;
  const scene = SCENE_MAP[sceneKey] || SCENE_MAP.interview_room;

  return {
    job: ui.jobSelect.value,
    interviewerType: ui.interviewerType.value,
    style: ui.styleSelect.value,
    goal: ui.goalSelect.value,
    sceneKey,
    sceneLabel: scene.label,
    sceneMood: scene.mood,
  };
}

async function sendAnswer() {
  ui.status.textContent = "分析中…";

  // 如果 ASR 不可用：用一句话概括（否则 AI 没法追问）
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let transcript = (state.transcriptFinal || state.transcriptInterim || "").trim();

  if (!SR || !transcript) {
    transcript = prompt("当前浏览器/本次未识别到文本。为保证 AI 能追问，请用一句话概括你刚才的回答：") || "";
    transcript = transcript.trim();
  }

  // 历史里记录用户文本（仅后台使用）
  state.history.push({ role: "user", content: transcript });

  // 请求后端：追问/点评/是否进入下一题
  const res = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "coach_turn",
      meta: buildMeta(),
      sessionId: state.sessionId,
      qIndex: state.qPtr,
      total: state.questions.length,
      currentQuestion: state.questions[state.qPtr],
      history: state.history,
    }),
  });

  if (!res.ok) {
    ui.status.textContent = "失败";
    alert("AI 响应失败，请检查 /api/coach 日志与 DEEPSEEK_API_KEY。");
    return;
  }

  const data = await res.json();
  const npcText = (data.reply || "").trim();
  const move = data.move || "stay"; // stay / next / end

  // 记录 assistant 文本到 history
  state.history.push({ role: "assistant", content: npcText });

  // UI：NPC 语音条（可重听）
  appendAudioBubble({
    who: "npc",
    label: "面试官",
    audioUrl: null,
    canReplay: true,
    onReplay: () => speakNPC(state.lastNpcText || npcText),
  });

  speakNPC(npcText);

  ui.status.textContent = "进行中";
  ui.btnSend.disabled = true; // 等下一次录音

  // 自动推进
  if (move === "next") {
    setTimeout(() => nextQuestion(), 600);
  } else if (move === "end") {
    ui.status.textContent = "已完成";
  }
}

// ---------- Reset ----------
function resetAll() {
  // stop speech
  try { window.speechSynthesis?.cancel?.(); } catch {}
  // stop recorder
  try {
    if (state.recorder && state.recorder.state !== "inactive") state.recorder.stop();
  } catch {}
  // stop asr
  try { state.recognition?.stop?.(); } catch {}

  state.questions = [];
  state.qPtr = 0;
  state.history = [];
  state.transcriptFinal = "";
  state.transcriptInterim = "";
  state.lastNpcText = "";

  ui.chatList.innerHTML = "";
  ui.currentQ.textContent = "尚未开始";
  ui.qList.innerHTML = "";
  ui.qIndex.textContent = "- / -";
  ui.status.textContent = "未开始";
  ui.recState.textContent = "未录音";
  ui.asrState.textContent = "待机";
  ui.btnSend.disabled = true;
  ui.btnStop.disabled = true;
}

// ---------- Events ----------
function bindEvents() {
  ui.sceneSelect.addEventListener("change", () => applyScene(ui.sceneSelect.value));

  ui.voiceSelect.addEventListener("change", () => {
    state.selectedVoiceURI = ui.voiceSelect.value;
  });
  ui.voicePreset.addEventListener("change", () => pickVoiceByPreset());

  ui.btnStart.addEventListener("click", startSession);
  ui.btnNext.addEventListener("click", nextQuestion);
  ui.btnReset.addEventListener("click", resetAll);

  // “按住说话”
  ui.btnHold.addEventListener("mousedown", () => {
    ui.btnHold.disabled = true;
    startRecording();
  });
  ui.btnHold.addEventListener("mouseup", () => {
    ui.btnHold.disabled = false;
    stopRecording();
  });

  // touch support
  ui.btnHold.addEventListener("touchstart", (e) => {
    e.preventDefault();
    ui.btnHold.disabled = true;
    startRecording();
  }, { passive:false });

  ui.btnHold.addEventListener("touchend", (e) => {
    e.preventDefault();
    ui.btnHold.disabled = false;
    stopRecording();
  }, { passive:false });

  ui.btnStop.addEventListener("click", () => {
    ui.btnHold.disabled = false;
    stopRecording();
  });

  ui.btnSend.addEventListener("click", sendAnswer);
}

// ---------- Init ----------
function init() {
  applyScene(ui.sceneSelect.value);
  startFX();

  setupASR();

  // voices: 有些浏览器需异步触发
  loadVoices();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      loadVoices();
      pickVoiceByPreset();
    };
  }

  bindEvents();
  ui.asrState.textContent = state.recognition ? "待机" : "不可用（浏览器不支持）";
}

init();
