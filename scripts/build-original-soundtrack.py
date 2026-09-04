#!/usr/bin/env python3
"""Author Meridian Afterimage: original 174 BPM atmospheric jungle, 80 bars.

Requires NumPy and ffmpeg. Every oscillator, percussion hit, chord and rhythm is
generated here; no recordings, samples, model output or third-party music enter
the track. The deterministic master is measured before linear loudness matching.
The resulting MP3 and measurement report may ship with the game.
"""
from pathlib import Path
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets/audio/original"
RATE = 44100
BPM = 174
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 80
SECONDS = BARS * BAR
COUNT = round(SECONDS * RATE)
RNG = np.random.default_rng(2172001)
PI2 = math.tau


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def times(seconds):
    return np.arange(round(seconds * RATE), dtype=np.float64) / RATE


def noise_band(seconds, low, high):
    """A smooth FFT band; tapering suppresses hard band-edge ringing."""
    count = round(seconds * RATE)
    bins = np.fft.rfftfreq(count, 1 / RATE)
    spectrum = np.fft.rfft(RNG.standard_normal(count))
    gain = (1 - np.exp(-(bins / low) ** 4)) * np.exp(-(bins / high) ** 4)
    result = np.fft.irfft(spectrum * gain, count)
    return result / max(1e-8, np.sqrt(np.mean(result * result)))


def envelope(t, attack, release):
    return np.minimum(1, t / attack) * np.minimum(1, (t[-1] - t) / release)


def put(bus, sound, start, gain=1, pan=0):
    offset = round(start * RATE)
    if offset < 0 or offset >= COUNT:
        return
    length = min(len(sound), COUNT - offset)
    if sound.ndim == 2:
        bus[offset:offset + length] += sound[:length] * gain
    else:
        left = math.cos((pan + 1) * math.pi / 4)
        right = math.sin((pan + 1) * math.pi / 4)
        bus[offset:offset + length, 0] += sound[:length] * gain * left
        bus[offset:offset + length, 1] += sound[:length] * gain * right


def kick():
    t = times(0.32)
    phase = PI2 * (47 * t + 6 * (1 - np.exp(-t * 46)))
    body = np.sin(phase) * np.exp(-t * 19)
    click = noise_band(0.32, 1400, 6200) * np.exp(-t * 240) * 0.11
    return np.tanh((body + click) * 1.15) * envelope(t, 0.0015, 0.015)


def snare():
    t = times(0.29)
    shell = (np.sin(PI2 * 183 * t) + 0.45 * np.sin(PI2 * 339 * t)) * np.exp(-t * 37)
    wire = noise_band(0.29, 1350, 8700) * np.exp(-t * 21)
    return np.tanh((0.42 * shell + 0.30 * wire) * 1.3) * envelope(t, 0.001, 0.02)


def hat(seconds=0.13):
    t = times(seconds)
    return noise_band(seconds, 5300, 13000) * np.exp(-t * (8 / seconds)) * envelope(t, .001, .014)


def rim():
    t = times(.09)
    body = np.sin(PI2 * 840 * t) + .52 * np.sin(PI2 * 1397 * t)
    return body * np.exp(-t * 82) * envelope(t, .001, .01)


def bass(note, seconds, variation):
    t = times(seconds)
    hz = frequency(note)
    modulation = .006 * np.sin(PI2 * .43 * t + variation)
    phase = PI2 * hz * t
    sub = np.sin(phase)
    # Quiet detuned upper partials leave room for the engine and the kick.
    upper = np.sin(phase * 2.002 + modulation) * .22
    upper += np.sin(phase * 3.997 - modulation) * .065
    gate = envelope(t, .014, .07)
    return np.tanh((sub + upper) * 1.24) * gate


def chord(notes, seconds, phase_offset):
    t = times(seconds)
    result = np.zeros((len(t), 2), np.float32)
    for channel, sign in enumerate((-1, 1)):
        for index, note in enumerate(notes):
            hz = frequency(note)
            motion = .16 * np.sin(PI2 * (.073 + index * .011) * t + phase_offset)
            detune = 2 ** ((sign * 4 + index * .3) / 1200)
            phase = PI2 * hz * detune * t + index * 1.7 + motion
            tone = np.sin(phase) + .22 * np.sin(phase * 2 + .4)
            tone += .09 * np.sin(phase * 3 - .2)
            result[:, channel] += (tone * (.45 + .045 * np.sin(PI2 * .11 * t))).astype(np.float32)
    result /= len(notes)
    result *= envelope(t, 1.8, 2.4)[:, None]
    return result


def beacon(note, seconds=1.6):
    t = times(seconds)
    hz = frequency(note)
    # Soft mallet-like FM, not a square-wave game beep.
    tone = np.sin(PI2 * hz * t + .75 * np.sin(PI2 * hz * 2 * t) * np.exp(-t * 7))
    return tone * np.exp(-t * 2.8) * envelope(t, .008, .2)


def add_room(bus, amount):
    """A sparse stereo room, with irregular prime-like delays and no feedback."""
    dry = bus.copy()
    for seconds, level in ((.073, .25), (.131, .19), (.223, .16), (.347, .12),
                           (.509, .09), (.733, .07), (1.019, .045), (1.451, .03)):
        shift = round(seconds * RATE)
        bus[shift:, 0] += dry[:-shift, 1] * level * amount
        bus[shift:, 1] += dry[:-shift, 0] * level * amount


def render():
    drums = np.zeros((COUNT, 2), np.float32)
    pads = np.zeros_like(drums)
    low = np.zeros_like(drums)
    details = np.zeros_like(drums)
    duck = np.ones(COUNT, np.float32)
    kick_hit, snare_hit, hat_hit, open_hat, rim_hit = kick(), snare(), hat(), hat(.32), rim()

    # F minor 9 / Db major 9 / Ab major 7 / Eb suspended 9: suspended colour,
    # with the middle voices barely moving as the city passes.
    chords = ((53, 60, 63, 67, 72), (49, 56, 60, 63, 67),
              (56, 60, 63, 67, 70), (51, 58, 61, 65, 70))
    roots = (29, 25, 32, 27)
    for section in range(10):
        put(pads, chord(chords[section % 4], BAR * 8 + 2.8, section),
            section * BAR * 8, .33)

    for bar in range(BARS):
        start = bar * BAR
        intro = bar < 8
        breakdown = 40 <= bar < 48
        outro = bar >= 72
        energy = .48 if intro else .25 if breakdown else .60 if outro else 1.0
        if intro:
            energy *= .25 + bar / 10
        if outro:
            energy *= max(0, (79 - bar) / 7)
        root = roots[(bar // 8) % 4]
        # Four related two-bar break shapes, with anticipations and ghost hits.
        kick_steps = ([0, 10, 20, 27] if bar % 4 == 0 else
                      [0, 13, 18] if bar % 4 == 1 else
                      [0, 6, 20, 26] if bar % 4 == 2 else [0, 12, 19, 28])
        if breakdown:
            kick_steps = [0] if bar % 2 == 0 else []
        if bar >= 78:
            kick_steps = []
        for step in kick_steps:
            at = start + step * BEAT / 8
            strength = 1 if step == 0 else .80
            put(drums, kick_hit, at, .79 * energy * strength)
            index = round(at * RATE)
            count = min(round(.19 * RATE), COUNT - index)
            recovery = .52 + .48 * (1 - np.exp(-np.arange(count) / (RATE * .055)))
            duck[index:index + count] = np.minimum(duck[index:index + count], recovery)

        if not breakdown and bar < 78:
            for step in (8, 24):
                put(drums, snare_hit, start + step * BEAT / 8, .58 * energy, -.025)
            ghost_steps = (6, 17, 22, 30) if bar % 2 == 0 else (3, 14, 21, 29, 31)
            for index, step in enumerate(ghost_steps):
                put(drums, snare_hit, start + step * BEAT / 8 + .008,
                    (.065 + .035 * (index % 2)) * energy, .12 if index % 2 else -.15)
            if bar % 8 == 7:
                for step, strength in ((27, .13), (28, .17), (30, .24), (31, .14)):
                    put(drums, snare_hit, start + step * BEAT / 8, strength * energy, .2)

        for eighth in range(8):
            if (breakdown or intro) and eighth % 2:
                continue
            swing = .009 if eighth % 2 else 0
            sound = open_hat if eighth == 5 and bar % 2 else hat_hit
            accent = .09 if eighth % 2 == 0 else .052
            put(drums, sound, start + eighth * BEAT / 2 + swing,
                accent * energy, .35 if eighth % 2 else -.28)
        for step in ((4, 19) if bar % 2 else (11, 28)):
            put(drums, rim_hit, start + step * BEAT / 8, .072 * energy, -.45)

        if 8 <= bar < 76 and not breakdown:
            pattern = ((0, root, 1.35), (1.75, root + 12, .40),
                       (2.5, root, .9), (3.5, root + (7 if bar % 4 == 3 else 0), .42))
            for beat, note, length in pattern:
                put(low, bass(note, length * BEAT, bar), start + beat * BEAT, .30 * energy)

        # The five-note signal comes back in another register after the break.
        if bar % 4 in (0, 2) and bar >= 8 and bar < 74:
            melody = (72, 67, 75, 70, 67)
            note = melody[(bar // 2) % len(melody)] + (12 if 48 <= bar < 64 else 0)
            at = start + (2.75 if bar % 4 == 2 else .5) * BEAT
            put(details, beacon(note), at, .07 if not breakdown else .11, -.25)
            put(details, beacon(note), at + BEAT * .75, .033, .42)
            put(details, beacon(note), at + BEAT * 1.5, .014, -.5)

    add_room(pads, .65)
    add_room(details, .80)
    add_room(drums, .08)
    pads *= (duck * .28 + .72)[:, None]
    low *= duck[:, None]

    # Quiet moving air behind the notes; no artificial vinyl crackle loop.
    t = np.arange(COUNT, dtype=np.float64) / RATE
    air = noise_band(SECONDS, 340, 2600) * (.55 + .45 * np.sin(PI2 * .031 * t) ** 2)
    details[:, 0] += (air * .004).astype(np.float32)
    details[:, 1] += (np.roll(air, 431) * .004).astype(np.float32)
    mix = drums + low + pads + details
    fade = np.minimum(1, t / 2.0) * np.minimum(1, (SECONDS - t) / 5.0)
    mix *= fade[:, None]
    mix -= np.mean(mix, axis=0)
    mix = np.tanh(mix * 1.04)
    mix *= .88 / np.max(np.abs(mix))
    return mix


def measure(ffmpeg, path):
    run = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path), "-af",
                          "loudnorm=I=-14:TP=-1.8:LRA=9:print_format=json", "-f", "null", "-"],
                         capture_output=True, text=True, check=True)
    return json.loads(run.stderr[run.stderr.rfind("{"):run.stderr.rfind("}") + 1])


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    result = render()
    with tempfile.TemporaryDirectory(prefix="meridian-score-") as temporary:
        wav = Path(temporary) / "master.wav"
        with wave.open(str(wav), "wb") as file:
            file.setnchannels(2)
            file.setsampwidth(2)
            file.setframerate(RATE)
            file.writeframes((result * 32767).astype("<i2").tobytes())
        first = measure(ffmpeg, wav)
        normalizer = ("loudnorm=I=-14:TP=-1.8:LRA=9:linear=true:"
                      f"measured_I={first['input_i']}:measured_TP={first['input_tp']}:"
                      f"measured_LRA={first['input_lra']}:measured_thresh={first['input_thresh']}:"
                      f"offset={first['target_offset']}")
        track = OUTPUT / "meridian-afterimage.mp3"
        subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(wav), "-af", normalizer,
                        "-ar", str(RATE), "-codec:a", "libmp3lame", "-b:a", "160k",
                        "-metadata", "title=Meridian Afterimage", "-metadata", "artist=Futurisma",
                        "-metadata", "comment=Original deterministic synthesis; no external samples",
                        str(track)], check=True)
        final = measure(ffmpeg, track)
    assert -15 <= float(final["input_i"]) <= -13, final
    assert float(final["input_tp"]) <= -.8, final
    report = {
        "title": "Meridian Afterimage", "artist": "Futurisma", "bpm": BPM,
        "bars": BARS, "durationSeconds": round(SECONDS, 3), "sampleRate": RATE,
        "channels": 2, "bitrateKbps": 160,
        "integratedLufs": float(final["input_i"]), "truePeakDbtp": float(final["input_tp"]),
        "loudnessRangeLu": float(final["input_lra"]),
        "sha256": hashlib.sha256(track.read_bytes()).hexdigest(),
        "source": "scripts/build-original-soundtrack.py",
        "provenance": "Original composition and procedural synthesis. No third-party samples or recordings.",
        "arrangement": "8-bar introduction, 32-bar drive, 8-bar breakdown, 24-bar return, 8-bar outro.",
    }
    (OUTPUT / "meridian-afterimage.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
