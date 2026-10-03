import "./brand.css";

type MarkProps = { size?: number; className?: string; decorative?: boolean };

export function ArbitrumMark({ size = 24, className = "", decorative = false }: MarkProps) {
  return (
    <img
      className={`brand-mark brand-arbitrum ${className}`}
      src="/brands/arbitrum-icon.svg"
      width={Math.max(24, size)}
      height={Math.max(24, size)}
      alt={decorative ? "" : "Arbitrum"}
    />
  );
}

export function UsdgMark({ size = 24, className = "", decorative = false }: MarkProps) {
  return (
    <img
      className={`brand-mark brand-usdg ${className}`}
      src="/brands/usdg-token.png"
      width={size}
      height={size}
      alt={decorative ? "" : "Global Dollar (USDG)"}
    />
  );
}

export function PaxosBrand({ width = 96, className = "", decorative = false }: {
  width?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      className={`brand-paxos ${className}`}
      src="/brands/paxos-primary.png"
      width={width}
      height={width * 579 / 2042}
      alt={decorative ? "" : "Paxos"}
    />
  );
}
