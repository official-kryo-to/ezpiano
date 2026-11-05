# Models

| File | What | License |
|---|---|---|
| `kong-piano-int8.onnx` (20.8 MB) | ByteDance high-resolution piano transcription, note model (Kong et al., 2021), exported with `scripts/export_model.py`: STFT kernels computed in-graph, weights int8 per channel (weight-only) | Weights: CC BY 4.0 ([Zenodo 4034264](https://zenodo.org/records/4034264)). Model code: MIT ([piano_transcription_inference](https://github.com/qiuqiangkong/piano_transcription_inference)) |
| `basic-pitch/` | Spotify Basic Pitch (TensorFlow.js), used for non-piano audio | Apache-2.0, see `basic-pitch/LICENSE.txt` |

Q. Kong, B. Li, X. Song, Y. Wan, Y. Wang. *High-resolution Piano Transcription with Pedals by Regressing Onset and Offset Times.* IEEE/ACM TASLP, 2021.
