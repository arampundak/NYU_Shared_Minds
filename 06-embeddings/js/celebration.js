// celebration.js — the "you found it!" moment: confetti, a big card, a chime.

const overlay = document.getElementById("celebration");
const confettiCanvas = document.getElementById("confetti");
const titleEl = document.getElementById("celebration-title");
const lineEl = document.getElementById("celebration-line");
const nextEl = document.getElementById("celebration-next");
const closeButton = document.getElementById("celebration-close");

const CONFETTI_COLORS = ["#ffd54a", "#ff5c8a", "#4cc9f0", "#7bd88f", "#b583ff", "#ff9f43"];
const SPAWN_SECONDS = 1.2;

let particles = [];
let animationFrame = null;

// A rising four-note chime made with the Web Audio API, so no sound files.
function playChime() {
  try {
    const audio = new AudioContext();
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + i * 0.12;
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.55);
    });
  } catch {}
}

function spawnConfetti(width, count) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * width,
      y: -10 - Math.random() * 40,
      vx: (Math.random() - 0.5) * 120,
      vy: 80 + Math.random() * 160,
      size: 6 + Math.random() * 8,
      spin: Math.random() * Math.PI,
      spinSpeed: (Math.random() - 0.5) * 10,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    });
  }
}

function runConfetti() {
  const ctx = confettiCanvas.getContext("2d");
  confettiCanvas.width = overlay.clientWidth;
  confettiCanvas.height = overlay.clientHeight;
  particles = [];
  const startedAt = performance.now();
  let last = startedAt;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((now - startedAt) / 1000 < SPAWN_SECONDS) spawnConfetti(confettiCanvas.width, 10);

    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += p.spinSpeed * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    particles = particles.filter((p) => p.y < confettiCanvas.height + 20);
    animationFrame = particles.length || (now - startedAt) / 1000 < SPAWN_SECONDS
      ? requestAnimationFrame(frame)
      : null;
  }
  animationFrame = requestAnimationFrame(frame);
}

function close() {
  overlay.hidden = true;
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = null;
}
closeButton.addEventListener("click", close);

// `nextQuest` is the name of the next object to find, or null if nothing is left.
export function celebrate({ objectName, score, nextQuest }) {
  const everything = !nextQuest;
  titleEl.textContent = everything ? "You found everything!" : `You found the ${objectName}!`;
  lineEl.textContent = everything
    ? `That was the ${objectName}, the last hidden object for now. Score: ${score}.`
    : `Objects found: ${score}`;
  nextEl.textContent = everything
    ? "More turn up as new rooms are written. Come back later."
    : `Next quest: find the ${nextQuest}`;
  closeButton.textContent = everything ? "Wander on" : "Keep exploring";

  overlay.hidden = false;
  // restart the CSS pop animation
  titleEl.style.animation = "none";
  void titleEl.offsetWidth;
  titleEl.style.animation = "";
  runConfetti();
  playChime();
}
