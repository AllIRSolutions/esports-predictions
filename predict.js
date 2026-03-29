const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic.default();

const LEARNING_FILE = path.join(__dirname, 'data', 'learning.json');

function loadLearningContext() {
  if (!fs.existsSync(LEARNING_FILE)) return '';
  try {
    const data = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
    const stats = data.stats || {};
    const lines = ['HISTORICAL ACCURACY (self-learning data):'];
    for (const [game, s] of Object.entries(stats)) {
      if (s.total > 0) {
        const pct = ((s.correct / s.total) * 100).toFixed(1);
        lines.push(`  ${game}: ${s.correct}/${s.total} correct (${pct}%)`);
      }
    }
    if (data.lessons && data.lessons.length > 0) {
      lines.push('\nLESSONS LEARNED:');
      data.lessons.slice(-10).forEach(l => lines.push(`  - ${l}`));
    }
    return lines.length > 1 ? lines.join('\n') : '';
  } catch {
    return '';
  }
}

async function predictMatch(match, teamContext) {
  const { game, team1, team2, tournament, bestOf, time } = match;
  const gameNames = { cs2: 'Counter-Strike 2', dota2: 'Dota 2', lol: 'League of Legends', valorant: 'Valorant' };
  const gameName = gameNames[game] || game;
  
  const learningContext = loadLearningContext();

  const prompt = `You are an expert ${gameName} esports analyst. Analyze this match and predict the outcome.

MATCH: ${team1} vs ${team2}
GAME: ${gameName}
TOURNAMENT: ${tournament}
FORMAT: Best of ${bestOf}
TIME: ${time} SAST

${teamContext.team1Info ? `${team1} INFO:\n${teamContext.team1Info}\n` : ''}
${teamContext.team2Info ? `${team2} INFO:\n${teamContext.team2Info}\n` : ''}
${teamContext.h2h ? `HEAD-TO-HEAD:\n${teamContext.h2h}\n` : ''}
${learningContext ? `\n${learningContext}\n` : ''}

Consider: recent form, team roster strength, tournament context, map pool (CS2/Valorant), hero/champion pool (Dota 2/LoL), head-to-head history, online vs LAN, and any known roster changes.

For ${gameName} specifically:
${game === 'cs2' ? '- Consider map vetoes, AWP players, CT/T side strengths, recent roster moves' : ''}
${game === 'dota2' ? '- Consider draft tendencies, meta heroes, late-game vs early-game teams, captain experience' : ''}
${game === 'lol' ? '- Consider draft priority, lane matchups, macro play style, dragon/baron control' : ''}
${game === 'valorant' ? '- Consider agent compositions, map preferences, IGL impact, clutch players' : ''}

Respond in EXACTLY this JSON format (no markdown, no explanation):
{"winner":"Team Name","mapScore":"2-1","confidence":72,"reasoning":"Brief 1-line reasoning"}

- winner: exact team name (${team1} or ${team2})
- mapScore: predicted map/game score (e.g. "2-1" for Bo3, "3-1" for Bo5, "1-0" for Bo1)
- confidence: integer 1-99 (be calibrated - 50-60 for coin flips, 70+ for clear favorites, 85+ rare)
- reasoning: one concise line explaining the pick`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = msg.content[0].text.trim();
    return JSON.parse(text);
  } catch (e) {
    console.error(`    Prediction error: ${e.message}`);
    return { winner: team1, mapScore: '2-1', confidence: 52, reasoning: 'Insufficient data - slight edge given' };
  }
}

module.exports = { predictMatch };
