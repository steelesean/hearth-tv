// Everything the home screen shows, in one place. The TV page, the phone remote and the
// Android app all read this file. Keep the part after "=" as strict JSON (double quotes,
// no trailing commas) because the Android side parses it directly.
//
// apps:     "packages" are tried first; if none is installed, any app whose name contains
//           one of "match" is used instead.
// channels: "url" is an untested guess at a direct link to the live stream. If the app
//           refuses it, the app simply opens on its home page.
// kids:     "url" is empty until we've tested which links each app accepts on the stick.
window.HEARTH_CONFIG = {
  "tvName": "Living room TV",
  "apps": [
    { "key": "live", "label": "Live TV", "name": "Live TV", "swatch": "#E5574B", "live": true },
    { "key": "iplayer", "label": "iPlayer", "name": "BBC iPlayer", "swatch": "#E8417F",
      "packages": ["uk.co.bbc.iplayer", "bbc.iplayer.android"], "match": ["iplayer"] },
    { "key": "channel4", "label": "Channel 4", "name": "Channel 4", "swatch": "#3E8E7E",
      "packages": ["com.channel4.ondemand", "com.channel4.firetv"], "match": ["channel 4"] },
    { "key": "netflix", "label": "Netflix", "name": "Netflix", "swatch": "#D8302F",
      "packages": ["com.netflix.ninja"], "match": ["netflix"] },
    { "key": "disney", "label": "Disney+", "name": "Disney+", "swatch": "#2B4FA8",
      "packages": ["com.disney.disneyplus"], "match": ["disney"] },
    { "key": "prime", "label": "Prime Video", "name": "Prime Video", "swatch": "#2AA3D6",
      "packages": ["com.amazon.firebat", "com.amazon.avod"], "match": ["prime video"] },
    { "key": "appletv", "label": "Apple TV", "name": "Apple TV", "swatch": "#8E9290",
      "packages": ["com.apple.atve.amazon.appletv"], "match": ["apple tv"] },
    { "key": "youtube", "label": "YouTube", "name": "YouTube", "swatch": "#E3392E",
      "packages": ["com.amazon.firetv.youtube"], "match": ["youtube"] }
  ],
  "extraApps": [
    { "key": "itvx", "name": "ITVX", "packages": ["air.ITVMobilePlayer"], "match": ["itvx", "itv"] },
    { "key": "my5", "name": "My5", "packages": [], "match": ["my5", "channel 5"] }
  ],
  "channels": [
    { "key": "bbcone", "name": "BBC One", "app": "iplayer", "url": "https://www.bbc.co.uk/iplayer/live/bbcone", "aliases": ["bbc 1", "bbc one"] },
    { "key": "bbctwo", "name": "BBC Two", "app": "iplayer", "url": "https://www.bbc.co.uk/iplayer/live/bbctwo", "aliases": ["bbc 2", "bbc two"] },
    { "key": "itv1", "name": "ITV1", "app": "itvx", "url": "", "aliases": ["itv1", "itv 1", "itv"] },
    { "key": "c4", "name": "Channel 4", "app": "channel4", "url": "https://www.channel4.com/now/C4", "aliases": ["channel 4", "channel four", "c4"] },
    { "key": "e4", "name": "E4", "app": "channel4", "url": "https://www.channel4.com/now/E4", "aliases": ["e4"] },
    { "key": "c5", "name": "Channel 5", "app": "my5", "url": "", "aliases": ["channel 5", "channel five"] },
    { "key": "cbeebies", "name": "CBeebies", "app": "iplayer", "url": "https://www.bbc.co.uk/iplayer/live/cbeebies", "aliases": ["cbeebies"] }
  ],
  "kids": [
    { "key": "gruffalo", "title": "The Gruffalo", "app": "iplayer", "src": "iPlayer", "art": "k-gruffalo", "url": "", "aliases": ["gruffalo"], "bedtime": false },
    { "key": "broom", "title": "Room on the Broom", "app": "iplayer", "src": "iPlayer", "art": "k-broom", "url": "", "aliases": ["room on the broom", "broom"], "bedtime": true },
    { "key": "bluey", "title": "Bluey", "app": "iplayer", "src": "iPlayer · Disney+", "art": "k-bluey", "url": "", "aliases": ["bluey"], "bedtime": false },
    { "key": "cars", "title": "Cars", "app": "disney", "src": "Disney+", "art": "k-cars", "url": "", "aliases": ["cars", "lightning mcqueen", "mcqueen"], "bedtime": false },
    { "key": "zog", "title": "Zog", "app": "iplayer", "src": "iPlayer", "art": "k-zog", "url": "", "aliases": ["zog"], "bedtime": true },
    { "key": "stickman", "title": "Stick Man", "app": "iplayer", "src": "iPlayer", "art": "k-stickman", "url": "", "aliases": ["stick man", "stickman"], "bedtime": true }
  ]
};
