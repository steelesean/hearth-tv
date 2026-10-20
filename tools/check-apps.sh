#!/bin/bash
# Finds out which links each streaming app on the Fire TV stick accepts, so Hearth's
# tiles can go straight to a programme (The Gruffalo on iPlayer, Cars on Disney+…).
#
# Run on a Mac on the same Wi-Fi as the stick:   bash check-apps.sh
# It only reads information from the stick; it doesn't change anything on it.
# The results are saved to hearth-apps.txt on your Desktop.

set -u
TOOLS="$HOME/hearth-tools"
OUT="$HOME/Desktop/hearth-apps.txt"

# 1. Get Google's "adb" tool, which lets a computer talk to an Android device.
if command -v adb >/dev/null 2>&1; then
  ADB="adb"
else
  ADB="$TOOLS/platform-tools/adb"
  if [ ! -x "$ADB" ]; then
    echo "Downloading Google's Android tools into $TOOLS (about 15 MB)…"
    mkdir -p "$TOOLS"
    curl -fsSL -o "$TOOLS/platform-tools.zip" https://dl.google.com/android/repository/platform-tools-latest-darwin.zip \
      && unzip -q -o "$TOOLS/platform-tools.zip" -d "$TOOLS" \
      || { echo "The download didn't work. Check the Mac is online and try again."; exit 1; }
  fi
fi

# 2. Connect to the stick.
echo
echo "On the stick: Settings > My Fire TV > About > Network shows its IP address."
printf "Type that address here (for example 192.168.1.42) and press Return: "
read -r IP
IP="${IP%%:*}"
TARGET="$IP:5555"

echo
echo "Connecting… Look at the TV. If it asks whether to allow debugging,"
echo "tick 'Always allow from this computer' and choose OK."
"$ADB" connect "$TARGET" >/dev/null 2>&1
STATE=""
for i in $(seq 1 30); do
  STATE=$("$ADB" -s "$TARGET" get-state 2>/dev/null | tr -d '\r')
  [ "$STATE" = "device" ] && break
  sleep 2
  "$ADB" connect "$TARGET" >/dev/null 2>&1
done
if [ "$STATE" != "device" ]; then
  echo
  echo "Couldn't connect. Check:"
  echo "  - Settings > My Fire TV > Developer options > ADB debugging is ON"
  echo "  - the address is right, and the Mac and stick are on the same Wi-Fi"
  exit 1
fi
echo "Connected."

tv() { "$ADB" -s "$TARGET" shell "$@" | tr -d '\r'; }

# 3. Look at each streaming app and note the links it says it can open.
{
  echo "Hearth app check, $(date)"
  echo "Device: $(tv getprop ro.product.model)  Android $(tv getprop ro.build.version.release)  Fire OS $(tv getprop ro.build.version.name)"
  echo
  PKGS=$(tv pm list packages | sed 's/^package://' \
    | grep -iE 'bbc|iplayer|channel4|netflix|disney|youtube|avod|firebat|primevideo|appletv|atve|itv|my5|channel5|demand5' | sort)
  for p in $PKGS; do
    echo "=================================================="
    echo "$p   version $(tv dumpsys package "$p" | grep -m1 versionName | sed 's/.*versionName=//')"
    echo "--- links and actions it accepts"
    tv dumpsys package "$p" \
      | awk '/Activity Resolver Table:/{f=1} /Receiver Resolver Table:|Service Resolver Table:|Provider Resolver Table:|Preferred Activities|Domain verification|^Key Set Manager|^Packages:/{f=0} f' \
      | grep -E 'Action: |Scheme: |Authority: |Path: |PathPrefix: |PathPattern: |Type: ' \
      | sed 's/^ *//' | sort -u
    echo "--- screens it can open"
    tv dumpsys package "$p" \
      | awk '/Activity Resolver Table:/{f=1} /Receiver Resolver Table:/{f=0} f' \
      | grep -oE "$p/[A-Za-z0-9_.$]+" | sort -u
  done
} > "$OUT" 2>&1

echo
echo "Done. Results saved to hearth-apps.txt on your Desktop."
echo "Open it, copy everything, and paste it back to Claude."
