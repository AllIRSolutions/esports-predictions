const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

const DATA_DIR = path.join(__dirname, 'data');
const PREDICTIONS_DIR = path.join(DATA_DIR, 'predictions');
const LEARNING_FILE = path.join(DATA_DIR, 'learning.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadLearning() {
  if (fs.existsSync(LEARNING_FILE)) {
    try { return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8')); } catch {}
  }
  return { stats: {}, lessons: [], history: [] };
}

function saveLearning(data) {
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
}

// Fetch results from HLTV results page
async function fetchHLTVResults() {
  try {
    const { data: html } = await axios.get('https://www.hltv.org/results', {
      headers: { 'User-Agent': UA },
      timeout: 20000,
    });
    const $ = cheerio.load(html);
    const results = [];
    
    $('.result-con, .results-all .result').each((_, el) => {
      const $el = $(el);
      const team1 = $el.find('.team1 .team, .team-won').first().text().trim();
      const team2 = $el.find('.team2 .team, .team:last').text().trim();
      const score = $el.find('.result-score, .score-won').text().trim();
      
      if (team1 && team2) {
        results.push({ team1, team2, score, game: 'cs2' });
      }
    });
    
    return results;
  } catch (e) {
    console.log(`  HLTV results error: ${e.message}`);
    return [];
  }
}

// Fetch results from Liquipedia
async function fetchLiquipediaResults(game) {
  const urlMap = {
    dota2: 'https://liquipedia.net/dota2/Liquipedia:Matches',
    lol: 'https://liquipedia.net/leagueoflegends/Liquipedia:Matches',
    valorant: 'https://liquipedia.net/valorant/Liquipedia:Matches',
  };
  
  const url = urlMap[game];
  if (!url) return [];
  
  try {
    const { data: html } = await axios.get(url, {
      headers: { 'User-Agent': 'EsportsPredBot/1.0 (contact: admin@example.com)' },
      timeout: 20000,
    });
    const $ = cheerio.load(html);
    const results = [];
    
    $('.recent-matches .match-row, .infobox_matches_content').each((_, el) => {
      const $el = $(el);
      const team1 = $el.find('.team-left .team-template-text').text().trim();
      const team2 = $el.find('.team-right .team-template-text').text().trim();
      const score1 = $el.find('.team-left .score, .team-left .match-yes').text().trim();
      const score2 = $el.find('.team-right .score, .team-right .match-yes').text().trim();
      
      if (team1 && team2 && (score1 || score2)) {
        results.push({ team1, team2, score: `${score1}-${score2}`, game });
      }
    });
    
    return results;
  } catch (e) {
    console.log(`  Liquipedia ${game} results error: ${e.message}`);
    return [];
  }
}

function normalizeTeam(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function teamsMatch(pred, result) {
  const p1 = normalizeTeam(pred.team1);
  const p2 = normalizeTeam(pred.team2);
  const r1 = normalizeTeam(result.team1);
  const r2 = normalizeTeam(result.team2);
  
  return (p1.includes(r1) || r1.includes(p1) || p1 === r1) &&
         (p2.includes(r2) || r2.includes(p2) || p2 === r2) ||
         (p1.includes(r2) || r2.includes(p1) || p1 === r2) &&
         (p2.includes(r1) || r1.includes(p2) || p2 === r1);
}

async function checkResults(date) {
  const predFile = path.join(PREDICTIONS_DIR, `${date}.json`);
  if (!fs.existsSync(predFile)) {
    console.log(`No predictions file for ${date}`);
    return;
  }
  
  const predictions = JSON.parse(fs.readFileSync(predFile, 'utf8'));
  console.log(`📊 Checking ${predictions.length} predictions from ${date}...\n`);
  
  // Fetch results
  const results = [];
  results.push(...(await fetchHLTVResults()));
  await sleep(2000);
  for (const game of ['dota2', 'lol', 'valorant']) {
    results.push(...(await fetchLiquipediaResults(game)));
    await sleep(2000);
  }
  
  console.log(`  Found ${results.length} recent results`);
  
  const learning = loadLearning();
  let checked = 0, correct = 0, wrong = 0;
  
  for (const pred of predictions) {
    // Try to match with results
    const result = results.find(r => r.game === pred.game && teamsMatch(pred, r));
    if (!result) continue;
    
    checked++;
    
    // Determine winner from score
    const scores = result.score.split('-').map(Number);
    let actualWinner = null;
    if (scores.length === 2 && !isNaN(scores[0]) && !isNaN(scores[1])) {
      if (scores[0] > scores[1]) actualWinner = result.team1;
      else if (scores[1] > scores[0]) actualWinner = result.team2;
    }
    
    if (!actualWinner) continue;
    
    const predictedWinner = normalizeTeam(pred.prediction.winner);
    const actualNorm = normalizeTeam(actualWinner);
    const isCorrect = predictedWinner.includes(actualNorm) || actualNorm.includes(predictedWinner);
    
    if (isCorrect) {
      correct++;
      console.log(`  ✅ ${pred.team1} vs ${pred.team2}: Predicted ${pred.prediction.winner} → CORRECT`);
    } else {
      wrong++;
      console.log(`  ❌ ${pred.team1} vs ${pred.team2}: Predicted ${pred.prediction.winner} → WRONG (${actualWinner} won)`);
      
      // Learn from mistakes
      if (pred.prediction.confidence > 70) {
        learning.lessons.push(
          `${date}: Overconfident on ${pred.prediction.winner} (${pred.prediction.confidence}%) vs ${actualWinner} in ${pred.game}. ${pred.tournament || ''}`
        );
      }
    }
    
    // Update stats
    if (!learning.stats[pred.game]) learning.stats[pred.game] = { correct: 0, total: 0 };
    learning.stats[pred.game].total++;
    if (isCorrect) learning.stats[pred.game].correct++;
    
    learning.history.push({
      date,
      game: pred.game,
      match: `${pred.team1} vs ${pred.team2}`,
      predicted: pred.prediction.winner,
      actual: actualWinner,
      confidence: pred.prediction.confidence,
      correct: isCorrect,
    });
  }
  
  // Keep lessons manageable
  if (learning.lessons.length > 50) learning.lessons = learning.lessons.slice(-50);
  if (learning.history.length > 200) learning.history = learning.history.slice(-200);
  
  saveLearning(learning);
  
  console.log(`\n📈 Results: ${correct}/${checked} correct, ${wrong} wrong (${predictions.length - checked} unverified)`);
  
  // Print overall stats
  console.log('\n📊 Overall Accuracy:');
  for (const [game, s] of Object.entries(learning.stats)) {
    if (s.total > 0) {
      console.log(`  ${game}: ${s.correct}/${s.total} (${((s.correct / s.total) * 100).toFixed(1)}%)`);
    }
  }
}

module.exports = { checkResults };
