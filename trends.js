'use strict';

/**
 * Google Trends Integration for Esports Predictions
 * 
 * Adds public sentiment/hype analysis using Google Trends data.
 * When a team or tournament is trending, factors that into prediction analysis.
 */

const googleTrends = require('google-trends-api');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'data', 'trends');
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function log(msg) { console.log(`  [trends] ${msg}`); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCache(key) {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.now() - data.timestamp < CACHE_TTL_MS) return data.result;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveCache(key, result) {
  ensureDir(CACHE_DIR);
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify({ timestamp: Date.now(), result }, null, 2));
  } catch (e) { /* ignore */ }
}

/**
 * Check Google Trends interest for two teams + tournament.
 * Returns relative interest comparison and trending status.
 */
async function getMatchTrendData(team1, team2, tournament, game) {
  const cacheKey = `${team1}_${team2}_${game}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  const cached = loadCache(cacheKey);
  if (cached) {
    log(`Using cached trend data for ${team1} vs ${team2}`);
    return cached;
  }

  const result = {
    team1: { name: team1, interest: 0, isTrending: false, spikeRatio: 1 },
    team2: { name: team2, interest: 0, isTrending: false, spikeRatio: 1 },
    tournament: { name: tournament, interest: 0, isTrending: false },
    hypeAdvantage: null, // which team has more hype
    hypeDiff: 0, // percentage difference in interest
    sentimentNote: '', // human-readable note for the prediction prompt
  };

  try {
    // Compare team interest
    const teamData = await googleTrends.interestOverTime({
      keyword: [team1, team2],
      startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      geo: '',
    });

    const parsed = JSON.parse(teamData);
    const timeline = parsed.default?.timelineData || [];
    
    if (timeline.length > 0) {
      const recent = timeline.slice(-6);
      const older = timeline.slice(0, Math.max(1, timeline.length - 6));

      for (let i = 0; i < 2; i++) {
        const teamKey = i === 0 ? 'team1' : 'team2';
        const recentAvg = recent.reduce((s, t) => s + (t.value[i] || 0), 0) / recent.length;
        const olderAvg = older.reduce((s, t) => s + (t.value[i] || 0), 0) / older.length;
        const spikeRatio = olderAvg > 0 ? recentAvg / olderAvg : (recentAvg > 15 ? 1.5 : 1);

        result[teamKey].interest = Math.round(recentAvg);
        result[teamKey].isTrending = spikeRatio > 1.5 || recentAvg > 50;
        result[teamKey].spikeRatio = parseFloat(spikeRatio.toFixed(2));
      }

      // Calculate hype advantage
      const t1 = result.team1.interest;
      const t2 = result.team2.interest;
      
      if (t1 > 0 || t2 > 0) {
        const max = Math.max(t1, t2);
        const min = Math.min(t1, t2);
        result.hypeDiff = max > 0 ? Math.round(((max - min) / max) * 100) : 0;
        
        if (result.hypeDiff > 20) {
          result.hypeAdvantage = t1 > t2 ? team1 : team2;
        }
      }
    }
  } catch (e) {
    log(`Team comparison failed: ${e.message}`);
  }

  // Check tournament trending
  if (tournament) {
    await new Promise(r => setTimeout(r, 1500)); // Rate limit
    try {
      const tourneyData = await googleTrends.interestOverTime({
        keyword: [tournament],
        startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        geo: '',
      });

      const parsed = JSON.parse(tourneyData);
      const timeline = parsed.default?.timelineData || [];
      
      if (timeline.length > 0) {
        const recent = timeline.slice(-6);
        const recentAvg = recent.reduce((s, t) => s + (t.value[0] || 0), 0) / recent.length;
        result.tournament.interest = Math.round(recentAvg);
        result.tournament.isTrending = recentAvg > 40;
      }
    } catch (e) {
      log(`Tournament trend check failed: ${e.message}`);
    }
  }

  // Build sentiment note for prediction prompt
  const notes = [];
  
  if (result.hypeAdvantage) {
    notes.push(`${result.hypeAdvantage} has ${result.hypeDiff}% more Google search interest than their opponent (public hype advantage).`);
  }
  
  if (result.team1.isTrending) {
    notes.push(`${team1} is currently spiking on Google Trends (${result.team1.spikeRatio}x normal interest) — may indicate roster news, recent wins, or fan momentum.`);
  }
  
  if (result.team2.isTrending) {
    notes.push(`${team2} is currently spiking on Google Trends (${result.team2.spikeRatio}x normal interest) — may indicate roster news, recent wins, or fan momentum.`);
  }
  
  if (result.tournament.isTrending) {
    notes.push(`Tournament "${tournament}" is trending (interest: ${result.tournament.interest}/100) — higher-stakes match, more public attention.`);
  }

  result.sentimentNote = notes.length > 0 ? notes.join('\n') : '';

  saveCache(cacheKey, result);
  
  if (result.sentimentNote) {
    log(`Trend data for ${team1} vs ${team2}: ${result.sentimentNote.substring(0, 100)}...`);
  }

  return result;
}

/**
 * Format trend data as a string for the prediction prompt.
 */
function formatTrendContext(trendData) {
  if (!trendData || !trendData.sentimentNote) return '';
  
  let context = 'GOOGLE TRENDS SENTIMENT DATA:\n';
  context += trendData.sentimentNote + '\n';
  context += `(Team search interest: ${trendData.team1.name}=${trendData.team1.interest}, ${trendData.team2.name}=${trendData.team2.interest})\n`;
  context += 'Note: Higher search interest can indicate fan confidence, recent success, or controversy. Use as one signal among many.\n';
  
  return context;
}

/**
 * Get a trend emoji/label for the predictions message.
 */
function getTrendLabel(trendData) {
  if (!trendData) return '';
  
  const labels = [];
  if (trendData.team1.isTrending) labels.push(`📈 ${trendData.team1.name} trending`);
  if (trendData.team2.isTrending) labels.push(`📈 ${trendData.team2.name} trending`);
  if (trendData.tournament.isTrending) labels.push(`🔥 Tournament trending`);
  if (trendData.hypeAdvantage) labels.push(`👥 Hype: ${trendData.hypeAdvantage} +${trendData.hypeDiff}%`);
  
  return labels.join(' | ');
}

module.exports = { getMatchTrendData, formatTrendContext, getTrendLabel };
