#!/bin/zsh
set -o pipefail
cd /Users/gentlegen/Desktop/futurisma-race/polarity_work
OUT=art/evidence/dreamisland-v1/alive/combined
echo "== git head: $(git rev-parse --short HEAD) branch $(git branch --show-current)" > $OUT/run.log
echo "== test:code start $(date +%T)" >> $OUT/run.log
npm run test:code > $OUT/test-code.log 2>&1; echo "test:code exit $?" >> $OUT/run.log
grep -c PASS $OUT/test-code.log >> $OUT/run.log
echo "== build $(date +%T)" >> $OUT/run.log
npx vite build > $OUT/build.log 2>&1; echo "build exit $?" >> $OUT/run.log
node scripts/validate-build.mjs > $OUT/validate-build.log 2>&1; echo "validate-build exit $?" >> $OUT/run.log
npx vite preview --host 127.0.0.1 --port 5221 --strictPort > $OUT/preview.log 2>&1 &
PREV=$!
for i in {1..40}; do curl -s -o /dev/null http://127.0.0.1:5221/ && break; sleep 1; done
echo "== soaks $(date +%T) load $(sysctl -n vm.loadavg)" >> $OUT/run.log
for t in rookie works feral; do node scripts/visual/dreamisland/race.mjs --tier=$t --base=http://127.0.0.1:5221 --out=$OUT/soak-$t > $OUT/soak-$t.log 2>&1; echo "soak $t exit $? $(date +%T) load $(sysctl -n vm.loadavg)" >> $OUT/run.log; done
node scripts/visual/dreamisland/race.mjs --tier=works --reduced --base=http://127.0.0.1:5221 --out=$OUT/soak-works-reduced > $OUT/soak-works-reduced.log 2>&1; echo "soak works-reduced exit $?" >> $OUT/run.log
echo "== court frames $(date +%T)" >> $OUT/run.log
node art/evidence/dreamisland-v1/alive/3d/capture.mjs --base=http://127.0.0.1:5221 --blends=0,1 --progress=.575 --out=$OUT/court > $OUT/court-capture.log 2>&1; echo "court capture exit $?" >> $OUT/run.log
node art/evidence/dreamisland-v1/alive/3d/capture.mjs --base=http://127.0.0.1:5221 --blends=0,1 --progress=.75 --out=$OUT/reef > $OUT/reef-capture.log 2>&1; echo "reef capture exit $?" >> $OUT/run.log
python3 scripts/visual/grade/measure-frames.py $OUT/court/blend-000.png $OUT/court/blend-100.png $OUT/reef/blend-000.png $OUT/reef/blend-100.png > $OUT/measure.txt 2>&1
kill $PREV 2>/dev/null
echo "== done $(date +%T)" >> $OUT/run.log
