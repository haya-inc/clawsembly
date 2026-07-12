const STATUS_COLORS = {
  probing: "#67b7ff",
  supported: "#b8ff3d",
  partial: "#f6c85f",
  unsupported: "#ff685f"
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderCompatibilityBadge({ version, status }) {
  const color = STATUS_COLORS[status];
  if (!color) throw new Error(`Unsupported badge status: ${status}`);
  const safeVersion = escapeXml(version);
  const safeStatus = escapeXml(status);
  const label = `OpenClaw ${safeVersion}`;
  const aria = escapeXml(`OpenClaw ${version} compatibility: ${status}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="286" height="28" role="img" aria-label="${aria}">
  <title>${aria}</title>
  <clipPath id="r"><rect width="286" height="28" rx="2"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="204" height="28" fill="#151713"/>
    <rect x="204" width="82" height="28" fill="${color}"/>
  </g>
  <g fill="#f2f3ed" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="11" text-anchor="middle">
    <text x="102" y="18">${label}</text>
    <text x="245" y="18" fill="#0a0b09">${safeStatus}</text>
  </g>
</svg>
`;
}
