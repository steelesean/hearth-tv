package app.hearth.tv;

import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Finds a BBC programme's iPlayer IDs by name, using iPlayer's public search, so iPlayer
 * shows can be opened directly without anyone pasting a link. Returns the series ID and the
 * latest available episode's ID.
 */
final class IplayerLookup {
    private static final Pattern ID = Pattern.compile("\"id\"\\s*:\\s*\"([a-z0-9]{8})\"");

    private IplayerLookup() {}

    /** {brand, episode, title} or null if iPlayer has nothing by that name. Blocking. */
    static JSONObject find(String title) {
        try {
            String q = URLEncoder.encode(title, "UTF-8");
            String search = Net.get("https://ibl.api.bbc.co.uk/ibl/v1/new-search?q=" + q + "&rights=tv&availability=available");
            // The results are a list of programmes; take the first whose title matches.
            JSONObject root = new JSONObject(search);
            JSONObject ns = root.optJSONObject("new_search");
            org.json.JSONArray results = ns == null ? null : ns.optJSONArray("results");
            String brand = null, found = null;
            String want = title.toLowerCase(Locale.UK).replaceAll("^the ", "");
            for (int i = 0; results != null && i < results.length(); i++) {
                JSONObject r = results.optJSONObject(i);
                if (r == null) continue;
                String t = r.optString("title").toLowerCase(Locale.UK).replaceAll("^the ", "");
                if (t.equals(want) || t.startsWith(want)) { brand = r.optString("id"); found = r.optString("title"); break; }
            }
            if (brand == null || brand.isEmpty()) return null;
            String eps = Net.get("https://ibl.api.bbc.co.uk/ibl/v1/programmes/" + brand + "/episodes?per_page=1&availability=available");
            Matcher m = ID.matcher(eps.substring(Math.min(eps.length(), Math.max(0, eps.indexOf("elements")))));
            String episode = m.find() ? m.group(1) : "";
            return new JSONObject().put("brand", brand).put("episode", episode).put("title", found);
        } catch (Exception e) {
            return null;
        }
    }
}
