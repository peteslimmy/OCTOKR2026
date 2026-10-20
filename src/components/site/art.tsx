/**
 * The built-in picture for the landing page: a stylised dashboard drawn in flat colours that follow the brand colour. It is shown until an
 * administrator uploads an image of their own, so the page is never empty.
 */
export function DashboardArt({ className }: { className?: string }) {
  const brand = "var(--brand-700)", soft = "var(--brand-100)", mid = "var(--brand-600)";
  return (
    <svg viewBox="0 0 640 440" role="img" aria-label="Illustration of a dashboard with figures, a bar chart and a trend line" className={className}>
      <rect x="8" y="8" width="624" height="424" rx="22" fill="#ffffff" stroke="#e1e4e8" strokeWidth="2" />
      <rect x="8" y="8" width="624" height="46" rx="22" fill="#f6f7f9" />
      <rect x="8" y="36" width="624" height="18" fill="#f6f7f9" />
      <circle cx="40" cy="31" r="6" fill="#fca5a5" /><circle cx="60" cy="31" r="6" fill="#fcd34d" /><circle cx="80" cy="31" r="6" fill="#86efac" />
      <rect x="120" y="22" width="220" height="18" rx="9" fill="#e5e7eb" />
      <rect x="8" y="54" width="120" height="378" fill="#fbfbfc" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="24" y={76 + i * 34} width={i === 0 ? 88 : 72} height="14" rx="7" fill={i === 0 ? soft : "#e5e7eb"} />)}
      <rect x="24" y="76" width="6" height="14" rx="3" fill={brand} />
      {[0, 1, 2].map((i) => (
        <g key={i} transform={`translate(${148 + i * 160} 74)`}>
          <rect width="148" height="86" rx="14" fill="#ffffff" stroke="#e1e4e8" strokeWidth="2" />
          <rect x="14" y="14" width="26" height="26" rx="8" fill={[brand, "#16a34a", "#2563eb"][i]} />
          <rect x="94" y="18" width="40" height="18" rx="9" fill={[soft, "#dcfce7", "#dbeafe"][i]} />
          <rect x="14" y="52" width="70" height="12" rx="6" fill="#17191c" opacity="0.85" />
          <rect x="14" y="70" width="46" height="7" rx="3.5" fill="#cbd5e1" />
        </g>
      ))}
      <g transform="translate(148 178)">
        <rect width="304" height="234" rx="14" fill="#ffffff" stroke="#e1e4e8" strokeWidth="2" />
        <rect x="18" y="18" width="90" height="12" rx="6" fill="#17191c" opacity="0.85" />
        {[0, 1, 2, 3].map((i) => <line key={i} x1="18" x2="286" y1={64 + i * 40} y2={64 + i * 40} stroke="#eef0f3" strokeWidth="2" />)}
        <path d="M18 176 C60 130 84 190 128 140 S200 92 240 112 S272 80 286 66" fill="none" stroke={brand} strokeWidth="4" strokeLinecap="round" />
        <path d="M18 196 C60 170 90 200 130 172 S210 140 250 150 S274 128 286 120" fill="none" stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
        {[[18, 176], [128, 140], [240, 112], [286, 66]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="6" fill={brand} stroke="#fff" strokeWidth="2.5" />)}
      </g>
      <g transform="translate(468 178)">
        <rect width="148" height="234" rx="14" fill="#ffffff" stroke="#e1e4e8" strokeWidth="2" />
        <rect x="16" y="18" width="70" height="12" rx="6" fill="#17191c" opacity="0.85" />
        {[0.9, 0.62, 0.78, 0.4, 0.55].map((v, i) => (
          <g key={i} transform={`translate(16 ${50 + i * 36})`}>
            <circle cx="12" cy="12" r="12" fill={soft} />
            <rect x="32" y="0" width="60" height="9" rx="4.5" fill="#cbd5e1" />
            <rect x="32" y="16" width="100" height="9" rx="4.5" fill="#eef0f3" />
            <rect x="32" y="16" width={100 * v} height="9" rx="4.5" fill={mid} />
          </g>
        ))}
      </g>
    </svg>
  );
}
