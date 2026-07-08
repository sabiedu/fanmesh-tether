// FanMesh — Demo Scenario: World Cup Final replay.
//
// Pre-scripted chat + match events with rich descriptions. When demo mode is
// enabled, the server seeds these so the room looks ALIVE the moment a judge
// opens the URL — even with one peer. The match events fire on a timer, and
// each one triggers the REAL on-device QVAC commentator.
//
// The `detail` field is the key: it gives the AI commentator the drama (the
// build-up, the skill, the emotion) so it generates vivid, specific calls
// instead of generic filler.

export const DEMO_MATCH = {
  home: 'Argentina',
  away: 'France',
  homeFlag: '🇦🇷',
  awayFlag: '🇫🇷',
  homeAbbr: 'ARG',
  awayAbbr: 'FRA',
  matchName: 'FIFA World Cup Final'
}

// Pre-populated fan chat — appears immediately when the page loads.
export const DEMO_CHAT = [
  { from: 'Diego_AR', text: 'VAMOOOS ARGENTINAAAA 🇦🇷🇦🇷🇦🇷' },
  { from: 'Pierre_FR', text: 'Allez les Bleus! France will dominate today 💪🇫🇷' },
  { from: 'Maya_KE', text: 'Watching this with fans from 6 countries and NO server. This is insane 😳' },
  { from: 'Sofia_AR', text: 'Diego PARA the screen is right there 😂' },
  { from: 'Louis_FR', text: 'Mbappé is going to score a hat-trick today. Mark my words.' },
  { from: 'Ahmad_JO', text: 'First time using a P2P app. I can\'t believe this works without servers!' },
  { from: 'Diego_AR', text: 'The AI commentator loaded on my laptop in 2 seconds. Locally. No cloud. 🔥' },
  { from: 'Pierre_FR', text: 'My commentary is in French and it actually sounds like a real announcer' }
]

// Scripted match events — each fires on a timer and triggers the real QVAC
// commentator. The `detail` field gives the AI the story to narrate.
export const DEMO_EVENTS = [
  {
    kind: 'kickoff', minute: 1,
    detail: 'The World Cup Final kicks off! Argentina in their iconic blue and white stripes, France in dark blue. 89,000 fans fill the Lusail Stadium. The biggest match on earth is underway.',
    score: '0-0',
    delayMs: 5000
  },
  {
    kind: 'chance', minute: 15, player: 'Mbappé', team: 'France',
    detail: 'Mbappé bursts down the left wing, beats his marker with raw pace, but his curling effort sails just wide of the far post. A warning shot for Argentina.',
    score: '0-0',
    delayMs: 12000
  },
  {
    kind: 'goal', minute: 23, player: 'Messi', team: 'Argentina',
    detail: 'Penalty to Argentina! The referee points to the spot after a handball. Messi steps up with ice in his veins, waits for the keeper to commit, and strokes it into the bottom left corner. Cool as you like!',
    score: '1-0',
    delayMs: 18000
  },
  {
    kind: 'goal', minute: 36, player: 'Di María', team: 'Argentina',
    detail: 'GOAL! A breathtaking counter-attack! Argentina win the ball deep, four passes later Di María meets a cross at the far post and side-foots it first time past the diving keeper. What a team goal!',
    score: '2-0',
    delayMs: 24000
  },
  {
    kind: 'halftime', minute: 45,
    detail: 'Half-time at the Lusail Stadium. Argentina in total control, 2-0 up against a French side that looks shell-shocked. Mbappé has barely touched the ball.',
    score: '2-0',
    delayMs: 30000
  },
  {
    kind: 'goal', minute: 80, player: 'Mbappé', team: 'France',
    detail: 'MBAPPÉ PULLS ONE BACK! A penalty for France and he hammers it straight down the middle with terrifying power. Game on! The French fans erupt!',
    score: '2-1',
    delayMs: 38000
  },
  {
    kind: 'goal', minute: 81, player: 'Mbappé', team: 'France',
    detail: 'INCREDIBLE! JUST 97 SECONDS LATER! Mbappé meets a volley from outside the box and it flies into the top corner! He\'s leveled it! 2-2! An absolute stunner!',
    score: '2-2',
    delayMs: 46000
  },
  {
    kind: 'goal', minute: 108, player: 'Messi', team: 'Argentina',
    detail: 'MESSI SCORES IN EXTRA TIME! A scramble in the box, the ball pings around, and Messi reacts fastest to poke it over the line. The crowd goes nuclear! Argentina lead 3-2!',
    score: '3-2',
    delayMs: 56000
  },
  {
    kind: 'goal', minute: 118, player: 'Mbappé', team: 'France',
    detail: 'Another penalty to France! Mbappé steps up again — and scores his hat-trick! 3-3! This is the greatest World Cup Final anyone has ever seen!',
    score: '3-3',
    delayMs: 66000
  },
  {
    kind: 'fulltime', minute: 120,
    detail: 'Full-time after extra time. 3-3. We are heading to penalties. Argentina and France have given us a final for the ages — and it\'s not over yet.',
    score: '3-3',
    delayMs: 76000
  }
]
