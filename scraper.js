const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const CACHE_DIR = path.join(DATA_DIR, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'EsportsPredBot/1.0 (contact: admin@allir.co.za)';

function cache(key, fetcher, ttlMs = 4 * 60 * 60 * 1000) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(file)) {
    try {
      const { ts, data } = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - ts < ttlMs) return Promise.resolve(data);
    } catch {}
  }
  return fetcher().then(data => {
    fs.writeFileSync(file, JSON.stringify({ ts: Date.now(), data }));
    return data;
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── PandaScore API (if key available) ──────────────────────────────
async function fetchPandaScore(game, date) {
  const key = process.env.PANDASCORE_API_KEY;
  if (!key) return null;
  
  const gameMap = { cs2: 'csgo', dota2: 'dota2', lol: 'lol', valorant: 'valorant' };
  const slug = gameMap[game];
  if (!slug) return null;

  try {
    const { data } = await axios.get(`https://api.pandascore.co/v2/${slug}/matches/upcoming`, {
      headers: { Authorization: `Bearer ${key}` },
      params: { sort: 'begin_at', per_page: 50 },
      timeout: 15000,
    });
    
    return data
      .filter(m => m.begin_at && dayjs(m.begin_at).format('YYYY-MM-DD') === date)
      .map(m => ({
        id: m.id,
        game,
        team1: m.opponents?.[0]?.opponent?.name || 'TBD',
        team2: m.opponents?.[1]?.opponent?.name || 'TBD',
        time: dayjs(m.begin_at).tz('Africa/Johannesburg').format('HH:mm'),
        tournament: m.tournament?.name || m.league?.name || 'Unknown',
        series: m.serie?.full_name || '',
        bestOf: m.number_of_games || 1,
        source: 'pandascore',
      }))
      .filter(m => m.team1 !== 'TBD' && m.team2 !== 'TBD');
  } catch (e) {
    console.log(`  PandaScore ${game} error: ${e.message}`);
    return null;
  }
}

// ─── Liquipedia Scraper (CS2, Dota 2, LoL, Valorant) ───────────────
async function fetchLiquipedia(game, date) {
  const urlMap = {
    cs2: 'https://liquipedia.net/counterstrike/Liquipedia:Upcoming_and_ongoing_matches',
    dota2: 'https://liquipedia.net/dota2/Liquipedia:Upcoming_and_ongoing_matches',
    lol: 'https://liquipedia.net/leagueoflegends/Liquipedia:Upcoming_and_ongoing_matches',
    valorant: 'https://liquipedia.net/valorant/Liquipedia:Matches',
  };
  
  const url = urlMap[game];
  if (!url) return [];
  
  const cacheKey = `liquipedia-${game}-${date}`;
  return cache(cacheKey, async () => {
    try {
      const { data: html } = await axios.get(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Encoding': 'gzip',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 20000,
      });
      
      const $ = cheerio.load(html);
      const matches = [];
      
      // Liquipedia match tables - they use .infobox_matches_content
      $('.infobox_matches_content').each((_, el) => {
        const $el = $(el);
        
        // Team names
        const team1 = $el.find('.team-left .team-template-text a').first().text().trim() ||
                       $el.find('.team-left .team-template-text').first().text().trim();
        const team2 = $el.find('.team-right .team-template-text a').first().text().trim() ||
                       $el.find('.team-right .team-template-text').first().text().trim();
        
        // Tournament
        const tournament = $el.find('.league-icon-small-image a').attr('title') || '';
        
        // Time from timer-object
        const timeEl = $el.find('.timer-object');
        const timestamp = timeEl.attr('data-timestamp');
        
        // Best-of format
        const formatText = $el.find('.versus abbr').text().trim() || $el.find('.versus').text().trim();
        let bestOf = 3;
        const boMatch = formatText.match(/Bo(\d)/i);
        if (boMatch) bestOf = parseInt(boMatch[1]);
        
        let matchTime = '??:??';
        let matchDate = date;
        if (timestamp) {
          const d = dayjs.unix(parseInt(timestamp)).tz('Africa/Johannesburg');
          matchTime = d.format('HH:mm');
          matchDate = d.format('YYYY-MM-DD');
        }
        
        if (team1 && team2 && team1 !== 'TBD' && team2 !== 'TBD' && matchDate === date) {
          matches.push({
            game,
            team1,
            team2,
            time: matchTime,
            tournament: tournament || `${game.toUpperCase()} Match`,
            bestOf,
            source: 'liquipedia',
          });
        }
      });
      
      return matches;
    } catch (e) {
      console.log(`  Liquipedia ${game} scrape error: ${e.message}`);
      return [];
    }
  });
}

// ─── Fetch team info for analysis context ───────────────────────────
async function fetchTeamContext(team1, team2, game) {
  const cacheKey = `context-${game}-${team1}-${team2}`.replace(/[^a-zA-Z0-9-]/g, '_');
  return cache(cacheKey, async () => {
    const context = { team1Info: '', team2Info: '', h2h: '' };
    
    const gameSlug = { cs2: 'counterstrike', dota2: 'dota2', lol: 'leagueoflegends', valorant: 'valorant' };
    const slug = gameSlug[game];
    if (!slug) return context;
    
    for (const [teamName, key] of [[team1, 'team1Info'], [team2, 'team2Info']]) {
      try {
        await sleep(2000); // Respect Liquipedia rate limits
        const teamSlug = teamName.replace(/ /g, '_');
        const { data: html } = await axios.get(`https://liquipedia.net/${slug}/${teamSlug}`, {
          headers: { 'User-Agent': UA },
          timeout: 15000,
        });
        
        const $ = cheerio.load(html);
        
        // Extract team info from infobox
        const infoboxParts = [];
        $('.infobox-cell-2, .infobox-description').each((_, el) => {
          const text = $(el).text().trim();
          if (text && text.length < 200) infoboxParts.push(text);
        });
        
        // Get recent results if available
        const recentResults = [];
        $('.recent-divs .team-template-text, .wikitable.wikitable-striped tr').slice(0, 8).each((_, el) => {
          const text = $(el).text().trim().replace(/\s+/g, ' ').slice(0, 120);
          if (text && text.length > 5) recentResults.push(text);
        });
        
        context[key] = [
          infoboxParts.slice(0, 10).join(' | '),
          recentResults.length > 0 ? `Recent: ${recentResults.join(' | ')}` : '',
        ].filter(Boolean).join('\n').slice(0, 800);
      } catch {
        // Team page not found - that's okay
      }
    }
    
    return context;
  }, 12 * 60 * 60 * 1000);
}

// ─── Main: get all matches for a date ───────────────────────────────
async function getAllMatches(date) {
  console.log(`🎮 Fetching esports matches for ${date}...\n`);
  
  let allMatches = [];
  
  // Try PandaScore first for all games
  const pandaGames = ['cs2', 'dota2', 'lol', 'valorant'];
  for (const game of pandaGames) {
    const pandaMatches = await fetchPandaScore(game, date);
    if (pandaMatches && pandaMatches.length > 0) {
      console.log(`  PandaScore ${game}: ${pandaMatches.length} matches`);
      allMatches.push(...pandaMatches);
    }
  }
  
  // Use Liquipedia for games not covered by PandaScore
  const pandaGamesFound = new Set(allMatches.map(m => m.game));
  
  for (const game of ['cs2', 'dota2', 'lol', 'valorant']) {
    if (!pandaGamesFound.has(game)) {
      await sleep(2500); // Rate limit between Liquipedia requests
      const liqMatches = await fetchLiquipedia(game, date);
      console.log(`  Liquipedia ${game}: ${liqMatches.length} matches`);
      allMatches.push(...liqMatches);
    }
  }
  
  // Deduplicate by team names
  const seen = new Set();
  allMatches = allMatches.filter(m => {
    const key = `${m.game}-${[m.team1, m.team2].sort().join('-')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // Sort: prioritize matches with known times, then alphabetically by game
  allMatches.sort((a, b) => {
    if (a.game !== b.game) return a.game.localeCompare(b.game);
    if (a.time === '??:??' && b.time !== '??:??') return 1;
    if (a.time !== '??:??' && b.time === '??:??') return -1;
    return a.time.localeCompare(b.time);
  });
  
  console.log(`\n  Total: ${allMatches.length} unique matches\n`);
  return allMatches;
}

module.exports = { getAllMatches, fetchTeamContext, cache };
