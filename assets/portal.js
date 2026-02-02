(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const COLORS = { black:"#050505", green:"#00a651", white:"#f3f6f2" };
  const ROT = [
    { bg:"black", fg:"green", btn:"white", ink:"light" },
    { bg:"green", fg:"black", btn:"white", ink:"dark" },
    { bg:"white", fg:"black", btn:"green", ink:"dark" },
  ];
  const ROLES = ["Delegate","Witness","Archivist","Chair","Ghost","Bot"];

  const state = {
    build:"dev",
    clicks:0,
    worlds:null,
    canonId:null,
    worldId:null,
    dayNo:null,
    cursor:0,
    roleIdx:0,
    drift:0,
    buffer:[],
    markov:null,
    corpus:null,
  };

  const TOK_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?|[.,!?;:()]/g;
  const safeText = (x) => (x ?? "").toString();
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const escapeHTML = (s) => safeText(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

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

  function getWorldById(id){
    const worlds = state.worlds?.worlds || [];
    return worlds.find(w => w.id === id) || worlds[0] || null;
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

  function morph(){ document.body.classList.add("morph"); setTimeout(()=>document.body.classList.remove("morph"),160); }
  function applyRotation(){
    const r = ROT[state.clicks % ROT.length];
    const bg = COLORS[r.bg], fg = COLORS[r.fg], btnbg = COLORS[r.btn];
    const btnfg = (r.btn === "black") ? COLORS.white : COLORS.black;
    document.documentElement.style.setProperty("--bg", bg);
    document.documentElement.style.setProperty("--fg", fg);
    document.documentElement.style.setProperty("--btnbg", btnbg);
    document.documentElement.style.setProperty("--btnfg", btnfg);
    const border = (r.bg === "white") ? "rgba(5,5,5,.20)" : "rgba(243,246,242,.18)";
    document.documentElement.style.setProperty("--border", border);
    document.body.dataset.ink = r.ink;
  }
  function click(){ state.clicks++; morph(); applyRotation(); }

  function persist(){
    try{
      localStorage.setItem("ki_portal_state", JSON.stringify({
        clicks: state.clicks, worldId: state.worldId, dayNo: state.dayNo, cursor: state.cursor,
        roleIdx: state.roleIdx, drift: state.drift, buffer: state.buffer.slice(-260),
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
      if(typeof o.roleIdx==="number") state.roleIdx=o.roleIdx;
      if(typeof o.drift==="number") state.drift=o.drift;
      if(Array.isArray(o.buffer)) state.buffer=o.buffer;
    }catch{}
  }

  function setHUD(world, day){
    const role = ROLES[state.roleIdx % ROLES.length];
    const wname = world ? safeText(world.name || world.id || "world") : "world";
    const d = day ? `Day ${day.day}` : "Day ?";
    const drift = `${Math.round(state.drift*100)}% drift`;
    $("#state").textContent = `${d} · ${role} · ${wname} · ${drift}`;
  }

  function renderBuffer(){
    const wrap = $("#buffer");
    const html = [];
    for(const item of state.buffer.slice(-260)){
      const c = classifyLine(item.text);
      if(c.kind === "empty") continue;
      const cls = ["line"];
      if(c.kind === "stage") cls.push("stage");
      if(item.hackled) cls.push("hackled");
      if(c.kind === "speaker"){
        html.push(`<p class="${cls.join(" ")}"><span class="spk">${escapeHTML(c.spk)}:</span> ${escapeHTML(c.txt)}</p>`);
      } else {
        html.push(`<p class="${cls.join(" ")}">${escapeHTML(c.txt)}</p>`);
      }
    }
    wrap.innerHTML = html.join("\n");
    wrap.scrollTop = wrap.scrollHeight;
  }

  function setQuestion(text){ $("#q").textContent = text; }
  function setChoices(btns){
    const wrap = $("#choices"); wrap.innerHTML = "";
    for(const b of btns){
      const el = document.createElement("div");
      el.className = "choice"; el.textContent = b.label; el.onclick = b.onClick;
      wrap.appendChild(el);
    }
  }

  function driftMaybe(){
    if(state.drift < 0.55) return false;
    const p = 0.08 + state.drift * 0.18;
    return Math.random() < p;
  }

  function driftWorld(keepDay=true){
    const worlds = state.worlds?.worlds || [];
    if(worlds.length < 2) return;
    const cur = state.worldId;
    let w = worlds[Math.floor(Math.random()*worlds.length)];
    if(w.id === cur) w = worlds[(worlds.indexOf(w)+1) % worlds.length];
    state.worldId = w.id;

    const world = getWorldById(state.worldId);
    if(keepDay && world){
      const d = getDay(world, state.dayNo);
      state.dayNo = d ? d.day : (allDayNos(world)[0] || 1);
    } else if(world){
      state.dayNo = allDayNos(world)[0] || 1;
    }

    state.buffer.push({ text:`(worldline drift)`, hackled:false });
    state.cursor = 0;
    state.drift = clamp01(state.drift + 0.12);
  }

  function gotoDay(delta){
    const world = getWorldById(state.worldId);
    const days = allDayNos(world);
    if(!days.length){ state.dayNo=1; state.cursor=0; state.buffer=[]; return; }
    const idx = Math.max(0, days.indexOf(state.dayNo));
    state.dayNo = days[(idx + delta + days.length) % days.length];
    state.cursor = 0;
    state.buffer = [{ text:`(entering Day ${state.dayNo})`, hackled:false }];
    if(delta > 0) state.drift = clamp01(state.drift * 0.92);
    else state.drift = clamp01(state.drift + 0.08);
  }

  function appendChunk({ hackle=false }){
    const world = getWorldById(state.worldId);
    const day = getDay(world, state.dayNo);
    if(!world || !day){
      state.buffer.push({ text:"(missing drama data)", hackled:false }); return;
    }
    const blocks = day.blocks || [];
    if(state.cursor >= blocks.length){
      state.buffer.push({ text:`(end of Day ${day.day})`, hackled:false }); return;
    }

    const step = 16;
    const start = state.cursor;
    const end = Math.min(blocks.length, start + step);
    const seed = blocks[Math.max(0, start-1)] || blocks[start] || "";

    for(let i=start;i<end;i++){
      const raw = safeText(blocks[i] || "");
      if(!raw.trim()) continue;

      if(hackle){
        const c = classifyLine(raw);
        const replace = Math.random() < 0.32;
        if(c.kind === "speaker" && replace){
          const g = generate(state.markov, c.txt || seed, 34);
          state.buffer.push({ text: `${c.spk}: ${g || c.txt}`, hackled:true });
        } else if(replace){
          const g = generate(state.markov, raw || seed, 34);
          state.buffer.push({ text: g || raw, hackled:true });
        } else {
          state.buffer.push({ text: raw, hackled:false });
        }
      } else {
        state.buffer.push({ text: raw, hackled:false });
      }
    }

    state.cursor = end;
    if(hackle) state.drift = clamp01(state.drift + 0.10);
    else state.drift = clamp01(state.drift * 0.985 + 0.01);

    if(driftMaybe()) driftWorld(true);
  }

  function render(){
    applyRotation();
    const world = getWorldById(state.worldId);
    const day = getDay(world, state.dayNo);

    setHUD(world, day);
    renderBuffer();

    if(!world || !day){
      setQuestion("Archive not loaded: missing data JSONs.");
      setChoices([
        { label:"Reload", onClick: () => { click(); location.reload(); } },
        { label:"Drift", onClick: () => { click(); driftWorld(false); render(); persist(); } },
        { label:"Role", onClick: () => { click(); state.roleIdx=(state.roleIdx+1)%ROLES.length; render(); persist(); } },
        { label:"Continue", onClick: () => { click(); appendChunk({hackle:false}); render(); persist(); } },
      ]);
      return;
    }

    const atEnd = state.cursor >= (day.blocks || []).length;
    const role = ROLES[state.roleIdx % ROLES.length];

    if(!state.buffer.length){
      state.buffer.push({ text:`(entering Day ${day.day})`, hackled:false });
    }

    if(atEnd){
      setQuestion(`Day ${day.day} closes. As ${role}, move forward, loop, drift, or hackle the return.`);
      setChoices([
        { label:"Next day", onClick: () => { click(); gotoDay(+1); render(); persist(); } },
        { label:"Loop back", onClick: () => { click(); gotoDay(-1); render(); persist(); } },
        { label:"Drift worldline", onClick: () => { click(); driftWorld(true); render(); persist(); } },
        { label:"Hackle the return", onClick: () => { click(); appendChunk({hackle:true}); render(); persist(); } },
      ]);
      return;
    }

    setQuestion(`Stay inside the dialogue as ${role}. Each click rotates palette; “Hackle” lets Markov bite the next chunk.`);
    setChoices([
      { label:"Continue", onClick: () => { click(); appendChunk({hackle:false}); render(); persist(); } },
      { label:"Hackle", onClick: () => { click(); appendChunk({hackle:true}); render(); persist(); } },
      { label:"Change role", onClick: () => { click(); state.roleIdx=(state.roleIdx+1)%ROLES.length; render(); persist(); } },
      { label:"Drift / Wormhole", onClick: () => { click(); driftWorld(Math.random()<0.6); render(); persist(); } },
    ]);
  }

  async function boot(){
    await bootBuildStamp();
    state.worlds = await fetchJSON("data/drama_worlds.json");
    state.corpus = await fetchJSON("data/corpus.json").catch(()=>({lines:[]}));

    const worlds = state.worlds?.worlds || [];
    state.canonId = state.worlds?.canonical || (worlds[0]?.id || null);

    restore();

    if(!state.worldId){
      state.worldId = localStorage.getItem("ki_world") || state.canonId || (worlds[0]?.id || null);
    }
    localStorage.setItem("ki_world", state.worldId || "");

    const w = getWorldById(state.worldId);
    const days = allDayNos(w);
    if(state.dayNo == null) state.dayNo = days.length ? days[0] : 1;

    // Markov mix: corpus lines + canonical drama blocks
    const canon = getWorldById(state.canonId);
    const dramaLines = [];
    (canon?.days || []).forEach(d => (d.blocks||[]).slice(0, 2200).forEach(b => dramaLines.push(b)));

    const mix = (state.corpus.lines || []).slice(0, 3800).concat(dramaLines.slice(0, 2400));
    state.markov = buildMarkov(mix.length ? mix : dramaLines);

    if(!state.buffer.length){
      state.buffer = [{ text:`(entering Day ${getDay(w,state.dayNo)?.day || state.dayNo})`, hackled:false }];
      appendChunk({hackle:false});
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
