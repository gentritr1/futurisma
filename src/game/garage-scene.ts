import * as THREE from "three";
import { FLEET_CODES, TEAM_COLORS, frameModel, partAnchor } from "./garage-anchors";
import { showroomHull } from "./garage-look";
import type { PartCode } from "./garage-rules.js";

export interface GarageView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update(): void;
  hide(): void;
}

/** One bay in the game's renderer, with its own camera. The actual craft is
 * borrowed only while the bay is open. No clone, second WebGL context, chase
 * camera changes, or scenery leaking through the service view. */
export class GarageScene implements GarageView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
  private hull: THREE.Group | null = null;
  private parent: THREE.Object3D | null = null;
  private readonly savedPosition = new THREE.Vector3();
  private readonly savedRotation = new THREE.Quaternion();
  private readonly target = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly label = document.createElement("canvas");
  private readonly labelTexture: THREE.CanvasTexture;
  private frame = "";
  private part: PartCode | null = null;
  private test = false;
  private paint = false;
  private readonly composition = new THREE.Vector2(.54, .48);
  animating = true;
  private last = 0;
  private screenWidth = 0;
  private screenHeight = 0;
  private readonly owned = new THREE.Group();
  private readonly light: THREE.SpotLight;
  private readonly floor: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly serviceLight = new THREE.DirectionalLight(0xc4d5dc, .9);

  constructor(private readonly still: () => boolean, private readonly report: (point: {x: number; y: number; ready: boolean}) => void) {
    this.scene.name = "garage_service_bay";
    this.camera.name = "garage_service_camera";
    this.scene.background = new THREE.Color(0x070b0d);
    this.scene.fog = new THREE.Fog(0x070b0d, 24, 62);
    this.scene.add(this.owned, new THREE.HemisphereLight(0xb5d4dc, 0x3a352c, 2.0));
    const fill = new THREE.DirectionalLight(0xe8dcc6, 2.3);
    fill.position.set(-5, 9, 6);
    this.scene.add(fill);
    this.scene.add(this.serviceLight, this.serviceLight.target);
    this.light = new THREE.SpotLight(0xd7e7ef, 95, 28, .55, .6, 1.4);
    this.light.position.set(5, 9, -4);
    this.light.target.position.set(0, 0, 0);
    this.scene.add(this.light, this.light.target);
    const concrete = new THREE.MeshStandardMaterial({ color: 0x303b40, roughness: .96 });
    this.floor = new THREE.Mesh(new THREE.BoxGeometry(38, .25, 40), concrete);
    this.floor.position.y = -1.4;
    this.floor.receiveShadow = true;
    this.owned.add(this.floor);
    const wall = new THREE.MeshStandardMaterial({ color: 0x171e22, roughness: .9 });
    const rib = new THREE.BoxGeometry(.12, 9, .4);
    for (let x = -18; x <= 18; x += 1.5) {
      const mesh = new THREE.Mesh(rib, wall); mesh.position.set(x, 3, -12); this.owned.add(mesh);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(38, 10, .3), wall);
    back.position.set(0, 3, -12.3); this.owned.add(back);
    const paint = new THREE.MeshBasicMaterial({ color: 0xb6a775 });
    for (const [x, z, w, d] of [[-3.2, 0, .07, 10], [3.2, 0, .07, 10], [0, -5, 6.4, .07], [0, 5, 6.4, .07]]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, .015, d), paint);
      line.position.set(x, -1.263, z); this.owned.add(line);
    }
    // Physical paint on the apron; repeated marks stay inside the service bay.
    const hazard = new THREE.BoxGeometry(.4, .016, .9);
    for (let x = -3; x < 3.2; x += .65) {
      const mark = new THREE.Mesh(hazard, paint); mark.position.set(x, -1.26, 5.7); mark.rotation.y = -.4; this.owned.add(mark);
    }
    this.label.width = 512; this.label.height = 256;
    this.labelTexture = new THREE.CanvasTexture(this.label);
    this.labelTexture.colorSpace = THREE.SRGBColorSpace;
    const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.4), new THREE.MeshBasicMaterial({ map: this.labelTexture, transparent: true, depthWrite: false, opacity: .58 }));
    labelMesh.rotation.x = -Math.PI / 2; labelMesh.position.set(0, -1.25, 3.6); this.owned.add(labelMesh);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x030609, transparent: true, opacity: .42, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.scale.set(2.3, 3.8, 1); this.shadow.position.y = -1.245; this.owned.add(this.shadow);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, .1, .4), new THREE.MeshBasicMaterial({color: 0xd5e6e9}));
    lamp.position.copy(this.light.position); this.owned.add(lamp);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.5, 9, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xb6cbd3, transparent: true, opacity: .025, depthWrite: false, side: THREE.DoubleSide }));
    cone.position.set(4, 4.5, -3); this.owned.add(cone);
  }

  show(): void {
    this.hull = showroomHull();
    if (!this.hull || this.parent) return;
    this.parent = this.hull.parent;
    this.savedPosition.copy(this.hull.position);
    this.savedRotation.copy(this.hull.quaternion);
    this.scene.add(this.hull);
    this.hull.position.set(0, 0, 0); this.hull.rotation.set(0, 0, 0);
    this.last = 0; this.animating = true;
  }

  select(frame: string, part: PartCode | null, test: boolean, paint = false): void {
    if (frame === this.frame && part === this.part && test === this.test && paint === this.paint) return;
    this.animating = true;
    this.frame = frame; this.part = part; this.test = test; this.paint = paint;
    const ctx = this.label.getContext("2d")!;
    ctx.clearRect(0, 0, 512, 256);
    ctx.fillStyle = TEAM_COLORS[frame]; ctx.font = "900 230px 'Barlow Condensed', sans-serif";
    ctx.textAlign = "center"; ctx.fillText(FLEET_CODES[frame], 256, 213);
    this.labelTexture.needsUpdate = true;
  }

  update = (): void => {
    if (!this.parent) this.show();
    const hull = this.hull;
    if (!hull) return;
    const width = window.innerWidth, height = window.innerHeight;
    const portrait = width / height < .85;
    const narrow = width < 1100;
    const now = performance.now();
    const delta = this.last ? Math.min(.05, (now - this.last) / 1000) : 0;
    const cut = !this.last || this.still() || width !== this.screenWidth || height !== this.screenHeight;
    this.last = now; this.screenWidth = width; this.screenHeight = height;
    this.camera.aspect = width / height;
    // A restrained suspension hover; close-ups stay still for inspection.
    // No accumulating offsets and no turntable that drifts away from a part.
    hull.rotation.y = 0; hull.position.z = 0;
    hull.position.y = !this.still() && !this.part && !this.test ? Math.sin(now * .0014) * .035 : 0;
    this.scene.updateMatrixWorld(true);
    const model = frameModel(hull, this.frame);
    const spec = this.part ? partAnchor(hull, this.frame, this.part, this.target) : null;
    if (this.part && !spec || !model) { this.report({x: 0, y: 0, ready: false}); return; }
    let span: number, x: number, y: number;
    if (spec) {
      span = spec.span;
      this.desiredPosition.fromArray(spec.direction).normalize();
      x = portrait ? .5 : narrow ? .34 : .43; y = portrait ? .427 : .49;
    } else {
      this.target.set(0, .1, -.35);
      this.desiredPosition.set(this.test ? 3 : this.paint ? -6 : 7.5, this.test ? 4 : this.paint ? 7 : 6, this.test ? 13 : 10).normalize();
      span = this.test ? 15 : portrait ? 8.4 : 10.7;
      x = portrait ? .5 : .54; y = portrait ? .34 : .48;
    }
    // Fit by horizontal span and vertical safe area, rather than a fixed
    // camera distance that crops narrow phones or unusually tall windows.
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const distance = spec ? Math.max(span / (tan * this.camera.aspect * (portrait ? 1.75 : .85)), span * 1.7)
      : Math.max(span / (tan * this.camera.aspect * (portrait ? 1.75 : 1.1)), span * (portrait ? 1.15 : .85));
    this.desiredPosition.multiplyScalar(distance).add(this.target);
    const ease = cut ? 1 : 1 - Math.exp(-delta * 13);
    this.camera.position.lerp(this.desiredPosition, ease);
    this.look.lerp(this.target, ease);
    this.composition.lerp(new THREE.Vector2(x,y), ease);
    this.camera.setViewOffset(width, height, (.5 - this.composition.x) * width, (.5 - this.composition.y) * height, width, height);
    this.camera.lookAt(this.look); this.camera.updateMatrixWorld(true);
    this.serviceLight.visible = this.part !== null;
    this.serviceLight.position.copy(this.camera.position);
    this.serviceLight.target.position.copy(this.target);
    this.projected.copy(this.target).project(this.camera);
    this.report({x: (this.projected.x + 1) * width / 2, y: (1 - this.projected.y) * height / 2, ready: true});
    this.animating = !this.still() && !this.part && !this.test || this.camera.position.distanceToSquared(this.desiredPosition) > .00001 || this.look.distanceToSquared(this.target) > .00001;
  };

  hide(): void {
    if (this.hull && this.parent) {
      this.parent.add(this.hull);
      this.hull.position.copy(this.savedPosition); this.hull.quaternion.copy(this.savedRotation);
    }
    this.parent = null; this.hull = null; this.last = 0;
  }

  dispose(): void {
    this.hide();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.owned.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.labelTexture.dispose(); this.scene.clear();
  }
}
