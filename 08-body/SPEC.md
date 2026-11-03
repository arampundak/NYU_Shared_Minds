# SO-100 Duel — Spec

A two-player, two-laptop browser game. Each player controls a simulated SO-100 arm holding a glowing laser sword using their whole body (webcam + ml5 bodyPose). The two arms fence in a shared three.js scene. Smooth play beats physical accuracy. The SO-100 must be recognizable, and the robotics overlays should intrigue robotics people.

Context: NYU ITP, Shared Minds (Dano). Week brief: an interface that asks more from the body than mouse and keyboard; flow, not sequence.

## Stack (no build step)
- Plain HTML + ES modules, `importmap` from a CDN, pinned versions.
- three.js + `urdf-loader` (gkjohnson) + `UnrealBloomPass` for glow.
- ml5.js v1, `bodyPose("MoveNet", { modelType: "SINGLEPOSE_LIGHTNING" })`. Use a plain `<video>` element or p5 in instance mode only. Do not let p5 create a competing canvas.
- Networking: p5LiveMedia data channel (primary), Firebase Realtime DB (fallback, free Spark plan, no Storage). One module, `net.js`, with the same interface for both.
- `lil-gui` for debug sliders.
- Serve locally with `npx serve` (the camera needs localhost or https). Deploy on GitHub Pages.

## Files
```
index.html
src/main.js      // render loop, game state
src/robot.js     // URDF load, setJoints(), blade, link segments
src/pose.js      // ml5, keypoints -> joint angles, calibration, one-euro filter
src/net.js       // send/receive joint frames, interpolation buffer
src/collide.js   // segment-segment distance, hits, clashes
src/hud.js       // joint bars, loop-rate readout, score
assets/so100/    // URDF + simplified meshes (GLB preferred)
```

## Robot
- URDF from TheRobotStudio SO-ARM100 repo (check its license). Remap `package://` paths to `assets/so100/`. Rotate −90° on X (ROS is Z-up, three is Y-up).
- Decimate the meshes (Blender, about 10–20k tris total) and convert them to GLB if loading is slow.
- Look: printed plastic (one color per player), black Feetech servos.
- Joints: shoulder_pan, shoulder_lift, elbow_flex, wrist_flex, wrist_roll, gripper. Read the limits from the URDF and clamp to them.
- The blade is an emissive cylinder (about 0.25 m) parented to the gripper link, with a bloom glow and a per-player color.
- Fallback if the URDF fights you for more than 30 minutes: boxes and cylinders with SO-100 proportions and the same joint names.

## Pose → joints (retargeting)
Use the player's sword arm (default right, with a left-handed toggle). Mirror the webcam.
| joint | source |
|---|---|
| shoulder_pan | hip-center x offset + shoulder-line tilt (lean/shift the body) |
| shoulder_lift | upper-arm angle vs torso (arm overhead = raised) |
| elbow_flex | elbow angle |
| wrist_flex | forearm angle relative to the upper arm, scaled |
| wrist_roll | other hand's height (optional) |
| gripper | fixed closed (holding the sword) |

- **Calibration:** a 3-second neutral pose at the start that records the player's shoulder width and center. Normalize everything by shoulder width so distance from the camera doesn't matter.
- Ignore keypoints with confidence below 0.3 and hold the last good value.
- Use a one-euro filter per joint, then clamp to the URDF limits. When a joint is clamped, flag it for the HUD.

## Loops (deliberately decoupled; show these rates on screen)
- Perception: ml5 runs as fast as it can (~30 Hz) and writes target angles.
- Control/render: 60 fps. Each joint moves toward its target with a max velocity, which gives the arms weight.
- Network: send own joint targets at 20 Hz. Render the opponent about 100 ms behind with interpolation between buffered frames.

## Scene
- Two bases facing each other. Tune the distance so the blades only meet in the middle.
- Camera: behind and above your own robot (each laptop sees from its own side). Dark floor, grid, bloom.
- Small mirrored webcam preview in a corner with the skeleton overlay. Optional opponent video via p5LiveMedia.

## Game
- Treat each blade and each robot link as a 3D line segment.
- Clash: when blade-blade distance is under a threshold, show sparks, play a clash sound, and push both arms back briefly.
- Hit: your blade touches an opponent link (the upper links score more than the base). There's a 1-second invulnerability after a hit so one touch doesn't score 60 times.
- Authority: each client judges hits on its own robot and broadcasts `{type:"hit", by, link}`. The defender's screen is the truth.
- Rounds: 60 s or first to 5. Show the score and a countdown.

## Robotics overlays (toggle with keys)
- `H` toggles the joint HUD: each joint's name, a live bar against its URDF limits, and red when clamped.
- `F` toggles frames: RGB axes on every link plus a trail of the blade tip.
- Always on: "perception XX Hz · control 60 Hz · network 20 Hz".
- One line of copy: "human → robot retargeting: the same teleop pattern used to collect robot-learning data."

## Milestones (commit after each; test in the browser before moving on)
1. Scene with two URDF arms facing each other, a lil-gui slider per joint, and blades. **This proves the URDF and joint names.**
2. Webcam + bodyPose drive your own arm, with calibration, filtering and the HUD.
3. Solo test mode: a scripted dummy opponent wiggles, with collision, scoring and sparks. **The game works offline.**
4. Networking: two tabs on one machine, then two laptops. Add the interpolation buffer and hit authority.
5. Polish: frames view, loop rates, sound, a start screen with room code entry.

## Known risks
- School Wi-Fi can block peer-to-peer WebRTC. Firebase is the fallback; test on NYU Wi-Fi before demo day.
- Players need about 2 m from the laptop to fit their arms overhead. Use a 640×480 camera feed for speed.
- ml5 and three share the GPU. Test on the slower laptop.
- Never invent URDF joint names or limits. Read them from the file.
