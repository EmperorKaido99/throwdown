import * as THREE from "three";

// The fight, as player one sees it.
//
// Third-person over the shoulder: your own boxer stands in the lower middle of
// frame with his back to you and his gloves up, and the opponent faces you
// across a bright ring. That framing is the reference the project owner gave,
// and it earns its keep — you can read your own guard and your own punches,
// which a first-person view cannot show without a rigged pair of arms.
//
// Framework-free on purpose. This module owns a Three.js scene and knows
// nothing about React or the simulation; it is handed a plain snapshot each
// frame and moves things to match. Game rules never leak into presentation,
// per 01-ARCHITECTURE.md.
//
// Everything is built from primitives. There is no rigged, skinned character
// and deliberately so: the avatar scope note defers a real rig, and a stylised
// figure of spheres and capsules reads fine at this range while costing almost
// nothing on a phone.

export type Hand = "left" | "right";

/** Everything the renderer needs for one frame. Pure data. */
export interface ArenaView {
  opponentLean: number;
  opponentDuck: number;
  /** 0..1 — how staggered the opponent is. */
  opponentStun: number;
  opponentPunch: { hand: Hand; progress: number } | null;
  playerLean: number;
  playerDuck: number;
  playerStun: number;
  playerPunch: { hand: Hand; progress: number } | null;
}

export const NEUTRAL_VIEW: ArenaView = {
  opponentLean: 0,
  opponentDuck: 0,
  opponentStun: 0,
  opponentPunch: null,
  playerLean: 0,
  playerDuck: 0,
  playerStun: 0,
  playerPunch: null,
};

const RING_HALF = 3;
const PLAYER_Z = 0.9;
const OPPONENT_Z = -1.35;

/** Frame-rate independent smoothing toward a target. */
function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

interface Boxer {
  root: THREE.Group;
  head: THREE.Mesh;
  torso: THREE.Mesh;
  gloves: Record<Hand, THREE.Mesh>;
  /** Glove rest position, so a punch can return to it. */
  gloveHome: Record<Hand, THREE.Vector3>;
  /** +1 for the near boxer punching away, -1 for the far boxer punching at us. */
  reachDirection: number;
}

export class Arena {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private player: Boxer;
  private opponent: Boxer;

  private smooth = {
    pLean: 0,
    pDuck: 0,
    pStun: 0,
    oLean: 0,
    oDuck: 0,
    oStun: 0,
  };
  private clock = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Phones would otherwise render this at full device resolution, which is
    // wasted on flat-shaded primitives.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x0d1b2a);
    this.scene.fog = new THREE.Fog(0x0d1b2a, 9, 20);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 60);
    this.scene.add(this.camera);

    this.buildLights();
    this.buildRing();
    this.buildCrowd();

    // Near boxer is you, seen from behind, so his gloves travel away from the
    // camera. The far boxer's gloves travel toward it.
    this.player = this.buildBoxer({
      z: PLAYER_Z,
      facing: 0,
      kit: 0xf2f2f2,
      trim: 0x2f7fd9,
      glove: 0x2f5fd9,
      reachDirection: -1,
    });
    this.opponent = this.buildBoxer({
      z: OPPONENT_Z,
      facing: Math.PI,
      kit: 0xf2f2f2,
      trim: 0xd94f5c,
      glove: 0xd93b46,
      reachDirection: 1,
    });
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8faf, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 8, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd9ff, 1.0);
    fill.position.set(-4, 3, -5);
    this.scene.add(fill);
  }

  private buildRing() {
    // Pale blue canvas — the single most recognisable thing about the look.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(RING_HALF * 2, 0.25, RING_HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x9fd2e8, roughness: 0.95 })
    );
    floor.position.y = -0.125;
    this.scene.add(floor);

    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(RING_HALF * 2.2, 0.5, RING_HALF * 2.2),
      new THREE.MeshStandardMaterial({ color: 0x24405c, roughness: 0.9 })
    );
    apron.position.y = -0.5;
    this.scene.add(apron);

    // Centre circle, so lateral movement reads against something.
    const centre = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.24, 48),
      new THREE.MeshBasicMaterial({ color: 0x7ab8d4, side: THREE.DoubleSide })
    );
    centre.rotation.x = -Math.PI / 2;
    centre.position.y = 0.002;
    this.scene.add(centre);

    const postMat = new THREE.MeshStandardMaterial({
      color: 0xd6303c,
      roughness: 0.45,
    });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, 1.7, 14),
          postMat
        );
        post.position.set(sx * RING_HALF, 0.85, sz * RING_HALF);
        this.scene.add(post);
      }
    }

    // Red on top, then blue, then white — the ringside banding in the
    // reference.
    const ropes: [number, number][] = [
      [1.35, 0xe0454f],
      [1.0, 0x3663c4],
      [0.65, 0xf4f4f4],
    ];
    for (const [y, colour] of ropes) {
      const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
      for (const [x, z, rotY] of [
        [0, -RING_HALF, 0],
        [0, RING_HALF, 0],
        [-RING_HALF, 0, Math.PI / 2],
        [RING_HALF, 0, Math.PI / 2],
      ] as const) {
        const rope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, RING_HALF * 2, 8),
          mat
        );
        rope.rotation.z = Math.PI / 2;
        rope.rotation.y = rotY;
        rope.position.set(x, y, z);
        this.scene.add(rope);
      }
    }
  }

  /**
   * Ringside crowd. Deliberately crude — capsules and spheres in assorted
   * colours, placed on a deterministic pattern rather than at random so the
   * scene is identical on both players' devices and in any replay.
   */
  private buildCrowd() {
    const palette = [
      0xe0a5a5, 0x8fb7d9, 0xd9c78f, 0xa9d9a2, 0xc9a2d9, 0xd9a37a, 0x9aa7ba,
    ];
    const crowd = new THREE.Group();
    const rows = 3;
    const perRow = 34;

    for (let r = 0; r < rows; r++) {
      const radius = RING_HALF + 1.1 + r * 0.85;
      const y = -0.35 + r * 0.32;
      for (let i = 0; i < perRow; i++) {
        const angle = (i / perRow) * Math.PI * 2 + r * 0.09;
        const colour = palette[(i + r * 3) % palette.length];
        const person = new THREE.Group();

        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.17, 0.3, 4, 8),
          new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9 })
        );
        body.position.y = 0.3;
        person.add(body);

        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.9 })
        );
        head.position.y = 0.72;
        person.add(head);

        person.position.set(
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius
        );
        person.lookAt(0, y + 0.7, 0);
        crowd.add(person);
      }
    }
    this.scene.add(crowd);
  }

  private buildBoxer(opts: {
    z: number;
    facing: number;
    kit: number;
    trim: number;
    glove: number;
    reachDirection: number;
  }): Boxer {
    const root = new THREE.Group();
    root.position.set(0, 0, opts.z);
    root.rotation.y = opts.facing;

    const skin = new THREE.MeshStandardMaterial({
      color: 0xc98d66,
      roughness: 0.85,
    });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 18), skin);
    head.position.y = 1.62;
    head.scale.set(1, 1.12, 1);
    root.add(head);

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.26, 0.4, 8, 20),
      new THREE.MeshStandardMaterial({ color: opts.kit, roughness: 0.8 })
    );
    torso.position.y = 1.12;
    root.add(torso);

    const shorts = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.24, 0.34, 6, 16),
      new THREE.MeshStandardMaterial({ color: opts.trim, roughness: 0.85 })
    );
    shorts.position.y = 0.66;
    root.add(shorts);

    for (const sx of [-1, 1] as const) {
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.1, 0.42, 6, 12),
        skin
      );
      leg.position.set(sx * 0.14, 0.26, 0);
      root.add(leg);
    }

    const gloveMat = new THREE.MeshStandardMaterial({
      color: opts.glove,
      roughness: 0.4,
      metalness: 0.05,
    });
    const gloves = {} as Record<Hand, THREE.Mesh>;
    const gloveHome = {} as Record<Hand, THREE.Vector3>;
    for (const [hand, sx] of [
      ["left", -1],
      ["right", 1],
    ] as const) {
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 16), gloveMat);
      // Held up in guard, just in front of the chin.
      const home = new THREE.Vector3(sx * 0.26, 1.42, 0.24);
      g.position.copy(home);
      g.scale.set(1, 1.1, 1.25);
      root.add(g);
      gloves[hand] = g;
      gloveHome[hand] = home;
    }

    this.scene.add(root);
    return { root, head, torso, gloves, gloveHome, reachDirection: opts.reachDirection };
  }

  private poseBoxer(
    b: Boxer,
    lean: number,
    duck: number,
    stun: number,
    punch: { hand: Hand; progress: number } | null,
    phase: number
  ) {
    const bob = Math.sin(phase * 2.6) * 0.02;
    const sway = Math.sin(phase * 1.4) * 0.035;

    b.root.position.x = lean * 0.34 + sway;
    b.root.position.y = -duck * 0.36 + bob;
    b.root.rotation.z = -lean * 0.15;

    // A staggered boxer's head lolls — the clearest read at this distance that
    // a punch actually landed.
    b.head.rotation.z = stun * Math.sin(phase * 22) * 0.45;
    b.torso.rotation.z = stun * Math.sin(phase * 18) * 0.12;

    for (const hand of ["left", "right"] as const) {
      const g = b.gloves[hand];
      const home = b.gloveHome[hand];
      const active = punch && punch.hand === hand ? punch.progress : 0;
      // Ease so the glove leaps out and decelerates into the landing; linear
      // travel reads as floaty.
      const reach = Math.sin(Math.min(1, Math.max(0, active)) * Math.PI) ** 0.65;

      g.position.z = home.z + reach * 1.15 * b.reachDirection * -1;
      g.position.x = home.x * (1 - reach * 0.55);
      g.position.y = home.y + reach * 0.04;
      // The far boxer's glove grows as it comes at the camera; yours shrinks
      // slightly as it travels away. Both are just perspective made explicit.
      g.scale.setScalar(1 + reach * 0.3 * b.reachDirection);
    }
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(view: ArenaView, dt: number) {
    this.clock += dt;
    const s = this.smooth;

    s.pLean = damp(s.pLean, view.playerLean, 14, dt);
    s.pDuck = damp(s.pDuck, view.playerDuck, 14, dt);
    s.pStun = damp(s.pStun, view.playerStun, 10, dt);
    s.oLean = damp(s.oLean, view.opponentLean, 14, dt);
    s.oDuck = damp(s.oDuck, view.opponentDuck, 14, dt);
    s.oStun = damp(s.oStun, view.opponentStun, 10, dt);

    this.poseBoxer(
      this.player,
      s.pLean,
      s.pDuck,
      s.pStun,
      view.playerPunch,
      this.clock
    );
    this.poseBoxer(
      this.opponent,
      s.oLean,
      s.oDuck,
      s.oStun,
      view.opponentPunch,
      this.clock + 1.7
    );

    // Camera sits behind and above your boxer and follows him loosely, so your
    // own head movement is visible as a shift of the whole view rather than
    // only as the figure sliding across a static frame.
    // High enough that the sight line clears your own boxer's head — the first
    // attempt put the camera at his eye level and he blocked the opponent
    // completely. You should see over him, with his head and gloves framing the
    // bottom of the view.
    // Far enough back and high enough that your own boxer sits in the bottom
    // third and the opponent is unobstructed. Two earlier attempts put the
    // camera too low: at eye level he hid the opponent entirely, and at 2.6 his
    // head still filled the middle of the frame.
    this.camera.position.set(
      this.player.root.position.x * 0.45,
      3.05 - s.pDuck * 0.32,
      PLAYER_Z + 3.0
    );
    this.camera.lookAt(
      this.opponent.root.position.x * 0.3,
      1.3 - s.pDuck * 0.18,
      OPPONENT_Z - 0.1
    );

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m) (m as THREE.Material).dispose();
    });
    this.renderer.dispose();
  }
}
