import * as THREE from 'three';

/**
 * The six Dream Island atlases are 2x2 quadrant sheets, inset .004 from the
 * sheet edges and the centre gutter. `public/assets/dreamisland/atlas-manifest.json`
 * is the record of what is in each quadrant; these are the same rects in the
 * form the runtime needs, and `scripts/validate-dreamisland-painted.mjs` asserts
 * the two agree so the geometry and the manifest cannot drift apart.
 *
 * Each rect is `[u0, v0, width, height]` in GL (bottom-origin) V.
 */
export const QUADRANT = {
  TL: [.004, .504, .492, .492],
  TR: [.504, .504, .492, .492],
  BL: [.004, .004, .492, .492],
  BR: [.504, .004, .492, .492],
} as const;
export type AtlasCell = readonly [number, number, number, number];
/**
 * The manifest, and Blender, count V UP from the bottom. A texture sampled with
 * `flipY = false` counts V DOWN from the top, because the first row uploaded is
 * the image's first row — and `flipY = false` is what GLTFLoader sets, and what
 * every texture here is forced to, so one convention holds across the map.
 *
 * The glTF exporter already applies this flip to the GLB's own UVs, which is why
 * the painted world looked right while the road, authored in TypeScript from the
 * same rect numbers, sampled the quadrant BELOW the one it named: the sand road
 * came back as the cyan kerb stone, and a mid-grey road read teal at speed.
 * Anything that writes a UV in this codebase goes through `sampled`.
 */
export const sampled = (rect: AtlasCell): AtlasCell => [rect[0], 1 - rect[1] - rect[3], rect[2], rect[3]];
/** The cells the runtime samples by name, already in texture space. */
export const CELL = {
  roadSand: sampled(QUADRANT.TL), causewayPaving: sampled(QUADRANT.TR),
  kerbCyan: sampled(QUADRANT.BL), wallBlock: sampled(QUADRANT.BR),
  rail: sampled(QUADRANT.TR),
  causticShallows: sampled(QUADRANT.TL), cobaltFacets: sampled(QUADRANT.TR),
  foamGradient: sampled(QUADRANT.BL),
  foamGlow: sampled(QUADRANT.TL), shallowsGlow: sampled(QUADRANT.TR),
} as const;

/**
 * The foliage cards live on a magenta-key sheet. The discard has to happen
 * BEFORE the shared Lambert lighting, fog and tone mapping, exactly as
 * `src/game/ascension-materials.ts` does it, or a keyed pixel would still be
 * fogged and tone mapped into a visible magenta fringe.
 */
export function applyDreamIslandCardCutout(material: THREE.MeshLambertMaterial): void {
  if (!material.name.endsWith("jungle-card")) return;
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
      "#include <map_fragment>\nif(min(diffuseColor.r,diffuseColor.b)-diffuseColor.g>.025)discard;");
  };
  material.customProgramCacheKey = () => "dreamisland-card-cutout-v1";
}

/**
 * Tile and scroll ONE atlas cell under a stock lit material.
 *
 * An atlas cell has nowhere to wrap to, so a repeat cannot come from
 * `texture.repeat` — it would run straight into the neighbouring quadrant. The
 * painted GLB solves that with repeated geometry; the water surfaces cannot,
 * because they also have to move. So the wrap is done per fragment, and it is
 * done by re-using three's OWN `map_fragment` and `emissivemap_fragment` chunk
 * source with the UV expression swapped. Reusing the chunk is what keeps the
 * texture's colour-space handling, alpha handling and every future change to
 * those chunks working; hand-writing a `texture2D` call is what loses them.
 *
 * The material stays a plain lit material with `toneMapped` and `fog` at their
 * defaults, which is what the render-rule audit checks for.
 */
export function applyDreamIslandAtlasFlow(
  material: THREE.MeshLambertMaterial,
  options: {
    cell: AtlasCell; tile: THREE.Vector2; scroll: THREE.Vector2;
    time: { value: number }; emissiveCell?: AtlasCell; key: string;
    swell?: {night:{value:number}};
  },
): void {
  const cell = new THREE.Vector4(...options.cell);
  const emissiveCell = new THREE.Vector4(...(options.emissiveCell ?? options.cell));
  // The rect a water surface draws is a uniform, not a UV range, so it is
  // published here for `scripts/visual/dreamisland/atlas-proof.mjs` to read off
  // the SHIPPED material rather than be told it.
  const uniforms = { diCell: { value: cell }, diEmissiveCell: { value: emissiveCell },
    diTile: { value: options.tile }, diScroll: { value: options.scroll }, diTime: options.time };
  material.userData.diCell = [...options.cell];
  material.userData.diEmissiveCell = [...(options.emissiveCell ?? options.cell)];
  material.userData.diUniforms = uniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    let patched = "uniform vec4 diCell;uniform vec4 diEmissiveCell;uniform vec2 diTile;uniform vec2 diScroll;uniform float diTime;\n"
      + shader.fragmentShader
        .replace("#include <map_fragment>",
          "vec2 diUv=diCell.xy+diCell.zw*fract(vMapUv*diTile+diScroll*diTime);\n"
          + THREE.ShaderChunk.map_fragment.replaceAll("vMapUv", "diUv"))
        .replace("#include <emissivemap_fragment>",
          "vec2 diGlowUv=diEmissiveCell.xy+diEmissiveCell.zw*fract(vMapUv*diTile+diScroll*diTime);\n"
          + THREE.ShaderChunk.emissivemap_fragment.replaceAll("vEmissiveMapUv", "diGlowUv"));
    if(options.swell){
      shader.uniforms.diSeaNight=options.swell.night;
      // Wave displacement happens before the ordinary Lambert projection and
      // lighting. The far quad has diPatch=0; no extra surface draw is needed.
      shader.vertexShader='attribute float diPatch;attribute float diPatchFade;varying vec2 diSeaUv;uniform float diTime;\n'+shader.vertexShader
        .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
          vec2 diNormalWorld=position.xz+diPatch*floor(cameraPosition.xz/16.)*16.;
          objectNormal=normalize(vec3(-diPatchFade*.14*.07*cos(diNormalWorld.x*.07+diTime*.18),1.,
            -diPatchFade*.10*.045*cos(diNormalWorld.y*.045-diTime*.11)));`)
        .replace('#include <begin_vertex>',`#include <begin_vertex>
          transformed.xz+=diPatch*floor(cameraPosition.xz/16.)*16.;
          transformed.y+=diPatchFade*(.32+.14*sin(transformed.x*.07+diTime*.18)
            +.10*sin(transformed.z*.045-diTime*.11));
          diSeaUv=transformed.xz/42.;`);
      patched='varying vec2 diSeaUv;uniform float diSeaNight;\n'+patched;
      patched=patched.replace('fract(vMapUv*diTile+diScroll*diTime)','fract(diSeaUv*diTile+diScroll*diTime)')
        .replace('#include <color_fragment>',`#include <color_fragment>
          vec2 diSlowUv=diCell.xy+diCell.zw*fract(diSeaUv*.37+vec2(-.0011,.0007)*diTime);
          vec3 diSlow=texture2D(map,diSlowUv).rgb;
          diffuseColor.rgb*=mix(vec3(.80),diSlow*2.4,.30);`)
        .replace('#include <fog_fragment>',`#include <fog_fragment>
          #ifdef USE_FOG
            float diHorizon=smoothstep(120.,600.,vFogDepth)*(1.-diSeaNight);
            gl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,diHorizon);
          #endif`);
    }
    // A chunk that three renames would leave the include in place and the flow
    // would silently do nothing, which is the failure this project keeps
    // catching late. Fail loudly at compile instead.
    if (patched.includes("#include <map_fragment>")
      || (material.emissiveMap && patched.includes("#include <emissivemap_fragment>"))) {
      throw new Error("dreamisland-materials: the three chunk names moved; the atlas flow did not install");
    }
    shader.fragmentShader = patched;
    flowInstallations += 1;
  };
  // A stable key keeps three from re-deriving the program key from
  // `onBeforeCompile.toString()` on every material; the cell, tile and scroll
  // are uniforms, so every surface can safely share one compiled program.
  material.customProgramCacheKey = () => options.swell?"dreamisland-sea-swell-v1":"dreamisland-atlas-flow-v1";
}
/** How many materials actually got the flow patch. Reads zero if the module
 * silently no-ops, which is what the diagnostics counter is for. */
let flowInstallations = 0;
export const dreamIslandFlowInstallations = (): number => flowInstallations;

/** Vertex red encodes distance across the shallows, not an extra texture. */
export function applyDreamIslandDepthBand(material:THREE.MeshLambertMaterial){
 const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.vertexColors=true;
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`
   diffuseColor.rgb*=mix(vec3(.10,.88,.82),vec3(.025,.16,.48),smoothstep(.66,.80,vColor.r));`);
 };
 material.customProgramCacheKey=()=>key+'-depth-band-v1';material.needsUpdate=true;
}

/** Island-only ambient trim. Keep the existing shadowed direct light and the
 * night response; sea, foliage cutouts, lamps and the other circuits bypass it. */
export function applyDreamIslandDayLight(material:THREE.MeshLambertMaterial,night:{value:number}){
 if(material.userData.diDayLightBound)return;
 material.userData.diDayLightBound=true;
 const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  previous.call(material,shader,renderer);
  shader.uniforms.diDayLightNight=night;
  shader.fragmentShader='uniform float diDayLightNight;\n'+shader.fragmentShader.replace(
   '#include <aomap_fragment>',`#include <aomap_fragment>
    reflectedLight.indirectDiffuse*=mix(.22,1.,diDayLightNight);
    reflectedLight.directDiffuse*=mix(1.2,1.,diDayLightNight);`);
 };
 material.customProgramCacheKey=()=>key+'-island-day-light-v1';material.needsUpdate=true;
}
