"""
Export the ByteDance "High-resolution Piano Transcription" note model (Kong et al., 2021)
to ONNX for in-browser inference with onnxruntime-web.

What this does
  1. Downloads the official checkpoint from Zenodo (record 4034264, CC BY 4.0) if missing.
  2. Builds the note model from `piano_transcription_inference` (MIT) and loads the weights.
     The pedal model is not exported (ezpiano does not use pedal events).
  3. Exports with a dynamic batch axis and a fixed 10 s (160000 sample) input.
  4. Replaces the 2 x 2.1M-parameter DFT conv kernels of the STFT with a tiny subgraph that
     computes them at load time (ONNX Range/Mod/Cos/Sin, constant-folded by onnxruntime).
  5. Quantizes large weights to int8, per output channel, weight-only (DequantizeLinear in front
     of each weight). Activations stay float32, so accuracy matches fp32 within noise.
  6. Checks the quantized model against PyTorch on random and real audio.

Usage
  python -m venv .venv && . .venv/bin/activate
  pip install torch --index-url https://download.pytorch.org/whl/cpu
  pip install onnx onnxruntime torchlibrosa librosa numpy
  pip install --no-deps piano_transcription_inference
  python scripts/export_model.py [--checkpoint path.pth] [--out public/models/kong-piano-int8.onnx]
"""

from __future__ import annotations

import argparse
import math
import os
import urllib.request

import numpy as np
import onnx
import torch
import torch.nn as nn
from onnx import helper, numpy_helper

CKPT_URL = (
    "https://zenodo.org/api/records/4034264/files/"
    "CRNN_note_F1=0.9677_pedal_F1=0.9186.pth/content"
)
SAMPLE_RATE = 16000
SEGMENT = SAMPLE_RATE * 10
N_FFT = 2048
HOP = 160
OUT_NAMES = ["reg_onset_output", "reg_offset_output", "frame_output", "velocity_output"]


class NoteModel(nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, audio):
        out = self.inner(audio)
        return tuple(out[k] for k in OUT_NAMES)


def build_model(ckpt_path: str):
    from piano_transcription_inference.models import Regress_onset_offset_frame_velocity_CRNN

    model = Regress_onset_offset_frame_velocity_CRNN(frames_per_second=100, classes_num=88)
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    state = ckpt["model"]
    # the official checkpoint nests the two sub-models: {"model": {"note_model": ..., "pedal_model": ...}}
    note_state = state["note_model"] if "note_model" in state else {
        k[len("note_model."):]: v for k, v in state.items() if k.startswith("note_model.")
    }
    missing, unexpected = model.load_state_dict(note_state, strict=False)
    assert not unexpected, unexpected
    assert all("conv_real" in m or "conv_imag" in m or "melW" in m for m in missing), missing
    model.eval()
    return model


def export(model, path: str):
    dummy = torch.zeros(1, SEGMENT)
    torch.onnx.export(
        NoteModel(model),
        (dummy,),
        path,
        input_names=["audio"],
        output_names=OUT_NAMES,
        dynamic_axes={"audio": {0: "batch"}, **{k: {0: "batch"} for k in OUT_NAMES}},
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )


def replace_dft_kernels(path: str):
    """Swap the two (1025, 1, 2048) STFT conv kernels for a subgraph that computes them.

    real[k, t] = cos(2*pi*((k*t) mod N)/N) * hann[t],  imag = -sin(...) * hann[t]
    (k*t) is reduced modulo N in int64 before the cos/sin, so the result is exact to float32.
    onnxruntime constant-folds this once when the session is created.
    """
    m = onnx.load(path)
    g = m.graph
    n = N_FFT
    bins = n // 2 + 1
    targets = [i for i in g.initializer if list(i.dims) == [bins, 1, n]]
    assert len(targets) == 2, [list(i.dims) for i in targets]
    conv_of = {}
    for node in g.node:
        if node.op_type == "Conv":
            for t in targets:
                if node.input[1] == t.name:
                    conv_of[t.name] = node
    # decide which kernel is real (cos: first tap of bin 0 is window[0]=0, use bin 1 tap 1 sign)
    arrs = {t.name: numpy_helper.to_array(t) for t in targets}
    real_name = next(k for k, a in arrs.items() if a[1, 0, n // 4] < 1e-3 and abs(a[0, 0, n // 2]) > 0.5)
    imag_name = next(k for k in arrs if k != real_name)

    c = lambda name, arr: numpy_helper.from_array(np.array(arr), name)
    g.initializer.extend(
        [
            c("dft_zero", np.array(0, dtype=np.int64)),
            c("dft_one", np.array(1, dtype=np.int64)),
            c("dft_bins", np.array(bins, dtype=np.int64)),
            c("dft_n", np.array(n, dtype=np.int64)),
            c("dft_step", np.array(2.0 * math.pi / n, dtype=np.float32)),
            c("dft_half", np.array(0.5, dtype=np.float32)),
            c("dft_ax0", np.array([0], dtype=np.int64)),
            c("dft_ax1", np.array([1], dtype=np.int64)),
        ]
    )
    mk = helper.make_node
    nodes = [
        mk("Range", ["dft_zero", "dft_bins", "dft_one"], ["dft_k"]),
        mk("Range", ["dft_zero", "dft_n", "dft_one"], ["dft_t"]),
        mk("Unsqueeze", ["dft_k", "dft_ax1"], ["dft_k2"]),
        mk("Unsqueeze", ["dft_t", "dft_ax0"], ["dft_t2"]),
        mk("Mul", ["dft_k2", "dft_t2"], ["dft_kt"]),
        mk("Mod", ["dft_kt", "dft_n"], ["dft_ktm"]),
        mk("Cast", ["dft_ktm"], ["dft_ktf"], to=onnx.TensorProto.FLOAT),
        mk("Mul", ["dft_ktf", "dft_step"], ["dft_phase"]),
        mk("Cast", ["dft_t"], ["dft_tf"], to=onnx.TensorProto.FLOAT),
        mk("Mul", ["dft_tf", "dft_step"], ["dft_wphase"]),
        mk("Cos", ["dft_wphase"], ["dft_wcos"]),
        mk("Mul", ["dft_wcos", "dft_half"], ["dft_whalf"]),
        mk("Sub", ["dft_half", "dft_whalf"], ["dft_window"]),
        mk("Cos", ["dft_phase"], ["dft_cos"]),
        mk("Sin", ["dft_phase"], ["dft_sin"]),
        mk("Neg", ["dft_sin"], ["dft_nsin"]),
        mk("Mul", ["dft_cos", "dft_window"], ["dft_re2"]),
        mk("Mul", ["dft_nsin", "dft_window"], ["dft_im2"]),
        mk("Unsqueeze", ["dft_re2", "dft_ax1"], [real_name]),
        mk("Unsqueeze", ["dft_im2", "dft_ax1"], [imag_name]),
    ]
    for t in targets:
        g.initializer.remove(t)
    existing = list(g.node)
    del g.node[:]
    g.node.extend(nodes + existing)
    onnx.checker.check_model(m)
    onnx.save(m, path)
    print("replaced DFT kernels with a generator subgraph")


# Which input of each op holds a weight, and which axis is the output channel.
WEIGHT_INPUTS = {
    "Conv": {1: 0},
    "MatMul": {1: 1},
    "Gemm": {1: 0},  # torch exports Linear as Gemm with transB=1, so B is (out, in)
    "GRU": {1: 1, 2: 1},  # W/R are (dirs, 3*hidden, in): quantize per gate row
}


def quantize_weights(src: str, dst: str, min_elems: int = 4096):
    m = onnx.load(src)
    g = m.graph
    inits = {i.name: i for i in g.initializer}
    consumers: dict[str, list] = {}
    for node in g.node:
        for idx, name in enumerate(node.input):
            consumers.setdefault(name, []).append((node, idx))

    new_nodes, done = [], 0
    for name, init in list(inits.items()):
        arr = numpy_helper.to_array(init)
        if arr.dtype != np.float32 or arr.size < min_elems:
            continue
        uses = consumers.get(name, [])
        axes = {WEIGHT_INPUTS.get(n.op_type, {}).get(i) for n, i in uses}
        if not uses or None in axes or len(axes) != 1:
            continue
        axis = axes.pop()
        if arr.ndim == 2 and uses[0][0].op_type == "Gemm":
            trans_b = next((a.i for a in uses[0][0].attribute if a.name == "transB"), 0)
            axis = 0 if trans_b else 1
        moved = np.moveaxis(arr, axis, 0).reshape(arr.shape[axis], -1)
        scale = np.abs(moved).max(axis=1) / 127.0
        scale[scale == 0] = 1.0
        shape = [1] * arr.ndim
        shape[axis] = -1
        q = np.clip(np.round(arr / scale.reshape(shape)), -127, 127).astype(np.int8)
        g.initializer.remove(init)
        g.initializer.extend(
            [
                numpy_helper.from_array(q, name + "_q"),
                numpy_helper.from_array(scale.astype(np.float32), name + "_scale"),
                numpy_helper.from_array(np.zeros_like(scale, dtype=np.int8), name + "_zp"),
            ]
        )
        new_nodes.append(
            helper.make_node("DequantizeLinear", [name + "_q", name + "_scale", name + "_zp"], [name], axis=axis, name=name + "_dq")
        )
        done += 1
    # DequantizeLinear outputs must come before their consumers (topological order)
    nodes = list(g.node)
    del g.node[:]
    g.node.extend(new_nodes + nodes)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print(f"quantized {done} weight tensors")


def compare(model, onnx_path: str, audio: np.ndarray, label: str):
    import onnxruntime as ort

    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    x = audio[None, :SEGMENT].astype(np.float32)
    with torch.no_grad():
        ref = NoteModel(model)(torch.from_numpy(x))
    got = sess.run(OUT_NAMES, {"audio": x})
    for name, r, o in zip(OUT_NAMES, ref, got):
        diff = np.abs(r.numpy() - o)
        print(f"  [{label}] {name:18s} max {diff.max():.4f}  mean {diff.mean():.6f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="CRNN_note_F1=0.9677_pedal_F1=0.9186.pth")
    ap.add_argument("--out", default="public/models/kong-piano-int8.onnx")
    ap.add_argument("--check-audio", help="optional real audio file for the parity check")
    args = ap.parse_args()

    if not os.path.exists(args.checkpoint):
        print("downloading checkpoint (172 MB) ...")
        urllib.request.urlretrieve(CKPT_URL, args.checkpoint)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    fp32 = args.out.replace(".onnx", ".fp32.onnx")
    export(build_model(args.checkpoint), fp32)
    replace_dft_kernels(fp32)
    quantize_weights(fp32, args.out)
    # torch.onnx.export mutates the module it traces, so compare against a fresh copy
    model = build_model(args.checkpoint)
    for p in (fp32, args.out):
        print(f"{p}: {os.path.getsize(p) / 1e6:.1f} MB")

    rng = np.random.default_rng(0)
    compare(model, args.out, (rng.standard_normal(SEGMENT) * 0.1).astype(np.float32), "noise")
    if args.check_audio:
        import librosa

        audio, _ = librosa.load(args.check_audio, sr=SAMPLE_RATE, mono=True)
        audio = np.pad(audio, (0, max(0, SEGMENT - len(audio))))
        compare(model, args.out, audio, "audio")
    if not os.environ.get("KEEP_FP32"):
        os.remove(fp32)


if __name__ == "__main__":
    main()
