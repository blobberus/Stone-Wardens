#!/usr/bin/env python3
"""Build the Stone Wardens rules data layer (SRD 5.2 / D&D 2024) from 5e-bits/5e-database.

Usage:  python -I tools/build_srd.py <src-dir> [--out srd]

<src-dir> holds the 5e-database `src/2024/en` JSON files (5e-SRD-*.json renamed or not:
both `Classes.json` and `5e-SRD-Classes.json` are accepted). Writes compact,
character-builder-friendly JSON to srd/ (see docs/srd-schema.md). Deterministic, stdlib only.

Text is SRD 5.2 (CC-BY-4.0, see srd/LICENSE-SRD.md). Where the upstream data has known
errors against the SRD 5.2 tables, FIXES below correct them and the run prints each fix.
Option menus that the upstream data does not contain (Eldritch Invocations, Metamagic) are
hand-structured here with short summaries in our own words.
"""
import argparse
import json
import os
import re
import sys

SRC = ''
LOG = []           # data fixes applied (printed at the end)
WARN = []          # problems worth a look


def log(msg):
    LOG.append(msg)


def warn(msg):
    WARN.append(msg)


def load(name):
    for fn in (f'{name}.json', f'5e-SRD-{name}.json'):
        p = os.path.join(SRC, fn)
        if os.path.exists(p):
            with open(p, encoding='utf-8') as f:
                return json.load(f)
    sys.exit(f'missing source file {name}.json in {SRC}')


def ix(o):
    """index of a reference object (or the string itself)."""
    if isinstance(o, dict):
        return o.get('index')
    return o


ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha']
ABIL_FULL = {'str': 'Strength', 'dex': 'Dexterity', 'con': 'Constitution',
             'int': 'Intelligence', 'wis': 'Wisdom', 'cha': 'Charisma'}
FULL_TO_ABIL = {v.lower(): k for k, v in ABIL_FULL.items()}

# --------------------------------------------------------------------------------------
# Text cleanup -> markdown
# --------------------------------------------------------------------------------------
SMALL_WORDS = {'of', 'the', 'and', 'or', 'a', 'an', 'to', 'with', 'in', 'on', 'for', 'from',
               'at', 'by', 'vs.', 'into', 'per', 'as', 'than'}
RUNIN_TOKEN = re.compile(r"^\(?[A-Z0-9][\w'+/:\-]*\)?,?$")
DASH_WORDS = {'the', 'a', 'an', 'and', 'or'}


def _norm(s):
    s = s.replace('\r', '').replace(' ', ' ')
    for bad, good in (('â€™', "'"), ('â€œ', '"'), ('â€\u009d', '"'),
                      ('â€”', '—'), ('â€“', '–')):   # cp1252 mojibake
        s = s.replace(bad, good)
    s = s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    s = s.replace('�', "'")
    return s


def _dehyphen(s):
    def rep(m):
        a, b = m.group(1), m.group(2)
        if b in DASH_WORDS:
            return f'{a}—{b}'
        return a + b
    return re.sub(r'\b([A-Za-z]+)- ([a-z]+)\b', rep, s)


def _runin(line):
    if line.startswith(('**', '- ', '|', '#')):
        return line
    m = re.match(r'^(.{1,70}?)\. (?=\S)', line)
    if not m:
        return line
    head = m.group(1)
    words = head.split(' ')
    if len(words) > 8 or not words[0] or not (words[0][0].isupper() or words[0][0] == '('):
        return line
    for w in words:
        if w.lower() in SMALL_WORDS:
            continue
        if not RUNIN_TOKEN.match(w):
            return line
    rest = line[m.end():]
    if not rest or not (rest[0].isupper() or rest[0].isdigit() or rest[0] in '("*'):
        return line
    return f'**{head}.** {rest}'


def _is_title(line):
    if line.startswith(('**', '- ', '|')) or len(line) > 45:
        return False
    words = line.rstrip('.').split(' ')
    if len(words) > 6 or not words[0][:1].isupper():
        return False
    return all(w.lower() in SMALL_WORDS or RUNIN_TOKEN.match(w) for w in words)


def _table_sep(line):
    if ' | ' in line:
        return ' | '
    if ' / ' in line:
        return ' / '
    return None


def md(s, runin=True):
    """Clean 5e-database prose into markdown: paragraphs, run-in bold headings, tables, bullets."""
    if not s:
        return ''
    if isinstance(s, list):
        s = '\n'.join(s)
    s = _norm(s)
    s = _dehyphen(s)
    # PDF line wraps inside a sentence: "...tries\nto move" -> "tries to move"
    s = re.sub(r'(?<=[a-z,;])[ \t]*\n[ \t]*(?=[a-z])', ' ', s)
    lines = [re.sub(r'\s+', ' ', l).strip() for l in s.split('\n')]
    lines = [l for l in lines if l]
    # unbalanced bold marker at line start (upstream typo) -> drop it
    lines = [l[2:] if l.startswith('**') and l.count('**') % 2 else l for l in lines]
    blocks = []   # list of (kind, payload)
    i = 0
    while i < len(lines):
        line = lines[i]
        sep = _table_sep(line)
        if sep:
            n = len(line.split(sep))
            j = i + 1
            while j < len(lines) and _table_sep(lines[j]) == sep and len(lines[j].split(sep)) == n:
                j += 1
            if j - i >= 2:
                rows = [[c.strip() for c in lines[k].split(sep)] for k in range(i, j)]
                # a short title line right before the table becomes bold
                if blocks and blocks[-1][0] == 'p':
                    t = blocks[-1][1]
                    if len(t) < 60 and not re.search(r'[.:!?]$', t) and not t.startswith(('**', '- ')):
                        blocks[-1] = ('p', f'**{t}**')
                blocks.append(('table', rows))
                i = j
                continue
        if line[0] in '•●' or line.startswith('- '):
            item = line.lstrip('•●- ').strip()
            if blocks and blocks[-1][0] == 'ul':
                blocks[-1][1].append(item)
            else:
                blocks.append(('ul', [item]))
            i += 1
            continue
        blocks.append(('p', _runin(line) if runin else line))
        i += 1
    out = []
    for bi, (kind, payload) in enumerate(blocks):
        if kind == 'p':
            # short Title Case line followed by more text -> bold sub-heading ("Drow", "Abyssal.")
            if bi + 1 < len(blocks) and _is_title(payload):
                payload = f'**{payload.rstrip(".")}**'
            out.append(payload)
        elif kind == 'ul':
            out.append('\n'.join(f'- {x}' for x in payload))
        else:
            head, *rows = payload
            t = ['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
            t += ['| ' + ' | '.join(r) + ' |' for r in rows]
            out.append('\n'.join(t))
    return '\n\n'.join(out)


def md_table(head, rows):
    t = ['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
    t += ['| ' + ' | '.join(str(c) for c in r) + ' |' for r in rows]
    return '\n'.join(t)


def slug(s):
    s = _norm(s).lower().replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


# --------------------------------------------------------------------------------------
# Rules constants (SRD 5.2 tables not present in the source data)
# --------------------------------------------------------------------------------------
PROF_BY_LEVEL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6]
XP_BY_LEVEL = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
               120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]
MULTICLASS_SLOTS = [
    [2, 0, 0, 0, 0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0, 0, 0], [4, 2, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 0, 0, 0, 0, 0, 0, 0], [4, 3, 2, 0, 0, 0, 0, 0, 0], [4, 3, 3, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 1, 0, 0, 0, 0, 0], [4, 3, 3, 2, 0, 0, 0, 0, 0], [4, 3, 3, 3, 1, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 0, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]]
CASTER_KIND = {'bard': 'full', 'cleric': 'full', 'druid': 'full', 'sorcerer': 'full', 'wizard': 'full',
               'paladin': 'half', 'ranger': 'half', 'warlock': 'pact'}
SPELL_FOCUS = {'bard': 'Musical Instrument', 'cleric': 'Holy Symbol', 'druid': 'Druidic Focus',
               'paladin': 'Holy Symbol', 'ranger': 'Druidic Focus', 'sorcerer': 'Arcane Focus',
               'warlock': 'Arcane Focus', 'wizard': 'Arcane Focus or spellbook'}
# When prepared spells can be swapped (2024 rules)
CHANGE_PREPARED = {'bard': 'level-up', 'sorcerer': 'level-up', 'warlock': 'level-up', 'ranger': 'long-rest-one',
                   'paladin': 'long-rest-one', 'cleric': 'long-rest', 'druid': 'long-rest', 'wizard': 'long-rest'}
# Upstream data errors against the SRD 5.2 class tables
FIX_PREPARED = {'wizard': [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25]}
FIX_CANTRIPS = {'druid': [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]}
EXTRA_COUNTERS = {
    'paladin': lambda L: {'weapon_mastery': 2},
    'ranger': lambda L: {'weapon_mastery': 2},
    'rogue': lambda L: {'weapon_mastery': 2},
    'druid': lambda L: ({} if L < 2 else {
        'wild_shape_known_forms': 4 if L < 4 else 6 if L < 8 else 8,
        'wild_shape_max_cr': '1/4' if L < 4 else '1/2' if L < 8 else '1',
        'wild_shape_fly': L >= 8}),
}


# --------------------------------------------------------------------------------------
# Hand-structured option menus (summaries in our own words)
# --------------------------------------------------------------------------------------
def opt(id_, name, description, **kw):
    o = {'id': id_, 'name': name, 'description': description}
    o.update(kw)
    return o


INVOCATIONS = [
    opt('agonizing-blast', 'Agonizing Blast', 'Pick one of your damaging Warlock cantrips; add your Charisma modifier to its damage rolls.', prereq={'level': 2, 'text': 'Level 2+ Warlock; a Warlock cantrip that deals damage'}, repeatable=True),
    opt('armor-of-shadows', 'Armor of Shadows', 'Cast Mage Armor on yourself at will without a spell slot.'),
    opt('ascendant-step', 'Ascendant Step', 'Cast Levitate on yourself at will without a spell slot.', prereq={'level': 5, 'text': 'Level 5+ Warlock'}),
    opt('devils-sight', "Devil's Sight", 'See normally in Dim Light and Darkness, magical or not, out to 120 feet.', prereq={'level': 2, 'text': 'Level 2+ Warlock'}),
    opt('devouring-blade', 'Devouring Blade', 'Thirsting Blade improves: your pact weapon attacks three times when you take the Attack action.', prereq={'level': 12, 'invocation': 'thirsting-blade', 'text': 'Level 12+ Warlock; Thirsting Blade'}),
    opt('eldritch-mind', 'Eldritch Mind', 'You have Advantage on Constitution saves made to keep Concentration.'),
    opt('eldritch-smite', 'Eldritch Smite', 'Once per turn on a pact-weapon hit, spend a Pact Magic slot to add force damage (1d8 plus 1d8 per slot level) and possibly knock a Huge or smaller target Prone.', prereq={'level': 5, 'invocation': 'pact-of-the-blade', 'text': 'Level 5+ Warlock; Pact of the Blade'}),
    opt('eldritch-spear', 'Eldritch Spear', 'Pick a damaging Warlock cantrip with a range of 10+ feet; its range grows by 30 feet per Warlock level.', prereq={'level': 2, 'text': 'Level 2+ Warlock; a Warlock cantrip that deals damage'}, repeatable=True),
    opt('fiendish-vigor', 'Fiendish Vigor', 'Cast False Life on yourself without a slot whenever you like, taking the maximum Temporary Hit Points instead of rolling.', prereq={'level': 2, 'text': 'Level 2+ Warlock'}),
    opt('gaze-of-two-minds', 'Gaze of Two Minds', 'As a Bonus Action, link to a willing creature you touch and perceive through its senses for a while; you can cast spells as if from its space.', prereq={'level': 5, 'text': 'Level 5+ Warlock'}),
    opt('gift-of-the-depths', 'Gift of the Depths', 'You can breathe underwater, gain a Swim Speed equal to your Speed, and can cast Water Breathing once per Long Rest without a slot.', prereq={'level': 5, 'text': 'Level 5+ Warlock'}),
    opt('gift-of-the-protectors', 'Gift of the Protectors', 'Creatures who write their names in your Book of Shadows can drop to 1 Hit Point instead of 0 (once each per Long Rest).', prereq={'level': 9, 'invocation': 'pact-of-the-tome', 'text': 'Level 9+ Warlock; Pact of the Tome'}),
    opt('investment-of-the-chain-master', 'Investment of the Chain Master', 'Your Pact of the Chain familiar gains a flying or swimming speed, can attack as a Bonus Action on your command, uses your save DC and can be shielded by your Reaction.', prereq={'level': 5, 'invocation': 'pact-of-the-chain', 'text': 'Level 5+ Warlock; Pact of the Chain'}),
    opt('lessons-of-the-first-ones', 'Lessons of the First Ones', 'Gain one Origin feat of your choice.', prereq={'level': 2, 'text': 'Level 2+ Warlock'}, repeatable=True, grants={'feat': 'origin'}),
    opt('lifedrinker', 'Lifedrinker', 'Once per turn on a pact-weapon hit, add 1d6 necrotic, psychic or radiant damage, and you can spend a Hit Point Die to heal.', prereq={'level': 9, 'invocation': 'pact-of-the-blade', 'text': 'Level 9+ Warlock; Pact of the Blade'}),
    opt('mask-of-many-faces', 'Mask of Many Faces', 'Cast Disguise Self at will without a spell slot.', prereq={'level': 2, 'text': 'Level 2+ Warlock'}),
    opt('master-of-myriad-forms', 'Master of Myriad Forms', 'Cast Alter Self at will without a spell slot.', prereq={'level': 5, 'text': 'Level 5+ Warlock'}),
    opt('misty-visions', 'Misty Visions', 'Cast Silent Image at will without a spell slot.', prereq={'level': 2, 'text': 'Level 2+ Warlock'}),
    opt('one-with-shadows', 'One with Shadows', 'While in Dim Light or Darkness you can cast Invisibility on yourself without a spell slot.', prereq={'level': 5, 'text': 'Level 5+ Warlock'}),
    opt('otherworldly-leap', 'Otherworldly Leap', 'Cast Jump on yourself at will without a spell slot.', prereq={'level': 2, 'text': 'Level 2+ Warlock'}),
    opt('pact-of-the-blade', 'Pact of the Blade', 'Conjure or bond a pact weapon you are proficient with; it can deal necrotic, psychic or radiant damage and you may use Charisma for its attack and damage rolls.'),
    opt('pact-of-the-chain', 'Pact of the Chain', 'Learn Find Familiar (cast without a slot) and summon a special form such as an imp, pseudodragon, quasit, skeleton, sphinx of wonder, sprite or venomous snake; it can attack with your Reaction.'),
    opt('pact-of-the-tome', 'Pact of the Tome', 'Receive a Book of Shadows holding three extra cantrips and two level 1 Ritual spells from any class list, always prepared while you carry it; it can be your focus.'),
    opt('repelling-blast', 'Repelling Blast', 'Pick a damaging Warlock cantrip that uses an attack roll; on a hit you can push a Large or smaller target 10 feet away.', prereq={'level': 2, 'text': 'Level 2+ Warlock; a Warlock cantrip that deals damage via an attack roll'}, repeatable=True),
    opt('thirsting-blade', 'Thirsting Blade', 'Your pact weapon attacks twice when you take the Attack action.', prereq={'level': 5, 'invocation': 'pact-of-the-blade', 'text': 'Level 5+ Warlock; Pact of the Blade'}),
    opt('visions-of-distant-realms', 'Visions of Distant Realms', 'Cast Arcane Eye without a spell slot.', prereq={'level': 9, 'text': 'Level 9+ Warlock'}),
    opt('whispers-of-the-grave', 'Whispers of the Grave', 'Cast Speak with Dead without a spell slot.', prereq={'level': 7, 'text': 'Level 7+ Warlock'}),
    opt('witch-sight', 'Witch Sight', 'You gain Truesight out to 30 feet.', prereq={'level': 15, 'text': 'Level 15+ Warlock'}),
]

_CANTRIP_PICK = {'type': 'spells', 'count': 1, 'level': 0, 'list': ['warlock'], 'known': True,
                 'note': 'One of your Warlock cantrips that deals damage.'}
_INV_CHOICE = {
    'agonizing-blast': _CANTRIP_PICK, 'eldritch-spear': _CANTRIP_PICK, 'repelling-blast': _CANTRIP_PICK,
    'lessons-of-the-first-ones': {'type': 'feat', 'category': 'origin'},
    'pact-of-the-tome': {'type': 'multi', 'parts': [
        {'type': 'spells', 'count': 3, 'level': 0, 'list': 'any'},
        {'type': 'spells', 'count': 2, 'level': 1, 'list': 'any', 'ritual': True}]},
    'pact-of-the-chain': {'type': 'options', 'key': 'pact-familiar', 'count': 1, 'changeable': 'recast',
                          'options': [{'id': slug(x), 'name': x} for x in
                                      ['Imp', 'Pseudodragon', 'Quasit', 'Skeleton', 'Slaad Tadpole', 'Sphinx of Wonder',
                                       'Sprite', 'Venomous Snake']]},
}
for _o in INVOCATIONS:
    if _o['id'] in _INV_CHOICE:
        _o['choice'] = _INV_CHOICE[_o['id']]

METAMAGIC = [
    opt('careful-spell', 'Careful Spell', 'Cost 1 SP. When a spell forces a save, chosen creatures (up to your Charisma modifier) automatically succeed and take no damage if they would take half.', cost=1),
    opt('distant-spell', 'Distant Spell', 'Cost 1 SP. Double a spell\'s range of 5+ feet, or give a Touch spell a 30-foot range.', cost=1),
    opt('empowered-spell', 'Empowered Spell', 'Cost 1 SP. Reroll up to your Charisma modifier in damage dice and keep the new rolls; works alongside another Metamagic option.', cost=1),
    opt('extended-spell', 'Extended Spell', 'Cost 1 SP. Double a duration of 1 minute or more (max 24 hours); you also get Advantage on Concentration saves for it.', cost=1),
    opt('heightened-spell', 'Heightened Spell', 'Cost 2 SP. One target of the spell has Disadvantage on its saves against it.', cost=2),
    opt('quickened-spell', 'Quickened Spell', 'Cost 2 SP. Cast a one-action spell as a Bonus Action (not if you already cast a level 1+ spell this turn).', cost=2),
    opt('seeking-spell', 'Seeking Spell', 'Cost 1 SP. Reroll a missed spell attack roll; works alongside another Metamagic option.', cost=1),
    opt('subtle-spell', 'Subtle Spell', 'Cost 1 SP. Cast without Verbal, Somatic, or cost-free Material components.', cost=1),
    opt('transmuted-spell', 'Transmuted Spell', 'Cost 1 SP. Swap a spell\'s acid, cold, fire, lightning, poison or thunder damage for another type from that list.', cost=1),
    opt('twinned-spell', 'Twinned Spell', 'Cost 1 SP. When a spell could target one more creature at a higher level, treat its level as 1 higher.', cost=1),
]

# Option `grants` hints (structured effects of a picked option) keyed by feature id -> option id.
OPTION_GRANTS = {
    'cleric-divine-order': {'protector': {'weapons': ['martial'], 'armor': ['heavy']},
                            'thaumaturge': {'cantrips': 1}},
    'druid-primal-order': {'magician': {'cantrips': 1},
                           'warden': {'weapons': ['martial'], 'armor': ['medium']}},
}

BARB_SKILLS = ['animal-handling', 'athletics', 'intimidation', 'nature', 'perception', 'survival']
DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing',
                'poison', 'psychic', 'radiant', 'slashing', 'thunder']

# Structured always-prepared spell tables (SRD 5.2). Keyed by class level.
ALWAYS_PREPARED = {
    'druid-druidic': {'1': ['speak-with-animals']},
    'paladin-paladins-smite': {'2': ['divine-smite']},
    'paladin-faithful-steed': {'5': ['find-steed']},
    'ranger-favored-enemy': {'1': ['hunters-mark']},
    'bard-words-of-creation': {'20': ['power-word-heal', 'power-word-kill']},
    'life-domain-spells': {'3': ['aid', 'bless', 'cure-wounds', 'lesser-restoration'],
                           '5': ['mass-healing-word', 'revivify'], '7': ['aura-of-life', 'death-ward'],
                           '9': ['greater-restoration', 'mass-cure-wounds']},
    'devotion-oath-of-devotion-spells': {'3': ['protection-from-evil-and-good', 'shield-of-faith'],
                                         '5': ['aid', 'zone-of-truth'], '9': ['beacon-of-hope', 'dispel-magic'],
                                         '13': ['freedom-of-movement', 'guardian-of-faith'],
                                         '17': ['commune', 'flame-strike']},
    'fiend-patron-fiend-spells': {'3': ['burning-hands', 'command', 'scorching-ray', 'suggestion'],
                                  '5': ['fireball', 'stinking-cloud'], '7': ['fire-shield', 'wall-of-fire'],
                                  '9': ['geas', 'insect-plague']},
    'draconic-sorcery-draconic-spells': {'3': ['alter-self', 'chromatic-orb', 'command', 'dragons-breath'],
                                         '5': ['fear', 'fly'], '7': ['arcane-eye', 'charm-monster'],
                                         '9': ['legend-lore', 'summon-dragon']},
}
# Circle of the Land: spells depend on the land picked after each Long Rest.
LAND_SPELLS = {
    'arid': {'3': ['blur', 'burning-hands', 'fire-bolt'], '5': ['fireball'], '7': ['blight'], '9': ['wall-of-stone']},
    'polar': {'3': ['fog-cloud', 'hold-person', 'ray-of-frost'], '5': ['sleet-storm'], '7': ['ice-storm'], '9': ['cone-of-cold']},
    'temperate': {'3': ['misty-step', 'shocking-grasp', 'sleep'], '5': ['lightning-bolt'], '7': ['freedom-of-movement'], '9': ['tree-stride']},
    'tropical': {'3': ['acid-splash', 'ray-of-sickness', 'web'], '5': ['stinking-cloud'], '7': ['polymorph'], '9': ['insect-plague']},
}
LAND_RESIST = {'arid': 'fire', 'polar': 'cold', 'temperate': 'lightning', 'tropical': 'poison'}
# where the (badly extracted) spell table starts in these descriptions; it is regenerated
SPELL_TABLE_CUT = {
    'life-domain-spells': 'Life Domain Spells\n',
    'devotion-oath-of-devotion-spells': '\n\nOath of Devotion Spells',
    'fiend-patron-fiend-spells': 'Fiend Spells Warlock Level',
    'draconic-sorcery-draconic-spells': 'Draconic Spells Sorcerer Level',
    'land-circle-of-the-land-spells': 'Arid Land\n',
}

# Small targeted text repairs (upstream extraction glitches)
TEXT_PATCHES = {
    'wizard-spellcasting': [('\nanother Wizard cantrip of your choice, as shown',
                             '\nWhen you reach Wizard levels 4 and 10, you learn another Wizard cantrip of your choice, as shown')],
    'ranger-spellcasting': [('choose two level 1\nRanger spells', 'choose two level 1 Ranger spells')],
    'barbarian-primal-knowledge': [('Perception,\nStealth', 'Perception, Stealth')],
    'sorcerer-font-of-magic': [('Creating Spell Slots Spell Slot Level', 'Creating Spell Slots\nSpell Slot Level')],
}


# --------------------------------------------------------------------------------------
# Build steps
# --------------------------------------------------------------------------------------
def build_rules():
    A = load('Ability-Scores')
    abil = [{'id': a['index'], 'name': a['name'], 'full': a['full_name'], 'description': md(a.get('description', ''))}
            for a in A]
    abil.sort(key=lambda a: ABILS.index(a['id']))
    skills = [{'id': s['index'], 'name': s['name'], 'ability': ix(s['ability_score']),
               'description': md(s.get('description', ''))} for s in load('Skills')]
    skills.sort(key=lambda s: s['name'])
    langs = []
    for l in load('Languages'):
        rare = bool(l.get('is_rare'))
        if l['index'] == 'druidic' and not rare:
            rare = True
            log('languages: Druidic is a rare language (SRD 5.2 Rare Languages table)')
        e = {'id': l['index'], 'name': l['name'], 'rare': rare}
        if l.get('note'):
            e['note'] = md(l['note'])
        langs.append(e)
    simple = lambda f: [{'id': x['index'], 'name': x['name'], 'description': md(x.get('description', ''))}
                        for x in load(f)]
    rules = {
        'abilities': abil,
        'skills': skills,
        'alignments': [{'id': a['index'], 'name': a['name'], 'abbr': a['abbreviation'],
                        'description': md(a.get('description', ''))} for a in load('Alignments')],
        'languages': langs,
        'startingLanguages': {'known': ['common'], 'choose': 2, 'from': 'standard',
                              'note': 'Common plus two standard (non-rare) languages; backgrounds/species/features may add more.'},
        'conditions': simple('Conditions'),
        'damageTypes': simple('Damage-Types'),
        'weaponProperties': simple('Weapon-Properties'),
        'weaponMasteries': simple('Weapon-Mastery-Properties'),
        'magicSchools': simple('Magic-Schools'),
        'sizes': [{'id': 'tiny', 'name': 'Tiny', 'space': '2.5 ft'}, {'id': 'small', 'name': 'Small', 'space': '5 ft'},
                  {'id': 'medium', 'name': 'Medium', 'space': '5 ft'}, {'id': 'large', 'name': 'Large', 'space': '10 ft'},
                  {'id': 'huge', 'name': 'Huge', 'space': '15 ft'}, {'id': 'gargantuan', 'name': 'Gargantuan', 'space': '20 ft'}],
        'profBonusByLevel': PROF_BY_LEVEL,
        'xpByLevel': XP_BY_LEVEL,
        'standardArray': [15, 14, 13, 12, 10, 8],
        'pointBuy': {'budget': 27, 'min': 8, 'max': 15,
                     'cost': {'8': 0, '9': 1, '10': 2, '11': 3, '12': 4, '13': 5, '14': 7, '15': 9}},
        'abilityScoreMax': 20,
        'backgroundAbilityIncrease': {'options': [[2, 1], [1, 1, 1]], 'max': 20,
                                      'note': 'Increase one of the background\'s three abilities by 2 and another by 1, or all three by 1.'},
        'hitPoints': {'level1': 'hitDie + CON modifier', 'perLevelFixed': {'6': 4, '8': 5, '10': 6, '12': 7},
                      'perLevelRoll': '1dHitDie + CON modifier (minimum 1)'},
        'multiclassSlotTable': MULTICLASS_SLOTS,
        'multiclassCasterLevel': {'full': 1, 'half': 'ceil(level/2)', 'third': 'floor(level/3)', 'pact': 0,
                                  'note': 'Sum Bard/Cleric/Druid/Sorcerer/Wizard levels, half Paladin/Ranger levels (round up) '
                                          'and a third of Eldritch Knight/Arcane Trickster levels (round down). Warlock Pact Magic slots are separate.'},
        'currency': [{'id': 'cp', 'name': 'Copper Piece', 'gp': 0.01}, {'id': 'sp', 'name': 'Silver Piece', 'gp': 0.1},
                     {'id': 'ep', 'name': 'Electrum Piece', 'gp': 0.5}, {'id': 'gp', 'name': 'Gold Piece', 'gp': 1},
                     {'id': 'pp', 'name': 'Platinum Piece', 'gp': 10}],
        'carryingCapacity': {'perStr': 15, 'note': 'Carry up to STR x 15 lb (x2 Large, x4 Huge, x8 Gargantuan; Tiny x0.5). '
                                                   'Drag/lift/push up to twice that.'},
    }
    return rules


def build_equipment():
    E = load('Equipment')
    weapons, armor, gear = [], [], []

    WEAPON_FIX = {   # SRD 5.2 weapon table corrections (upstream data errors)
        'javelin': {'cost': {'qty': 5, 'unit': 'sp'}},
        'mace': {'weight': 4},
        'spear': {'weight': 3, 'cost': {'qty': 1, 'unit': 'gp'}},
        'dart': {'cost': {'qty': 5, 'unit': 'cp'}},
        'sling': {'damageType': 'bludgeoning'},
        'pike': {'weight': 18},
        'trident': {'damage': '1d8', 'versatile': '1d10'},
        'hand-crossbow': {'cost': {'qty': 75, 'unit': 'gp'}, 'weight': 3},
        'longbow': {'cost': {'qty': 50, 'unit': 'gp'}},
    }
    AMMO = {'arrows': 'arrows', 'bolts': 'bolts', 'needles': 'needles', 'bullets-sling': 'bullets-sling',
            'bullets-firearm': 'bullets-firearm'}
    DON = {'light': ('1 minute', '1 minute'), 'medium': ('5 minutes', '1 minute'),
           'heavy': ('10 minutes', '5 minutes'), 'shield': ('Utilize action', 'Utilize action')}

    def cost(e):
        c = e.get('cost')
        return {'qty': c['quantity'], 'unit': c['unit']} if c else None

    for e in E:
        cats = [ix(c) for c in e['equipment_categories']]
        if 'weapons' in cats:
            w = {
                'id': e['index'], 'name': e['name'],
                'category': 'martial' if 'martial-weapons' in cats else 'simple',
                'kind': 'ranged' if 'ranged-weapons' in cats else 'melee',
                'damage': e['damage']['damage_dice'], 'damageType': ix(e['damage']['damage_type']),
                'versatile': e['two_handed_damage']['damage_dice'] if e.get('two_handed_damage') else None,
                'properties': sorted(ix(p) for p in e.get('properties', [])),
                'mastery': ix(e.get('mastery')),
                'range': None, 'thrown': None,
                'weight': e.get('weight'), 'cost': cost(e),
            }
            if w['kind'] == 'ranged':
                r = e.get('range') or {}
                w['range'] = {'normal': r.get('normal'), 'long': r.get('long')}
            if e.get('throw_range'):
                w['thrown'] = {'normal': e['throw_range']['normal'], 'long': e['throw_range']['long']}
            if e.get('ammunition'):
                w['ammunition'] = AMMO.get(ix(e['ammunition']), ix(e['ammunition']))
            if e.get('notes'):
                w['notes'] = ' '.join(e['notes'])
            for k, v in WEAPON_FIX.get(w['id'], {}).items():
                if w.get(k) != v:
                    log(f'weapons: {w["id"]}.{k} {w.get(k)} -> {v}')
                    w[k] = v
            weapons.append(w)
        elif 'armor' in cats:
            cat = 'shield' if 'shields' in cats else next(c.split('-')[0] for c in cats if c.endswith('-armor'))
            if e['index'] == 'hide-armor' and cat != 'medium':
                log('armor: hide-armor category light -> medium')
                cat = 'medium'
            ac = e['armor_class']
            a = {'id': e['index'], 'name': e['name'], 'category': cat,
                 'ac': {'base': ac['base'], 'dex': bool(ac.get('dex_bonus')),
                        'maxDex': (2 if cat == 'medium' else None) if ac.get('dex_bonus') else None},
                 'strMin': e.get('str_minimum') or None,
                 'stealthDisadvantage': bool(e.get('stealth_disadvantage')),
                 'weight': e.get('weight'), 'cost': cost(e),
                 'don': DON[cat][0], 'doff': DON[cat][1]}
            if e['index'] == 'chain-shirt' and a['weight'] != 20:
                log(f'armor: chain-shirt weight {a["weight"]} -> 20')
                a['weight'] = 20
            armor.append(a)
        else:
            if e.get('contents'):
                cat = 'equipment-packs'
            else:
                order = ['artisans-tools', 'musical-instruments', 'gaming-sets', 'other-tools', 'ammunition',
                         'arcane-foci', 'druidic-foci', 'holy-symbols']
                cat = next((c for c in order if c in cats), 'adventuring-gear')
            g = {'id': e['index'], 'name': e['name'], 'category': cat, 'cost': cost(e), 'weight': e.get('weight')}
            if cat in ('artisans-tools', 'musical-instruments', 'gaming-sets', 'other-tools'):
                g['tool'] = True
            desc = md(e.get('description', ''))
            extra = []
            if e.get('ability'):
                g['ability'] = ix(e['ability'])
                extra.append(f'**Ability:** {ABIL_FULL[g["ability"]]}.')
            if e.get('utilize'):
                g['utilize'] = []
                for u in e['utilize']:
                    nm = _norm(u['name']).strip(' :')
                    dc = (u.get('dc') or {}).get('dc_value')
                    g['utilize'].append({'name': nm, 'dc': dc})
                extra.append('**Utilize:** ' + '; '.join(f'{u["name"]} (DC {u["dc"]})' if u['dc'] else u['name']
                                                         for u in g['utilize']) + '.')
            if e.get('craft'):
                g['craft'] = [ix(c) for c in e['craft']]
            if e.get('contents'):
                g['contents'] = [{'id': ix(c['item']), 'qty': c['quantity']} for c in e['contents']]
            if e.get('quantity'):
                g['quantity'] = e['quantity']
            if e.get('storage'):
                g['storage'] = ix(e['storage'])
            if not desc and cat == 'ammunition':
                desc = f'Sold in bundles of {e.get("quantity", 1)}' + (
                    f', stored in a {ix(e["storage"]).replace("case-crossbow-bolt", "Crossbow Bolt Case").title()}.'
                    if e.get('storage') else '.')
            g['description'] = '\n\n'.join(x for x in [desc, ' '.join(extra)] if x)
            gear.append(g)
    PACK_COST = {'explorers-pack': 10, 'priests-pack': 33, 'scholars-pack': 40}
    for g in gear:
        if g['id'] in PACK_COST and not g['cost']:
            g['cost'] = {'qty': PACK_COST[g['id']], 'unit': 'gp'}
            log(f'gear: {g["id"]} missing cost -> {PACK_COST[g["id"]]} gp')
    names = {g['id']: g['name'] for g in gear}
    names.update({w['id']: w['name'] for w in weapons})
    names.update({a['id']: a['name'] for a in armor})
    for g in gear:   # tool craft lists -> readable
        if g.get('craft'):
            g['description'] += ('\n\n' if g['description'] else '') + '**Craft:** ' + ', '.join(
                names.get(c, c.replace('-', ' ').title()) for c in g['craft']) + '.'
    by_name = lambda x: x['name'].lower()
    return sorted(weapons, key=by_name), sorted(armor, key=lambda a: (['light', 'medium', 'heavy', 'shield'].index(a['category']), a['ac']['base'], a['name'])), sorted(gear, key=by_name), names


def equipment_options(opts, names, fixes=None):
    """5e-database option sets -> [{label, items:[{id,qty,name}|{category,qty,name}], gp}]"""
    out = []
    for oi, o in enumerate(opts):
        label = 'ABCDEFG'[oi]
        entry = {'label': label, 'items': [], 'gp': 0}
        parts = o['items'] if o['option_type'] == 'multiple' else [o]
        for p in parts:
            t = p['option_type']
            if t == 'money':
                entry['gp'] += p['count'] if p['unit'] == 'gp' else 0
            elif t == 'counted_reference':
                of = p['of']
                iid = ix(of)
                it = {'id': iid, 'qty': p['count'], 'name': names.get(iid, of.get('name') if isinstance(of, dict) else iid)}
                if iid == 'holy-symbols':
                    it = {'category': 'holy-symbols', 'qty': p['count'], 'name': 'Holy Symbol'}
                if isinstance(of, dict) and of.get('note'):
                    it['note'] = of['note']
                entry['items'].append(it)
            elif t == 'choice':
                ch = p['choice']
                fr = ch['from']
                if fr.get('option_set_type') == 'equipment_category':
                    cat = ix(fr['equipment_category'])
                    nm = ch.get('desc') or {'gaming-sets': 'Gaming Set (the one chosen for your tool proficiency)'}.get(
                        cat, cat.replace('-', ' ').title())
                    it = {'category': cat, 'qty': ch.get('choose', 1), 'name': _norm(nm)}
                    if cat == 'gaming-sets':
                        it['sameAsTool'] = True
                    entry['items'].append(it)
                else:
                    cats = [ix(x['choice']['from']['equipment_category']) for x in fr['options']
                            if x.get('option_type') == 'choice']
                    entry['items'].append({'category': cats, 'qty': 1, 'name': _norm(ch.get('desc', ' or '.join(cats)))})
        out.append(entry)
    return out


def build_spells():
    S = load('Spells')
    out = []
    statblock_re = re.compile(r'(?:(?<=\. )|^)((?:Tiny|Small|Medium|Large|Huge|Gargantuan)\b[^.]{0,90}?\bAC \d.*)$', re.S)
    SPELL_PATCHES = {'find-steed': [("creature type-Celestial, Fey, or Fiendwhich", 'creature type—Celestial, Fey, or Fiend—which')]}
    for s in S:
        desc = _norm(s['description'])
        for a, b in SPELL_PATCHES.get(s['index'], []):
            if a not in desc:
                warn(f'spell patch not applied: {s["index"]}')
            desc = desc.replace(a, b)
        higher = _norm(s.get('higher_level') or '')
        rng = s['range']
        comps = list(s.get('components') or [])
        m = re.match(r'^(.*?)\s*Component:\s*(.*)$', rng)
        if m:
            rng = m.group(1).strip()
            if not comps:
                comps = [c.strip() for c in m.group(2).split(',') if c.strip()]
        # inline "Using a Higher-Level Spell Slot." / "Cantrip Upgrade." -> higherLevel
        for marker in ('Using a Higher-Level Spell Slot.', 'Cantrip Upgrade.'):
            k = desc.find(marker)
            if k >= 0:
                tail = desc[k + len(marker):].strip()
                desc = desc[:k].rstrip()
                higher = (tail + (' ' + higher if higher else '')).strip()
        stat = None
        for field in ('higher', 'desc'):
            txt = higher if field == 'higher' else desc
            mm = statblock_re.search(txt)
            if mm and 'HP ' in mm.group(1):
                stat = mm.group(1).strip()
                txt = txt[:mm.start(1)].rstrip()
                if field == 'higher':
                    higher = txt
                else:
                    desc = txt
                break
        ct = s['casting_time']
        trigger = None
        mt = re.match(r'^(Action|Bonus Action|Reaction), (which you take .*)$', ct)
        if mt:
            ct, trigger = mt.group(1), mt.group(2)
        dur = re.sub(r'^Concentration,? ', '', s['duration']).strip()
        dur = dur[0].upper() + dur[1:]
        sp = {
            'id': s['index'], 'name': s['name'], 'level': s['level'], 'school': ix(s['school']),
            'classes': sorted(ix(c) for c in s['classes']),
            'castingTime': ct, 'ritual': bool(s.get('ritual')), 'range': rng, 'components': comps,
            'material': _norm(s['material']) if s.get('material') else None,
            'duration': dur, 'concentration': bool(s.get('concentration')),
            'description': md(desc), 'higherLevel': md(higher) if higher else None,
        }
        if trigger:
            sp['castingTrigger'] = trigger
        if s.get('attack_type'):
            sp['attack'] = s['attack_type']
        ms = re.search(r'\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw', desc)
        if ms:
            sp['save'] = FULL_TO_ABIL[ms.group(1).lower()]
        if s.get('damage'):
            d = s['damage']
            lv = d.get('damage_at_slot_level') or d.get('damage_at_character_level') or {}
            if lv:
                k0 = sorted(lv, key=int)[0]
                sp['damage'] = {'type': ix(d.get('damage_type')), 'dice': lv[k0]}
        if stat:
            sp['statBlock'] = format_statblock(stat)
        out.append(sp)
    out.sort(key=lambda x: (x['name'].lower()))
    return out


def format_statblock(t):
    t = re.sub(r'\s+', ' ', t)
    abil = re.findall(r'\b(str|dex|con|int|wis|cha)\s+(\d+)\s+([+\-−]\d+)\s+([+\-−]\d+)', t, flags=re.I)
    t = re.sub(r'MOD SAVE(\s+MOD SAVE)*\s*(?:(?:str|dex|con|int|wis|cha)\s+\d+\s+[+\-−]\d+\s+[+\-−]\d+\s*)+',
               ' @@ABIL@@ ', t, flags=re.I)
    for kw in ('AC ', 'HP ', 'Speed ', 'Resistances ', 'Immunities ', 'Senses ', 'Languages ', 'CR '):
        t = re.sub(r'\s(?=' + re.escape(kw) + ')', '\n', t, count=1)
    for kw in ('Traits', 'Actions', 'Bonus Actions', 'Reactions'):
        t = re.sub(r'\s+' + kw + r'\s+(?=[A-Z])', f'\n\n**{kw}**\n', t, count=1)
    if abil:
        line = ' · '.join(f'{a.upper()} {s} ({m}, save {v})' for a, s, m, v in abil)
        t = t.replace('@@ABIL@@', '\n' + line + '\n')
    t = re.sub(r'(?<=[.)]) (?=(?:[A-Z][\w\']*(?: [A-Z][\w\']*){0,3})(?: \([^)]{1,60}\))?\. (?:Melee|Ranged|The|One|Dexterity|Strength|Constitution|Intelligence|Wisdom|Charisma|When|While|As|If|You)\b)',
               '\n', t)
    t = re.sub(r' *\n *', '\n', t).strip()
    lines = t.split('\n')
    head = lines[0]
    rest = '  \n'.join(l for l in lines[1:] if l.strip())
    return f'*{head}*  \n{rest}'.replace('  \n\n**', '\n\n**').replace('**  \n', '**\n')


def build_feats():
    F = load('Feats')
    out = []
    for f in F:
        cat = f['type']
        pr = f.get('prerequisites') or {}
        prereq = {}
        txt = []
        if pr.get('minimum_level'):
            prereq['level'] = pr['minimum_level']
            txt.append(f'Level {pr["minimum_level"]}+')
        po = f.get('prerequisite_options')
        if po:
            opts = [{'ability': ix(o['ability_score']), 'min': o['minimum_score']} for o in po['from']['options']]
            prereq['abilities'] = {'any': opts}
            txt.append(po.get('desc') or ' or '.join(f'{ABIL_FULL[o["ability"]]} {o["min"]}+' for o in opts))
        if pr.get('feature_named'):
            if pr['feature_named'] == 'Spellcasting':
                prereq['spellcasting'] = True
                txt.append('Spellcasting or Pact Magic feature')
            else:
                prereq['feature'] = pr['feature_named']
                txt.append(f'{pr["feature_named"]} feature')
        name = f['name']
        if name == 'Two Weapon Fighting':
            name = 'Two-Weapon Fighting'
        e = {'id': f['index'], 'name': name, 'category': cat,
             'prerequisite': '; '.join(txt) or None, 'prereq': prereq or None,
             'repeatable': bool(f.get('repeatable')),
             'description': md(f['description'])}
        if f.get('repeatable'):
            e['repeatableNote'] = _norm(f['repeatable'])
        ch = None
        if f['index'] == 'ability-score-improvement':
            ch = {'type': 'ability-increase', 'points': 2, 'maxPerAbility': 2, 'from': ABILS, 'max': 20}
        elif f['index'] == 'grappler':
            ch = {'type': 'ability-increase', 'points': 1, 'from': ['str', 'dex'], 'max': 20}
        elif cat == 'epic-boon':
            ch = {'type': 'ability-increase', 'points': 1, 'from': ABILS, 'max': 30}
        elif f['index'] == 'magic-initiate':
            ch = {'type': 'multi', 'parts': [
                {'type': 'options', 'key': 'spell-list', 'count': 1, 'options': [
                    {'id': 'cleric', 'name': 'Cleric'}, {'id': 'druid', 'name': 'Druid'}, {'id': 'wizard', 'name': 'Wizard'}],
                 'note': 'A background that grants this feat names the list (feat.note).'},
                {'type': 'spells', 'count': 2, 'level': 0, 'listFrom': 'spell-list'},
                {'type': 'spells', 'count': 1, 'level': 1, 'listFrom': 'spell-list', 'alwaysPrepared': True},
                {'type': 'ability', 'key': 'spellcasting-ability', 'from': ['int', 'wis', 'cha']}]}
        elif f['index'] == 'skilled':
            ch = {'type': 'skills-or-tools', 'count': 3}
        if ch:
            e['choice'] = ch
        out.append(e)
    order = ['origin', 'general', 'fighting-style', 'epic-boon']
    out.sort(key=lambda x: (order.index(x['category']), x['name']))
    return out


def build_backgrounds(names):
    B = load('Backgrounds')
    out = []
    for b in B:
        profs = [ix(p) for p in b['proficiencies']]
        skills = [p[6:] for p in profs if p.startswith('skill-')]
        tools = [p[5:] if p.startswith('tool-') else p for p in profs if not p.startswith('skill-')]
        feat = b['feat']
        fid = ix(feat)
        note = feat.get('note') if isinstance(feat, dict) else None
        if fid == 'magic-initiate' and not note:
            note = {'sage': 'Wizard', 'acolyte': 'Cleric'}.get(b['index'])
            log(f'backgrounds: {b["index"]} Magic Initiate list -> {note}')
        tool = None
        if tools:
            tool = {'id': tools[0], 'name': names.get(tools[0], tools[0])}
        for pc in b.get('proficiency_choices', []):
            frm = [ix(o['item']) for o in pc['from']['options']]
            frm = [x[5:] if x.startswith('tool-') else x for x in frm]
            tool = {'category': 'gaming-sets', 'name': 'One kind of Gaming Set', 'from': frm}
        eq = b['equipment_options'][0]
        e = {'id': b['index'], 'name': b['name'],
             'abilityScores': [ix(a) for a in b['ability_scores']],
             'feat': {'id': fid, 'note': note},
             'skills': skills, 'tool': tool,
             'equipment': {'text': _norm(eq['desc']), 'options': equipment_options(eq['from']['options'], names)}}
        out.append(e)
    out.sort(key=lambda x: x['name'])
    return out


def build_species(spell_ids):
    SP = load('Species')
    SS = {s['index']: s for s in load('Subspecies')}
    T = {t['index']: t for t in load('Traits')}
    LABEL = {'dragonborn': ('draconic-ancestry', 'Draconic Ancestry'), 'elf': ('elven-lineage', 'Elven Lineage'),
             'gnome': ('gnomish-lineage', 'Gnomish Lineage'), 'goliath': ('giant-ancestry', 'Giant Ancestry'),
             'tiefling': ('fiendish-legacy', 'Fiendish Legacy')}
    SPELL_ABIL = {'type': 'ability', 'key': 'spellcasting-ability', 'from': ['int', 'wis', 'cha']}
    TRAIT_CHOICE = {
        'draconic-ancestry': {'type': 'subspecies'},
        'giant-ancestry': {'type': 'subspecies'},
        'elven-lineage': {'type': 'multi', 'parts': [{'type': 'subspecies'}, SPELL_ABIL]},
        'gnomish-lineage': {'type': 'multi', 'parts': [{'type': 'subspecies'}, SPELL_ABIL]},
        'fiendish-legacy': {'type': 'multi', 'parts': [{'type': 'subspecies'}, SPELL_ABIL]},
        'keen-senses': {'type': 'skills', 'count': 1, 'from': ['insight', 'perception', 'survival']},
        'skillful': {'type': 'skills', 'count': 1, 'from': 'any'},
        'versatile': {'type': 'feat', 'category': 'origin'},
        'high-elf-cantrip-versatility': {'type': 'spells', 'count': 1, 'level': 0, 'list': ['wizard'],
                                         'default': 'prestidigitation', 'changeable': 'long-rest'},
    }
    TRAIT_LEVEL = {'draconic-flight': 5, 'large-form': 5}

    def trait(tid, level=None):
        t = T[tid]
        e = {'id': tid, 'name': _norm(t['name']), 'description': md(t['description'])}
        lv = level or TRAIT_LEVEL.get(tid)
        if lv and lv > 1:
            e['level'] = lv
        if t.get('spells'):
            sid = ix(t['spells'][0]['spell'])
            e['spell'] = sid
        if tid in TRAIT_CHOICE:
            e['choice'] = TRAIT_CHOICE[tid]
        if tid == 'wood-elf-speed-increase':
            e['speed'] = 35
        return e

    out = []
    for s in SP:
        tids = [ix(t) for t in s['traits']]
        if s['index'] in LABEL and LABEL[s['index']][0] not in tids:
            tids.insert(0, LABEL[s['index']][0])
            log(f'species: {s["index"]} add base trait {LABEL[s["index"]][0]}')
        e = {'id': s['index'], 'name': s['name'], 'type': s['type']}
        if s.get('size_options'):
            e['sizeOptions'] = [o['size'] for o in s['size_options']['from']['options']]
        else:
            e['size'] = s['size']
        if s['index'] == 'human' and 'sizeOptions' not in e:
            e.pop('size')
            e['sizeOptions'] = ['Small', 'Medium']
            log('species: human size Medium -> Small or Medium (SRD 5.2)')
        e['speed'] = s['speed']
        dv = [int(t.split('-')[1]) for t in tids if t.startswith('darkvision-')]
        e['darkvision'] = dv[0] if dv else None
        e['traits'] = [trait(t) for t in tids]
        if s.get('subspecies'):
            e['subspeciesLabel'] = LABEL[s['index']][1]
            subs = []
            for ref in s['subspecies']:
                ss = SS[ix(ref)]
                nm = _norm(ss['name']).split(': ', 1)[-1]
                sub = {'id': ss['index'], 'name': nm,
                       'traits': [trait(ix(t), t.get('level')) for t in ss['traits']]}
                if ss['index'] == 'elven-lineage-wood-elf' and not any(t.get('spell') == 'druidcraft' for t in sub['traits']):
                    sub['traits'].insert(1, {'id': 'lineage-spell-druidcraft', 'name': 'Druidcraft',
                                             'description': 'You know the Druidcraft cantrip.', 'spell': 'druidcraft'})
                    log('species: wood elf lineage add Druidcraft cantrip (SRD 5.2 Elven Lineages table)')
                if ss.get('damage_type'):
                    sub['damageType'] = ix(ss['damage_type'])
                dvs = [int(t['id'].split('-')[1]) for t in sub['traits'] if t['id'].startswith('darkvision-')]
                if dvs:
                    sub['darkvision'] = dvs[0]
                sp_ = [t['speed'] for t in sub['traits'] if t.get('speed')]
                if sp_:
                    sub['speed'] = sp_[0]
                subs.append(sub)
            e['subspecies'] = subs
        for t in e['traits'] + [t for sub in e.get('subspecies', []) for t in sub['traits']]:
            if t.get('spell') and t['spell'] not in spell_ids:
                warn(f'species trait {t["id"]} spell {t["spell"]} not in spells.json')
        out.append(e)
    out.sort(key=lambda x: x['name'])
    return out


def parse_options(desc):
    """'  Name. text' option lines of a feature description -> [{id,name,description}]"""
    lines = [l.strip() for l in _dehyphen(_norm(desc)).split('\n')]
    opts = []
    for l in lines[1:]:
        m = re.match(r"^([A-Z][A-Za-z' ]{2,40})\. (.+)$", l)
        if m:
            opts.append({'id': slug(m.group(1)), 'name': m.group(1), 'description': md(m.group(2))})
        elif opts and l:
            opts[-1]['description'] += '\n\n' + md(l)
    return opts


def feature_choice(fid, cls, desc, skill_from):
    """choice object for a class/subclass feature id (None if no decision is needed)."""
    base = fid.split('-', 1)[1] if fid.startswith(cls + '-') else fid
    if base == 'subclass':
        return {'type': 'subclass'}
    if base == 'ability-score-improvement':
        return {'type': 'asi-or-feat'}
    if base == 'epic-boon':
        return {'type': 'feat', 'category': 'epic-boon', 'orAnyFeat': True}
    if base == 'weapon-mastery':
        return {'type': 'weapon-mastery', 'countKey': 'weapon_mastery'}
    if fid in ('fighter-fighting-style', 'champion-additional-fighting-style'):
        return {'type': 'feat', 'category': 'fighting-style'}
    if fid in ('paladin-fighting-style', 'ranger-fighting-style'):
        alt = parse_options(desc)
        return {'type': 'feat', 'category': 'fighting-style', 'alternatives': alt}
    if fid in ('bard-expertise', 'rogue-expertise', 'ranger-expertise'):
        return {'type': 'expertise', 'count': 2}
    if fid == 'wizard-scholar':
        return {'type': 'expertise', 'count': 1,
                'from': ['arcana', 'history', 'investigation', 'medicine', 'nature', 'religion']}
    if fid == 'ranger-deft-explorer':
        return {'type': 'multi', 'parts': [{'type': 'expertise', 'count': 1}, {'type': 'languages', 'count': 2}]}
    if fid == 'rogue-thieves-cant':
        return {'type': 'languages', 'count': 1}
    if fid == 'barbarian-primal-knowledge':
        return {'type': 'skills', 'count': 1, 'from': skill_from}
    if fid == 'lore-bonus-proficiencies':
        return {'type': 'skills', 'count': 3, 'from': 'any'}
    if fid == 'lore-magical-discoveries':
        return {'type': 'spells', 'count': 2, 'list': ['cleric', 'druid', 'wizard'], 'level': 'cantrip-or-slot',
                'alwaysPrepared': True, 'changeable': 'level-up'}
    if fid in ('cleric-divine-order', 'druid-primal-order', 'cleric-blessed-strikes', 'druid-elemental-fury',
               'hunter-hunters-prey', 'hunter-defensive-tactics'):
        opts = parse_options(desc)
        for o in opts:
            g = OPTION_GRANTS.get(fid, {}).get(o['id'])
            if g:
                o['grants'] = g
        c = {'type': 'options', 'key': fid, 'count': 1, 'options': opts}
        if fid.startswith('hunter-'):
            c['changeable'] = 'short-rest'
        return c
    if fid == 'warlock-eldritch-invocations':
        return {'type': 'options', 'key': 'eldritch-invocations', 'countKey': 'eldritch_invocations',
                'changeable': 'level-up', 'options': INVOCATIONS,
                'note': 'Option summaries are our own words; see the SRD 5.2 Warlock section for full text.'}
    if fid == 'sorcerer-metamagic':
        return {'type': 'options', 'key': 'metamagic', 'count': 2, 'changeable': 'level-up', 'options': METAMAGIC,
                'note': 'Option summaries are our own words; see the SRD 5.2 Sorcerer section for full text.'}
    if fid in ('bard-spellcasting', 'cleric-spellcasting', 'druid-spellcasting', 'paladin-spellcasting',
               'ranger-spellcasting', 'sorcerer-spellcasting', 'wizard-spellcasting', 'warlock-pact-magic'):
        return {'type': 'spellcasting', 'class': cls}
    if fid == 'druid-wild-shape':
        return {'type': 'wild-shape-forms', 'countKey': 'wild_shape_known_forms', 'changeable': 'long-rest'}
    if fid == 'warlock-mystic-arcanum':
        return {'type': 'spells', 'count': 1, 'list': ['warlock'],
                'levelByClassLevel': {'11': 6, '13': 7, '15': 8, '17': 9}, 'changeable': 'level-up'}
    if fid == 'wizard-spell-mastery':
        return {'type': 'multi', 'parts': [
            {'type': 'spells', 'count': 1, 'level': 1, 'list': 'spellbook', 'castingTime': 'Action', 'alwaysPrepared': True},
            {'type': 'spells', 'count': 1, 'level': 2, 'list': 'spellbook', 'castingTime': 'Action', 'alwaysPrepared': True}],
            'changeable': 'long-rest'}
    if fid == 'wizard-signature-spells':
        return {'type': 'spells', 'count': 2, 'level': 3, 'list': 'spellbook', 'alwaysPrepared': True}
    if fid == 'evoker-evocation-savant':
        return {'type': 'spells', 'count': 2, 'list': ['wizard'], 'school': 'evocation', 'level': [1, 2],
                'addToSpellbook': True,
                'note': 'Each time you gain a new level of spell slots, add one more Wizard evocation spell for free.'}
    if fid == 'draconic-sorcery-elemental-affinity':
        return {'type': 'options', 'key': 'elemental-affinity', 'count': 1,
                'options': [{'id': d, 'name': d.title()} for d in ['acid', 'cold', 'fire', 'lightning', 'poison']]}
    if fid == 'fiend-patron-fiendish-resilience':
        return {'type': 'options', 'key': 'fiendish-resilience', 'count': 1, 'changeable': 'short-rest',
                'options': [{'id': d, 'name': d.title()} for d in DAMAGE_TYPES if d != 'force']}
    if fid == 'land-circle-of-the-land-spells':
        return {'type': 'options', 'key': 'land-type', 'count': 1, 'changeable': 'long-rest',
                'options': [{'id': k, 'name': k.title(), 'alwaysPrepared': v, 'resistance': LAND_RESIST[k]}
                            for k, v in LAND_SPELLS.items()]}
    return None


def spell_table_md(prefix_label, mapping, names):
    rows = [[lv, ', '.join(names.get(s, s) for s in ids)] for lv, ids in sorted(mapping.items(), key=lambda kv: int(kv[0]))]
    return md_table([f'{prefix_label} Level', 'Spells'], rows)


def build_classes(skill_ids, names, spell_names, spell_ids):
    C = load('Classes')
    L = load('Levels')
    Fsrc = {f['index']: f for f in load('Features')}
    SC = load('Subclasses')
    # --- features ---------------------------------------------------------------
    feat_levels = {}          # feature id -> [class levels]
    for lv in L:
        if 'subclass' in lv:
            continue
        for f in lv['features']:
            feat_levels.setdefault(ix(f), []).append(lv['level'])
    for lv in L:
        if 'subclass' in lv:
            for f in lv['features']:
                feat_levels.setdefault(ix(f), []).append(lv['level'])
    features = {}
    class_skill = {c['index']: [ix(o['item'])[6:] for o in c['proficiency_choices'][0]['from']['options']] for c in C}

    def make_feature(fid, sub=None):
        f = Fsrc[fid]
        cls = ix(f['class'])
        desc = _norm(f['description'])
        for a, b in TEXT_PATCHES.get(fid, []):
            if a not in desc:
                warn(f'text patch not applied: {fid}: {a[:30]!r}')
            desc = desc.replace(a, b)
        lv = sorted(set(feat_levels.get(fid, []))) or [int(re.search(r'(\d+)$', ix(f['level'])).group(1))]
        e = {'id': fid, 'name': _norm(f['name']), 'class': cls, 'subclass': sub, 'level': lv[0]}
        if len(lv) > 1:
            e['levels'] = lv
        if fid in SPELL_TABLE_CUT:
            cut = desc.find(SPELL_TABLE_CUT[fid])
            if cut < 0:
                warn(f'spell table marker missing in {fid}')
            else:
                desc = desc[:cut].rstrip()
        text = md(desc)
        if fid in ALWAYS_PREPARED:
            e['alwaysPrepared'] = ALWAYS_PREPARED[fid]
            if fid in SPELL_TABLE_CUT:
                title = _norm(Fsrc[fid]['name'])
                text += f'\n\n**{title}**\n\n' + spell_table_md(cls.title(), ALWAYS_PREPARED[fid], spell_names)
        if fid == 'land-circle-of-the-land-spells':
            log('subclasses: Circle of the Land level-3 spells: add Ray of Frost (polar), Shocking Grasp + Sleep '
                '(temperate) missing upstream (SRD 5.2 land tables)')
            for land, mp in LAND_SPELLS.items():
                text += f'\n\n**{land.title()} Land**\n\n' + spell_table_md('Druid', mp, spell_names)
        e['description'] = text
        ch = feature_choice(fid, cls, f['description'], class_skill.get(cls))
        if ch:
            e['choice'] = ch
        if fid == 'bard-magical-secrets':
            e['spellLists'] = ['bard', 'cleric', 'druid', 'wizard']
        if fid == 'monk-disciplined-survivor':
            e['grants'] = {'saves': ABILS}
        if fid == 'druid-druidic':
            e['grants'] = {'languages': ['druidic']}
        if fid == 'rogue-thieves-cant':
            e['grants'] = {'languages': ['thieves-cant']}
        for ids in e.get('alwaysPrepared', {}).values():
            for s in ids:
                if s not in spell_ids:
                    warn(f'{fid}: always-prepared spell {s} not in spells.json')
        return e

    for fid, f in Fsrc.items():
        if 'subclass' not in f:
            features[fid] = make_feature(fid)

    # --- subclasses ---------------------------------------------------------------
    subclasses = []
    for s in SC:
        sid = s['index']
        cls = ix(s['class'])
        src = {(_norm(f['name']), ix(f['level']) if isinstance(f.get('level'), dict) else None): k
               for k, f in Fsrc.items() if ix(f.get('subclass')) == sid}
        by_name = {}
        for (nm, _), k in src.items():
            by_name.setdefault(nm, []).append(k)
        feats = []
        for f in s['features']:
            nm = _norm(f['name'])
            ids = by_name.get(nm, [])
            if not ids:   # upstream sometimes glues the description onto the name
                ids = [k for n2, ks in by_name.items() if nm.startswith(n2 + ' ') for k in ks]
                nm = Fsrc[ids[0]]['name'] if len(ids) == 1 else nm
            if len(ids) != 1:
                warn(f'subclass {sid}: cannot map feature {nm!r} ({ids})')
                fid = f'{sid}-{slug(nm)}'
                fe = {'id': fid, 'name': nm, 'class': cls, 'subclass': sid, 'level': f['level'],
                      'description': md(f['description'])}
            else:
                fe = make_feature(ids[0], sid)
                if fe['level'] != f['level']:
                    warn(f'{ids[0]} level {fe["level"]} vs subclass list {f["level"]}')
                    fe['level'] = f['level']
            features[fe['id']] = fe
            feats.append({k: v for k, v in fe.items() if k not in ('class', 'subclass')})
        feats.sort(key=lambda x: x['level'])
        subclasses.append({'id': sid, 'name': s['name'], 'class': cls, 'summary': _norm(s['summary']),
                           'description': md(s['description']), 'features': feats})
    subclasses.sort(key=lambda x: (x['class'], x['name']))

    # placeholder for later "subclass feature" levels
    for c in C:
        cid = c['index']
        lvls = sorted(feat_levels.get(f'{cid}-subclass', []))
        if lvls:
            features[f'{cid}-subclass']['level'] = lvls[0]
            features[f'{cid}-subclass'].pop('levels', None)
            if len(lvls) > 1:
                features[f'{cid}-subclass-feature'] = {
                    'id': f'{cid}-subclass-feature', 'name': 'Subclass Feature', 'class': cid, 'subclass': None,
                    'level': lvls[1], 'levels': lvls[1:],
                    'description': f'You gain a feature from your {c["name"]} subclass.'}

    # --- classes --------------------------------------------------------------------
    weapons_by = {}
    classes = []
    for c in C:
        cid = c['index']
        prof = [ix(p) for p in c['proficiencies']]
        armor, weapons, tools = [], [], []
        for p in prof:
            if p == 'all-armor':
                armor += ['light', 'medium', 'heavy']
            elif p.endswith('-armor'):
                armor.append(p[:-6])
            elif p == 'shields':
                armor.append('shields')
            elif p in ('simple-weapons', 'martial-weapons'):
                weapons.append(p.split('-')[0])
            elif p.startswith('saving-throw-'):
                pass
            elif p.startswith('tool-'):
                tools.append(p[5:])
            elif p in ('longswords', 'rapiers', 'scimitars', 'shortswords', 'whips', 'hand-crossbows'):
                weapons.append(p[:-1])
            else:
                tools.append(p)
        weapons_note = None
        if cid == 'rogue':
            if 'longsword' in weapons:
                weapons.remove('longsword')
                log('classes: rogue weapon proficiency drop longsword (2024: Martial weapons with Finesse or Light)')
            weapons_note = 'Simple weapons and Martial weapons that have the Finesse or Light property'
        if cid == 'monk':
            weapons_note = 'Simple weapons and Martial weapons that have the Light property'
        pa = c['primary_ability']
        if 'ability_scores' in pa:
            primary = [ix(a) for a in pa['ability_scores']]
            mode = 'and' if len(primary) > 1 else None
        else:
            primary = [ix(o['item']) for o in pa['ability_score_options']['from']['options']]
            mode = 'or'
        sk = c['proficiency_choices'][0]
        skill_choices = {'choose': sk['choose'], 'from': [ix(o['item'])[6:] for o in sk['from']['options']]}
        tool_choices = None
        if len(c['proficiency_choices']) > 1:
            tc = c['proficiency_choices'][1]
            frm = []
            for o in tc['from']['options']:
                if o['option_type'] == 'reference':
                    frm.append(ix(o['item']))
                else:
                    frm += [ix(x['item']) for x in o['choice']['from']['options']]
            frm = [x[5:] if x.startswith('tool-') else x for x in frm]
            frm = ['cartographer-tools' if x == 'cartographers-tools' else x for x in frm]
            tool_choices = {'choose': tc['choose'], 'from': frm, 'text': _norm(tc['desc'])}
        mc = c['multi_classing']
        if mc.get('prerequisite_options'):
            mprereq = {'any': [{'ability': ix(o['ability_score']), 'min': o['minimum_score']}
                               for o in mc['prerequisite_options']['from']['options']]}
        else:
            mprereq = {'all': [{'ability': ix(o['ability_score']), 'min': o['minimum_score']}
                               for o in mc.get('prerequisites', [])]}
        mprof = {'armor': [], 'weapons': [], 'tools': []}
        for p in [ix(x) for x in mc.get('proficiencies', [])]:
            if p.endswith('-armor'):
                mprof['armor'].append(p[:-6])
            elif p == 'shields':
                mprof['armor'].append('shields')
            elif p.endswith('-weapons'):
                mprof['weapons'].append(p.split('-')[0])
            else:
                mprof['tools'].append(p[5:] if p.startswith('tool-') else p)
        for pc in mc.get('proficiency_choices', []):
            frm = [ix(o['item']) for o in pc['from']['options']]
            if frm and frm[0].startswith('skill-'):
                mprof['skills'] = {'choose': pc['choose'], 'from': [x[6:] for x in frm]}
            else:
                mprof['toolChoices'] = {'choose': pc['choose'], 'from': frm}
        # starting equipment
        se = c['starting_equipment_options'][0]
        se_text = _norm(se['desc'])
        se_opts = equipment_options(se['from']['options'], names)
        if cid == 'druid' and '; or (a) ' in se_text:
            se_text = se_text.replace('; or (a) ', '; or (b) ')
        if cid == 'bard' and not any(i.get('category') == 'musical-instruments' for i in se_opts[0]['items']):
            se_opts[0]['items'].insert(2, {'category': 'musical-instruments', 'qty': 1, 'name': 'Musical Instrument of your choice'})
            log('classes: bard starting equipment A add Musical Instrument choice')
        if cid == 'sorcerer':
            for it in se_opts[0]['items']:
                if it.get('id') == 'leather-armor':
                    it.update({'id': 'spear', 'name': 'Spear'})
                    log('classes: sorcerer starting equipment A leather-armor -> spear')
        if cid == 'monk':
            se_opts[0]['items'] = [dict(i, name="Artisan's Tools or Musical Instrument (the one chosen for your tool proficiency)",
                                        sameAsTool=True)
                                   if isinstance(i.get('category'), list) else i for i in se_opts[0]['items']]
        # spellcasting
        kind = CASTER_KIND.get(cid)
        spc = None
        if kind:
            spc = {'ability': ix(c['spellcasting']['spellcasting_ability']), 'kind': kind, 'prepared': True,
                   'list': cid, 'focus': SPELL_FOCUS[cid], 'changePrepared': CHANGE_PREPARED[cid],
                   'ritual': 'prepared'}
            notes = {
                'wizard': 'Spellbook: 6 level 1 Wizard spells at level 1, +2 per Wizard level (of levels you have slots for). '
                          'Prepare from the spellbook. Ritual Adept: cast Ritual spells from the spellbook without preparing them.',
                'warlock': 'Pact Magic: all slots share one level (pact.slotLevel) and recharge on a Short or Long Rest. '
                           'Mystic Arcanum gives one spell each of levels 6-9 at Warlock levels 11/13/15/17.',
                'bard': 'Magical Secrets (level 10): prepared spells may come from the Bard, Cleric, Druid and Wizard lists.',
                'paladin': 'No cantrips (Blessed Warrior fighting-style alternative grants two Cleric cantrips).',
                'ranger': 'No cantrips (Druidic Warrior fighting-style alternative grants two Druid cantrips).',
            }
            if cid in notes:
                spc['notes'] = notes[cid]
            if cid == 'wizard':
                spc['spellbook'] = {'start': 6, 'perLevel': 2}
                spc['ritual'] = 'spellbook'
        # levels
        clv = sorted([x for x in L if 'subclass' not in x and ix(x['class']) == cid], key=lambda x: x['level'])
        if len(clv) != 20:
            warn(f'class {cid} has {len(clv)} levels')
        levels = []
        seen_sub = False
        for x in clv:
            n = x['level']
            fl = []
            for f in x['features']:
                fid = ix(f)
                if fid == f'{cid}-subclass':
                    if seen_sub:
                        fid = f'{cid}-subclass-feature'
                    seen_sub = True
                fl.append(fid)
            counters = dict(x.get('class_specific') or {})
            if 'sneak_attack' in counters and isinstance(counters['sneak_attack'], dict):
                sa = counters['sneak_attack']
                counters['sneak_attack'] = f'{sa["dice_count"]}d{sa["dice_value"]}'
            if 'bardic_inspiration_die' in counters:
                counters['bardic_inspiration_die'] = f'd{counters["bardic_inspiration_die"]}'
            if 'martial_arts_die' in counters:
                counters['martial_arts_die'] = f'd{counters["martial_arts_die"]}'
            if cid in EXTRA_COUNTERS and EXTRA_COUNTERS[cid]:
                counters.update(EXTRA_COUNTERS[cid](n))
            if cid == 'paladin':
                counters['lay_on_hands_pool'] = 5 * n
            lvl = {'level': n, 'prof': x.get('prof_bonus') or PROF_BY_LEVEL[n - 1], 'features': fl, 'counters': counters}
            sc = x.get('spellcasting')
            if sc and kind:
                slots = [sc.get(f'spell_slots_level_{i}', 0) for i in range(1, 10)]
                if kind == 'pact':
                    k = max(i for i in range(9) if slots[i]) if any(slots) else 0
                    lvl['pact'] = {'slots': slots[k], 'slotLevel': k + 1}
                else:
                    lvl['slots'] = slots
                can = sc.get('cantrips_known', 0)
                prep = sc.get('prepared_spells', 0)
                if cid in FIX_CANTRIPS and FIX_CANTRIPS[cid][n - 1] != can:
                    log(f'classes: {cid} L{n} cantrips {can} -> {FIX_CANTRIPS[cid][n - 1]}')
                    can = FIX_CANTRIPS[cid][n - 1]
                if cid in FIX_PREPARED and FIX_PREPARED[cid][n - 1] != prep:
                    log(f'classes: {cid} L{n} prepared {prep} -> {FIX_PREPARED[cid][n - 1]}')
                    prep = FIX_PREPARED[cid][n - 1]
                lvl['cantrips'] = can
                lvl['preparedSpells'] = prep
            if lvl['prof'] != PROF_BY_LEVEL[n - 1]:
                warn(f'{cid} L{n} prof {lvl["prof"]}')
            levels.append(lvl)
        sub_levels = sorted(feat_levels.get(f'{cid}-subclass', []))
        classes.append({
            'id': cid, 'name': c['name'], 'hitDie': c['hit_die'],
            'primaryAbility': primary, 'primaryAbilityMode': mode,
            'saves': [ix(s) for s in c['saving_throws']],
            'proficiencies': {'armor': armor, 'weapons': weapons, 'tools': tools,
                              **({'weaponsNote': weapons_note} if weapons_note else {})},
            'skillChoices': skill_choices,
            **({'toolChoices': tool_choices} if tool_choices else {}),
            'startingEquipment': {'text': se_text, 'options': se_opts},
            'multiclass': {'prereq': mprereq, 'proficiencies': mprof},
            'spellcasting': spc,
            'subclassLevel': sub_levels[0] if sub_levels else 3,
            'subclassFeatureLevels': sub_levels,
            'subclasses': [ix(s) for s in c['subclasses']],
            'levels': levels,
        })
    classes.sort(key=lambda x: x['name'])
    # every level feature must exist
    for c in classes:
        for lv in c['levels']:
            for fid in lv['features']:
                if fid not in features:
                    warn(f'{c["id"]} L{lv["level"]}: unknown feature {fid}')
    return classes, features, subclasses


def roll_table(text):
    """Two-column d100 tables flattened upstream ("1d100 X 1d100 X 01-10 A 51-60 B ...") -> markdown table."""
    m = re.search(r'(\d*d\d+)\s+([A-Z][A-Za-z ]+?)\s+\1\s+\2\s+((?:\d{2}(?:[-–]\d{2})?\s+[A-Z][A-Za-z\' ]*?\s*)+)$', text)
    if not m:
        return text
    rows = re.findall(r'(\d{2}(?:[-–]\d{2})?)\s+([A-Z][A-Za-z\' ]*?)(?=\s+\d{2}|\s*$)', m.group(3))
    if len(rows) < 6:
        return text
    rows.sort(key=lambda r: int(r[0][:2]) if r[0][:2] != '00' else 100)
    table = '\n'.join([f'{m.group(1)} | {m.group(2).strip()}'] + [f'{a} | {b.strip()}' for a, b in rows])
    return text[:m.start()].rstrip() + '\n' + table


def build_magic_items():
    M = load('Magic-Items')
    RAR = {'common': 'common', 'uncommon': 'uncommon', 'rare': 'rare', 'very rare': 'very-rare',
           'legendary': 'legendary', 'artifact': 'artifact'}
    parent = {}
    for m in M:
        for v in m.get('variants') or []:
            parent[ix(v)] = m['index']
    out = []
    for m in M:
        desc = _norm(m['desc'])
        lines = desc.split('\n')
        typ = lines[0].strip()
        body = lines[1:]
        rt = _norm(m['rarity']['name'])
        if body and re.match(r'^(Common|Uncommon|Rare|Very Rare|Legendary)( \(\+\d\))?$', body[0].strip()):
            body = body[1:]
        r = rt.lower()
        rarity = RAR.get(r) or (RAR.get(re.sub(r'\s*\([^()]*\)$', '', r)) if ',' not in r else None) or 'varies'
        cat = slug(typ.split('(')[0].strip())
        e = {'id': m['index'], 'name': _norm(m['name']), 'category': cat, 'type': typ, 'rarity': rarity}
        if rarity == 'varies' or rt.lower() not in RAR:
            e['rarityText'] = rt
        att = bool(m.get('attunement'))
        e['attunement'] = att
        if m.get('limited-to'):
            e['attunementNote'] = 'by a ' + _norm(m['limited-to']) if att else _norm(m['limited-to'])
        if m['index'] in parent:
            e['variantOf'] = parent[m['index']]
        if m.get('variants'):
            e['variants'] = [ix(v) for v in m['variants']]
        text = '\n'.join(body)
        text = re.sub(r'(?<=[a-z)])\.(?=[A-Z][a-z])', '. ', text)          # "nonmagical.The" -> ". The"
        text = re.sub(r'\b(a|an)(?=\d)', r'\1 ', text)                       # "a10-foot"
        text = re.sub(r'(?<=\S)\s*•\s*', '\n• ', text)               # inline bullets
        text = roll_table(text)
        e['description'] = md(text)
        out.append(e)
    out.sort(key=lambda x: x['name'].lower())
    return out


# --------------------------------------------------------------------------------------
def dump_lines(path, data):
    """Compact JSON, one record per line (diff-friendly)."""
    enc = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':'))
    if isinstance(data, list):
        txt = '[\n' + ',\n'.join(enc(x) for x in data) + '\n]\n'
    else:
        txt = '{\n' + ',\n'.join(f'{enc(k)}:{enc(v)}' for k, v in data.items()) + '\n}\n'
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(txt)
    return len(txt.encode('utf-8'))


def dump_pretty(path, data):
    txt = json.dumps(data, ensure_ascii=False, indent=1) + '\n'
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(txt)
    return len(txt.encode('utf-8'))


def main():
    global SRC
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src', help='5e-database src/2024/en directory')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'srd'))
    a = ap.parse_args()
    SRC = a.src
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)

    rules = build_rules()
    weapons, armor, gear, names = build_equipment()
    spells = build_spells()
    spell_ids = {s['id'] for s in spells}
    spell_names = {s['id']: s['name'] for s in spells}
    feats = build_feats()
    backgrounds = build_backgrounds(names)
    species = build_species(spell_ids)
    classes, features, subclasses = build_classes({s['id'] for s in rules['skills']}, names, spell_names, spell_ids)
    magic = build_magic_items()

    files = [
        ('classes.json', classes, dump_lines), ('features.json', features, dump_lines),
        ('subclasses.json', subclasses, dump_lines), ('species.json', species, dump_lines),
        ('backgrounds.json', backgrounds, dump_lines), ('feats.json', feats, dump_lines),
        ('spells.json', spells, dump_lines), ('weapons.json', weapons, dump_lines),
        ('armor.json', armor, dump_lines), ('gear.json', gear, dump_lines),
        ('magic-items.json', magic, dump_lines), ('rules.json', rules, dump_pretty),
    ]
    total = 0
    print(f'Writing to {out}')
    for fn, data, dumper in files:
        size = dumper(os.path.join(out, fn), data)
        total += size
        n = len(data) if not isinstance(data, dict) or fn != 'rules.json' else len(data)
        print(f'  {fn:18s} {n:4d} entries  {size / 1024:7.1f} KB')
    print(f'  total {total / 1024:.1f} KB')

    # ---- spot checks ----------------------------------------------------------------
    cl = {c['id']: c for c in classes}

    def levels_with(cid, fid):
        return [lv['level'] for lv in cl[cid]['levels'] if fid in lv['features']]
    checks = [
        ('Fighter ASI levels', levels_with('fighter', 'fighter-ability-score-improvement'), [4, 6, 8, 12, 14, 16]),
        ('Fighter Epic Boon', levels_with('fighter', 'fighter-epic-boon'), [19]),
        ('Wizard L5 slots', cl['wizard']['levels'][4]['slots'][:3], [4, 3, 2]),
        ('Warlock L5 pact', cl['warlock']['levels'][4].get('pact'), {'slots': 2, 'slotLevel': 3}),
        ('Warlock kind', cl['warlock']['spellcasting']['kind'], 'pact'),
        ('Rogue Expertise', levels_with('rogue', 'rogue-expertise'), [1, 6]),
        ('Weapons total', len(weapons), 38),
        ('Musket+Pistol', sorted(w['id'] for w in weapons if w['id'] in ('musket', 'pistol')), ['musket', 'pistol']),
        ('Classes x20 levels', all(len(c['levels']) == 20 for c in classes), True),
        ('Paladin L1 slots', cl['paladin']['levels'][0]['slots'][0], 2),
    ]
    print('Spot checks:')
    bad = 0
    for name, got, exp in checks:
        ok = got == exp
        bad += not ok
        print(f'  [{"ok" if ok else "FAIL"}] {name}: {got}')
    n_choice = sum(1 for f in features.values() if f.get('choice'))
    print(f'Features: {len(features)} ({n_choice} with choice objects); subclasses: {len(subclasses)}; '
          f'spells: {len(spells)}; magic items: {len(magic)}; gear: {len(gear)}; armor: {len(armor)}')
    if LOG:
        print(f'Data fixes applied ({len(LOG)}):')
        for m in LOG:
            print('  - ' + m)
    if WARN:
        print(f'Warnings ({len(WARN)}):')
        for m in WARN:
            print('  ! ' + m)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
