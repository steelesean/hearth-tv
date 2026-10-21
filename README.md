# Hearth

A calm, clean home screen for our Fire TV Stick 4K, with one-tap shortcuts for the children and a phone remote.

## What's in it

- **TV screen** (`app/src/main/assets/tv.html`). The greeting, the command bar, the apps row and the children's row. Works with the normal Fire TV remote.
- **Phone remote** (`app/src/main/assets/phone.html`). The TV serves this page on the home Wi-Fi. Scan the QR code on the TV, enter the four-digit number once, and the phone can drive the TV.
- **Shortcuts** (`app/src/main/assets/config.js`). The apps, live channels and children's titles in one file. Change this to change what's on screen.
- **Android app** (`app/src/main/java/...`). A thin wrapper that shows the TV screen, opens the other apps, runs the phone remote and starts when the stick switches on.

## Installing on the Fire TV stick

1. On the stick, go to Settings > My Fire TV > About and click the device name seven times to turn on developer options.
2. Install **Downloader** from the Amazon store.
3. In Settings > My Fire TV > Developer options > Install unknown apps, allow Downloader.
4. Open Downloader and enter:
   `https://github.com/steelesean/hearth-tv/releases/latest/download/hearth-tv.apk`
5. Choose Install. Hearth then appears in your apps. Move it to the front of the row so it's one click from waking the TV.

To update later, repeat step 4. Every change pushed to `main` builds a new version automatically (see the Actions tab).

## Known limits in this first version

- Live channels and children's titles try a direct link first. If an app doesn't accept the link, it opens on its own home page instead. The links in `config.js` still need testing on the real stick.
- The phone can drive Hearth and open apps, but it can't pause or skip inside Netflix, iPlayer and so on yet. Use the normal remote for that.
- Typed requests are matched with simple rules ("Channel 4 live", "open Netflix", "put on Cars"). Using Claude for vaguer requests comes later.
- Amazon keeps the Home button for its own screen. Hearth opens itself when the stick starts and is one click away otherwise.

## Fonts and libraries

Figtree and Newsreader (SIL Open Font License) are bundled in `assets/fonts`. QR codes use qrcode-generator 1.4.4 by Kazuhiko Arase (MIT).

## Making Hearth the home screen

Fire TV keeps Home for Amazon's own screen. Hearth's `HomeWatcher` switches to Hearth whenever Amazon's home appears (after Home, waking the TV or a restart). Turn it on once from a computer:

```
adb shell settings put secure enabled_accessibility_services app.hearth.tv/app.hearth.tv.HomeWatcher
adb shell settings put secure accessibility_enabled 1
```

Press Home twice quickly to stay on Amazon's home for two minutes. To turn it off: `adb shell settings put secure enabled_accessibility_services ""`.
