# Where's Abigya?

A small web app that tracks Abigya's Ethiopian Airlines flights.

- Type a flight number (e.g. ET 673) to get its route, scheduled, estimated and actual times, and status ("landed 3h ago").
- Or pick where she's going and the date, and the app lists the Ethiopian Airlines flights for that route, with a connection through Addis Ababa if there's no direct flight.
- Trips refresh by themselves while she's travelling. A route map, travel stats and a guide for each country (what it's known for, what to buy and eat) are included.

## Setup

1. Get a free API key at https://airlabs.co/signup (about 1,000 lookups a month).
2. Open the site and paste the key when asked. It is saved only in that browser.
3. Or tap **Try demo data** to see it work without a key.

## Hosting (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → pick the branch that holds these files, folder `/ (root)` → Save.
The site appears at `https://<your-username>.github.io/abigya-flights/` after a minute.

Plain HTML/JS with no build step. `data.js` holds the airport list and country guides, and `world.json` holds the map (Natural Earth, via world-atlas).
