import * as THREE from "three";
import URDFLoader from "urdf-loader";

const URDF_URL = "assets/so100/so100.urdf";
const BLADE_LENGTH = 0.25;
const BLADE_RADIUS = 0.006;

// joint names and limits come from the URDF, never hardcoded
export async function loadRobot({ color, blade }) {
  const loader = new URDFLoader();
  const materials = makeMaterials(color);
  // STL meshes arrive asynchronously, so recolor each one as it loads
  const defaultMeshCb = loader.loadMeshCb;
  loader.loadMeshCb = (path, manager, done) =>
    defaultMeshCb.call(loader, path, manager, (mesh, err) => {
      done(mesh, err);
      if (mesh) mesh.material = /_Motor\.stl$/.test(path) ? materials.servo : materials.plastic; // loader sets its own material inside done()
    });
  const urdf = await new Promise((resolve, reject) => loader.load(URDF_URL, resolve, undefined, reject));

  // ROS is Z-up, three is Y-up
  urdf.rotation.x = -Math.PI / 2;
  const root = new THREE.Group();
  root.add(urdf);

  const joints = Object.values(urdf.joints).filter((j) => j.jointType === "revolute");
  const limits = {};
  for (const j of joints) limits[j.name] = { lower: j.limit.lower, upper: j.limit.upper };

  const bladeMesh = makeBlade(blade);
  urdf.links.gripper.add(bladeMesh);

  return {
    root,
    urdf,
    limits,
    jointNames: joints.map((j) => j.name),
    blade: bladeMesh,
    // clamps to URDF limits; returns names of joints that hit a limit
    setJoints(angles) {
      const clamped = [];
      for (const [name, v] of Object.entries(angles)) {
        const { lower, upper } = limits[name];
        const c = Math.min(upper, Math.max(lower, v));
        if (c !== v) clamped.push(name);
        urdf.setJointValue(name, c);
      }
      return clamped;
    },
  };
}

// printed plastic gets the player color, servos stay black
function makeMaterials(color) {
  return {
    plastic: new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }),
    servo: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, metalness: 0.3 }),
  };
}

// emissive cylinder along the gripper's pointing axis (-Y in the gripper link frame)
function makeBlade(color) {
  const geo = new THREE.CylinderGeometry(BLADE_RADIUS, BLADE_RADIUS, BLADE_LENGTH, 16);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3) });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(0, -0.06 - BLADE_LENGTH / 2, 0);
  return m;
}
