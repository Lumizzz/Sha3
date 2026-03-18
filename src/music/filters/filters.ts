import type { KazagumoPlayer } from 'kazagumo'

export type FilterName = 'bassboost'|'nightcore'|'vaporwave'|'8d'|'treble'|'karaoke'|'timescale'|'reset'

const PRESETS: Record<Exclude<FilterName,'reset'>, object> = {
  bassboost: { equalizer: [{band:0,gain:0.6},{band:1,gain:0.67},{band:2,gain:0.67},{band:3,gain:0},{band:4,gain:-0.5},{band:5,gain:0.15},{band:6,gain:-0.45},{band:7,gain:0.23},{band:8,gain:0.35},{band:9,gain:0.45},{band:10,gain:0.55},{band:11,gain:0.6},{band:12,gain:0.55}] },
  nightcore: { timescale: { speed: 1.3, pitch: 1.3, rate: 1.0 } },
  vaporwave: { timescale: { speed: 0.85, pitch: 0.85, rate: 1.0 }, equalizer: [{band:0,gain:0.3},{band:1,gain:0.3}] },
  '8d':      { rotation: { rotationHz: 0.2 } },
  treble:    { equalizer: [{band:8,gain:0.6},{band:9,gain:0.7},{band:10,gain:0.8},{band:11,gain:0.8},{band:12,gain:0.7}] },
  karaoke:   { karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 } },
  timescale: { timescale: { speed: 1.2, pitch: 1.0, rate: 1.0 } },
}

export async function applyFilter(player: KazagumoPlayer, filter: FilterName) {
  if (filter === 'reset') { await player.shoukaku.setFilters({}); return }
  await player.shoukaku.setFilters(PRESETS[filter])
}
