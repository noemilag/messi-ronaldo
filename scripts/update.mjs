// Adds the goals Messi and Ronaldo scored in newly finished matches to data.json.
// Data source: API-Football (https://www.api-football.com), key in the API_FOOTBALL_KEY secret.
// Usage: node scripts/update.mjs            -> check yesterday's and today's matches
//        node scripts/update.mjs 937 983    -> set both totals by hand (correction)
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../data.json", import.meta.url);
const API = "https://v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY;

// Player and team ids in API-Football. Messi retired from Argentina on 6 Oct 2026, so only his club is checked.
const PLAYERS = {
  m: { id: 154, name: "Messi", feed: "m", teams: [{ id: 9568, name: "Inter Miami" }] },
  r: { id: 874, name: "Ronaldo", feed: "c", teams: [{ id: 2939, name: "Al-Nassr" }, { id: 27, name: "Portugal" }] },
};
const FINISHED = new Set(["FT", "AET", "PEN"]);
const FRIENDLY_LEAGUES = new Set([10, 667]); // international and club friendlies are not official goals

const data = JSON.parse(await readFile(FILE, "utf8"));
const today = new Date();
const label = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });

async function save(changed) {
  if (!changed) { console.log("Aucun nouveau but."); return; }
  data.updated = today.toISOString().slice(0, 10);
  data.feed = data.feed.slice(0, 20);
  data.counted = data.counted.slice(-200);
  await writeFile(FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`data.json mis à jour : Messi ${data.goals.m}, Ronaldo ${data.goals.r}`);
}

// Manual correction
const [manualM, manualR] = process.argv.slice(2).map(Number);
if (Number.isInteger(manualM) && Number.isInteger(manualR)) {
  data.goals = { m: manualM, r: manualR };
  data.feed.unshift([label(today), "n", `Compteurs corrigés : Messi ${manualM}, Ronaldo ${manualR}.`]);
  await save(true);
  process.exit(0);
}

// Errors are printed as GitHub annotations so they show on the run summary and in the failure email.
function fail(message) {
  console.log(`::error title=Mise à jour des buts::${message}`);
  process.exit(1);
}

if (!KEY) fail("Le secret API_FOOTBALL_KEY est manquant ou vide. Ajoute-le dans Settings > Secrets and variables > Actions.");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path) {
  await pause(6500); // stay under the free plan's per-minute limit
  const res = await fetch(API + path, { headers: { "x-apisports-key": KEY } }).catch((e) => fail(`API-Football injoignable : ${e.message}`));
  if (!res.ok) fail(`API-Football répond ${res.status} sur ${path}`);
  const body = await res.json();
  const errors = Array.isArray(body.errors) ? body.errors : Object.values(body.errors || {});
  if (errors.length) fail(`API-Football refuse ${path} : ${errors.join(" / ")}`);
  console.log(`${path} -> ${body.results} résultat(s), quota restant : ${res.headers.get("x-ratelimit-requests-remaining")}`);
  return body.response;
}

const counted = new Set(data.counted);
const fresh = []; // [date, feed entry], sorted newest first before saving
let changed = false;

// The free plan refuses the "last" parameter, so fetch every match of yesterday and today (one call per day)
// and keep the ones involving our teams. Yesterday covers matches that end after midnight.
const day = (offset) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
const allFixtures = [];
for (const d of [day(-1), day(0)]) allFixtures.push(...await api(`/fixtures?date=${d}&timezone=UTC`));

for (const [side, player] of Object.entries(PLAYERS)) {
  for (const team of player.teams) {
    const fixtures = allFixtures.filter((f) => f.teams.home.id === team.id || f.teams.away.id === team.id);
    for (const f of fixtures) {
      const id = f.fixture.id;
      if (counted.has(id) || !FINISHED.has(f.fixture.status.short)) continue;
      if (f.fixture.date.slice(0, 10) < data.since) continue;
      if (FRIENDLY_LEAGUES.has(f.league.id)) { counted.add(id); data.counted.push(id); continue; }

      const lineup = await api(`/fixtures/players?fixture=${id}&team=${team.id}`);
      if (!lineup.length) { console.log(`Stats du match ${id} pas encore publiées, nouvel essai plus tard.`); continue; }
      const entry = lineup[0].players.find((p) => p.player.id === player.id);
      const goals = entry?.statistics?.[0]?.goals?.total || 0;

      counted.add(id); data.counted.push(id); changed = true;
      if (!goals) continue;

      const opponent = f.teams.home.id === team.id ? f.teams.away.name : f.teams.home.name;
      data.goals[side] += goals;
      const what = goals === 1 ? "marque" : goals === 2 ? "s'offre un doublé" : `marque ${goals} buts`;
      fresh.push([f.fixture.date, [label(new Date(f.fixture.date)), player.feed,
        `${player.name} ${what} contre ${opponent} (${f.league.name}). Il passe à ${data.goals[side]} buts.`]]);
      console.log(`${player.name} +${goals} contre ${opponent}`);
    }
  }
}

fresh.sort((a, b) => b[0].localeCompare(a[0]));
data.feed.unshift(...fresh.map(([, entry]) => entry));
await save(changed);
