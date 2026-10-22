# FAU Owl Weather 🦉

A weather app branded for Florida Atlantic University. It opens on **FAU's Boca Raton campus** and uses the free, keyless [Open-Meteo](https://open-meteo.com/) APIs.

## Features

- **Animated sky visualizer** behind the main card that matches the live weather: falling rain with splashes, drizzle, thunderstorms with lightning, snow, sleet, drifting fog, moving clouds, a glowing sun by day, and a moon and twinkling stars at night. A picker lets you preview every effect. It pauses when off-screen and shows a still frame for users who prefer reduced motion.
- **12-hour HD radar:** an animated loop of the NEXRAD high-resolution reflectivity mosaic, one frame every 15 minutes, on a dark map. It has play/pause, step and scrub controls and a legend. It follows the searched city and only loads when you scroll to it.
- **Surf report** for 9 South Florida spots, defaulting to Boca Raton Inlet. It shows estimated surf size and a rating (Flat to Epic), swell, wind (onshore or offshore for that beach), water temperature, next high and low tide, a 48-hour wave chart and a tide curve (both with hover tooltips and a table view), the best surf window today, and live NWS alerts such as rip current statements.
- **Local beach cams:** links to free public cams from Palm Beach County, the cities of Boca Raton, Deerfield Beach and Pompano Beach, EarthCam, WPTV, Loggerhead Marinelife Center and the Town of Jupiter, nearest to FAU first.
- Current conditions: temperature, feels-like, humidity, wind and gusts, UV, cloud cover, pressure, sunrise and sunset
- A short plain-English summary ("Rain is likely today… grab an umbrella")
- Hourly forecast for the next 24 hours and a 7-day forecast with temperature range bars
- City search with autocomplete (Open-Meteo Geocoding API)
- "My location" (browser geolocation) and a one-click **FAU Boca** reset
- **Sign in with Google, Apple (iCloud) or Yahoo** through Supabase Auth (see setup below)
- °F / °C toggle; your last location and units are remembered
- Refreshes every 15 minutes; responsive with light and dark mode
- FAU brand colors (FAU Blue `#003366`, FAU Red `#CC0000`) and an owl mascot logo

## Project structure

```
netlify.toml          Netlify config (publish dir + security headers)
public/
  index.html          App shell
  404.html            Not-found page
  css/styles.css      FAU-themed styles
  js/app.js           App logic (fetching, rendering, search, preferences)
  js/weather-codes.js WMO weather codes → descriptions, SVG icons, intensity
  js/visualizer.js    Canvas animation for the sky visualizer
  js/auth.js          Sign in / sign out with Supabase Auth
  js/radar.js         12-hour radar loop (Leaflet + IEM NEXRAD tiles)
  js/surf.js          Surf report, wave/tide charts, NWS beach alerts
  js/config.js        Supabase URL + publishable key (fill these in)
  vendor/             Bundled supabase-js 2.118.0 and Leaflet 1.9.4 (both open source), so no CDN is needed
  assets/fau-logo.svg Logo shown in the header
  favicon.svg, manifest.webmanifest
```

It's plain HTML, CSS, and JavaScript. There's no build step, and supabase-js is bundled into `vendor/`, so there's nothing to install.

## Run locally

Any static file server works, for example:

```bash
npx serve public
# or
python3 -m http.server --directory public 8080
```

## Deploy to Netlify

**Option A: Git (recommended)**
1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo.
2. Leave **Build command** empty. `netlify.toml` already sets **Publish directory** to `public`.
3. Click **Deploy**. Every push to `main` redeploys automatically.

**Option B: Drag and drop.** Drag the `public` folder onto <https://app.netlify.com/drop>.

**Option C: CLI**
```bash
npm i -g netlify-cli
netlify deploy --prod --dir=public
```

## Sign-in setup (Supabase)

The sign-in button works once these steps are done. Until then the app runs normally, and the sign-in window says it isn't set up yet.

Throughout, `<ref>` is your Supabase project ID and `<site>` is your Netlify address (for example `fau-owl-weather.netlify.app`). Each provider sends people back to this **callback URL**:

```
https://<ref>.supabase.co/auth/v1/callback
```

### 1. Connect the app to Supabase
The app is already connected to the Supabase project **fau-owl-weather** (`zneotlgffuedbiqstzcw`, us-east-1). Its Project URL and publishable key are in `public/js/config.js`. Both are safe to make public. Never put the secret or `service_role` key in this app.

1. Open the project at <https://supabase.com/dashboard/project/zneotlgffuedbiqstzcw>.
2. The callback URL for every provider below is `https://zneotlgffuedbiqstzcw.supabase.co/auth/v1/callback`.
3. In **Authentication → URL Configuration**:
   - set **Site URL** to `https://<site>`
   - add these **Redirect URLs**: `https://<site>/**` and `http://localhost:8080/**` (for local testing)

### 2. Google
1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), set up the **OAuth consent screen**. Then go to **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add `https://<site>`. Under **Authorized redirect URIs**, add the callback URL.
3. In Supabase, go to **Authentication → Sign In / Providers → Google**. Turn it on and paste the Client ID and Client Secret.

### 3. Apple (iCloud)
This needs a paid [Apple Developer Program](https://developer.apple.com/programs/) membership ($99/year).
1. In **Certificates, Identifiers & Profiles**, create an **App ID** with *Sign in with Apple* turned on.
2. Create a **Services ID**. Its identifier becomes your client ID. Turn on *Sign in with Apple* for it, set the domain to `<ref>.supabase.co`, and set the return URL to the callback URL.
3. Create a **Key** with *Sign in with Apple* turned on, and download the `.p8` file.
4. In Supabase, go to **Authentication → Sign In / Providers → Apple**. Turn it on, enter the Services ID, and generate the client secret from your Team ID, Key ID and `.p8` file. **Apple's secret expires every 6 months**, so set a reminder to regenerate it.

### 4. Yahoo
Supabase doesn't have Yahoo built in, so it's added as a custom OpenID Connect provider.
1. At [developer.yahoo.com/apps](https://developer.yahoo.com/apps/), create an app. Set the **Redirect URI** to the callback URL, and under **OpenID Connect Permissions** tick **Email** and **Profile**.
2. In Supabase, go to **Authentication → Sign In / Providers → New Provider → Auto-discovery (OIDC)** and enter:
   - Identifier: `custom:yahoo` (this must match `PROVIDERS.yahoo` in `config.js`)
   - Client ID and Client Secret: from your Yahoo app
   - Issuer URL: `https://api.login.yahoo.com`
   - Scopes: `openid profile email`

### Security notes
- `netlify.toml`'s Content-Security-Policy only allows connections to this app's Supabase project. If you switch projects, update the URL there as well as in `config.js`.
- Sign-in uses the PKCE flow. Sessions are stored in the browser and refreshed automatically.

## Logo

`public/assets/fau-logo.svg` is an owl mascot drawn in FAU colors (also used as `favicon.svg`). To use FAU's official logo, save it over that file with the same name (SVG), or change the `src` in `index.html`. The FAU name and marks are trademarks of Florida Atlantic University. See FAU's brand guidelines for usage rules.

## Credits

- **Weather and marine data:** [Open-Meteo.com](https://open-meteo.com/), licensed under CC BY 4.0. Marine tides are model estimates at about 8 km resolution and aren't for navigation.
- **Radar:** NWS NEXRAD mosaic tiles from the [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/) (`ridge::USCOMP-N0Q-YYYYMMDDHHMI`, archived every 5 minutes, UTC).
- **Map:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/attributions). CARTO's free basemaps are meant for light, non-commercial use, so switch to a paid or self-hosted basemap if the site gets heavy traffic.
- **Beach and marine alerts:** [National Weather Service API](https://www.weather.gov/documentation/services-web-api).
- **Beach cams:** each is owned and run by the provider named on its card. The app only links to them.
