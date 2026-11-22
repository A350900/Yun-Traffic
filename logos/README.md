# Your airline logos

Put airline logos here to use them on the map (Encyclopedia mode → Airlines by country).

- **Name each file after the airline's 3-letter ICAO code**: `CES.png` (China Eastern),
  `CSN.png` (China Southern), `DAL.svg` (Delta)… Upper or lower case both work.
- **Or keep the name Wikipedia gives it** when you download it: `China_Eastern_Airlines_logo.svg`,
  `United_Airlines_Logo.svg`, `Scandinavian_Airlines_logo.svg`… The app matches the name to the
  airline (other names an airline goes by are in `data/encyclopedia/airline-aliases.json`).
  If a name could mean two airlines, rename that file to the code. When the server starts it
  lists which airline each of your logos went to.
- **Formats**: PNG, SVG, JPG or WebP. A transparent PNG or an SVG looks best.
- **The whole logo** is fine (symbol and text). The map shows it in one light colour;
  the card you get by clicking a country shows it in full colour.
- Your file always wins over a logo downloaded from Wikimedia Commons.
- Refresh the page after adding a logo (no restart needed).

The codes for each country's airlines are in `data/encyclopedia/country-airlines.json`,
and `npm run media:download` lists every airline that still has no logo.

Files you put here stay on your computer: they aren't uploaded to GitHub.
