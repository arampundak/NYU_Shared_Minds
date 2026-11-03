// joint bars, loop-rate readout, calibration prompt

const COPY = "human → robot retargeting: the same teleop pattern used to collect robot-learning data.";

export function createHud({ jointNames, limits }) {
  const root = document.createElement("div");
  root.id = "hud";
  root.innerHTML = `
    <div id="hud-joints"></div>
    <div id="hud-msg"></div>
    <div id="hud-rates"></div>
    <div id="hud-copy">${COPY}</div>`;
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
  const msg = root.querySelector("#hud-msg");
  const rates = root.querySelector("#hud-rates");

  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "h") jointsEl.hidden = !jointsEl.hidden;
  });

  return {
    update({ angles, clamped, perceptionHz, controlHz, message }) {
      for (const name of Object.keys(rows)) {
        const { lower, upper } = limits[name];
        const frac = (angles[name] - lower) / (upper - lower);
        const bar = rows[name].querySelector("i");
        bar.style.left = `${Math.min(1, Math.max(0, frac)) * 100}%`;
        rows[name].classList.toggle("clamped", clamped.has(name));
      }
      msg.textContent = message ?? "";
      rates.textContent = `perception ${perceptionHz ? perceptionHz.toFixed(0) : "--"} Hz · control ${controlHz.toFixed(0)} Hz · network 20 Hz`;
    },
  };
}
