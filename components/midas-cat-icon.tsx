import Image from "next/image";

type MidasCatIconProps = {
  className?: string;
  priority?: boolean;
  size?: number;
};

export function MidasCatIcon({ className = "", priority = false, size = 44 }: MidasCatIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`midas-cat-icon ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      <Image
        alt=""
        fill
        priority={priority}
        sizes={`${size}px`}
        src="/midas-cat.webp"
      />
    </span>
  );
}
