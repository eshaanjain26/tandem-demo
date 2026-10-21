(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MIN = 60000;
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // ---- time zones ---------------------------------------------------
  const partsFmt = new Map();
  function parts(ms, tz) {
    if (!partsFmt.has(tz)) partsFmt.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }));
    const p = Object.fromEntries(partsFmt.get(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month - 1, d: +p.day, h: +p.hour, min: +p.minute, wd: p.weekday };
  }
  function offset(ms, tz) {
    const p = parts(ms, tz);
    return (Date.UTC(p.y, p.m, p.d, p.h, p.min) - Math.floor(ms / MIN) * MIN) / MIN;
  }
  function zoned(y, m, d, h, min, tz) {
    let t = Date.UTC(y, m, d, h, min);
    const o1 = offset(t, tz);
    t -= o1 * MIN;
    const o2 = offset(t, tz);
    if (o2 !== o1) t -= (o2 - o1) * MIN;
    return t;
  }
  const label = (ms, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
  const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

  // The demo week: next Monday to Friday (calendar dates, same for everyone).
  const today = new Date();
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  const weekDates = DAYS.map((_, i) => { const d = new Date(monday); d.setUTCDate(d.getUTCDate() + i); return d; });

  // ---- people and calendars -----------------------------------------
  function rng(seed) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function calendar(tz, seed, heavy) {
    const rand = rng(seed + (heavy ? 1000 : 0));
    const busy = [];
    weekDates.forEach((date) => {
      const n = heavy ? 3 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const startHalf = 16 + Math.floor(rand() * 20); // 08:00 to 17:30 local
        const len = [30, 60, 60, 90][Math.floor(rand() * 4)];
        const s = zoned(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(startHalf / 2), (startHalf % 2) * 30, tz);
        busy.push({ start: s, end: s + len * MIN });
      }
    });
    return busy;
  }
  function mandate(form) {
    const f = form.elements;
    return {
      days: new Set($$("[data-field=days] input:checked", form).map((i) => Number(i.value))),
      earliest: toMin(f.earliest.value || "09:00"), latest: toMin(f.latest.value || "17:00"),
      buffer: Number(f.buffer.value) || 0, reveal: Math.max(1, Number(f.reveal.value) || 1),
      prefer: f.prefer.value, rounds: Math.max(1, Number(f.rounds.value) || 1),
    };
  }

  // ---- the validator: every candidate goes through here --------------
  function check(person, slot) {
    const m = person.mandate, tz = person.tz;
    const p = parts(slot.start, tz), e = parts(slot.end, tz);
    const day = DAYS.indexOf(p.wd);
    const startMin = p.h * 60 + p.min, endMin = e.h * 60 + e.min + (e.d !== p.d ? 1440 : 0);
    const reasons = [];
    if (day < 0 || !m.days.has(day)) reasons.push(`days: ${p.wd} is not an allowed day`);
    if (startMin < m.earliest || endMin > m.latest) reasons.push(`hours: outside ${fmtMin(m.earliest)} to ${fmtMin(m.latest)} local`);
    const pad = m.buffer * MIN;
    if (person.busy.some((b) => slot.start - pad < b.end && b.start < slot.end + pad))
      reasons.push(m.buffer ? `conflict: overlaps a busy block (with ${m.buffer} min buffer)` : "conflict: overlaps a busy block");
    return reasons;
  }
  const fmtMin = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;

  function score(person, slot) {
    const h = parts(slot.start, person.tz).h;
    const pref = person.mandate.prefer;
    return (pref === "morning" ? (h < 12 ? 0 : 1) : pref === "afternoon" ? (h >= 12 ? 0 : 1) : 0);
  }
  function candidates(person, duration, seen) {
    const out = [];
    weekDates.forEach((date, di) => {
      if (!person.mandate.days.has(di)) return;
      for (let t = person.mandate.earliest; t + duration <= person.mandate.latest; t += 30) {
        const start = zoned(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(t / 60), t % 60, person.tz);
        const slot = { start, end: start + duration * MIN };
        if (!seen.has(start) && !check(person, slot).length) out.push(slot);
      }
    });
    out.sort((a, b) => score(person, a) - score(person, b) || a.start - b.start);
    // Spread offers across days before offering two on the same day.
    const picked = [], days = new Set();
    for (const s of out) { const d = parts(s.start, person.tz).d; if (!days.has(d)) { picked.push(s); days.add(d); } }
    for (const s of out) if (!picked.includes(s)) picked.push(s);
    return picked;
  }

  // ---- negotiation --------------------------------------------------
  async function digest(obj) {
    if (!crypto.subtle) return "";
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(obj)));
    return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function negotiate(alice, bob, duration) {
    const steps = [], seen = new Set();
    const maxRounds = Math.min(alice.mandate.rounds, bob.mandate.rounds);
    let sender = alice, receiver = bob, seq = 0;
    let offer = candidates(alice, duration, seen).slice(0, alice.mandate.reveal);
    if (!offer.length) {
      steps.push({ actor: alice, type: "WITHDRAW", text: "Alice's own mandate and calendar leave no free time this week, so her agent never sends an offer." });
      return { steps, agreed: null };
    }
    for (let round = 1; ; round++) {
      offer.forEach((s) => seen.add(s.start));
      steps.push({ actor: sender, type: round === 1 ? "PROPOSE" : "COUNTER", round, seq: ++seq, slots: offer,
        text: `${sender.name}'s agent shares ${offer.length} time${offer.length > 1 ? "s" : ""} (round ${round} of ${maxRounds}).` });
      const checked = offer.map((s) => ({ slot: s, reasons: check(receiver, s) }));
      const ok = checked.filter((c) => !c.reasons.length).map((c) => c.slot);
      steps.push({ actor: receiver, type: "CHECK", checked, text: `${receiver.name}'s agent checks each time against ${receiver.name}'s mandate and calendar.` });
      if (ok.length) {
        ok.sort((a, b) => score(receiver, a) - score(receiver, b) || a.start - b.start);
        steps.push({ actor: receiver, type: "ACCEPT", seq: ++seq, slots: [ok[0]],
          text: `${receiver.name}'s agent accepts its preferred valid time. Both sides now hold it; nobody is invited yet.` });
        return { steps, agreed: ok[0] };
      }
      if (round >= maxRounds) {
        steps.push({ actor: receiver, type: "DECLINE", seq: ++seq, text: `No overlap within ${maxRounds} rounds, the lower of the two round limits. The agents stop and each owner sees why.` });
        return { steps, agreed: null };
      }
      const next = candidates(receiver, duration, seen).slice(0, receiver.mandate.reveal);
      if (!next.length) {
        steps.push({ actor: receiver, type: "DECLINE", seq: ++seq, text: `${receiver.name}'s agent has no unseen free times left to offer.` });
        return { steps, agreed: null };
      }
      [sender, receiver, offer] = [receiver, sender, next];
    }
  }

  // ---- rendering ----------------------------------------------------
  const HOUR_PX = 34;
  let people = null, shown = { offers: [], agreed: null };

  function viewRange() {
    let lo = 24 * 60, hi = 0;
    for (const p of Object.values(people)) {
      const d = weekDates[0];
      for (const t of [p.mandate.earliest, p.mandate.latest]) {
        const ms = zoned(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(t / 60), t % 60, p.tz);
        const v = parts(ms, viewerTz);
        const m = v.h * 60 + v.min;
        lo = Math.min(lo, m); hi = Math.max(hi, m || 1440);
      }
    }
    lo = Math.max(0, Math.floor(lo / 60) - 1) * 60;
    hi = Math.min(24, Math.ceil(hi / 60) + 1) * 60;
    return [lo, hi];
  }

  function drawWeek() {
    const [lo, hi] = viewRange();
    const height = ((hi - lo) / 60) * HOUR_PX;
    const top = (ms) => { const v = parts(ms, viewerTz); return ((v.h * 60 + v.min - lo) / 60) * HOUR_PX; };
    const dayOf = (ms) => { const v = parts(ms, viewerTz); return weekDates.findIndex((d) => d.getUTCDate() === v.d && d.getUTCMonth() === v.m); };
    const block = (cls, s, e) => { const t = Math.max(0, top(s)); const b = Math.min(height, top(e)); return b > t ? `<div class="blk ${cls}" style="top:${t}px;height:${b - t}px"></div>` : ""; };
    const lanes = (di) => ["alice", "bob"].map((who) => {
      const p = people[who], d = weekDates[di];
      let html = "";
      if (p.mandate.days.has(di)) html += block("work", zoned(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(p.mandate.earliest / 60), p.mandate.earliest % 60, p.tz),
        zoned(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(p.mandate.latest / 60), p.mandate.latest % 60, p.tz));
      html += p.busy.filter((b) => dayOf(b.start) === di).map((b) => block("busy", b.start, b.end)).join("");
      html += shown.offers.filter((o) => o.who === who && dayOf(o.start) === di).map((o) => block("offer", o.start, o.end)).join("");
      if (shown.agreed && dayOf(shown.agreed.start) === di) html += block("agreed", shown.agreed.start, shown.agreed.end);
      return `<div class="lane" style="height:${height}px" aria-label="${p.name}">${html}</div>`;
    }).join("");
    let hours = "";
    const hourLabel = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", hour: "numeric" });
    for (let m = lo + 60; m < hi; m += 60) hours += `<span style="top:${((m - lo) / 60) * HOUR_PX}px">${hourLabel.format(new Date(Date.UTC(2026, 0, 5, m / 60)))}</span>`;
    $("#week").innerHTML = `<div></div>${weekDates.map((d) => `<div class="dayhead">${DAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}<div class="lane-label">A · B</div></div>`).join("")}
      <div class="hours" style="height:${height}px">${hours}</div>${weekDates.map((_, i) => `<div class="daycol">${lanes(i)}</div>`).join("")}`;
  }

  function load() {
    const heavy = $("#busy-week").checked;
    people = {};
    for (const [who, seed, name] of [["alice", 7, "Alice"], ["bob", 42, "Bob"]]) {
      const form = $(`#${who}`);
      people[who] = { who, name, tz: form.dataset.tz, mandate: mandate(form), busy: calendar(form.dataset.tz, seed, heavy) };
    }
    shown = { offers: [], agreed: null };
    drawWeek();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms));
  let running = false, approvals = new Set(), agreed = null;

  async function run() {
    if (running) return;
    running = true; $("#run").disabled = true; $("#approve").hidden = true; approvals = new Set(); agreed = null;
    $$("[data-approve]").forEach((b) => { b.setAttribute("aria-pressed", "false"); b.disabled = false; });
    load();
    const duration = Number($("#duration").value);
    const { steps, agreed: result } = negotiate(people.alice, people.bob, duration);
    const tl = $("#timeline");
    tl.innerHTML = "";
    $("#run-status").textContent = "Negotiating…";
    for (const step of steps) {
      await sleep(650);
      let body = "";
      if (step.slots && step.type !== "ACCEPT") {
        body = `<ul class="slotlist">${step.slots.map((s) => `<li>${esc(label(s.start, step.actor.tz))}</li>`).join("")}</ul>`;
        shown.offers.push(...step.slots.map((s) => ({ ...s, who: step.actor.who })));
      }
      if (step.checked) body = `<ul class="slotlist">${step.checked.map((c) => c.reasons.length
        ? `<li class="no">✗ ${esc(label(c.slot.start, step.actor.tz))}: ${esc(c.reasons.join("; "))}</li>`
        : `<li class="yes">✓ ${esc(label(c.slot.start, step.actor.tz))} fits</li>`).join("")}</ul>`;
      if (step.type === "ACCEPT") { shown.agreed = step.slots[0]; body = `<ul class="slotlist"><li class="yes">${esc(label(step.slots[0].start, step.actor.tz))}</li></ul>`; }
      const d = step.seq ? await digest({ type: step.type, seq: step.seq, from: step.actor.who, slots: (step.slots || []).map((s) => s.start) }) : "";
      tl.insertAdjacentHTML("beforeend", `<li class="${step.actor.who}"><span class="msg-type">${esc(step.type)}</span>${esc(step.text)}${body}
        ${d ? `<div class="digest">#${step.seq} · sha256 ${d}… (the server signs each message with Ed25519)</div>` : ""}</li>`);
      tl.scrollTop = tl.scrollHeight;
      drawWeek();
    }
    agreed = result;
    if (agreed) {
      $("#agreed-text").textContent = `Agreed: ${label(agreed.start, people.alice.tz)} for Alice, ${label(agreed.start, people.bob.tz)} for Bob.`;
      $("#approve").hidden = false;
      $("#run-status").textContent = "Waiting for both humans.";
    } else {
      $("#run-status").textContent = "No meeting. Loosen a mandate and try again.";
    }
    running = false; $("#run").disabled = false;
  }

  $$("[data-approve]").forEach((b) => (b.onclick = async () => {
    approvals.add(b.dataset.approve);
    b.setAttribute("aria-pressed", "true"); b.disabled = true;
    const who = people[b.dataset.approve].name;
    const tl = $("#timeline");
    tl.insertAdjacentHTML("beforeend", `<li class="${b.dataset.approve}"><span class="msg-type">APPROVE</span>${esc(who)} approves. ${approvals.size < 2 ? "Still waiting on the other person." : ""}</li>`);
    if (approvals.size === 2) {
      await sleep(500);
      tl.insertAdjacentHTML("beforeend", `<li class="system"><span class="msg-type">CONFIRM</span>Both approved. Only now does Alice's calendar send the invitation to bob@globex.example, and emails are exchanged for the first time.</li>`);
      $("#run-status").textContent = "Invitation sent.";
    }
    tl.scrollTop = tl.scrollHeight;
  }));

  // ---- setup --------------------------------------------------------
  for (const form of $$("form.person")) {
    $("[data-field=days]", form).innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}" checked>${d}</label>`).join("");
    form.addEventListener("change", () => { if (!running) load(); });
    form.addEventListener("submit", (e) => e.preventDefault());
  }
  $("#busy-week").onchange = () => { if (!running) load(); };
  $("#run").onclick = run;
  $("#viewer-tz").textContent = `(${viewerTz})`;
  load();
})();
