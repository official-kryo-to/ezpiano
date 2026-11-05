"""Extract 40 s excerpts from POP909 (MIT, github.com/music-x-lab/POP909-Dataset) as ground truth:
notes by track (MELODY / BRIDGE / PIANO), beats, downbeats and chords -> <out>/popNNN.json.

    python scripts/devset/prep_pop909.py <POP909/POP909 dir> <out dir> 003,027,051,...
"""
import json, sys, os
import mido

root, out = sys.argv[1], sys.argv[2]
ids = sys.argv[3].split(',')
DUR = 40.0

def notes_of(path):
    mid = mido.MidiFile(path)
    res = []
    for ti, tr in enumerate(mid.tracks):
        name = tr.name.strip()
        if name not in ('MELODY', 'BRIDGE', 'PIANO'):
            continue
        merged = mido.merge_tracks([mid.tracks[0], tr]) if ti != 0 else tr
        t = 0.0; tempo = 500000; active = {}
        for msg in merged:
            t += mido.tick2second(msg.time, mid.ticks_per_beat, tempo)
            if msg.type == 'set_tempo':
                tempo = msg.tempo
            elif msg.type == 'note_on' and msg.velocity > 0:
                active[msg.note] = (t, msg.velocity)
            elif msg.type in ('note_off', 'note_on') and msg.note in active:
                s, v = active.pop(msg.note)
                if t > s:
                    res.append({'pitch': msg.note, 'start': s, 'end': t, 'velocity': v, 'track': name})
    return res

for sid in ids:
    d = os.path.join(root, sid)
    notes = notes_of(os.path.join(d, sid + '.mid'))
    beats = [list(map(float, l.split())) for l in open(os.path.join(d, 'beat_midi.txt')) if l.strip()]
    chords = [l.rstrip('\n').split('\t') for l in open(os.path.join(d, 'chord_midi.txt')) if l.strip()]
    downs = [b[0] for b in beats if b[2] == 1.0]
    start = next((x for x in downs if x >= 8.0), downs[0])
    end = start + DUR
    sel = [dict(n, start=n['start'] - start, end=min(n['end'], end) - start, end_pedal=min(n['end'], end) - start) for n in notes if start <= n['start'] < end]
    clip = {
        'id': sid,
        'notes': sorted(sel, key=lambda n: (n['start'], n['pitch'])),
        'beats': [b[0] - start for b in beats if start - 0.01 <= b[0] < end],
        'downbeats': [b[0] - start for b in beats if start - 0.01 <= b[0] < end and b[2] == 1.0],
        'chords': [[float(c[0]) - start, float(c[1]) - start, c[2]] for c in chords if float(c[1]) > start and float(c[0]) < end],
    }
    json.dump(clip, open(os.path.join(out, f'pop{sid}.json'), 'w'))
    ibi = clip['beats'][1] - clip['beats'][0] if len(clip['beats']) > 1 else 0
    print(sid, 'notes', len(sel), 'melody', sum(n['track'] == 'MELODY' for n in sel), 'bpm', round(60 / ibi, 1) if ibi else '?', 'chords', len(clip['chords']))
