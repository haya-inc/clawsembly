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
