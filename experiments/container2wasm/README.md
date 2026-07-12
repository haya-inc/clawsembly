# container2wasm Node 22 feasibility probe

This experiment asks one narrow question: can an official Linux x86-64 Node
22.19 image become a browser-runnable artifact without a remote sandbox?

It is not the production runtime and generated Wasm files must not be committed.
The converter describes itself as experimental, and its generated image bundles
third-party components with licenses beyond the converter's Apache-2.0 license.
An SBOM, notices, corresponding-source obligations, cold-start budget, and
browser execution evidence are release gates.

The first clean converter build is intentionally measured rather than hidden.
It compiles runc, GRUB, a Linux 6.1 kernel, Bochs, wasi-vfs, Wizer, and Binaryen
before packaging the guest; this is a heavyweight artifact pipeline even when
the final browser payload later meets its budget.

## 2026-07-12 result

The pinned Node 22.19.0 amd64 image converted successfully with container2wasm
v0.8.4, but the generated module did not reach a guest command. This is a
conversion pass and a runtime-boot failure, not browser compatibility evidence.

| Probe | Result |
| --- | --- |
| Clean conversion | 1,625.84 s |
| `node22.wasm` size | 316,700,841 bytes (316.7 MB decimal) |
| `node22.wasm` SHA-256 | `a340e43fb65a784991cbd5c7f09e6c1dbebe611396a62e8b16d0e5a7004c9425` |
| Wasmtime | v33.0.2, macOS arm64 host |
| Guest commands | `node --version`, absolute Node path, shell, and no-argument runs all exited 1 without guest stdout |
| 512 MB debug rebuild | Linux reached the OCI root mount while Wizer created the snapshot; the final 322,635,807-byte module still exited 1 before running `node --version` |
| Browser `--to-js` run | Not attempted because the host feasibility gate failed |

The debug module SHA-256 was
`4a74da452cac52d1b917cd3454b640cfb0bb9bb8ea3971e8498e4e2d56266cf9`.
Its cache-assisted rebuild took 639.57 s and is not comparable with the clean
conversion time. Neither generated artifact is committed.

The next experiment must first make a minimal guest command succeed from the
same pinned converter revision. Only then is a Chromium `--to-js` build worth
its transfer-size, cold-start, persistence, and license-compliance cost.

## Reproduce

Build the exact amd64 source image:

```bash
docker buildx build --platform linux/amd64 \
  --load \
  --tag clawsembly-node22-c2w-probe:local \
  experiments/container2wasm
docker run --rm --platform linux/amd64 clawsembly-node22-c2w-probe:local
```

Build `c2w` from the official `v0.8.4` tag, then convert the image. The v0.8.4
embedded Dockerfile still points at the project's former GitHub location, so
the current repository must be supplied explicitly:

```bash
c2w \
  --target-arch=amd64 \
  --build-arg SOURCE_REPO=https://github.com/container2wasm/container2wasm \
  --build-arg SOURCE_REPO_VERSION=v0.8.4 \
  clawsembly-node22-c2w-probe:local \
  node22.wasm
```

For a browser artifact, repeat with `--to-js`. Record all of the following
before moving this candidate out of the experiment lane:

- converter commit and every embedded component revision;
- compressed and uncompressed transfer size;
- Node version output from Chromium, not only Wasmtime;
- cold boot and warm restore time on representative hardware;
- IndexedDB/OPFS persistence and corruption recovery;
- provider-broker networking without placing credentials in the guest;
- OpenClaw Gateway handshake, turn, tool, history, and cancellation evidence;
- complete license notices, SBOM, and source-redistribution procedure.
