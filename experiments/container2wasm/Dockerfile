FROM --platform=linux/amd64 node:22.19.0-bookworm-slim@sha256:cff78eb5aa1cf27dc2b6aeea9d31366415a43e9a9ea0ddec00d780b2b66fad0f

RUN node --version \
  && node -e 'console.log(JSON.stringify({arch: process.arch, platform: process.platform, versions: process.versions}))'

ENTRYPOINT ["node"]
CMD ["--version"]
