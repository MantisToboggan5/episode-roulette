# Episode Roulette

Mobile-first PWA: search for TV shows, save the ones you're watching, and hit
Spin to get a randomly picked (unwatched) episode.

## Setup

1. Get a free TMDB API key:
   - Create an account at https://www.themoviedb.org/signup
   - Go to https://www.themoviedb.org/settings/api and request a key (choose "Developer")
   - Copy the **API Key (v3 auth)** value
2. Copy `js/config.example.js` to `js/config.js` and paste your key in:
   ```js
   const TMDB_API_KEY = "your key here";
   ```
   `js/config.js` is gitignored so your key never gets committed.
3. Run a local server from this folder:
   ```
   python -m http.server 8000
   ```
4. Open http://localhost:8000 in a browser (use a phone-sized viewport / real phone
   to see the intended layout). On a phone you can "Add to Home Screen" to install it.

## Notes

- All data (saved shows, watched episodes) is stored in the browser's localStorage —
  nothing leaves the device except TMDB API calls.
- The TMDB key is used directly from the browser, which is fine for personal/prototype
  use. If this ever needs to scale up publicly, add a small server-side proxy in front
  of TMDB to hide the key and cache responses.
