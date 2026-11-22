/**
 * Mascote original do assistente, construído apenas com SVG + CSS.
 * Estados visuais: idle (aguardando), hover (interação) e active (janela aberta).
 */
export default function AssistantMascot({ state = "active", onEnter, onLeave }) {
  return (
    <div
      className={`mascot mascot--${state}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      aria-label="Mascote do assistente"
    >
      <div className="mascot__aura" aria-hidden="true" />
      <div className="mascot__orbit mascot__orbit--outer" aria-hidden="true" />
      <div className="mascot__orbit mascot__orbit--inner" aria-hidden="true" />

      <svg className="mascot__body" viewBox="0 0 240 240" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="mascot-core" cx="38%" cy="30%" r="74%">
            <stop offset="0%" stopColor="#e6fbff" />
            <stop offset="22%" stopColor="#86eaff" />
            <stop offset="58%" stopColor="#5f93ff" />
            <stop offset="100%" stopColor="#7b4bff" />
          </radialGradient>
          <linearGradient id="mascot-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9ff5ff" />
            <stop offset="55%" stopColor="#79aaff" />
            <stop offset="100%" stopColor="#c07bff" />
          </linearGradient>
          <filter id="mascot-glow" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="120" cy="120" r="98" fill="none" stroke="url(#mascot-edge)" strokeWidth="1.5" opacity=".4" />
        <ellipse
          cx="120"
          cy="120"
          rx="103"
          ry="40"
          fill="none"
          stroke="url(#mascot-edge)"
          strokeWidth="4"
          opacity=".85"
          transform="rotate(-27 120 120)"
          filter="url(#mascot-glow)"
        />
        <circle cx="120" cy="120" r="70" fill="url(#mascot-core)" />
        <circle cx="120" cy="120" r="70" fill="none" stroke="#d8f6ff" strokeWidth="2" opacity=".6" />
        <path
          d="M86 120c14-17 54-17 68 0-14 17-54 17-68 0Z"
          fill="#f2ffff"
          opacity=".92"
          filter="url(#mascot-glow)"
        />
        <circle cx="120" cy="120" r="9" fill="#2f5cff" opacity=".9" />
        <circle cx="120" cy="120" r="4" fill="#eafaff" />
        <ellipse cx="98" cy="94" rx="22" ry="12" fill="#ffffff" opacity=".38" transform="rotate(-28 98 94)" />
      </svg>

      <span className="mascot__spark mascot__spark--1" aria-hidden="true" />
      <span className="mascot__spark mascot__spark--2" aria-hidden="true" />
      <span className="mascot__spark mascot__spark--3" aria-hidden="true" />
    </div>
  );
}
