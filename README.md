# 🎮 Esports Predictions

AI-powered esports predictions bot covering CS2, Dota 2, League of Legends, and Valorant.

## How It Works

1. **Data Collection**: Scrapes upcoming matches from HLTV.org (CS2) and Liquipedia (Dota 2, LoL, Valorant). Falls back to PandaScore API if a key is configured.
2. **Analysis**: Claude AI analyzes team form, head-to-head history, tournament context, and game-specific factors (map pools, hero/champion pools, etc.)
3. **Predictions**: Generates predictions with confidence scores and brief reasoning.
4. **Delivery**: Sends formatted predictions to WhatsApp.
5. **Self-Learning**: Tracks prediction accuracy and feeds lessons back into the analysis.

## Games Covered

- 🔫 **CS2** — via HLTV.org
- ⚔️ **Dota 2** — via Liquipedia
- 🏰 **League of Legends** — via Liquipedia
- 🎯 **Valorant** — via Liquipedia

## Usage

```bash
# Preview today's predictions
node index.js today

# Generate and send to WhatsApp
node index.js send

# Check yesterday's results (self-learning)
node index.js learn

# Specific date
node index.js today 2026-03-30
```

## Setup

```bash
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
# Optionally add PANDASCORE_API_KEY for better data
```

## Cron Schedule

- **08:00 UTC (10:00 SAST)** — Morning predictions
- **14:00 UTC (16:00 SAST)** — Afternoon predictions
- **09:00 UTC** — Self-learning (check yesterday's results)

## Architecture

Modeled after the soccer-predictions system:
- `scraper.js` — Data collection (HLTV, Liquipedia, PandaScore)
- `predict.js` — Claude AI analysis and prediction
- `learn.js` — Self-learning system (track accuracy, extract lessons)
- `index.js` — Main orchestrator (build, send, learn)
- `config.js` — Configuration
