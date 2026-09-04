import { NeonEnvironment } from "./neon-environment";

/** Inverter rings and power halls frame the two playable magnetic decks. */
export class PolarityEnvironment {
  static load(): Promise<NeonEnvironment> {
    return NeonEnvironment.load({
      rootName: "polarity_blender_interchange",
      modelUrl: "/assets/polarity/polarity_station.glb",
      lightsUrl: "/assets/polarity/lights.json",
      colors: {
        PL_lower_amber: 0xffaa4c,
        PL_upper_cyan: 0x52d4ff,
        PL_reactor_violet: 0xac79ef,
        PL_service_white: 0xb7dde7,
      },
    });
  }
}
