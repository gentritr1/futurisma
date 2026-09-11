import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

interface Part {
  source: THREE.Mesh;
  offset: number;
  matrix: THREE.Matrix4;
}
interface Batch { mesh: THREE.Mesh; parts: Part[] }

/** Keep the authored pivots, UVs and contact AO, but submit one draw per role.
 * Only vertices whose local mechanism transform changed are uploaded again.
 * The caged bulb stays separate so its live emission remains independent.
 */
export class TidelineDeviceBatch {
  private readonly batches: Batch[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly normalMatrix = new THREE.Matrix3();
  private readonly vertex = new THREE.Vector3();

  constructor(private readonly root: THREE.Object3D, lamp: THREE.Object3D) {
    const roles = new Map<THREE.Material, THREE.Mesh[]>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object === lamp || Array.isArray(object.material)) return;
      const meshes = roles.get(object.material) ?? [];
      meshes.push(object); roles.set(object.material, meshes);
    });
    for (const [material, sources] of roles) {
      const geometries = sources.map(source => source.geometry.clone());
      const geometry = mergeGeometries(geometries);
      geometries.forEach(part => part.dispose());
      if (!geometry) throw new Error('Pump device role has incompatible geometry.');
      (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      (geometry.getAttribute('normal') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'pump_device_batched_' + material.name;
      mesh.receiveShadow = true;
      // The parent cradle handles distance culling. Moving blades cannot escape
      // this tiny device's housing; avoid stale per-blade bounding volumes.
      mesh.frustumCulled = false;
      let offset = 0;
      const parts = sources.map(source => {
        source.visible = false;
        const part = {source, offset, matrix: new THREE.Matrix4().makeScale(0, 0, 0)};
        offset += source.geometry.getAttribute('position').count;
        return part;
      });
      root.add(mesh); this.batches.push({mesh, parts});
    }
    this.update();
  }

  update(): void {
    for (const {mesh, parts} of this.batches) {
      const positions = mesh.geometry.getAttribute('position');
      const normals = mesh.geometry.getAttribute('normal');
      let changed = false;
      for (const part of parts) {
        this.matrix.identity();
        // Local ancestry excludes the moving vehicle/world transform, so fixed
        // housing vertices are not reprocessed just because the craft advances.
        for (let object: THREE.Object3D | null = part.source; object && object !== this.root; object = object.parent) {
          object.updateMatrix(); this.matrix.premultiply(object.matrix);
        }
        if (part.matrix.equals(this.matrix)) continue;
        part.matrix.copy(this.matrix); this.normalMatrix.getNormalMatrix(this.matrix);
        const sourcePositions = part.source.geometry.getAttribute('position');
        const sourceNormals = part.source.geometry.getAttribute('normal');
        for (let i = 0; i < sourcePositions.count; i++) {
          this.vertex.fromBufferAttribute(sourcePositions, i).applyMatrix4(this.matrix);
          positions.setXYZ(part.offset + i, this.vertex.x, this.vertex.y, this.vertex.z);
          this.vertex.fromBufferAttribute(sourceNormals, i).applyNormalMatrix(this.normalMatrix);
          normals.setXYZ(part.offset + i, this.vertex.x, this.vertex.y, this.vertex.z);
        }
        changed = true;
      }
      if (changed) { positions.needsUpdate = true; normals.needsUpdate = true; }
    }
  }

  dispose(): void {
    for (const {mesh} of this.batches) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    this.batches.length = 0;
  }
}
