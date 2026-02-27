/* LA Orthos Schedule – GitHub Pages (Option B)
   Shared publishing by committing JSON files to the repo.

   Files:
   /data/index.json -> { "weeks": ["YYYY-MM-DD", ...] }
   /data/schedules/YYYY-MM-DD.json -> schedule payload

   App behavior:
   - On load, fetches index.json, picks latest week (first element), loads that schedule.
   - Week pickers load other weeks if present in index.
   - Builder "Publish" downloads JSON for you to commit.
*/

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday"];

const DATA_INDEX_URL = "./data/index.json";
const DATA_SCHEDULES_DIR = "./data/schedules";

const LS_KEYS = {
  ME: "laorthos_sched_me_v1",
  EDIT: "laorthos_sched_edit_v1",
};

const $ = (sel) => document.querySelector(sel);

const state = {
  view: "my",
  editUnlocked: false,

  // Data loaded from repo:
  availableWeeks: [],         // ["YYYY-MM-DD", ...]
  currentWeekOf: null,        // "YYYY-MM-DD"
  scheduleByWeek: {},         // cache: { [weekOf]: scheduleObj }

  // Working draft in Builder:
  roster: [],
  templates: [],
  entries: {},
};

init();

async function init(){
  wireTabs();
  wireButtons();
  hydrateEditFlag();

  // Load index.json + latest schedule
  await bootstrapFromRepo();

  initWeekPickers();
  renderAll();
}

/* ---------------- Tabs ---------------- */

function wireTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=> setView(btn.dataset.view));
  });
}

function setView(view){
  state.view = view;
  document.querySelectorAll(".tab").forEach(t=>{
    const is = t.dataset.view === view;
    t.classList.toggle("is-active", is);
    t.setAttribute("aria-selected", is ? "true" : "false");
  });
  ["my","everyone","builder"].forEach(v=>{
    $(`#view-${v}`).hidden = (v !== view);
  });
}

/* ---------------- Bootstrapping ---------------- */

async function bootstrapFromRepo(){
  const idx = await fetchIndexJson();
  state.availableWeeks = idx?.weeks || [];

  // If no weeks exist yet, start on current Monday (draft-only until committed)
  if(!state.availableWeeks.length){
    state.currentWeekOf = mondayOf(new Date());
    state.roster = [];
    state.templates = defaultTemplates();
    state.entries = {};
    toast("No schedules found in /data yet. Import CSV in Builder to start.");
    return;
  }

  // Use newest week (first)
  state.currentWeekOf = state.availableWeeks[0];
  await loadWeekFromRepo(state.currentWeekOf);
  applyLoadedWeekToViews(state.currentWeekOf);
}

async function fetchIndexJson(){
  try{
    const res = await fetch(`${DATA_INDEX_URL}?v=${Date.now()}`, { cache: "no-store" });
    if(!res.ok) throw new Error("index fetch failed");
    return await res.json();
  }catch(e){
    console.warn("Could not load index.json", e);
    return null;
  }
}

async function loadWeekFromRepo(weekOf){
  if(state.scheduleByWeek[weekOf]) return state.scheduleByWeek[weekOf];
  try{
    const res = await fetch(`${DATA_SCHEDULES_DIR}/${weekOf}.json?v=${Date.now()}`, { cache: "no-store" });
    if(!res.ok) throw new Error("week fetch failed");
    const sched = await res.json();
    state.scheduleByWeek[weekOf] = sched;
    return sched;
  }catch(e){
    console.warn(`Could not load week ${weekOf}`, e);
    return null;
  }
}

function applyLoadedWeekToViews(weekOf){
  const sched = state.scheduleByWeek[weekOf];
  if(!sched) return;

  // For view screens, we use the loaded schedule.
  // For Builder, we also load it as the working draft (so edits start from published).
  state.roster = sched.roster || [];
  state.templates = (sched.templates || []).map(t => normalizeTemplate(t));
  state.entries = sched.entries || {};
}

/* ---------------- Buttons / UI wiring ---------------- */

function wireButtons(){
  $("#btnPickMe").addEventListener("click", openPickMeModal);
  $("#btnClearMe").addEventListener("click", ()=>{
    localStorage.removeItem(LS_KEYS.ME);
    toast("Cleared your name on this device.");
    renderMy();
  });

  $("#btnPrint").addEventListener("click", ()=> window.print());
  $("#btnExportCSV").addEventListener("click", exportCurrentToCSV);

  $("#btnImportCSV").addEventListener("click", ()=> $("#csvFile").click());
  $("#csvFile").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    const text = await f.text();
    try{
      const parsed = parseScheduleCSV(text);
      loadParsedDraft(parsed);
      toast("Imported schedule from CSV (draft). Now click Publish to download JSON.");
      $("#csvFile").value = "";
    }catch(err){
      console.error(err);
      toast("Could not import that CSV. Make sure it is the weekly schedule sheet export.");
    }
  });

  $("#btnEditMode").addEventListener("click", toggleEditMode);
  $("#btnValidate").addEventListener("click", validateCurrent);
  $("#btnPublish").addEventListener("click", publishDraftToFile);

  $("#btnAddTemplate").addEventListener("click", openAddTemplateModal);

  // Close modal
  $("#modal").addEventListener("click", (e)=>{
    if(e.target?.dataset?.close) closeModal();
  });
}

function hydrateEditFlag(){
  state.editUnlocked = localStorage.getItem(LS_KEYS.EDIT) === "1";
}

/* ---------------- Week pickers ---------------- */

function initWeekPickers(){
  // Default week selection = currentWeekOf
  $("#myWeekOf").value = state.currentWeekOf;
  $("#everyoneWeekOf").value = state.currentWeekOf;
  $("#builderWeekOf").value = state.currentWeekOf;

  $("#myWeekOf").addEventListener("change", async ()=>{ await setWeek($("#myWeekOf").value); });
  $("#everyoneWeekOf").addEventListener("change", async ()=>{ await setWeek($("#everyoneWeekOf").value); });
  $("#builderWeekOf").addEventListener("change", async ()=>{ await setWeek($("#builderWeekOf").value); });

  $("#roleFilter").addEventListener("change", renderEveryone);
  $("#searchFilter").addEventListener("input", renderEveryone);
}

async function setWeek(dateStr){
  if(!dateStr) return;
  const asMon = mondayOf(new Date(dateStr + "T00:00:00"));
  state.currentWeekOf = asMon;

  $("#myWeekOf").value = asMon;
  $("#everyoneWeekOf").value = asMon;
  $("#builderWeekOf").value = asMon;

  // Prefer loading from repo if week exists there
  if(state.availableWeeks.includes(asMon)){
    await loadWeekFromRepo(asMon);
    applyLoadedWeekToViews(asMon);
  } else {
    // Week not in index.json (yet). Keep working draft as-is, just change date.
    toast("That week isn’t in /data/index.json yet. You can build it in Builder and publish a JSON file.");
  }

  renderAll();
}

/* ---------------- Rendering ---------------- */

function renderAll(){
  renderMy();
  renderEveryone();
  renderBuilder();
}

function getActiveScheduleForViews(){
  // Views should show repo-loaded schedule if available; if not, show draft.
  return state.scheduleByWeek[state.currentWeekOf] || {
    weekOf: state.currentWeekOf,
    roster: state.roster,
    templates: state.templates,
    entries: state.entries,
  };
}

function renderMy(){
  const sched = getActiveScheduleForViews();
  const meId = localStorage.getItem(LS_KEYS.ME);
  const me = (sched.roster || []).find(r=>r.id === meId);

  $("#myNamePill").textContent = me ? me.name : "Not selected";

  if(!sched.roster?.length){
    $("#todayCard").innerHTML = `<div class="muted">No schedule loaded yet.</div>`;
    $("#weekCards").innerHTML = `<div class="muted">Ask Alex to publish a schedule JSON to the repo.</div>`;
    return;
  }
  if(!me){
    $("#todayCard").innerHTML = `<div class="muted">Select your name to see your assignments.</div>`;
    $("#weekCards").innerHTML = `<div class="muted">Tap “Select my name”.</div>`;
    return;
  }

  const entries = sched.entries?.[me.id] || {};
  const todayName = dayName(new Date());
  const todayVal = (todayName && entries[todayName]) ? templateTextById(sched, entries[todayName]) : null;

  $("#todayCard").innerHTML = `
    <div style="font-weight:900; color:var(--navy)">${formatLongDate(new Date())}</div>
    <div style="margin-top:6px">${todayName ? `<span class="badge">${todayName}</span>` : ""}</div>
    <div style="margin-top:10px; font-size:16px; font-weight:900">${escapeHtml(todayVal || "No assignment today")}</div>
  `;

  $("#weekCards").innerHTML = DAYS.map(d=>{
    const tid = entries[d];
    const txt = tid ? templateTextById(sched, tid) : "—";
    return `
      <div class="dayCard">
        <div>
          <div class="dayName">${d}</div>
          <div class="badge">${me.role}</div>
        </div>
        <div class="dayValue">${escapeHtml(txt)}</div>
      </div>
    `;
  }).join("");
}

function renderEveryone(){
  const sched = getActiveScheduleForViews();
  const table = $("#everyoneGrid");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  if(!sched.roster?.length){
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td class="muted" style="padding:14px">No schedule loaded.</td></tr>`;
    return;
  }

  const role = $("#roleFilter").value;
  const q = ($("#searchFilter").value || "").trim().toLowerCase();

  const rows = sched.roster
    .filter(r => role === "ALL" ? true : r.role === role)
    .filter(r => !q ? true : r.name.toLowerCase().includes(q));

  thead.innerHTML = `
    <tr>
      <th style="min-width:240px;text-align:left;">Team Member</th>
      ${DAYS.map(d=>`<th style="min-width:210px;text-align:left;">${d}</th>`).join("")}
    </tr>
  `;

  tbody.innerHTML = rows.map(r=>{
    const e = sched.entries?.[r.id] || {};
    return `
      <tr>
        <td class="nameCell">
          ${escapeHtml(r.name)}
          <span class="roleTag">${r.role}</span>
        </td>
        ${DAYS.map(d=>{
          const tid = e[d];
          const txt = tid ? templateTextById(sched, tid) : "";
          return `<td>${escapeHtml(txt)}</td>`;
        }).join("")}
      </tr>
    `;
  }).join("");
}

function renderBuilder(){
  const status = $("#builderStatus");
  const hint = $("#editHint");

  const isRepoWeek = state.availableWeeks.includes(state.currentWeekOf);
  status.textContent = isRepoWeek ? "Published week loaded (edit draft from it)" : "Draft week (not in repo yet)";
  hint.textContent = state.editUnlocked ? "Editing unlocked (click cells to assign templates)" : "Locked (view only)";

  renderTemplateList();
  renderBuilderGrid();
}

function renderTemplateList(){
  const list = $("#templateList");
  const templates = (state.templates?.length ? state.templates : defaultTemplates()).map(t => normalizeTemplate(t));
  state.templates = templates;

  list.innerHTML = templates.map(t=>{
    const p = t.parsed;
    const meta = p.type === "OFF"
      ? "OFF"
      : `${(p.site ? p.site : "—")} • ${(p.start||"")}–${(p.end||"")}`.replace("–", "–");
    return `
      <div class="templateItem">
        <div class="templateTop">
          <div>
            <div class="templateName">${escapeHtml(p.label || t.raw)}</div>
            <div class="templateMeta">${escapeHtml(meta)}</div>
          </div>
          <div class="templateActions">
            <button class="iconBtn" title="Delete" data-del="${t.id}">🗑</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if(!state.editUnlocked){ toast("Unlock editing first."); return; }
      const id = btn.dataset.del;
      state.templates = state.templates.filter(x=>x.id !== id);
      Object.keys(state.entries).forEach(pid=>{
        DAYS.forEach(d=>{
          if(state.entries[pid][d] === id) state.entries[pid][d] = null;
        });
      });
      toast("Template deleted.");
      renderBuilder();
    });
  });
}

function renderBuilderGrid(){
  const table = $("#builderGrid");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  if(!state.roster.length){
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td class="muted" style="padding:14px">Import a weekly CSV to start.</td></tr>`;
    return;
  }

  thead.innerHTML = `
    <tr>
      <th style="min-width:240px;text-align:left;">Team Member</th>
      ${DAYS.map(d=>`<th style="min-width:210px;text-align:left;">${d}</th>`).join("")}
    </tr>
  `;

  tbody.innerHTML = state.roster.map(r=>{
    const e = state.entries?.[r.id] || {};
    return `
      <tr>
        <td class="nameCell">
          ${escapeHtml(r.name)} <span class="roleTag">${r.role}</span>
        </td>
        ${DAYS.map(d=>{
          const tid = e[d];
          const txt = tid ? templateTextById({templates:state.templates}, tid) : "";
          return `
            <td>
              <button class="cellBtn ${state.editUnlocked ? "editable" : ""}" data-pid="${r.id}" data-day="${d}">
                ${escapeHtml(txt || "—")}
              </button>
            </td>
          `;
        }).join("")}
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll(".cellBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if(!state.editUnlocked){ return; }
      openCellPicker(btn.dataset.pid, btn.dataset.day);
    });
  });
}

/* ---------------- Editor helpers ---------------- */

function toggleEditMode(){
  if(state.editUnlocked){
    state.editUnlocked = false;
    localStorage.setItem(LS_KEYS.EDIT, "0");
    toast("Editing locked.");
    renderBuilder();
    return;
  }

  openModal({
    title: "Unlock editing",
    body: `
      <div class="field" style="min-width:100%">
        <label>Passphrase</label>
        <input id="passInput" type="password" placeholder="Enter passphrase" />
        <div class="hint">Default passphrase: <b>laorthos</b> (change it in app.js)</div>
      </div>
    `,
    foot: `
      <button class="btn btnGhost" data-close="1">Cancel</button>
      <button class="btn" id="passOk">Unlock</button>
    `,
    onAfter(){
      $("#passOk").addEventListener("click", ()=>{
        const val = ($("#passInput").value || "").trim();
        if(val !== "laorthos"){
          toast("Wrong passphrase.");
          return;
        }
        state.editUnlocked = true;
        localStorage.setItem(LS_KEYS.EDIT, "1");
        closeModal();
        toast("Editing unlocked on this device.");
        renderBuilder();
      });
    }
  });
}

function openCellPicker(personId, day){
  const person = state.roster.find(r=>r.id===personId);
  const templates = state.templates.map(t=>normalizeTemplate(t));
  const currentId = state.entries?.[personId]?.[day] || "";

  const options = [
    `<option value="">— Clear —</option>`,
    ...templates.map(t=>{
      const text = t.parsed.type === "OFF"
        ? "OFF"
        : `${t.parsed.label}${t.parsed.site ? ` (${t.parsed.site})` : ""} ${t.parsed.start ? `${t.parsed.start}-${t.parsed.end}` : ""}`.trim();
      return `<option value="${t.id}" ${t.id===currentId?"selected":""}>${escapeHtml(text)}</option>`;
    })
  ].join("");

  openModal({
    title: `Assign: ${person?.name || "Staff"} • ${day}`,
    body: `
      <div class="field" style="min-width:100%">
        <label>Template</label>
        <select id="cellPick" style="height:46px">${options}</select>
      </div>
      <div class="hint">Pick a template. No typing needed.</div>
    `,
    foot: `
      <button class="btn btnGhost" data-close="1">Cancel</button>
      <button class="btn" id="cellSave">Save</button>
    `,
    onAfter(){
      $("#cellSave").addEventListener("click", ()=>{
        const val = $("#cellPick").value || null;
        if(!state.entries[personId]) state.entries[personId] = {};
        state.entries[personId][day] = val;
        closeModal();
        renderBuilderGrid();
      });
    }
  });
}

function openPickMeModal(){
  const sched = getActiveScheduleForViews();
  const roster = sched.roster || [];
  if(!roster.length){
    toast("No schedule loaded yet. Ask Alex to publish a schedule JSON to the repo.");
    return;
  }

  const meId = localStorage.getItem(LS_KEYS.ME) || "";
  const options = roster
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name))
    .map(r=>`<option value="${r.id}" ${r.id===meId?"selected":""}>${escapeHtml(r.name)} (${r.role})</option>`)
    .join("");

  openModal({
    title: "Select your name",
    body: `
      <div class="field" style="min-width:100%">
        <label>Name</label>
        <select id="mePick" style="height:46px">
          <option value="">— Select —</option>
          ${options}
        </select>
      </div>
      <div class="hint">Saved on this device only.</div>
    `,
    foot: `
      <button class="btn btnGhost" data-close="1">Cancel</button>
      <button class="btn" id="meSave">Save</button>
    `,
    onAfter(){
      $("#meSave").addEventListener("click", ()=>{
        const val = $("#mePick").value;
        if(!val){ toast("Pick a name."); return; }
        localStorage.setItem(LS_KEYS.ME, val);
        closeModal();
        renderMy();
        toast("Saved.");
      });
    }
  });
}

function openAddTemplateModal(){
  if(!state.editUnlocked){ toast("Unlock editing first."); return; }

  openModal({
    title: "Add template",
    body: `
      <div class="field" style="min-width:100%">
        <label>Template text (same format as the sheet)</label>
        <input id="tplRaw" type="text" placeholder='Example: XR (SFS) 07:50- 04:20' />
        <div class="hint">You can also add: OFF, TRAINING 08:00- 04:30, FLOAT (Val) 08:00- 04:30</div>
      </div>
    `,
    foot: `
      <button class="btn btnGhost" data-close="1">Cancel</button>
      <button class="btn" id="tplSave">Add</button>
    `,
    onAfter(){
      $("#tplSave").addEventListener("click", ()=>{
        const raw = ($("#tplRaw").value || "").trim();
        if(!raw){ toast("Enter template text."); return; }
        state.templates.push(normalizeTemplate({ id: idForRaw(raw), raw }));
        closeModal();
        toast("Template added.");
        renderBuilder();
      });
    }
  });
}

/* ---------------- Validate + Publish (download) ---------------- */

function validateCurrent(){
  if(!state.roster.length){ toast("Nothing to validate."); return; }

  const issues = [];
  state.roster.forEach(r=>{
    const e = state.entries?.[r.id] || {};
    DAYS.forEach(d=>{
      const v = e[d];
      if(v === undefined || v === null || v === ""){
        issues.push(`${r.name} missing ${d}`);
      }
    });
  });

  if(!issues.length){
    toast("Validation passed. No missing assignments.");
    return;
  }

  openModal({
    title: `Validation issues (${issues.length})`,
    body: `<div class="muted" style="line-height:1.45">${issues.map(x=>`• ${escapeHtml(x)}`).join("<br>")}</div>`,
    foot: `<button class="btn btnGhost" data-close="1">Close</button>`
  });
}

function publishDraftToFile(){
  if(!state.editUnlocked){ toast("Unlock editing first."); return; }
  if(!state.currentWeekOf){ toast("Pick a week."); return; }
  if(!state.roster.length){ toast("Import a weekly CSV first."); return; }

  const payload = {
    weekOf: state.currentWeekOf,
    roster: state.roster,
    templates: state.templates.map(t=>normalizeTemplate(t)),
    entries: state.entries,
    publishedAt: new Date().toISOString(),
  };

  const filename = `${state.currentWeekOf}.json`;
  downloadTextFile(filename, JSON.stringify(payload, null, 2), "application/json");

  openModal({
    title: "Publish steps (GitHub Pages)",
    body: `
      <div class="muted" style="line-height:1.55">
        <b>1)</b> Take the downloaded file: <b>${escapeHtml(filename)}</b><br>
        <b>2)</b> Upload/commit it to: <b>/data/schedules/${escapeHtml(filename)}</b><br>
        <b>3)</b> Update <b>/data/index.json</b> to include <b>${escapeHtml(state.currentWeekOf)}</b> at the front of "weeks"<br><br>
        After GitHub finishes deploying, staff will see it automatically.
      </div>
    `,
    foot: `<button class="btn" data-close="1">Got it</button>`
  });
}

/* ---------------- CSV Import into draft ---------------- */

function loadParsedDraft(parsed){
  state.currentWeekOf = parsed.weekOf;
  $("#myWeekOf").value = parsed.weekOf;
  $("#everyoneWeekOf").value = parsed.weekOf;
  $("#builderWeekOf").value = parsed.weekOf;

  state.roster = parsed.roster;
  state.templates = parsed.templates;
  state.entries = parsed.entries;

  renderAll();
}

function parseScheduleCSV(text){
  const rows = csvToRows(text);

  const headerIdx = rows.findIndex(r => (r[0]||"").trim().toUpperCase() === "TEAM MEMBER");
  if(headerIdx === -1) throw new Error("No TEAM MEMBER header found.");

  const header = rows[headerIdx].map(x => (x||"").trim());
  const dayIdx = {
    TEAM: 0,
    Monday: header.findIndex(x=>x.toLowerCase()==="monday"),
    Tuesday: header.findIndex(x=>x.toLowerCase()==="tuesday"),
    Wednesday: header.findIndex(x=>x.toLowerCase()==="wednesday"),
    Thursday: header.findIndex(x=>x.toLowerCase()==="thursday"),
    Friday: header.findIndex(x=>x.toLowerCase()==="friday"),
  };
  if(Object.values(dayIdx).some(i=>i<0)) throw new Error("Missing weekday headers.");

  // Find first date above header like "03/02/2026- 03/06/2026"
  let weekOf = null;
  for(let i=headerIdx-1; i>=0; i--){
    const s = (rows[i][0]||"").trim();
    const m = s.match(/(\d{2}\/\d{2}\/\d{4})/);
    if(m){ weekOf = toISODate(m[1]); break; }
  }
  if(!weekOf) weekOf = mondayOf(new Date());

  const roster = [];
  const entries = {};
  const templateRawSet = new Set();

  let emptyCount = 0;
  for(let i=headerIdx+1; i<rows.length; i++){
    const teamCell = (rows[i][dayIdx.TEAM]||"").trim();
    const anyDay = DAYS.some(d => ((rows[i][dayIdx[d]]||"").trim() !== ""));
    if(!teamCell && !anyDay){
      emptyCount++;
      if(emptyCount >= 3) break;
      continue;
    }
    emptyCount = 0;
    if(!teamCell) continue;

    const role = teamCell.trim().startsWith("(XR)") ? "XR" : "MA";
    const name = teamCell.replace(/^\(XR\)\s*/i, "").trim();
    const personId = slug(name);

    roster.push({ id: personId, name, role });
    entries[personId] = entries[personId] || {};

    DAYS.forEach(d=>{
      const raw = (rows[i][dayIdx[d]]||"").trim();
      if(!raw) { entries[personId][d] = null; return; }

      if(raw.toUpperCase() === "OFF"){
        templateRawSet.add("OFF");
        entries[personId][d] = idForRaw("OFF");
        return;
      }
      templateRawSet.add(raw);
      entries[personId][d] = idForRaw(raw);
    });
  }

  const templates = Array.from(templateRawSet)
    .filter(Boolean)
    .map(raw => normalizeTemplate({ id: idForRaw(raw), raw }));

  defaultTemplates().forEach(t=>{
    if(!templates.some(x=>x.id===t.id)) templates.push(normalizeTemplate(t));
  });

  return { weekOf, roster, templates, entries };
}

/* ---------------- Export CSV (current views) ---------------- */

function exportCurrentToCSV(){
  const sched = getActiveScheduleForViews();
  if(!sched?.roster?.length){ toast("No schedule to export."); return; }

  const header = ["TEAM MEMBER", ...DAYS];
  const lines = [header];

  sched.roster.forEach(r=>{
    const e = sched.entries?.[r.id] || {};
    const teamLabel = r.role === "XR" ? `(XR) ${r.name}` : r.name;
    const row = [teamLabel, ...DAYS.map(d=>{
      const tid = e[d];
      return tid ? templateTextById(sched, tid) : "";
    })];
    lines.push(row);
  });

  const csv = lines.map(arr => arr.map(csvEscape).join(",")).join("\n");
  downloadTextFile(`Schedule_${state.currentWeekOf}.csv`, csv, "text/csv");
  toast("CSV exported.");
}

/* ---------------- Template parsing ---------------- */

function defaultTemplates(){
  return [
    { id: idForRaw("OFF"), raw:"OFF" },
    { id: idForRaw("TRAINING 08:00- 04:30"), raw:"TRAINING 08:00- 04:30" },
    { id: idForRaw("FLOAT (Val) 08:00- 04:30"), raw:"FLOAT (Val) 08:00- 04:30" },
  ];
}

function normalizeTemplate(t){
  const raw = (t.raw || "").trim();
  const parsed = parseCell(raw);
  return { id: t.id || idForRaw(raw), raw, parsed };
}

function parseCell(raw){
  const s = (raw||"").trim();
  if(!s) return { type:"EMPTY", label:"", site:"", start:"", end:"" };
  if(s.toUpperCase() === "OFF") return { type:"OFF", label:"OFF", site:"", start:"", end:"" };

  let label = s;
  let site = "";

  const siteMatch = s.match(/\(([^\)]+)\)/);
  if(siteMatch) site = siteMatch[1].trim();

  const timeMatch = s.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})(?:\s*(AM|PM))?/i);
  let start = "", end = "";
  if(timeMatch){
    start = (timeMatch[1]||"").trim();
    end = (timeMatch[2]||"").trim();
  }

  if(siteMatch){
    label = s.slice(0, siteMatch.index).trim();
  }else if(timeMatch){
    label = s.slice(0, timeMatch.index).trim();
  }
  if(!label && site) label = site;

  const upper = label.toUpperCase();
  const type =
    upper === "TRAINING" ? "TRAINING" :
    upper.startsWith("FLOAT") ? "FLOAT" :
    upper === "XR" ? "XR" :
    "ASSIGN";

  return { type, label, site, start, end };
}

function templateTextById(sched, id){
  const templates = (sched.templates || state.templates || []);
  const t = templates.find(x=>x.id===id);
  if(!t) return "";
  const p = t.parsed || parseCell(t.raw);
  if(p.type === "OFF") return "OFF";
  const sitePart = p.site ? ` (${p.site})` : "";
  const timePart = (p.start && p.end) ? ` ${p.start}- ${p.end}` : "";
  return `${p.label}${sitePart}${timePart}`.trim();
}

/* ---------------- CSV parsing ---------------- */

function csvToRows(text){
  const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
  return lines.map(parseCSVLine);
}
function parseCSVLine(line){
  const out = [];
  let cur = "";
  let inQ = false;
  for(let i=0; i<line.length; i++){
    const ch = line[i];
    if(ch === '"'){
      if(inQ && line[i+1] === '"'){ cur += '"'; i++; }
      else inQ = !inQ;
      continue;
    }
    if(ch === "," && !inQ){
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function csvEscape(v){
  const s = (v ?? "").toString();
  if(/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function toISODate(mmddyyyy){
  const [mm,dd,yyyy] = mmddyyyy.split("/");
  return `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
}

/* ---------------- Utilities ---------------- */

function mondayOf(date){
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0,10);
}

function dayName(date){
  const idx = date.getDay();
  const map = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const name = map[idx];
  return DAYS.includes(name) ? name : null;
}

function formatLongDate(d){
  return d.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"long", day:"numeric" });
}

function slug(name){
  return (name||"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"")
    .slice(0,60) || uid("p");
}

function idForRaw(raw){
  const s = (raw||"").trim().toLowerCase();
  let h = 2166136261;
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "t_" + (h>>>0).toString(16);
}

function uid(prefix){
  return `${prefix}_${Math.random().toString(16).slice(2,10)}${Date.now().toString(16).slice(-4)}`;
}

function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, 2600);
}

function downloadTextFile(filename, content, mime){
  const blob = new Blob([content], {type: mime || "text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ---------------- Modal ---------------- */

function openModal({title, body, foot, onAfter}){
  $("#modalTitle").textContent = title || "Modal";
  $("#modalBody").innerHTML = body || "";
  $("#modalFoot").innerHTML = foot || `<button class="btn btnGhost" data-close="1">Close</button>`;
  $("#modal").hidden = false;
  setTimeout(()=>{ onAfter?.(); }, 0);
}
function closeModal(){
  $("#modal").hidden = true;
  $("#modalBody").innerHTML = "";
  $("#modalFoot").innerHTML = "";
}
