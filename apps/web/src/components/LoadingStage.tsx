import { FittedLoadingCrystal } from './Crystal';
import { Stage } from './Stage';

/** A framed canvas with the assembling crystal, shown while chain data loads. */
export function LoadingStage({ label = 'Reading the chain…', className = 'h-[420px] sm:h-[520px]' }: { label?: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[32px] border border-white/[0.08] ${className}`} role="status" aria-live="polite">
      <Stage className="!absolute inset-0" camera={{ position: [0, 0, 6], fov: 40 }}>
        <FittedLoadingCrystal size={1.4} top={0.12} bottom={0.82} />
      </Stage>
      <p className="section-label pointer-events-none absolute inset-x-0 bottom-8 text-center text-[11px]">{label}</p>
    </div>
  );
}
