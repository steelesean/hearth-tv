// Everything the home screen shows, in one place. The TV page, the phone remote and the
// Android app all read this file. Keep the part after "=" as strict JSON (double quotes,
// no trailing commas) because the Android side parses it directly.
//
// apps:     "packages" are tried first; if none is installed, any app whose name contains
//           one of "match" is used instead.
//
// What our Fire TV Stick 4K (Fire OS 6.2.8) accepts:
//   iPlayer   intent:// links that name its main screen, captured from Fire TV's own
//             launcher (see the channels below). Plain bbc.co.uk links are ignored.
//   Channel 4 only its own channel4:// links, format not yet known.
//   ITVX      itv.com links. Netflix: netflix.com/title and /watch. YouTube: any youtube.com
//             link. Disney+: disneyplus.com links (which kinds still to test).
//   Apple TV and My5 aren't installed yet.
//
// channels: "url" opens the live stream where we know how; otherwise the app opens on its
//           home page.
// searchUrl: optional; where a suggestion from the assistant opens, with {q} as the title.
// kids:     "url" plays the programme straight away (tested on the stick, October 2026).
//           iPlayer programme IDs: The Gruffalo b00pk64x, Room on the Broom p0102qfj,
//           Zog b0bwdw8y, Stick Man b06t09rk. If one leaves iPlayer, the tile will open
//           iPlayer instead. Bluey (series m000vbrk) has no working series link yet.
window.HEARTH_CONFIG = {
  "tvName": "Living room TV",
  "apps": [
    { "key": "live", "label": "Live TV", "name": "Live TV", "swatch": "#E5574B", "live": true },
    { "key": "iplayer", "label": "iPlayer", "name": "BBC iPlayer", "swatch": "#E8417F",
      "packages": ["uk.co.bbc.iplayer"], "match": ["iplayer"] },
    { "key": "channel4", "label": "Channel 4", "name": "Channel 4", "swatch": "#3E8E7E",
      "packages": ["com.channel4.ondemand"], "match": ["channel 4"] },
    { "key": "netflix", "label": "Netflix", "name": "Netflix", "swatch": "#D8302F",
      "packages": ["com.netflix.ninja"], "match": ["netflix"] },
    { "key": "disney", "label": "Disney+", "name": "Disney+", "swatch": "#2B4FA8",
      "packages": ["com.disney.disneyplus"], "match": ["disney"] },
    { "key": "prime", "label": "Prime Video", "name": "Prime Video", "swatch": "#2AA3D6",
      "packages": ["com.amazon.firebat", "com.amazon.avod"], "match": ["prime video"] },
    { "key": "appletv", "label": "Apple TV", "name": "Apple TV", "swatch": "#8E9290",
      "packages": ["com.apple.atve.amazon.appletv"], "match": ["apple tv"] },
    { "key": "youtube", "label": "YouTube", "name": "YouTube", "swatch": "#E3392E",
      "packages": ["com.amazon.firetv.youtube"], "match": ["youtube"],
      "searchUrl": "https://www.youtube.com/results?search_query={q}" }
  ],
  "extraApps": [
    { "key": "itvx", "name": "ITVX", "packages": ["air.ITVMobilePlayer"], "match": ["itvx", "itv"] },
    { "key": "my5", "name": "My5", "packages": [], "match": ["my5", "channel 5"] }
  ],
  "channels": [
    { "key": "bbcone", "name": "BBC One", "app": "iplayer", "url": "intent://www.live.bbctvapps.co.uk/tap/iplayer?deeplink=tv/playback/urn:bbc:iplayer:service:bbc_one/live&campaign=catalogue&medium=referral&origin=portal_live&partner=com.amazon#Intent;scheme=https;component=uk.co.bbc.iplayer/uk.co.bbc.MainActivity;end", "aliases": ["bbc 1", "bbc one"] },
    { "key": "bbctwo", "name": "BBC Two", "app": "iplayer", "url": "intent://www.live.bbctvapps.co.uk/tap/iplayer?deeplink=tv/playback/urn:bbc:iplayer:service:bbc_two/live&campaign=catalogue&medium=referral&origin=portal_live&partner=com.amazon#Intent;scheme=https;component=uk.co.bbc.iplayer/uk.co.bbc.MainActivity;end", "aliases": ["bbc 2", "bbc two"] },
    { "key": "itv1", "name": "ITV1", "app": "itvx", "url": "https://www.itv.com/watch?channel=itv", "aliases": ["itv1", "itv 1", "itv"] },
    { "key": "c4", "name": "Channel 4", "app": "channel4", "url": "https://www.channel4.com/now/C4", "aliases": ["channel 4", "channel four", "c4"] },
    { "key": "e4", "name": "E4", "app": "channel4", "url": "https://www.channel4.com/now/E4", "aliases": ["e4"] },
    { "key": "c5", "name": "Channel 5", "app": "my5", "url": "", "aliases": ["channel 5", "channel five"] },
    { "key": "cbeebies", "name": "CBeebies", "app": "iplayer", "url": "intent://www.live.bbctvapps.co.uk/tap/iplayer?deeplink=tv/playback/urn:bbc:iplayer:service:cbeebies/live&campaign=catalogue&medium=referral&origin=portal_live&partner=com.amazon#Intent;scheme=https;component=uk.co.bbc.iplayer/uk.co.bbc.MainActivity;end", "aliases": ["cbeebies"] }
  ],
  "kids": [
    { "key": "gruffalo", "title": "The Gruffalo", "app": "iplayer", "src": "iPlayer", "art": "k-gruffalo", "url": "intent://www.live.bbctvapps.co.uk/tap/iplayer?deeplink=tv/playback/b00pk64x&campaign=catalogue&medium=referral&origin=portal_live&partner=com.amazon#Intent;scheme=https;component=uk.co.bbc.iplayer/uk.co.bbc.MainActivity;end", "aliases": ["gruffalo"], "bedtime": false },
    { "key": "broom", "title": "Room on the Broom", "app": "iplayer", "src": "iPlayer", "art": "k-broom", "url": "intent://www.live.bbctvapps.co.uk/tap/iplayer?deeplink=tv/playback/p0102qfj&campaign=catalogue&medium=referral&origin=portal_live&partner=com.amazon#Intent;scheme=https;component=uk.co.bbc.iplayer/uk.co.bbc.MainActivity;end", "aliases": ["room on the broom", "broom"], "bedtime": true },
    { "key": "bluey", "title": "Bluey", "app": "iplayer", "src": "iPlayer", "art": "k-bluey", "url": "", "aliases": ["bluey"], "bedtime": false },
    { "key": "cars", "title": "Cars", "app": "disney", "src": "Disney+", "art": "k-cars", "url": "", "aliases": ["cars", "lightning mcqueen", "mcqueen"], "bedtime": false },
    { "key": "zog", "title": "Zog", "app": "iplayer", "src": "iPlayer", "art": "k-zog", "url": "intent://www.live.bbctvapps.co.uk/tap/iplayer?deeplink=tv/playback/b0bwdw8y&campaign=catalogue&medium=referral&origin=portal_live&partner=com.amazon#Intent;scheme=https;component=uk.co.bbc.iplayer/uk.co.bbc.MainActivity;end", "aliases": ["zog"], "bedtime": true },
    { "key": "stickman", "title": "Stick Man", "app": "iplayer", "src": "iPlayer", "art": "k-stickman", "url": "intent://www.live.bbctvapps.co.uk/tap/iplayer?deeplink=tv/playback/b06t09rk&campaign=catalogue&medium=referral&origin=portal_live&partner=com.amazon#Intent;scheme=https;component=uk.co.bbc.iplayer/uk.co.bbc.MainActivity;end", "aliases": ["stick man", "stickman"], "bedtime": true }
  ]
};
