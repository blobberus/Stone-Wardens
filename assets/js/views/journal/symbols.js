// Symbols a timeline event can carry (sprite icons in assets/img/icons.svg): crossed swords for war, a white flag for
// peace, a crown for a coronation… Stored by id (`symbol: war`); an unknown id shows no symbol.
export const SYMBOLS = Object.freeze([
  { id: 'war', label: 'War, battle', icon: 'swords' },
  { id: 'peace', label: 'Peace', icon: 'sym-flag' },
  { id: 'crown', label: 'Coronation, rule', icon: 'sym-crown' },
  { id: 'death', label: 'Death', icon: 'sym-skull' },
  { id: 'birth', label: 'Birth, beginning', icon: 'sym-sprout' },
  { id: 'founding', label: 'Founding, a stronghold', icon: 'sym-castle' },
  { id: 'treaty', label: 'Treaty, law', icon: 'scroll' },
  { id: 'marriage', label: 'Marriage', icon: 'sym-rings' },
  { id: 'alliance', label: 'Alliance, friendship', icon: 'heart' },
  { id: 'betrayal', label: 'Betrayal, murder', icon: 'sym-dagger' },
  { id: 'defense', label: 'Defence, siege', icon: 'shield' },
  { id: 'disaster', label: 'Fire, disaster', icon: 'sym-flame' },
  { id: 'storm', label: 'Storm', icon: 'sym-bolt' },
  { id: 'firmament', label: 'Falling star, omen from the sky', icon: 'sym-comet' },
  { id: 'fall', label: 'Fall, ruin', icon: 'sym-ruin' },
  { id: 'voyage', label: 'Voyage', icon: 'sym-ship' },
  { id: 'discovery', label: 'Discovery, exploration', icon: 'compass' },
  { id: 'faith', label: 'Faith, a temple', icon: 'sym-temple' },
  { id: 'magic', label: 'Magic', icon: 'sparkle' },
  { id: 'knowledge', label: 'Knowledge, a book', icon: 'book-open' },
  { id: 'trade', label: 'Trade, wealth', icon: 'coins' },
  { id: 'prophecy', label: 'Prophecy, a vision', icon: 'eye' },
  { id: 'night', label: 'Night, darkness', icon: 'moon' },
  { id: 'dawn', label: 'Dawn, a new age', icon: 'sun' },
  { id: 'glory', label: 'Glory, a deed', icon: 'star' },
]);
const BY_ID = new Map(SYMBOLS.map((s) => [s.id, s]));
export const symbolOf = (id) => BY_ID.get(id) || null;
export const symbolLabel = (id) => BY_ID.get(id)?.label || '';
export const symbolIcon = (id) => BY_ID.get(id)?.icon || null;
