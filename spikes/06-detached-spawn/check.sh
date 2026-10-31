#!/usr/bin/env bash
# Exit 0 only if the detached child is alive AND still heart-beating after the agent exited.
set -u
dir="$HOME/.kommutator"
pid="$(cat "$dir/spike06.pid" 2>/dev/null || true)"
if [[ -z "$pid" ]]; then echo "no pid file — run parent.mjs first"; exit 1; fi

if ! kill -0 "$pid" 2>/dev/null; then
  echo "FAIL: child $pid is gone"
  tail -n 3 "$dir/spike06.log" 2>/dev/null
  exit 1
fi

# The pid could have been reused by an unrelated process: require a fresh heartbeat line
# from exactly this pid within the last 10 seconds.
last="$(grep "child $pid alive" "$dir/spike06.log" 2>/dev/null | tail -n 1 | cut -d' ' -f1)"
if [[ -z "$last" ]]; then echo "FAIL: no heartbeat from pid $pid in the log"; exit 1; fi
last_epoch="$(date -u -j -f '%Y-%m-%dT%H:%M:%S' "${last%%.*}" +%s 2>/dev/null || date -u -d "$last" +%s 2>/dev/null)"
now_epoch="$(date -u +%s)"
if [[ -z "$last_epoch" ]] || (( now_epoch - last_epoch > 10 )); then
  echo "FAIL: last heartbeat from pid $pid is stale ($last)"
  exit 1
fi

echo "PASS: child $pid is alive and heart-beating (last: $last)"
ps -o pid,ppid,sess,comm -p "$pid" 2>/dev/null || ps -o pid,ppid,comm -p "$pid"
