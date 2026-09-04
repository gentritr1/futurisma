import { NeonEnvironment } from "./neon-environment";

/** The Blender-authored Meridian district, sharing the two cities' light renderer. */
export class NightshiftEnvironment {
  static load(): Promise<NeonEnvironment> {
    return NeonEnvironment.load({
      rootName: "nightshift_blender_city",
      modelUrl: "/assets/nightshift/nightshift_city.glb",
      lightsUrl: "/assets/nightshift/lights.json",
      colors: {
        NS_sodium: 0xffaa55,
        NS_rose_neon: 0xff628c,
        NS_blue_neon: 0x65dded,
        NS_fluorescent: 0xb4e7cc,
      },
    });
  }
}
