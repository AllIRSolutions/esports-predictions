require('dotenv').config();
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getAllMatches, fetchTeamContext } = require('./scraper');
const { predictMatch } = require('./predict');
const { checkResults } = require('./learn');

const DATA_DIR = path.join(__dirname, 'data');
const PREDICTIONS_DIR = path.join(DATA_DIR, 'predictions');
if (!fs.existsSync(PREDICTIONS_DIR)) fs.mkdirSync(PREDICTIONS_DIR, { recursive: true });

const dateArg = process.argv[3] || null;
const today = dateArg || dayjs().tz('Africa/Johannesburg').format('YYYY-MM-DD');
const displayDate = dayjs(today).format('ddd DD MMM YYYY');

const gameEmojis = { cs2: '🔫', dota2: '⚔️', lol: '🏰', valorant: '🎯' };
const gameNames = { cs2: 'CS2', dota2: 'DOTA 2', lol: 'LEAGUE OF LEGENDS', valorant: 'VALORANT' };

async function buildPredictions() {
  const matches = await getAllMatches(today);
  
  if (matches.length === 0) {
    console.log('No esports matches found for today.');
    return null;
  }
  
  // Group by game
  const byGame = {};
  for (const m of matches) {
    if (!byGame[m.game]) byGame[m.game] = [];
    byGame[m.game].push(m);
  }
  
  // Limit to top matches per game (max 5 per game to keep message manageable)
  for (const game of Object.keys(byGame)) {
    if (byGame[game].length > 5) {
      byGame[game] = byGame[game].slice(0, 5);
    }
  }
  
  let lines = [`🎮 ESPORTS PREDICTIONS — ${displayDate}`, ''];
  const allPredictions = [];
  
  for (const [game, gameMatches] of Object.entries(byGame)) {
    const emoji = gameEmojis[game] || '🎮';
    const name = gameNames[game] || game.toUpperCase();
    lines.push(`${emoji} ${name}`);
    
    for (const match of gameMatches) {
      console.log(`  Analyzing: ${match.team1} vs ${match.team2} (${game})...`);
      
      // Fetch team context for better analysis
      let teamContext = { team1Info: '', team2Info: '', h2h: '' };
      try {
        teamContext = await fetchTeamContext(match.team1, match.team2, game);
      } catch (e) {
        console.log(`    Context fetch failed: ${e.message}`);
      }
      
      const prediction = await predictMatch(match, teamContext);
      
      const confBar = prediction.confidence >= 75 ? '🔥' : prediction.confidence >= 60 ? '✅' : '⚠️';
      
      lines.push(`${match.team1} vs ${match.team2} (${match.time} SAST)`);
      if (match.tournament) lines.push(`🏆 ${match.tournament}`);
      lines.push(`🔮 ${prediction.winner} ${prediction.mapScore} ${confBar} ${prediction.confidence}%`);
      if (prediction.reasoning) lines.push(`💡 ${prediction.reasoning}`);
      lines.push('');
      
      allPredictions.push({
        ...match,
        prediction,
        timestamp: Date.now(),
      });
    }
  }
  
  // Add footer
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('🔥 High confidence (75%+) | ✅ Medium (60-74%) | ⚠️ Low (<60%)');
  
  // Load and show accuracy if available
  const learningFile = path.join(DATA_DIR, 'learning.json');
  if (fs.existsSync(learningFile)) {
    try {
      const learning = JSON.parse(fs.readFileSync(learningFile, 'utf8'));
      const stats = learning.stats || {};
      let totalCorrect = 0, totalAll = 0;
      for (const s of Object.values(stats)) {
        totalCorrect += s.correct;
        totalAll += s.total;
      }
      if (totalAll > 0) {
        lines.push(`📊 Track Record: ${totalCorrect}/${totalAll} (${((totalCorrect / totalAll) * 100).toFixed(0)}%)`);
      }
    } catch {}
  }
  
  // Save predictions for learning
  const predFile = path.join(PREDICTIONS_DIR, `${today}.json`);
  const existing = fs.existsSync(predFile) ? JSON.parse(fs.readFileSync(predFile, 'utf8')) : [];
  existing.push(...allPredictions);
  fs.writeFileSync(predFile, JSON.stringify(existing, null, 2));
  
  return lines.join('\n').trim();
}

async function main() {
  const cmd = process.argv[2] || 'today';

  if (cmd === 'today') {
    const msg = await buildPredictions();
    if (msg) console.log('\n' + msg);
    
  } else if (cmd === 'send') {
    const msg = await buildPredictions();
    if (!msg) { console.log('Nothing to send.'); return; }
    console.log('\n' + msg);
    console.log('\n📤 Sending to WhatsApp...');
    
    // Split into chunks if message is too long
    const chunks = [];
    const maxLen = 3500;
    const msgLines = msg.split('\n');
    let chunk = '';
    for (const line of msgLines) {
      if ((chunk + '\n' + line).length > maxLen && chunk) {
        chunks.push(chunk.trim());
        chunk = '';
      }
      chunk += (chunk ? '\n' : '') + line;
    }
    if (chunk.trim()) chunks.push(chunk.trim());

    for (let i = 0; i < chunks.length; i++) {
      const escaped = chunks[i].replace(/'/g, "'\\''");
      const label = chunks.length > 1 ? ` (${i+1}/${chunks.length})` : '';
      const command = `${config.whatsapp.sendCommand} --target '${config.whatsapp.target}' --message '${escaped}${label}'`;
      try {
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ Sent${label}`);
      } catch (e) {
        console.error(`❌ Failed to send${label}:`, e.message);
      }
    }
    
  } else if (cmd === 'learn') {
    // Check results from yesterday
    const yesterday = dateArg || dayjs().tz('Africa/Johannesburg').subtract(1, 'day').format('YYYY-MM-DD');
    await checkResults(yesterday);
    
  } else {
    console.log('Usage: node index.js [today|send|learn] [YYYY-MM-DD]');
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
