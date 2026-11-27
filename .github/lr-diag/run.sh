#!/bin/bash
# usage: run.sh <label> <iterations> <parallel> <command...>
label=$1; n=$2; par=$3; shift 3
export CMD="$*" LABEL=$label
one() {
  out=$(perl -e 'alarm shift; exec @ARGV' 150 bash -c "$CMD" 2>&1); rc=$?
  if [ $rc -ne 0 ] || echo "$out" | grep -q "RESULT.*LOST"; then echo "=== $LABEL iteration $1 rc=$rc"; echo "$out" | grep -v MOCHI_KEY | tail -40 | sed "s/^/| /"; fi
  echo "$out" | grep -E "^RESULT"; echo "$out" | grep -E "^PROBE_TRY" | tail -1; echo "RC $LABEL $rc"
}
export -f one
seq 1 $n | xargs -P $par -I{} bash -c 'one {}' > /tmp/diag-$label.log
echo "## $label"; grep -E "^RC " /tmp/diag-$label.log | sort | uniq -c
grep -E "^RESULT" /tmp/diag-$label.log | awk '{print $2, $3}' | sort | uniq -c
grep -E "^RESULT.*SEEN" /tmp/diag-$label.log | sed -E 's/.*latency=([0-9.]+).*/\1/' | sort -n | awk '{a[NR]=$1} END {if (NR) print "latency ms p50=" a[int(NR/2)+1], "p99=" a[int(NR*0.99)+1], "max=" a[NR]}'
grep -E "^RESULT" /tmp/diag-$label.log | grep -o "probeTries=[0-9]*" | sort | uniq -c
grep -A40 "^=== " /tmp/diag-$label.log | head -150
