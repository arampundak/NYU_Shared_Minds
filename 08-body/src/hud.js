// joint bars, loop-rate readout, calibration prompt

const COPY = "human → robot retargeting: the same teleop pattern used to collect robot-learning data.";

export function createHud({ jointNames, limits }) {
  const root = document.createElement("div");
  root.id = "hud";
  root.innerHTML = `
    <div id="hud-score"></div>
    <div id="hud-banner"></div>
    <div id="hud-sub"></div>
    <div id="hud-joints"></div>
    <div id="hud-msg"></div>
    <div id="hud-rates"></div>
    <div id="hud-copy">${COPY}</div>
    <div id="hud-keys">H joints · F frames · C recalibrate · Enter start · L copy invite link</div>`;
  document.body.appendChild(root);

  const jointsEl = root.querySelector("#hud-joints");
  const rows = {};
  for (const name of jointNames) {
    const row = document.createElement("div");
    row.className = "hud-row";
    row.innerHTML = `<span class="hud-name">${name}</span><span class="hud-bar"><i></i></span>`;
    jointsEl.appendChild(row);
    rows[name] = row;
  }
  const scoreEl = root.querySelector("#hud-score");
  const bannerEl = root.querySelector("#hud-banner");
  const subEl = root.querySelector("#hud-sub");
  const msg = root.querySelector("#hud-msg");
  const rates = root.querySelector("#hud-rates");

  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "h") jointsEl.hidden = !jointsEl.hidden;
  });

  return {
    setGame({ scores, time, banner, sub = "", names }) {
      const t = Math.ceil(time);
      scoreEl.innerHTML = `<b class="me">${names[0]} ${scores[0]}</b><span>${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}</span><b class="opp">${scores[1]} ${names[1]}</b>`;
      bannerEl.textContent = banner;
      subEl.textContent = sub;
    },
    update({ angles, clamped, perceptionHz, handHz, controlHz, net, message }) {
      for (const name of Object.keys(rows)) {
        const { lower, upper } = limits[name];
        const frac = (angles[name] - lower) / (upper - lower);
        const bar = rows[name].querySelector("i");
        bar.style.left = `${Math.min(1, Math.max(0, frac)) * 100}%`;
        rows[name].classList.toggle("clamped", clamped.has(name));
      }
      msg.textContent = message ?? "";
      rates.textContent = `perception ${perceptionHz ? perceptionHz.toFixed(0) : "--"} Hz (hand ${handHz ? handHz.toFixed(0) : "--"}) · control ${controlHz.toFixed(0)} Hz · network ${net ? `${net.transport} ${net.outHz.toFixed(0)}↑ ${net.inHz.toFixed(0)}↓ — ${net.status}` : "solo (offline)"}`;
    },
  };
}
