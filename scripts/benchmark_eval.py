"""Score benchmark output with mir_eval (the standard for transcription papers).

    python scripts/benchmark_eval.py <clips-dir> <out-dir>

Reports note onset F1 (50 ms tolerance) and onset+offset F1 (offset within 20% of the note or
50 ms, reference offsets extended by the sustain pedal, as in the MAESTRO papers).
"""
import json, os, sys
import numpy as np
import mir_eval

clips_dir, out_dir = sys.argv[1], sys.argv[2]
timing = json.load(open(os.path.join(out_dir, 'timing.json')))
systems = list(timing.keys())
clips = sorted(f[:-5] for f in os.listdir(os.path.join(out_dir, systems[0])) if f.endswith('.json'))

def arrays(notes, end_key='end'):
    if not notes:
        return np.zeros((0, 2)), np.zeros(0)
    iv = np.array([[n['start'], max(n[end_key], n['start'] + 0.01)] for n in notes])
    p = np.array([mir_eval.util.midi_to_hz(n['pitch']) for n in notes])
    return iv, p

rows = []
for clip in clips:
    ref = json.load(open(os.path.join(clips_dir, clip + '.notes.json')))
    ri, rp = arrays(ref, 'end_pedal')
    for s in systems:
        est = json.load(open(os.path.join(out_dir, s, clip + '.json')))
        ei, ep = arrays(est)
        p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, offset_ratio=None)
        _, _, f2, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep)
        rows.append((clip, s, p, r, f, f2, timing[s][clip]))

print('| Clip | System | Onset P | Onset R | **Onset F1** | Onset+offset F1 | Time (s) |')
print('|---|---|---|---|---|---|---|')
for clip, s, p, r, f, f2, t in rows:
    print(f'| {clip} | {s} | {p:.3f} | {r:.3f} | **{f:.3f}** | {f2:.3f} | {t:.1f} |')
print()
print('| System | Mean onset F1 | Mean onset+offset F1 |')
print('|---|---|---|')
for s in systems:
    fs = [r for r in rows if r[1] == s]
    print(f'| {s} | {np.mean([r[4] for r in fs]):.3f} | {np.mean([r[5] for r in fs]):.3f} |')
