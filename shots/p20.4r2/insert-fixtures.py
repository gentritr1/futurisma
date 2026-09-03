#!/usr/bin/env python3
"""One-shot editor that added the P20.4 round-2 negative fixtures. Kept with the
harness so the insertion point is recoverable."""
import io

PATH = "scripts/validate-living-world.mjs"
ANCHOR = """/**
 * P20.4 ROUND 2 — THE TWO-TIER ALPHA, AND THE PLACEMENT IT DEPENDS ON."""

BLOCK = '''// The tint rule is only worth its lines if it fails on the thing it exists to
// catch. Asserted against synthetic cards so the fixtures cannot drift with the
// real zones — and needed as fixtures at all because a real re-tint trips the
// zone DIGEST first, which says only that something moved.
assert.throws(
  () => {
    const offender = { motionId: "FAKE_PALE_SCUD", tint: 0xe6dcc4 };
    assert.ok(
      rec709(offender.tint) <= DUST_TINT_LUMA_CEILING,
      "dust tint is under the ceiling",
    );
  },
  /dust tint is under the ceiling/,
  "The dust-tint rule does not fail on round 1's crust-coloured tint, which is "
    + "the exact value it exists to keep out.",
);
assert.throws(
  () => {
    const offender = { tint: 0x33383f };
    const red = (offender.tint >> 16) & 0xff;
    const green = (offender.tint >> 8) & 0xff;
    const blue = offender.tint & 0xff;
    assert.ok(red > green && green > blue, "dust tint is warm");
  },
  /dust tint is warm/,
  "The dust-tint rule passes a cold grey-blue card, which reads as a smudge on "
    + "the lens rather than as lifted salt crust.",
);

'''


def main():
    with io.open(PATH, encoding="utf8") as fh:
        source = fh.read()
    assert ANCHOR in source, "anchor moved"
    source = source.replace(ANCHOR, BLOCK + ANCHOR, 1)
    with io.open(PATH, "w", encoding="utf8") as fh:
        fh.write(source)
    print("inserted")


if __name__ == "__main__":
    main()
