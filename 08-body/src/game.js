// rounds, scoring, clashes and hits.
// Authority: the defender's client judges hits on its own robot. `judge` lists the robot indices this client
// decides for: [0] when networked, [0, 1] in solo mode where the dummy lives here too.
import { findClash, findHit } from "./collide.js";

export const ROUND_SECONDS = 60;
export const WIN_SCORE = 5;
const INVULN_SECONDS = 1;
const CLASH_DISTANCE = 0.04;
const CLASH_COOLDOWN = 0.35;
const COUNTDOWN_SECONDS = 3;

export function createGame({ robots, fx, judge = [0, 1] }) {
  const game = {
    state: "idle",              // idle | countdown | playing | over
    time: ROUND_SECONDS,
    countdown: 0,
    scores: [0, 0],
    invuln: [0, 0],
    clashCooldown: 0,
    recoil: [0, 0],             // 1 right after a clash or hit, decays to 0
    flash: [0, 0],
    banner: "press Enter to start",
    bannerTime: Infinity,
    judge,
    onHit: null,                // set by main: tell the opponent about a hit we judged on our own robot

    start() {
      Object.assign(game, {
        state: "countdown", time: ROUND_SECONDS, countdown: COUNTDOWN_SECONDS,
        scores: [0, 0], invuln: [0, 0], clashCooldown: 0, recoil: [0, 0], flash: [0, 0],
      });
      fx.beep();
    },

    say(text, seconds = 1.2) { game.banner = text; game.bannerTime = seconds; },

    // the opponent's client judged that our blade hit them: it is the truth, we just show it
    remoteHit({ w, link }) {
      if (game.state !== "playing") return;
      game.scores[0] += w;
      game.flash[1] = 1;
      game.recoil[1] = 1;
      const seg = robots[1].segments().find((l) => l.name === link) ?? robots[1].segments()[2];
      fx.hit(seg.a.clone().lerp(seg.b, 0.5), robots[0].bladeColor);
      game.say(`HIT  +${w} (${link})`);
    },

    // extra joint offsets so arms get pushed back on a clash or hit
    recoilOffset(i, side = 1) {
      const r = game.recoil[i];
      return { elbow_flex: 0.7 * r, shoulder_lift: -0.5 * r, shoulder_pan: 0.35 * r * side };
    },

    update(dt) {
      game.clashCooldown = Math.max(0, game.clashCooldown - dt);
      for (let i = 0; i < 2; i++) {
        game.invuln[i] = Math.max(0, game.invuln[i] - dt);
        game.recoil[i] *= Math.exp(-dt * 7);
        game.flash[i] = Math.max(0, game.flash[i] - dt * 3);
        const m = robots[i].materials.plastic;
        m.emissive.setRGB(game.flash[i], game.flash[i] * 0.1, game.flash[i] * 0.15);
      }
      if (game.bannerTime !== Infinity) {
        game.bannerTime -= dt;
        if (game.bannerTime <= 0 && game.state === "playing") game.banner = "";
      }

      if (game.state === "countdown") {
        const before = Math.ceil(game.countdown);
        game.countdown -= dt;
        game.banner = String(Math.max(1, Math.ceil(game.countdown)));
        game.bannerTime = Infinity;
        if (Math.ceil(game.countdown) !== before && game.countdown > 0) fx.beep();
        if (game.countdown <= 0) { game.state = "playing"; game.say("FIGHT!"); fx.beep(true); }
        return;
      }
      if (game.state !== "playing") return;

      game.time = Math.max(0, game.time - dt);
      const blades = robots.map((r) => r.bladeSegment());

      const clash = game.clashCooldown === 0 && findClash(blades[0], blades[1], CLASH_DISTANCE);
      if (clash) {
        fx.clash(clash);
        game.clashCooldown = CLASH_COOLDOWN;
        game.recoil = [1, 1];
      } else {
        for (const d of game.judge) {
          const a = 1 - d;
          if (game.invuln[d] > 0) continue;
          const hit = findHit(blades[a], robots[d].segments());
          if (!hit) continue;
          game.scores[a] += hit.link.weight;
          game.invuln[d] = INVULN_SECONDS;
          game.flash[d] = 1;
          game.recoil[d] = 1;
          fx.hit(hit.point, robots[a].bladeColor);
          game.say(`${a === 0 ? "HIT" : "OUCH"}  +${hit.link.weight} (${hit.link.name})`);
          game.onHit?.({ w: hit.link.weight, link: hit.link.name, by: a });
        }
      }

      const [a, b] = game.scores;
      if (a >= WIN_SCORE || b >= WIN_SCORE || game.time === 0) {
        game.state = "over";
        game.banner = a === b ? "DRAW" : a > b ? "YOU WIN" : "YOU LOSE";
        game.bannerTime = Infinity;
        fx.beep(true);
      }
    },
  };
  return game;
}
