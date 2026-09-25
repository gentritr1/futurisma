/** Standard gamepad labels; menu A/B were observed by gamepad-prompts.mjs. */
export const INPUT_PROMPTS = {
  confirm: {keyboard: 'ENTER', gamepad: 'A'},
  options: {keyboard: 'O', gamepad: 'Y'},
  quit: {keyboard: 'HOLD', gamepad: 'B HOLD'},
  apply: {keyboard: 'APPLY', gamepad: 'A'},
  back: {keyboard: 'ESC', gamepad: 'B'},
  controls: {keyboard: 'C', gamepad: 'X'},
  // Phase F: Dream Island's power keycap. The island builds the `kbd` from its
  // own lazy chunk, so the label has to exist in the shared map or the shell's
  // next device change would throw on an unmapped prompt.
  power: {keyboard: 'E', gamepad: 'B'},
  // Garage: a focused button on a pad, so the pad prompt is the confirm face.
  garage: {keyboard: 'G', gamepad: 'A'},
};
