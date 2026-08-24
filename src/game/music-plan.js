export const MUSIC_BPM = 174;
export const MUSIC_KEY = "F minor";

/** @param {number} midiNote */
export function frequencyForMidiNote(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

// Fm · Db · Eb · Cm. Every chord tone belongs to F natural minor.
export const TRANCE_CHORD_MIDI = [
  [41, 44, 48],
  [37, 41, 44],
  [39, 43, 46],
  [36, 39, 43],
];

export const TRANCE_PLUCK_MIDI = [
  65, 68, 72, 68,
  65, 72, 75, 72,
  68, 72, 77, 75,
  72, 68, 65, 63,
];

export const DEEP_DNB_BASS_EVENTS = [
  { beat: 0, midiNote: 29 },
  { beat: 1.75, midiNote: 32 },
  { beat: 4, midiNote: 25 },
  { beat: 5.5, midiNote: 27 },
  { beat: 8, midiNote: 29 },
  { beat: 9.5, midiNote: 36 },
  { beat: 12, midiNote: 25 },
  { beat: 13.75, midiNote: 27 },
];

export const TECHSTEP_HIT_MIDI = {
  downbeat: 77,
  offbeat: 80,
};
