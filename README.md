# FAU Owl Weather 🦉

A weather app branded for Florida Atlantic University. It opens on **FAU's Boca Raton campus** and uses the free, keyless [Open-Meteo](https://open-meteo.com/) APIs.

## Features

- Current conditions: temperature, feels-like, humidity, wind and gusts, UV, cloud cover, pressure, sunrise and sunset
- A short plain-English summary ("Rain is likely today… grab an umbrella")
- Hourly forecast for the next 24 hours and a 7-day forecast with temperature range bars
- City search with autocomplete (Open-Meteo Geocoding API)
- "My location" (browser geolocation) and a one-click **FAU Boca** reset
- °F / °C toggle; your last location and units are remembered
- Refreshes every 15 minutes; responsive with light and dark mode
- FAU brand colors (FAU Blue `#003366`, FAU Red `#CC0000`) and an owl logo

## Project structure

```
netlify.toml          Netlify config (publish dir + security headers)
public/
  index.html          App shell
  404.html            Not-found page
  css/styles.css      FAU-themed styles
  js/app.js           App logic (fetching, rendering, search, preferences)
  js/weather-codes.js WMO weather codes → descriptions and SVG icons
  assets/fau-logo.svg Logo shown in the header
  favicon.svg, manifest.webmanifest
```

It's plain HTML, CSS, and JavaScript. There's no build step and no dependencies.

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

## Logo

`public/assets/fau-logo.svg` is an owl mark drawn in FAU colors. To use FAU's official logo, save it over that file with the same name (SVG), or change the `src` in `index.html`. The FAU name and marks are trademarks of Florida Atlantic University. See FAU's brand guidelines for usage rules.

## Credits

Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed under CC BY 4.0.
