import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {RaceCourse} from './course';
import type {CircuitRuntime} from './circuit-runtime';

// Frostline's snow/ice warning structures already occupy its gate approaches.
const KIT_MAPS = new Set(['greenwater', 'bitterpan', 'nightshift', 'afterglow']);
const OFF = new THREE.Color(0x35474b);
const NEXT = new THREE.Color(0xffbf68);
const CLEAR = new THREE.Color(0xb7e994);

/** Decorative timing hardware. The course remains the sole owner of gates:
 * these lights mirror its checkpoint writes and never test a crossing. */
class RaceTimingKit {
  readonly root = new THREE.Group();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly lens!: THREE.InstancedMesh;
  private readonly placements: THREE.Matrix4[] = [];
  private readonly originalCheckpoint: RaceCourse['setCheckpointProgress'];
  private readonly checkpointWriter: RaceCourse['setCheckpointProgress'];
  private next = 1;
  private previousCountdown = '';
  private disposed = false;

  constructor(private readonly course: RaceCourse, source: THREE.Group) {
    this.root.name = 'race_timing_hardware';
    source.updateMatrixWorld(true);
    const signParts: THREE.BufferGeometry[] = [];
    const rows = course.checkpointCount + 1;
    const signAtlas = this.createSignAtlas(rows);
    const matrix = new THREE.Matrix4();
    const offset = new THREE.Matrix4();
    for (let gate = 0; gate < rows; gate++) {
      const sample = course.sample(course.checkpointProgress(gate));
      // Course right is forward × up. Negate it to form a proper (unmirrored)
      // glTF basis; reflected instance matrices reverse the reader's faces.
      matrix.makeBasis(sample.right.clone().negate(), sample.up, sample.tangent);
      matrix.setPosition(sample.position);
      for (const side of [-1, 1]) {
        const apron = side < 0 ? sample.apronLeft : sample.apronRight;
        // The entire foot stays beyond the deck, run-off and gate envelope.
        const lateral = Math.max(sample.halfWidth + apron, course.checkpointHalfWidth(gate)) + 2.4;
        const placement = matrix.clone().multiply(offset.makeTranslation(side * lateral, 0, 0));
        this.placements.push(placement);
        const label = new THREE.PlaneGeometry(1.2, 1.18);
        const uv = label.getAttribute('uv');
        for (let index = 0; index < uv.count; index++) uv.setY(index, (uv.getY(index) + rows - gate - 1) / rows);
        // Reader face looks upstream, toward approaching vehicles.
        label.rotateY(Math.PI);label.translate(0, 3.73, -.548);label.applyMatrix4(placement);
        signParts.push(label);
      }
    }
    source.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      this.geometries.add(node.geometry);
      const material = node.material as THREE.MeshStandardMaterial;
      this.materials.add(material);
      if (material.map) {material.map.anisotropy = 4;this.textures.add(material.map);}
    });
    for (const name of ['timing_shell', 'timing_metal', 'timing_lens']) {
      const mesh = source.getObjectByName(name) as THREE.Mesh;
      const material = name === 'timing_lens' ? new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false}) : mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) this.materials.add(material);
      const batch = new THREE.InstancedMesh(mesh.geometry, material, this.placements.length);
      batch.name = name + '_field';
      const local = mesh.matrixWorld;
      this.placements.forEach((placement, index) => batch.setMatrixAt(index, placement.clone().multiply(local)));
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
      this.root.add(batch);
      if (name === 'timing_lens') {
        this.lens = batch;
      }
    }
    const labelGeometry = mergeGeometries(signParts)!;
    signParts.forEach(geometry => geometry.dispose());
    const labelMaterial = new THREE.MeshBasicMaterial({map: signAtlas, toneMapped: false});
    this.geometries.add(labelGeometry);this.materials.add(labelMaterial);
    const labels = new THREE.Mesh(labelGeometry, labelMaterial);labels.name = 'timing_gate_labels';
    this.root.add(labels);
    this.root.userData.instances = this.placements.length;
    this.root.userData.drawCalls = 4;
    this.root.userData.clearanceMeters = 1.44;
    this.originalCheckpoint = course.setCheckpointProgress;
    this.checkpointWriter = next => {this.originalCheckpoint.call(course, next);this.next = next;this.paintLights();};
    course.setCheckpointProgress = this.checkpointWriter;
    course.group.add(this.root);
    this.paintLights();
  }

  private createSignAtlas(rows: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');canvas.width = 256;canvas.height = rows * 256;
    const context = canvas.getContext('2d')!;
    for (let gate = 0; gate < rows; gate++) {
      const y = gate * 256;
      context.fillStyle = '#101c23';context.fillRect(0, y, 256, 256);
      context.fillStyle = '#eef4df';context.textAlign = 'center';
      context.font = 'bold 112px monospace';context.fillText(gate === 0 ? 'SF' : String(gate).padStart(2, '0'), 128, y + 135);
      context.font = 'bold 28px monospace';context.fillText(gate === 0 ? 'LAP LINE' : 'TIMING', 128, y + 193);
      context.fillStyle = '#dfb36e';context.fillRect(25, y + 220, 206, 8);
    }
    const atlas = new THREE.CanvasTexture(canvas);atlas.colorSpace = THREE.SRGBColorSpace;atlas.anisotropy = 4;
    this.textures.add(atlas);return atlas;
  }

  private paintLights(): void {
    for (let index = 0; index < this.placements.length; index++) {
      const gate = Math.floor(index / 2);
      const color = gate === this.next ? NEXT : gate > 0 && (this.next === 0 || gate < this.next) ? CLEAR : OFF;
      this.lens.setColorAt(index, color);
    }
    if (this.lens.instanceColor) this.lens.instanceColor.needsUpdate = true;
  }

  present(): void {
    const stage = document.getElementById('countdown')?.textContent ?? '';
    if (stage === this.previousCountdown) return;
    this.previousCountdown = stage;
    this.paintLights();
    if (['3', '2', '1', 'GO'].includes(stage)) {
      const color = new THREE.Color(stage === 'GO' ? 0xb7e994 : 0xff653d);
      this.lens.setColorAt(0, color);this.lens.setColorAt(1, color);
      this.lens.instanceColor!.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.course.setCheckpointProgress === this.checkpointWriter) this.course.setCheckpointProgress = this.originalCheckpoint;
    this.root.removeFromParent();
    this.root.traverse(node => {if (node instanceof THREE.InstancedMesh) node.dispose();});
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
    this.root.clear();
  }
}

/** Optional art cannot prevent a race from loading. Resource ownership stays
 * with the kit, and the existing runtime keeps its camera and mechanics. */
export async function installRaceTimingKit(runtime: CircuitRuntime, cancelled: () => boolean): Promise<void> {
  if (!KIT_MAPS.has(runtime.course.kind)) return;
  const {scene} = await new GLTFLoader().loadAsync('/assets/race-polish/timing-kit.glb');
  if (cancelled()) {
    const {disposeObject3DResources} = await import('./graphics-resources');
    disposeObject3DResources(scene);return;
  }
  for (const name of ['timing_shell', 'timing_metal', 'timing_lens']) {
    if (!(scene.getObjectByName(name) instanceof THREE.Mesh)) {
      const {disposeObject3DResources} = await import('./graphics-resources');
      disposeObject3DResources(scene);throw new Error('Incomplete race timing kit');
    }
  }
  const kit = new RaceTimingKit(runtime.course, scene);
  const present = runtime.present.bind(runtime), dispose = runtime.dispose.bind(runtime);
  runtime.present = (...args) => {present(...args);kit.present();};
  runtime.dispose = () => {kit.dispose();dispose();};
}
