(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const COLORS = { black:"#050505", green:"#00a651", white:"#f3f6f2" };
  const ROT = [
    { bg:"black", fg:"green", btn:"white", ink:"light" },
    { bg:"green", fg:"black", btn:"white", ink:"dark" },
    { bg:"white", fg:"black", btn:"green", ink:"dark" },
  ];

  const state = {
    build:"dev",
    clicks:0,
    worlds:null,
    canonId:null,
    worldId:null,
    dayNo:null,
    cursor:0,
    chunkStack:[],
    drift:0,
    buffer:[],
    markov:null,
    corpus:null,
    scrollTopNext:false,
    roleMenu:false,
    roleOptions:[],
    speakerIndex:null,
    ghostLines:[],
    ghostLine:"",
    scrollMode:false,
    scrollSnapshot:null,
  };

  const TOK_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?|[.,!?;:()]/g;
  const safeText = (x) => (x ?? "").toString();
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const escapeHTML = (s) => safeText(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const shorten = (s, n=28) => {
    const t = safeText(s);
    return t.length > n ? `${t.slice(0, n-1).trim()}…` : t;
  };
  const normalizeWS = (s) => safeText(s).replace(/\s+/g, " ").trim();
  const formatInline = (s) => {
    const esc = escapeHTML(s);
    const italA = esc.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    return italA.replace(/(^|[^\\w])_([^_\\n]+)_(?=[^\\w]|$)/g, "$1<em>$2</em>");
  };

  function tokenize(s){ return (safeText(s).match(TOK_RE) || []); }
  function detok(tokens){
    let out = "";
    for(const t of tokens){
      if(/[.,!?;:)]/.test(t)) out = out.replace(/\s+$/,"") + t + " ";
      else if(t === "(") out += "(";
      else out += t + " ";
    }
    return out.trim().replace(/\s+\)/g,")");
  }
  function buildMarkov(lines){
    const next = new Map(); const starts = [];
    for(const ln of lines){
      const toks = tokenize(ln);
      if(toks.length < 2) continue;
      starts.push(toks[0]);
      for(let i=0;i<toks.length-1;i++){
        const k=toks[i], v=toks[i+1];
        if(!next.has(k)) next.set(k, []);
        next.get(k).push(v);
      }
    }
    return { next, starts };
  }
  function generate(chain, seedText, maxTokens){
    if(!chain || !chain.starts.length) return "";
    const seed = tokenize(seedText);
    let w = seed.length ? seed[seed.length-1] : chain.starts[Math.floor(Math.random()*chain.starts.length)];
    const out = [w];
    for(let i=0;i<maxTokens-1;i++){
      const arr = chain.next.get(w);
      if(!arr || !arr.length){
        w = chain.starts[Math.floor(Math.random()*chain.starts.length)];
        out.push(w);
        continue;
      }
      w = arr[Math.floor(Math.random()*arr.length)];
      out.push(w);
    }
    return detok(out);
  }

  function classifyLine(t){
    const s = safeText(t).trim();
    if(!s) return { kind:"empty", spk:"", txt:"" };
    const m = s.match(/^([^:]{2,60}):\s*(.*)$/);
    if(m) return { kind:"speaker", spk:m[1].trim(), txt:m[2] };
    if(s.startsWith("(") && s.endsWith(")")) return { kind:"stage", spk:"", txt:s };
    return { kind:"text", spk:"", txt:s };
  }

  async function fetchJSON(path){
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}v=${encodeURIComponent(state.build)}`;
    const r = await fetch(url, { cache:"no-store" });
    if(!r.ok) throw new Error(`Fetch failed ${path}: ${r.status}`);
    return await r.json();
  }
  async function bootBuildStamp(){
    try{ const b = await fetch("data/build.json",{cache:"no-store"}).then(r=>r.json()); state.build=b.build||"dev"; }
    catch{ state.build="dev"; }
  }

  function playableWorlds(){
    const worlds = state.worlds?.worlds || [];
    return worlds.filter(w => (w.days || []).length);
  }
  function getWorldById(id){
    const worlds = state.worlds?.worlds || [];
    const found = worlds.find(w => w.id === id) || null;
    if(found && (found.days || []).length) return found;
    const playable = playableWorlds();
    if(playable.length) return playable[0];
    return found || worlds[0] || null;
  }
  function ensurePlayableWorld(){
    const playable = playableWorlds();
    if(!playable.length) return null;
    const current = playable.find(w => w.id === state.worldId);
    if(current) return current;
    const fallback = playable.find(w => w.id === state.canonId) || playable[0];
    state.worldId = fallback.id;
    return fallback;
  }
  function allDayNos(world){
    const days = world?.days || [];
    const set = new Set(days.map(d => d.day).filter(n => Number.isFinite(n)));
    return Array.from(set).sort((a,b)=>a-b);
  }
  function getDay(world, dayNo){
    if(!world) return null;
    const days = world.days || [];
    return days.find(d => d.day === dayNo) || days[0] || null;
  }

  function markovSeed(){
    const world = getWorldById(state.worldId);
    const day = getDay(world, state.dayNo);
    const blocks = day?.blocks || [];
    return blocks[Math.max(0, Math.min(blocks.length-1, state.cursor-1))] || blocks[0] || "";
  }
  function markovEcho(seed){
    if(!state.markov) return;
    const base = seed || markovSeed() || (state.buffer[state.buffer.length-1]?.text || "");
    const g = generate(state.markov, base, 22);
    if(g) state.buffer.push({ text: g, hackled:true, echo:true });
  }

  function morph(){ document.body.classList.add("morph"); setTimeout(()=>document.body.classList.remove("morph"),160); }
  function applyRotation(){
    const r = ROT[state.clicks % ROT.length];
    const bg = COLORS[r.bg], fg = COLORS[r.fg], btnbg = COLORS[r.btn];
    const btnfg = (r.btn === "black") ? COLORS.white : COLORS.black;
    const shadow = (r.fg === "black") ? "0 0 10px rgba(5,5,5,.35)" : "0 0 12px rgba(0,166,81,.35)";
    document.documentElement.style.setProperty("--bg", bg);
    document.documentElement.style.setProperty("--fg", fg);
    document.documentElement.style.setProperty("--btnbg", btnbg);
    document.documentElement.style.setProperty("--btnfg", btnfg);
    document.documentElement.style.setProperty("--shadow", shadow);
    const border = (r.bg === "white") ? "rgba(5,5,5,.20)" : "rgba(243,246,242,.18)";
    document.documentElement.style.setProperty("--border", border);
    document.body.dataset.ink = r.ink;
  }
  function click(){
    state.clicks++;
    morph();
    applyRotation();
  }

  function persist(){
    try{
      localStorage.setItem("ki_portal_state", JSON.stringify({
        clicks: state.clicks, worldId: state.worldId, dayNo: state.dayNo, cursor: state.cursor,
        drift: state.drift, buffer: state.buffer.slice(-260),
      }));
    }catch{}
  }
  function restore(){
    try{
      const raw = localStorage.getItem("ki_portal_state"); if(!raw) return;
      const o = JSON.parse(raw);
      if(typeof o.clicks==="number") state.clicks=o.clicks;
      if(typeof o.worldId==="string") state.worldId=o.worldId;
      if(typeof o.dayNo==="number") state.dayNo=o.dayNo;
      if(typeof o.cursor==="number") state.cursor=o.cursor;
      if(typeof o.drift==="number") state.drift=o.drift;
      if(Array.isArray(o.buffer)) state.buffer=o.buffer;
    }catch{}
  }

  function setHUD(world, day){
    const d = day ? `DAY ${day.day}` : "DAY ?";
    const drift = `DRIFT ${Math.round(state.drift*100)}%`;
    $("#state").textContent = `${d} // ${drift}`;
  }

  function renderBuffer(){
    const wrap = $("#buffer");
    const html = [];
    const items = state.scrollMode ? state.buffer : state.buffer.slice(-260);
    for(const item of items){
      const c = classifyLine(item.text);
      if(c.kind === "empty") continue;
      const cls = ["line"];
      if(c.kind === "stage") cls.push("stage");
      if(item.hackled) cls.push("hackled");
      if(c.kind === "speaker"){
        html.push(`<p class="${cls.join(" ")}"><span class="spk" data-spk="${escapeHTML(c.spk)}">${escapeHTML(c.spk)}:</span> ${formatInline(c.txt)}</p>`);
      } else {
        html.push(`<p class="${cls.join(" ")}">${formatInline(c.txt)}</p>`);
      }
    }
    wrap.innerHTML = html.join("\n");
    if(state.scrollTopNext){
      wrap.scrollTop = 0;
      state.scrollTopNext = false;
    } else {
      wrap.scrollTop = wrap.scrollHeight;
    }
  }

  function renderGhost(){
    const box = $("#ghost-text");
    if(!box) return;
    box.textContent = state.ghostLine || "";
  }

  function setQuestion(text){ $("#q").textContent = `> ${text}`; }
  function setChoices(btns){
    const wrap = $("#choices"); wrap.innerHTML = "";
    for(const b of btns){
      const el = document.createElement("div");
      el.className = "choice"; el.textContent = b.label; el.onclick = b.onClick;
      wrap.appendChild(el);
    }
  }

  function enterScrollMode(){
    const world = getWorldById(state.worldId);
    const day = getDay(world, state.dayNo);
    if(!world || !day) return;
    if(!state.scrollMode){
      state.scrollSnapshot = {
        cursor: state.cursor,
        buffer: state.buffer.slice(),
        chunkStack: state.chunkStack.slice(),
      };
    }
    state.scrollMode = true;
    state.buffer = [{ text:`(DAY ${day.day} — FULL SCROLL)`, hackled:false }]
      .concat((day.blocks || []).map(b => ({ text: b, hackled:false })));
    state.scrollTopNext = true;
  }

  function exitScrollMode(){
    if(state.scrollSnapshot){
      state.cursor = state.scrollSnapshot.cursor;
      state.buffer = state.scrollSnapshot.buffer;
      state.chunkStack = state.scrollSnapshot.chunkStack;
    }
    state.scrollSnapshot = null;
    state.scrollMode = false;
    state.scrollTopNext = true;
  }

  function buildSpeakerIndex(){
    const worlds = state.worlds?.worlds || [];
    const map = new Map();
    for(const w of worlds){
      for(const d of (w.days || [])){
        const blocks = d.blocks || [];
        for(let i=0;i<blocks.length;i++){
          const raw = safeText(blocks[i] || "").trim();
          if(!raw) continue;
          const c = classifyLine(raw);
          if(c.kind !== "speaker") continue;
          const name = c.spk;
          if(!map.has(name)) map.set(name, []);
          map.get(name).push({ worldId: w.id, dayNo: d.day, idx: i, line: raw });
        }
      }
    }
    const names = Array.from(map.keys()).filter(n => n.length <= 36);
    return { map, names };
  }

  function randomSpeakers(count=6){
    const names = state.speakerIndex?.names || [];
    if(!names.length) return [];
    const pool = names.slice();
    for(let i=pool.length-1;i>0;i--){
      const j = Math.floor(Math.random() * (i+1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.min(count, pool.length));
  }

  function openRoleMenu(){
    state.roleOptions = randomSpeakers(6);
    state.roleMenu = true;
  }

  function jumpToSpeaker(name){
    const hits = state.speakerIndex?.map.get(name);
    if(!hits || !hits.length) return;
    const hit = hits[Math.floor(Math.random()*hits.length)];
    state.worldId = hit.worldId;
    state.dayNo = hit.dayNo;
    state.cursor = Math.max(0, hit.idx + 1);
    state.scrollMode = false;
    state.scrollSnapshot = null;
    state.buffer = [
      { text:`(${name} corridor opens)`, hackled:false },
      { text: hit.line, hackled:false },
    ];
    if(!state.scrollMode){
      state.chunkStack.push({ cursorStart: state.cursor, cursorEnd: state.cursor, lines: state.buffer.slice(), hackle:false });
    }
    state.scrollTopNext = true;
    state.roleMenu = false;
  }

  function ghostMaybe(){
    const lines = state.ghostLines || [];
    if(!lines.length) return;
    if(Math.random() < 0.10){
      const line = normalizeWS(lines[Math.floor(Math.random()*lines.length)]);
      if(line) state.ghostLine = line;
    }
  }

  function act(fn, { append=false, echo=true } = {}){
    click();
    if(typeof fn === "function") fn();
    if(echo && !append) markovEcho();
    ghostMaybe();
    render();
    persist();
  }

  function lockKeyboard(){
    const stop = (e) => { e.preventDefault(); };
    document.addEventListener("keydown", stop, { passive:false });
    document.addEventListener("keypress", stop, { passive:false });
    document.addEventListener("keyup", stop, { passive:false });
  }

  function driftMaybe(){
    if(state.drift < 0.55) return false;
    const p = 0.12 + state.drift * 0.28;
    return Math.random() < p;
  }
  function appendWormhole({ hackle=false } = {}){
    const worlds = playableWorlds();
    if(!worlds.length) return false;
    const cur = state.worldId;
    let w = worlds[Math.floor(Math.random()*worlds.length)];
    if(w.id === cur && worlds.length > 1){
      w = worlds[(worlds.indexOf(w)+1) % worlds.length];
    }
    const days = w.days || [];
    if(!days.length) return false;
    const day = days[Math.floor(Math.random()*days.length)];
    const blocks = day.blocks || [];
    if(!blocks.length) return false;

    const span = Math.min(blocks.length, Math.floor(Math.random() * 8) + 6);
    const start = Math.floor(Math.random() * Math.max(1, blocks.length - span));
    const end = Math.min(blocks.length, start + span);
    const seed = blocks[start] || "";
    const hasMarkov = !!state.markov;

    const addedLines = [{ text:"(wormhole splice)", hackled:false }];

    for(let i=start;i<end;i++){
      const raw = safeText(blocks[i] || "");
      if(!raw.trim()) continue;
      const replace = hasMarkov && (hackle || Math.random() < 0.24);
      if(replace){
        const c = classifyLine(raw);
        if(c.kind === "speaker"){
          const g = generate(state.markov, c.txt || seed, 28);
          addedLines.push({ text: `${c.spk}: ${g || c.txt}`, hackled:true });
        } else {
          const g = generate(state.markov, raw || seed, 28);
          addedLines.push({ text: g || raw, hackled:true });
        }
      } else {
        addedLines.push({ text: raw, hackled:false });
      }
    }

    if(state.scrollMode){
      state.buffer = state.buffer.concat(addedLines);
    } else {
      state.buffer = addedLines.slice();
      state.chunkStack.push({ cursorStart: state.cursor, cursorEnd: state.cursor, lines: addedLines.slice(), hackle: !!hackle });
    }
    state.scrollTopNext = true;
    state.drift = clamp01(state.drift + (hackle ? 0.16 : 0.08));
    return true;
  }

  function gotoDay(delta){
    const world = getWorldById(state.worldId);
    const days = allDayNos(world);
    if(!days.length){ state.dayNo=1; state.cursor=0; state.buffer=[]; return; }
    const idx = Math.max(0, days.indexOf(state.dayNo));
    state.dayNo = days[(idx + delta + days.length) % days.length];
    state.cursor = 0;
    state.buffer = [{ text:`(entering Day ${state.dayNo})`, hackled:false }];
    state.chunkStack = [];
    state.scrollTopNext = true;
    if(state.scrollMode) enterScrollMode();
    if(delta > 0) state.drift = clamp01(state.drift * 0.92);
    else state.drift = clamp01(state.drift + 0.08);
  }

  function appendChunk({ hackle=false, pulse=false }){
    const world = getWorldById(state.worldId);
    const day = getDay(world, state.dayNo);
    if(!world || !day){
      const repaired = ensurePlayableWorld();
      if(repaired){
        const days = allDayNos(repaired);
        state.dayNo = days[0] || 1;
      }
      state.buffer.push({ text:"(data link lost)", hackled:false });
      state.scrollTopNext = true;
      return;
    }
    const blocks = day.blocks || [];
    if(state.cursor >= blocks.length){
      state.buffer.push({ text:`(end of Day ${day.day})`, hackled:false }); return;
    }

    const step = 14;
    const start = state.cursor;
    let i = start;
    let addedCount = 0;
    let addedLines = [];
    const findSeed = (idx) => {
      for(let j=Math.min(idx, blocks.length-1); j>=0; j--){
        const raw = safeText(blocks[j] || "").trim();
        if(raw) return raw;
      }
      return blocks[idx] || "";
    };
    const seed = findSeed(start);
    const hasMarkov = !!state.markov;
    const pulseIdx = pulse ? Math.floor(Math.random() * step) : -1;
    let pulseArmed = pulse;

    while(i < blocks.length && addedCount < step){
      const raw = safeText(blocks[i] || "");
      i++;
      if(!raw.trim()) continue;

      const pulseHit = pulseArmed && addedCount >= pulseIdx;
      if(hackle || pulseHit){
        const c = classifyLine(raw);
        const replace = hasMarkov && (pulseHit || Math.random() < 0.32);
        if(c.kind === "speaker" && replace){
          const g = generate(state.markov, c.txt || seed, 34);
          addedLines.push({ text: `${c.spk}: ${g || c.txt}`, hackled:true });
        } else if(replace){
          const g = generate(state.markov, raw || seed, 34);
          addedLines.push({ text: g || raw, hackled:true });
        } else {
          addedLines.push({ text: raw, hackled:false });
        }
        if(pulseHit) pulseArmed = false;
      } else {
        addedLines.push({ text: raw, hackled:false });
      }
      addedCount++;
    }

    state.cursor = i;
    if(addedLines.length === 0){
      addedLines.push({ text:"(silence)", hackled:false });
    }

    if(state.scrollMode){
      state.buffer = state.buffer.concat(addedLines);
    } else {
      state.buffer = addedLines.slice();
    }
    state.scrollTopNext = true;
    if(!state.scrollMode && addedLines.length){
      state.chunkStack.push({ cursorStart:start, cursorEnd:i, lines: addedLines.slice(), hackle:!!hackle });
    }
    if(pulseArmed && hasMarkov) markovEcho(seed);
    if(hackle) state.drift = clamp01(state.drift + 0.10);
    else state.drift = clamp01(state.drift * 0.985 + 0.01);

    if(driftMaybe()) appendWormhole({ hackle: Math.random() < 0.45 });
  }

  function rewindChunk(){
    if(state.scrollMode) return false;
    if(state.chunkStack.length <= 1) return false;
    state.chunkStack.pop();
    const prev = state.chunkStack[state.chunkStack.length - 1];
    if(!prev) return false;
    state.buffer = prev.lines.slice();
    state.cursor = prev.cursorEnd;
    state.drift = clamp01(state.drift * 0.96);
    state.scrollTopNext = true;
    return true;
  }

  function render(){
    const world = getWorldById(state.worldId);
    const day = getDay(world, state.dayNo);
    applyRotation();

    setHUD(world, day);
    renderBuffer();
    renderGhost();

    if(state.scrollMode){
      setQuestion(`SCROLL MODE.`);
      setChoices([
        { label:"Exit Scroll", onClick: () => act(() => exitScrollMode(), { echo:false }) },
        { label:"Next Day", onClick: () => act(() => gotoDay(+1), { echo:false }) },
        { label:"Prev Day", onClick: () => act(() => gotoDay(-1), { echo:false }) },
        { label:"Role Gate", onClick: () => act(() => openRoleMenu(), { echo:false }) },
      ]);
      return;
    }

    if(state.roleMenu){
      setQuestion("ROLE GATE: SELECT CHARACTER.");
      const btns = state.roleOptions.map(name => ({
        label: shorten(name.toUpperCase()),
        onClick: () => act(() => jumpToSpeaker(name), { echo:false }),
      }));
      btns.push({
        label: "MORE NAMES",
        onClick: () => act(() => { state.roleOptions = randomSpeakers(6); }, { echo:false }),
      });
      btns.push({
        label: "EXIT",
        onClick: () => act(() => { state.roleMenu = false; }, { echo:false }),
      });
      setChoices(btns);
      return;
    }

    if(!world || !day){
      const repaired = ensurePlayableWorld();
      if(repaired && (repaired.days || []).length){
        const days = allDayNos(repaired);
        state.dayNo = days[0] || 1;
        state.cursor = 0;
        state.buffer = [{ text:`(relinking Day ${state.dayNo})`, hackled:false }];
        state.chunkStack = [];
        state.scrollTopNext = true;
        render();
        persist();
        return;
      }
      setQuestion("DATA LINK LOST.");
      setChoices([
        { label:"Reload", onClick: () => { click(); location.reload(); } },
        { label:"Wormhole", onClick: () => act(() => appendWormhole({ hackle:false })) },
        { label:"Continue", onClick: () => act(() => appendChunk({hackle:false, pulse:true}), { append:true }) },
      ]);
      return;
    }

    const atEnd = state.cursor >= (day.blocks || []).length;
    if(!state.buffer.length){
      state.buffer.push({ text:`(entering Day ${day.day})`, hackled:false });
    }

    if(atEnd){
      setQuestion(`DAY ${day.day} END. CHOOSE VECTOR.`);
      setChoices([
        { label:"Next day", onClick: () => act(() => gotoDay(+1)) },
        { label:"Loop back", onClick: () => act(() => gotoDay(-1)) },
        { label:"Back a page", onClick: () => act(() => { if(!rewindChunk()) gotoDay(-1); }) },
        { label:"Role Gate", onClick: () => act(() => openRoleMenu(), { echo:false }) },
        { label:"Drift / Wormhole", onClick: () => act(() => appendWormhole({ hackle:false })) },
        { label:"Hackle the return", onClick: () => act(() => { if(!rewindChunk()) gotoDay(-1); appendChunk({hackle:true, pulse:true}); }, { append:true }) },
        { label:"Scroll Day", onClick: () => act(() => enterScrollMode(), { echo:false }) },
      ]);
      return;
    }

    setQuestion(`CHOOSE A VECTOR. HACKLE = MARKOV.`);
    setChoices([
      { label:"Continue", onClick: () => act(() => appendChunk({hackle:false, pulse:true}), { append:true }) },
      { label:"Back a page", onClick: () => act(() => { if(!rewindChunk()) gotoDay(-1); }) },
      { label:"Hackle", onClick: () => act(() => appendChunk({hackle:true, pulse:true}), { append:true }) },
      { label:"Role Gate", onClick: () => act(() => openRoleMenu(), { echo:false }) },
      { label:"Drift / Wormhole", onClick: () => act(() => appendWormhole({ hackle: Math.random() < 0.35 })) },
      { label:"Scroll Day", onClick: () => act(() => enterScrollMode(), { echo:false }) },
    ]);
  }

  async function boot(){
    lockKeyboard();
    const buf = $("#buffer");
    if(buf){
      buf.addEventListener("click", (e) => {
        const el = e.target.closest(".spk");
        if(!el) return;
        const name = el.getAttribute("data-spk") || el.textContent.replace(/:$/,"");
        if(!name) return;
        click();
        jumpToSpeaker(name);
        render();
        persist();
      });
    }
    await bootBuildStamp();
    state.worlds = await fetchJSON("data/drama_worlds.json");
    state.corpus = await fetchJSON("data/corpus.json").catch(()=>({lines:[]}));
    state.ghostLines = await fetch("data/mostdipf_all.txt", { cache:"no-store" })
      .then(r => r.ok ? r.text() : "")
      .then(t => t.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
      .catch(() => []);

    const worlds = state.worlds?.worlds || [];
    state.canonId = state.worlds?.canonical || (worlds[0]?.id || null);

    restore();

    if(!state.worldId){
      state.worldId = localStorage.getItem("ki_world") || state.canonId || (worlds[0]?.id || null);
    }
    const w = ensurePlayableWorld() || getWorldById(state.worldId);
    localStorage.setItem("ki_world", state.worldId || "");

    const days = allDayNos(w);
    if(!days.length) state.dayNo = 1;
    else if(state.dayNo == null || !days.includes(state.dayNo)) state.dayNo = days[0];

    // Markov mix: corpus lines + canonical drama blocks + mostdipf ghost
    const canon = getWorldById(state.canonId);
    const dramaLines = [];
    (canon?.days || []).forEach(d => (d.blocks||[]).slice(0, 2200).forEach(b => dramaLines.push(b)));

    const ghost = state.ghostLines.slice(0, 3600);
    const mix = (state.corpus.lines || []).slice(0, 3000)
      .concat(dramaLines.slice(0, 2400))
      .concat(ghost);
    state.markov = buildMarkov(mix.length ? mix : dramaLines);
    state.speakerIndex = buildSpeakerIndex();

    if(!state.buffer.length){
      state.buffer = [{ text:`(entering Day ${getDay(w,state.dayNo)?.day || state.dayNo})`, hackled:false }];
      appendChunk({hackle:false, pulse:true});
    }

    render();
    persist();
  }

  boot().catch(err => {
    console.error(err);
    applyRotation();
    $("#state").textContent = "Boot failed.";
    $("#buffer").innerHTML = `<p class="line">${escapeHTML(err.message || String(err))}</p>`;
    setQuestion("Boot failed. Missing JSON or wrong publishing root.");
    setChoices([{ label:"Reload", onClick: () => { click(); location.reload(); } }]);
  });
})();
