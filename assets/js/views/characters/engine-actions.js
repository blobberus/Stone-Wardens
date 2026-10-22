// Bonus actions: which features, spells and attacks a character can use as a Bonus Action (2024 rules / SRD 5.2).
// Pure ES module: no DOM; Node-testable (tools/test_spells.mjs). The sheet's "Bonus actions" tab draws the result.

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const sentences = (text) => String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const stripMd = (s) => String(s || '').replace(/\*\*|__|\*|_/g, '').replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (m, a, b) => b || a).trim();

// Sentences that only mention Bonus Actions (riders, restrictions), not grant one.
const NOT_A_GRANT = /\b(?:when|whenever|as part of|only one of the following|can't take|cannot take|no Bonus Action|without (?:using|taking) a Bonus Action|instead of a Bonus Action)\b/i;
const GRANT = /\b(?:as a Bonus Action|take a Bonus Action (?:to|on)|use (?:a|your|this) Bonus Action|Bonus Action to\b)/i;

/** Is the spell cast as a Bonus Action? */
export const isBonusActionSpell = (record) => /\bBonus Action\b/i.test(String(record?.castingTime || ''));

/**
 * The Bonus Actions a rules text grants: [{label, text}] — `label` is the bold lead-in ("Flurry of Blows") when the
 * sentence has one. Riders ("Whenever you activate … with a Bonus Action") and restrictions are skipped.
 */
export function bonusActionOptions(description) {
  const out = [];
  const paras = String(description || '').split(/\n+/);
  const leadOf = (p) => /^\s*(?:[-*]\s*)?\*\*([^*]+?)\.?\*\*\s*/.exec(p)?.[1]?.replace(/\s*\(.*\)\s*$/, '').trim() || null;
  paras.forEach((raw, pi) => {
    const lead = leadOf(raw);
    for (const s of sentences(raw)) {
      if (!/\bBonus Action\b/.test(s) || NOT_A_GRANT.test(s) || !GRANT.test(s)) continue;
      let text = stripMd(s.replace(/^\s*(?:[-*]\s*)?\*\*[^*]+\*\*\s*/, '')).replace(/^[-*]\s+/, '');
      const inlineList = /:\s+-\s/.test(text);
      text = text.replace(/:\s+-\s.*$/, ':');
      if (!text || out.some((x) => x.text === text)) continue;
      // "…you can do one of the following." + the bold / bulleted choices after it (Fast Hands, Innate Sorcery)
      const more = [];
      if (/\bfollowing\b[^.]*[.:]$/.test(text) || inlineList) {
        if (inlineList) more.push(stripMd(s.split(/:\s+-\s/)[1] || ''));
        for (let j = pi + 1; j < paras.length && /^\s*(?:[-*]\s|\*\*)/.test(paras[j]); j++) more.push(leadOf(paras[j]) || stripMd(paras[j].replace(/^\s*[-*]\s*/, '')).slice(0, 90));
      }
      out.push({ label: lead, text, ...(more.filter(Boolean).length ? { more: more.filter(Boolean) } : {}) });
    }
  });
  return out;
}

/** Features (class, subclass, species, feat, custom) that grant a Bonus Action: [{feature, options:[{label, text}]}]. */
export function bonusActionFeatures(features) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(features) ? features : []) {
    if (!f || typeof f !== 'object') continue;
    const key = `${f.id || f.name}|${f.sourceType || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const flagged = /^bonus(?:[ -]?action)?$/i.test(String(f.activation || f.action || f.actionType || ''));
    const options = bonusActionOptions(f.description);
    if (!options.length && !flagged) continue;
    out.push({ feature: f, options: options.length ? options : [{ label: null, text: 'Used as a Bonus Action.' }] });
  }
  return out;
}

/** "1d10 plus your Fighter level" healing (Second Wind): {dice, bonus, text} for this sheet, or null. */
export function featureHealing(text, classes) {
  const m = /Hit Points equal to (\d+d\d+) plus your (\w+) level/i.exec(String(text || ''));
  if (!m) return null;
  const cls = (Array.isArray(classes) ? classes : []).find((c) => String(c.name || c.id).toLowerCase() === m[2].toLowerCase());
  const bonus = num(cls?.level);
  return { dice: m[1], bonus, text: bonus ? `${m[1]} + ${bonus}` : `${m[1]} + ${m[2]} level` };
}

/** "1d6+3" -> {die:'1d6', bonus:3}; "1" -> {die:'1', bonus:0} */
function splitDamage(dmg) {
  const m = /^\s*(\d*d\d+|\d+)\s*(?:([+\-−])\s*(\d+))?\s*$/.exec(String(dmg || ''));
  if (!m) return null;
  return { die: m[1], bonus: m[2] ? (m[2] === '+' ? 1 : -1) * Number(m[3]) : 0 };
}
const joinDamage = (die, b) => `${die}${b ? `${b > 0 ? '+' : '−'}${Math.abs(b)}` : ''}`;

/**
 * Off-hand attacks (Light property, 2024): after attacking with a Light weapon as part of the Attack action you
 * can make one extra attack with a different Light weapon as a Bonus Action, without your ability modifier on its
 * damage unless it's negative (Two-Weapon Fighting style keeps it). Nick mastery makes it part of the Attack action.
 * -> {eligible, reason, twoWeaponFighting, nick, options:[{uid, name, bonus, damage, damageType, ability, nick}]}
 */
export function offhandAttacks(sheet) {
  const s = sheet && typeof sheet === 'object' ? sheet : {};
  const attacks = (Array.isArray(s.attacks) ? s.attacks : []).filter((a) => a && a.uid && (a.properties || []).includes('light'));
  const items = Array.isArray(s.items) ? s.items : [];
  const copies = attacks.reduce((n, a) => n + Math.max(1, Math.floor(num(items.find((i) => i.uid === a.uid)?.qty, 1))), 0);
  const twf = (Array.isArray(s.features) ? s.features : []).some((f) => f && (f.id === 'two-weapon-fighting' || /two-weapon fighting/i.test(f.name || '')));
  const options = attacks.map((a) => {
    const mod = num(s.abilities?.[a.ability]?.mod);
    const parts = splitDamage(a.damage);
    const bonus = parts ? parts.bonus - (mod > 0 && !twf ? mod : 0) : null;
    return { uid: a.uid, name: a.name, bonus: a.bonus, damage: parts ? joinDamage(parts.die, bonus) : a.damage, damageType: a.damageType, ability: a.ability, nick: a.mastery?.id === 'nick' };
  });
  const eligible = copies >= 2;
  return {
    eligible, twoWeaponFighting: twf, nick: options.some((o) => o.nick), options: eligible ? options : [],
    reason: eligible || !attacks.length ? '' : `Equip a second Light weapon to make an off-hand attack with it as a Bonus Action.`,
  };
}
