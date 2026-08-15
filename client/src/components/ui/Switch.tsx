export function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      /*
       * 18x34 painted, 44x60 to the finger below `lg`.
       *
       * The hit area is an invisible `::before` rather than a bigger control,
       * because the switch's size is its design and a 44px pill would read as a
       * different component. That trade is only safe where nothing else is
       * within reach: this sits at the end of the strip with a text label on one
       * side and the edge on the other, so the halo overlaps no other target.
       * The comparison chips are the opposite case and were sized up instead.
       */
      className={`relative inline-flex h-[18px] w-[34px] shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:before:absolute max-lg:before:-inset-[13px] max-lg:before:content-[''] ${
        checked ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        className={`pointer-events-none block h-[14px] w-[14px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}
