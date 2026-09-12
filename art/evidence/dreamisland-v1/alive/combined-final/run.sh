#!/bin/zsh
cd /Users/gentlegen/Desktop/futurisma-race/polarity_work
OUT=art/evidence/dreamisland-v1/alive/combined-final
echo "== start $(date +%T) head $(git rev-parse --short HEAD)" > $OUT/run.log
npm run test:code > $OUT/test-code.log 2>&1; echo "test:code exit $? PASS-lines $(grep -c PASS $OUT/test-code.log)" >> $OUT/run.log
npx vite --host 127.0.0.1 --port 5251 --strictPort > $OUT/dev.log 2>&1 &
DEV=$!
for i in {1..40}; do curl -s -o /dev/null http://127.0.0.1:5251/ && break; sleep 1; done
echo "== soaks $(date +%T) load $(sysctl -n vm.loadavg)" >> $OUT/run.log
for t in rookie works feral; do node scripts/visual/dreamisland/race.mjs --tier=$t --base=http://127.0.0.1:5251 --out=$OUT/soak-$t > $OUT/soak-$t.log 2>&1; echo "soak $t exit $? $(date +%T) load $(sysctl -n vm.loadavg)" >> $OUT/run.log; done
node scripts/visual/dreamisland/race.mjs --tier=works --reduced --base=http://127.0.0.1:5251 --out=$OUT/soak-works-reduced > $OUT/soak-works-reduced.log 2>&1; echo "soak works-reduced exit $?" >> $OUT/run.log
kill $DEV 2>/dev/null
echo "== done $(date +%T)" >> $OUT/run.log
