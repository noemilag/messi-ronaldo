// Keeps data.json up to date: career goal totals, each player's last match stats and next match.
// Data source: API-Football (https://www.api-football.com), key in the API_FOOTBALL_KEY secret.
// Usage: node scripts/update.mjs            -> check recent and upcoming matches
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
const UPCOMING = new Set(["TBD", "NS"]);
const FRIENDLY_LEAGUES = new Set([10, 667]); // international and club friendlies are not official goals
// The free plan only serves dates from yesterday to tomorrow, so day-by-day lookups stay inside that window.

const data = JSON.parse(await readFile(FILE, "utf8"));
data.lastMatch ??= {};
data.next ??= {};
const before = JSON.stringify(data);
const today = new Date();
const label = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" });
const day = (offset) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);

async function save() {
  if (JSON.stringify(data) === before) { console.log("Rien de nouveau."); return; }
  data.feed = data.feed.slice(0, 20);
  data.counted = data.counted.slice(-300);
  await writeFile(FILE, JSON.stringify(data, null, 2) + "\n");
  console.log(`data.json mis à jour : Messi ${data.goals.m}, Ronaldo ${data.goals.r}`);
}

// Manual correction
const [manualM, manualR] = process.argv.slice(2).map(Number);
if (Number.isInteger(manualM) && Number.isInteger(manualR)) {
  data.goals = { m: manualM, r: manualR };
  data.updated = day(0);
  data.feed.unshift([label(today), "n", `Compteurs corrigés : Messi ${manualM}, Ronaldo ${manualR}.`]);
  await save();
  process.exit(0);
}

// Errors are printed as GitHub annotations so they show on the run summary and in the failure email.
function fail(message) {
  console.log(`::error title=Mise à jour des buts::${message}`);
  process.exit(1);
}

if (!KEY) fail("Le secret API_FOOTBALL_KEY est manquant ou vide. Ajoute-le dans Settings > Secrets and variables > Actions.");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// soft: a refusal is logged and returns null instead of stopping the run (for optional lookups).
async function api(path, soft = false) {
  await pause(6500); // stay under the free plan's per-minute limit
  const res = await fetch(API + path, { headers: { "x-apisports-key": KEY } }).catch((e) => fail(`API-Football injoignable : ${e.message}`));
  if (!res.ok) fail(`API-Football répond ${res.status} sur ${path}`);
  const body = await res.json();
  const errors = Array.isArray(body.errors) ? body.errors : Object.values(body.errors || {});
  if (errors.length && soft) { console.log(`::notice title=Recherche facultative refusée::${path} : ${errors.join(" / ")}`); return null; }
  if (errors.length) fail(`API-Football refuse ${path} : ${errors.join(" / ")}`);
  console.log(`${path} -> ${body.results} résultat(s), quota restant : ${res.headers.get("x-ratelimit-requests-remaining")}`);
  return body.response;
}

// The free plan refuses the "last" and "next" parameters, so matches are fetched day by day
// (one call returns every match in the world that day) and filtered on our teams.
const byDay = new Map();
async function fixturesOn(d) {
  if (!byDay.has(d)) byDay.set(d, await api(`/fixtures?date=${d}&timezone=UTC`));
  return byDay.get(d);
}
const teamIn = (f, team) => f.teams.home.id === team.id || f.teams.away.id === team.id;
function describe(f, team) {
  const home = f.teams.home.id === team.id;
  return {
    date: f.fixture.date,
    team: team.name,
    opponent: home ? f.teams.away.name : f.teams.home.name,
    home,
    league: f.league.name,
  };
}

function recordLastMatch(side, player, team, f, lineup) {
  const entry = lineup[0].players.find((p) => p.player.id === player.id);
  const s = entry?.statistics?.[0];
  const minutes = s?.games?.minutes || 0;
  const info = describe(f, team);
  const own = info.home ? f.goals.home : f.goals.away;
  const other = info.home ? f.goals.away : f.goals.home;
  // Keep the most recent match the player actually played
  if (minutes > 0 && (!data.lastMatch[side] || data.lastMatch[side].date < f.fixture.date)) {
    data.lastMatch[side] = {
      ...info,
      score: `${own}-${other}`,
      result: own > other ? "V" : own < other ? "D" : "N",
      stats: {
        minutes,
        goals: s.goals?.total || 0,
        assists: s.goals?.assists || 0,
        shots: s.shots?.total || 0,
        shotsOn: s.shots?.on || 0,
        passes: s.passes?.total || 0,
        keyPasses: s.passes?.key || 0,
        accuracy: Number(s.passes?.accuracy) || null,
        dribbles: s.dribbles?.success || 0,
        rating: s.games?.rating ? Number(s.games.rating) : null,
      },
    };
  }
  return s;
}

const firstRunToday = data.check?.date !== day(0);

// 1. Finished matches of yesterday and today.
const days = [day(-1), day(0)];

const counted = new Set(data.counted);
const fresh = []; // [date, feed entry], sorted newest first before saving
let seen = 0;

for (const d of days) {
  const all = await fixturesOn(d);
  seen += all.length;
  for (const [side, player] of Object.entries(PLAYERS)) {
    for (const team of player.teams) {
      for (const f of all.filter((f) => teamIn(f, team))) {
        const id = f.fixture.id;
        if (counted.has(id) || !FINISHED.has(f.fixture.status.short)) continue;

        const lineup = await api(`/fixtures/players?fixture=${id}&team=${team.id}`);
        if (!lineup.length) { console.log(`Stats du match ${id} pas encore publiées, nouvel essai plus tard.`); continue; }
        counted.add(id); data.counted.push(id);

        const s = recordLastMatch(side, player, team, f, lineup);
        const info = describe(f, team);

        // Career total: only official matches since the reference date
        const goals = s?.goals?.total || 0;
        if (!goals || f.fixture.date.slice(0, 10) < data.since || FRIENDLY_LEAGUES.has(f.league.id)) continue;
        data.goals[side] += goals;
        data.updated = day(0);
        const what = goals === 1 ? "marque" : goals === 2 ? "s'offre un doublé" : `marque ${goals} buts`;
        fresh.push([f.fixture.date, [label(new Date(f.fixture.date)), player.feed,
          `${player.name} ${what} contre ${info.opponent} (${f.league.name}). Il passe à ${data.goals[side]} buts.`]]);
        console.log(`${player.name} +${goals} contre ${info.opponent}`);
      }
    }
  }
}
fresh.sort((a, b) => b[0].localeCompare(a[0]));
data.feed.unshift(...fresh.map(([, entry]) => entry));

// 2. Once a day: next match, and a last match for a player who has none yet.
// Tries each team's season calendar first; if the free plan refuses it, falls back to today and tomorrow.
const nowIso = today.toISOString();
if (firstRunToday || Object.keys(PLAYERS).some((s) => data.next[s] && data.next[s].date < nowIso)) {
  const found = {};
  let calendarRefused = false;
  for (const [side, player] of Object.entries(PLAYERS)) {
    for (const team of player.teams) {
      const season = await api(`/fixtures?team=${team.id}&season=${today.getUTCFullYear()}&timezone=UTC`, true);
      if (!season) { calendarRefused = true; break; }
      const upcoming = season.filter((f) => UPCOMING.has(f.fixture.status.short) && f.fixture.date > nowIso)
        .sort((a, b) => a.fixture.date.localeCompare(b.fixture.date))[0];
      if (upcoming && (!found[side] || upcoming.fixture.date < found[side].date)) found[side] = describe(upcoming, team);
      if (!data.lastMatch[side]) {
        const played = season.filter((f) => FINISHED.has(f.fixture.status.short))
          .sort((a, b) => b.fixture.date.localeCompare(a.fixture.date))[0];
        const lineup = played && await api(`/fixtures/players?fixture=${played.fixture.id}&team=${team.id}`, true);
        if (lineup?.length) recordLastMatch(side, player, team, played, lineup);
      }
    }
    if (calendarRefused) break;
  }
  if (calendarRefused) {
    for (const d of [day(0), day(1)]) {
      for (const f of await fixturesOn(d)) {
        if (!UPCOMING.has(f.fixture.status.short) || f.fixture.date < nowIso) continue;
        for (const [side, player] of Object.entries(PLAYERS)) {
          const team = player.teams.find((t) => teamIn(f, t));
          if (team && (!found[side] || f.fixture.date < found[side].date)) found[side] = describe(f, team);
        }
      }
    }
  }
  for (const side of Object.keys(PLAYERS)) data.next[side] = found[side] || null;
  data.check = { date: day(0), fixtures: seen, calendar: !calendarRefused };
}

console.log(`::notice title=Matchs vérifiés::${seen} matchs lus. Dernier match Messi : ${data.lastMatch.m?.opponent ?? "aucun"}, Ronaldo : ${data.lastMatch.r?.opponent ?? "aucun"}. Prochain match Messi : ${data.next.m?.opponent ?? "aucun"}, Ronaldo : ${data.next.r?.opponent ?? "aucun"}.`);
await save();
