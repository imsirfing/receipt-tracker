export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 animate-pulse">
      <div className="flex justify-between">
        <SkeletonLine className="h-4 w-1/3" />
        <SkeletonLine className="h-4 w-16" />
      </div>
      <SkeletonLine className="h-3 w-1/2" />
      <SkeletonLine className="h-3 w-2/3" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><SkeletonLine className="h-3 w-24" /></td>
      <td className="px-4 py-3"><SkeletonLine className="h-3 w-16" /></td>
      <td className="px-4 py-3"><SkeletonLine className="h-3 w-20" /></td>
      <td className="px-4 py-3"><SkeletonLine className="h-3 w-32" /></td>
      <td className="px-4 py-3"><SkeletonLine className="h-3 w-12" /></td>
    </tr>
  );
}
