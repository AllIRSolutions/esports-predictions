module.exports = {
  games: [
    { id: 'cs2', name: 'CS2', emoji: '🔫', sources: ['hltv'] },
    { id: 'dota2', name: 'Dota 2', emoji: '⚔️', sources: ['liquipedia'] },
    { id: 'lol', name: 'League of Legends', emoji: '🏰', sources: ['liquipedia'] },
    { id: 'valorant', name: 'Valorant', emoji: '🎯', sources: ['liquipedia'] },
  ],
  sources: {
    hltv: {
      baseUrl: 'https://www.hltv.org',
      matchesUrl: 'https://www.hltv.org/matches',
    },
    liquipedia: {
      baseUrl: 'https://liquipedia.net',
      apis: {
        dota2: 'https://liquipedia.net/dota2/Liquipedia:Upcoming_and_ongoing_matches',
        lol: 'https://liquipedia.net/leagueoflegends/Liquipedia:Upcoming_and_ongoing_matches',
        valorant: 'https://liquipedia.net/valorant/Liquipedia:Upcoming_and_ongoing_matches',
      },
    },
    pandascore: {
      baseUrl: 'https://api.pandascore.co/v2',
    },
  },
  whatsapp: {
    target: '+27783678266',
    sendCommand: 'sudo docker exec openclaw node /app/openclaw.mjs message send --channel whatsapp',
  },
  // Tier filters - only predict notable matches
  minTier: 2, // 1 = S-tier, 2 = A-tier, 3 = B-tier
};
