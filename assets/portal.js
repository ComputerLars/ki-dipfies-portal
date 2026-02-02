(() => {
  const $ = (s, r=document) => r.querySelector(s);
  const COLORS = { black:"#050505", green:"#00a651", white:"#f3f6f2" };
  const ROT = [
    { bg:"black", fg:"green", btn:"white", ink:"light" },
    { bg:"green", fg:"black", btn:"white", ink:"dark" },
    { bg:"white", fg:"black", btn:"green", ink:"dark" },
  ];
  const ROLES = ["Delegate","Witness","Archivist","Chair","Ghost","Bot"];
  const ARCHIVE_PAGE = 6;

  const state = {
    build:"dev",
    clicks:0,
    worlds:null,
    canonId:null,
    worldId:null,
    dayNo:null,
    cursor:0,
    chunkStack:[],
    roleIdx:0,
    drift:0,
    buffer:[],
    markov:null,
    corpus:null,
    archive:null,
    archiveOpen:false,
    archivePage:0,
    relic:null,
    viewer:null,
  };

  const TOK_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?|[.,!?;:()]/g;
  const safeText = (x) => (x ?? "").toString();
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const escapeHTML = (s) => safeText(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const shorten = (s, n=40) => {
    const t = safeText(s);
    return t.length > n ? `${t.slice(0, n-3).trim()}...` : t;
  };
  const dom = {
    viewer: $("#viewer"),
    viewerTitle: $("#viewer-title"),
    viewerMeta: $("#viewer-meta"),
    viewerText: $("#viewer-text"),
    viewerFrame: $("#viewer-frame"),
    viewerActions: $("#viewer-actions"),
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

  function resolveUrl(path){
    try{ return new URL(path, location.href).href; }catch{ return path; }
  }

  function setViewerActions(btns){
    const wrap = dom.viewerActions;
    if(!wrap) return;
    wrap.innerHTML = "";
    for(const b of btns){
      const el = document.createElement("div");
      el.className = "vbtn";
      el.textContent = b.label;
      el.onclick = b.onClick;
      wrap.appendChild(el);
    }
  }
  function showViewer(){
    if(!dom.viewer) return;
    dom.viewer.setAttribute("aria-hidden","false");
  }
  function hideViewer(){
    if(!dom.viewer) return;
    dom.viewer.setAttribute("aria-hidden","true");
    if(dom.viewerText) dom.viewerText.textContent = "";
    if(dom.viewerText) dom.viewerText.hidden = true;
    if(dom.viewerFrame){ dom.viewerFrame.hidden = true; dom.viewerFrame.src = "about:blank"; }
    if(dom.viewerActions) dom.viewerActions.innerHTML = "";
    state.viewer = null;
  }
  function setViewerText(text){
    if(dom.viewerText){ dom.viewerText.hidden = false; dom.viewerText.textContent = text; }
    if(dom.viewerFrame) dom.viewerFrame.hidden = true;
  }
  function setViewerFrame(src){
    if(dom.viewerFrame){ dom.viewerFrame.hidden = false; dom.viewerFrame.src = src; }
    if(dom.viewerText) dom.viewerText.hidden = true;
  }
  async function openViewer(item){
    if(!item) return;
    state.viewer = item;
    state.archiveOpen = false;
    if(dom.viewerTitle) dom.viewerTitle.textContent = safeText(item.label || item.id || "Archive");
    if(dom.viewerMeta) dom.viewerMeta.textContent = safeText(item.note || item.type || "");
    showViewer();
    setViewerText("Loading...");

    const direct = resolveUrl(item.path || "");
    const closeBtn = { label:"Close", onClick: () => { click(); hideViewer(); render(); persist(); } };
    const openBtn = { label:"Open file", onClick: () => { click(); window.open(direct, "_blank", "noopener"); } };

    if(item.type === "text" || item.type === "json"){
      try{
        const raw = await fetch(direct, { cache:"no-store" }).then(r => r.text());
        let out = raw;
        if(item.type === "json"){
          try{ out = JSON.stringify(JSON.parse(raw), null, 2); }catch{ out = raw; }
        }
        setViewerText(out.trim() || "(empty file)");
      }catch(err){
        setViewerText(`(failed to load) ${safeText(err.message || err)}`);
      }
      setViewerActions([closeBtn, openBtn]);
      return;
    }

    if(item.type === "docx"){
      const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(direct)}`;
      setViewerFrame(viewerUrl);
      setViewerActions([closeBtn, openBtn]);
      return;
    }

    if(item.type === "pdf" || item.type === "image"){
      setViewerFrame(direct);
      setViewerActions([closeBtn, openBtn]);
      return;
    }

    setViewerText("Unsupported file type.");
    setViewerActions([closeBtn, openBtn]);
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

  function pickRelic(){
    const items = state.archive?.items || [];
    if(!items.length) return;
    if(state.relic && Math.random() < 0.6) return;
    if(Math.random() < 0.18){
      state.relic = items[Math.floor(Math.random()*items.length)];
    }
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

  function buildArchiveChoices(){
    const items = state.archive?.items || [];
    if(!items.length){
      return [{ label:"Close archive", onClick: () => { click(); state.archiveOpen=false; render(); persist(); } }];
    }
    const pages = Math.max(1, Math.ceil(items.length / ARCHIVE_PAGE));
    const page = Math.min(state.archivePage, pages - 1);
    const start = page * ARCHIVE_PAGE;
    const slice = items.slice(start, start + ARCHIVE_PAGE);
    const btns = slice.map(item => ({
      label: item.label || item.id || "Archive file",
      onClick: () => act(() => { openViewer(item); }, { append:false }),
    }));
    if(pages > 1){
      btns.push({
        label: `Next page ${page + 1}/${pages}`,
        onClick: () => act(() => { state.archivePage = (page + 1) % pages; }, { append:false }),
      });
    }
    btns.push({ label:"Close archive", onClick: () => act(() => { state.archiveOpen=false; }, { append:false }) });
    return btns;
  }

  function act(fn, { append=false } = {}){
    click();
    if(typeof fn === "function") fn();
    if(!append) markovEcho();
    render();
    persist();
  }

  function lockKeyboard(){
    const stop = (e) => { e.preventDefault(); };
    document.addEventListener("keydown", stop, { passive:false });
    document.addEventListener("keypress", stop, { passive:false });
    document.addEventListener("keyup", stop, { passive:false });
  }

  function appendArchiveExtras(btns){
    if(state.relic){
      const label = shorten(state.relic.label || state.relic.id || "Archive relic", 44);
      btns.push({
        label: `Open relic: ${label}`,
        onClick: () => act(() => { openViewer(state.relic); state.relic = null; }, { append:false }),
      });
    }
    if((state.archive?.items || []).length){
      btns.push({
        label: "Open archive",
        onClick: () => act(() => { state.archiveOpen = true; }, { append:false }),
      });
    }
    return btns;
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
    state.chunkStack = [];
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
    state.chunkStack = [];
    if(delta > 0) state.drift = clamp01(state.drift * 0.92);
    else state.drift = clamp01(state.drift + 0.08);
  }

  function appendChunk({ hackle=false, pulse=false }){
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
    const before = state.buffer.length;
    const hasMarkov = !!state.markov;
    const pulseIdx = pulse ? Math.floor(Math.random() * Math.max(1, end - start)) : -1;
    let pulseArmed = pulse;

    for(let i=start;i<end;i++){
      const raw = safeText(blocks[i] || "");
      if(!raw.trim()) continue;

      const pulseHit = pulseArmed && (i - start) >= pulseIdx;
      if(hackle || pulseHit){
        const c = classifyLine(raw);
        const replace = hasMarkov && (pulseHit || Math.random() < 0.32);
        if(c.kind === "speaker" && replace){
          const g = generate(state.markov, c.txt || seed, 34);
          state.buffer.push({ text: `${c.spk}: ${g || c.txt}`, hackled:true });
        } else if(replace){
          const g = generate(state.markov, raw || seed, 34);
          state.buffer.push({ text: g || raw, hackled:true });
        } else {
          state.buffer.push({ text: raw, hackled:false });
        }
        if(pulseHit) pulseArmed = false;
      } else {
        state.buffer.push({ text: raw, hackled:false });
      }
    }

    state.cursor = end;
    const added = state.buffer.length - before;
    if(added > 0){
      state.chunkStack.push({ cursorStart:start, cursorEnd:end, added, hackle:!!hackle });
    }
    if(pulseArmed && hasMarkov) markovEcho(seed);
    if(hackle) state.drift = clamp01(state.drift + 0.10);
    else state.drift = clamp01(state.drift * 0.985 + 0.01);

    if(driftMaybe()) driftWorld(true);
    pickRelic();
  }

  function rewindChunk(){
    const last = state.chunkStack.pop();
    if(!last) return false;
    const start = Math.max(0, state.buffer.length - last.added);
    state.buffer.splice(start, last.added);
    state.cursor = last.cursorStart;
    state.drift = clamp01(state.drift * 0.96);
    return true;
  }

  function render(){
    applyRotation();
    const world = getWorldById(state.worldId);
    const day = getDay(world, state.dayNo);

    setHUD(world, day);
    renderBuffer();

    if(state.archiveOpen){
      setQuestion("Archive relay: select a file to view.");
      setChoices(buildArchiveChoices());
      return;
    }

    if(!world || !day){
      setQuestion("Archive not loaded: missing data JSONs.");
      const btns = appendArchiveExtras([
        { label:"Reload", onClick: () => { click(); location.reload(); } },
        { label:"Drift", onClick: () => act(() => driftWorld(false)) },
        { label:"Role", onClick: () => act(() => { state.roleIdx=(state.roleIdx+1)%ROLES.length; }) },
        { label:"Continue", onClick: () => act(() => appendChunk({hackle:false, pulse:true}), { append:true }) },
      ]);
      setChoices(btns);
      return;
    }

    const atEnd = state.cursor >= (day.blocks || []).length;
    const role = ROLES[state.roleIdx % ROLES.length];

    if(!state.buffer.length){
      state.buffer.push({ text:`(entering Day ${day.day})`, hackled:false });
    }

    if(atEnd){
      setQuestion(`Day ${day.day} closes. As ${role}, move forward, loop, drift, or hackle the return.`);
      const btns = appendArchiveExtras([
        { label:"Next day", onClick: () => act(() => gotoDay(+1)) },
        { label:"Loop back", onClick: () => act(() => gotoDay(-1)) },
        { label:"Back a page", onClick: () => act(() => { if(!rewindChunk()) gotoDay(-1); }) },
        { label:"Drift worldline", onClick: () => act(() => driftWorld(true)) },
        { label:"Hackle the return", onClick: () => act(() => { if(!rewindChunk()) gotoDay(-1); appendChunk({hackle:true, pulse:true}); }, { append:true }) },
      ]);
      setChoices(btns);
      return;
    }

    setQuestion(`Stay inside the dialogue as ${role}. Each click rotates palette; “Hackle” lets Markov bite the next chunk.`);
    const btns = appendArchiveExtras([
      { label:"Continue", onClick: () => act(() => appendChunk({hackle:false, pulse:true}), { append:true }) },
      { label:"Back a page", onClick: () => act(() => { if(!rewindChunk()) gotoDay(-1); }) },
      { label:"Hackle", onClick: () => act(() => appendChunk({hackle:true, pulse:true}), { append:true }) },
      { label:"Change role", onClick: () => act(() => { state.roleIdx=(state.roleIdx+1)%ROLES.length; }) },
      { label:"Drift / Wormhole", onClick: () => act(() => driftWorld(Math.random()<0.6)) },
    ]);
    setChoices(btns);
  }

  async function boot(){
    lockKeyboard();
    await bootBuildStamp();
    state.worlds = await fetchJSON("data/drama_worlds.json");
    state.corpus = await fetchJSON("data/corpus.json").catch(()=>({lines:[]}));
    state.archive = await fetchJSON("data/archive.json").catch(()=>({items:[]}));
    hideViewer();

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
