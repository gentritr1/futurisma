import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeObject3DResources } from "./graphics-resources";

const EXPECTED_ROOT_NAME = "GW_SURFACE_CHARACTER_RUNTIME";
const EXPECTED_MATERIAL_NAME = "GW_SURFACE_CHARACTER";
const EXPECTED_MESHES = 1;
const EXPECTED_TRIANGLES = 776;

export interface GreenwaterSurfaceCharacterStats {
  drawCalls: 1;
  meshes: 1;
  triangles: 776;
  materials: 1;
  textures: 1;
  shaderModel: "unlit";
  animated: false;
}

function configureSurfaceCharacter(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let meshes = 0;
  let triangles = 0;

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) {
      throw new Error("Greenwater surface character must use one material.");
    }
    if (!(object.material instanceof THREE.MeshBasicMaterial)) {
      throw new Error("Greenwater surface character must use an unlit material.");
    }
    if (object.material.name !== EXPECTED_MATERIAL_NAME) {
      throw new Error("Greenwater surface character material name is invalid.");
    }
    if (!object.material.map) {
      throw new Error("Greenwater surface character texture is missing.");
    }
    if (!object.geometry.getAttribute("uv") || !object.geometry.getAttribute("color")) {
      throw new Error("Greenwater surface character vertex data is incomplete.");
    }

    const index = object.geometry.getIndex();
    const meshTriangles = index
      ? index.count / 3
      : object.geometry.getAttribute("position").count / 3;
    if (!Number.isInteger(meshTriangles)) {
      throw new Error("Greenwater surface character triangle count is invalid.");
    }

    meshes += 1;
    triangles += meshTriangles;
    materials.add(object.material);
    textures.add(object.material.map);

    object.frustumCulled = false;
    object.castShadow = false;
    object.receiveShadow = false;

    object.material.transparent = true;
    object.material.depthWrite = false;
    object.material.depthTest = true;
    object.material.vertexColors = true;
    object.material.side = THREE.FrontSide;
    object.material.fog = true;
    object.material.alphaTest = 0;
    object.material.polygonOffset = true;
    object.material.polygonOffsetFactor = -2;
    object.material.polygonOffsetUnits = -2;
    object.material.map.colorSpace = THREE.SRGBColorSpace;
    object.material.map.magFilter = THREE.NearestFilter;
    object.material.map.minFilter = THREE.NearestFilter;
    object.material.map.wrapS = THREE.ClampToEdgeWrapping;
    object.material.map.wrapT = THREE.ClampToEdgeWrapping;
    object.material.map.generateMipmaps = false;
    object.material.map.needsUpdate = true;
    object.material.needsUpdate = true;
  });

  if (meshes !== EXPECTED_MESHES) {
    throw new Error(
      `Greenwater surface character has ${meshes} meshes; expected ${EXPECTED_MESHES}.`,
    );
  }
  if (triangles !== EXPECTED_TRIANGLES) {
    throw new Error(
      `Greenwater surface character has ${triangles} triangles; expected ${EXPECTED_TRIANGLES}.`,
    );
  }
  if (materials.size !== 1 || textures.size !== 1) {
    throw new Error("Greenwater surface character resource count is invalid.");
  }
}

export class GreenwaterSurfaceCharacter {
  readonly stats: GreenwaterSurfaceCharacterStats = {
    drawCalls: 1,
    meshes: 1,
    triangles: 776,
    materials: 1,
    textures: 1,
    shaderModel: "unlit",
    animated: false,
  };

  private constructor(readonly root: THREE.Group) {}

  static async load(url: string): Promise<GreenwaterSurfaceCharacter> {
    const root = (await new GLTFLoader().loadAsync(url)).scene;
    try {
      if (!root.getObjectByName(EXPECTED_ROOT_NAME)) {
        throw new Error("Greenwater surface character runtime root is missing.");
      }
      configureSurfaceCharacter(root);
      root.name = "greenwater_surface_character_layer";
      return new GreenwaterSurfaceCharacter(root);
    } catch (error) {
      disposeObject3DResources(root);
      throw error;
    }
  }
}
