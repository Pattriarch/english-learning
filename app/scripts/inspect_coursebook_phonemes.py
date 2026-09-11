"""Optional private phoneme recognition for ambiguous textbook recording clips.

This inspects supplied source audio only. It is not learner pronunciation
scoring and supplies no automatic gold transcript or exercise answer key.
Use an isolated runtime with torch==2.8.0, transformers==4.57.1, scipy, soundfile.
"""
from __future__ import annotations
import argparse
import hashlib
import itertools
import json
import math
from pathlib import Path
import urllib.request

from prepare_coursebook_audio import APP, OUT, atomic_json, read_json, recording_source

REPOSITORY = "facebook/wav2vec2-lv-60-espeak-cv-ft"
REVISION = "fdf22f0210322b799533bc499dd3e489a9452bdc"
WEIGHTS_SHA = "3173bde9e9ce490fa0f989e413c42f25bc1820c020adc1e6b9b87025b3cfcc5e"
MODEL = OUT / "phoneme-model"


def file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download():
    MODEL.mkdir(parents=True, exist_ok=True)
    entries = []
    for name in ["config.json", "preprocessor_config.json", "vocab.json", "tokenizer_config.json", "special_tokens_map.json", "pytorch_model.bin"]:
        path = MODEL / name
        url = f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}"
        if not path.exists():
            temporary = path.with_suffix(path.suffix + ".download")
            offset = temporary.stat().st_size if temporary.exists() else 0
            request = urllib.request.Request(url, headers={"Range": f"bytes={offset}-"} if offset else {})
            with urllib.request.urlopen(request, timeout=180) as response:
                append = offset > 0 and response.status == 206
                with temporary.open("ab" if append else "wb") as stream:
                    size = offset if append else 0
                    next_report = (size // (100 << 20) + 1) * (100 << 20)
                    while chunk := response.read(1 << 20):
                        stream.write(chunk)
                        size += len(chunk)
                        if size >= next_report:
                            print(json.dumps({"download": name, "bytes": size}), flush=True)
                            next_report += 100 << 20
            if name == "pytorch_model.bin" and file_sha(temporary) != WEIGHTS_SHA:
                raise ValueError("Phoneme model differs from its official pinned SHA256")
            temporary.replace(path)
        digest = file_sha(path)
        if name == "pytorch_model.bin" and digest != WEIGHTS_SHA:
            raise ValueError("Phoneme model source changed")
        entries.append({"name": name, "url": url, "bytes": path.stat().st_size, "sha256": digest})
    atomic_json(MODEL / "receipt.json", {"repository": REPOSITORY, "revision": REVISION, "files": entries,
                "scope": "Optional private source phoneme recognition, not learner assessment"})
    print(json.dumps({"model": REPOSITORY, "verified": True}), flush=True)


def inspect(specification):
    import numpy as np
    import soundfile as sf
    from scipy.signal import resample_poly
    import torch
    from transformers import AutoModelForCTC, Wav2Vec2FeatureExtractor

    if file_sha(MODEL / "pytorch_model.bin") != WEIGHTS_SHA:
        raise ValueError("Phoneme model source changed")
    torch.set_num_threads(6)
    extractor = Wav2Vec2FeatureExtractor.from_pretrained(str(MODEL), local_files_only=True)
    model = AutoModelForCTC.from_pretrained(str(MODEL), local_files_only=True, trust_remote_code=False, weights_only=True).eval()
    vocab = {value: key for key, value in read_json(MODEL / "vocab.json").items()}
    blank = model.config.pad_token_id
    registry = {r["track"]: r for r in read_json(APP / "content/book-recordings.json")["recordings"]}
    for track in specification["tracks"]:
        recording = registry[track["track"]]
        source, _ = recording_source(recording)
        waveform, rate = sf.read(source, dtype="float32", always_2d=True)
        waveform = waveform.mean(axis=1)
        segments = []
        for item in track["segments"]:
            start, duration = item["offsetMs"], item["durationMs"]
            if not 0 <= start < len(waveform) / rate * 1000 or not 300 <= duration <= 15000:
                raise ValueError("Invalid phoneme recognition crop")
            clip = waveform[round(start * rate / 1000):round((start + duration) * rate / 1000)]
            divisor = math.gcd(rate, 16000)
            resampled = resample_poly(clip, 16000 // divisor, rate // divisor).astype(np.float32)
            inputs = extractor(resampled, sampling_rate=16000, return_tensors="pt")
            with torch.inference_mode():
                logits = model(**inputs).logits[0]
            prediction = logits.argmax(dim=-1).tolist()
            collapsed = [token for token, _ in itertools.groupby(prediction) if token != blank]
            phones = [vocab[token] for token in collapsed if not vocab[token].startswith("<")]
            segments.append({**item, "inputSampleRate": 16000, "inputSamples": len(resampled),
                             "inputSHA256": hashlib.sha256(resampled.tobytes()).hexdigest(), "phonemes": " ".join(phones), "ctcIDs": collapsed})
            print(json.dumps({"track": recording["track"], "label": item["label"], "phonemes": " ".join(phones)}, ensure_ascii=False), flush=True)
        atomic_json(OUT / "phoneme-asr" / f"{recording['track']:03d}.json",
                    {"track": recording["track"], "unitId": recording["unitId"], "task": recording["task"], "pages": track["pages"],
                     "audioSha256": recording["sha256"], "model": REPOSITORY, "revision": REVISION, "modelSha256": WEIGHTS_SHA,
                     "method": "Local unconstrained CTC phoneme labels for exact original source clips; no word list or expected answer",
                     "limitations": ["Phoneme recognition can be wrong; not an independent human verification or a pronunciation quality score."], "segments": segments})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--spec", type=Path)
    options = parser.parse_args()
    if options.download:
        download()
    if options.spec:
        inspect(read_json(options.spec))


if __name__ == "__main__":
    main()
